import React, { useState } from "react";
import { Upload, Wand2, Sliders, Sparkles } from "lucide-react";
import { base64, frame } from "../media";
import type { Asset } from "../types";

interface Props {
  assets: Asset[];
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
  busy: boolean;
  onUploadAsset: (payload: {
    data: string;
    rights: true;
    credit: string;
    origin: string;
  }) => Promise<void>;
  onTransformAsset: (payload: {
    assetId: string;
    style: string;
    mode: "local" | "ai";
    subjectHint?: string;
  }) => Promise<void>;
  onGenerateAsset: (payload: {
    prompt: string;
    assetId?: string;
    model: "gemini-3.1-flash-lite-image" | "gemini-nano-banana-2.1";
    aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
    imageSize: "1K" | "2K" | "4K";
    useSearch: boolean;
  }) => Promise<void>;
}

const STYLE_OPTIONS = [
  { value: "sketch", label: "رسم بالقلم (Sketch)" },
  { value: "bw", label: "أبيض وأسود (Black & White)" },
  { value: "silhouette", label: "ظل معزول (Silhouette)" },
  { value: "cartoon", label: "كرتون (Cartoon)" },
];

export function MediaLab({
  assets,
  selectedAssetId,
  onSelectAsset,
  busy,
  onUploadAsset,
  onTransformAsset,
  onGenerateAsset,
}: Props) {
  const [file, setFile] = useState<File>();
  const [rights, setRights] = useState(false);
  const [credit, setCredit] = useState("");
  const [time, setTime] = useState(0);

  const [style, setStyle] = useState("sketch");
  const [transformMode, setTransformMode] = useState<"local" | "ai">("local");
  const [subjectHint, setSubjectHint] = useState("");

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<
    "gemini-3.1-flash-lite-image" | "gemini-nano-banana-2.1"
  >("gemini-3.1-flash-lite-image");
  const [aspectRatio, setAspectRatio] = useState<
    "1:1" | "3:4" | "4:3" | "9:16" | "16:9"
  >("1:1");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [useSearch, setUseSearch] = useState(false);

  const activeMeta = assets.find((a) => a.id === selectedAssetId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Upload className="w-4 h-4 text-emerald-900" />
            <h2 className="text-lg font-bold text-slate-900">
              إضافة صورة أو إطار فيديو
            </h2>
          </div>

          <label className="block text-xs font-medium text-slate-700">
            ملف الوسائط (صورة أو فيديو مصرح به)
            <input
              aria-label="ملف الوسائط"
              type="file"
              accept="image/*,video/*"
              className="mt-1.5 block w-full text-sm text-slate-700 file:ml-3 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-800 hover:file:bg-slate-100"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>

          {file?.type.startsWith("video/") && (
            <label className="block text-xs font-medium text-slate-700">
              الثانية
              <input
                type="number"
                min="0"
                step=".1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
                value={time}
                onChange={(e) => setTime(Number(e.target.value))}
              />
            </label>
          )}

          <label className="block text-xs font-medium text-slate-700">
            صاحب الصورة أو المقطع
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="مثال: تصوير خاص أو اسم المصور"
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
            />
          </label>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            لدي إذن الاستخدام
          </label>

          <button
            type="button"
            disabled={busy || !file || !rights || !credit.trim()}
            onClick={() => {
              if (!file) return;
              const isVideo = file.type.startsWith("video/");
              void (async () => {
                const payloadData = await base64(
                  isVideo ? await frame(file, time) : file,
                );
                await onUploadAsset({
                  data: payloadData,
                  rights: true,
                  credit: credit.trim(),
                  origin: isVideo ? `${file.name} @ ${time}s` : file.name,
                });
              })();
            }}
            className="w-full rounded-md bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            حفظ في المكتبة
          </button>
        </section>

        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-900" />
              <h2 className="text-lg font-bold text-slate-900">
                معالجة الصور والتوليد الذكي
              </h2>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              {assets.length} أصل محفوظ
            </span>
          </div>

          <label className="block text-xs font-medium text-slate-700">
            الصورة الأصلية
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={selectedAssetId}
              onChange={(e) => onSelectAsset(e.target.value)}
            >
              <option value="">توليد صورة جديدة بالكامل</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.origin} · {a.id.slice(0, 6)}
                </option>
              ))}
            </select>
          </label>

          {selectedAssetId && (
            <div className="flex flex-col sm:flex-row items-start gap-4 bg-slate-50 border border-slate-200 rounded-md p-3">
              <img
                src={"/api/assets/" + selectedAssetId}
                alt="الصورة المحددة"
                className="w-44 h-44 object-contain rounded border border-slate-200 bg-white shrink-0"
              />
              {activeMeta && (
                <div className="text-xs text-slate-600 space-y-1.5 min-w-0">
                  <p className="font-semibold text-slate-900">بيانات الصورة</p>
                  <p className="break-all">المصدر: {activeMeta.origin}</p>
                  <p>النسبة: {activeMeta.credit}</p>
                  <p>الترخيص: {activeMeta.license}</p>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              تحويل صور اللاعبين والأهداف والمشاهد
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-slate-700">
                التأثير المحلي أو الذكي
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  {STYLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-slate-700">
                محرك التحويل
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={transformMode}
                  onChange={(e) =>
                    setTransformMode(e.target.value as "local" | "ai")
                  }
                >
                  <option value="local">معالجة محلية فورية (Sharp)</option>
                  <option value="ai">
                    عزل ذكي بالذكاء الاصطناعي (Gemini Vision)
                  </option>
                </select>
              </label>
            </div>

            {transformMode === "ai" && (
              <label className="block text-xs font-medium text-slate-700">
                وصف العنصر المراد عزله (اختياري)
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="مثال: لاعب كرة قدم، أو معلم أثري، أو طائرة"
                  value={subjectHint}
                  onChange={(e) => setSubjectHint(e.target.value)}
                />
              </label>
            )}

            <button
              type="button"
              disabled={busy || !selectedAssetId}
              onClick={() =>
                void onTransformAsset({
                  assetId: selectedAssetId,
                  style,
                  mode: transformMode,
                  subjectHint,
                })
              }
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <Wand2 className="w-4 h-4 text-emerald-900" />
              تطبيق التأثير
            </button>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                توليد وتعديل الصور بأحدث نماذج Gemini
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                نماذج توليد الصور تتطلب مفتاحًا مفعّل الفوترة، بينما الفلاتر المحلية والبحث عن الصور الحقيقية مجانية دائمًا.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <label
                className={`block text-xs font-medium text-slate-700 ${
                  model === "gemini-nano-banana-2.1"
                    ? "sm:col-span-7"
                    : "sm:col-span-8"
                }`}
              >
                نموذج التوليد
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={model}
                  onChange={(e) => setModel(e.target.value as any)}
                >
                  <option value="gemini-3.1-flash-lite-image">
                    Gemini 3.1 Flash Lite Image (سريع)
                  </option>
                  <option value="gemini-nano-banana-2.1">
                    Nano Banana 2.1 (فائق الدقة 4K)
                  </option>
                </select>
              </label>

              <label
                className={`block text-xs font-medium text-slate-700 ${
                  model === "gemini-nano-banana-2.1"
                    ? "sm:col-span-3"
                    : "sm:col-span-4"
                }`}
              >
                نسبة الأبعاد
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono-num"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as any)}
                >
                  <option value="1:1">1:1</option>
                  <option value="4:3">4:3</option>
                  <option value="16:9">16:9</option>
                  <option value="3:4">3:4</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>

              {model === "gemini-nano-banana-2.1" && (
                <label className="sm:col-span-2 block text-xs font-medium text-slate-700">
                  الدقة
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono-num"
                    value={imageSize}
                    onChange={(e) => setImageSize(e.target.value as any)}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </label>
              )}
            </div>

            {model === "gemini-nano-banana-2.1" && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSearch}
                  onChange={(e) => setUseSearch(e.target.checked)}
                />
                تفعيل البحث البصري من Google كمرجع للتوليد
              </label>
            )}

            <label className="block text-xs font-medium text-slate-700">
              وصف التوليد أو التعديل
              <textarea
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[72px]"
                placeholder="مثال: أزل الخلفية واجعل العنصر على خلفية بيضاء نظيفة بدون نصوص"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>

            <button
              type="button"
              disabled={busy || !prompt.trim()}
              onClick={() =>
                void onGenerateAsset({
                  prompt: prompt.trim(),
                  assetId: selectedAssetId || undefined,
                  model,
                  aspectRatio,
                  imageSize,
                  useSearch,
                })
              }
              className="inline-flex items-center gap-2 rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              تنفيذ باستخدام Gemini
            </button>
          </div>
        </section>
      </div>

      {assets.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">معرض الوسائط</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAsset(a.id)}
                className={`text-right rounded-md border p-2 transition-colors ${
                  selectedAssetId === a.id
                    ? "border-emerald-900 bg-emerald-50/40"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <img
                  src={"/api/assets/" + a.id}
                  alt={a.origin}
                  className="w-full h-24 object-cover rounded bg-slate-100"
                />
                <p className="mt-1.5 text-xs font-medium text-slate-800 truncate">
                  {a.origin}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {a.license}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
