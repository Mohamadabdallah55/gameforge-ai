import { parseDocument, DomUtils } from "htmlparser2";
import { blockedImageOrigin } from "./image-policy";
interface LicensedImage {
  license: string;
  credit: string;
  description: string;
}
const cc = (url: string) => {
  try {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      !["creativecommons.org", "www.creativecommons.org"].includes(u.hostname)
    )
      return "";
    const parts = u.pathname.split("/").filter(Boolean);
    if (
      parts[0] === "licenses" &&
      ["by", "by-sa"].includes(parts[1]) &&
      /^\d+\.\d+$/.test(parts[2] || "")
    )
      return parts[1] + " " + parts[2];
    if (parts[0] === "publicdomain" && parts[1] === "zero") return "cc0";
    if (parts[0] === "publicdomain" && parts[1] === "mark") return "PDM";
  } catch {}
  return "";
};
export function publisherLicense(
  html: string,
  original: string,
  article: string,
): LicensedImage | undefined {
  const wanted = new URL(original).href;
  const doc = parseDocument(html);
  for (const script of DomUtils.getElementsByTagName("script", doc.children)) {
    if (script.attribs.type !== "application/ld+json") continue;
    let data: unknown;
    try {
      data = JSON.parse(DomUtils.textContent(script));
    } catch {
      continue;
    }
    const queue = [data];
    for (let i = 0; i < queue.length && i < 300; i++) {
      const node = queue[i];
      if (!node || typeof node !== "object") continue;
      const img = node as Record<string, unknown>;
      queue.push(
        ...Object.values(img).filter((v) => v && typeof v === "object"),
      );
      if (![img["@type"]].flat().includes("ImageObject")) continue;
      const candidate = img.contentUrl || img.url;
      if (typeof candidate !== "string" || typeof img.license !== "string")
        continue;
      let canonical: string;
      try {
        canonical = new URL(candidate, article).href;
      } catch {
        continue;
      }
      if (canonical !== wanted) continue;
      const license = cc(img.license);
      const credit = String(
        img.creditText ||
          img.copyrightNotice ||
          (img.creator as { name?: string } | undefined)?.name ||
          "",
      );
      const description = String(img.caption || img.description || "");
      if (
        license &&
        credit &&
        !blockedImageOrigin(canonical, credit, description, article)
      )
        return { license, credit, description };
    }
  }
}
