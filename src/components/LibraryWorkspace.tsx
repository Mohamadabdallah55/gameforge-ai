import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Trash2,
  Edit3,
  ShieldCheck,
  ImagePlus,
  Download,
  Eye,
} from "lucide-react";
import {
  difficultyPoints,
  levels,
  type Asset,
  type Level,
  type Question,
} from "../../shared/contracts";
import { api } from "../api";
import { difficultyLabels, scoreLabels, type TabId } from "./shared";

interface FirewallCheckResult {
  passed: boolean;
  stage?: string;
  reason?: string;
}

export function LibraryWorkspace({
  profile,
  questions,
  setQuestions,
  assets,
  busy,
  connectionError,
  act,
  setMessage,
  onNavigate,
}: {
  profile: string;
  questions: Question[];
  setQuestions: React.Dispatch<React.SetStateAction<Question[]>>;
  assets: Asset[];
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  setMessage: (msg: string) => void;
  onNavigate: (tab: TabId) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | Level>("all");
  const [imageFilter, setImageFilter] = useState<"all" | "with" | "without">(
    "all",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal state for Create / Edit Question
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formQuestion, setFormQuestion] = useState("");
  const [formAnswer, setFormAnswer] = useState("");
  const [formDifficulty, setFormDifficulty] = useState<Level>("medium");
  const [formSource, setFormSource] = useState("manual");
  const [formQuote, setFormQuote] = useState("");
  const [formImage, setFormImage] = useState<string>("");
  const [firewallCheck, setFirewallCheck] =
    useState<FirewallCheckResult | null>(null);

  const disabledCommon = busy || Boolean(connectionError);

  const filteredQuestions = useMemo(() => {
    const qLower = searchTerm.trim().toLowerCase();
    return questions.filter((item) => {
      if (levelFilter !== "all" && item.difficulty !== levelFilter)
        return false;
      if (imageFilter === "with" && !item.image) return false;
      if (imageFilter === "without" && item.image) return false;
      if (qLower) {
        const hay =
          `${item.question} ${item.answer} ${item.source} ${item.quote}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [questions, searchTerm, levelFilter, imageFilter]);

  function openCreateModal() {
    setEditingId(null);
    setFormQuestion("");
    setFormAnswer("");
    setFormDifficulty("medium");
    setFormSource("manual");
    setFormQuote("");
    setFormImage("");
    setFirewallCheck(null);
    setEditorOpen(true);
  }

  function openEditModal(q: Question) {
    setEditingId(q.id);
    setFormQuestion(q.question);
    setFormAnswer(q.answer);
    setFormDifficulty(q.difficulty);
    setFormSource(q.source || "manual");
    setFormQuote(q.quote || "");
    setFormImage(q.image || "");
    setFirewallCheck(null);
    setEditorOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header & Export Bar */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              مكتبة الأسئلة ({questions.length})
            </h2>
            <p className="text-xs text-slate-500">
              تحرير الأسئلة وتدقيقها وإرفاق الصور والتصدير بالصيغ المعتمدة
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabledCommon}
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-950 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              إضافة سؤال يدويًا
            </button>
            <button
              type="button"
              disabled={disabledCommon || !questions.some((q) => !q.image)}
              onClick={() =>
                void act(async () => {
                  await api("jobs/images", { profileId: profile });
                  onNavigate("الإنتاج");
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" />
              إضافة صور حقيقية للأسئلة دفعة واحدة
            </button>
          </div>
        </div>

        {/* Export Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {["json", "csv", "xlsx", "zip"].map((f) => (
              <a
                key={f}
                href={"/api/export/" + f + "?profileId=" + profile}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                تنزيل {f.toUpperCase()}
              </a>
            ))}
            <button
              type="button"
              onClick={() => onNavigate("التصدير")}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-800/30 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-100/70"
            >
              <Eye className="h-3.5 w-3.5" />
              معاينة قبل التصدير
            </button>
          </div>

          {selectedIds.length > 0 && (
            <button
              type="button"
              disabled={disabledCommon}
              onClick={() =>
                void act(async () => {
                  const res = await api<{ removed: number }>(
                    "questions/bulk-delete",
                    {
                      profileId: profile,
                      ids: selectedIds,
                    },
                  );
                  setQuestions(await api("questions?profileId=" + profile));
                  setSelectedIds([]);
                  setMessage(`حُذف ${res.removed} سؤالًا من المكتبة.`);
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف المحدد ({selectedIds.length})
            </button>
          )}
        </div>

        {/* Search & Filters */}
        <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-12">
          <label className="relative block sm:col-span-6">
            <span className="sr-only">بحث في المكتبة</span>
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث في نص السؤال أو الإجابة أو المصدر..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-800 focus:outline-none"
            />
          </label>
          <select
            aria-label="تصفية الصعوبة"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as "all" | Level)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-3"
          >
            <option value="all">كل المستويات</option>
            <option value="easy">200 · سهل</option>
            <option value="medium">400 · متوسط</option>
            <option value="hard">600 · صعب</option>
          </select>
          <select
            aria-label="تصفية الصور"
            value={imageFilter}
            onChange={(e) =>
              setImageFilter(e.target.value as "all" | "with" | "without")
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:col-span-3"
          >
            <option value="all">كل الأسئلة (بصور وبدون)</option>
            <option value="with">أسئلة مع صورة فقط</option>
            <option value="without">أسئلة بدون صورة</option>
          </select>
        </div>
      </section>

      {/* Inline Editor Modal / Panel */}
      {editorOpen && (
        <section className="space-y-4 rounded-xl border border-emerald-700/40 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              {editingId ? "تعديل السؤال وفحص جودته" : "إضافة سؤال جديد للمكتبة"}
            </h3>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              إغلاق
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
              نص السؤال
              <textarea
                rows={2}
                value={formQuestion}
                onChange={(e) => setFormQuestion(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              الإجابة الدقيقة
              <input
                value={formAnswer}
                onChange={(e) => setFormAnswer(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              المستوى
              <select
                value={formDifficulty}
                onChange={(e) => setFormDifficulty(e.target.value as Level)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                {levels.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {difficultyLabels[lvl]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              المصدر (رابط أو مرجع)
              <input
                value={formSource}
                onChange={(e) => setFormSource(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              صورة مرفقة (اختياري)
              <select
                value={formImage}
                onChange={(e) => setFormImage(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">بدون صورة</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.origin} · {a.id.slice(0, 6)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
              دليل الإجابة / الاقتباس
              <input
                value={formQuote}
                onChange={(e) => setFormQuote(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
          </div>

          {firewallCheck && (
            <div
              className={`rounded-lg border px-3.5 py-2.5 text-sm font-medium ${
                firewallCheck.passed
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {firewallCheck.passed
                ? "اجتاز السؤال فحص فايروول الجودة بنجاح (لا يوجد تسريب إجابة أو تكرار هيكلي)."
                : `ملاحظة فايروول الجودة: ${firewallCheck.reason}`}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={disabledCommon || !formQuestion.trim() || !formAnswer.trim()}
              onClick={() =>
                void act(async () => {
                  const res = await api<FirewallCheckResult>(
                    "questions/check-quality",
                    {
                      profileId: profile,
                      question: formQuestion,
                      answer: formAnswer,
                      hasImage: Boolean(formImage),
                      excludeId: editingId || undefined,
                    },
                  );
                  setFirewallCheck(res);
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <ShieldCheck className="h-4 w-4" />
              فحص فايروول الجودة
            </button>
            <button
              type="button"
              disabled={disabledCommon || !formQuestion.trim() || !formAnswer.trim()}
              onClick={() =>
                void act(async () => {
                  if (editingId) {
                    await api(
                      "questions/" + editingId,
                      {
                        profileId: profile,
                        question: formQuestion,
                        answer: formAnswer,
                        difficulty: formDifficulty,
                        source: formSource,
                        quote: formQuote,
                        image: formImage || null,
                      },
                      "PATCH",
                    );
                    setMessage("تم تحديث السؤال بنجاح.");
                  } else {
                    await api("questions", {
                      profileId: profile,
                      question: formQuestion,
                      answer: formAnswer,
                      difficulty: formDifficulty,
                      source: formSource,
                      quote: formQuote,
                      image: formImage || null,
                    });
                    setMessage("أُضيف السؤال إلى المكتبة.");
                  }
                  setQuestions(await api("questions?profileId=" + profile));
                  setEditorOpen(false);
                })
              }
              className="rounded-lg bg-emerald-900 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-950 disabled:opacity-50"
            >
              {editingId ? "حفظ التعديلات" : "إضافة السؤال"}
            </button>
          </div>
        </section>
      )}

      {/* Question Cards List */}
      {!filteredQuestions.length ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          لا توجد أسئلة مطابقة للتصفية الحالية.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredQuestions.map((q) => {
            const isSelected = selectedIds.includes(q.id);
            return (
              <article
                key={q.id}
                className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`تحديد السؤال: ${q.question}`}
                      checked={isSelected}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked
                            ? [...prev, q.id]
                            : prev.filter((id) => id !== q.id),
                        )
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-800"
                    />
                    <div className="space-y-1.5">
                      <strong className="block text-base font-bold text-slate-900">
                        {q.question}
                      </strong>
                      <p className="text-sm font-semibold text-emerald-900 tabular-nums">
                        {q.answer} · {difficultyPoints[q.difficulty]}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={disabledCommon}
                      onClick={() => openEditModal(q)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      تعديل
                    </button>
                    <button
                      type="button"
                      disabled={disabledCommon}
                      onClick={() =>
                        void act(async () => {
                          await api(
                            "questions/" + q.id + "?profileId=" + profile,
                            undefined,
                            "DELETE",
                          );
                          setQuestions(
                            await api("questions?profileId=" + profile),
                          );
                          setSelectedIds((prev) =>
                            prev.filter((id) => id !== q.id),
                          );
                          setMessage("حُذف السؤال من المكتبة.");
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-12">
                  <div className="space-y-3 md:col-span-8">
                    {q.quality && (
                      <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        <summary className="cursor-pointer font-semibold text-slate-900 tabular-nums">
                          {q.quality.score === undefined
                            ? "تفاصيل السؤال"
                            : `تقييم الجودة ${q.quality.score}/100`}{" "}
                          · {q.quality.facet}
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          <p>{q.quality.event}</p>
                          <p>{q.quality.fact}</p>
                          {q.quality.visual && (
                            <p className="font-medium text-slate-800">
                              التحليل البصري · {q.quality.visual.description} ·{" "}
                              {q.quality.visual.value}/100
                            </p>
                          )}
                          {q.quality.imageNote && <p>{q.quality.imageNote}</p>}
                          {q.quality.scores && (
                            <ul className="mt-2 grid grid-cols-2 gap-1.5 border-t border-slate-200 pt-2 sm:grid-cols-4">
                              {Object.entries(q.quality.scores).map(
                                ([key, value]) => (
                                  <li key={key} className="tabular-nums">
                                    {scoreLabels[key] || key} {value}/100
                                  </li>
                                ),
                              )}
                            </ul>
                          )}
                        </div>
                      </details>
                    )}

                    <label className="block text-xs font-medium text-slate-700">
                      صورة السؤال
                      <select
                        value={q.image || ""}
                        disabled={busy}
                        onChange={(e) => {
                          const assetId = e.target.value || null;
                          void act(async () => {
                            await api("questions/" + q.id + "/image", {
                              profileId: profile,
                              assetId,
                            });
                            setQuestions(
                              await api("questions?profileId=" + profile),
                            );
                          });
                        }}
                        className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                      >
                        <option value="">بدون صورة</option>
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.origin} · {a.id.slice(0, 6)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <details className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
                      <summary className="cursor-pointer font-semibold text-slate-900">
                        دليل الإجابة
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        <p>{q.quote || "—"}</p>
                        {q.quality?.sourceSelectionReason && (
                          <p>
                            سبب اختيار المصدر · {q.quality.sourceSelectionReason}
                          </p>
                        )}
                        <a
                          href={q.source}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block font-semibold text-emerald-800 underline underline-offset-4"
                        >
                          المصدر
                        </a>
                      </div>
                    </details>
                  </div>

                  {q.image && (
                    <div className="flex items-start justify-end md:col-span-4">
                      <img
                        src={"/api/assets/" + q.image}
                        alt="صورة السؤال"
                        className="max-h-48 w-full rounded-lg border border-slate-200 object-contain bg-slate-50 p-1"
                      />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
