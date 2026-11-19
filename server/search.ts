import type { Evidence, SearchSource } from "../shared/contracts";

const USER_AGENT =
  process.env.WIKI_USER_AGENT ||
  "GameForgeAI/1.0 (https://github.com/Mohamadabdallah55/gameforge-ai; support@gameforge.local)";

const headers = () => ({
  "User-Agent": USER_AGENT,
  Accept: "application/json,image/*;q=0.9,*/*;q=0.8",
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const hostNextSlot = new Map<string, number>();
const hostCooldownUntil = new Map<string, number>();

async function paceHost(hostname: string, minGapMs = 350) {
  const now = Date.now();
  const cooldown = hostCooldownUntil.get(hostname) ?? 0;
  if (cooldown > now) {
    const wait = cooldown - now;
    if (wait > 6000) {
      throw new Error(
        `الخادم ${hostname} يطلب الانتظار ${Math.ceil(wait / 1000)} ثوانٍ بسبب حد الطلبات (429)`,
      );
    }
    await sleep(wait);
  }
  const nextAllowed = hostNextSlot.get(hostname) ?? 0;
  if (nextAllowed > Date.now()) {
    await sleep(nextAllowed - Date.now());
  }
  hostNextSlot.set(hostname, Date.now() + minGapMs);
}

function isSafePublicUrl(urlStr: string): URL {
  const u = new URL(urlStr);
  if (u.protocol !== "https:") {
    throw new Error("يُسمح فقط بروابط HTTPS");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("عنوان شبكة غير مسموح");
  }
  return u;
}

async function queryWiki(host: string, params: Record<string, string>) {
  const url = new URL("https://" + host + "/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    ...params,
  }).toString();
  await paceHost(host, 250);
  const r = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("Wikimedia HTTP " + r.status);
  const data = await r.json();
  if (data.error) throw new Error("Wikimedia " + data.error.code);
  return data.query?.pages ?? [];
}

async function wikipediaEvidence(term: string): Promise<Evidence[]> {
  for (const lang of ["ar", "en"]) {
    const pages = await queryWiki(lang + ".wikipedia.org", {
      generator: "search",
      gsrsearch: term,
      gsrlimit: "5",
      exintro: "1",
      prop: "extracts|info",
      explaintext: "1",
      exchars: "5000",
      exlimit: "5",
      inprop: "url",
    });
    const evidence = pages
      .filter((p: { extract?: string }) => p.extract?.trim())
      .map((p: { title: string; fullurl: string; extract: string }) => ({
        title: p.title,
        url: p.fullurl,
        text: p.extract,
      }));
    if (evidence.length) return evidence;
  }
  return [];
}

async function tavilyEvidence(term: string): Promise<Evidence[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
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
  return (data.results ?? [])
    .filter(
      (v: { url: string; content: string }) =>
        /^https?:\/\//i.test(v.url) && v.content?.trim(),
    )
    .map((v: { title: string; url: string; content: string }) => ({
      title: v.title,
      url: v.url,
      text: v.content.slice(0, 5000),
    }));
}

export async function information(
  term: string,
  source: SearchSource = "auto",
  ai?: { searchEvidence?: (q: string) => Promise<Evidence[]> },
): Promise<Evidence[]> {
  const merged: Evidence[] = [];
  const seen = new Set<string>();
  const pushAll = (items: Evidence[]) => {
    for (const item of items) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        merged.push(item);
      }
    }
  };

  if (source === "tavily") {
    return tavilyEvidence(term);
  }
  if (source === "wikipedia") {
    return wikipediaEvidence(term);
  }
  if (source === "google") {
    if (!ai?.searchEvidence) {
      throw new Error("بحث Google غير مهيأ");
    }
    return ai.searchEvidence(term);
  }

  // auto: Tavily (if configured) + Google Search Grounding (if Gemini configured) + Wikipedia fallback/supplement
  if (process.env.TAVILY_API_KEY) {
    try {
      pushAll(await tavilyEvidence(term));
    } catch {
      // fall through
    }
  }
  if (process.env.GEMINI_API_KEY && ai?.searchEvidence) {
    try {
      pushAll(await ai.searchEvidence(term));
    } catch {
      // fall back to Wikipedia if Gemini search fails
    }
  }
  if (merged.length < 2) {
    try {
      pushAll(await wikipediaEvidence(term));
    } catch {
      // ignore if Google/Tavily already returned results
    }
  }
  return merged;
}

export interface ImageHit {
  title: string;
  url: string;
  fallbackUrl?: string;
  origin: string;
  credit: string;
  license: string;
  provider?: "wikimedia" | "openverse";
}

async function wikimediaPictures(term: string): Promise<ImageHit[]> {
  const pages = await queryWiki("commons.wikimedia.org", {
    generator: "search",
    gsrsearch: term + " filetype:bitmap",
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "800",
  });
  return pages.flatMap(
    (p: { title: string; imageinfo?: Record<string, any>[] }) => {
      const i = p.imageinfo?.[0],
        m = i?.extmetadata;
      const primary = i?.thumburl || i?.url;
      if (!primary || !m?.LicenseShortName?.value) return [];
      return [
        {
          title: p.title.replace(/^File:/i, ""),
          url: primary,
          fallbackUrl: i?.url && i.url !== primary ? i.url : undefined,
          origin: i.descriptionurl,
          credit:
            String(m.Artist?.value || "Wikimedia Commons")
              .replace(/<[^>]+>/g, "")
              .trim() || "Wikimedia Commons",
          license: String(m.LicenseShortName.value),
          provider: "wikimedia" as const,
        },
      ];
    },
  );
}

async function openversePictures(term: string): Promise<ImageHit[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", term);
  url.searchParams.set("page_size", "8");
  url.searchParams.set("mature", "false");
  await paceHost("api.openverse.org", 250);
  const r = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return [];
  const data = (await r.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      thumbnail?: string;
      foreign_landing_url?: string;
      creator?: string;
      license?: string;
      license_version?: string;
    }>;
  };
  return (data.results ?? []).flatMap((item) => {
    const primary = item.thumbnail || item.url;
    const origin = item.foreign_landing_url || item.url;
    if (!primary || !origin || !/^https:\/\//i.test(primary)) return [];
    return [
      {
        title: item.title || term,
        url: primary,
        fallbackUrl: item.url && /^https:\/\//i.test(item.url) ? item.url : undefined,
        origin,
        credit: item.creator || "Openverse Contributor",
        license: item.license
          ? `${item.license.toUpperCase()}${item.license_version ? " " + item.license_version : ""}`
          : "CC",
        provider: "openverse" as const,
      },
    ];
  });
}

export async function pictures(
  term: string,
  source: "all" | "wikimedia" | "openverse" = "all",
): Promise<ImageHit[]> {
  const tasks: Promise<ImageHit[]>[] = [];
  if (source === "all" || source === "wikimedia") {
    tasks.push(wikimediaPictures(term).catch(() => []));
  }
  if (source === "all" || source === "openverse") {
    tasks.push(openversePictures(term).catch(() => []));
  }
  const settled = await Promise.all(tasks);
  const results: ImageHit[] = [];
  const seen = new Set<string>();
  // Interleave providers when both are present for resilience against single-host 429s
  const maxLen = Math.max(...settled.map((s) => s.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of settled) {
      const hit = list[i];
      if (hit && !seen.has(hit.url)) {
        seen.add(hit.url);
        results.push(hit);
      }
    }
  }
  return results;
}

async function fetchImageUrlWithRetry(targetUrl: string): Promise<Buffer> {
  const u = isSafePublicUrl(targetUrl);
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await paceHost(u.hostname, u.hostname === "upload.wikimedia.org" ? 450 : 250);
    const r = await fetch(u, {
      headers: headers(),
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });

    if (r.status === 429 || r.status === 503) {
      const retryAfterRaw = r.headers.get("retry-after");
      const retrySec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      const waitMs = Number.isFinite(retrySec)
        ? Math.min(8000, Math.max(800, retrySec * 1000))
        : 1200 * 2 ** attempt;
      hostCooldownUntil.set(u.hostname, Date.now() + waitMs);
      if (attempt < maxAttempts - 1 && (!Number.isFinite(retrySec) || retrySec <= 6)) {
        await sleep(waitMs);
        continue;
      }
      throw new Error(
        `بلغ تنزيل الصور من ${u.hostname} حد الطلبات (429).` +
          (retryAfterRaw ? " Retry-After: " + retryAfterRaw : ""),
      );
    }

    if (!r.ok || !r.body) {
      throw new Error("تعذر تنزيل الصورة " + r.status);
    }

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/") || ct.includes("svg")) {
      throw new Error("نوع الملف المسترجع ليس صورة صالحة: " + ct);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of r.body as any) {
      size += part.length;
      if (size > 10e6) throw new Error("صورة كبيرة جدًا");
      chunks.push(Buffer.from(part));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("تعذر تنزيل الصورة بعد عدة محاولات");
}

export async function downloadHit(hit: Pick<ImageHit, "url" | "fallbackUrl">) {
  try {
    return await fetchImageUrlWithRetry(hit.url);
  } catch (err) {
    if (hit.fallbackUrl && hit.fallbackUrl !== hit.url) {
      return await fetchImageUrlWithRetry(hit.fallbackUrl);
    }
    throw err;
  }
}
