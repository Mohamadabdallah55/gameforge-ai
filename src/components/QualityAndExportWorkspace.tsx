import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, Download, RefreshCw } from "lucide-react";
import { api } from "../api";
import { stageLabels } from "./shared";

interface AuditEntry {
  id: number;
  jobId: string;
  stage: string;
  reason: string;
  candidate?: string;
}

interface ExportPreviewData {
  profileName: string;
  headers: string[];
  total: number;
  withImages: number;
  rows: {
    id: string;
    difficulty: string;
    mapped: Record<string, string>;
    imageId: string | null;
    imageLicense: string | null;
    score: number | null;
    source: string;
  }[];
}

export function QualityWorkspace({
  profile,
  busy,
  connectionError,
  act,
}: {
  profile: string;
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [stageFilter, setStageFilter] = useState("all");
  const [testQuestion, setTestQuestion] = useState("");
  const [testAnswer, setTestAnswer] = useState("");
  const [testHasImage, setTestHasImage] = useState(false);
  const [testResult, setTestResult] = useState<{
    passed: boolean;
    stage?: string;
    reason?: string;
  } | null>(null);

  const disabledCommon = busy || Boolean(connectionError);

  async function loadAudits() {
    setAudits(await api<AuditEntry[]>("audits?profileId=" + profile));
  }

  useEffect(() => {
    void loadAudits().catch(() => {});
  }, [profile]);

  const stages = Array.from(new Set(audits.map((a) => a.stage)));
  const visibleAudits =
    stageFilter === "all"
      ? audits
      : audits.filter((a) => a.stage === stageFilter);

  return (
    <div className="space-y-6">
      {/* Live Firewall Tester */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <ShieldCheck className="h-5 w-5 text-emerald-900" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              مختبر فايروول جودة الأسئلة (Question Quality Firewall)
            </h2>
            <p className="text-xs text-slate-500">
              افحص أي سؤال برمجيًا ضد تسريب الإجابة (بالأرقام الهندية أو العربية أو الكلمات)، التكرار الفكري، أو غياب الصورة المطلوبة
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
            نص السؤال للاختبار
            <textarea
              rows={2}
              value={testQuestion}
              onChange={(e) => setTestQuestion(e.target.value)}
              placeholder="مثال: ما هي السنة التي أقيمت فيها كأس العالم 2026؟"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            الإجابة
            <input
              value={testAnswer}
              onChange={(e) => setTestAnswer(e.target.value)}
              placeholder="مثال: 2026"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
            />
          </label>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={testHasImage}
                onChange={(e) => setTestHasImage(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-800"
              />
              السؤال مرفق بصورة
            </label>
          </div>
        </div>

        <button
          type="button"
          disabled={disabledCommon || !testQuestion.trim() || !testAnswer.trim()}
          onClick={() =>
            void act(async () => {
              setTestResult(
                await api("questions/check-quality", {
                  profileId: profile,
                  question: testQuestion,
                  answer: testAnswer,
                  hasImage: testHasImage,
                }),
              );
            })
          }
          className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-950 disabled:opacity-50"
        >
          فحص السؤال الآن
        </button>

        {testResult && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm font-medium ${
              testResult.passed
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {testResult.passed
              ? "اجتاز السؤال جميع قواعد الفايروول الصارمة."
              : `مرفوض (${stageLabels[testResult.stage || "firewall"] || testResult.stage}): ${testResult.reason}`}
          </div>
        )}
      </section>

      {/* Audit Log */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                سجل تدقيق الجودة والاستبعادات ({visibleAudits.length})
              </h3>
              <p className="text-xs text-slate-500">
                الأسئلة والصور المرفوضة أثناء الإنتاج لضمان عدم وصول أي سؤال ضعيف أو مكرر للمكتبة
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="تصفية مرحلة التدقيق"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
            >
              <option value="all">كل مراحل التدقيق</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {stageLabels[s] || s}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={disabledCommon}
              onClick={() => void act(loadAudits)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث
            </button>
          </div>
        </div>

        {!visibleAudits.length ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-500">
            لا توجد حالات رفض مسجلة في هذا الملف حتى الآن.
          </p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {visibleAudits.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-900">
                  <span>{stageLabels[entry.stage] || entry.stage}</span>
                  <span className="font-mono text-slate-400">
                    #{entry.jobId.slice(0, 8)}
                  </span>
                </div>
                <p className="mt-1 text-slate-700">{entry.reason}</p>
                {entry.candidate && (
                  <p className="mt-1 text-slate-500">{entry.candidate}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function ExportPreviewWorkspace({
  profile,
  busy,
  connectionError,
  act,
}: {
  profile: string;
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [preview, setPreview] = useState<ExportPreviewData | null>(null);

  async function loadPreview() {
    setPreview(
      await api<ExportPreviewData>("export/preview?profileId=" + profile),
    );
  }

  useEffect(() => {
    void loadPreview().catch(() => {});
  }, [profile]);

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              معاينة التصدير النهائي · {preview?.profileName || "الملف النشط"}
            </h2>
            <p className="text-xs text-slate-500">
              راجع مطابقة الأعمدة، الصور المرفقة، وحالة الحقوق قبل تنزيل الحزمة النهائية لألعابك
            </p>
          </div>
          <button
            type="button"
            disabled={busy || Boolean(connectionError)}
            onClick={() => void act(loadPreview)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث المعاينة
          </button>
        </div>

        {preview && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-slate-800 tabular-nums">
              <span>إجمالي الصفوف: {preview.total}</span>
              <span>·</span>
              <span>الأسئلة المصوّرة الجاهزة: {preview.withImages}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {["json", "csv", "xlsx", "zip"].map((f) => (
                <a
                  key={f}
                  href={"/api/export/" + f + "?profileId=" + profile}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-950"
                >
                  <Download className="h-3.5 w-3.5" />
                  تصدير {f.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        )}

        {!preview?.rows.length ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-500">
            المكتبة فارغة في هذا الملف. أنتج أسئلة أو استوردها ثم عد للمعاينة.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-right text-xs">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-bold">
                    #
                  </th>
                  {preview.headers.map((h) => (
                    <th
                      key={h}
                      className="border-b border-slate-200 px-3 py-2.5 font-bold"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-3 py-2.5 font-bold">
                    معاينة الصورة والحقوق
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5 font-bold">
                    التقييم
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {preview.rows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-mono text-slate-500 tabular-nums">
                      {idx + 1}
                    </td>
                    {preview.headers.map((h) => (
                      <td
                        key={h}
                        className="max-w-xs px-3 py-2.5 align-top text-slate-800"
                      >
                        <div className="line-clamp-3 break-words">
                          {row.mapped[h] || "—"}
                        </div>
                      </td>
                    ))}
                    <td className="px-3 py-2.5 align-top">
                      {row.imageId ? (
                        <div className="flex items-center gap-2">
                          <img
                            src={"/api/assets/" + row.imageId}
                            alt="معاينة التصدير"
                            className="h-12 w-12 rounded border border-slate-200 bg-slate-50 object-contain"
                          />
                          <span className="text-[11px] text-slate-600">
                            {row.imageLicense || "موثقة"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">بدون صورة</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800 tabular-nums">
                      {row.score !== null ? `${row.score}/100` : "يدوي"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
