import express from "express";
import { z } from "zod";
import {
  fields,
  levels,
  planSchema,
  profileSchema,
  searchSources,
  type Provider,
  type Question,
} from "../shared/contracts";
import { runAssistantTurn } from "./assistant";
import { auditLibrary } from "./audit";
import { infer, output } from "./files";
import { styles, transform } from "./media";
import { Gemini, resolveGeminiKey } from "./provider";
import { downloadHit, information, pictures } from "./search";
import { Store, uid } from "./store";
import { Worker } from "./worker";

export function createApp(db: Store, ai: Provider = new Gemini()) {
  const app = express(),
    worker = new Worker(db, ai);
  const api = express.Router();

  api.use((req, res, next) => {
    const origin = req.get("origin");
    const host = req.get("x-forwarded-host") || req.get("host");
    if (
      req.method !== "GET" &&
      origin &&
      host &&
      new URL(origin).host !== host
    ) {
      res.sendStatus(403);
      return;
    }
    next();
  });

  api.use(express.json({ limit: "20mb" }));

  const term = z.string().trim().min(1).max(2000);
  const id = z.string().regex(/^(default|[0-9a-f-]{36})$/);
  const profile = (v: unknown) => {
    const k = id.parse(v);
    if (!db.profile(k)) throw new Error("ملف اللعبة غير موجود");
    return k;
  };
  const encoded = z
    .string()
    .min(4)
    .max(16e6)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/);

  const getAsset = (v: unknown) => {
    const k = id.parse(v),
      png = db.asset(k);
    if (!png) throw new Error("الصورة غير موجودة");
    return png;
  };

  api.get("/health", (_, r) => {
    const gemini = ai instanceof Gemini ? ai : undefined;
    const key = resolveGeminiKey();
    r.json({
      ok: true,
      geminiConfigured: Boolean(key),
      models: {
        text: gemini?.textModel ?? "custom",
        embed: gemini?.embedModel ?? "custom",
        image: gemini?.defaultImageModel ?? "custom",
      },
      sqlite: db.healthCheck(),
    });
  });

  api.get("/profiles", (_, r) => r.json(db.profiles()));

  api.post("/profiles", (q, r) => {
    const p = profileSchema.parse(q.body),
      k = uid();
    db.saveProfile(k, p);
    r.status(201).json({ id: k, ...p });
  });

  api.patch("/profiles/:id", (q, r) => {
    const k = profile(q.params.id);
    const p = profileSchema.parse(q.body);
    db.saveProfile(k, p);
    r.json({ id: k, ...p });
  });

  api.delete("/profiles/:id", (q, r) => {
    const k = profile(q.params.id);
    db.deleteProfile(k);
    r.json({ deleted: true, id: k });
  });

  api.get("/questions", (q, r) =>
    r.json(db.questions(profile(q.query.profileId))),
  );

  const safeEmbed = async (text: string): Promise<number[]> => {
    if (!resolveGeminiKey()) return [1, 0];
    try {
      return await ai.embed(text);
    } catch {
      return [1, 0];
    }
  };

  api.post("/questions", async (q, r) => {
    const input = z
      .object({
        profileId: z.string(),
        question: z.string().trim().min(3).max(2000),
        answer: z.string().trim().min(1).max(1000),
        difficulty: z.enum(levels),
        source: z.string().trim().max(2000).default("https://gameforge.local"),
        quote: z.string().trim().max(4000).default(""),
        image: z.union([id, z.null()]).optional(),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    if (input.image && !db.asset(input.image)) {
      throw new Error("الصورة غير موجودة");
    }
    const vec = await safeEmbed(input.question);
    if (db.duplicate(pid, input.question, vec)) {
      throw new Error("يوجد سؤال مشابه أو مكرر في هذا الملف");
    }
    const item: Question = {
      id: uid(),
      profileId: pid,
      question: input.question,
      answer: input.answer,
      difficulty: input.difficulty,
      source: input.source || "https://gameforge.local",
      quote: input.quote || input.answer,
      image: input.image ?? null,
      auditStatus: "pending",
      updatedAt: new Date().toISOString(),
    };
    db.add(item, vec);
    r.status(201).json(item);
  });

  api.patch("/questions/:id", async (q, r) => {
    const input = z
      .object({
        profileId: z.string(),
        question: z.string().trim().min(3).max(2000).optional(),
        answer: z.string().trim().min(1).max(1000).optional(),
        difficulty: z.enum(levels).optional(),
        source: z.string().trim().max(2000).optional(),
        quote: z.string().trim().max(4000).optional(),
        image: z.union([id, z.null()]).optional(),
        auditStatus: z.enum(["pending", "verified", "flagged"]).optional(),
        auditNote: z.string().max(2000).optional(),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    const existing = db.question(pid, q.params.id);
    if (!existing) {
      r.sendStatus(404);
      return;
    }
    if (input.image && !db.asset(input.image)) {
      throw new Error("الصورة غير موجودة");
    }
    const updated: Question = {
      ...existing,
      question: input.question ?? existing.question,
      answer: input.answer ?? existing.answer,
      difficulty: input.difficulty ?? existing.difficulty,
      source: input.source ?? existing.source,
      quote: input.quote ?? existing.quote,
      image: input.image !== undefined ? input.image : existing.image,
      auditStatus: input.auditStatus ?? existing.auditStatus,
      auditNote: input.auditNote ?? existing.auditNote,
      updatedAt: new Date().toISOString(),
    };
    let vec: number[] | undefined;
    if (input.question && input.question !== existing.question) {
      vec = await safeEmbed(updated.question);
    }
    db.updateQuestion(pid, updated, vec);
    r.json(updated);
  });

  api.delete("/questions/:id", (q, r) => {
    const pid = profile(q.query.profileId ?? q.body?.profileId);
    const ok = db.deleteQuestion(pid, q.params.id);
    if (!ok) {
      r.sendStatus(404);
      return;
    }
    r.json({ deleted: true, id: q.params.id });
  });

  api.post("/questions/bulk", (q, r) => {
    const input = z
      .object({
        profileId: z.string(),
        ids: z.array(id).min(1),
        action: z.enum([
          "delete",
          "clear-image",
          "set-difficulty",
          "mark-verified",
        ]),
        difficulty: z.enum(levels).optional(),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    let affected = 0;
    db.transaction(() => {
      for (const qid of input.ids) {
        if (input.action === "delete") {
          if (db.deleteQuestion(pid, qid)) affected++;
        } else {
          const item = db.question(pid, qid);
          if (!item) continue;
          if (input.action === "clear-image") item.image = null;
          if (input.action === "set-difficulty" && input.difficulty)
            item.difficulty = input.difficulty;
          if (input.action === "mark-verified") item.auditStatus = "verified";
          item.updatedAt = new Date().toISOString();
          db.updateQuestion(pid, item);
          affected++;
        }
      }
    });
    r.json({ affected });
  });

  api.post("/questions/:id/image", (q, r) => {
    const pid = profile(q.body.profileId),
      question = db.questions(pid).find((v) => v.id === q.params.id);
    if (!question) {
      r.sendStatus(404);
      return;
    }
    const assetId = z.union([id, z.null()]).parse(q.body.assetId);
    if (assetId && !db.asset(assetId)) throw new Error("الصورة غير موجودة");
    question.image = assetId;
    question.updatedAt = new Date().toISOString();
    db.db
      .prepare("UPDATE questions SET body=? WHERE id=? AND profile=?")
      .run(JSON.stringify(question), question.id, pid);
    r.json(question);
  });

  api.post("/questions/audit", async (q, r) => {
    const input = z
      .object({
        profileId: z.string(),
        verifyFactsWithSearch: z.boolean().default(false),
        verifyImages: z.boolean().default(false),
        maxDeepChecks: z.number().int().min(1).max(25).default(10),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    const gemini = ai instanceof Gemini ? ai : undefined;
    const report = await auditLibrary(db, pid, gemini, input);
    r.json(report);
  });

  api.post("/questions/reindex", async (q, r) => {
    const pid = profile(q.body.profileId);
    const list = db.questions(pid);
    for (const item of list) {
      const vec = await ai.embed(item.question);
      db.updateQuestionVector(pid, item.id, vec);
    }
    if (ai instanceof Gemini) {
      db.setMeta("embed_model", ai.embedModel);
    }
    r.json({ reindexed: list.length });
  });

  api.post("/interpret", async (q, r) =>
    r.json(await ai.interpret(term.parse(q.body.request))),
  );

  api.get("/search", async (q, r) => {
    const kind = z.enum(["facts", "images"]).parse(q.query.kind),
      t = term.parse(q.query.q);
    if (kind === "facts") {
      const source = z
        .enum(searchSources)
        .default("auto")
        .parse(q.query.source ?? "auto");
      const gemini = ai instanceof Gemini ? ai : undefined;
      r.json(await information(t, source, gemini));
      return;
    }
    const imgSource = z
      .enum(["all", "wikimedia", "openverse"])
      .default("all")
      .parse(q.query.source ?? "all");
    r.json(await pictures(t, imgSource));
  });

  api.get("/jobs", (_, r) => r.json(db.jobs()));

  api.post("/jobs", (q, r) => {
    const j = worker.enqueue(
      profile(q.body.profileId),
      planSchema.parse(q.body.plan),
    );
    r.status(202).json(j);
    void worker.drain();
  });

  api.post("/jobs/:id/pause", (q, r) => {
    const j = db.job(q.params.id);
    if (!j) {
      r.sendStatus(404);
      return;
    }
    if (j.status !== "queued" && j.status !== "running") {
      r.status(409).json({ error: "المهمة ليست قيد التشغيل" });
      return;
    }
    j.status = "paused";
    j.stage = "paused";
    db.saveJob(j);
    r.json(j);
  });

  api.post("/jobs/:id/resume", (q, r) => {
    const j = db.job(q.params.id);
    if (!j) {
      r.sendStatus(404);
      return;
    }
    if (j.status !== "paused" && j.status !== "failed") {
      r.status(409).json({ error: "المهمة ليست متوقفة" });
      return;
    }
    j.status = "queued";
    j.error = "";
    j.stage = "queued";
    db.saveJob(j);
    r.status(202).json(j);
    void worker.drain();
  });

  api.post("/jobs/:id/retry", (q, r) => {
    const j = db.job(q.params.id);
    if (!j) {
      r.sendStatus(404);
      return;
    }
    if (j.status !== "failed" && j.status !== "paused") {
      r.status(409).json({ error: "المهمة ليست متوقفة" });
      return;
    }
    j.status = "queued";
    j.error = "";
    j.stage = "queued";
    db.saveJob(j);
    r.status(202).json(j);
    void worker.drain();
  });

  api.get("/assets", (_, r) => r.json(db.assets()));

  api.get("/assets/:id", (q, r) => {
    const png = db.asset(q.params.id);
    if (!png) {
      r.sendStatus(404);
      return;
    }
    r.type("png").send(png);
  });

  api.post("/assets", async (q, r) => {
    const input = z
      .object({
        data: encoded,
        rights: z.literal(true),
        credit: term,
        origin: term.default("upload"),
      })
      .parse(q.body);
    const png = await transform(Buffer.from(input.data, "base64"), "original"),
      meta = {
        id: uid(),
        credit: input.credit,
        origin: input.origin,
        license: "user-authorized",
      };
    db.putAsset(meta, png);
    r.status(201).json(meta);
  });

  api.post("/assets/import-url", async (q, r) => {
    const input = z
      .object({
        url: z.string().url(),
        fallbackUrl: z.string().url().optional(),
        origin: z.string().trim().min(1).max(1000),
        credit: z.string().trim().min(1).max(500),
        license: z.string().trim().min(1).max(200),
      })
      .parse(q.body);
    const cached = db.getCachedAssetByUrl(input.url);
    if (cached && db.asset(cached.id)) {
      r.status(200).json(cached);
      return;
    }
    const raw = await downloadHit({
      url: input.url,
      fallbackUrl: input.fallbackUrl,
    });
    const png = await transform(raw, "original");
    const meta = {
      id: uid(),
      origin: input.origin,
      credit: input.credit,
      license: input.license,
    };
    db.putAsset(meta, png);
    db.cacheAssetUrl(input.url, meta.id);
    r.status(201).json(meta);
  });

  api.post("/assets/transform", async (q, r) => {
    const input = z
      .object({
        assetId: id,
        style: z.enum(styles),
        mode: z.enum(["local", "ai"]).default("local"),
        subjectHint: z.string().max(300).optional(),
      })
      .parse(q.body);
    const rawBuf = getAsset(input.assetId);
    let png: Buffer;
    if (input.mode === "ai" && input.style !== "original") {
      if (!(ai instanceof Gemini)) {
        throw new Error("التحويل بالذكاء الاصطناعي يتطلب مزود Gemini");
      }
      const aiRaw = await ai.transformImageAI(
        rawBuf,
        input.style,
        input.subjectHint,
      );
      png = await transform(aiRaw, "original");
    } else {
      png = await transform(rawBuf, input.style);
    }
    const source = db.assetMeta(input.assetId)!;
    const meta = {
      ...source,
      id: uid(),
      origin: `${source.origin} · ${input.style}${input.mode === "ai" ? " (AI)" : ""}`,
    };
    db.putAsset(meta, png);
    r.status(201).json(meta);
  });

  api.post("/assets/generate", async (q, r) => {
    const input = z
      .object({
        prompt: term,
        assetId: id.optional(),
        model: z
          .enum(["gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"])
          .optional(),
        aspectRatio: z
          .enum(["1:1", "3:4", "4:3", "9:16", "16:9"])
          .optional(),
        imageSize: z.enum(["1K", "2K", "4K"]).optional(),
        useSearch: z.boolean().optional(),
      })
      .parse(q.body);
    const source = input.assetId ? db.assetMeta(input.assetId) : null;
    const png = await transform(
      await ai.image(
        input.prompt,
        input.assetId ? getAsset(input.assetId) : undefined,
        {
          model: input.model,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          useSearch: input.useSearch,
        },
      ),
      "original",
    );
    const meta = {
      id: uid(),
      credit: source?.credit || "Gemini (" + (input.model || "flash-lite-image") + ")",
      origin: source?.origin || "generated",
      license: source?.license || "AI-generated",
    };
    db.putAsset(meta, png);
    r.status(201).json(meta);
  });

  api.post("/templates/infer", async (q, r) =>
    r.json(
      await infer(
        z.enum(["json", "csv", "xlsx"]).parse(q.body.format),
        Buffer.from(encoded.parse(q.body.data), "base64"),
      ),
    ),
  );

  api.get("/export/:format/preview", (q, r) => {
    const pid = profile(q.query.profileId);
    const prof = db.profile(pid)!;
    const qs = db.questions(pid);
    const headers = fields.map((f) => prof.mapping[f] ?? f);
    const rows = qs.slice(0, 12).map((item) =>
      Object.fromEntries(
        fields.map((f, idx) => [
          headers[idx],
          f === "image"
            ? item.image
              ? "images/" + item.image + ".png"
              : ""
            : item[f],
        ]),
      ),
    );
    const missingAssets = qs.filter(
      (item) => item.image && !db.asset(item.image),
    ).length;
    const usedAssets = new Set(qs.map((item) => item.image).filter(Boolean));
    r.json({
      profileName: prof.name,
      totalQuestions: qs.length,
      illustratedCount: qs.filter((item) => item.image).length,
      usedAssetsCount: usedAssets.size,
      missingAssets,
      headers,
      sampleRows: rows,
    });
  });

  api.get("/export/:format", async (q, r) => {
    const f = z.enum(["json", "csv", "xlsx", "zip"]).parse(q.params.format);
    r.attachment("questions." + f).send(
      await output(db, profile(q.query.profileId), f),
    );
  });

  api.get("/assistant/history", (q, r) => {
    const pid = profile(q.query.profileId);
    r.json(db.assistantHistory(pid));
  });

  api.delete("/assistant/history", (q, r) => {
    const pid = profile(q.query.profileId);
    db.clearAssistantHistory(pid);
    r.json({ cleared: true });
  });

  api.post("/assistant/chat", async (q, r) => {
    const input = z
      .object({
        profileId: z.string(),
        message: z.string().trim().min(1).max(4000),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    if (!(ai instanceof Gemini)) {
      throw new Error("المساعد الذكي يتطلب مزود Gemini");
    }
    const result = await runAssistantTurn(db, ai, worker, pid, input.message);
    r.json(result);
  });

  api.use((_, r) => r.status(404).json({ error: "مسار غير موجود" }));

  api.use(
    (
      e: Error,
      q: express.Request,
      r: express.Response,
      next: express.NextFunction,
    ) => {
      r.status(
        e instanceof z.ZodError
          ? 400
          : /HTTP|Gemini|Wikimedia|Google/.test(e.message)
            ? 502
            : 400,
      ).json({
        error:
          e instanceof z.ZodError
            ? e.issues.map((i) => i.path.join(".") + " " + i.message).join(", ")
            : e.message,
      });
    },
  );

  app.use("/api", api);
  return { app, worker };
}
