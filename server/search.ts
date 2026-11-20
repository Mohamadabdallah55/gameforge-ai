import { publisherLicense } from "./licensed-publisher";
import { blockedImageOrigin } from "./image-policy";
import { localHttp } from "./local-http";
import { normalize, type Store } from "./store";
import { endpoint, translateQuery } from "./local";
import { publicImage, publicArticle } from "./net-image";
let database: Store | undefined;
export function persistSearch(db: Store) {
  database = db;
}
const cooldown = new Map<string, number>();
const inFlight = new Map<string, Promise<any>>();
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
  return (await searxResponse(q, images, language)).results || [];
}
export const googleImagesStatus: {
  checkedAt?: number;
  count?: number;
  error?: string;
} = {};
export function sourceHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
export async function searchWeb(
  q: string,
  language: string,
): Promise<Evidence[]> {
  const url = new URL(endpoint("SEARXNG_URL", 8888) + "/search");
  url.search = new URLSearchParams({
    q,
    format: "json",
    categories: "general",
    language,
  }).toString();
  const r = await cached(url);
  return (r.results || [])
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
  // Keep the cache compact enough for a local library.
  if (Buffer.byteLength(html) < 100000)
    database?.db
      .prepare("INSERT OR REPLACE INTO search_cache VALUES(?,?,?)")
      .run(key, html, Date.now() + 86400000);
  return html;
}
import type { Evidence } from "../shared/contracts";
const headers = () => ({
  "User-Agent":
    process.env.WIKI_USER_AGENT || "GameForgeAI/0.1 (quiz research)",
});
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
  const articles: Evidence[] = [];
  for (const lang of /[\u0600-\u06ff]/.test(term)
    ? ["ar", "en"]
    : ["en", "ar"]) {
    const pages = await query(lang + ".wikipedia.org", {
      generator: "search",
      gsrsearch: lang === "en" ? english : term,
      gsrlimit: "5",
      exintro: "1",
      prop: "extracts|info",
      explaintext: "1",
      exchars: "5000",
      exlimit: "5",
      inprop: "url",
    }).catch(() => []);
    const evidence = pages
      .sort(
        (a: { index?: number }, b: { index?: number }) =>
          (a.index ?? 100) - (b.index ?? 100),
      )
      .filter((p: { extract?: string }) => p.extract?.trim())
      .map((p: { title: string; fullurl: string; extract: string }) => ({
        title: p.title,
        url: p.fullurl,
        text: p.extract,
      }));
    articles.push(...evidence);
  }
  const web = await searx(english, false).catch(() => []);
  return [
    ...articles,
    ...web
      .filter((r: any) => r.content && /^https?:\/\//.test(r.url))
      .slice(0, 4)
      .map((r: any) => ({ title: r.title, url: r.url, text: r.content })),
  ];
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
        description: caption.slice(0, 800),
        provenance: "NASA mission archive",
        publisherCaption: caption.slice(0, 1000),
      },
    ];
  });
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
  const results = await Promise.all(
    queries.map(async (query) => {
      const language = /\p{Script=Arabic}/u.test(query) ? "ar" : "en";
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
      return fallback?.results || [];
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
  (Evidence & { preview?: string; rightsStatus: "unknown"; engine?: string })[]
> {
  const { queries } = await imageQueries(term);
  const results = await discoverImagePosts(queries);
  const mentions = imageQueryMatcher(queries);
  return [
    ...new Map(
      results
        .flatMap((group) => group.slice(0, 8))
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
