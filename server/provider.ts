import { z } from "zod";
import {
  planSchema,
  type Candidate,
  type Evidence,
  type Level,
  type Provider,
} from "../shared/contracts";
import {
  buildImageParts,
  buildJsonSchemaForGemini,
  createGeminiClient,
  extractJsonText,
  getGeminiApiKey,
  isPaidApproved,
  mapGeminiError,
  resolveEliteModel,
  resolveEmbedModel,
  resolveFastModel,
  runPacedGeminiCall,
  thinkingConfigForModel,
} from "./gemini-client";
import { ProductionUnavailable } from "./production-state";

const candidate = z.object({
  question: z.string().min(5),
  answer: z.string().min(1),
  sourceIndex: z.number().int().nonnegative(),
  quote: z.string().min(10),
  imageQuery: z.string(),
});

export abstract class StructuredProvider implements Provider {
  protected abstract json<T>(
    instruction: string,
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<T>;
  structured<T>(instruction: string, input: unknown, schema: z.ZodType<T>) {
    return this.json(instruction, input, schema);
  }
  abstract embed(text: string): Promise<number[]>;
  abstract image(
    prompt: string,
    input?: Buffer,
    strength?: number,
  ): Promise<Buffer>;
  assistant(request: string) {
    return this.json(
      "You are an Arabic quiz production assistant. Suggest topics, plans and ways to improve questions. Do not present unverified facts as established. Return {reply:string}.",
      request,
      z.object({ reply: z.string().min(1) }),
    );
  }
  interpret(request: string) {
    return this.json(
      "استخرج الموضوع مع الموسم أو السنة بدقة. أعد {topic,easy,medium,hard,imagePercent}. مستويات 200 و400 و600 تعني سهل ومتوسط وصعب؛ النقاط ليست عدد الأسئلة. احترم الأعداد والأرقام العربية والنسب. وزع الإجمالي بالتساوي إن لم تحدد الصعوبة، الافتراضي سؤال لكل مستوى وبدون صور.",
      request,
      planSchema,
    );
  }
  draft(
    topic: string,
    level: Level,
    rules: string,
    sources: Evidence[],
    avoid: string[],
  ) {
    return this.json(
      "اكتب سؤال مسابقة عربيًا بإجابة واحدة ضمن الموضوع والنطاق والصعوبة والقواعد، من دليل متاح فقط. تجنب الأسئلة السابقة. أعد {question,answer,sourceIndex,quote,imageQuery}. sourceIndex صفر للبداية. quote اقتباس حرفي يدعم الجواب. imageQuery عبارة بحث من كلمتين إلى ست تُحدد الاسم الكامل للشخص أو الحدث والسنة إن كانت مهمة، بدون عبارات عامة مثل image أو photo.",
      { topic, level, rules, sources, avoid },
      candidate,
    );
  }
  async verify(topic: string, draft: Candidate, source: Evidence) {
    return (
      await this.json(
        'Verify that this Arabic question fits the specified topic, year and season, has a unique answer and is directly supported by the supplied passage. Reject ambiguous or unsupported claims. Return {"supported":boolean}.',
        { topic, draft, source },
        z.object({ supported: z.boolean() }),
      )
    ).supported;
  }
}

export class Gemini extends StructuredProvider {
  private ensureKey(): string {
    const key = getGeminiApiKey();
    if (!key)
      throw new Error(
        "أضف GEMINI_API_KEY أو MY_CUSTOM_GEMINI_KEY إلى بيئة الخادم",
      );
    return key;
  }

  protected async json<T>(
    instruction: string,
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const key = this.ensureKey();
    const model = resolveEliteModel();
    const ai = createGeminiClient(key);
    const shape = buildJsonSchemaForGemini(schema);
    const thinkingConfig = thinkingConfigForModel(model);
    try {
      const response = await runPacedGeminiCall(() =>
        ai.models.generateContent({
          model,
          contents: JSON.stringify(input),
          config: {
            systemInstruction:
              instruction +
              " Return JSON only matching schema: " +
              JSON.stringify(shape),
            responseMimeType: "application/json",
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
        }),
      );
      return schema.parse(JSON.parse(extractJsonText(response.text) || "null"));
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      throw mapGeminiError(error, model);
    }
  }

  interpret(request: string) {
    return this.jsonFast(
      "استخرج الموضوع مع الموسم أو السنة بدقة. أعد {topic,easy,medium,hard,imagePercent,imageMode?,audienceRegion?,audience?}. مستويات 200 و400 و600 تعني سهل ومتوسط وصعب؛ النقاط ليست عدد الأسئلة. احترم الأعداد والأرقام العربية والنسب. وزع الإجمالي بالتساوي إن لم تحدد الصعوبة، الافتراضي سؤال لكل مستوى وبدون صور.",
      request,
      planSchema,
    );
  }

  private async jsonFast<T>(
    instruction: string,
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const key = this.ensureKey();
    const model = resolveFastModel();
    const ai = createGeminiClient(key);
    const shape = buildJsonSchemaForGemini(schema);
    try {
      const response = await runPacedGeminiCall(() =>
        ai.models.generateContent({
          model,
          contents: JSON.stringify(input),
          config: {
            systemInstruction:
              instruction +
              " Return JSON only matching schema: " +
              JSON.stringify(shape),
            responseMimeType: "application/json",
          },
        }),
      );
      return schema.parse(JSON.parse(extractJsonText(response.text) || "null"));
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      throw mapGeminiError(error, model);
    }
  }

  async embed(text: string) {
    const key = this.ensureKey();
    const model = resolveEmbedModel();
    const ai = createGeminiClient(key);
    try {
      const r = await runPacedGeminiCall(() =>
        ai.models.embedContent({
          model,
          contents: text,
          config: {
            taskType: "SEMANTIC_SIMILARITY",
            outputDimensionality: 768,
          },
        }),
      );
      const values =
        (r as { embeddings?: { values?: number[] }[]; embedding?: { values?: number[] } })
          .embeddings?.[0]?.values ||
        (r as { embedding?: { values?: number[] } }).embedding?.values;
      return z.array(z.number()).min(2).parse(values);
    } catch (error) {
      throw mapGeminiError(error, model);
    }
  }

  async image(prompt: string, input?: Buffer) {
    if (!isPaidApproved()) {
      throw new ProductionUnavailable(
        "نماذج توليد وتعديل الصور (gemini-3.1-flash-lite-image) تتطلب مفتاح API مدفوعًا وموافقة صريحة.",
        "paid_image_model_required",
        402,
      );
    }
    const key = this.ensureKey();
    const model =
      process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
    const ai = createGeminiClient(key);
    try {
      const r = await runPacedGeminiCall(() =>
        ai.models.generateContent({
          model,
          contents: { parts: buildImageParts(prompt, input) },
        }),
      );
      const data = r.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data,
      )?.inlineData?.data;
      if (!data) throw new Error("لم يُرجع المزود صورة");
      return Buffer.from(data, "base64");
    } catch (error) {
      throw mapGeminiError(error, model);
    }
  }
}
