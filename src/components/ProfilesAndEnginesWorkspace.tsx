import { useEffect, useState } from "react";
import { Cloud, Cpu, RefreshCw, Save } from "lucide-react";
import { fields, type Plan, type Profile } from "../../shared/contracts";
import { api } from "../api";
import { ChatTransfer } from "../chat-transfer";
import { ChatGPTControls } from "../chatgpt";
import { base64 } from "../media";
import type { TabId } from "./shared";

const fieldLabels: Record<(typeof fields)[number], string> = {
  question: "السؤال",
  answer: "الإجابة",
  image: "مسار الصورة",
  difficulty: "الصعوبة",
  source: "المصدر",
};

export function ProfilesWorkspace({
  profile,
  setProfile,
  profiles,
  setProfiles,
  plan,
  request,
  setQuestions,
  busy,
  connectionError,
  act,
  setMessage,
  onNavigate,
}: {
  profile: string;
  setProfile: (id: string) => void;
  profiles: (Profile & { id: string })[];
  setProfiles: React.Dispatch<React.SetStateAction<(Profile & { id: string })[]>>;
  plan: Plan;
  request: string;
  setQuestions: React.Dispatch<React.SetStateAction<any[]>>;
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  setMessage: (msg: string) => void;
  onNavigate: (tab: TabId) => void;
}) {
  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [mapping, setMapping] = useState<Profile["mapping"]>({});
  const [columns, setColumns] = useState<string[]>([]);

  const activeProfile = profiles.find((p) => p.id === profile);
  const [editRules, setEditRules] = useState(activeProfile?.rules || "");
  const [editMapping, setEditMapping] = useState<Profile["mapping"]>(
    activeProfile?.mapping || {},
  );

  useEffect(() => {
    if (activeProfile) {
      setEditRules(activeProfile.rules || "");
      setEditMapping(activeProfile.mapping || {});
    }
  }, [activeProfile?.id, activeProfile?.rules]);

  const disabledCommon = busy || Boolean(connectionError);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Create New Profile */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-900">ملف لعبة جديد</h2>
            <p className="text-xs text-slate-500">
              استنتج أعمدة لعبتك من ملف JSON أو CSV أو Excel أو عرّف القواعد والمفاتيح يدويًا
            </p>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            اسم اللعبة
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: تحدي الثلاثين · الموسم الجديد"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            قواعد صياغة الأسئلة
            <textarea
              rows={3}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="مثال: إجابة مباشرة مختصرة، بدون اختيارات، منع الأسئلة المكررة"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            استنتاج حقول نموذج JSON أو CSV أو Excel
            <input
              type="file"
              accept=".json,.csv,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void act(async () => {
                    const t = await api("templates/infer", {
                      format: f.name.split(".").pop()?.toLowerCase(),
                      data: await base64(f),
                    });
                    setMapping(t.mapping);
                    setColumns(t.columns.map((c: { name: string }) => c.name));
                    setMessage("عدد سجلات النموذج " + t.rows);
                  });
              }}
              className="mt-1.5 block w-full text-xs text-slate-600 file:ml-3 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-800"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((k) => (
              <label key={k} className="block text-xs font-medium text-slate-700">
                {fieldLabels[k]}
                <input
                  list="columns"
                  value={mapping[k] ?? k}
                  onChange={(e) =>
                    setMapping({ ...mapping, [k]: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
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
            disabled={disabledCommon || !name.trim()}
            onClick={() =>
              void act(async () => {
                const p = await api<Profile & { id: string }>("profiles", {
                  name,
                  rules,
                  mapping,
                });
                setProfiles(await api("profiles"));
                setProfile(p.id);
                setName("");
                onNavigate("الإنتاج");
              })
            }
            className="rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            إنشاء ملف اللعبة
          </button>
        </section>

        {/* Edit Active Profile */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              تعديل الملف النشط · {activeProfile?.name}
            </h3>
            <p className="text-xs text-slate-500">
              حدّث قواعد التأليف أو أسماء أعمدة التصدير للملف المحدد دون المساس بأسئلته
            </p>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            قواعد الملف الحالي
            <textarea
              rows={3}
              value={editRules}
              onChange={(e) => setEditRules(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((k) => (
              <label key={k} className="block text-xs font-medium text-slate-700">
                عمود {fieldLabels[k]}
                <input
                  value={editMapping[k] ?? k}
                  onChange={(e) =>
                    setEditMapping({ ...editMapping, [k]: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={disabledCommon || !activeProfile}
            onClick={() =>
              void act(async () => {
                if (!activeProfile) return;
                await api(
                  "profiles/" + activeProfile.id,
                  {
                    name: activeProfile.name,
                    rules: editRules,
                    mapping: editMapping,
                  },
                  "PATCH",
                );
                setProfiles(await api("profiles"));
                setMessage("حُفظت إعدادات ملف اللعبة.");
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
          >
            <Save className="h-3.5 w-3.5" />
            حفظ تعديلات الملف
          </button>
        </section>
      </div>

      {/* Chat Import Accordion */}
      <details className="rounded-xl border border-slate-200 bg-white p-6">
        <summary className="cursor-pointer text-base font-bold text-slate-900">
          استيراد أسئلة محفوظة من محادثة
        </summary>
        <ChatTransfer
          plan={plan}
          request={request}
          rules={activeProfile?.rules || ""}
          profileId={profile}
          onImported={async () =>
            setQuestions(await api("questions?profileId=" + profile))
          }
        />
      </details>
    </div>
  );
}

export function EnginesWorkspace({
  engineInfo,
  setEngineInfo,
  busy,
  connectionError,
  act,
  setMessage,
}: {
  engineInfo: any;
  setEngineInfo: (info: any) => void;
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  setMessage: (msg: string) => void;
}) {
  const disabledCommon = busy || Boolean(connectionError);

  const cloudEngines = (engineInfo?.engines || []).filter(
    (e: any) => e.scope === "cloud",
  );
  const localEngines = (engineInfo?.engines || []).filter(
    (e: any) => e.scope !== "cloud",
  );

  const renderEngineCard = (engine: any) => (
    <article
      key={engine.name}
      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-base font-bold text-slate-900">
            {engine.name}
          </strong>
          <span
            className={`text-xs font-bold ${
              engine.connected ? "text-emerald-800" : "text-slate-500"
            }`}
          >
            {engine.connected ? "متصل" : "غير جاهز"}
          </span>
        </div>
        <p className="font-mono text-xs text-slate-500" dir="ltr">
          {engine.model}
        </p>

        {engine.name === "Web Extraction & Question Engine" && engine.connected && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
            يعمل تلقائيًا بدون مفتاح API: تحليل الطلبات العربية، الاستخراج التوثيقي من الويب، وفحص جودة الأسئلة والصور.
          </p>
        )}

        {engine.name === "Gemini" && engine.connected && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
            {engine.detail?.productionEnabled
              ? "التوليد مفعّل. الحصة المتبقية تُعرض في Google AI Studio."
              : "المفتاح متصل. التوليد بانتظار تأكيد Free Tier."}
          </p>
        )}

        {engine.ms && (
          <p className="text-xs text-slate-600 tabular-nums">
            {engine.ms} ms · {engine.tokensPerSecond?.toFixed(1) ?? "—"} token/s
          </p>
        )}

        {engine.error && (
          <p className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
            {engine.error}
          </p>
        )}
      </div>

      {["Ollama", "ComfyUI", "SearXNG"].includes(engine.name) && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            disabled={disabledCommon || !engineInfo?.managed}
            onClick={() =>
              void act(async () => {
                await api("engines/restart", {
                  engine: (
                    {
                      Ollama: "ollama",
                      ComfyUI: "comfy",
                      SearXNG: "searx",
                    } as Record<string, string>
                  )[engine.name],
                });
                setMessage("طُلبت إعادة التشغيل");
              })
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            إعادة التشغيل
          </button>
        </div>
      )}
    </article>
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">AI Engines</h2>
          {engineInfo && (
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              ذاكرة حرة {(engineInfo.freeMemory / 2 ** 30).toFixed(1)} من{" "}
              {(engineInfo.totalMemory / 2 ** 30).toFixed(0)} GiB ·{" "}
              {engineInfo.questionsPerMinute?.toFixed(1) ?? "—"} سؤال/دقيقة
            </p>
          )}
          {engineInfo?.googleImages?.checkedAt && (
            <p className="mt-1 text-xs text-slate-500">
              Google/Web Images ·{" "}
              {engineInfo.googleImages.error ||
                engineInfo.googleImages.count + " نتيجة"}
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={disabledCommon}
          onClick={() =>
            void act(async () => setEngineInfo(await api("engines")))
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          تحديث الحالة
        </button>
      </section>

      {/* Cloud Engines Section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Cloud className="h-4 w-4 text-emerald-900" />
          المحركات السحابية الفعّالة داخل Google AI Studio
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cloudEngines.map(renderEngineCard)}
        </div>
      </section>

      {/* Local Workstation Engines Section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Cpu className="h-4 w-4 text-slate-700" />
          المحركات المحلية (محطة Mac / التشغيل المحلي فقط)
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {localEngines.map(renderEngineCard)}
        </div>
      </section>

      <ChatGPTControls />
    </div>
  );
}
