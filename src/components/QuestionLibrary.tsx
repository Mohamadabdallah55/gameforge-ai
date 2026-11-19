import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Pencil,
  Trash2,
  Plus,
  Search,
  Eye,
  X,
  Download,
  ExternalLink,
} from "lucide-react";
import { levels } from "../../shared/contracts";
import {
  AUDIT_LABELS,
  LEVEL_LABELS,
  type Asset,
  type Level,
  type Question,
} from "../types";

interface Props {
  profileId: string;
  questions: Question[];
  assets: Asset[];
  busy: boolean;
  onCreateQuestion: (input: {
    question: string;
    answer: string;
    difficulty: Level;
    source: string;
    quote: string;
    image: string | null;
  }) => Promise<void>;
  onUpdateQuestion: (
    id: string,
    patch: Partial<
      Pick<
        Question,
        | "question"
        | "answer"
        | "difficulty"
        | "source"
        | "quote"
        | "image"
        | "auditStatus"
      >
    >,
  ) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onBulkAction: (
    ids: string[],
    action: "delete" | "clear-image" | "set-difficulty" | "mark-verified",
    difficulty?: Level,
  ) => Promise<void>;
}

export function QuestionLibrary({
  profileId,
  questions,
  assets,
  busy,
  onCreateQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onBulkAction,
}: Props) {
  const [search, setSearch] = useState("");
  const [diffFilter, setDiffFilter] = useState<string>("all");
  const [imgFilter, setImgFilter] = useState<string>("all");
  const [auditFilter, setAuditFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Question | null>(null);
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState("");
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);

  const [form, setForm] = useState({
    question: "",
    answer: "",
    difficulty: "medium" as Level,
    source: "https://gameforge.local",
    quote: "",
    image: "" as string,
  });

  const filtered = useMemo(() => {
    const qLower = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (diffFilter !== "all" && q.difficulty !== diffFilter) return false;
      if (imgFilter === "with" && !q.image) return false;
      if (imgFilter === "without" && q.image) return false;
      const st = q.auditStatus ?? "pending";
      if (auditFilter !== "all" && st !== auditFilter) return false;
      if (
        qLower &&
        !q.question.toLowerCase().includes(qLower) &&
        !q.answer.toLowerCase().includes(qLower) &&
        !q.quote.toLowerCase().includes(qLower)
      ) {
        return false;
      }
      return true;
    });
  }, [questions, search, diffFilter, imgFilter, auditFilter]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) setSelectedIds([]);
    else setSelectedIds(filtered.map((q) => q.id));
  };

  const openEdit = (q: Question) => {
    setModalError("");
    setEditing(q);
    setForm({
      question: q.question,
      answer: q.answer,
      difficulty: q.difficulty,
      source: q.source,
      quote: q.quote,
      image: q.image || "",
    });
  };

  const openCreate = () => {
    setModalError("");
    setCreating(true);
    setForm({
      question: "",
      answer: "",
      difficulty: "medium",
      source: "https://gameforge.local",
      quote: "",
      image: "",
    });
  };

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              مكتبة الأسئلة ({questions.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              المعروض: {filtered.length} · مصوّرة:{" "}
              {questions.filter((q) => q.image).length} · مدققة:{" "}
              {questions.filter((q) => q.auditStatus === "verified").length}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              إضافة سؤال يدويًا
            </button>
            {["json", "csv", "xlsx", "zip"].map((f) => (
              <a
                key={f}
                href={"/api/export/" + f + "?profileId=" + profileId}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                تنزيل {f.toUpperCase()}
              </a>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <label className="md:col-span-5 relative block">
            <span className="sr-only">بحث في الأسئلة</span>
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
            <input
              type="search"
              placeholder="ابحث في نص السؤال أو الإجابة أو الدليل..."
              className="w-full rounded-md border border-slate-300 pr-9 pl-3 py-2 text-sm focus:border-emerald-800 focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="تصفية حسب الصعوبة"
            className="md:col-span-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={diffFilter}
            onChange={(e) => setDiffFilter(e.target.value)}
          >
            <option value="all">كل المستويات</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
          <select
            aria-label="تصفية حسب الصورة"
            className="md:col-span-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={imgFilter}
            onChange={(e) => setImgFilter(e.target.value)}
          >
            <option value="all">كل الصور</option>
            <option value="with">مصوّر فقط</option>
            <option value="without">بدون صورة</option>
          </select>
          <select
            aria-label="تصفية حسب التدقيق"
            className="md:col-span-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={auditFilter}
            onChange={(e) => setAuditFilter(e.target.value)}
          >
            <option value="all">كل حالات التدقيق</option>
            <option value="verified">مدقق</option>
            <option value="flagged">بحاجة لمراجعة</option>
            <option value="pending">غير مدقق</option>
          </select>
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  filtered.length > 0 && selectedIds.length === filtered.length
                }
                onChange={toggleSelectAll}
              />
              تحديد الكل ({selectedIds.length} محدد)
            </label>
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void onBulkAction(selectedIds, "mark-verified").then(() =>
                      setSelectedIds([]),
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-800 hover:bg-slate-100"
                >
                  اعتماد المحدد
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void onBulkAction(selectedIds, "clear-image").then(() =>
                      setSelectedIds([]),
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-800 hover:bg-slate-100"
                >
                  إزالة الصور
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void onBulkAction(selectedIds, "delete").then(() =>
                      setSelectedIds([]),
                    )
                  }
                  className="rounded border border-red-200 bg-white px-2.5 py-1 text-red-700 hover:bg-red-50"
                >
                  حذف المحدد
                </button>
              </div>
            )}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700">
              لا توجد أسئلة مطابقة حاليًا
            </p>
            <p className="text-xs text-slate-500">
              ابدأ مهمة إنتاج من «الإنتاج» أو أضف سؤالاً يدويًا لبناء مكتبة هذه اللعبة.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filtered.map((q) => {
              const st = q.auditStatus ?? "pending";
              const assetMeta = assets.find((a) => a.id === q.image);
              return (
                <article
                  key={q.id}
                  className="py-4 flex flex-col lg:flex-row lg:items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      aria-label={"تحديد السؤال " + q.question}
                      className="mt-1 shrink-0"
                      checked={selectedIds.includes(q.id)}
                      onChange={() => toggleSelect(q.id)}
                    />
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-medium text-slate-700">
                          {LEVEL_LABELS[q.difficulty]}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          {st === "verified" ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                          ) : st === "flagged" ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          {AUDIT_LABELS[st]}
                        </span>
                        {q.image && assetMeta && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>ترخيص الصورة: {assetMeta.license}</span>
                          </>
                        )}
                      </div>

                      <h3 className="text-base font-semibold text-slate-900 leading-snug">
                        {q.question}
                      </h3>
                      <p className="text-sm text-emerald-900 font-medium">
                        الإجابة: {q.answer}
                      </p>

                      {q.auditNote && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1">
                          {q.auditNote}
                        </p>
                      )}

                      <details className="text-xs text-slate-600 pt-1">
                        <summary className="cursor-pointer font-medium text-slate-700 hover:text-emerald-900">
                          دليل الإجابة والمصدر
                        </summary>
                        <div className="mt-2 space-y-1 bg-slate-50 border border-slate-200 rounded p-2.5">
                          <p className="leading-relaxed">{q.quote}</p>
                          <a
                            href={q.source}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-900 underline break-all"
                          >
                            المصدر
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </details>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 shrink-0 lg:w-56">
                    {q.image && (
                      <div className="relative group w-32 h-24 rounded border border-slate-200 bg-slate-100 overflow-hidden">
                        <img
                          src={"/api/assets/" + q.image}
                          alt="صورة السؤال"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setPreviewAssetId(q.image)}
                          aria-label="معاينة الصورة"
                          className="absolute inset-0 bg-slate-900/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-xs font-medium"
                        >
                          <Eye className="w-4 h-4" />
                          معاينة
                        </button>
                      </div>
                    )}

                    <label className="w-full text-xs text-slate-600">
                      صورة السؤال
                      <select
                        value={q.image || ""}
                        disabled={busy}
                        onChange={(e) =>
                          void onUpdateQuestion(q.id, {
                            image: e.target.value || null,
                          })
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
                      >
                        <option value="">بدون صورة</option>
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.origin.slice(0, 26)} · {a.id.slice(0, 6)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEdit(q)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        تحرير
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onDeleteQuestion(q.id)}
                        className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        حذف
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {(editing || creating) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editing ? "محرر السؤال" : "إضافة سؤال جديد"}
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editing ? "تحرير السؤال" : "إضافة سؤال جديد"}
              </h3>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-700">
                نص السؤال
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm min-h-[72px]"
                  value={form.question}
                  onChange={(e) =>
                    setForm({ ...form, question: e.target.value })
                  }
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-700">
                  الإجابة المعتمدة
                  <input
                    type="text"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    value={form.answer}
                    onChange={(e) =>
                      setForm({ ...form, answer: e.target.value })
                    }
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  مستوى الصعوبة
                  <select
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={form.difficulty}
                    onChange={(e) =>
                      setForm({ ...form, difficulty: e.target.value as Level })
                    }
                  >
                    {levels.map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_LABELS[l]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-xs font-medium text-slate-700">
                الاقتباس الداعم
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm min-h-[60px]"
                  value={form.quote}
                  onChange={(e) => setForm({ ...form, quote: e.target.value })}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-700">
                  رابط المصدر
                  <input
                    type="url"
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono-num"
                    value={form.source}
                    onChange={(e) =>
                      setForm({ ...form, source: e.target.value })
                    }
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700">
                  الصورة المرفقة
                  <select
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={form.image}
                    onChange={(e) =>
                      setForm({ ...form, image: e.target.value })
                    }
                  >
                    <option value="">بدون صورة</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.origin.slice(0, 26)} · {a.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {modalError && (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {modalError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                  setModalError("");
                }}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busy || !form.question.trim() || !form.answer.trim()}
                onClick={() => {
                  setModalError("");
                  const action = editing
                    ? onUpdateQuestion(editing.id, {
                        question: form.question,
                        answer: form.answer,
                        difficulty: form.difficulty,
                        source: form.source,
                        quote: form.quote,
                        image: form.image || null,
                      }).then(() => setEditing(null))
                    : onCreateQuestion({
                        question: form.question,
                        answer: form.answer,
                        difficulty: form.difficulty,
                        source: form.source,
                        quote: form.quote,
                        image: form.image || null,
                      }).then(() => setCreating(false));
                  void action.catch((e) =>
                    setModalError(e instanceof Error ? e.message : String(e)),
                  );
                }}
                className="rounded-md bg-emerald-900 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                حفظ التغييرات
              </button>
            </div>
          </div>
        </div>
      )}

      {previewAssetId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة الصورة"
          className="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-4"
          onClick={() => setPreviewAssetId(null)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">
                معاينة الصورة قبل التصدير
              </span>
              <button
                type="button"
                aria-label="إغلاق المعاينة"
                onClick={() => setPreviewAssetId(null)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={"/api/assets/" + previewAssetId}
              alt="معاينة مكبرة"
              className="w-full max-h-[70vh] object-contain rounded border border-slate-200 bg-slate-50"
            />
            {(() => {
              const meta = assets.find((a) => a.id === previewAssetId);
              if (!meta) return null;
              return (
                <div className="text-xs text-slate-600 flex flex-wrap gap-2">
                  <span>المصدر: {meta.origin}</span>
                  <span aria-hidden="true">·</span>
                  <span>الترخيص: {meta.license}</span>
                  <span aria-hidden="true">·</span>
                  <span>النسبة: {meta.credit}</span>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
