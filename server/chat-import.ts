import { z } from "zod";
import { levels } from "../shared/contracts";
import { normalize, uid, type Store } from "./store";

const batch = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(8).max(400),
        answer: z.string().trim().min(1).max(300),
        difficulty: z.enum(levels),
        source: z
          .string()
          .max(2000)
          .url()
          .refine((value) => {
            if (!URL.canParse(value)) return false;
            const url = new URL(value);
            return url.protocol === "https:" && !url.username && !url.password;
          }, "المصدر لازم يكون رابط HTTPS"),
        quote: z.string().trim().max(800).default(""),
      }),
    )
    .min(1)
    .max(100),
});

export function importChatQuestions(
  db: Store,
  profileId: string,
  text: string,
) {
  const cleaned = text
    .trim()
    .replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, "");
  let payload: unknown;
  try {
    payload = JSON.parse(cleaned);
  } catch {
    throw Error("انسخ JSON من رد ChatGPT والصقه كاملًا.");
  }
  const { questions } = batch.parse(payload);
  const seen = new Set(
    db.questions(profileId).map((q) => normalize(q.question)),
  );
  let imported = 0;
  db.transaction(() => {
    for (const q of questions) {
      const key = normalize(q.question);
      if (seen.has(key)) continue;
      db.add({ ...q, id: uid(), profileId, image: null }, []);
      seen.add(key);
      imported++;
    }
  });
  return { imported, duplicates: questions.length - imported };
}
