import { z } from "zod";
const short = z.string().trim().min(1).max(180);
export const fingerprintSchema = z.object({
  type: short,
  idea: short,
  target: short,
  event: short,
  entity: short,
  answerPattern: short,
  template: short,
});
export type Fingerprint = z.infer<typeof fingerprintSchema>;
export const criteria = [
  "accuracy",
  "importance",
  "engagement",
  "originality",
  "clarity",
  "difficulty",
  "diversity",
  "sourceStrength",
] as const;
export type Criterion = (typeof criteria)[number];
export const scorecardSchema = z.object({
  scores: z.record(z.enum(criteria), z.number().int().min(0).max(100)),
  supported: z.boolean(),
  trivial: z.boolean(),
  ambiguous: z.boolean(),
  leaksAnswer: z.boolean(),
  level: z.enum(["easy", "medium", "hard"]),
  reason: short,
  fingerprint: fingerprintSchema,
});
export type Scorecard = z.infer<typeof scorecardSchema>;
export const audienceSignalSchema = z.object({
  recognition: z.number().int().min(0).max(100),
  historicalImpact: z.number().int().min(0).max(100),
  audienceInterest: z.number().int().min(0).max(100),
  surprise: z.number().int().min(0).max(100),
  documentedControversy: z.number().int().min(0).max(100),
  quizValue: z.number().int().min(0).max(100),
});
export type AudienceSignals = z.infer<typeof audienceSignalSchema>;
export const visualSchema = z.object({
  description: z.string().min(1).max(220),
  likelySubject: z.string().min(1).max(120),
  eventMatch: z.boolean(),
  sourceMatch: z.boolean(),
  questionMatch: z.boolean(),
  value: z.number().min(0).max(100),
  leaksAnswer: z.boolean(),
  unwantedText: z.boolean(),
  quality: z.number().min(0).max(100),
  reason: z.string().min(1).max(220),
});
export interface QuestionQuality {
  audienceSignals?: AudienceSignals;
  score?: number;
  scores?: Scorecard["scores"];
  fingerprint: Fingerprint;
  facet: string;
  event: string;
  sourceLabel: string;
  sourceSelectionReason?: string;
  fact: string;
  imageNote?: string;
  visual?: VisualAssessment;
}
export interface QualityRejection {
  stage: string;
  reason: string;
  candidate?: string;
  scores?: Scorecard["scores"];
}
export interface VisualAssessment {
  description: string;
  pixelObservation?: string;
  likelySubject: string;
  eventMatch: boolean;
  sourceMatch: boolean;
  questionMatch: boolean;
  value: number;
  leaksAnswer: boolean;
  unwantedText: boolean;
  quality: number;
  reason: string;
}
