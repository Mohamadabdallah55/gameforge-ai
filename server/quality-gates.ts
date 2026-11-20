import type { AudienceSignals } from "../shared/quality";
import { criteria, type Fingerprint, type Scorecard } from "../shared/quality";
import type { Level } from "../shared/contracts";
import { normalize } from "./store";

export function exactQuote(text: string, quote: string) {
  const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
  return clean(quote).length >= 22 && clean(text).includes(clean(quote));
}
export function reveals(question: string, answer: string) {
  const normalized = (value: string) =>
    normalize(
      value.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 15)),
    );
  const q = " " + normalized(question) + " ",
    a = normalized(answer);
  return Boolean(a) && q.includes(" " + a + " ");
}
export function assess(card: Scorecard, level: Level, elite: boolean) {
  const { scores } = card;
  const score = Math.round(
    criteria.reduce((sum, criterion) => sum + scores[criterion], 0) /
      criteria.length,
  );
  const threshold = elite ? 85 : 78;
  if (!card.supported || scores.accuracy < 95 || scores.sourceStrength < 80)
    return { score, reason: "الإجابة أو المصدر غير موثوق: " + card.reason };
  if (card.trivial || card.ambiguous || card.leaksAnswer)
    return {
      score,
      reason: "سؤال بديهي أو ملتبس أو يكشف جوابه: " + card.reason,
    };
  if (card.level !== level || scores.difficulty < (elite ? 83 : 76))
    return {
      score,
      reason: "الصعوبة الفعلية لا تطابق المطلوب: " + card.reason,
    };
  if (
    score < threshold ||
    (
      [
        "importance",
        "engagement",
        "originality",
        "clarity",
        "diversity",
      ] as const
    ).some((k) => scores[k] < (elite ? 79 : 70))
  )
    return { score, reason: "درجات الجودة دون الحد: " + card.reason };
  return { score, reason: "" };
}
const key = (v: string) =>
  normalize(v)
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .trim();
export function audienceValue(signals: AudienceSignals) {
  return Math.round(
    signals.quizValue * 0.35 +
      signals.recognition * 0.15 +
      signals.historicalImpact * 0.18 +
      signals.audienceInterest * 0.17 +
      Math.max(
        signals.surprise,
        signals.documentedControversy,
        signals.historicalImpact,
      ) *
        0.15,
  );
}
const templateKey = (value: string) => {
  const terms = key(value)
    .replace(/\b(stadium|ground|arena)\b/g, "venue")
    .replace(/\b(identify|name|the|of|a|which|was|is|where)\b/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return [...new Set(terms)].sort().join(" ");
};
export class Diversity {
  private counts = new Map<string, number>();
  private facts = new Set<string>();
  constructor(
    private elite: boolean,
    private total: number,
    previous: Fingerprint[],
  ) {
    for (const fp of previous) this.add(fp);
  }
  private patterns(fp: Fingerprint) {
    return [
      [
        "template:" + templateKey(fp.template),
        this.elite ? 1 : 2,
        "تكرر قالب السؤال",
      ],
      ["idea:" + key(fp.idea), this.elite ? 1 : 2, "تكررت الفكرة الأساسية"],
      [
        "entity:" + key(fp.entity),
        Math.max(2, Math.ceil(this.total * 0.06)),
        "إفراط في الشخصية أو الجهة نفسها",
      ],
      [
        "event:" + normalize(fp.event),
        Math.max(2, Math.ceil(this.total * 0.05)),
        "إفراط في الحدث نفسه",
      ],
      [
        "type:" + key(fp.type) + ":" + key(fp.answerPattern),
        Math.max(2, Math.ceil(this.total * 0.16)),
        "إفراط في نوع السؤال ونمط الإجابة",
      ],
    ] as const;
  }
  reason(fp: Fingerprint) {
    if (this.facts.has(normalize(fp.target)))
      return "المعلومة المستهدفة موجودة بالفعل";
    return (
      this.patterns(fp).find(
        ([name, cap]) => (this.counts.get(name) || 0) >= cap,
      )?.[2] || ""
    );
  }
  add(fp: Fingerprint) {
    this.facts.add(normalize(fp.target));
    for (const [name] of this.patterns(fp))
      this.counts.set(name, (this.counts.get(name) || 0) + 1);
  }
}
