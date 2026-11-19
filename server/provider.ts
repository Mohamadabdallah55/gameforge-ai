import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { z } from "zod";
import {
  planSchema,
  type Candidate,
  type Evidence,
  type ImageGenerateOptions,
  type Level,
  type Provider,
} from "../shared/contracts";
import type { Style } from "./media";

const candidateSchema = z.object({
  question: z.string().min(5),
  answer: z.string().min(1),
  sourceIndex: z.number().int().nonnegative(),
  quote: z.string().min(10),
  imageQuery: z.string(),
});

const batchSchema = z.array(candidateSchema);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatGeminiError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/GEMINI_API_KEY/.test(msg)) return new Error(msg);
  if (/API_KEY_INVALID|API key not valid/i.test(msg)) {
    return new Error(
      "مفتاح Gemini API غير صالح أو غير مفعّل. يرجى التحقق من GEMINI_API_KEY في إعدادات الأسرار.",
    );
  }
  if (/PERMISSION_DENIED|403/.test(msg)) {
    return new Error(
      "تم رفض الصلاحية من Gemini (403). تأكد من تفعيل الصلاحيات أو اختيار مفتاح مدفوع للنماذج المتقدمة.",
    );
  }
  if (/RESOURCE_EXHAUSTED|429/.test(msg)) {
    return new Error(
      "تم بلوغ حد الحصة في Gemini (429). انتظر قليلاً ثم استأنف أو استخدم مفتاحًا مدفوعًا.",
    );
  }
  if (/NOT_FOUND|404/.test(msg)) {
    return new Error("النموذج المطلوب غير متاح حاليًا.");
  }
  return new Error("تعذر إتمام طلب Gemini: " + msg.slice(0, 180));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        /429|500|502|503|504|ECONNRESET|ETIMEDOUT|RESOURCE_EXHAUSTED|fetch failed/i.test(
          msg,
        );
      if (!retryable || i === attempts - 1) break;
      await sleep(1000 * 2 ** i + Math.round(Math.random() * 400));
    }
  }
  throw formatGeminiError(last);
}

export function resolveGeminiKey(): string {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VERTEX_EXPRESS_API_KEY ||
    "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

export function buildGoogleGenAIOptions(apiKey: string) {
  const isExpress =
    apiKey.startsWith("AQ.") ||
    process.env.GOOGLE_GENAI_USE_ENTERPRISE === "true" ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";
  return {
    apiKey,
    ...(isExpress ? { enterprise: true } : {}),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  };
}

export class Gemini implements Provider {
  constructor(private customClient?: GoogleGenAI) {}

  get textModel() {
    const env = process.env.GEMINI_TEXT_MODEL;
    if (!env || env === "gemini-flash-latest") return "gemini-3.1-flash-lite";
    return env;
  }

  get fastThinkingConfig() {
    if (this.textModel === "gemini-3.1-flash-lite") {
      return { thinkingLevel: ThinkingLevel.MINIMAL };
    }
    if (this.textModel.startsWith("gemini-4-")) {
      return { thinkingLevel: ThinkingLevel.LOW };
    }
    return undefined;
  }

  get embedModel() {
    const env = process.env.GEMINI_EMBED_MODEL;
    if (!env || env === "gemini-embedding-001") return "gemini-embedding-2";
    return env;
  }

  get defaultImageModel(): NonNullable<ImageGenerateOptions["model"]> {
    const env = process.env.GEMINI_IMAGE_MODEL;
    if (env === "gemini-nano-banana-2.1" || env === "gemini-3.1-flash-lite-image") {
      return env;
    }
    return "gemini-3.1-flash-lite-image";
  }

  client(): GoogleGenAI {
    if (this.customClient) return this.customClient;
    const key = resolveGeminiKey();
    if (!key) throw new Error("أضف GEMINI_API_KEY إلى بيئة الخادم");
    return new GoogleGenAI(buildGoogleGenAIOptions(key));
  }

  async interpret(request: string) {
    const ai = this.client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: request,
        config: {
          thinkingConfig: this.fastThinkingConfig,
          systemInstruction:
            "استخرج الموضوع مع الموسم أو السنة بدقة من طلب المستخدم العربي. أعد JSON فقط بالصيغة المطلوبة. احترم الأعداد والأرقام العربية والنسب المئوية. وزع الإجمالي بالتساوي إن لم تحدد الصعوبة، والافتراضي سؤال واحد لكل مستوى وبدون صور.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              easy: { type: Type.INTEGER },
              medium: { type: Type.INTEGER },
              hard: { type: Type.INTEGER },
              imagePercent: { type: Type.INTEGER },
            },
            required: ["topic", "easy", "medium", "hard", "imagePercent"],
          },
        },
      }),
    );
    return planSchema.parse(JSON.parse(res.text ?? "null"));
  }

  async draft(
    topic: string,
    level: Level,
    rules: string,
    sources: Evidence[],
    avoid: string[],
  ): Promise<Candidate> {
    const ai = this.client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: JSON.stringify({ topic, level, rules, sources, avoid }),
        config: {
          thinkingConfig: this.fastThinkingConfig,
          systemInstruction:
            "اكتب سؤال مسابقة عربيًا احترافيًا بإجابة واحدة قاطعة ضمن الموضوع والنطاق الزمني ومستوى الصعوبة والقواعد المحددة، بالاعتماد على الأدلة المرفقة فقط. تجنب تكرار الأسئلة السابقة أو صياغاتها. يجب أن يكون quote اقتباسًا حرفيًا من نص المصدر المشار إليه في sourceIndex (يبدأ من 0) ويدعم الجواب مباشرة. imageQuery عبارة بحث إنجليزية قصيرة ودقيقة عن الصورة المناسبة للسؤال.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              answer: { type: Type.STRING },
              sourceIndex: { type: Type.INTEGER },
              quote: { type: Type.STRING },
              imageQuery: { type: Type.STRING },
            },
            required: ["question", "answer", "sourceIndex", "quote", "imageQuery"],
          },
        },
      }),
    );
    return candidateSchema.parse(JSON.parse(res.text ?? "null"));
  }

  async draftBatch(
    topic: string,
    level: Level,
    rules: string,
    sources: Evidence[],
    avoid: string[],
    count: number,
  ): Promise<Candidate[]> {
    const ai = this.client();
    const batchSize = Math.max(1, Math.min(8, count));
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: JSON.stringify({
          topic,
          level,
          count: batchSize,
          rules,
          sources,
          avoid,
        }),
        config: {
          thinkingConfig: this.fastThinkingConfig,
          systemInstruction: `اكتب ${batchSize} أسئلة مسابقات عربية مختلفة تمامًا عن بعضها وعن قائمة avoid، لكل سؤال إجابة واحدة قاطعة ومستوى صعوبة (${level}) ضمن الموضوع والقواعد، ومستندة حرفيًا إلى الأدلة المرفقة. يجب أن يكون quote اقتباسًا حرفيًا موجودًا نصًا داخل sources[sourceIndex].text. imageQuery عبارة بحث إنجليزية قصيرة ودقيقة للصورة المناسبة.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                answer: { type: Type.STRING },
                sourceIndex: { type: Type.INTEGER },
                quote: { type: Type.STRING },
                imageQuery: { type: Type.STRING },
              },
              required: [
                "question",
                "answer",
                "sourceIndex",
                "quote",
                "imageQuery",
              ],
            },
          },
        },
      }),
    );
    return batchSchema.parse(JSON.parse(res.text ?? "[]"));
  }

  async verify(topic: string, draft: Candidate, source: Evidence) {
    const ai = this.client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: JSON.stringify({ topic, draft, source }),
        config: {
          thinkingConfig: this.fastThinkingConfig,
          systemInstruction:
            "Verify that this Arabic trivia question strictly fits the specified topic, year, and season, has a single unambiguous answer, and is directly supported by the supplied passage. Reject ambiguous, multi-answer, or unsupported claims.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              supported: { type: Type.BOOLEAN },
            },
            required: ["supported"],
          },
        },
      }),
    );
    return z
      .object({ supported: z.boolean() })
      .parse(JSON.parse(res.text ?? "null")).supported;
  }

  async verifyWithSearch(
    topic: string,
    question: string,
    answer: string,
    quote: string,
  ): Promise<{ supported: boolean; note: string; sources: string[] }> {
    const ai = this.client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: `تحقق بدقة باستخدام البحث على Google من صحة سؤال المسابقة التالي وإجابته:
الموضوع: ${topic}
السؤال: ${question}
الإجابة المقترحة: ${answer}
الاقتباس المرفق: ${quote}

أجب أولاً بكلمة [صحيح] إذا كانت الإجابة دقيقة ومؤكدة ولا تحتمل اللبس، أو [ملاحظة] إذا كان هناك خطأ أو غموض أو إجابات متعددة، ثم اشرح السبب بإيجاز في سطر واحد بالعربية.`,
        config: {
          thinkingConfig: this.fastThinkingConfig,
          tools: [{ googleSearch: {} }],
        },
      }),
    );
    const text = (res.text ?? "").trim();
    const chunks =
      res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = chunks
      .map((c) => c.web?.uri)
      .filter((u): u is string => Boolean(u));
    const supported = text.includes("[صحيح]") && !text.includes("[ملاحظة]");
    return {
      supported,
      note: text.replace(/^\[(صحيح|ملاحظة)\]\s*/u, "").trim(),
      sources,
    };
  }

  async searchEvidence(term: string): Promise<Evidence[]> {
    const ai = this.client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: `ابحث عبر Google عن حقائق موثوقة ومفصلة باللغة العربية حول: "${term}".
اكتب 4 إلى 6 فقرات معلوماتية غنية بالحقائق الدقيقة (الأسماء الكاملة، التواريخ، الأرقام، النتائج، الملاعب، الألقاب، الأحداث المؤكدة) المناسبة لصياغة أسئلة مسابقات دقيقة، مع الالتزام بالمصادر الموثوقة.`,
        config: {
          thinkingConfig: this.fastThinkingConfig,
          tools: [{ googleSearch: {} }],
        },
      }),
    );

    const text = (res.text ?? "").trim();
    const meta = res.candidates?.[0]?.groundingMetadata;
    const chunks = meta?.groundingChunks ?? [];
    const supports = meta?.groundingSupports ?? [];

    const byIndex = new Map<number, string[]>();
    for (const sup of supports) {
      const seg = sup.segment?.text?.trim();
      if (!seg) continue;
      for (const idx of sup.groundingChunkIndices ?? []) {
        const list = byIndex.get(idx) ?? [];
        list.push(seg);
        byIndex.set(idx, list);
      }
    }

    const evidence: Evidence[] = [];
    const seenUrls = new Set<string>();

    chunks.forEach((chunk, idx) => {
      const url = chunk.web?.uri;
      const title = chunk.web?.title || term;
      if (!url || !/^https?:\/\//i.test(url) || seenUrls.has(url)) return;
      seenUrls.add(url);
      const linked = byIndex.get(idx)?.join(" ").trim();
      const passage = linked && linked.length >= 40 ? linked : text;
      if (passage) {
        evidence.push({
          title,
          url,
          text: passage.slice(0, 5000),
        });
      }
    });

    if (!evidence.length && text) {
      evidence.push({
        title: "Google Search: " + term,
        url: "https://www.google.com/search?q=" + encodeURIComponent(term),
        text: text.slice(0, 5000),
      });
    }

    return evidence;
  }

  async expandTopics(topic: string, totalQuestions: number): Promise<string[]> {
    const ai = this.client();
    const targetCount = Math.min(12, Math.max(2, Math.ceil(totalQuestions / 12)));
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: `الموضوع الرئيسي: "${topic}". أريد تقسيمه إلى ${targetCount} محاور بحث فرعية متخصصة ومتنوعة لتغطية ${totalQuestions} سؤال مسابقة دون تكرار.`,
        config: {
          thinkingConfig: this.fastThinkingConfig,
          systemInstruction:
            "أعد مصفوفة JSON من عبارات البحث العربية الدقيقة والمحددة زمنيًا وموضوعيًا لاستكشاف جوانب مختلفة من الموضوع الرئيسي.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      }),
    );
    const list = z.array(z.string().trim().min(2)).parse(JSON.parse(res.text ?? "[]"));
    return list.length ? list : [topic];
  }

  async embed(text: string): Promise<number[]> {
    const ai = this.client();
    const res = await withRetry(() =>
      ai.models.embedContent({
        model: this.embedModel,
        contents: text,
        config: {
          taskType: "SEMANTIC_SIMILARITY",
          outputDimensionality: 768,
        },
      }),
    );
    const values = res.embeddings?.[0]?.values;
    return z.array(z.number()).min(2).parse(values);
  }

  async image(
    prompt: string,
    input?: Buffer,
    options?: ImageGenerateOptions,
  ): Promise<Buffer> {
    const ai = this.client();
    const model = options?.model || this.defaultImageModel;
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (input) {
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: input.toString("base64"),
        },
      });
    }
    parts.push({ text: prompt });

    const isNanoBanana21 = model === "gemini-nano-banana-2.1";
    const imageConfig: Record<string, string> = {
      aspectRatio: options?.aspectRatio || "1:1",
    };
    if (isNanoBanana21 && options?.imageSize) {
      imageConfig.imageSize = options.imageSize;
    }

    const config: Record<string, unknown> = { imageConfig };
    if (isNanoBanana21 && options?.useSearch) {
      config.tools = [
        {
          googleSearch: {
            searchTypes: {
              webSearch: {},
              imageSearch: {},
            },
          },
        },
      ];
    }

    const res = await withRetry(() =>
      ai.models.generateContent({
        model,
        contents: { parts },
        config,
      }),
    );

    const outParts = res.candidates?.[0]?.content?.parts ?? [];
    for (const p of outParts) {
      if (p.inlineData?.data) {
        return Buffer.from(p.inlineData.data, "base64");
      }
    }
    throw new Error("لم يُرجع نموذج Gemini صورة في الاستجابة");
  }

  async transformImageAI(
    input: Buffer,
    style: Exclude<Style, "original">,
    subjectHint = "",
  ): Promise<Buffer> {
    const subject = subjectHint.trim()
      ? `The main subject is: ${subjectHint.trim()}. `
      : "";
    const prompts: Record<Exclude<Style, "original">, string> = {
      sketch: `${subject}Transform this exact photo into a clean hand-drawn graphite pencil sketch illustration on crisp white paper. Preserve exact facial likeness, silhouette, proportions, and key details. No text, no watermarks.`,
      bw: `${subject}Transform this exact photo into a high-contrast dramatic black-and-white monochrome editorial photograph with crisp tonal separation and studio lighting. Preserve exact subject likeness. No text.`,
      silhouette: `${subject}Isolate the main subject (person, athlete, landmark, or target object) completely from the background and render it as a pure solid flat black (#000000) silhouette centered on a pure solid white (#FFFFFF) background. Sharp clean edges, no background clutter, no gray shading, no text.`,
      cartoon: `${subject}Transform this exact photo into a vibrant, clean 2D cel-shaded cartoon game illustration with bold crisp dark ink outlines and flat stylized colors while preserving exact likeness and pose. No text or watermarks.`,
    };
    return this.image(prompts[style], input, {
      model: this.defaultImageModel,
      aspectRatio: "1:1",
    });
  }

  async auditImageRelevance(
    question: string,
    answer: string,
    imageBuffer: Buffer,
  ): Promise<{ relevant: boolean; hasSpoiler: boolean; note: string }> {
    const ai = this.client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: this.textModel,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: imageBuffer.toString("base64"),
              },
            },
            {
              text: `سؤال المسابقة: "${question}"
الإجابة الصحيحة: "${answer}"
افحص هذه الصورة وأجب بـ JSON:
- relevant: هل الصورة مرتبطة بموضوع السؤال أو الشخصية أو الهدف؟
- hasSpoiler: هل تحتوي الصورة على نص يكشف الإجابة مباشرة؟
- note: ملاحظة قصيرة بالعربية للمحرر.`,
            },
          ],
        },
        config: {
          thinkingConfig: this.fastThinkingConfig,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              relevant: { type: Type.BOOLEAN },
              hasSpoiler: { type: Type.BOOLEAN },
              note: { type: Type.STRING },
            },
            required: ["relevant", "hasSpoiler", "note"],
          },
        },
      }),
    );
    return z
      .object({
        relevant: z.boolean(),
        hasSpoiler: z.boolean(),
        note: z.string(),
      })
      .parse(JSON.parse(res.text ?? "null"));
  }
}
