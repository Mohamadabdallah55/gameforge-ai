import {
  slots,
  type Asset,
  type Candidate,
  type Evidence,
  type Job,
  type Level,
  type Plan,
  type Provider,
  type SearchSource,
} from "../shared/contracts";
import { downloadHit, information, pictures } from "./search";
import { normalize, Store, uid } from "./store";
import { transform } from "./media";

type ResearchFn = (
  term: string,
  source?: SearchSource,
  ai?: { searchEvidence?: (q: string) => Promise<Evidence[]> },
) => Promise<Evidence[]>;

interface ExtendedProvider extends Provider {
  embedModel?: string;
  searchEvidence?: (term: string) => Promise<Evidence[]>;
  expandTopics?: (topic: string, total: number) => Promise<string[]>;
  draftBatch?: (
    topic: string,
    level: Level,
    rules: string,
    sources: Evidence[],
    avoid: string[],
    count: number,
  ) => Promise<Candidate[]>;
}

export class Worker {
  private busy = false;

  constructor(
    private db: Store,
    private ai: ExtendedProvider,
    private research: ResearchFn = information,
  ) {}

  enqueue(profileId: string, plan: Plan) {
    if (!this.db.profile(profileId)) throw new Error("ملف اللعبة غير موجود");
    const j: Job = {
      id: uid(),
      plan,
      profileId,
      status: "queued",
      done: 0,
      error: "",
      stage: "queued",
      rejected: 0,
    };
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
        try {
          await this.run(j);
        } catch (e) {
          const latest = this.db.job(j.id);
          if (latest?.status === "paused") continue;
          j.status = "failed";
          j.stage = "failed";
          j.error = e instanceof Error ? e.message : String(e);
          this.db.saveJob(j);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async resolveImageForSlot(
    query: string,
    questionText: string,
    strategy: NonNullable<Plan["imageStrategy"]>,
  ): Promise<{ meta: Asset; png: Buffer; cachedAssetId?: string } | undefined> {
    if (strategy !== "ai_only" && query.trim()) {
      const hits = await pictures(query);
      for (const hit of hits.slice(0, 5)) {
        const cached = this.db.getCachedAssetByUrl(hit.url);
        if (cached) {
          const existingPng = this.db.asset(cached.id);
          if (existingPng) {
            return { meta: cached, png: existingPng, cachedAssetId: cached.id };
          }
        }
        try {
          const raw = await downloadHit(hit);
          const png = await transform(raw, "original");
          return {
            meta: {
              id: uid(),
              origin: hit.origin,
              credit: hit.credit,
              license: hit.license,
            },
            png,
          };
        } catch {
          // Try next image hit if this host returned 429 or invalid format
          continue;
        }
      }
      if (strategy === "real_only") {
        throw new Error("تعذر تنزيل صورة مطابقة للبحث " + query);
      }
    }

    const prompt =
      (query.trim() || questionText) +
      " — clean high quality quiz illustration, no text, no labels, no watermarks";
    const generated = await this.ai.image(prompt, undefined, {
      aspectRatio: "4:3",
    });
    const png = await transform(generated, "original");
    return {
      meta: {
        id: uid(),
        origin: "generated: " + (query.trim() || "quiz"),
        credit: "Gemini",
        license: "AI-generated",
      },
      png,
    };
  }

  private async run(j: Job) {
    j.status = "running";
    j.stage = "researching";
    this.db.saveJob(j);

    const schedule = slots(j.plan);
    if (j.done >= schedule.length) {
      j.status = "complete";
      j.stage = "complete";
      this.db.saveJob(j);
      return;
    }

    const searchSource = j.plan.searchSource ?? "auto";
    const imageStrategy = j.plan.imageStrategy ?? "real_only";

    const sources: Evidence[] = [];
    const seenUrls = new Set<string>();
    const addSources = (items: Evidence[]) => {
      for (const item of items) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          sources.push(item);
        }
      }
    };

    addSources(await this.research(j.plan.topic, searchSource, this.ai));

    // For batch jobs (> 10 questions), expand subtopics to build a rich evidence pool
    const remainingTotal = schedule.length - j.done;
    let subTopics: string[] = [];
    if (remainingTotal > 10 && this.ai.expandTopics) {
      try {
        subTopics = await this.ai.expandTopics(j.plan.topic, remainingTotal);
        for (const sub of subTopics.slice(0, 4)) {
          addSources(await this.research(sub, searchSource, this.ai));
        }
      } catch {
        // Proceed with primary sources if expansion fails
      }
    }

    if (!sources.length) {
      throw new Error("لم يعثر البحث على أدلة للموضوع");
    }

    const rules = this.db.profile(j.profileId)?.rules ?? "";
    const candidateQueue: Candidate[] = [];
    let subTopicCursor = 4;

    while (j.done < schedule.length) {
      const currentJob = this.db.job(j.id);
      if (currentJob?.status === "paused") {
        return;
      }

      const slot = schedule[j.done];
      const existing = this.db.questions(j.profileId);
      const avoid = existing.slice(-60).map((q) => q.question);

      // Refresh evidence pool periodically during large batches
      if (
        j.done > 0 &&
        j.done % 15 === 0 &&
        subTopicCursor < subTopics.length
      ) {
        j.stage = "researching";
        this.db.saveJob(j);
        try {
          addSources(
            await this.research(subTopics[subTopicCursor++], searchSource, this.ai),
          );
        } catch {
          // ignore non-fatal sub-topic research failure
        }
      }

      let accepted = false;
      let attempts = 0;

      while (attempts < 3 && !accepted) {
        const pausedCheck = this.db.job(j.id);
        if (pausedCheck?.status === "paused") return;

        let c: Candidate | undefined = candidateQueue.shift();
        if (!c) {
          j.stage = "drafting";
          this.db.saveJob(j);

          // Count consecutive remaining slots at same difficulty
          let sameLevelRemaining = 0;
          for (let k = j.done; k < schedule.length; k++) {
            if (schedule[k].level === slot.level) sameLevelRemaining++;
            else break;
          }

          if (sameLevelRemaining >= 3 && this.ai.draftBatch) {
            const batch = await this.ai.draftBatch(
              j.plan.topic,
              slot.level,
              rules,
              sources.slice(-12),
              avoid,
              Math.min(5, sameLevelRemaining),
            );
            c = batch.shift();
            candidateQueue.push(...batch);
          } else {
            c = await this.ai.draft(
              j.plan.topic,
              slot.level,
              rules,
              sources.slice(-10),
              avoid,
            );
          }
        }

        if (!c) {
          attempts++;
          continue;
        }
        avoid.push(c.question);

        const sourceWindow =
          sources.length > 12 ? sources.slice(-12) : sources;
        const source = sourceWindow[c.sourceIndex] ?? sources[c.sourceIndex];

        if (
          !source ||
          !normalize(c.quote) ||
          !normalize(source.text).includes(normalize(c.quote))
        ) {
          attempts++;
          j.rejected = (j.rejected ?? 0) + 1;
          continue;
        }

        j.stage = "verifying";
        this.db.saveJob(j);
        const verified = await this.ai.verify(j.plan.topic, c, source);
        if (!verified) {
          attempts++;
          j.rejected = (j.rejected ?? 0) + 1;
          continue;
        }

        const vector = await this.ai.embed(c.question);
        if (this.db.duplicate(j.profileId, c.question, vector)) {
          attempts++;
          j.rejected = (j.rejected ?? 0) + 1;
          continue;
        }

        let media:
          | { meta: Asset; png: Buffer; cachedAssetId?: string }
          | undefined;
        if (slot.image) {
          j.stage = "media";
          this.db.saveJob(j);
          media = await this.resolveImageForSlot(
            c.imageQuery,
            c.question,
            imageStrategy,
          );
        }

        const next: Job = {
          ...j,
          done: j.done + 1,
          stage: "saving",
        };
        this.db.transaction(() => {
          if (media && !media.cachedAssetId) {
            this.db.putAsset(media.meta, media.png);
          }
          if (this.ai.embedModel) {
            this.db.setMeta("embed_model", this.ai.embedModel);
          }
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
              auditStatus: "verified",
              updatedAt: new Date().toISOString(),
            },
            vector,
          );
          this.db.saveJob(next);
        });
        j.done = next.done;
        accepted = true;
      }

      if (!accepted) {
        throw new Error("رُفضت ثلاث محاولات لضعف الدليل أو تكرار السؤال");
      }
    }

    j.status = "complete";
    j.stage = "complete";
    this.db.saveJob(j);
  }
}
