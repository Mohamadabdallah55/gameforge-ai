import React, { useState } from "react";
import {
  ShieldCheck,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Database,
} from "lucide-react";
import type { AuditReport, HealthStatus } from "../types";

interface Props {
  profileId: string;
  health: HealthStatus | null;
  busy: boolean;
  onRunAudit: (opts: {
    verifyFactsWithSearch: boolean;
    verifyImages: boolean;
  }) => Promise<AuditReport>;
  onReindex: () => Promise<number>;
  onDeleteQuestion: (id: string) => Promise<void>;
}

export function AuditCenter({
  health,
  busy,
  onRunAudit,
  onReindex,
  onDeleteQuestion,
}: Props) {
  const [verifyFacts, setVerifyFacts] = useState(true);
  const [verifyImages, setVerifyImages] = useState(true);
  const [report, setReport] = useState<AuditReport | null>(null);

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              مركز التدقيق ومنع التكرار
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              افحص التكرار الدلالي بين الأسئلة، وتحقّق من صحة الإجابات عبر بحث Google، وتأكّد من مطابقة الصور وعدم احتوائها على كشف للإجابة.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onReindex()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة فهرسة التضمينات
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onRunAudit({
                  verifyFactsWithSearch: verifyFacts,
                  verifyImages,
                }).then(setReport)
              }
              className="inline-flex items-center gap-2 rounded-md bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              تشغيل التدقيق الشامل
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs text-slate-700">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={verifyFacts}
              onChange={(e) => setVerifyFacts(e.target.checked)}
            />
            التحقق من صحة الإجابات عبر Google Search
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={verifyImages}
              onChange={(e) => setVerifyImages(e.target.checked)}
            />
            فحص تطابق الصور وكشف النصوص عبر Gemini Vision
          </label>
        </div>

        {health?.sqlite && (
          <div className="bg-slate-50 border border-slate-200 rounded-md p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 tabular-nums">
            <div className="inline-flex items-center gap-2 font-medium text-slate-800">
              <Database className="w-4 h-4 text-emerald-900" />
              سلامة قاعدة SQLite:{" "}
              <span className="text-emerald-800">
                {health.sqlite.integrity ? "سليمة (quick_check OK)" : "تحتاج فحصًا"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span>
                الحجم: {Math.max(1, Math.round(health.sqlite.sizeBytes / 1024))} KB
              </span>
              <span aria-hidden="true">·</span>
              <span>
                نموذج التضمين المخزن: {health.sqlite.embedModel || "غير مسجل بعد"}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                إجمالي الأصول: {health.sqlite.counts.assets}
              </span>
            </div>
          </div>
        )}
      </section>

      {report && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">تقرير التدقيق</h3>
            <div className="text-xs text-slate-600 tabular-nums flex flex-wrap gap-2">
              <span>إجمالي الأسئلة: {report.totalQuestions}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-800 font-medium">
                مدقق: {report.verifiedCount}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-700 font-medium">
                ملاحظات: {report.issues.length}
              </span>
              <span aria-hidden="true">·</span>
              <span>أزواج مكررة: {report.duplicatePairs}</span>
            </div>
          </div>

          {report.issues.length === 0 ? (
            <p className="text-sm text-emerald-800 font-medium py-4">
              لم يتم العثور على تكرارات أو أخطاء في المصادر والصور.
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {report.issues.map((issue, idx) => (
                <article
                  key={`${issue.questionId}-${issue.type}-${idx}`}
                  className="py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {issue.type === "duplicate"
                        ? "تكرار دلالي / نصي"
                        : issue.type === "image"
                          ? "فحص الصورة"
                          : issue.type === "fact"
                            ? "تحقق الحقيقة"
                            : "فحص المصدر"}
                    </div>
                    <p className="text-sm text-slate-800">{issue.message}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void onDeleteQuestion(issue.questionId).then(() =>
                        onRunAudit({
                          verifyFactsWithSearch: false,
                          verifyImages: false,
                        }).then(setReport),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف السؤال
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
