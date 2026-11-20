import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
const blocked = new BlockList();
for (const [start, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(start, bits, "ipv4");
const cooldown = new Map<string, number>();
async function publicResource(
  raw: string,
  agent: string,
  media: RegExp,
  limit: number,
  timeout = 25000,
) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    isIP(url.hostname)
  )
    throw Error("رابط صورة غير مسموح");
  if ((cooldown.get(url.hostname) || 0) > Date.now())
    throw Error("مصدر الصور في فترة انتظار");
  const { address } = await lookup(url.hostname, { family: 4 });
  if (blocked.check(address, "ipv4")) throw Error("عنوان صورة محلي غير مسموح");
  return new Promise<Buffer>((resolve, reject) => {
    const req = request(
      url,
      {
        headers: { "User-Agent": agent },
        family: 4,
        lookup: (_host, _options, cb) => cb(null, address, 4),
        signal: AbortSignal.timeout(timeout),
      },
      (res) => {
        if (res.statusCode === 429) {
          const retry = String(res.headers["retry-after"] || "60");
          cooldown.set(
            url.hostname,
            Date.now() +
              Math.max(
                60000,
                Number.isFinite(Number(retry))
                  ? Number(retry) * 1000
                  : (Date.parse(retry) || 0) - Date.now(),
              ),
          );
        }
        if (
          res.statusCode !== 200 ||
          !media.test(String(res.headers["content-type"]))
        ) {
          res.destroy();
          reject(Error("تنزيل المصدر HTTP " + res.statusCode));
          return;
        }
        let size = 0;
        const parts: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            req.destroy(Error("استجابة كبيرة"));
            return;
          }
          parts.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(parts)));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export const publicImage = (url: string, agent: string) =>
  publicResource(url, agent, /^image\/(jpeg|png|webp|gif|avif)\b/i, 20e6);
export const publicArticle = (url: string, agent: string) =>
  publicResource(url, agent, /^text\/html\b/i, 2e6, 10000);
