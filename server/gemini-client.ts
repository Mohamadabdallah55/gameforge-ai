import { GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { z } from "zod";
import { ProductionUnavailable } from "./production-state";

export const FREE_TEXT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
] as const;

export const PAID_TEXT_MODELS = [
  "gemini-4-neon",
  "gemini-4-carbon",
  "gemini-4-argon",
] as const;

export const PAID_IMAGE_MODELS = [
  "gemini-3.1-flash-lite-image",
  "gemini-nano-banana-2.1",
  "gemini-3-pro-image",
] as const;

export const EMBED_MODEL = "gemini-embedding-2";

const DEPRECATED_OR_INVALID = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-pro",
  "gemini-2.0-pro",
  "gemini-2.0-flash-thinking",
  "gemini-3.8-flash",
  "gemini-4-hydrogen",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-image",
  "gemini-embedding-001",
]);

export function getGeminiApiKeyCandidates(): {
  key: string;
  source: "MY_CUSTOM_GEMINI_KEY" | "GEMINI_API_KEY" | "API_KEY";
}[] {
  const out: { key: string; source: "MY_CUSTOM_GEMINI_KEY" | "GEMINI_API_KEY" | "API_KEY" }[] =
    [];
  const custom = process.env.MY_CUSTOM_GEMINI_KEY?.trim();
  const primary = process.env.GEMINI_API_KEY?.trim();
  const fallback = process.env.API_KEY?.trim();
  if (custom) out.push({ key: custom, source: "MY_CUSTOM_GEMINI_KEY" });
  if (primary && primary !== custom)
    out.push({ key: primary, source: "GEMINI_API_KEY" });
  if (fallback && fallback !== custom && fallback !== primary)
    out.push({ key: fallback, source: "API_KEY" });
  return out;
}

export function getGeminiApiKey(): string | undefined {
  return getGeminiApiKeyCandidates()[0]?.key;
}

export function getGeminiKeySource(): "MY_CUSTOM_GEMINI_KEY" | "GEMINI_API_KEY" | "API_KEY" | null {
  return getGeminiApiKeyCandidates()[0]?.source ?? null;
}

export function resolveEliteModel(): string {
  const configured = process.env.GEMINI_ELITE_MODEL?.trim();
  if (!configured || DEPRECATED_OR_INVALID.has(configured)) {
    return "gemini-2.5-flash";
  }
  return configured;
}

export function resolveFastModel(): string {
  const configured = process.env.GEMINI_FAST_MODEL?.trim();
  if (!configured || DEPRECATED_OR_INVALID.has(configured)) {
    return "gemini-2.5-flash-lite";
  }
  return configured;
}

export function resolveEmbedModel(): string {
  const configured = process.env.GEMINI_EMBED_MODEL?.trim();
  if (!configured || DEPRECATED_OR_INVALID.has(configured)) {
    return EMBED_MODEL;
  }
  return configured;
}

export function isPaidModel(model: string): boolean {
  return (
    (PAID_TEXT_MODELS as readonly string[]).includes(model) ||
    (PAID_IMAGE_MODELS as readonly string[]).includes(model)
  );
}

export function isPaidApproved(): boolean {
  return process.env.GEMINI_PAID_KEY_APPROVED === "1";
}

export function isGeminiSetupConfirmed(): boolean {
  return process.env.GEMINI_FREE_PROJECT_CONFIRMED !== "0";
}

export function assertAllowedModel(model: string) {
  if (DEPRECATED_OR_INVALID.has(model)) {
    throw new ProductionUnavailable(
      `النموذج ${model} غير مدعوم أو قديم. استخدم gemini-4-hydrogen أو gemini-3.1-flash-lite.`,
      "gemini_model_not_allowed",
    );
  }
  const allAllowed = new Set<string>([
    ...FREE_TEXT_MODELS,
    ...PAID_TEXT_MODELS,
    ...PAID_IMAGE_MODELS,
    EMBED_MODEL,
  ]);
  if (!allAllowed.has(model)) {
    throw new ProductionUnavailable(
      `اختر نموذج Gemini رسميًا مدعومًا من القائمة المعتمدة (${model}).`,
      "gemini_model_not_allowed",
    );
  }
  if (isPaidModel(model) && !isPaidApproved()) {
    throw new ProductionUnavailable(
      `النموذج ${model} يتطلب مفتاح API مدفوعًا وموافقة صريحة قبل التشغيل لتجنب أي رسوم غير متوقعة.`,
      "gemini_paid_approval_required",
      402,
    );
  }
}

export function createGeminiClient(apiKey?: string): GoogleGenAI {
  const key = apiKey || getGeminiApiKey();
  if (!key) {
    throw new ProductionUnavailable(
      "مفتاح Gemini API غير محفوظ على الخادم (GEMINI_API_KEY أو MY_CUSTOM_GEMINI_KEY).",
      "gemini_setup_required",
    );
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

let pacerTail = Promise.resolve();
let lastCallTimestamp = 0;

export function getMinDelayMs(): number {
  if (process.env.GEMINI_MIN_DELAY_MS !== undefined) {
    const parsed = Number(process.env.GEMINI_MIN_DELAY_MS);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
  }
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((a) => /\.test\.[cm]?[jt]s$/.test(a))
  ) {
    return 0;
  }
  return 3000;
}

export function resetGeminiPacerForTests() {
  lastCallTimestamp = 0;
}

export async function runPacedGeminiCall<T>(fn: () => Promise<T>): Promise<T> {
  const delayMs = getMinDelayMs();
  const task = pacerTail.then(async () => {
    if (delayMs > 0 && lastCallTimestamp > 0) {
      const wait = lastCallTimestamp + delayMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    try {
      return await fn();
    } finally {
      lastCallTimestamp = Date.now();
    }
  });
  pacerTail = task.then(
    () => {},
    () => {},
  );
  return task;
}

export function mapGeminiError(error: unknown, fallbackModel?: string): ProductionUnavailable {
  console.error("Gemini API Error Encountered:", error);
  if (error instanceof ProductionUnavailable) return error;
  const err = error as { status?: number; code?: number; message?: string };
  const status = err?.status || err?.code;
  const msg = String(err?.message || error || "");
  if (
    status === 429 ||
    /RESOURCE_EXHAUSTED|quota|rate.?limit|429/i.test(msg)
  ) {
    return new ProductionUnavailable(
      "بلغ Gemini حد الحصة أو معدل الطلبات (429). التفاصيل: " + msg.slice(0, 200),
      "gemini_quota",
      429,
    );
  }
  if (
    status === 401 ||
    status === 403 ||
    /PERMISSION_DENIED|API_KEY_INVALID|API key not valid|403|401/i.test(msg)
  ) {
    return new ProductionUnavailable(
      "مفتاح Gemini مرفوض أو يفتقر لصلاحية الوصول (401/403): " + msg.slice(0, 200),
      "gemini_access",
      status === 401 ? 401 : 403,
    );
  }
  if (status === 404 || /NOT_FOUND|not found|is not supported/i.test(msg)) {
    return new ProductionUnavailable(
      `النموذج ${fallbackModel || "المحدد"} غير متاح في المشروع الحالي (404): ` + msg.slice(0, 200),
      "gemini_model_not_allowed",
      404,
    );
  }
  if (status === 400 || /INVALID_ARGUMENT/i.test(msg)) {
    return new ProductionUnavailable(
      "طلب غير مقبول من Gemini (400): " + msg.slice(0, 200),
      "gemini_bad_request",
      400,
    );
  }
  if (typeof status === "number" && status >= 500) {
    return new ProductionUnavailable(
      `خدمة Gemini أعادت حالة HTTP ${status}: ` + msg.slice(0, 200),
      "gemini_request_failed",
      502,
    );
  }
  return new ProductionUnavailable(
    "تعذّر الاتصال بـ Gemini: " + (msg.slice(0, 200) || "خطأ شبكة"),
    "gemini_network",
    503,
  );
}

export function extractJsonText(raw: string | undefined): string {
  const trimmed = (raw || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export function buildJsonSchemaForGemini<T>(schema: z.ZodType<T>) {
  const { $schema: _, ...shape } = z.toJSONSchema(schema, {
    unrepresentable: "any",
  });
  return shape;
}

export function thinkingConfigForModel(model: string, deep = false) {
  if (model === "gemini-3.1-flash-lite") {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (model === "gemini-4-hydrogen" || model === "gemini-4-neon") {
    return { thinkingLevel: deep ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW };
  }
  return undefined;
}

export function buildImageParts(text: string, image?: Buffer): Part[] {
  const parts: Part[] = [{ text }];
  if (image) {
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: image.toString("base64"),
      },
    });
  }
  return parts;
}
