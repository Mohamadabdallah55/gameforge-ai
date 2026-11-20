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
    process.env.WIKI_USER_AGENT ||
    "GameForgeEncyclopedia/1.0 (https://github.com/Mohamadabdallah55/gameforge-ai)",
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
    const raw = await r.text();
    if (!raw.trim().startsWith("{") && !raw.trim().startsWith("[")) {
      if (/too many requests|rate limit/i.test(raw)) {
        cooldown.set(url.host, Date.now() + 30000);
      }
      throw Error(url.host + " non-JSON response");
    }
    const data = JSON.parse(raw);
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

async function bingWebSearch(q: string, _language: string): Promise<Evidence[]> {
  // Bing's datacenter SERP garbles raw Arabic text into unrelated Western results;
  // handle Arabic via Wikipedia OpenSearch + Wikidata + Arabic Google News RSS.
  if (/[\u0600-\u06ff]/.test(q)) return [];
  const parseBing = async (queryText: string): Promise<Evidence[]> => {
    const url = new URL("https://www.bing.com/search");
    url.search = new URLSearchParams({ q: queryText }).toString();
    const html = await cachedText("bing-web:v2:" + url.toString(), async () => {
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
  };

  try {
    const cleanCore = q
      .replace(/site:\S+/gi, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const coreWords = cleanCore.split(" ").filter((w) => w.length >= 3);
    const twoWordCore = coreWords.slice(0, 2).join(" ");

    let hits = await parseBing(q);
    // Bing's UK/cloud SERP often drops tail tokens on 3+ word queries and falls back to the 1st word only;
    // verify at least one hit matches the 2nd core word, otherwise retry with clean 2-word core.
    const hasSecondTokenMatch = (list: Evidence[]) =>
      coreWords.length < 2 ||
      list.some((h) => normalize(h.title + " " + h.text).includes(normalize(coreWords[1])));

    if (coreWords.length >= 2 && !hasSecondTokenMatch(hits)) {
      hits = await parseBing(twoWordCore);
    }
    if (coreWords.length >= 2) {
      const filtered = hits.filter((h) => {
        const txt = normalize(h.title + " " + h.text);
        return (
          txt.includes(normalize(coreWords[0])) &&
          txt.includes(normalize(coreWords[1]))
        );
      });
      if (filtered.length) return filtered;
      return [];
    }
    return hits;
  } catch {
    return [];
  }
}

async function duckDuckGoWebSearch(q: string): Promise<Evidence[]> {
  if (/[\u0600-\u06ff]/.test(q)) return [];
  try {
    const url = "https://html.duckduckgo.com/html/?" + new URLSearchParams({ q }).toString();
    const html = await cachedText("ddg-html:v1:" + url, async () => {
      const r = await fetch(url, {
        headers: browserHeaders,
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw Error("DDG HTML HTTP " + r.status);
      return r.text();
    });
    const out: Evidence[] = [];
    const blocks = html.split(/class="result results_links/i).slice(1, 14);
    for (const block of blocks) {
      const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      let rawUrl = decodeHtmlEntities(linkMatch[1]);
      if (rawUrl.startsWith("//")) rawUrl = "https:" + rawUrl;
      let dest = rawUrl;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.hostname.includes("duckduckgo.com") && parsed.searchParams.get("uddg")) {
          dest = parsed.searchParams.get("uddg")!;
        }
      } catch {
        continue;
      }
      if (!dest.startsWith("https://") || !sourceHost(dest)) continue;
      const title = decodeHtmlEntities(linkMatch[2]).slice(0, 230);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
      const text = decodeHtmlEntities(snippetMatch?.[1] || title).slice(0, 420);
      out.push({ title, url: dest, text });
    }
    return out;
  } catch {
    return [];
  }
}

async function theSportsDbFacts(q: string): Promise<Evidence[]> {
  if (/[\u0600-\u06ff]/.test(q)) return [];
  const cleanWords = q
    .replace(/site:\S+/gi, " ")
    .replace(/[^\p{L}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length >= 3);
  if (cleanWords.length < 2) return [];
  const candidateName = cleanWords.slice(0, 2).join(" ");
  try {
    const searchUrl = new URL(
      "https://www.thesportsdb.com/api/v1/json/123/searchplayers.php",
    );
    searchUrl.search = new URLSearchParams({ p: candidateName }).toString();
    const data = await cached(searchUrl);
    const players: any[] = Array.isArray(data?.player) ? data.player : [];
    const match = players.find((p) => {
      const n = normalize(String(p?.strPlayer || ""));
      return cleanWords.slice(0, 2).every((w) => n.includes(normalize(w)));
    });
    if (!match?.idPlayer) return [];
    const lookupUrl = new URL(
      "https://www.thesportsdb.com/api/v1/json/123/lookupplayer.php",
    );
    lookupUrl.search = new URLSearchParams({ id: String(match.idPlayer) }).toString();
    const detail = await cached(lookupUrl);
    const full = Array.isArray(detail?.players) ? detail.players[0] : null;
    const desc = String(full?.strDescriptionEN || match.strDescriptionEN || "").trim();
    if (desc.length < 180) return [];
    return [
      {
        title: `${String(full?.strPlayer || match.strPlayer)} — Career Profile (TheSportsDB)`,
        url: `https://www.thesportsdb.com/player/${match.idPlayer}`,
        text: desc.slice(0, 3200),
      },
    ];
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
      const linkUrl = item.match(/<link>(https:\/\/[^<]+)<\/link>/i)?.[1];
      const pubName = decodeHtmlEntities(
        item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || "",
      );
      if (!linkUrl || !rawTitle || sourceHost(linkUrl) === "news.google.com") continue;
      results.push({
        title: rawTitle.slice(0, 230),
        url: linkUrl,
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

  // Cloud Multi-Source Web Search (TheSportsDB + DuckDuckGo HTML + Bing + Google News RSS + Gemini Grounding)
  const [sportsHits, ddgHits, bingHits, newsHits, groundedHits] = await Promise.all([
    language === "en" ? theSportsDbFacts(q) : Promise.resolve([]),
    language === "en" ? duckDuckGoWebSearch(q) : Promise.resolve([]),
    language === "en" ? bingWebSearch(q, language) : Promise.resolve([]),
    googleNewsRssSearch(q, language),
    groundedSearchFn ? groundedSearchFn(q).catch(() => []) : Promise.resolve([]),
  ]);

  const combined = [...sportsHits, ...groundedHits, ...ddgHits, ...bingHits, ...newsHits].filter(
    (x) =>
      typeof x.url === "string" &&
      x.url.startsWith("https://") &&
      sourceHost(x.url) &&
      sourceHost(x.url) !== "news.google.com",
  );
  const deduped = [...new Map(combined.map((x) => [x.url, x])).values()];
  deduped.sort((a, b) => {
    const deep = (u: string) => {
      try {
        return new URL(u).pathname.length > 1 ? 1 : 0;
      } catch {
        return 0;
      }
    };
    return deep(b.url) - deep(a.url);
  });
  return deduped.slice(0, 18);
}

export async function articleBytes(url: string): Promise<string> {
  const key = "article:" + url;
  const hit = database?.db
    .prepare("SELECT body FROM search_cache WHERE key=? AND expires>?")
    .get(key, Date.now());
  if (hit) return String(hit.body);
  const html = (await publicArticle(url, browserHeaders["User-Agent"])).toString(
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
  const wikiByLang = async (lang: string, searchText: string): Promise<Evidence[]> => {
    if (!searchText || searchText.length < 2) return [];
    const host = lang + ".wikipedia.org";
    // 1. OpenSearch avoids CirrusSearch "too-busy-error" and resolves exact page titles fast
    const opUrl = new URL("https://" + host + "/w/api.php");
    opUrl.search = new URLSearchParams({
      action: "opensearch",
      search: searchText.slice(0, 120),
      limit: "3",
      format: "json",
    }).toString();
    let titles: string[] = [];
    const opRes = await cached(opUrl).catch(() => null);
    if (Array.isArray(opRes) && Array.isArray(opRes[1])) {
      titles = opRes[1].map(String).filter(Boolean).slice(0, 3);
    }
    if (!titles.length) {
      // Retry opensearch with shorter 2-3 word core if multi-word descriptive phrase missed
      const shortCore = searchText
        .split(/\s+/)
        .filter((w) => w.length >= 3)
        .slice(0, 2)
        .join(" ");
      if (shortCore && shortCore !== searchText) {
        const opShort = new URL("https://" + host + "/w/api.php");
        opShort.search = new URLSearchParams({
          action: "opensearch",
          search: shortCore,
          limit: "3",
          format: "json",
        }).toString();
        const opShortRes = await cached(opShort).catch(() => null);
        if (Array.isArray(opShortRes) && Array.isArray(opShortRes[1])) {
          titles = opShortRes[1].map(String).filter(Boolean).slice(0, 3);
        }
      }
    }

    const pages = titles.length
      ? await query(host, {
          titles: titles.join("|"),
          prop: "extracts|info",
          explaintext: "1",
          redirects: "1",
          inprop: "url",
        }).catch(() => [])
      : await query(host, {
          generator: "search",
          gsrsearch: searchText.slice(0, 120),
          gsrlimit: "3",
          prop: "extracts|info",
          explaintext: "1",
          exlimit: "3",
          inprop: "url",
        }).catch(() => []);

    return (pages || [])
      .filter((p: { extract?: string }) => p.extract?.trim())
      .map((p: { title: string; fullurl: string; extract: string }) => ({
        title: p.title,
        url: p.fullurl,
        text: p.extract.slice(0, 4800),
      }));
  };

  const [webEn, webAr, wikiAr, wikiEn] = await Promise.all([
    searchWeb(english, "en").catch(() => []),
    /[\u0600-\u06ff]/.test(term) ? searchWeb(term, "ar").catch(() => []) : Promise.resolve([]),
    wikiByLang("ar", term).catch(() => []),
    wikiByLang("en", english).catch(() => []),
  ]);

  const combined = /[\u0600-\u06ff]/.test(term)
    ? [...wikiAr, ...webAr, ...webEn, ...wikiEn]
    : [...webEn, ...wikiEn, ...wikiAr];
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
  rightsStatus?: "reusable" | "attributed" | "unknown";
}

function reusable(license: string) {
  return /^(CC[ -](BY(?:[ -]SA)?|0)(?= |$)|Public domain|PDM|by(?:-sa)?(?= |$)|cc0$)/i.test(
    license,
  );
}

function attributedOrReusable(hit: ImageHit) {
  return (
    reusable(hit.license) ||
    hit.rightsStatus === "attributed" ||
    /^Web attribution\b/i.test(hit.license)
  );
}

const watermarkedStockHost =
  /(^|\.)(shutterstock\.com|gettyimages\.[a-z.]+|alamy\.com|istockphoto\.com|123rf\.com|depositphotos\.com|dreamstime\.com|vecteezy\.com|stock\.adobe\.com|bigstockphoto\.com|dreamstime\.com|agefotostock\.com)$/i;

function isWatermarkedStock(...values: (string | undefined)[]) {
  return values.some((v) => {
    if (!v) return false;
    try {
      const host = new URL(v).hostname.toLowerCase();
      return watermarkedStockHost.test(host);
    } catch {
      return watermarkedStockHost.test(v);
    }
  });
}

async function openverse(term: string): Promise<ImageHit[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({
    q: term.slice(0, 200),
    page_size: "12",
    excluded_source: "wikimedia",
    license: "cc0,pdm,by,by-sa",
  }).toString();
  const key = "openverse:" + url.toString();
  const cachedHit = database?.db
    .prepare("SELECT body FROM search_cache WHERE key=? AND expires>?")
    .get(key, Date.now());
  let data: any;
  if (cachedHit) {
    data = JSON.parse(String(cachedHit.body));
  } else {
    if ((cooldown.get(url.host) || 0) > Date.now()) return [];
    const r = await fetch(url, {
      headers: {
        ...browserHeaders,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 429 || r.status === 504) {
      cooldown.set(url.host, Date.now() + 60_000);
      return [];
    }
    if (!r.ok || !String(r.headers.get("content-type") || "").includes("json")) {
      return [];
    }
    data = await r.json();
    if (data?.results?.length) {
      database?.db
        .prepare("INSERT OR REPLACE INTO search_cache VALUES(?,?,?)")
        .run(key, JSON.stringify(data), Date.now() + 12 * 3600_000);
    }
  }
  return (data?.results || []).flatMap((r: any) =>
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
  const isSpaceQuery =
    /\b(?:apollo|nasa|buzz aldrin|neil armstrong|black hole|galaxy|nebula|mars|jupiter|saturn|uranus|neptune|mercury|venus|planet|solar system|moon|lunar|sun|telescope|hubble|webb|supernova|comet|asteroid|cosmos|milky way|astronaut|spacecraft|iss)\b/i.test(
      q,
    );
  if (!frame && !isSpaceQuery) return [];
  const url = new URL("https://images-api.nasa.gov/search");
  url.search = new URLSearchParams({
    ...(frame ? { nasa_id: frame } : { q: q.slice(0, 160) }),
    media_type: "image",
    page_size: "12",
  }).toString();
  const data = await cached(url).catch(() => ({ collection: { items: [] } }));
  return (data.collection?.items || []).flatMap((item: any) => {
    const meta = item.data?.[0];
    const id = String(meta?.nasa_id || "");
    const archive = id.match(/^AS(\d{2})-(\d{1,3})-(\d{4,5})$/i);
    const caption = String(meta?.description || meta?.title || "");
    if (
      caption.length < 40 ||
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
    const origin = archive
      ? "https://eol.jsc.nasa.gov/SearchPhotos/photo.pl?" +
        new URLSearchParams({
          frame: archive[3],
          mission: "AS" + archive[1],
          roll: archive[2],
        })
      : `https://images.nasa.gov/details/${encodeURIComponent(id)}`;
    return [
      {
        title: String(meta?.title || q),
        url: original,
        original,
        origin,
        credit: "NASA / " + (id || "Archive"),
        license: "Public domain (NASA archive photograph)",
        rightsStatus: "reusable" as const,
        description: caption.slice(0, 800),
        provenance: "NASA archive",
        publisherCaption: caption.slice(0, 1000),
      },
    ];
  });
}

async function theSportsDbPlayers(query: string): Promise<ImageHit[]> {
  if (/[\u0600-\u06ff]/.test(query)) return [];
  const cleanName = query
    .replace(/\b(footballer|football|soccer|player|portrait|legend|legends|iconic|goal|final|world cup)\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleanName.split(" ").filter((w) => w.length >= 2);
  if (!words.length || words.length > 4) return [];
  const nameParam = words.slice(0, 3).join("_");
  try {
    const url =
      "https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=" +
      encodeURIComponent(nameParam);
    const raw = await cachedText(
      "tsdb:" + nameParam.toLowerCase(),
      async () => {
        const r = await fetch(url, {
          headers: { ...browserHeaders, Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        if (!r.ok) return "";
        return r.text();
      },
      12 * 3600_000,
    );
    if (!raw || !raw.trim().startsWith("{")) return [];
    const data = JSON.parse(raw);
    return (data.player || []).slice(0, 4).flatMap((p: any) => {
      const imgUrl = p.strThumb || p.strCutout || p.strRender;
      if (
        !imgUrl ||
        typeof imgUrl !== "string" ||
        !imgUrl.startsWith("https://") ||
        !p.idPlayer
      )
        return [];
      const origin = `https://www.thesportsdb.com/player/${p.idPlayer}`;
      if (blockedImageOrigin(imgUrl, origin, p.strPlayer)) return [];
      const caption = [p.strPlayer, p.strTeam, p.strNationality, p.strDescriptionEN]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 800);
      return [
        {
          title: `${p.strPlayer || query} (${p.strSport || "Sport"})`,
          url: imgUrl,
          original: imgUrl,
          origin,
          credit: `${p.strPlayer || "Athlete"} / TheSportsDB`,
          license: "Web attribution (thesportsdb.com)",
          rightsStatus: "attributed" as const,
          description: caption,
          provenance: "TheSportsDB",
          publisherCaption: caption,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function flickrImages(query: string): Promise<ImageHit[]> {
  if (/[\u0600-\u06ff]/.test(query)) return [];
  try {
    const url =
      "https://www.flickr.com/search/?text=" +
      encodeURIComponent(query) +
      "&media=photos";
    const html = await cachedText(
      "flickr:" + url,
      async () => {
        const r = await fetch(url, {
          headers: {
            ...browserHeaders,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return "";
        return r.text();
      },
      6 * 3600_000,
    );
    if (!html) return [];
    const hits: ImageHit[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(
      /https?:\\?\/\\?\/live\.staticflickr\.com\\?\/(\d+)\\?\/(\d+)_([a-f0-9]+)(?:_[a-z])?\.(jpg|png)/gi,
    )) {
      const serverId = m[1];
      const photoId = m[2];
      const secret = m[3];
      const ext = m[4];
      const imgUrl = `https://live.staticflickr.com/${serverId}/${photoId}_${secret}_b.${ext}`;
      if (seen.has(photoId) || blockedImageOrigin(imgUrl)) continue;
      seen.add(photoId);
      hits.push({
        title: `${query} — Flickr Photo #${photoId}`,
        url: imgUrl,
        original: imgUrl,
        origin: `https://www.flickr.com/photo.gne?id=${photoId}`,
        credit: "Flickr Photographer",
        license: "Web attribution (flickr.com)",
        rightsStatus: "attributed" as const,
        description: `Flickr editorial photo matching ${query}`,
        provenance: "Flickr",
        publisherCaption: `Flickr photograph for ${query}`,
      });
      if (hits.length >= 6) break;
    }
    return hits;
  } catch {
    return [];
  }
}

async function duckDuckGoImages(query: string) {
  try {
    const tokenRes = await fetch(
      "https://duckduckgo.com/?q=" +
        encodeURIComponent(query) +
        "&iax=images&ia=images",
      { headers: browserHeaders, signal: AbortSignal.timeout(3500) },
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
      signal: AbortSignal.timeout(3500),
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

export function parseBingImagesHtml(html: string) {
  const out: {
    title: string;
    img_src: string;
    thumbnail_src: string;
    url: string;
    engine: string;
  }[] = [];
  const seen = new Set<string>();
  const push = (
    murl: unknown,
    purl: unknown,
    turl?: unknown,
    title?: unknown,
  ) => {
    const img_src = String(murl || "").trim();
    const url = String(purl || "").trim();
    if (!img_src.startsWith("https://") || !url.startsWith("https://")) return;
    if (seen.has(img_src)) return;
    seen.add(img_src);
    out.push({
      title: decodeHtmlEntities(String(title || sourceHost(url) || "")),
      img_src,
      thumbnail_src: String(turl || img_src).startsWith("https://")
        ? String(turl || img_src)
        : img_src,
      url,
      engine: "Bing Images",
    });
  };

  for (const match of html.matchAll(/m="([^"]*murl[^"]*)"/g)) {
    try {
      const meta = JSON.parse(match[1].replace(/&quot;/g, '"'));
      push(meta.murl, meta.purl, meta.turl, meta.t);
    } catch {
      // fallback regex extraction below handles escaped attributes
    }
    if (out.length >= 16) return out;
  }

  for (const block of html.split(/&quot;murl&quot;\s*:/).slice(1, 24)) {
    const murl = block.match(/^\s*&quot;(https:\/\/[^&"]+)&quot;/)?.[1];
    if (!murl) continue;
    const purl =
      block.match(/&quot;purl&quot;\s*:\s*&quot;(https:\/\/[^&"]+)&quot;/)?.[1] ||
      murl;
    const turl = block.match(
      /&quot;turl&quot;\s*:\s*&quot;(https:\/\/[^&"]+)&quot;/,
    )?.[1];
    const title = block.match(/&quot;t&quot;\s*:\s*&quot;([^&"]+)&quot;/)?.[1];
    push(
      murl.replace(/\\u002f/gi, "/"),
      purl.replace(/\\u002f/gi, "/"),
      turl?.replace(/\\u002f/gi, "/"),
      title,
    );
    if (out.length >= 16) break;
  }
  return out;
}

async function bingImages(query: string) {
  // Bing Images garbles Arabic queries on cloud hosts; run Bing Images strictly on English queries.
  if (/[\u0600-\u06ff]/.test(query)) return [];
  try {
    const url =
      "https://www.bing.com/images/async?" +
      new URLSearchParams({
        q: query,
        first: "1",
        count: "16",
        adlt: "moderate",
      }).toString();
    const html = await cachedText("bing-img-async:" + url, async () => {
      const r = await fetch(url, {
        headers: {
          ...browserHeaders,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw Error("Bing Images HTTP " + r.status);
      return r.text();
    });
    const parsed = parseBingImagesHtml(html);
    const coreWords = normalize(query)
      .split(" ")
      .filter((w) => w.length >= 3);
    if (coreWords.length >= 2) {
      const matching = parsed.filter((item) => {
        const hay = normalize(item.title + " " + item.url);
        return coreWords.slice(0, 2).every((w) => hay.includes(w));
      });
      if (matching.length >= 2) return matching;
    }
    return parsed;
  } catch {
    return [];
  }
}

async function imageQueries(term: string) {
  const english = await translateQuery(term).catch(() => term);
  const cleanEn = english.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  const hasAr = /[\u0600-\u06ff]/.test(term);
  // Keep clean English queries primary; avoid passing raw Arabic to English-only scrapers when cleanEn exists
  const queries = cleanEn && cleanEn.length >= 2
    ? hasAr
      ? [cleanEn]
      : [...new Set([term, cleanEn])]
    : [term];
  return { english: cleanEn || english, queries };
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

      // Cloud Image Discovery (Bing Async Images + DuckDuckGo Images + TheSportsDB)
      const [bing, ddg, sports] = await Promise.all([
        bingImages(query),
        duckDuckGoImages(query),
        theSportsDbPlayers(query),
      ]);
      const sportsPosts = sports.map((s) => ({
        title: s.title,
        img_src: s.original || s.url,
        thumbnail_src: s.url,
        url: s.origin,
        engine: "TheSportsDB",
        description: s.description,
        credit: s.credit,
      }));
      const merged = [...sportsPosts, ...bing, ...ddg];
      googleImagesStatus.checkedAt = Date.now();
      googleImagesStatus.engine = "Bing Images + TheSportsDB + Flickr (سحابي)";
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
        !blockedImageOrigin(r.img_src, r.url, r.thumbnail_src) &&
        !isWatermarkedStock(r.img_src, r.url),
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

export async function pictures(
  term: string,
  options: { allowAttributed?: boolean } = { allowAttributed: true },
): Promise<ImageHit[]> {
  const allowAttributed = options.allowAttributed !== false;
  const { english, queries } = await imageQueries(term);
  const [archive, imageResults, open, flickr, sports] = await Promise.all([
    nasaArchive(english).catch(() => []),
    discoverImagePosts(queries),
    Promise.all(queries.map((query) => openverse(query).catch(() => []))),
    allowAttributed
      ? Promise.all(
          [...new Set([english])].map((query) =>
            flickrImages(query).catch(() => []),
          ),
        )
      : Promise.resolve([]),
    allowAttributed
      ? theSportsDbPlayers(english).catch(() => [])
      : Promise.resolve([]),
  ]);
  const discovery = imageResults.flat();
  const published = imageResults.flatMap((results) =>
    results.slice(0, queries.length === 1 ? 6 : 3),
  );
  const inspected = await Promise.allSettled(
    [
      ...new Map(
        published.map((r: any) => [r.url + "\n" + r.img_src, r]),
      ).values(),
    ].map(async (r: any) => {
      const html = await Promise.race([
        articleBytes(r.url).catch(() => ""),
        new Promise<string>((ok) => setTimeout(() => ok(""), 2500)),
      ]);
      const details = html
        ? publisherLicense(html, r.img_src, r.url)
        : undefined;
      if (details) {
        return {
          ...details,
          publisherCaption: details.description,
          rightsStatus: "reusable" as const,
          title: String(r.title || ""),
          url: r.img_src,
          original: r.img_src,
          origin: r.url,
        };
      }
      if (!allowAttributed) return undefined;
      const host = sourceHost(r.url) || sourceHost(r.img_src) || "web";
      return {
        title: String(r.title || term),
        url: String(r.thumbnail_src || r.img_src),
        original: String(r.img_src),
        origin: String(r.url),
        credit: String(r.credit || host),
        license: `Web attribution (${host})`,
        rightsStatus: "attributed" as const,
        description: String(r.description || r.title || term).slice(0, 600),
        provenance: String(r.engine || "Web Image Search"),
        publisherCaption: String(r.description || r.title || "").slice(0, 800),
      };
    }),
  );
  const hits: ImageHit[] = [
    ...archive,
    ...open.flat(),
    ...sports,
    ...flickr.flat(),
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
            (allowAttributed ? attributedOrReusable(h) : reusable(h.license)) &&
            /^https:\/\//i.test(h.origin) &&
            /^https:\/\//i.test(h.url) &&
            !blockedImageOrigin(
              h.origin,
              h.url,
              h.original,
              h.credit,
              h.provenance,
            ) &&
            !isWatermarkedStock(h.origin, h.url, h.original),
        )
        .map((h) => [h.origin + "|" + (h.original || h.url), h]),
    ).values(),
  ].sort(
    (a, b) =>
      Number(reusable(b.license)) - Number(reusable(a.license)) ||
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
      hit.credit,
      hit.provenance,
      hit.description,
    )
  )
    throw Error("مصدر الصورة محظور");
  if (!attributedOrReusable(hit)) throw Error("ترخيص صورة غير مدعوم");
  try {
    return await publicImage(
      hit.original || hit.url,
      browserHeaders["User-Agent"],
    );
  } catch (e) {
    if (!hit.original || hit.original === hit.url) throw e;
    return publicImage(hit.url, browserHeaders["User-Agent"]);
  }
}

export async function downloadAuthorizedWebImage(imgUrl: string, originUrl: string) {
  if (blockedImageOrigin(imgUrl, originUrl)) {
    throw Error("لا يمكن استيراد صور مصدرها ويكيبيديا أو ويكيميديا");
  }
  return publicImage(imgUrl, browserHeaders["User-Agent"]);
}
