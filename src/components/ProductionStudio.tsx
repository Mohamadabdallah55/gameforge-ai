import React, { useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import {
  imageStrategies,
  levels,
  searchSources,
  type ImageStrategy,
  type Plan,
  type SearchSource,
} from "../../shared/contracts";
import {
  JOB_STAGE_LABELS,
  JOB_STATUS_LABELS,
  LEVEL_LABELS,
  type Job,
} from "../types";

interface Props {
  profileId: string;
  jobs: Job[];
  busy: boolean;
  configured: boolean;
  onInterpret: (request: string) => Promise<Plan>;
  onStartJob: (plan: Plan) => Promise<void>;
  onPauseJob: (jobId: string) => Promise<void>;
  onResumeJob: (jobId: string) => Promise<void>;
}

const SOURCE_LABELS: Record<SearchSource, string> = {
  auto: "تلقائي (Google + ويكيبيديا)",
  google: "بحث Google الحي",
  wikipedia: "ويكيبيديا العربية والإنجليزية",
  tavily: "بحث Tavily العام",
};

const IMAGE_STRATEGY_LABELS: Record<ImageStrategy, string> = {
  real_only: "صور حقيقية مجانية دائمًا (Wikimedia / Openverse)",
  real_then_ai: "صور حقيقية أولاً ثم توليد Gemini (مفتاح مدفوع)",
  ai_only: "توليد جميع الصور عبر Gemini (مفتاح مدفوع)",
};

export function ProductionStudio({
  profileId,
  jobs,
  busy,
  configured,
  onInterpret,
  onStartJob,
  onPauseJob,
  onResumeJob,
}: Props) {
  const [request, setRequest] = useState("");
  const [plan, setPlan] = useState<Plan>({
    topic: "",
    easy: 3,
    medium: 2,
    hard: 1,
    imagePercent: 30,
    searchSource: "auto",
    imageStrategy: "real_only",
  });

  const totalQuestions = plan.easy + plan.medium + plan.hard;
  const profileJobs = jobs
    .filter((j) => j.profileId === profileId)
    .slice()
    .reverse();

  const applyPreset = (
    easy: number,
    medium: number,
    hard: number,
    imagePercent: number,
  ) => {
    setPlan((prev) => ({ ...prev, easy, medium, hard, imagePercent }));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">خطة الأسئلة</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                حوّل وصفك العربي إلى خطة إنتاج متوازنة أو اضبط الإنتاج الجماعي حتى 500 سؤال لكل مستوى.
              </p>
            </div>
            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
              الإجمالي المخطط: <strong className="text-slate-900">{totalQuestions}</strong> سؤال
            </span>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-800">
              الطلب بالعربية
              <textarea
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-800 focus:outline-none min-h-[84px]"
                value={request}
                placeholder="مثال: أريد 50 سؤالاً عن دوري أبطال أوروبا 2024، 20 سهل و20 متوسط و10 صعب، نصفها بصور"
                onChange={(e) => setRequest(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                disabled={busy || !request.trim() || !configured}
                onClick={() =>
                  void onInterpret(request).then((parsed) =>
                    setPlan((prev) => ({ ...prev, ...parsed })),
                  )
                }
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 text-emerald-800" />
                تحليل الطلب
              </button>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>قوالب سريعة:</span>
                <button
                  type="button"
                  onClick={() => applyPreset(4, 4, 2, 30)}
                  className="underline decoration-slate-300 hover:text-emerald-900 whitespace-nowrap"
                >
                  حزمة 10 أسئلة
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => applyPreset(20, 20, 10, 40)}
                  className="underline decoration-slate-300 hover:text-emerald-900 whitespace-nowrap"
                >
                  دفعة 50 سؤالاً
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => applyPreset(80, 80, 40, 25)}
                  className="underline decoration-slate-300 hover:text-emerald-900 whitespace-nowrap"
                >
                  إنتاج ضخم (200 سؤال)
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-4">
            <label className="block text-sm font-medium text-slate-800">
              الموضوع والموسم أو البطولة
              <input
                type="text"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
                value={plan.topic}
                placeholder="مثال: كأس العالم 2022 في قطر"
                onChange={(e) => setPlan({ ...plan, topic: e.target.value })}
              />
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {levels.map((k) => (
                <label
                  key={k}
                  className="block text-xs font-medium text-slate-700"
                >
                  {LEVEL_LABELS[k]}
                  <input
                    type="number"
                    min={0}
                    max={500}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-800 focus:outline-none"
                    value={plan[k]}
                    onChange={(e) =>
                      setPlan({ ...plan, [k]: Math.max(0, Number(e.target.value)) })
                    }
                  />
                </label>
              ))}
              <label className="block text-xs font-medium text-slate-700">
                نسبة الأسئلة المصوّرة ٪
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-emerald-800 focus:outline-none"
                  value={plan.imagePercent}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      imagePercent: Math.min(100, Math.max(0, Number(e.target.value))),
                    })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-slate-700">
                مصدر جمع المعلومات والتحقق
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
                  value={plan.searchSource ?? "auto"}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      searchSource: e.target.value as SearchSource,
                    })
                  }
                >
                  {searchSources.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                استراتيجية جلب الصور
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
                  value={plan.imageStrategy ?? "real_then_ai"}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      imageStrategy: e.target.value as ImageStrategy,
                    })
                  }
                >
                  {imageStrategies.map((st) => (
                    <option key={st} value={st}>
                      {IMAGE_STRATEGY_LABELS[st]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500 tabular-nums">
                سيتم تثبيت كل سؤال مقبول فورًا في قاعدة البيانات مع التحقق من الاقتباس ومنع التكرار.
              </div>
              <button
                type="button"
                disabled={busy || !plan.topic.trim() || totalQuestions <= 0}
                onClick={() => void onStartJob(plan)}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Layers className="w-4 h-4" />
                بدء مهمة إنتاج
              </button>
            </div>
          </div>
        </section>

        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-900">المهام</h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {profileJobs.length} مهمة
            </span>
          </div>

          {profileJobs.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700">
                لا توجد مهام إنتاج في هذا الملف بعد
              </p>
              <p className="text-xs text-slate-500">
                أدخل موضوعًا في خطة الأسئلة واضغط «بدء مهمة إنتاج» للبدء بالجمع والتحقق التلقائي.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {profileJobs.map((j) => {
                const targetTotal =
                  j.plan.easy + j.plan.medium + j.plan.hard;
                const pct = targetTotal
                  ? Math.min(100, Math.round((j.done / targetTotal) * 100))
                  : 0;
                return (
                  <article key={j.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {j.plan.topic}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            {j.status === "complete" ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                            ) : j.status === "failed" ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-amber-600" />
                            )}
                            {JOB_STATUS_LABELS[j.status]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {j.done} / {targetTotal} سؤال ({pct}٪)
                          </span>
                          {j.stage && j.status === "running" && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-800">
                                {JOB_STAGE_LABELS[j.stage] || j.stage}
                              </span>
                            </>
                          )}
                          {(j.rejected ?? 0) > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>مرفوض/مكرر: {j.rejected}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(j.status === "running" || j.status === "queued") && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onPauseJob(j.id)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            إيقاف مؤقت
                          </button>
                        )}
                        {(j.status === "failed" || j.status === "paused") && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onResumeJob(j.id)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-900 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 whitespace-nowrap"
                          >
                            {j.status === "failed" ? (
                              <>
                                <RotateCcw className="w-3.5 h-3.5" />
                                استئناف من آخر سؤال
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                استكمال
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          j.status === "failed"
                            ? "bg-red-600"
                            : j.status === "complete"
                              ? "bg-emerald-700"
                              : "bg-emerald-600"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {j.error && (
                      <p
                        dir="auto"
                        className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5"
                      >
                        {j.error}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
