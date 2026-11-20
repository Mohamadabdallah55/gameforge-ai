import { publisherLicense } from "./licensed-publisher";
import { blockedImageOrigin } from "./image-policy";
import { localHttp } from "./local-http";
import { normalize, type Store } from "./store";
import { endpoint, translateQuery } from "./local";
import { publicImage, publicArticle } from "./net-image";
import { probeLoopbackService } from "./environment";
import type { Evidence } from "../shared/contracts";

let database: Store | undefined;
export function persistSearch(db: Store) {
  database = db;
}

let groundedSearchFn: ((q: string) => Promise<Evidence[]>) | undefined;
export function registerGroundedSearch(fn: (q: string) => Promise<Evidence[]>) {
  groundedSearchFn = fn;
}

const cooldown = new Map<string, number>();
const inFlight = new Map<string, Promise<any>>();

const headers = () => ({
  "User-Agent":
    process.env.WIKI_USER_AGENT || "GameForgeAI/0.2 (quiz research)",
});

const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
};

async function cached(url: URL) {
  const key = url.toString();
  const existing = inFlight.get(key);
  if (existing) return existing;
  const hit = database?.db
    .prepare("SELECT body FROM search_cache WHERE key=? AND expires>?")
    .get(key, Date.now());
  if (hit) return JSON.parse(String(hit.body));
  if ((cooldown.get(url.host) || 0) > Date.now())
    throw Error(url.host + " rate limited");
  const run = (async () => {
    const r =
      url.protocol === "http:"
        ? await localHttp(url, { headers: headers(), timeout: 12000 })
        : await fetch(url, {
            headers: headers(),
            signal: AbortSignal.timeout(12000),
            redirect: "error",
          });
    if (r.status === 429) {
      const retry = r.headers.get("retry-after") || "60";
      cooldown.set(
        url.host,
        Date.now() +
          Math.max(
            60000,
            Number.isFinite(Number(retry))
              ? Number(retry) * 1000
              : (Date.parse(retry) || 0) - Date.now(),
          ),
      );
    }
    if (!r.ok) throw Error(url.host + " HTTP " + r.status);
    const data = await r.json();
    if (!data.error)
      database?.db
        .prepare("INSERT OR REPLACE INTO search_cache VALUES(?,?,?)")
        .run(key, JSON.stringify(data), Date.now() + 86400000);
    return data;
  })();
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

async function cachedText(cacheKey: string, fetcher: () => Promise<string>, ttlMs = 21600000) {
  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<string>;
  const hit = database?.db
    .prepare("SELECT body FROM search_cache WHERE key=? AND expires>?")
    .get(cacheKey, Date.now());
  if (hit) return String(hit.body);
  const run = (async () => {
    const text = await fetcher();
    if (text && Buffer.byteLength(text) < 250000) {
      database?.db
        .prepare("INSERT OR REPLACE INTO search_cache VALUES(?,?,?)")
        .run(cacheKey, text, Date.now() + ttlMs);
    }
    return text;
  })();
  inFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function searxAvailable() {
  return probeLoopbackService("SEARXNG_URL", 8888, "/config", 30_000);
}

async function searxResponse(
  q: string,
  images: boolean,
  language?: string,
  engines?: string,
) {
  const u = new URL(endpoint("SEARXNG_URL", 8888) + "/search");
  u.search = new URLSearchParams({
    q,
    format: "json",
    categories: images ? "images" : "general",
    ...(language ? { language } : {}),
    ...(engines ? { engines } : {}),
  }).toString();
  return cached(u);
}

async function searx(q: string, images: boolean, language?: string) {
  if (!(await searxAvailable())) return [];
  return (await searxResponse(q, images, language)).results || [];
}

export const googleImagesStatus: {
  checkedAt?: number;
  count?: number;
  engine?: string;
  error?: string;
} = {};

export function sourceHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decodeHtmlEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBingDestination(rawHref: string): string {
  const cleanHref = rawHref.replace(/&amp;/g, "&");
  try {
    const u = new URL(cleanHref);
    if (u.hostname.endsWith("bing.com") && u.pathname.startsWith("/ck/a")) {
      const encoded = u.searchParams.get("u") || "";
      if (encoded.startsWith("a1")) {
        const b64 = encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const decoded = Buffer.from(padded, "base64").toString("utf8");
        if (decoded.startsWith("https://")) return decoded;
      }
    }
    return cleanHref.startsWith("https://") ? cleanHref : "";
  } catch {
    return "";
  }
}

async function bingWebSearch(q: string, language: string): Promise<Evidence[]> {
  const url = new URL("https://www.bing.com/search");
  url.search = new URLSearchParams({
    q,
    setlang: language === "ar" ? "ar" : "en",
  }).toString();
  try {
    const html = await cachedText("bing-web:" + url.toString(), async () => {
      const r = await fetch(url, {
        headers: browserHeaders,
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error("Bing HTTP " + r.status);
      return r.text();
    });
    const out: Evidence[] = [];
    const blocks = html.split(/<li class="b_algo"/i).slice(1, 16);
    for (const block of blocks) {
      const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const dest = decodeBingDestination(linkMatch[1]);
      if (!dest || !dest.startsWith("https://") || !sourceHost(dest)) continue;
      const title = decodeHtmlEntities(linkMatch[2]).slice(0, 230);
      const snippetMatch =
        block.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) ||
        block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      const text = decodeHtmlEntities(snippetMatch?.[1] || title).slice(0, 400);
      out.push({ title, url: dest, text });
    }
    return out;
  } catch {
    return [];
  }
}

async function googleNewsRssSearch(q: string, language: string): Promise<Evidence[]> {
  const params =
    language === "ar"
      ? { q, hl: "ar", gl: "JO", ceid: "JO:ar" }
      : { q, hl: "en-US", gl: "US", ceid: "US:en" };
  const url = "https://news.google.com/rss/search?" + new URLSearchParams(params);
  try {
    const xml = await cachedText("gnews:" + url, async () => {
      const r = await fetch(url, {
        headers: headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw Error("Google News RSS HTTP " + r.status);
      return r.text();
    });
    const items = xml.split(/<item>/i).slice(1, 10);
    const results: Evidence[] = [];
    for (const item of items) {
      const rawTitle = decodeHtmlEntities(
        item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "",
      );
      const sourceUrl = item.match(/<source[^>]*url="(https:\/\/[^"]+)"/i)?.[1];
      const linkUrl = item.match(/<link>(https:\/\/[^<]+)<\/link>/i)?.[1];
      const pubName = decodeHtmlEntities(
        item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || "",
      );
      const urlHit = sourceUrl || linkUrl;
      if (!urlHit || !rawTitle) continue;
      results.push({
        title: rawTitle.slice(0, 230),
        url: urlHit,
        text: [pubName, rawTitle].filter(Boolean).join(" — ").slice(0, 400),
      });
    }
    return results;
  } catch {
    return [];
  }
}

export async function searchWeb(
  q: string,
  language: string,
): Promise<Evidence[]> {
  if (await searxAvailable()) {
    try {
      const url = new URL(endpoint("SEARXNG_URL", 8888) + "/search");
      url.search = new URLSearchParams({
        q,
        format: "json",
        categories: "general",
        language,
      }).toString();
      const r = await cached(url);
      const localHits = (r.results || [])
        .filter(
          (x: any) =>
            typeof x.url === "string" &&
            x.url.startsWith("https://") &&
            sourceHost(x.url),
        )
        .slice(0, 18)
        .map((x: any) => ({
          title: String(x.title || "").slice(0, 230),
          url: x.url,
          text: String(x.content || "").slice(0, 400),
        }));
      if (localHits.length) return localHits;
    } catch {
      // fall back to cloud search seamlessly
    }
  }

  // Cloud Multi-Source Web Search (Bing + Google News RSS + Gemini Google Search Grounding)
  const [bingHits, newsHits, groundedHits] = await Promise.all([
    bingWebSearch(q, language),
    googleNewsRssSearch(q, language),
    groundedSearchFn ? groundedSearchFn(q).catch(() => []) : Promise.resolve([]),
  ]);

  const combined = [...groundedHits, ...bingHits, ...newsHits].filter(
    (x) =>
      typeof x.url === "string" &&
      x.url.startsWith("https://") &&
      sourceHost(x.url) &&
      // Never treat redirector stubs without real content as primary articles when real URLs exist
      sourceHost(x.url) !== "news.google.com",
  );
  return [...new Map(combined.map((x) => [x.url, x])).values()].slice(0, 18);
}

export async function articleBytes(url: string): Promise<string> {
  const key = "article:" + url;
  const hit = database?.db
    .prepare("SELECT body FROM search_cache WHERE key=? AND expires>?")
    .get(key, Date.now());
  if (hit) return String(hit.body);
  const html = (await publicArticle(url, headers()["User-Agent"])).toString(
    "utf8",
  );
  if (Buffer.byteLength(html) < 120000)
    database?.db
      .prepare("INSERT OR REPLACE INTO search_cache VALUES(?,?,?)")
      .run(key, html, Date.now() + 86400000);
  return html;
}

async function query(host: string, params: Record<string, string>) {
  const url = new URL("https://" + host + "/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    ...params,
  }).toString();
  const data = await cached(url);
  if (data.error) throw new Error("Wikimedia " + data.error.code);
  return data.query?.pages ?? [];
}

export async function information(
  term: string,
  allowExternal = true,
): Promise<Evidence[]> {
  const key = process.env.TAVILY_API_KEY;
  if (allowExternal && key && process.env.EXTERNAL_SEARCH === "tavily") {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: term,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error("Tavily HTTP " + r.status);
    const data = await r.json();
    const evidence: Evidence[] = data.results
      .filter(
        (v: { url: string; content: string }) =>
          /^https?:\/\//i.test(v.url) && v.content?.trim(),
      )
      .map((v: { title: string; url: string; content: string }) => ({
        title: v.title,
        url: v.url,
        text: v.content.slice(0, 5000),
      }));
    if (evidence.length) return evidence;
  }

  const english = await translateQuery(term).catch(() => term);
  const [webEn, webAr, wikiPages] = await Promise.all([
    searchWeb(english, "en").catch(() => []),
    /[\u0600-\u06ff]/.test(term) ? searchWeb(term, "ar").catch(() => []) : Promise.resolve([]),
    (async () => {
      const articles: Evidence[] = [];
      for (const lang of /[\u0600-\u06ff]/.test(term)
        ? ["ar", "en"]
        : ["en", "ar"]) {
        const pages = await query(lang + ".wikipedia.org", {
          generator: "search",
          gsrsearch: lang === "en" ? english : term,
          gsrlimit: "3",
          exintro: "1",
          prop: "extracts|info",
          explaintext: "1",
          exchars: "3500",
          exlimit: "3",
          inprop: "url",
        }).catch(() => []);
        articles.push(
          ...pages
            .filter((p: { extract?: string }) => p.extract?.trim())
            .map((p: { title: string; fullurl: string; extract: string }) => ({
              title: p.title,
              url: p.fullurl,
              text: p.extract,
            })),
        );
      }
      return articles;
    })(),
  ]);

  const combined = [...webAr, ...webEn, ...wikiPages];
  return [...new Map(combined.map((item) => [item.url, item])).values()].slice(0, 14);
}

export interface ImageHit {
  title: string;
  url: string;
  origin: string;
  credit: string;
  license: string;
  original?: string;
  description?: string;
  provenance?: string;
  publisherCaption?: string;
  rightsStatus?: "reusable" | "unknown";
}

function reusable(license: string) {
  return /^(CC[ -](BY(?:[ -]SA)?|0)(?= |$)|Public domain|PDM|by(?:-sa)?(?= |$)|cc0$)/i.test(
    license,
  );
}

async function openverse(term: string): Promise<ImageHit[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({
    q: term.slice(0, 200),
    page_size: "12",
    excluded_source: "wikimedia",
    license: "cc0,pdm,by,by-sa",
  }).toString();
  return (await cached(url)).results.flatMap((r: any) =>
    r.url &&
    r.foreign_landing_url &&
    r.license &&
    !blockedImageOrigin(
      r.source,
      r.provider,
      r.url,
      r.thumbnail,
      r.foreign_landing_url,
      r.attribution,
      r.creator_url,
    )
      ? [
          {
            title: r.title || "",
            url: r.thumbnail || r.url,
            original: r.url,
            origin: r.foreign_landing_url,
            credit: r.creator || "Openverse",
            license:
              r.license +
              (r.license_version && r.license.startsWith("by")
                ? " " + r.license_version
                : ""),
            rightsStatus: "reusable" as const,
            description: [r.description, r.attribution]
              .filter(Boolean)
              .join(" ")
              .slice(0, 600),
            provenance: [r.source, r.provider].filter(Boolean).join(" "),
          },
        ]
      : [],
  );
}

async function nasaArchive(q: string): Promise<ImageHit[]> {
  const frame = q.match(/\bAS\d{2}-\d{1,3}-\d{4,5}\b/i)?.[0].toLowerCase();
  if (!frame && !/\b(?:apollo|nasa|buzz aldrin|neil armstrong)\b/i.test(q))
    return [];
  const url = new URL("https://images-api.nasa.gov/search");
  url.search = new URLSearchParams({
    ...(frame ? { nasa_id: frame } : { q: q.slice(0, 160) }),
    media_type: "image",
    page_size: "20",
  }).toString();
  const data = await cached(url);
  return (data.collection?.items || []).flatMap((item: any) => {
    const meta = item.data?.[0];
    const id = String(meta?.nasa_id || "");
    const archive = id.match(/^AS(\d{2})-(\d{1,3})-(\d{4,5})$/i);
    const caption = String(meta?.description || "");
    if (
      !archive ||
      caption.length < 70 ||
      /copyright|third.party|creative commons/i.test(caption) ||
      blockedImageOrigin(caption)
    )
      return [];
    const files = (item.links || []).filter(
      (link: any) =>
        sourceHost(link.href) === "images-assets.nasa.gov" &&
        /\.(jpg|jpeg|png)$/i.test(link.href),
    );
    const original = files.sort(
      (a: any, b: any) => (b.width || 0) - (a.width || 0),
    )[0]?.href;
    if (!original) return [];
    const [, mission, roll, photo] = archive;
    const origin =
      "https://eol.jsc.nasa.gov/SearchPhotos/photo.pl?" +
      new URLSearchParams({ frame: photo, mission: "AS" + mission, roll });
    return [
      {
        title: String(meta.title),
        url: original,
        original,
        origin,
        credit: "NASA / " + id,
        license: "Public domain (NASA mission photograph)",
        rightsStatus: "reusable" as const,
        description: caption.slice(0, 800),
        provenance: "NASA mission archive",
        publisherCaption: caption.slice(0, 1000),
      },
    ];
  });
}

async function duckDuckGoImages(query: string) {
  try {
    const tokenRes = await fetch(
      "https://duckduckgo.com/?q=" +
        encodeURIComponent(query) +
        "&iax=images&ia=images",
      { headers: browserHeaders, signal: AbortSignal.timeout(8000) },
    );
    const tokenHtml = await tokenRes.text();
    const vqd = tokenHtml.match(/vqd=(["']?)([0-9-]+)\1/)?.[2];
    if (!vqd) return [];
    const jsonUrl =
      "https://duckduckgo.com/i.js?" +
      new URLSearchParams({
        l: "wt-wt",
        o: "json",
        q: query,
        vqd,
        f: ",,,",
        p: "1",
      }).toString();
    const res = await fetch(jsonUrl, {
      headers: { ...browserHeaders, Referer: "https://duckduckgo.com/" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((item: any) => ({
      title: String(item.title || ""),
      img_src: String(item.image || ""),
      thumbnail_src: String(item.thumbnail || item.image || ""),
      url: String(item.url || ""),
      engine: "DuckDuckGo Images",
    }));
  } catch {
    return [];
  }
}

async function bingImages(query: string) {
  try {
    const url =
      "https://www.bing.com/images/search?" +
      new URLSearchParams({ q: query, first: "1" }).toString();
    const html = await cachedText("bing-img:" + url, async () => {
      const r = await fetch(url, {
        headers: browserHeaders,
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error("Bing Images HTTP " + r.status);
      return r.text();
    });
    const out: any[] = [];
    for (const match of html.matchAll(/m="([^"]*murl[^"]*)"/g)) {
      try {
        const meta = JSON.parse(match[1].replace(/&quot;/g, '"'));
        if (meta.murl && meta.purl) {
          out.push({
            title: String(meta.t || ""),
            img_src: String(meta.murl),
            thumbnail_src: String(meta.turl || meta.murl),
            url: String(meta.purl),
            engine: "Bing Images",
          });
        }
      } catch {
        // skip malformed card
      }
      if (out.length >= 16) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function imageQueries(term: string) {
  const english = await translateQuery(term).catch(() => term);
  return { english, queries: [...new Set([term, english])] };
}

function imageQueryMatcher(queries: string[]) {
  const terms = queries.map(normalize).filter(Boolean);
  return (text: string) => {
    const haystack = " " + normalize(text) + " ";
    return Number(terms.some((term) => haystack.includes(" " + term + " ")));
  };
}

async function discoverImagePosts(queries: string[]) {
  const hasLocalSearx = await searxAvailable();
  const results = await Promise.all(
    queries.map(async (query) => {
      const language = /\p{Script=Arabic}/u.test(query) ? "ar" : "en";
      if (hasLocalSearx) {
        let google: any[] = [];
        try {
          const result = await searxResponse(
            query,
            true,
            language,
            "google images",
          );
          google = (result.results || []).filter(
            (item: any) => item.engine === "google images",
          );
          googleImagesStatus.engine = "Google Images (SearXNG)";
          googleImagesStatus.error = google.length
            ? undefined
            : result.unresponsive_engines?.find(
                ([engine]: string[]) => engine === "google images",
              )?.[1] || "لا نتائج من Google Images";
        } catch (error) {
          googleImagesStatus.error = (error as Error).message;
        }
        googleImagesStatus.checkedAt = Date.now();
        googleImagesStatus.count = google.length;
        if (
          google.some(
            (item) =>
              typeof item.img_src === "string" &&
              !blockedImageOrigin(item.img_src, item.url),
          )
        )
          return google;
        const fallback = await searxResponse(
          query,
          true,
          language,
          "bing images,brave.images,duckduckgo images",
        ).catch(() => null);
        if (fallback?.results?.length) return fallback.results;
      }

      // Cloud Image Discovery (DuckDuckGo Images + Bing Images)
      const [ddg, bing] = await Promise.all([
        duckDuckGoImages(query),
        bingImages(query),
      ]);
      const merged = [...ddg, ...bing];
      googleImagesStatus.checkedAt = Date.now();
      googleImagesStatus.engine = "DuckDuckGo Images + Bing Images (سحابي)";
      googleImagesStatus.count = merged.length;
      googleImagesStatus.error = merged.length
        ? undefined
        : "لم يرجع البحث السحابي نتائج صور مطابقة.";
      return merged;
    }),
  );

  return results.map((group) =>
    group.filter(
      (r: any) =>
        typeof r.img_src === "string" &&
        typeof r.url === "string" &&
        r.img_src.startsWith("https://") &&
        r.url.startsWith("https://") &&
        !blockedImageOrigin(r.img_src, r.url, r.thumbnail_src),
    ),
  );
}

export async function imagePosts(
  term: string,
): Promise<
  (Evidence & {
    preview?: string;
    imgUrl?: string;
    rightsStatus: "unknown";
    engine?: string;
  })[]
> {
  const { queries } = await imageQueries(term);
  const results = await discoverImagePosts(queries);
  const mentions = imageQueryMatcher(queries);
  return [
    ...new Map(
      results
        .flatMap((group) => group.slice(0, 12))
        .map((r: any) => [
          r.url,
          {
            title: String(r.title || sourceHost(r.url)).slice(0, 230),
            url: r.url,
            text: sourceHost(r.url),
            preview:
              typeof r.thumbnail_src === "string" &&
              r.thumbnail_src.startsWith("https://")
                ? r.thumbnail_src
                : r.img_src,
            imgUrl: r.img_src,
            rightsStatus: "unknown" as const,
            engine: typeof r.engine === "string" ? r.engine : undefined,
          },
        ]),
    ).values(),
  ].sort((a, b) => mentions(b.title) - mentions(a.title));
}

export async function pictures(term: string): Promise<ImageHit[]> {
  const { english, queries } = await imageQueries(term);
  const [archive, imageResults, open] = await Promise.all([
    nasaArchive(english).catch(() => []),
    discoverImagePosts(queries),
    Promise.all(queries.map((query) => openverse(query).catch(() => []))),
  ]);
  const discovery = imageResults.flat();
  const published = imageResults.flatMap((results) =>
    results.slice(0, queries.length === 1 ? 4 : 2),
  );
  const inspected = await Promise.allSettled(
    [
      ...new Map(
        published.map((r: any) => [r.url + "\n" + r.img_src, r]),
      ).values(),
    ].map(async (r: any) => {
      const details = publisherLicense(
        await articleBytes(r.url),
        r.img_src,
        r.url,
      );
      return (
        details && {
          ...details,
          publisherCaption: details.description,
          rightsStatus: "reusable" as const,
          title: String(r.title || ""),
          url: r.img_src,
          original: r.img_src,
          origin: r.url,
        }
      );
    }),
  );
  const hits = [
    ...archive,
    ...open.flat(),
    ...inspected.flatMap((r) =>
      r.status === "fulfilled" && r.value ? [r.value] : [],
    ),
  ];
  const peers = new Set(discovery.flatMap((r: any) => [r.img_src, r.url]));
  const mentions = imageQueryMatcher(queries);
  return [
    ...new Map(
      hits
        .filter(
          (h) =>
            reusable(h.license) &&
            /^https:\/\//i.test(h.origin) &&
            /^https:\/\//i.test(h.url),
        )
        .map((h) => [h.origin, h]),
    ).values(),
  ].sort(
    (a, b) =>
      mentions(b.title + " " + (b.description || "")) -
        mentions(a.title + " " + (a.description || "")) ||
      Number(peers.has(b.original) || peers.has(b.origin)) -
        Number(peers.has(a.original) || peers.has(a.origin)),
  );
}

export async function downloadHit(hit: ImageHit) {
  if (
    blockedImageOrigin(
      hit.origin,
      hit.url,
      hit.original,
      hit.provenance,
      hit.description,
    )
  )
    throw Error("مصدر الصورة محظور");
  if (!reusable(hit.license)) throw Error("ترخيص صورة غير مدعوم");
  try {
    return await publicImage(hit.original || hit.url, headers()["User-Agent"]);
  } catch (e) {
    if (!hit.original || hit.original === hit.url) throw e;
    return publicImage(hit.url, headers()["User-Agent"]);
  }
}

export async function downloadAuthorizedWebImage(imgUrl: string, originUrl: string) {
  if (blockedImageOrigin(imgUrl, originUrl)) {
    throw Error("لا يمكن استيراد صور مصدرها ويكيبيديا أو ويكيميديا");
  }
  return publicImage(imgUrl, headers()["User-Agent"]);
}
