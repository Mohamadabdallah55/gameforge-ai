import {
  Type,
  type Content,
  type FunctionDeclaration,
} from "@google/genai";
import {
  planSchema,
  profileSchema,
  type AssistantActionLog,
  type Level,
  type Question,
} from "../shared/contracts";
import { auditLibrary } from "./audit";
import { transform, styles, type Style } from "./media";
import { resolveGeminiKey, type Gemini } from "./provider";
import { downloadHit, information, pictures } from "./search";
import { Store, uid } from "./store";
import type { Worker } from "./worker";

export interface CopilotHints {
  switchTab?: string;
  selectProfileId?: string;
  selectAssetId?: string;
  downloadUrl?: string;
  refreshAll: boolean;
}

const declarations: FunctionDeclaration[] = [
  {
    name: "get_workspace_overview",
    description:
      "جلب ملخص كامل عن ملفات الألعاب والمهام الجارية وعدد الأسئلة والوسائط في المنصة.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "create_game_profile",
    description: "إنشاء ملف لعبة جديد بقواعد صياغة وربط حقول مخصص والتبديل إليه.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "اسم اللعبة" },
        rules: { type: Type.STRING, description: "قواعد صياغة الأسئلة" },
        questionField: { type: Type.STRING },
        answerField: { type: Type.STRING },
        difficultyField: { type: Type.STRING },
        imageField: { type: Type.STRING },
        sourceField: { type: Type.STRING },
      },
      required: ["name"],
    },
  },
  {
    name: "switch_profile",
    description: "التبديل إلى ملف لعبة آخر باستخدام المعرف أو الاسم.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        profileIdOrName: { type: Type.STRING },
      },
      required: ["profileIdOrName"],
    },
  },
  {
    name: "start_production_job",
    description:
      "إنشاء وبدء مهمة إنتاج أسئلة (بما في ذلك الإنتاج الجماعي لعشرات أو مئات الأسئلة والصور) في الملف النشط.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: "الموضوع والبطولة أو الموسم بدقة" },
        easy: { type: Type.INTEGER, description: "عدد الأسئلة السهلة (0-500)" },
        medium: { type: Type.INTEGER, description: "عدد الأسئلة المتوسطة (0-500)" },
        hard: { type: Type.INTEGER, description: "عدد الأسئلة الصعبة (0-500)" },
        imagePercent: {
          type: Type.INTEGER,
          description: "نسبة الأسئلة المصورة من 0 إلى 100",
        },
        searchSource: {
          type: Type.STRING,
          description: "مصدر البحث: auto أو google أو wikipedia أو tavily",
        },
        imageStrategy: {
          type: Type.STRING,
          description:
            "استراتيجية الصور: real_then_ai أو real_only أو ai_only",
        },
      },
      required: ["topic", "easy", "medium", "hard", "imagePercent"],
    },
  },
  {
    name: "manage_job",
    description: "عرض حالة المهام أو إيقاف مهمة مؤقتًا أو استئناف مهمة متوقفة.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "list أو pause أو retry",
        },
        jobId: { type: Type.STRING, description: "معرف المهمة عند الإيقاف أو الاستئناف" },
      },
      required: ["action"],
    },
  },
  {
    name: "search_facts",
    description: "البحث الحي في Google أو ويكيبيديا عن حقائق موثوقة لموضوع محدد.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        source: {
          type: Type.STRING,
          description: "auto أو google أو wikipedia",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_and_import_image",
    description:
      "البحث عن صور حقيقية مرخصة في Wikimedia Commons وOpenverse، وحفظ أفضل نتيجة في مكتبة الوسائط وربطها بسؤال عند الطلب.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "عبارة البحث بالإنجليزية أو العربية" },
        importTop: {
          type: Type.BOOLEAN,
          description: "هل يتم تنزيل الصورة الأولى وحفظها في مكتبة الوسائط؟",
        },
        attachToQuestionId: {
          type: Type.STRING,
          description: "معرف السؤال لربط الصورة به اختياريًا",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "generate_or_edit_image",
    description:
      "توليد صورة جديدة أو تعديل صورة موجودة في المكتبة باستخدام أحدث نماذج Gemini.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: "وصف الصورة أو التعديل" },
        assetId: { type: Type.STRING, description: "معرف صورة حالية للتعديل عليها اختياريًا" },
        model: {
          type: Type.STRING,
          description: "gemini-3.1-flash-lite-image أو gemini-nano-banana-2.1",
        },
        aspectRatio: {
          type: Type.STRING,
          description: "1:1 أو 4:3 أو 16:9 أو 3:4 أو 9:16",
        },
        attachToQuestionId: {
          type: Type.STRING,
          description: "معرف سؤال لربط الصورة الناتجة به اختياريًا",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "transform_image_style",
    description:
      "تحويل صورة لاعب أو هدف أو مشهد إلى sketch أو bw أو silhouette أو cartoon محليًا أو بالذكاء الاصطناعي.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        assetId: { type: Type.STRING, description: "معرف الصورة في المكتبة" },
        style: {
          type: Type.STRING,
          description: "sketch أو bw أو silhouette أو cartoon",
        },
        mode: {
          type: Type.STRING,
          description: "local (فوري عبر Sharp) أو ai (عزل ذكي عبر Gemini)",
        },
        subjectHint: {
          type: Type.STRING,
          description: "وصف العنصر المطلوب عزله في وضع ai مثل: football player",
        },
        attachToQuestionId: { type: Type.STRING },
      },
      required: ["assetId", "style"],
    },
  },
  {
    name: "manage_questions",
    description:
      "عرض الأسئلة، أو تعديل سؤال وإجابته وصورته، أو إضافة سؤال يدوي، أو حذف سؤال.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "list أو create أو update أو delete",
        },
        questionId: { type: Type.STRING },
        question: { type: Type.STRING },
        answer: { type: Type.STRING },
        difficulty: { type: Type.STRING, description: "easy أو medium أو hard" },
        quote: { type: Type.STRING },
        source: { type: Type.STRING },
        assetId: { type: Type.STRING },
        searchFilter: { type: Type.STRING },
      },
      required: ["action"],
    },
  },
  {
    name: "run_audit",
    description:
      "تدقيق مكتبة الأسئلة الحالية لاكتشاف التكرار الدلالي وفحص المصادر والصور.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        verifyFactsWithSearch: {
          type: Type.BOOLEAN,
          description: "هل يتم التحقق العميق عبر بحث Google؟",
        },
        verifyImages: {
          type: Type.BOOLEAN,
          description: "هل يتم فحص تطابق الصور عبر Gemini؟",
        },
      },
    },
  },
  {
    name: "prepare_export",
    description: "تجهيز رابط التصدير بصيغة json أو csv أو xlsx أو zip للملف النشط.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        format: { type: Type.STRING, description: "json أو csv أو xlsx أو zip" },
      },
      required: ["format"],
    },
  },
];

export async function runAssistantTurn(
  db: Store,
  ai: Gemini,
  worker: Worker,
  initialProfileId: string,
  userMessage: string,
) {
  let activeProfileId = initialProfileId;
  const actions: AssistantActionLog[] = [];
  const hints: CopilotHints = { refreshAll: true };

  db.addAssistantMessage(activeProfileId, "user", userMessage);

  const history = db.assistantHistory(activeProfileId);
  const contents: Content[] = history.slice(-14).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const profile = db.profile(activeProfileId);
  const systemInstruction = `أنت المساعد الذكي لمنصة GameForge AI لإنتاج محتوى ألعاب المسابقات.
تتحدث العربية باحترافية واختصار ووضوح، وتتحكم فعليًا في جميع أدوات المنصة عبر استدعاء الدوال (Function Calling).
لا تخترع نتائج أو أرقامًا؛ استدعِ الدوال المناسبة للتنفيذ الفعلي وأبلغ المستخدم بما تم بدقة.
حالة الجلسة الحالية:
- الملف النشط: ${profile?.name ?? "غير محدد"} (id: ${activeProfileId})
- عدد الأسئلة في الملف النشط: ${db.questions(activeProfileId).length}
- إجمالي الصور في المكتبة: ${db.assets().length}`;

  const client = ai.client();

  async function executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      switch (name) {
        case "get_workspace_overview": {
          const profiles = db.profiles();
          const qs = db.questions(activeProfileId);
          const jobs = db.jobs().filter((j) => j.profileId === activeProfileId);
          const assets = db.assets();
          actions.push({
            tool: name,
            summary: `استعراض حالة المنصة (${qs.length} سؤال، ${assets.length} صورة)`,
            ok: true,
          });
          return {
            activeProfileId,
            profiles: profiles.map((p) => ({
              id: p.id,
              name: p.name,
              rules: p.rules,
              questionsCount: db.questions(p.id).length,
            })),
            activeQuestionsCount: qs.length,
            recentQuestions: qs.slice(-8).map((q) => ({
              id: q.id,
              question: q.question,
              answer: q.answer,
              difficulty: q.difficulty,
              image: q.image,
              auditStatus: q.auditStatus,
            })),
            jobs: jobs.slice(-8),
            assetsCount: assets.length,
            recentAssets: assets.slice(0, 8),
          };
        }

        case "create_game_profile": {
          const mapping: Record<string, string> = {};
          if (args.questionField) mapping.question = String(args.questionField);
          if (args.answerField) mapping.answer = String(args.answerField);
          if (args.difficultyField)
            mapping.difficulty = String(args.difficultyField);
          if (args.imageField) mapping.image = String(args.imageField);
          if (args.sourceField) mapping.source = String(args.sourceField);
          const parsed = profileSchema.parse({
            name: String(args.name || ""),
            rules: String(args.rules || ""),
            mapping,
          });
          const id = uid();
          db.saveProfile(id, parsed);
          activeProfileId = id;
          hints.selectProfileId = id;
          hints.switchTab = "production";
          actions.push({
            tool: name,
            summary: `إنشاء ملف اللعبة "${parsed.name}"`,
            ok: true,
          });
          return { id, ...parsed };
        }

        case "switch_profile": {
          const target = String(args.profileIdOrName || "").trim();
          const found = db
            .profiles()
            .find((p) => p.id === target || p.name.includes(target));
          if (!found) {
            throw new Error("لم يُعثر على ملف لعبة مطابق لـ " + target);
          }
          activeProfileId = found.id;
          hints.selectProfileId = found.id;
          actions.push({
            tool: name,
            summary: `التبديل إلى "${found.name}"`,
            ok: true,
          });
          return { activeProfileId: found.id, name: found.name };
        }

        case "start_production_job": {
          const plan = planSchema.parse({
            topic: String(args.topic || ""),
            easy: Number(args.easy ?? 0),
            medium: Number(args.medium ?? 0),
            hard: Number(args.hard ?? 0),
            imagePercent: Number(args.imagePercent ?? 0),
            searchSource: args.searchSource || "auto",
            imageStrategy: args.imageStrategy || "real_only",
          });
          const job = worker.enqueue(activeProfileId, plan);
          void worker.drain();
          hints.switchTab = "production";
          const total = plan.easy + plan.medium + plan.hard;
          actions.push({
            tool: name,
            summary: `بدء إنتاج ${total} سؤال عن "${plan.topic}"`,
            ok: true,
          });
          return job;
        }

        case "manage_job": {
          const action = String(args.action || "list");
          if (action === "list") {
            const list = db.jobs().filter((j) => j.profileId === activeProfileId);
            actions.push({
              tool: name,
              summary: `عرض ${list.length} مهام`,
              ok: true,
            });
            return list.slice(-10);
          }
          const jobId = String(args.jobId || "");
          const job = db.job(jobId);
          if (!job) throw new Error("المهمة غير موجودة");
          if (action === "pause") {
            job.status = "paused";
            job.stage = "paused";
            db.saveJob(job);
            actions.push({
              tool: name,
              summary: `إيقاف المهمة "${job.plan.topic}" مؤقتًا`,
              ok: true,
            });
            return job;
          }
          if (action === "retry") {
            job.status = "queued";
            job.error = "";
            db.saveJob(job);
            void worker.drain();
            actions.push({
              tool: name,
              summary: `استئناف المهمة "${job.plan.topic}"`,
              ok: true,
            });
            return job;
          }
          throw new Error("إجراء غير معروف للمهمة");
        }

        case "search_facts": {
          const q = String(args.query || "").trim();
          const source =
            args.source === "google" || args.source === "wikipedia"
              ? args.source
              : "auto";
          const res = await information(q, source, ai);
          hints.switchTab = "search";
          actions.push({
            tool: name,
            summary: `بحث عن "${q}" (${res.length} نتائج)`,
            ok: true,
          });
          return res.slice(0, 5);
        }

        case "search_and_import_image": {
          const q = String(args.query || "").trim();
          const hits = await pictures(q);
          if (!hits.length) {
            actions.push({
              tool: name,
              summary: `لم توجد صور لـ "${q}"`,
              ok: false,
            });
            return { hits: [] };
          }
          let importedAsset: { id: string; credit: string; license: string } | undefined;
          if (args.importTop !== false) {
            for (const hit of hits.slice(0, 4)) {
              try {
                const raw = await downloadHit(hit);
                const png = await transform(raw, "original");
                const meta = {
                  id: uid(),
                  credit: hit.credit,
                  origin: hit.origin,
                  license: hit.license,
                };
                db.putAsset(meta, png);
                db.cacheAssetUrl(hit.url, meta.id);
                importedAsset = meta;
                hints.selectAssetId = meta.id;
                hints.switchTab = "media";
                if (args.attachToQuestionId) {
                  const qItem = db.question(
                    activeProfileId,
                    String(args.attachToQuestionId),
                  );
                  if (qItem) {
                    qItem.image = meta.id;
                    db.updateQuestion(activeProfileId, qItem);
                  }
                }
                break;
              } catch {
                continue;
              }
            }
          }
          actions.push({
            tool: name,
            summary: importedAsset
              ? `استيراد صورة حقيقية لـ "${q}"`
              : `العثور على ${hits.length} صور لـ "${q}"`,
            ok: true,
          });
          return {
            importedAsset,
            hits: hits.slice(0, 5),
          };
        }

        case "generate_or_edit_image": {
          const prompt = String(args.prompt || "").trim();
          const sourceAssetId = args.assetId ? String(args.assetId) : undefined;
          const inputBuf = sourceAssetId ? db.asset(sourceAssetId) : undefined;
          if (sourceAssetId && !inputBuf) {
            throw new Error("الصورة الأصلية غير موجودة");
          }
          const model =
            args.model === "gemini-nano-banana-2.1"
              ? "gemini-nano-banana-2.1"
              : "gemini-3.1-flash-lite-image";
          const raw = await ai.image(prompt, inputBuf, {
            model,
            aspectRatio: (args.aspectRatio as any) || "1:1",
          });
          const png = await transform(raw, "original");
          const meta = {
            id: uid(),
            credit: "Gemini (" + model + ")",
            origin: sourceAssetId ? "edited:" + sourceAssetId.slice(0, 6) : "generated",
            license: "AI-generated",
          };
          db.putAsset(meta, png);
          hints.selectAssetId = meta.id;
          hints.switchTab = "media";
          if (args.attachToQuestionId) {
            const qItem = db.question(
              activeProfileId,
              String(args.attachToQuestionId),
            );
            if (qItem) {
              qItem.image = meta.id;
              db.updateQuestion(activeProfileId, qItem);
            }
          }
          actions.push({
            tool: name,
            summary: sourceAssetId
              ? `تعديل صورة عبر ${model}`
              : `توليد صورة جديدة عبر ${model}`,
            ok: true,
          });
          return meta;
        }

        case "transform_image_style": {
          const assetId = String(args.assetId || "");
          const input = db.asset(assetId);
          if (!input) throw new Error("الصورة غير موجودة");
          const style = String(args.style || "sketch") as Style;
          if (!styles.includes(style) || style === "original") {
            throw new Error("تأثير غير مدعوم");
          }
          const mode = args.mode === "ai" ? "ai" : "local";
          const resultBuf =
            mode === "ai"
              ? await ai.transformImageAI(
                  input,
                  style,
                  String(args.subjectHint || ""),
                )
              : await transform(input, style);
          const png = await transform(resultBuf, "original");
          const sourceMeta = db.assetMeta(assetId);
          const meta = {
            id: uid(),
            credit: sourceMeta?.credit || "GameForge",
            origin: `${sourceMeta?.origin || "asset"} (${style})`,
            license: sourceMeta?.license || "transformed",
          };
          db.putAsset(meta, png);
          hints.selectAssetId = meta.id;
          hints.switchTab = "media";
          if (args.attachToQuestionId) {
            const qItem = db.question(
              activeProfileId,
              String(args.attachToQuestionId),
            );
            if (qItem) {
              qItem.image = meta.id;
              db.updateQuestion(activeProfileId, qItem);
            }
          }
          actions.push({
            tool: name,
            summary: `تحويل الصورة إلى ${style} (${mode === "ai" ? "ذكاء اصطناعي" : "محلي"})`,
            ok: true,
          });
          return meta;
        }

        case "manage_questions": {
          const action = String(args.action || "list");
          if (action === "list") {
            let list = db.questions(activeProfileId);
            const filter = String(args.searchFilter || "").trim();
            if (filter) {
              list = list.filter(
                (q) =>
                  q.question.includes(filter) || q.answer.includes(filter),
              );
            }
            hints.switchTab = "library";
            actions.push({
              tool: name,
              summary: `عرض ${list.length} سؤال في المكتبة`,
              ok: true,
            });
            return list.slice(0, 20);
          }
          if (action === "create") {
            const qText = String(args.question || "").trim();
            const aText = String(args.answer || "").trim();
            if (!qText || !aText) throw new Error("يلزم نص السؤال والإجابة");
            const vec = resolveGeminiKey()
              ? await ai.embed(qText)
              : [1, 0];
            if (db.duplicate(activeProfileId, qText, vec)) {
              throw new Error("يوجد سؤال مشابه بالفعل");
            }
            const item: Question = {
              id: uid(),
              profileId: activeProfileId,
              question: qText,
              answer: aText,
              difficulty: (args.difficulty as Level) || "medium",
              source: String(args.source || "https://gameforge.local"),
              quote: String(args.quote || aText),
              image: args.assetId ? String(args.assetId) : null,
              auditStatus: "pending",
              updatedAt: new Date().toISOString(),
            };
            db.add(item, vec);
            hints.switchTab = "library";
            actions.push({
              tool: name,
              summary: `إضافة سؤال جديد: "${qText.slice(0, 35)}"`,
              ok: true,
            });
            return item;
          }
          if (action === "update") {
            const qid = String(args.questionId || "");
            const existing = db.question(activeProfileId, qid);
            if (!existing) throw new Error("السؤال غير موجود");
            const updated: Question = {
              ...existing,
              question: args.question ? String(args.question) : existing.question,
              answer: args.answer ? String(args.answer) : existing.answer,
              difficulty: args.difficulty
                ? (args.difficulty as Level)
                : existing.difficulty,
              quote: args.quote ? String(args.quote) : existing.quote,
              source: args.source ? String(args.source) : existing.source,
              image:
                args.assetId !== undefined
                  ? args.assetId
                    ? String(args.assetId)
                    : null
                  : existing.image,
              updatedAt: new Date().toISOString(),
            };
            const vec =
              args.question && resolveGeminiKey()
                ? await ai.embed(updated.question)
                : undefined;
            db.updateQuestion(activeProfileId, updated, vec);
            hints.switchTab = "library";
            actions.push({
              tool: name,
              summary: `تحديث السؤال ${qid.slice(0, 6)}`,
              ok: true,
            });
            return updated;
          }
          if (action === "delete") {
            const qid = String(args.questionId || "");
            const ok = db.deleteQuestion(activeProfileId, qid);
            if (!ok) throw new Error("السؤال غير موجود");
            hints.switchTab = "library";
            actions.push({
              tool: name,
              summary: `حذف السؤال ${qid.slice(0, 6)}`,
              ok: true,
            });
            return { deleted: true };
          }
          throw new Error("إجراء غير معروف");
        }

        case "run_audit": {
          const report = await auditLibrary(db, activeProfileId, ai, {
            verifyFactsWithSearch: Boolean(args.verifyFactsWithSearch),
            verifyImages: Boolean(args.verifyImages),
          });
          hints.switchTab = "audit";
          actions.push({
            tool: name,
            summary: `تدقيق ${report.totalQuestions} سؤال (${report.issues.length} ملاحظات)`,
            ok: true,
          });
          return report;
        }

        case "prepare_export": {
          const fmt = String(args.format || "zip").toLowerCase();
          if (!["json", "csv", "xlsx", "zip"].includes(fmt)) {
            throw new Error("صيغة تصدير غير مدعومة");
          }
          const url = `/api/export/${fmt}?profileId=${activeProfileId}`;
          hints.downloadUrl = url;
          hints.switchTab = "profiles";
          actions.push({
            tool: name,
            summary: `تجهيز التصدير بصيغة ${fmt.toUpperCase()}`,
            ok: true,
          });
          return {
            url,
            format: fmt,
            questionsCount: db.questions(activeProfileId).length,
          };
        }

        default:
          throw new Error("أداة غير معروفة: " + name);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      actions.push({
        tool: name,
        summary: message,
        ok: false,
      });
      return { error: message };
    }
  }

  let finalReply = "";
  for (let step = 0; step < 6; step++) {
    const res = await client.models.generateContent({
      model: ai.textModel,
      contents,
      config: {
        thinkingConfig: ai.fastThinkingConfig,
        systemInstruction,
        tools: [{ functionDeclarations: declarations }],
      },
    });

    const modelContent = res.candidates?.[0]?.content;
    const calls = res.functionCalls;

    if (!calls || calls.length === 0) {
      finalReply = (res.text ?? "").trim() || "تم تنفيذ طلبك.";
      break;
    }

    if (modelContent) {
      contents.push(modelContent);
    }

    const responseParts = [];
    for (const call of calls) {
      const output = await executeTool(
        call.name || "",
        (call.args as Record<string, unknown>) || {},
      );
      responseParts.push({
        functionResponse: {
          id: call.id,
          name: call.name,
          response: { result: output },
        },
      });
    }

    contents.push({
      role: "user",
      parts: responseParts,
    });
  }

  if (!finalReply) {
    finalReply = "تم تنفيذ الخطوات المطلوبة.";
  }

  const assistantMsg = db.addAssistantMessage(
    activeProfileId,
    "assistant",
    finalReply,
    actions,
  );

  return {
    message: assistantMsg,
    actions,
    hints,
  };
}
