import type { Plan } from "../shared/contracts";
import type { Store } from "./store";
export function audienceContext(
  region: Plan["audienceRegion"],
  details?: string,
) {
  const guidelines = {
    jordan:
      "أردني. استخدم عربية واضحة، واستحضر التقاليد والكلمات والأمثلة الأردنية حين تخدم السؤال. لا تفترض أن كل أردني يعرف تفاصيل محلية أو له الاهتمامات نفسها.",
    arab: "عربي غير أردني. استخدم عربية مفهومة بين الدول، واشرح المصطلح الأردني في سياق السؤال إذا كان فهمه لازمًا. لا تفترض بلدًا عربيًا محددًا.",
    mixed:
      "عربي مختلط، فيه أردنيون وغير أردنيين. اجعل الأسئلة عادلة للطرفين. اشرح الإحالات المحلية اللازمة وتجنب الاعتماد على لهجة واحدة للإجابة.",
  };
  return [region ? guidelines[region] : "جمهور عربي عام", details?.trim()]
    .filter(Boolean)
    .join(" ");
}
export function editorialContext(
  db: Store,
  profile: string,
  plan: Pick<Plan, "audienceRegion" | "audience" | "brief">,
) {
  const accepted = db
    .questions(profile)
    .filter((q) => q.quality)
    .slice(-3)
    .map((q) => ({
      question: q.question.slice(0, 180),
      answer: q.answer.slice(0, 80),
      level: q.difficulty,
    }));
  const ids = db
    .jobs()
    .filter((j) => j.profileId === profile)
    .slice(-4)
    .map((j) => j.id);
  const rejected: { candidate: string; reason: string }[] = [];
  for (const id of ids.reverse()) {
    const rows = db.db
      .prepare(
        "SELECT body FROM quality_audit WHERE job=? AND consumed=1 ORDER BY id DESC LIMIT 3",
      )
      .all(id);
    for (const row of rows) {
      const v = JSON.parse(String(row.body));
      if (typeof v.candidate === "string" && typeof v.reason === "string")
        rejected.push({
          candidate: v.candidate.slice(0, 160),
          reason: v.reason.slice(0, 160),
        });
    }
    if (rejected.length >= 3) break;
  }
  return {
    rules: db.profile(profile)?.rules || "",
    audience: audienceContext(plan.audienceRegion, plan.audience),
    brief: plan.brief || "",
    accepted,
    rejected: rejected.slice(0, 3),
  };
}
