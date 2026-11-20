import { useState } from "react";
import { Upload, Wand2, SlidersHorizontal, Sparkles } from "lucide-react";
import { artModes, type Asset } from "../../shared/contracts";
import { api } from "../api";
import { base64, frame } from "../media";
import { artLabels } from "./shared";

export function MediaStudioWorkspace({
  assets,
  setAssets,
  selectedAssetId,
  setSelectedAssetId,
  busy,
  connectionError,
  act,
  setMessage,
}: {
  assets: Asset[];
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  selectedAssetId: string;
  setSelectedAssetId: (id: string) => void;
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  setMessage: (msg: string) => void;
}) {
  const [file, setFile] = useState<File>();
  const [rights, setRights] = useState(false);
  const [credit, setCredit] = useState("");
  const [time, setTime] = useState(0);
  const [style, setStyle] = useState("sketch");
  const [prompt, setPrompt] = useState("");
  const [artStyle, setArtStyle] = useState<"" | (typeof artModes)[number]>("");
  const [strength, setStrength] = useState(0.4);
  const [mask, setMask] = useState({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  const [beforeAsset, setBeforeAsset] = useState("");
  const [lastArt, setLastArt] = useState<{
    assetId?: string;
    prompt: string;
    style?: (typeof artModes)[number];
    strength: number;
  }>();

  const disabledCommon = busy || Boolean(connectionError);

  async function saveArt(settings: NonNullable<typeof lastArt>) {
    const version = await api<Asset>("assets/generate", settings);
    setLastArt(settings);
    setBeforeAsset(settings.assetId || "");
    setAssets(await api("assets"));
    setSelectedAssetId(version.id);
    setMessage("حُفظ الإصدار المولّد في مكتبة الوسائط.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Upload Image / Video Frame */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Upload className="h-5 w-5 text-emerald-900" />
          <h2 className="text-base font-bold text-slate-900">
            إضافة صورة أو إطار فيديو
          </h2>
        </div>

        <label className="block text-xs font-semibold text-slate-700">
          ملف الصورة أو الفيديو
          <input
            aria-label="ملف الوسائط"
            type="file"
            accept="image/*,video/*"
            onChange={(e) => setFile(e.target.files?.[0])}
            className="mt-1.5 block w-full text-xs text-slate-600 file:ml-3 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-800 hover:file:bg-slate-100"
          />
        </label>

        {file?.type.startsWith("video/") && (
          <label className="block text-sm font-medium text-slate-700">
            الثانية
            <input
              type="number"
              min="0"
              step=".1"
              value={time}
              onChange={(e) => setTime(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 tabular-nums"
            />
          </label>
        )}

        <label className="block text-sm font-medium text-slate-700">
          صاحب الصورة أو المقطع
          <input
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            placeholder="مثال: مصور المسابقة أو القناة الرسمية"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
          />
        </label>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-800"
          />
          لدي إذن الاستخدام
        </label>

        <button
          type="button"
          disabled={disabledCommon || !file || !rights || !credit}
          onClick={() =>
            void act(async () => {
              if (!file) return;
              const video = file.type.startsWith("video/");
              const a = await api<Asset>("assets", {
                data: await base64(video ? await frame(file, time) : file),
                rights,
                credit,
                origin: video ? file.name + " @ " + time + "s" : file.name,
              });
              setSelectedAssetId(a.id);
              setBeforeAsset("");
              setAssets(await api("assets"));
              setMessage("حُفظت الصورة");
            })
          }
          className="w-full rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          حفظ في المكتبة
        </button>
      </section>

      {/* Media Lab */}
      <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Media Lab · استوديو الصور
            </h2>
            <p className="text-xs text-slate-500">
              تحويلات فنية مجانية فورية (Sketch, Cartoon, Silhouette, B&W, Mask) ومقارنة قبل/بعد
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500 tabular-nums">
            إجمالي الوسائط: {assets.length}
          </span>
        </div>

        <label className="block text-sm font-medium text-slate-700">
          الصورة الأصلية
          <select
            value={selectedAssetId}
            onChange={(e) => {
              setSelectedAssetId(e.target.value);
              setBeforeAsset("");
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">توليد صورة جديدة أو اختر من المكتبة</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.origin} · {a.id.slice(0, 6)}
                {a.transformation ? ` (${a.transformation})` : ""}
              </option>
            ))}
          </select>
        </label>

        {/* Before / After Preview Canvas */}
        {(beforeAsset || selectedAssetId) && (
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2">
            {beforeAsset && (
              <figure className="space-y-2">
                <img
                  src={"/api/assets/" + beforeAsset}
                  alt="الأصل قبل التحويل"
                  className="mx-auto max-h-64 w-full rounded-lg border border-slate-200 bg-white object-contain p-1"
                />
                <figcaption className="text-center text-xs font-semibold text-slate-600">
                  قبل
                </figcaption>
              </figure>
            )}
            {selectedAssetId && (
              <figure
                className={`space-y-2 ${!beforeAsset ? "sm:col-span-2" : ""}`}
              >
                <img
                  src={"/api/assets/" + selectedAssetId}
                  alt="الصورة المحددة"
                  className="mx-auto max-h-64 w-full rounded-lg border border-slate-200 bg-white object-contain p-1"
                />
                <figcaption className="text-center text-xs font-semibold text-slate-800">
                  {beforeAsset ? "بعد" : "الصورة المحددة"}
                </figcaption>
              </figure>
            )}
          </div>
        )}

        {/* Free Instant Sharp Studio */}
        <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <SlidersHorizontal className="h-4 w-4 text-emerald-900" />
            التأثير المحلي الفوري (Sharp Media Engine)
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              التأثير المحلي
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {Object.entries({
                  sketch: "تأثير قلم رصاص (Sketch)",
                  bw: "أبيض وأسود عالي التباين",
                  silhouette: "ظل / سيليويت (Silhouette)",
                  cartoon: "كرتون وتبسيط ألوان",
                  "solid-background": "إزالة خلفية موحّدة",
                  background: "عزل الخلفية (تلقائي / Vision)",
                  "subject-silhouette": "ظل العنصر بعد فصل الخلفية",
                  mask: "إخفاء جزء للتخمين",
                }).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              درجة التأثير {Math.round(strength * 100)}٪
              <input
                type="range"
                min="0.15"
                max="0.85"
                step="0.05"
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
                className="mt-3 w-full accent-emerald-800"
              />
            </label>
          </div>

          {style === "mask" && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-4">
              {Object.entries({
                x: "الموقع الأفقي",
                y: "الموقع العمودي",
                width: "العرض",
                height: "الارتفاع",
              }).map(([field, label]) => (
                <label key={field} className="text-xs font-medium text-slate-700">
                  {label} ({Math.round(mask[field as keyof typeof mask] * 100)}٪)
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={mask[field as keyof typeof mask]}
                    onChange={(event) =>
                      setMask({
                        ...mask,
                        [field]: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full accent-emerald-800"
                  />
                </label>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={disabledCommon || !selectedAssetId}
            onClick={() =>
              void act(async () => {
                const a = await api<Asset>("assets/transform", {
                  assetId: selectedAssetId,
                  style,
                  strength,
                  mask,
                });
                setBeforeAsset(selectedAssetId);
                setAssets(await api("assets"));
                setSelectedAssetId(a.id);
                setMessage("طُبق التأثير المحلي وحُفظت النسخة الجديدة.");
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            تطبيق التأثير
          </button>
        </div>

        {/* Generative AI Art Section (ComfyUI local or Paid Gemini Image key) */}
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Sparkles className="h-4 w-4 text-emerald-900" />
              التحويل الفني والتوليد بالذكاء الاصطناعي
            </div>
            <span className="text-xs text-slate-500">
              يستخدم ComfyUI محليًا أو نموذج توليد الصور المدفوع عند اعتماد الفوترة
            </span>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            التحويل الفني عبر ComfyUI
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value as typeof artStyle)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">وصف حرّ</option>
              {artModes.map((mode) => (
                <option key={mode} value={mode}>
                  {artLabels[mode]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-700">
            وصف التوليد أو التعديل
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="مثال: رسم قلم رصاص نظيف بدون نصوص أو شعارات"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={
                disabledCommon ||
                (!prompt.trim() && !artStyle) ||
                (!!artStyle && !selectedAssetId)
              }
              onClick={() =>
                void act(async () =>
                  saveArt({
                    prompt,
                    assetId: selectedAssetId || undefined,
                    style: artStyle || undefined,
                    strength,
                  }),
                )
              }
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              توليد أو تعديل باستخدام محرك الصور
            </button>
            {lastArt && (
              <button
                type="button"
                disabled={disabledCommon}
                onClick={() =>
                  void act(async () => saveArt({ ...lastArt, strength }))
                }
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                إعادة التوليد من الأصل
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
