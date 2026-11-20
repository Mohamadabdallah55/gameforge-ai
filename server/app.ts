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
  fields,
  levels,
  planSchema,
  profileSchema,
  type Asset,
  type Provider,
  type Question,
} from "../shared/contracts";
import {
  embedModel,
  LocalProvider,
  registerCloudTranslator,
  registerFallbackTranslator,
} from "./local";
import { EliteGemini } from "./elite-gemini";
import { WebExtractionProvider } from "./web-engine";
import { ProductionUnavailable } from "./production-state";
import { engineStatus } from "./engines";
import { output, infer } from "./files";
import {
  information,
  pictures,
  imagePosts,
  persistSearch,
  downloadHit,
  downloadAuthorizedWebImage,
  registerGroundedSearch,
} from "./search";
import { artisticPrompts, transform, styles } from "./media";
import {
  getGeminiApiKey,
  isGeminiSetupConfirmed,
  isPaidApproved,
} from "./gemini-client";
import {
  isCloudEnvironment,
  probeLoopbackService,
} from "./environment";
import { runQuestionFirewall } from "./quality-firewall";
import type { ResearchState } from "./research";

function isAllowedHost(rawHost: string): boolean {
  const host = rawHost.split(":")[0].toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".run.app") ||
    host.endsWith(".aistudio.google.com") ||
    host.endsWith(".googleusercontent.com") ||
    host.endsWith(".web.app")
  );
}

export function createApp(db: Store, ai?: Provider) {
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
  const webEngine = new WebExtractionProvider();
  const hasGemini = () => Boolean(getGeminiApiKey()) && isGeminiSetupConfirmed();
  const hasHealthyGemini = () => hasGemini() && !gemini.isDegraded();
  registerCloudTranslator((q) => gemini.translateQuery(q));
  registerFallbackTranslator((q) => webEngine.translateQuery(q));
  registerGroundedSearch((q) =>
    hasHealthyGemini() ? gemini.searchGroundedWeb(q) : Promise.resolve([]),
  );

  const searchFacts = (term: string) => information(term, false);
  const elite = new QualityEngine(
    db,
    gemini,
    searchFacts,
    gemini.assessPicture.bind(gemini),
  );
  const eliteWeb = new QualityEngine(
    db,
    webEngine,
    searchFacts,
    webEngine.assessPicture.bind(webEngine),
  );
  const activeEmbedModel = () =>
    hasHealthyGemini()
      ? "gemini:" + gemini.embedModelName + ":768"
      : webEngine.embedModelName;
  const worker = new Worker(
    db,
    local,
    searchFacts,
    activeEmbedModel(),
    undefined,
    undefined,
    async (job) => {
      if (!job.production) {
        if (job.chatgpt) requirePlanUsage();
        throw new ProductionUnavailable(
          "هذه مهمة قديمة مرتبطة بمحركها الأصلي. أنشئ مهمة إنتاج جديدة.",
          "legacy_engine",
        );
      }
      if (job.production.provider === "web-engine") {
        await eliteWeb.run(job, webEngine.embedModelName);
        return;
      }
      if (!hasHealthyGemini()) {
        job.production = {
          provider: "web-engine",
          model: webEngine.modelName,
        };
        db.saveJob(job);
        await eliteWeb.run(job, webEngine.embedModelName);
        return;
      }
      try {
        await gemini.ready(job.production.model);
        await elite.run(job, "gemini:" + gemini.embedModelName + ":768");
      } catch (err) {
        if (
          err instanceof ProductionUnavailable &&
          err.code !== "gemini_paid_approval_required"
        ) {
          gemini.markDegraded(err.message);
          job.production = {
            provider: "web-engine",
            model: webEngine.modelName,
          };
          db.saveJob(job);
          await eliteWeb.run(job, webEngine.embedModelName);
          return;
        }
        throw err;
      }
    },
    async (context, source, png) => {
      if (hasHealthyGemini()) {
        try {
          return await gemini.assessPicture(context, source, png);
        } catch (err) {
          if (err instanceof ProductionUnavailable) {
            gemini.markDegraded(err.message);
          }
        }
      }
      return webEngine.assessPicture(context, source, png);
    },
  );

  api.use((req, res, next) => {
    const reqHost = req.get("x-forwarded-host") || req.get("host") || "";
    const origin = req.get("origin");
    if (
      (!process.env.HOST || process.env.HOST === "127.0.0.1") &&
      reqHost &&
      !isAllowedHost(reqHost)
    ) {
      res.sendStatus(403);
      return;
    }
    if (req.method !== "GET" && origin) {
      try {
        const originHost = new URL(origin).host;
        const expectedHosts = [req.get("host"), req.get("x-forwarded-host")].filter(
          Boolean,
        );
        if (expectedHosts.length && !expectedHosts.includes(originHost)) {
          res.sendStatus(403);
          return;
        }
      } catch {
        res.sendStatus(403);
        return;
      }
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
    if (hasHealthyGemini()) {
      try {
        await gemini.ready();
        r.json({ model: gemini.model, provider: "gemini" });
        return;
      } catch (err) {
        if (err instanceof ProductionUnavailable) {
          gemini.markDegraded(err.message);
        }
      }
    }
    r.json({ model: webEngine.modelName, provider: "web-engine" });
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

  api.patch("/profiles/:id", (q, r) => {
    const k = profile(q.params.id);
    const p = profileSchema.parse(q.body);
    db.saveProfile(k, p);
    r.json({ id: k, ...p });
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

  api.post("/questions", async (q, r) => {
    const input = z
      .object({
        profileId: z.string().default("default"),
        question: term,
        answer: z.string().trim().min(1).max(300),
        difficulty: z.enum(levels).default("medium"),
        source: z.string().trim().max(1000).default("manual"),
        quote: z.string().trim().max(2000).default(""),
        image: z.union([id, z.null()]).optional().default(null),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    const existing = db.questions(pid);
    const fw = runQuestionFirewall({
      question: input.question,
      answer: input.answer,
      hasImage: Boolean(input.image),
      existingQuestions: existing,
    });
    if (!fw.passed) {
      r.status(422).json({ error: fw.reason, stage: fw.stage });
      return;
    }
    const vector = hasGemini()
      ? await gemini.embed(input.question).catch(() => webEngine.embed(input.question))
      : await webEngine.embed(input.question);
    const item: Question = {
      id: uid(),
      profileId: pid,
      question: input.question,
      answer: input.answer,
      difficulty: input.difficulty,
      source: input.source || "manual",
      quote: input.quote || "",
      image: input.image ?? null,
    };
    db.add(item, vector, activeEmbedModel());
    r.status(201).json(item);
  });

  api.patch("/questions/:id", async (q, r) => {
    const input = z
      .object({
        profileId: z.string().default("default"),
        question: term.optional(),
        answer: z.string().trim().min(1).max(300).optional(),
        difficulty: z.enum(levels).optional(),
        source: z.string().trim().max(1000).optional(),
        quote: z.string().trim().max(2000).optional(),
        image: z.union([id, z.null()]).optional(),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    const current = db.question(q.params.id, pid);
    if (!current) {
      r.sendStatus(404);
      return;
    }
    const next: Question = {
      ...current,
      question: input.question ?? current.question,
      answer: input.answer ?? current.answer,
      difficulty: input.difficulty ?? current.difficulty,
      source: input.source ?? current.source,
      quote: input.quote ?? current.quote,
      image: input.image !== undefined ? input.image : current.image,
    };
    const fw = runQuestionFirewall({
      question: next.question,
      answer: next.answer,
      hasImage: Boolean(next.image),
      existingQuestions: db.questions(pid).filter((item) => item.id !== current.id),
    });
    if (!fw.passed) {
      r.status(422).json({ error: fw.reason, stage: fw.stage });
      return;
    }
    const textChanged = next.question !== current.question;
    const vector = textChanged
      ? hasGemini()
        ? await gemini.embed(next.question).catch(() => webEngine.embed(next.question))
        : await webEngine.embed(next.question)
      : undefined;
    const saved = db.updateQuestion(
      current.id,
      pid,
      next,
      vector,
      vector ? activeEmbedModel() : undefined,
    );
    r.json(saved);
  });

  api.delete("/questions/:id", (q, r) => {
    const pid = profile(q.query.profileId || "default");
    if (!db.deleteQuestion(q.params.id, pid)) {
      r.sendStatus(404);
      return;
    }
    r.json({ deleted: true, id: q.params.id });
  });

  api.post("/questions/bulk-delete", (q, r) => {
    const input = z
      .object({
        profileId: z.string().default("default"),
        ids: z.array(id).min(1).max(1000),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    const removed = db.bulkDeleteQuestions(input.ids, pid);
    r.json({ removed });
  });

  api.post("/questions/check-quality", (q, r) => {
    const input = z
      .object({
        profileId: z.string().default("default"),
        question: z.string().trim(),
        answer: z.string().trim(),
        hasImage: z.boolean().optional(),
        excludeId: z.string().optional(),
      })
      .parse(q.body);
    const pid = profile(input.profileId);
    const existing = db
      .questions(pid)
      .filter((row) => row.id !== input.excludeId);
    r.json(
      runQuestionFirewall({
        question: input.question,
        answer: input.answer,
        hasImage: input.hasImage,
        existingQuestions: existing,
      }),
    );
  });

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
    director: z.enum(["auto", "local", "gemini", "web-engine"]).optional(),
    profileId: z.string().default("default"),
  });

  api.post("/interpret", async (q, r) => {
    const input = brief.parse(q.body);
    if (input.director === "local") {
      if (ai) {
        r.json(await ai.interpret(input.request));
        return;
      }
      if (await probeLoopbackService("OLLAMA_URL", 11434, "/api/tags")) {
        r.json(await local.interpret(input.request));
        return;
      }
    }
    if (ai && !hasHealthyGemini()) {
      r.json(await ai.interpret(input.request));
      return;
    }
    if (input.director !== "web-engine" && hasHealthyGemini()) {
      try {
        r.json(await gemini.interpret(input.request));
        return;
      } catch (err) {
        if (err instanceof ProductionUnavailable) {
          gemini.markDegraded(err.message);
        }
      }
    }
    r.json(await webEngine.interpret(input.request));
  });

  api.post("/assistant", async (q, r) => {
    const input = brief.parse(q.body);
    if (
      input.director === "local" &&
      (await probeLoopbackService("OLLAMA_URL", 11434, "/api/tags"))
    ) {
      r.json(await local.assistant(input.request));
      return;
    }
    const pid = profile(input.profileId);
    const prof = db.profile(pid)!;
    const profJobs = db
      .jobs()
      .filter((j) => j.profileId === pid)
      .slice(-5)
      .map((j) => ({
        id: j.id,
        topic: j.plan.topic,
        status: j.status,
        done: j.done,
      }));
    const context = {
      profileName: prof.name,
      profileRules: prof.rules,
      questionCount: db.questions(pid).length,
      assetCount: db.assets().length,
      activeJobs: profJobs,
      cloudMode: isCloudEnvironment(),
    };
    if (input.director !== "web-engine" && hasHealthyGemini()) {
      try {
        r.json(await gemini.copilot(input.request, context));
        return;
      } catch (err) {
        if (err instanceof ProductionUnavailable) {
          gemini.markDegraded(err.message);
        }
      }
    }
    r.json(await webEngine.copilot(input.request, context));
  });

  api.post("/assets/from-search", async (q, r) => {
    const query = term.parse(q.body.query),
      origin = term.parse(q.body.origin);
    const hit = (await pictures(query)).find((h) => h.origin === origin);
    if (!hit) throw Error("انتهت نتيجة البحث. أعد البحث عن الصورة.");
    const meta: Asset = {
      id: uid(),
      origin: hit.origin,
      credit: hit.credit,
      license: hit.license,
      rightsStatus: hit.rightsStatus === "attributed" ? "attributed" : "reusable",
    };
    db.putAsset(meta, await transform(await downloadHit(hit), "original"));
    r.status(201).json(meta);
  });

  api.post("/assets/from-web", async (q, r) => {
    const input = z
      .object({
        imgUrl: term,
        origin: term,
        title: z.string().trim().max(300).default("صورة ويب"),
        rightsConfirmed: z.literal(true),
      })
      .parse(q.body);
    const bytes = await downloadAuthorizedWebImage(input.imgUrl, input.origin);
    const png = await transform(bytes, "original");
    const meta: Asset = {
      id: uid(),
      origin: input.origin,
      credit: input.title,
      license: "user-authorized",
      rightsStatus: "user-authorized",
    };
    db.putAsset(meta, png);
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

  api.get("/jobs/:id/research", (q, r) => {
    const job = db.job(q.params.id);
    if (!job) {
      r.sendStatus(404);
      return;
    }
    const state = db.researchState<ResearchState>(job.id);
    r.json({
      jobId: job.id,
      topic: job.plan.topic,
      map: state?.map || null,
      facts: (state?.facts || []).map((f) => ({
        id: f.id,
        event: f.event,
        entity: f.entity,
        fact: f.fact,
        answer: f.answer,
        facet: f.facet,
        bestLevel: f.bestLevel,
        importance: f.importance,
        surprise: f.surprise,
        audienceReason: f.audienceReason,
        sourceLabel: f.sourceLabel,
        sourceUrl: f.source.url,
        sourceTitle: f.source.title,
      })),
      errors: state?.errors || [],
    });
  });

  api.get("/audits", (q, r) => {
    const pid = profile(q.query.profileId || "default");
    r.json(db.profileAudits(pid));
  });

  api.get("/export/preview", (q, r) => {
    const pid = profile(q.query.profileId || "default");
    const prof = db.profile(pid)!;
    const jobId = typeof q.query.jobId === "string" && q.query.jobId ? q.query.jobId : undefined;
    const qs = jobId ? db.acceptedQuestions(jobId) : db.questions(pid);
    const headers = fields.map((f) => prof.mapping[f] ?? f);
    const assetMap = new Map(
      db
        .assets()
        .filter((a) => !blockedImageOrigin(a.origin, a.credit))
        .map((a) => [a.id, a]),
    );
    const rows = qs.map((row) => {
      const asset = row.image ? assetMap.get(row.image) : undefined;
      return {
        id: row.id,
        difficulty: row.difficulty,
        mapped: Object.fromEntries(
          fields.map((f, idx) => [
            headers[idx],
            f === "image"
              ? asset
                ? "images/" + asset.id + ".png"
                : ""
              : row[f],
          ]),
        ),
        imageId: asset?.id ?? null,
        imageLicense: asset?.license ?? null,
        score: row.quality?.score ?? null,
        source: row.source,
      };
    });
    r.json({
      profileName: prof.name,
      headers,
      total: rows.length,
      withImages: rows.filter((x) => x.imageId).length,
      rows,
    });
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
    if (
      q.body.director !== undefined &&
      q.body.director !== "auto" &&
      q.body.director !== "gemini" &&
      q.body.director !== "web-engine"
    )
      throw new ProductionUnavailable(
        "صياغة أسئلة Elite تستخدم محرك الاستخراج الذكي السحابي أو Gemini.",
        "unsupported_production_director",
        409,
      );
    const profileId = profile(q.body.profileId);
    const plan = planSchema.parse(q.body.plan);
    if (q.body.director === "gemini" && !hasGemini()) {
      await gemini.ready();
    }
    let useGemini =
      q.body.director !== "web-engine" && hasHealthyGemini();
    if (useGemini) {
      try {
        await gemini.ready();
      } catch (err) {
        if (q.body.director === "gemini" && !hasGemini()) throw err;
        useGemini = false;
      }
    }
    const j = worker.enqueue(
      profileId,
      { ...plan, eliteQuality: true },
      undefined,
      useGemini
        ? { provider: "gemini", model: gemini.model }
        : { provider: "web-engine", model: webEngine.modelName },
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
          "أنشئ مهمة إنتاج جديدة بدل إعادة تشغيل مهمة بمحرك قديم.",
          "legacy_engine",
        );
      if (j.production.provider === "gemini") {
        let canUseGemini = hasHealthyGemini();
        if (canUseGemini) {
          try {
            await gemini.ready(j.production.model);
          } catch {
            canUseGemini = false;
          }
        }
        if (!canUseGemini) {
          j.production = {
            provider: "web-engine",
            model: webEngine.modelName,
          };
        }
      }
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

    const comfyReachable = await probeLoopbackService(
      "COMFY_URL",
      8188,
      "/system_stats",
    );
    const rawImage = comfyReachable
      ? await local.image(
          prompt,
          input.assetId ? getAsset(input.assetId) : undefined,
          input.strength,
        )
      : await gemini.image(
          prompt,
          input.assetId ? getAsset(input.assetId) : undefined,
          input.strength,
        );

    const png = await transform(rawImage, "original");
    const meta: Asset = {
      id: uid(),
      credit: source?.credit || (comfyReachable ? "ComfyUI" : "Gemini Image"),
      origin: source?.origin || "generated",
      license: source?.license || "AI-generated",
      rightsStatus: source?.rightsStatus || (source ? undefined : "generated"),
      originalId: source?.originalId || input.assetId,
      transformation: source
        ? input.style || (comfyReachable ? "comfy-edit" : "gemini-edit")
        : undefined,
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
