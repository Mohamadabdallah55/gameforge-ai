import type { AuditIssue, AuditReport } from "../shared/contracts";
import type { Gemini } from "./provider";
import { cosine, normalize, Store } from "./store";

export interface AuditOptions {
  verifyFactsWithSearch?: boolean;
  verifyImages?: boolean;
  maxDeepChecks?: number;
}

export async function auditLibrary(
  db: Store,
  profileId: string,
  ai?: Gemini,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const rows = db.questionsWithVectors(profileId);
  const issues: AuditIssue[] = [];
  let duplicatePairs = 0;

  // 1. Exact & semantic duplicate detection
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const sameNorm = a.norm === b.norm;
      const sim =
        a.vector.length === b.vector.length
          ? cosine(a.vector, b.vector)
          : 0;
      if (sameNorm || sim >= 0.88) {
        duplicatePairs++;
        issues.push({
          questionId: b.question.id,
          relatedId: a.question.id,
          type: "duplicate",
          severity: "high",
          similarity: Math.round((sameNorm ? 1 : sim) * 100),
          message: sameNorm
            ? `تطابق نصي كامل مع السؤال "${a.question.question.slice(0, 60)}"`
            : `تشابه دلالي مرتفع (${Math.round(sim * 100)}%) مع "${a.question.question.slice(0, 60)}"`,
        });
      }
    }
  }

  // 2. Citation & image integrity checks
  for (const { question: q } of rows) {
    if (!q.quote?.trim() || normalize(q.quote).length < 6) {
      issues.push({
        questionId: q.id,
        type: "citation",
        severity: "medium",
        message: "الاقتباس الداعم قصير أو غير مكتمل",
      });
    }
    if (!q.source || !/^https?:\/\//i.test(q.source)) {
      issues.push({
        questionId: q.id,
        type: "citation",
        severity: "medium",
        message: "رابط المصدر غير صالح أو مفقود",
      });
    }
    if (q.image && !db.asset(q.image)) {
      issues.push({
        questionId: q.id,
        type: "image",
        severity: "high",
        message: "الصورة المرتبطة غير موجودة في مكتبة الوسائط",
      });
    }
  }

  // 3. Optional deep AI verification using Google Search & Multimodal Vision
  const limit = Math.min(25, Math.max(1, options.maxDeepChecks ?? 10));
  if (ai && (options.verifyFactsWithSearch || options.verifyImages)) {
    const profileName = db.profile(profileId)?.name || "مسابقة عامة";
    let checked = 0;
    for (const { question: q } of rows) {
      if (checked >= limit) break;
      let flagged = false;
      const notes: string[] = [];

      if (options.verifyFactsWithSearch) {
        checked++;
        try {
          const check = await ai.verifyWithSearch(
            profileName,
            q.question,
            q.answer,
            q.quote,
          );
          if (!check.supported) {
            flagged = true;
            notes.push(check.note);
            issues.push({
              questionId: q.id,
              type: "fact",
              severity: "high",
              message: "تنبيه التحقق عبر Google: " + check.note,
            });
          } else {
            notes.push("تم التحقق عبر Google: " + check.note);
          }
        } catch (err) {
          notes.push(
            "تعذر التحقق الآلي: " +
              (err instanceof Error ? err.message : String(err)),
          );
        }
      }

      if (options.verifyImages && q.image) {
        const png = db.asset(q.image);
        if (png) {
          try {
            const imgAudit = await ai.auditImageRelevance(
              q.question,
              q.answer,
              png,
            );
            if (!imgAudit.relevant || imgAudit.hasSpoiler) {
              flagged = true;
              const reason = imgAudit.hasSpoiler
                ? "الصورة تحتوي على نص يكشف الإجابة"
                : "الصورة غير مطابقة للسؤال";
              notes.push(`${reason}: ${imgAudit.note}`);
              issues.push({
                questionId: q.id,
                type: "image",
                severity: "high",
                message: `${reason} — ${imgAudit.note}`,
              });
            }
          } catch {
            // non-fatal
          }
        }
      }

      if (notes.length) {
        q.auditStatus = flagged ? "flagged" : "verified";
        q.auditNote = notes.join(" | ");
        q.updatedAt = new Date().toISOString();
        db.updateQuestion(profileId, q);
      }
    }
  }

  const latest = db.questions(profileId);
  const flaggedSet = new Set(issues.map((i) => i.questionId));
  return {
    profileId,
    checkedAt: new Date().toISOString(),
    totalQuestions: latest.length,
    verifiedCount: latest.filter((q) => q.auditStatus === "verified").length,
    flaggedCount: latest.filter(
      (q) => q.auditStatus === "flagged" || flaggedSet.has(q.id),
    ).length,
    duplicatePairs,
    issues,
  };
}
