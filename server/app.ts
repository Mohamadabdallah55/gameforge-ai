import path from "node:path";
import { ChatGPTSession, ChatGPTError } from "./chatgpt-session";
import { chatGPTRoutes } from "./chatgpt-routes";
import { importChatQuestions } from "./chat-import";
import { QualityEngine } from "./quality-engine";
import { blockedImageOrigin } from "./image-policy";
import express from "express";
import { z } from "zod";
import { Store, uid } from "./store";
import { Worker } from "./worker";
import {
  artModes,
  planSchema,
  profileSchema,
  type Asset,
  type Provider,
} from "../shared/contracts";
import { embedModel, LocalProvider } from "./local";
import { EliteGemini } from "./elite-gemini";
import { ProductionUnavailable } from "./production-state";
import { engineStatus } from "./engines";
import { output, infer } from "./files";
import {
  information,
  pictures,
  imagePosts,
  persistSearch,
  downloadHit,
} from "./search";
import { artisticPrompts, transform, styles } from "./media";
export function createApp(db: Store, ai: Provider = new LocalProvider()) {
  persistSearch(db);
  const app = express();
  const api = express.Router();
  const planUsageEnabled = false;
  const requirePlanUsage = () => {
    if (!planUsageEnabled)
      throw new ChatGPTError(
        "الإنتاج التلقائي في Elite Intelligence يستخدم Gemini عند توفر مشروع مؤهل.",
        "chatgpt_plan_disabled",
        403,
      );
  };
  const chatgpt = new ChatGPTSession(
    path.resolve(
      process.env.SIWC_DATA_DIR ||
        path.join(process.env.DATA_DIR || "./data", ".siwc"),
    ),
  );
  const local = new LocalProvider();
  const gemini = new EliteGemini(local, db);
  const searchFacts = (term: string) => information(term, false);
  const elite = new QualityEngine(
    db,
    gemini,
    searchFacts,
    gemini.assessPicture.bind(gemini),
  );
  const worker = new Worker(
    db,
    local,
    searchFacts,
    "ollama:" + embedModel(),
    undefined,
    undefined,
    async (job) => {
      if (!job.production) {
        if (job.chatgpt) requirePlanUsage();
        throw new ProductionUnavailable(
          "هذه مهمة قديمة مرتبطة بمحركها الأصلي. أنشئ مهمة Gemini جديدة لاستعمال وضع Elite.",
          "legacy_engine",
        );
      }
      await gemini.ready(job.production.model);
      await elite.run(job, "ollama:" + embedModel());
    },
  );
  api.use((req, res, next) => {
    const origin = req.get("origin");
    if (
      (!process.env.HOST || process.env.HOST === "127.0.0.1") &&
      !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.get("host") || "")
    ) {
      res.sendStatus(403);
      return;
    }
    if (
      req.method !== "GET" &&
      origin &&
      new URL(origin).host !== req.get("host")
    ) {
      res.sendStatus(403);
      return;
    }
    next();
  });
  api.use(express.json({ limit: "20mb" }));
  api.use((q, r, next) => {
    if (q.body?.director === "chatgpt") requirePlanUsage();
    next();
  });
  api.use(
    "/chatgpt",
    chatGPTRoutes(chatgpt, planUsageEnabled, requirePlanUsage),
  );
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
  api.get("/health", (_, r) =>
    r.json({
      ok: true,
      provider: "gemini",
      chatgptPlanUsage: planUsageEnabled,
    }),
  );
  api.get("/engines", async (_, r) => r.json(await engineStatus(db, gemini)));
  api.get("/production/eligibility", async (_, r) => {
    await gemini.ready();
    r.json({ model: gemini.model });
  });
  api.post("/engines/restart", (q, r) => {
    const restart = z.enum(["ollama", "comfy", "searx"]).parse(q.body.engine);
    if (!process.send) {
      r.status(409).json({
        error: "شغّل المشروع عبر npm run local لإدارة المحركات",
      });
      return;
    }
    if (db.jobs().some((j) => j.status === "running")) {
      r.status(409).json({ error: "انتظر انتهاء المهمة الجارية" });
      return;
    }
    process.send({ restart });
    r.status(202).json({ restart });
  });
  api.post("/jobs/images", (q, r) => {
    const j = worker.enqueueImages(profile(q.body.profileId));
    r.status(202).json(j);
    void worker.drain();
  });
  api.get("/profiles", (_, r) => r.json(db.profiles()));
  api.post("/profiles", (q, r) => {
    const p = profileSchema.parse(q.body),
      k = uid();
    db.saveProfile(k, p);
    r.status(201).json({ id: k, ...p });
  });
  api.get("/questions", (q, r) =>
    r.json(
      db
        .questions(profile(q.query.profileId))
        .map((row) =>
          row.image && !db.canUseAsset(row.image)
            ? { ...row, image: null }
            : row,
        ),
    ),
  );
  api.post("/questions/from-chat", (q, r) => {
    const profileId = profile(q.body.profileId);
    const text = z.string().min(1).max(250_000).parse(q.body.text);
    r.status(201).json(importChatQuestions(db, profileId, text));
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
    if (
      assetId &&
      db
        .assets()
        .some((a) => a.id === assetId && blockedImageOrigin(a.origin, a.credit))
    )
      throw Error("لا يمكن إرفاق صورة مصدرها ويكيبيديا أو ويكيميديا");
    question.image = assetId;
    db.db
      .prepare("UPDATE questions SET body=? WHERE id=? AND profile=?")
      .run(JSON.stringify(question), question.id, pid);
    r.json(question);
  });
  const brief = z.object({
    request: term,
    director: z.enum(["local", "gemini"]).optional(),
    profileId: z.string().default("default"),
  });
  api.post("/interpret", async (q, r) => {
    const input = brief.parse(q.body);
    r.json(await ai.interpret(input.request));
  });
  api.post("/assistant", async (q, r) => {
    const input = brief.parse(q.body);
    r.json(await local.assistant(input.request));
  });
  api.post("/assets/from-search", async (q, r) => {
    const query = term.parse(q.body.query),
      origin = term.parse(q.body.origin);
    const hit = (await pictures(query)).find((h) => h.origin === origin);
    if (!hit) throw Error("انتهت نتيجة البحث. أعد البحث عن الصورة.");
    const meta = {
      id: uid(),
      origin: hit.origin,
      credit: hit.credit,
      license: hit.license,
      rightsStatus: "reusable" as const,
    };
    db.putAsset(meta, await transform(await downloadHit(hit), "original"));
    r.status(201).json(meta);
  });
  api.get("/search", async (q, r) => {
    const kind = z.enum(["facts", "images", "image-posts"]).parse(q.query.kind),
      t = term.parse(q.query.q);
    const search = {
      facts: searchFacts,
      images: pictures,
      "image-posts": imagePosts,
    };
    r.json(await search[kind](t));
  });
  api.get("/jobs/:id/quality", (q, r) => {
    if (!db.job(q.params.id)) {
      r.sendStatus(404);
      return;
    }
    r.json(db.qualityReport(q.params.id));
  });
  api.get("/jobs/:id/export/:format", async (q, r) => {
    const job = db.job(q.params.id);
    if (!job) {
      r.sendStatus(404);
      return;
    }
    const format = z
      .enum(["json", "csv", "xlsx", "zip"])
      .parse(q.params.format);
    r.attachment("gameforge-" + job.id + "." + format).send(
      await output(db, job.profileId, format, db.acceptedQuestions(job.id)),
    );
  });
  api.get("/jobs", (_, r) => r.json(db.jobs()));
  api.post("/jobs", async (q, r) => {
    if (q.body.director !== undefined && q.body.director !== "gemini")
      throw new ProductionUnavailable(
        "صياغة أسئلة Elite تحتاج إلى اختيار Gemini. تبقى وظائف Ollama المساعدة متاحة محليًا.",
        "unsupported_production_director",
        409,
      );
    const profileId = profile(q.body.profileId);
    const plan = planSchema.parse(q.body.plan);
    await gemini.ready();
    const j = worker.enqueue(
      profileId,
      { ...plan, eliteQuality: true },
      undefined,
      { provider: "gemini", model: gemini.model },
    );
    r.status(202).json(j);
    void worker.drain();
  });
  api.post("/jobs/:id/control", (q, r) => {
    const action = z.enum(["pause", "cancel"]).parse(q.body.action);
    const job = db.job(q.params.id);
    if (!job) {
      r.sendStatus(404);
      return;
    }
    const allowed =
      action === "pause"
        ? ["queued", "running"]
        : ["queued", "running", "paused", "failed"];
    if (!allowed.includes(job.status)) {
      r.status(409).json({
        error: "لا يمكن تطبيق الإجراء على حالة المهمة الحالية.",
      });
      return;
    }
    job.status = action === "pause" ? "paused" : "cancelled";
    job.error =
      action === "pause"
        ? "أوقفت المهمة مؤقتًا. حُفظ التقدم."
        : "أُلغيت المهمة. تبقى العناصر المحفوظة في المكتبة.";
    db.saveJob(job);
    r.json(job);
  });
  api.post("/jobs/:id/retry", async (q, r) => {
    const j = db.job(q.params.id);
    if (!j) {
      r.sendStatus(404);
      return;
    }
    if (j.status !== "failed" && j.status !== "paused") {
      r.status(409).json({ error: "المهمة ليست متوقفة" });
      return;
    }
    if (worker.finishing(j.id)) {
      r.status(409).json({ error: "انتظر انتهاء الطلب الجاري قبل الاستئناف." });
      return;
    }
    if (j.chatgpt) requirePlanUsage();
    if (!j.imageQuestionIds) {
      if (!j.production)
        throw new ProductionUnavailable(
          "أنشئ مهمة Gemini جديدة بدل إعادة تشغيل مهمة بمحرك قديم.",
          "legacy_engine",
        );
      await gemini.ready(j.production.model);
    }
    if (!["failed", "paused"].includes(db.job(j.id)?.status || "")) {
      r.status(409).json({ error: "تغيرت حالة المهمة. حدّث الصفحة." });
      return;
    }
    j.status = "queued";
    j.pauseCode = undefined;
    j.error = "";
    db.saveJob(j);
    r.status(202).json(j);
    void worker.drain();
  });
  api.get("/assets", (_, r) =>
    r.json(db.assets().filter((a) => !blockedImageOrigin(a.origin, a.credit))),
  );
  api.get("/assets/:id", (q, r) => {
    if (!db.canUseAsset(q.params.id)) {
      r.sendStatus(404);
      return;
    }
    const png = db.asset(q.params.id);
    if (!png) {
      r.sendStatus(404);
      return;
    }
    r.type("png").send(png);
  });
  const getAsset = (v: unknown) => {
    const k = id.parse(v),
      png = db.asset(k);
    if (!png) throw new Error("الصورة غير موجودة");
    if (
      db
        .assets()
        .some((a) => a.id === k && blockedImageOrigin(a.origin, a.credit))
    )
      throw Error("مصدر الصورة محظور");
    return png;
  };
  api.post("/assets", async (q, r) => {
    const input = z
      .object({
        data: encoded,
        rights: z.literal(true),
        credit: term,
        origin: term.default("upload"),
      })
      .parse(q.body);
    if (blockedImageOrigin(input.origin, input.credit))
      throw Error("مصدر الصورة محظور");
    const png = await transform(Buffer.from(input.data, "base64"), "original"),
      meta: Asset = {
        id: uid(),
        credit: input.credit,
        origin: input.origin,
        license: "user-authorized",
        rightsStatus: "user-authorized",
      };
    db.putAsset(meta, png);
    r.status(201).json(meta);
  });
  api.post("/assets/transform", async (q, r) => {
    const strength = z.number().min(0).max(1).optional().parse(q.body.strength);
    const normalized = z.number().min(0).max(1);
    const mask = z
      .object({
        x: normalized,
        y: normalized,
        width: normalized,
        height: normalized,
      })
      .optional()
      .parse(q.body.mask);
    const style = z.enum(styles).parse(q.body.style);
    const k = id.parse(q.body.assetId),
      png = await transform(getAsset(k), style, {
        strength,
        mask,
      });
    const source = db.assets().find((a) => a.id === k)!;
    const meta = {
      ...source,
      id: uid(),
      originalId: source.originalId || k,
      transformation: style,
    };
    db.putAsset(meta, png);
    r.status(201).json(meta);
  });
  api.post("/assets/generate", async (q, r) => {
    const input = z
      .object({
        prompt: z.string().trim().max(2000).default(""),
        assetId: id.optional(),
        style: z.enum(artModes).optional(),
        strength: z.number().min(0.15).max(0.85).default(0.4),
      })
      .parse(q.body);
    if (!input.prompt && !input.style)
      throw Error("أضف وصفًا أو اختر أسلوبًا فنيًا.");
    if (input.style && !input.assetId)
      throw Error("اختر صورة أصلية للتحويل الفني.");
    const source = input.assetId
      ? db.assets().find((a) => a.id === input.assetId)
      : null;
    const prompt = [
      input.style ? artisticPrompts[input.style] : "",
      input.assetId
        ? "Preserve the source composition, facial features, body pose, and significant details. No new people or text."
        : "",
      input.prompt,
    ]
      .filter(Boolean)
      .join(". ");
    const png = await transform(
      await local.image(
        prompt,
        input.assetId ? getAsset(input.assetId) : undefined,
        input.strength,
      ),
      "original",
    );
    const meta: Asset = {
      id: uid(),
      credit: source?.credit || "AI illustration",
      origin: source?.origin || "generated",
      license: source?.license || "AI-generated",
      rightsStatus: source?.rightsStatus || (source ? undefined : "generated"),
      originalId: source?.originalId || input.assetId,
      transformation: source ? input.style || "comfy-edit" : undefined,
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
  api.get("/export/:format", async (q, r) => {
    const f = z.enum(["json", "csv", "xlsx", "zip"]).parse(q.params.format);
    r.attachment("questions." + f).send(
      await output(db, profile(q.query.profileId), f),
    );
  });
  api.use((_, r) => r.status(404).json({ error: "مسار غير موجود" }));
  api.use(
    (
      e: Error,
      q: express.Request,
      r: express.Response,
      next: express.NextFunction,
    ) => {
      if (e instanceof ProductionUnavailable || e instanceof ChatGPTError) {
        r.status(e.status).json({
          error: e.message,
          code: e.code,
          requestId: e instanceof ChatGPTError ? e.requestId : undefined,
        });
        return;
      }
      r.status(
        e instanceof z.ZodError
          ? 400
          : /HTTP|Gemini|Wikimedia/.test(e.message)
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
