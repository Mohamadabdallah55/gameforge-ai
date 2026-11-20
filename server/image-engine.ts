import sharp from "sharp";
import { assessPixels, visionModel, ollama } from "./local";
import { downloadHit, pictures, articleBytes, sourceHost } from "./search";
import { articleText } from "./research";
import { uid, normalize } from "./store";
import { transform, type Style } from "./media";
import type { Asset } from "../shared/contracts";
import type { VisualAssessment } from "../shared/quality";
import { JobInterrupted, ProductionUnavailable } from "./production-state";
export interface ImageContext {
  question: string;
  answer: string;
  event: string;
  recognition: boolean;
  illustration?: boolean;
  transformed?: boolean;
  arabicQuery?: string;
  preferredSites?: string[];
}
export type PictureReviewer = (
  context: ImageContext,
  source: string,
  image: Buffer,
) => Promise<VisualAssessment>;
type PictureOptions = {
  review?: PictureReviewer;
  reviewed?: () => void;
  check?: () => void;
  edit?: (bytes: Buffer) => Promise<Buffer>;
};
export function pictureQueries(query: string, context: ImageContext) {
  return [
    ...new Set(
      [
        context.recognition ? context.answer : "",
        query,
        context.arabicQuery,
        context.event + " " + query,
      ].flatMap((value) => (value?.trim() ? [value.trim()] : [])),
    ),
  ];
}
export async function realPicture(
  query: string,
  edited: boolean | Style = false,
  context?: ImageContext,
  options: PictureOptions = {},
) {
  if (!options.review) {
    const model = visionModel();
    try {
      const { models } = await ollama("/api/tags");
      if (
        !models.some((m: { name: string }) =>
          [model, model + ":latest"].includes(m.name),
        )
      )
        throw Error("لم يُثبّت نموذج الرؤية " + model + "؛ بقي السؤال دون صورة");
    } catch {
      throw Error(
        "محرك تحليل الصور (Gemini Vision أو Ollama Vision) غير متصل حاليًا.",
      );
    }
  }
  const target = context || {
    question: "",
    answer: "",
    event: query,
    recognition: false,
  };
  const ranked: {
    meta: Asset;
    png: Buffer;
    visual: VisualAssessment;
    score: number;
    sourceContext: string;
  }[] = [];
  const review = async (png: Buffer, source: string, transformed = false) => {
    options.check?.();
    const preview = await sharp(png, { limitInputPixels: 24e6 })
      .resize(640, 640, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const result = await (options.review || assessPixels)(
      { ...target, ...(transformed ? { transformed } : {}) },
      source,
      preview,
    );
    options.reviewed?.();
    return result;
  };
  const usable = (result: VisualAssessment) =>
    result.eventMatch &&
    result.sourceMatch &&
    result.questionMatch &&
    !result.leaksAnswer &&
    !result.unwantedText &&
    result.value >= 80 &&
    result.quality >= 72;
  const reasons = new Set<string>(),
    checked = new Set<string>();
  const domains = new Set(
    (target.preferredSites || [])
      .map((host) =>
        sourceHost(host.includes("://") ? host : "https://" + host),
      )
      .filter(Boolean),
  );
  const preferred = (url: string) =>
    Number(
      [...domains].some(
        (domain) =>
          sourceHost(url) === domain || sourceHost(url).endsWith("." + domain),
      ),
    );
  for (const search of pictureQueries(query, target)) {
    options.check?.();
    const candidates = (await pictures(search)).sort(
      (a, b) => preferred(b.origin) - preferred(a.origin),
    );
    for (const hit of candidates
      .filter((h) => !checked.has(h.origin))
      .slice(0, 4)) {
      options.check?.();
      checked.add(hit.origin);
      try {
        const bytes = await downloadHit(hit);
        const pipeline = sharp(bytes, { limitInputPixels: 24e6 });
        const { width = 0, height = 0 } = await pipeline.metadata();
        if (Math.max(width, height) < 960 || Math.min(width, height) < 480) {
          reasons.add("الدقة أقل من الحد المطلوب");
          continue;
        }
        const sourceText =
          hit.publisherCaption ||
          articleText(await articleBytes(hit.origin), [
            search,
            ...(target.recognition ? [target.answer] : []),
            target.event,
          ]).slice(0, 950);
        const sourceContext = [hit.title, hit.description, sourceText]
          .filter(Boolean)
          .join("\n");
        if (!sourceText || normalize(sourceContext).length < 55) {
          reasons.add("لا يوجد سياق أو تعليق أصلي قابل للتحقق");
          continue;
        }
        const output = await transform(bytes, "original");
        const visual = await review(output, sourceContext);
        if (!usable(visual)) {
          reasons.add(visual.reason);
          continue;
        }
        ranked.push({
          png: output,
          meta: {
            id: uid(),
            origin: hit.origin,
            credit: hit.credit,
            license: hit.license,
            rightsStatus: "reusable",
          },
          visual,
          sourceContext,
          score:
            visual.value * 0.6 +
            visual.quality * 0.37 +
            Math.min(3, Math.max(width, height) / 1000),
        });
      } catch (e) {
        if (e instanceof ProductionUnavailable || e instanceof JobInterrupted)
          throw e;
        reasons.add((e as Error).message.slice(0, 240));
      }
    }
    if (ranked.length) break;
  }
  const style =
    typeof edited === "string" ? edited : edited ? "sketch" : "original";
  for (const candidate of ranked.sort((a, b) => b.score - a.score)) {
    const { sourceContext, ...image } = candidate;
    if (!options.edit && style === "original") return image;
    try {
      options.check?.();
      const png = options.edit
        ? await options.edit(image.png)
        : await transform(image.png, style);
      const visual = await review(png, sourceContext, true);
      if (usable(visual))
        return {
          ...image,
          meta: {
            ...image.meta,
            transformation: options.edit ? "comfy-edit" : style,
          },
          png,
          visual,
        };
      reasons.add(visual.reason);
    } catch (error) {
      if (
        error instanceof ProductionUnavailable ||
        error instanceof JobInterrupted
      )
        throw error;
      reasons.add((error as Error).message);
    }
  }
  throw Error(
    "لم نجد صورة مرخّصة مطابقة وقابلة للعرض لـ " +
      query +
      (reasons.size ? " · " + [...reasons].slice(0, 3).join(" | ") : ""),
  );
}
