import type { QuestionQuality } from "./quality";
import { z } from "zod";
export const levels = ["easy", "medium", "hard"] as const;
export type Level = (typeof levels)[number];
export const difficultyPoints = { easy: 200, medium: 400, hard: 600 } as const;
const count = z.number().int().min(0).max(10000);
export const imageModes = [
  "real",
  "generated",
  "edited",
  "sketch",
  "cartoon",
  "silhouette",
  "bw",
  "auto",
  "none",
] as const;
export const imageMixModes = [
  "real",
  "generated",
  "sketch",
  "cartoon",
  "silhouette",
  "bw",
  "auto",
] as const;
export const artModes = ["pencil", "cartoon", "render3d", "eventArt"] as const;
const imageMix = z.partialRecord(
  z.enum(imageMixModes),
  z.object({
    count: count.optional(),
    percent: z.number().min(0).max(100).optional(),
  }),
);
export const planSchema = z
  .object({
    topic: z.string().trim().min(1).max(1000),
    easy: count,
    medium: count,
    hard: count,
    eliteQuality: z.boolean().optional(),
    audienceRegion: z.enum(["jordan", "arab", "mixed"]).optional(),
    brief: z.string().trim().max(2000).optional(),
    audience: z.string().trim().max(240).optional(),
    imageMode: z.enum(imageModes).optional(),
    imagePercent: z.number().int().min(0).max(100),
    imageMix: imageMix.optional(),
  })
  .refine((p) => p.easy + p.medium + p.hard > 0, "يلزم سؤال واحد على الأقل")
  .refine((p) => {
    const total = p.easy + p.medium + p.hard;
    return (
      Object.values(p.imageMix || {}).reduce(
        (used, part) =>
          used +
          (part.count ?? Math.round((total * (part.percent ?? 0)) / 100)),
        0,
      ) <= total
    );
  }, "مجموع الصور المطلوبة أكبر من عدد الأسئلة");
export type Plan = z.infer<typeof planSchema>;
export const fields = [
  "question",
  "answer",
  "difficulty",
  "image",
  "source",
] as const;
export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    rules: z.string().max(2000).default(""),
    mapping: z
      .partialRecord(z.enum(fields), z.string().trim().min(1).max(100))
      .default({}),
  })
  .refine(
    (p) => new Set(fields.map((k) => p.mapping[k] ?? k)).size === fields.length,
    "أسماء الحقول متكررة",
  );
export type Profile = z.infer<typeof profileSchema>;
export interface Evidence {
  title: string;
  url: string;
  text: string;
}
export interface Asset {
  id: string;
  origin: string;
  credit: string;
  license: string;
  rightsStatus?: "reusable" | "user-authorized" | "generated" | "attributed";
  originalId?: string;
  transformation?: string;
}
export interface Question {
  id: string;
  profileId: string;
  question: string;
  answer: string;
  difficulty: Level;
  source: string;
  quote: string;
  image: string | null;
  quality?: QuestionQuality;
}
export interface Candidate {
  question: string;
  answer: string;
  sourceIndex: number;
  quote: string;
  imageQuery: string;
}
export interface Provider {
  interpret(request: string): Promise<Plan>;
  draft(
    topic: string,
    level: Level,
    rules: string,
    sources: Evidence[],
    avoid: string[],
  ): Promise<Candidate>;
  verify(
    topic: string,
    candidate: Candidate,
    source: Evidence,
  ): Promise<boolean>;
  embed(text: string): Promise<number[]>;
  image(prompt: string, input?: Buffer, strength?: number): Promise<Buffer>;
}
export function slots(plan: Plan) {
  const sequence = levels.flatMap((k) => Array<Level>(plan[k]).fill(k));
  const n = sequence.length;
  const allocation: NonNullable<Plan["imageMode"]>[] = plan.imageMix
    ? imageMixModes
        .flatMap((mode) => {
          const part = plan.imageMix![mode];
          const amount =
            part?.count ?? Math.round((n * (part?.percent ?? 0)) / 100);
          return Array.from({ length: amount }, (_, i) => ({
            mode,
            order: (i + 0.5) / amount,
          }));
        })
        .sort((a, b) => a.order - b.order)
        .map((item) => item.mode)
    : Array(
        Math.round(
          (n * (plan.imageMode === "none" ? 0 : plan.imagePercent)) / 100,
        ),
      ).fill(plan.imageMode || "auto");
  const target = allocation.length;
  let next = 0;
  return sequence.map((level, i) => {
    const image =
      Math.floor(((i + 1) * target) / n) > Math.floor((i * target) / n);
    return { level, image, mode: image ? allocation[next++] : undefined };
  });
}

export interface Job {
  id: string;
  profileId: string;
  plan: Plan;
  done: number;
  status:
    | "queued"
    | "running"
    | "failed"
    | "complete"
    | "partial"
    | "paused"
    | "cancelled";
  error: string;
  imageFailures?: number;
  imageQuestionIds?: string[];
  startedAt?: number;
  qualityVersion?: 1;
  cursor?: number;
  qualityStage?: string;
  qualityRetries?: number;
  chatgpt?: { account: string; model: string };
  pauseCode?: string;
  production?: { provider: "gemini" | "web-engine"; model: string };
  metrics?: { sourcesChecked: number; imagesReviewed: number };
}
