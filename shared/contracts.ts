import { z } from "zod";

export const levels = ["easy", "medium", "hard"] as const;
export type Level = (typeof levels)[number];

const count = z.number().int().min(0).max(500);

export const searchSources = ["auto", "google", "wikipedia", "tavily"] as const;
export type SearchSource = (typeof searchSources)[number];

export const imageStrategies = ["real_then_ai", "real_only", "ai_only"] as const;
export type ImageStrategy = (typeof imageStrategies)[number];

export const planSchema = z
  .object({
    topic: z.string().trim().min(1).max(1000),
    easy: count,
    medium: count,
    hard: count,
    imagePercent: z.number().int().min(0).max(100),
    searchSource: z.enum(searchSources).optional(),
    imageStrategy: z.enum(imageStrategies).optional(),
  })
  .refine((p) => p.easy + p.medium + p.hard > 0, "يلزم سؤال واحد على الأقل");

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
}

export type AuditStatus = "pending" | "verified" | "flagged";

export interface Question {
  id: string;
  profileId: string;
  question: string;
  answer: string;
  difficulty: Level;
  source: string;
  quote: string;
  image: string | null;
  auditStatus?: AuditStatus;
  auditNote?: string;
  updatedAt?: string;
}

export interface Candidate {
  question: string;
  answer: string;
  sourceIndex: number;
  quote: string;
  imageQuery: string;
}

export interface ImageGenerateOptions {
  model?: "gemini-3.1-flash-lite-image" | "gemini-nano-banana-2.1";
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  imageSize?: "1K" | "2K" | "4K";
  useSearch?: boolean;
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
  image(
    prompt: string,
    input?: Buffer,
    options?: ImageGenerateOptions,
  ): Promise<Buffer>;
}

export function slots(plan: Plan) {
  const sequence = levels.flatMap((k) => Array<Level>(plan[k]).fill(k));
  const n = sequence.length,
    target = Math.round((n * plan.imagePercent) / 100);
  return sequence.map((level, i) => ({
    level,
    image: Math.floor(((i + 1) * target) / n) > Math.floor((i * target) / n),
  }));
}

export interface Job {
  id: string;
  profileId: string;
  plan: Plan;
  done: number;
  status: "queued" | "running" | "paused" | "failed" | "complete";
  error: string;
  stage?: string;
  rejected?: number;
}

export interface AuditIssue {
  questionId: string;
  type: "duplicate" | "citation" | "image" | "fact";
  severity: "high" | "medium";
  message: string;
  relatedId?: string;
  similarity?: number;
}

export interface AuditReport {
  profileId: string;
  checkedAt: string;
  totalQuestions: number;
  verifiedCount: number;
  flaggedCount: number;
  duplicatePairs: number;
  issues: AuditIssue[];
}

export interface AssistantActionLog {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface AssistantMessage {
  id: string;
  profileId: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantActionLog[];
  createdAt: string;
}
