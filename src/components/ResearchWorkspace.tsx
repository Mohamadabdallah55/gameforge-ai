import { useState } from "react";
import { Search, Image, Globe, Map, CheckSquare } from "lucide-react";
import type { Asset, Job } from "../../shared/contracts";
import { api } from "../api";
import { ResearchMapPanel, type JobResearchData } from "./shared";

interface SearchHit {
  title: string;
  url: string;
  origin?: string;
  text?: string;
  license?: string;
  preview?: string;
  engine?: string;
}

export function ResearchWorkspace({
  profile,
  jobs,
  setAssets,
  setSelectedAssetId,
  busy,
  connectionError,
  act,
  setMessage,
}: {
  profile: string;
  jobs: Job[];
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  setSelectedAssetId: (id: string) => void;
  busy: boolean;
  connectionError: string;
  act: (fn: () => Promise<void>) => Promise<void>;
  setMessage: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [confirmedOrigins, setConfirmedOrigins] = useState<Record<string, boolean>>({});
  const [selectedJobId, setSelectedJobId] = useState("");
  const [jobResearch, setJobResearch] = useState<JobResearchData | null>(null);

  const disabledCommon = busy || Boolean(connectionError);
  const profileJobs = jobs.filter((j) => j.profileId === profile && j.qualityVersion);

  return (
    <div className="space-y-6">
      {/* Multi-Channel Search */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">
            بحث المصادر والصور
          </h2>
          <p className="text-xs text-slate-500">
            بحث حي عبر Bing Web وGoogle News RSS وDuckDuckGo/Bing Images وOpenverse (مع حظر صور ويكيبيديا وويكيميديا تلقائيًا)
          </p>
        </div>

        <label className="block text-sm font-medium text-slate-700">
          عبارة البحث
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="مثال: نهائي دوري أبطال أوروبا 2005 إسطنبول"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2.5">
          {(
            [
              ["facts", "معلومات", Globe],
              ["images", "صور قابلة للحفظ", Image],
              ["image-posts", "منشورات فيها صور", Search],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              disabled={disabledCommon || !query}
              onClick={() =>
                void act(async () => {
                  const rs = await api<SearchHit[]>(
                    "search?kind=" + k + "&q=" + encodeURIComponent(query),
                  );
                  setHits(rs);
                  setLastQuery(query);
                  if (!rs.length) setMessage("لم تظهر نتائج");
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon className="h-4 w-4 text-emerald-900" />
              {label}
            </button>
          ))}
        </div>

        {hits.length > 0 && (
          <div className="grid gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
            {hits.map((h) => {
              const key = h.origin || h.url;
              const isConfirmed = Boolean(confirmedOrigins[key]);
              return (
                <article
                  key={key + (h.preview || "")}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                >
                  <div className="space-y-2.5">
                    <a
                      href={h.origin || h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm font-bold text-emerald-900 underline underline-offset-4 hover:text-emerald-950"
                    >
                      {h.title}
                    </a>

                    {h.origin ? (
                      <>
                        <img
                          src={h.url}
                          alt={h.title}
                          className="h-44 w-full rounded-lg border border-slate-200 bg-white object-contain p-1"
                        />
                        <p className="text-xs font-medium text-slate-600">
                          الترخيص: {h.license || "Open License"}
                        </p>
                      </>
                    ) : (
                      <>
                        {h.preview && (
                          <img
                            src={h.preview}
                            alt={h.title}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-44 w-full rounded-lg border border-slate-200 bg-white object-contain p-1"
                          />
                        )}
                        <p className="text-xs leading-relaxed text-slate-600">
                          {h.text?.slice(0, 260)}
                          {h.preview && " · حقوق الاستخدام غير محسومة"}
                          {h.engine && " · " + h.engine}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="mt-4 border-t border-slate-200 pt-3">
                    {h.origin ? (
                      <button
                        type="button"
                        disabled={disabledCommon}
                        onClick={() =>
                          void act(async () => {
                            const a = await api<Asset>("assets/from-search", {
                              query: lastQuery,
                              origin: h.origin,
                            });
                            setSelectedAssetId(a.id);
                            setAssets(await api("assets"));
                            setMessage("حُفظت الصورة");
                          })
                        }
                        className="w-full rounded-lg bg-emerald-900 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-950 disabled:opacity-50"
                      >
                        حفظ الصورة محليًا
                      </button>
                    ) : h.preview ? (
                      <div className="space-y-2">
                        <label className="flex items-start gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={isConfirmed}
                            onChange={(e) =>
                              setConfirmedOrigins((prev) => ({
                                ...prev,
                                [key]: e.target.checked,
                              }))
                            }
                            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-emerald-800"
                          />
                          <span>أؤكد امتلاك حق الاستخدام أو الغرض التعليمي المشروع</span>
                        </label>
                        <button
                          type="button"
                          disabled={disabledCommon || !isConfirmed}
                          onClick={() =>
                            void act(async () => {
                              const a = await api<Asset>("assets/from-web", {
                                imgUrl: h.preview,
                                origin: h.url,
                                title: h.title,
                                rightsConfirmed: true,
                              });
                              setSelectedAssetId(a.id);
                              setAssets(await api("assets"));
                              setMessage("حُفظت صورة الويب في المكتبة بعد تأكيد الإذن.");
                            })
                          }
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <CheckSquare className="h-3.5 w-3.5" />
                          استيراد الصورة بعد تأكيد الإذن
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Deep Topic Knowledge Map Explorer */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Map className="h-5 w-5 text-emerald-900" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                مستكشف خريطة المعرفة وحقائق المهام
              </h3>
              <p className="text-xs text-slate-500">
                استعرض خريطة المحاور والكواليس والجدل والحقائق الموثقة التي بُنيت قبل توليد الأسئلة
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-sm font-medium text-slate-700">
            اختر مهمة إنتاج لعرض بحثها العميق
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">اختر مهمة...</option>
              {profileJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.plan.topic} ({j.done} سؤال)
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={disabledCommon || !selectedJobId}
            onClick={() =>
              void act(async () => {
                setJobResearch(
                  await api<JobResearchData>(
                    "jobs/" + selectedJobId + "/research",
                  ),
                );
              })
            }
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            عرض خريطة البحث
          </button>
        </div>

        {jobResearch && <ResearchMapPanel data={jobResearch} />}
      </section>
    </div>
  );
}
