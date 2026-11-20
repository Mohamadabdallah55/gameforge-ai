import { useState } from "react";
import { Sparkles, Play, Pause, XCircle, RotateCcw, Map, BarChart3, Download } from "lucide-react";
import {
  imageMixModes,
  levels,
  type Job,
  type Plan,
} from "../../shared/contracts";
import type { QualityReport } from "../../server/store";
import { api } from "../api";
import {
  difficultyLabels,
  imageLabels,
  jobStatuses,
  QualityPanel,
  ResearchMapPanel,
  type JobResearchData,
  type TabId,
} from "./shared";

interface CopilotResponse {
  reply: string;
  suggestedPlan?: Partial<Plan>;
  suggestedAction?: {
    type:
      | "none"
      | "apply_plan"
      | "start_production"
      | "search_facts"
      | "search_images"
      | "open_tab"
      | "batch_images";
    label?: string;
    query?: string;
    tab?: TabId;
  };
}

export function ProductionWorkspace({
  profile,
  jobs,
  setJobs,
  plan,
  setPlan,
  request,
  setRequest,
  preparedRequest,
  setPreparedRequest,
  busy,
  connectionError,
  act,
  setMessage,
  onNavigate,
}: {
  profile: string;
  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  plan: Plan;
  setPlan: React.Dispatch<React.SetStateAction<Plan>>;
  request: string;
  setRequest: (value: string) => void;
  preparedRequest: string;
  setPreparedRequest: (value: string) => void;
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  setMessage: (msg: string) => void;
  onNavigate: (tab: TabId) => void;
}) {
  const [copilot, setCopilot] = useState<CopilotResponse | null>(null);
  const [qualityReport, setQualityReport] = useState<{
    jobId: string;
    value: QualityReport;
  } | null>(null);
  const [researchView, setResearchView] = useState<JobResearchData | null>(null);

  const disabledCommon = busy || Boolean(connectionError);

  async function interpretRequest() {
    const next = await api<Plan>("interpret", {
      request,
      profileId: profile,
      director: "auto",
      audienceRegion: plan.audienceRegion,
      audience: plan.audience,
    });
    const interpreted: Plan = {
      ...next,
      eliteQuality: plan.eliteQuality,
      audience: plan.audience,
      audienceRegion: plan.audienceRegion,
      imageMode: plan.imageMode || next.imageMode,
      imageMix: plan.imageMix,
    };
    setPlan(interpreted);
    setPreparedRequest(request.trim());
    return interpreted;
  }

  const profileJobs = jobs.filter((j) => j.profileId === profile).slice().reverse();
  const totalQuestionsRequested = plan.easy + plan.medium + plan.hard;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Composer Card */}
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">خطة الأسئلة</h2>
              <p className="text-xs text-slate-500">
                Gemini · بحث عميق متعدد المصادر، تأليف احترافي، فحص فايروول، ومراجعة مستقلة
              </p>
            </div>
            <div className="text-xs font-medium text-slate-600 tabular-nums">
              الإجمالي المطلوب: {totalQuestionsRequested} سؤال
            </div>
          </div>

          <label className="block text-sm font-semibold text-slate-800">
            الطلب بالعربية
            <textarea
              rows={3}
              value={request}
              placeholder="مثال: عشرون سؤالًا احترافيًا عن دوري أبطال أوروبا والقصص التاريخية، نصفها بصور وسكتش للاعبين"
              onChange={(e) => setRequest(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={disabledCommon || !request}
              onClick={() =>
                void act(async () => {
                  await interpretRequest();
                })
              }
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              تحليل الطلب
            </button>
            <button
              type="button"
              disabled={disabledCommon || !request}
              onClick={() =>
                void act(async () => {
                  const res = await api<CopilotResponse>("assistant", {
                    request,
                    profileId: profile,
                    director: "auto",
                    audienceRegion: plan.audienceRegion,
                    audience: plan.audience,
                  });
                  setCopilot(res);
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/30 bg-emerald-50/70 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-100/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              اسأل مساعد الإنتاج
            </button>
          </div>

          {copilot && (
            <div
              role="region"
              aria-live="polite"
              className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-slate-800"
            >
              <div className="font-semibold text-emerald-950">توصية مساعد الإنتاج</div>
              <p className="whitespace-pre-line leading-relaxed">{copilot.reply}</p>
              <div className="flex flex-wrap gap-2">
                {copilot.suggestedPlan && (
                  <button
                    type="button"
                    onClick={() => {
                      setPlan((prev) => ({
                        ...prev,
                        ...copilot.suggestedPlan,
                      }));
                      setMessage("طُبقت خطة مساعد الإنتاج على الحقول.");
                    }}
                    className="rounded-md bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-950"
                  >
                    تطبيق الخطة المقترحة
                  </button>
                )}
                {copilot.suggestedAction?.type === "open_tab" &&
                  copilot.suggestedAction.tab && (
                    <button
                      type="button"
                      onClick={() => onNavigate(copilot.suggestedAction!.tab!)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      {copilot.suggestedAction.label ||
                        `الانتقال إلى ${copilot.suggestedAction.tab}`}
                    </button>
                  )}
                {(copilot.suggestedAction?.type === "search_facts" ||
                  copilot.suggestedAction?.type === "search_images") && (
                  <button
                    type="button"
                    onClick={() => onNavigate("بحث")}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    {copilot.suggestedAction.label || "فتح مركز البحث"}
                  </button>
                )}
                {copilot.suggestedAction?.type === "start_production" &&
                  (copilot.suggestedPlan || plan.topic.trim()) && (
                    <button
                      type="button"
                      disabled={disabledCommon}
                      onClick={() =>
                        void act(async () => {
                          await api("production/eligibility");
                          const targetPlan = copilot.suggestedPlan
                            ? { ...plan, ...copilot.suggestedPlan }
                            : plan;
                          setPlan(targetPlan);
                          const j = await api<Job>("jobs", {
                            profileId: profile,
                            director: "gemini",
                            plan: {
                              ...targetPlan,
                              brief: request.trim().slice(0, 2000),
                            },
                          });
                          setJobs((all) => [
                            ...all.filter((entry) => entry.id !== j.id),
                            j,
                          ]);
                          setMessage("أُضيفت المهمة");
                        })
                      }
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      {copilot.suggestedAction.label || "بدء الإنتاج مباشرة"}
                    </button>
                  )}
                {copilot.suggestedAction?.type === "batch_images" && (
                  <button
                    type="button"
                    disabled={disabledCommon}
                    onClick={() =>
                      void act(async () => {
                        await api("jobs/images", { profileId: profile });
                        setMessage("أُضيفت مهمة إرفاق الصور إلى قائمة التشغيل.");
                      })
                    }
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    {copilot.suggestedAction.label || "تشغيل دفعة الصور الآن"}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              الموضوع والموسم أو البطولة
              <input
                value={plan.topic}
                onChange={(e) => {
                  setPlan({ ...plan, topic: e.target.value });
                  setPreparedRequest(request.trim());
                }}
                placeholder="مثال: دوري أبطال أوروبا 2005–2024"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              الجمهور المستهدف
              <select
                value={plan.audienceRegion || "mixed"}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    audienceRegion: e.target.value as Plan["audienceRegion"],
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
              >
                <option value="jordan">أردني</option>
                <option value="arab">عربي غير أردني</option>
                <option value="mixed">أردني وعربي مختلط</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              تفاصيل الجمهور
              <input
                value={plan.audience || ""}
                placeholder="مثلًا متابعون منتظمون للبطولة"
                onChange={(e) => setPlan({ ...plan, audience: e.target.value })}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              وضع الصور
              <select
                value={plan.imageMode || "auto"}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    imageMix: undefined,
                    imageMode: e.target.value as Plan["imageMode"],
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
              >
                {Object.entries(imageLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                <option value="none">بدون صور</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([...levels, "imagePercent"] as const).map((k) => (
              <label
                key={k}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs font-semibold text-slate-700"
              >
                <span>{difficultyLabels[k]}</span>
                <input
                  type="number"
                  min="0"
                  max={k === "imagePercent" ? 100 : 10000}
                  value={plan[k]}
                  onChange={(e) =>
                    setPlan({ ...plan, [k]: Number(e.target.value) })
                  }
                  className="mt-2 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-900 tabular-nums focus:border-emerald-800 focus:outline-none"
                />
              </label>
            ))}
          </div>

          <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              توزيع الصور حسب النوع
            </summary>
            <p className="mt-2 text-xs text-slate-500">
              أدخل عددًا أو نسبة من إجمالي الأسئلة لكل نوع. العدد له الأولوية
              إذا أدخلت القيمتين.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {imageMixModes.map((mode) => (
                <div
                  key={mode}
                  className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-white p-2.5"
                >
                  {(["count", "percent"] as const).map((field) => (
                    <label key={field} className="text-xs text-slate-600">
                      {imageLabels[mode]} · {field === "count" ? "عدد" : "نسبة ٪"}
                      <input
                        type="number"
                        min="0"
                        max={field === "count" ? 10000 : 100}
                        step={field === "count" ? 1 : "any"}
                        value={plan.imageMix?.[mode]?.[field] ?? ""}
                        onChange={(e) => {
                          const mix = {
                            ...plan.imageMix,
                            [mode]: {
                              ...plan.imageMix?.[mode],
                              [field]:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            },
                          };
                          setPlan({
                            ...plan,
                            imageMix: Object.values(mix).some(
                              (v) =>
                                v.count !== undefined ||
                                v.percent !== undefined,
                            )
                              ? mix
                              : undefined,
                          });
                        }}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900 tabular-nums focus:border-emerald-800 focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </details>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <span className="text-xs text-slate-500">
              تعمل الدفعات الكبيرة بالتتالي مع حفظ نقطة الاستئناف تلقائيًا
            </span>
            <button
              type="button"
              disabled={disabledCommon || (!plan.topic.trim() && !request.trim())}
              onClick={() =>
                void act(async () => {
                  await api("production/eligibility");
                  const brief = request.trim();
                  const productionPlan =
                    brief && (!plan.topic.trim() || preparedRequest !== brief)
                      ? await interpretRequest()
                      : plan;
                  const j = await api<Job>("jobs", {
                    profileId: profile,
                    director: "gemini",
                    plan: { ...productionPlan, brief: brief.slice(0, 2000) },
                  });
                  setJobs((all) => [
                    ...all.filter((entry) => entry.id !== j.id),
                    j,
                  ]);
                  setMessage("أُضيفت المهمة");
                })
              }
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              بدء مهمة إنتاج
            </button>
          </div>
        </section>

        {/* Guidelines Side Card */}
        <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-4">
          <h3 className="text-base font-bold text-slate-900">
            معايير مصنع المسابقات
          </h3>
          <ul className="space-y-3 text-xs leading-relaxed text-slate-600">
            <li className="border-b border-slate-100 pb-2.5">
              <strong className="block text-slate-900">1. البحث المعرفي العميق</strong>
              يبحث بالعربية والإنجليزية عبر Bing وGoogle News وGemini Grounding لبناء خريطة حقائق وكواليس قبل التأليف.
            </li>
            <li className="border-b border-slate-100 pb-2.5">
              <strong className="block text-slate-900">2. فايروول جودة مستقل</strong>
              يرفض الأسئلة البديهية، تسريب الإجابة بالأرقام أو الكلمات، والتكرار الفكري (تغيير السنة فقط).
            </li>
            <li className="border-b border-slate-100 pb-2.5">
              <strong className="block text-slate-900">3. مستويات 200 / 400 / 600</strong>
              فصل حقيقي بين المعلومة المعروفة، المعلومة المتعمقة، ومعلومة الخبير.
            </li>
            <li>
              <strong className="block text-slate-900">4. تدقيق بصري للصور</strong>
              فحص Gemini Vision لكل صورة واستبعاد الشعارات أو النصوص الفاضحة ومصادر ويكيميديا المحظورة.
            </li>
          </ul>
        </aside>
      </div>

      {/* Jobs Queue Section */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">
            المهام ({profileJobs.length})
          </h2>
          <span className="text-xs text-slate-500">
            تحديث تلقائي كل 2.5 ثانية مع حفظ التقدم في SQLite
          </span>
        </div>

        {!profileJobs.length ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-500">
            لا توجد مهام إنتاج في هذا الملف بعد. اكتب الطلب أو الموضوع أعلاه للبدء.
          </p>
        ) : (
          <div className="space-y-4">
            {profileJobs.map((j) => {
              const targetCount = j.imageQuestionIds
                ? j.imageQuestionIds.length
                : j.plan.easy + j.plan.medium + j.plan.hard;
              const percent = targetCount
                ? Math.min(100, Math.round((j.done / targetCount) * 100))
                : 0;

              return (
                <article
                  key={j.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/40 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
                        <span>{j.plan.topic}</span>
                        <span className="text-xs font-semibold text-slate-500 tabular-nums">
                          · {jobStatuses[j.status] || j.status} · {j.done}/{targetCount}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                        {j.production && (
                          <span>Gemini · {j.production.model}</span>
                        )}
                        {j.chatgpt && (
                          <span>ChatGPT · {j.chatgpt.model}</span>
                        )}
                        {j.qualityStage && <span>المرحلة: {j.qualityStage}</span>}
                        {j.metrics && (
                          <span className="tabular-nums">
                            مصادر فُحصت {j.metrics.sourcesChecked} · صور حُللت{" "}
                            {j.metrics.imagesReviewed}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {["queued", "running"].includes(j.status) && (
                        <button
                          type="button"
                          disabled={disabledCommon}
                          onClick={() =>
                            void act(async () => {
                              const changed = await api<Job>(
                                "jobs/" + j.id + "/control",
                                { action: "pause" },
                              );
                              setJobs((all) =>
                                all.map((entry) =>
                                  entry.id === changed.id ? changed : entry,
                                ),
                              );
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Pause className="h-3.5 w-3.5" />
                          إيقاف مؤقت
                        </button>
                      )}
                      {["queued", "running", "paused", "failed"].includes(
                        j.status,
                      ) && (
                        <button
                          type="button"
                          disabled={disabledCommon}
                          onClick={() =>
                            void act(async () => {
                              const changed = await api<Job>(
                                "jobs/" + j.id + "/control",
                                { action: "cancel" },
                              );
                              setJobs((all) =>
                                all.map((entry) =>
                                  entry.id === changed.id ? changed : entry,
                                ),
                              );
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          إلغاء المهمة
                        </button>
                      )}
                      {(j.status === "failed" || j.status === "paused") &&
                        (j.production || j.imageQuestionIds) && (
                          <button
                            type="button"
                            disabled={disabledCommon}
                            onClick={() =>
                              void act(async () => {
                                await api("jobs/" + j.id + "/retry", {});
                                setMessage("أُعيدت جدولة المهمة");
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-950"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            استئناف من آخر سؤال
                          </button>
                        )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full transition-all ${
                        j.status === "failed"
                          ? "bg-rose-600"
                          : j.status === "complete"
                            ? "bg-emerald-700"
                            : "bg-emerald-800"
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  {j.error && (
                    <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                      {j.error}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {j.qualityVersion && (
                      <>
                        <button
                          type="button"
                          disabled={disabledCommon}
                          onClick={() =>
                            void act(async () => {
                              setQualityReport({
                                jobId: j.id,
                                value: await api("jobs/" + j.id + "/quality"),
                              });
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          عرض تقرير الجودة
                        </button>
                        <button
                          type="button"
                          disabled={disabledCommon}
                          onClick={() =>
                            void act(async () => {
                              setResearchView(
                                await api<JobResearchData>(
                                  "jobs/" + j.id + "/research",
                                ),
                              );
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Map className="h-3.5 w-3.5" />
                          خريطة البحث والحقائق
                        </button>
                      </>
                    )}

                    {j.production && j.done > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {["json", "csv", "xlsx", "zip"].map((format) => (
                          <a
                            key={format}
                            href={"/api/jobs/" + j.id + "/export/" + format}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3 w-3" />
                            {format.toUpperCase()}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {qualityReport?.jobId === j.id && (
                    <QualityPanel report={qualityReport.value} />
                  )}
                  {researchView?.jobId === j.id && (
                    <ResearchMapPanel data={researchView} />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
