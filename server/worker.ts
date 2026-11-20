import { ZodError } from "zod";
import { embedModel } from "./local";
import { ChatGPTError } from "./chatgpt-session";
import type { QualityEngine } from "./quality-engine";
import {
  slots,
  type Provider,
  type Asset,
  type Plan,
  type Job,
} from "../shared/contracts";
import { information } from "./search";
import { Store, uid, normalize } from "./store";
import { realPicture, type PictureReviewer } from "./image-engine";
import { transform } from "./media";
import {
  checkJobControl,
  JobInterrupted,
  ProductionUnavailable,
} from "./production-state";
export class Worker {
  private busy = false;
  private activeId?: string;
  constructor(
    private db: Store,
    private ai: Provider,
    private research = information,
    private model?: string,
    private quality?: QualityEngine,
    private chatgptQuality?: (job: Job) => QualityEngine,
    private production?: (job: Job) => Promise<void>,
    private reviewPicture?: PictureReviewer,
  ) {}
  finishing(id: string) {
    return this.activeId === id;
  }
  enqueue(
    profileId: string,
    plan: Plan,
    chatgpt?: Job["chatgpt"],
    production?: Job["production"],
  ) {
    if (!this.db.profile(profileId)) throw new Error("ملف اللعبة غير موجود");
    const j: Job = {
      id: uid(),
      plan,
      profileId,
      status: "queued",
      done: 0,
      error: "",
      qualityVersion: this.quality || chatgpt || production ? 1 : undefined,
      ...(chatgpt ? { chatgpt } : {}),
      ...(production
        ? { production, metrics: { sourcesChecked: 0, imagesReviewed: 0 } }
        : {}),
    };
    this.db.saveJob(j);
    return j;
  }
  enqueueImages(profileId: string) {
    const questions = this.db
      .questions(profileId)
      .filter((q) => !q.image || !this.db.canUseAsset(q.image));
    if (!questions.length) throw Error("لا توجد أسئلة تحتاج إلى صور");
    const j = this.enqueue(profileId, {
      topic: "إضافة صور حقيقية",
      easy: questions.length,
      medium: 0,
      hard: 0,
      imagePercent: 100,
      imageMode: "real",
    });
    j.imageQuestionIds = questions.map((q) => q.id);
    this.db.saveJob(j);
    return j;
  }
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const j = this.db
          .jobs()
          .find((j) => j.status === "queued" || j.status === "running");
        if (!j) break;
        this.activeId = j.id;
        try {
          await this.run(j);
        } catch (e) {
          if (
            e instanceof JobInterrupted ||
            ["paused", "cancelled"].includes(this.db.job(j.id)?.status || "")
          )
            continue;
          const paused =
            e instanceof ProductionUnavailable ||
            (j.chatgpt && e instanceof ChatGPTError && e.pause);
          j.status = paused ? "paused" : "failed";
          j.error =
            e instanceof ZodError
              ? "عاد محرك الإنتاج برد غير مطابق لهذه المرحلة. يمكنك الاستئناف من آخر تقدّم محفوظ."
              : e instanceof Error
                ? e.message
                : String(e);
          this.db.transaction(() => {
            if (e instanceof ProductionUnavailable) {
              j.pauseCode = e.code;
              if (e.code === "gemini_quota" && j.production) {
                for (const pending of this.db.jobs()) {
                  if (
                    pending.status === "queued" &&
                    pending.production?.model === j.production.model
                  )
                    this.db.saveJob({
                      ...pending,
                      status: "paused",
                      pauseCode: e.code,
                      error: j.error,
                    });
                }
              }
            }
            if (paused && e instanceof ChatGPTError) {
              j.pauseCode = e.code;
              for (const next of this.db.jobs()) {
                if (
                  next.status === "queued" &&
                  next.chatgpt?.account === j.chatgpt!.account
                )
                  this.db.saveJob({
                    ...next,
                    status: "paused",
                    pauseCode: e.code,
                    error: j.error,
                  });
              }
            }
            this.db.saveJob(j);
          });
        } finally {
          this.activeId = undefined;
        }
      }
    } finally {
      this.busy = false;
    }
  }
  private async run(j: Job) {
    j.status = "running";
    j.startedAt ||= Date.now();
    this.db.saveJob(j);
    if (j.imageQuestionIds) {
      for (const id of j.imageQuestionIds.slice(j.done)) {
        checkJobControl(this.db, j);
        const q = this.db.question(id, j.profileId);
        if (!q) throw Error("السؤال غير موجود");
        let image = null;
        if (!q.image || !this.db.canUseAsset(q.image)) {
          try {
            image = await realPicture(
              q.quality?.event || q.answer,
              false,
              {
                question: q.question,
                answer: q.answer,
                event: q.quality?.event || q.answer,
                recognition: false,
              },
              this.reviewPicture ? { review: this.reviewPicture } : undefined,
            );
          } catch (e) {
            j.imageFailures = (j.imageFailures || 0) + 1;
            j.error = String((e as Error).message);
          }
        }
        const next = { ...j, done: j.done + 1 };
        checkJobControl(this.db, j);
        this.db.transaction(() => {
          if (image) {
            this.db.putAsset(image.meta, image.png);
            this.db.setQuestionImage(q, image.meta.id);
          }
          this.db.saveJob(next);
        });
        j.done = next.done;
      }
      j.status = "complete";
      this.db.saveJob(j);
      return;
    }
    if (this.production) {
      await this.production(j);
      return;
    }
    if (j.chatgpt) {
      if (!this.chatgptQuality)
        throw new ChatGPTError(
          "تحتاج المهمة إلى اتصال ChatGPT الأصلي.",
          "chatgpt_sign_in_required",
          401,
        );
      if (
        process.env.HOST &&
        !["127.0.0.1", "localhost", "::1"].includes(process.env.HOST)
      )
        throw new ChatGPTError(
          "استخدام خطة ChatGPT يتطلب خادمًا محليًا.",
          "chatgpt_sign_in_required",
          403,
        );
      await this.chatgptQuality(j).run(j, "ollama:" + embedModel());
      return;
    }
    if (j.qualityVersion && this.quality) {
      await this.quality.run(j, this.model);
      return;
    }
    if (j.done === slots(j.plan).length) {
      j.status = "complete";
      this.db.saveJob(j);
      return;
    }
    if (this.model)
      await this.db.reindex(j.profileId, this.model, (text) =>
        this.ai.embed(text),
      );
    let sources = await this.research(j.plan.topic);
    if (!sources.length) throw new Error("لم يعثر البحث على أدلة للموضوع");
    const schedule = slots(j.plan),
      rules = this.db.profile(j.profileId)!.rules;
    const index = this.db.duplicateIndex(j.profileId);
    for (const slot of schedule.slice(j.done)) {
      if (j.done > 0 && j.done % 20 === 0) {
        const fresh = await this.research(
          j.plan.topic +
            " " +
            { easy: "أساسيات", medium: "تفاصيل", hard: "إحصاءات" }[slot.level],
        );
        if (fresh.length)
          sources = [
            ...new Map(
              [...fresh, ...sources].map((item) => [item.url, item]),
            ).values(),
          ];
      }
      const avoid = this.db.recentQuestions(j.profileId);
      const offset = Math.floor(j.done / 5) % sources.length;
      const evidence = [...sources.slice(offset), ...sources.slice(0, offset)]
        .slice(0, 4)
        .map((s) => ({ ...s, text: s.text.slice(0, 1600) }));
      let accepted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const c = await this.ai.draft(
          j.plan.topic,
          slot.level,
          rules,
          evidence,
          avoid,
        );
        avoid.push(c.question);
        const source = evidence[c.sourceIndex];
        if (
          !source ||
          !normalize(c.quote) ||
          !normalize(source.text).includes(normalize(c.quote)) ||
          !(await this.ai.verify(j.plan.topic, c, source))
        )
          continue;
        const vector = await this.ai.embed(c.question);
        if (index.has(c.question, vector)) continue;
        let media: { meta: Asset; png: Buffer } | undefined;
        if (slot.image) {
          if (j.plan.imageMode === "generated") {
            media = {
              meta: {
                id: uid(),
                origin: "generated: symbolic illustration",
                credit: "AI illustration",
                license: "AI-generated",
              },
              png: await transform(
                await this.ai.image(
                  "Original abstract quiz illustration, colorful geometric question mark, no people, no historical depiction",
                ),
                "original",
              ),
            };
          } else {
            media = await realPicture(
              c.imageQuery || c.answer,
              j.plan.imageMode === "edited",
            );
          }
        }
        const next = { ...j, done: j.done + 1 };
        this.db.transaction(() => {
          if (media) this.db.putAsset(media.meta, media.png);
          this.db.add(
            {
              id: uid(),
              profileId: j.profileId,
              question: c.question,
              answer: c.answer,
              difficulty: slot.level,
              source: source.url,
              quote: c.quote,
              image: media?.meta.id ?? null,
            },
            vector,
            this.model,
          );
          this.db.saveJob(next);
        });
        j.done = next.done;
        index.add(c.question, vector);
        accepted = true;
        break;
      }
      if (!accepted)
        throw new Error("رُفضت ثلاث محاولات لضعف الدليل أو تكرار السؤال");
    }
    j.status = "complete";
    this.db.saveJob(j);
  }
}
