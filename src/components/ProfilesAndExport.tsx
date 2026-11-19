import React, { useEffect, useState } from "react";
import { Download, Eye, Plus, Save, Trash2 } from "lucide-react";
import { fields } from "../../shared/contracts";
import { base64 } from "../media";
import type { ExportPreview, Profile } from "../types";

interface Props {
  activeProfileId: string;
  profiles: (Profile & { id: string })[];
  busy: boolean;
  onInferTemplate: (payload: {
    format: string;
    data: string;
  }) => Promise<{
    columns: { name: string }[];
    mapping: Profile["mapping"];
    rows: number;
  }>;
  onCreateProfile: (p: Profile) => Promise<void>;
  onUpdateProfile: (id: string, p: Profile) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onFetchExportPreview: (profileId: string) => Promise<ExportPreview>;
}

const FIELD_LABELS: Record<(typeof fields)[number], string> = {
  question: "السؤال",
  answer: "الإجابة",
  image: "مسار الصورة",
  difficulty: "الصعوبة",
  source: "المصدر",
};

export function ProfilesAndExport({
  activeProfileId,
  profiles,
  busy,
  onInferTemplate,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
  onFetchExportPreview,
}: Props) {
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [mapping, setMapping] = useState<Profile["mapping"]>({});
  const [columns, setColumns] = useState<string[]>([]);

  const [editName, setEditName] = useState("");
  const [editRules, setEditRules] = useState("");
  const [editMapping, setEditMapping] = useState<Profile["mapping"]>({});
  const [preview, setPreview] = useState<ExportPreview | null>(null);

  useEffect(() => {
    if (activeProfile) {
      setEditName(activeProfile.name);
      setEditRules(activeProfile.rules);
      setEditMapping(activeProfile.mapping || {});
    }
  }, [activeProfile]);

  useEffect(() => {
    void onFetchExportPreview(activeProfileId)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [activeProfileId, onFetchExportPreview]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-6 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-900">ملف لعبة جديد</h2>
            <Plus className="w-4 h-4 text-emerald-900" />
          </div>

          <label className="block text-xs font-medium text-slate-700">
            اسم اللعبة
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="block text-xs font-medium text-slate-700">
            قواعد صياغة الأسئلة
            <textarea
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[70px]"
              placeholder="مثال: أسئلة مباشرة بإجابة من كلمة أو كلمتين بدون اختيارات متعددة"
              value={rules}
              onChange={(e) => setRules(e.target.value)}
            />
          </label>

          <label className="block text-xs font-medium text-slate-700">
            استنتاج حقول نموذج JSON أو CSV أو Excel
            <input
              type="file"
              accept=".json,.csv,.xlsx"
              className="mt-1.5 block w-full text-sm text-slate-700 file:ml-3 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-medium"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void (async () => {
                  const res = await onInferTemplate({
                    format: f.name.split(".").pop()?.toLowerCase() || "json",
                    data: await base64(f),
                  });
                  setMapping(res.mapping);
                  setColumns(res.columns.map((c) => c.name));
                })();
              }}
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((k) => (
              <label key={k} className="block text-xs font-medium text-slate-700">
                {FIELD_LABELS[k]}
                <input
                  list="columns"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  value={mapping[k] ?? k}
                  onChange={(e) =>
                    setMapping({ ...mapping, [k]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <datalist id="columns">
            {columns.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              void onCreateProfile({ name, rules, mapping }).then(() => {
                setName("");
                setRules("");
                setMapping({});
              })
            }
            className="w-full rounded-md bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            إنشاء ملف اللعبة
          </button>
        </section>

        <section className="xl:col-span-6 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-900">
              إعدادات الملف النشط
            </h2>
            {activeProfileId !== "default" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDeleteProfile(activeProfileId)}
                className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                حذف الملف
              </button>
            )}
          </div>

          <label className="block text-xs font-medium text-slate-700">
            الاسم
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </label>

          <label className="block text-xs font-medium text-slate-700">
            قواعد الصياغة
            <textarea
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[70px]"
              value={editRules}
              onChange={(e) => setEditRules(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((k) => (
              <label key={k} className="block text-xs font-medium text-slate-700">
                حقل {FIELD_LABELS[k]}
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  value={editMapping[k] ?? k}
                  onChange={(e) =>
                    setEditMapping({ ...editMapping, [k]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={busy || !editName.trim()}
            onClick={() =>
              void onUpdateProfile(activeProfileId, {
                name: editName,
                rules: editRules,
                mapping: editMapping,
              })
            }
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Save className="w-4 h-4 text-emerald-900" />
            حفظ تعديلات الملف
          </button>
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              معاينة التصدير والتوافق مع ألعابك
            </h3>
            {preview && (
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                {preview.profileName} · {preview.totalQuestions} سؤال ·{" "}
                {preview.illustratedCount} سؤال بصورة ({preview.usedAssetsCount}{" "}
                صورة فريدة)
                {preview.missingAssets > 0
                  ? ` · تحذير: ${preview.missingAssets} صورة مفقودة`
                  : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void onFetchExportPreview(activeProfileId).then(setPreview)
              }
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Eye className="w-3.5 h-3.5" />
              تحديث المعاينة
            </button>
            {["json", "csv", "xlsx", "zip"].map((f) => (
              <a
                key={f}
                href={"/api/export/" + f + "?profileId=" + activeProfileId}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <Download className="w-3.5 h-3.5" />
                تصدير {f.toUpperCase()}
              </a>
            ))}
          </div>
        </div>

        {preview && preview.sampleRows.length > 0 ? (
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.sampleRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    {preview.headers.map((h) => (
                      <td
                        key={h}
                        className="px-3 py-2 text-slate-800 max-w-[220px] truncate"
                      >
                        {row[h] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500 py-4">
            لا توجد أسئلة في هذا الملف لعرض معاينة التصدير بعد.
          </p>
        )}
      </section>
    </div>
  );
}
