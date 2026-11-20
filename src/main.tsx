import { ChatTransfer } from "./chat-transfer";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  fields,
  artModes,
  difficultyPoints,
  imageMixModes,
  levels,
  type Asset,
  type Profile,
  type Plan,
  type Question,
} from "../shared/contracts";
import type { Job } from "../shared/contracts";
import { api, LocalConnectionError } from "./api";
import { base64, frame } from "./media";
import "./style.css";
const labels = {
  easy: "200 · سهل",
  medium: "400 · متوسط",
  hard: "600 · صعب",
  imagePercent: "نسبة الأسئلة المصوّرة ٪",
};
const statuses = {
  queued: "في الانتظار",
  running: "قيد الإنتاج",
  failed: "توقفت",
  complete: "مكتملة",
  partial: "مكتملة بعدد أقل بسبب شروط الجودة",
  paused: "متوقفة مؤقتًا",
  cancelled: "ملغاة",
};
const imageLabels = {
  real: "صور حقيقية",
  generated: "رسوم مفاهيم مولّدة",
  sketch: "سكتش فني",
  cartoon: "كرتون فني",
  silhouette: "ظلال",
  bw: "أبيض وأسود",
  auto: "تلقائي",
};
const artLabels = {
  pencil: "سكتش فني",
  cartoon: "كرتون فني",
  render3d: "مظهر ثلاثي الأبعاد",
  eventArt: "رسم فني للحدث",
};
const scoreLabels: Record<string, string> = {
  accuracy: "الصحة",
  importance: "الأهمية",
  engagement: "المتعة",
  originality: "الأصالة",
  clarity: "الوضوح",
  difficulty: "الصعوبة",
  diversity: "التنوع",
  sourceStrength: "قوة المصدر",
};
function QualityPanel({
  report,
}: {
  report: import("../server/store").QualityReport;
}) {
  return (
    <div className="quality-panel">
      <p>
        المقبولة {report.accepted} · المرفوضة {report.rejected} · بدائل جُرّبت بعد
        الرفض {report.retries} · التكرار الفكري{" "}
        {(report.intellectualRepeatRate * 100).toFixed(1)}%
      </p>
      {(["difficulty", "types", "facets", "sources"] as const).map((k) => (
        <p key={k}>
          {
            {
              difficulty: "الصعوبة",
              types: "الأنواع",
              facets: "المحاور",
              sources: "المصادر",
            }[k]
          }{" "}
          {Object.entries(report[k])
            .map(
              ([name, count]) =>
                (labels[name as keyof typeof labels] || name) + " " + count,
            )
            .join(" · ") || "—"}
        </p>
      ))}
      {!!report.reasons.length && (
        <details>
          <summary>آخر أسباب الرفض واستبعاد الصور</summary>
          <ul>
            {report.reasons.map((r, i) => (
              <li key={i}>
                {r.reason}
                {r.candidate && <small> · {r.candidate}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
function Studio() {
  const [profile, P] = useState("default"),
    [profiles, Ps] = useState<(Profile & { id: string })[]>([]),
    [jobs, J] = useState<Job[]>([]),
    [questions, Q] = useState<Question[]>([]),
    [assets, A] = useState<Asset[]>([]);
  const [tab, T] = useState(
      new URLSearchParams(window.location.search).has("chatgpt")
        ? "AI Engines"
        : "الإنتاج",
    ),
    [msg, M] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [busy, B] = useState(false),
    [engineInfo, E] = useState<any>();
  const [plan, S] = useState<Plan>({
      topic: "",
      easy: 2,
      medium: 2,
      hard: 1,
      imagePercent: 0,
      audienceRegion: "mixed",
    }),
    [request, R] = useState(""),
    [preparedRequest, setPreparedRequest] = useState(""),
    [reply, Reply] = useState("");
  const [qualityReport, Report] = useState<{
    jobId: string;
    value: import("../server/store").QualityReport;
  } | null>(null);
  const [name, N] = useState(""),
    [rules, U] = useState(""),
    [mapping, Y] = useState<Profile["mapping"]>({}),
    [columns, K] = useState<string[]>([]);
  const [file, F] = useState<File>(),
    [rights, H] = useState(false),
    [credit, G] = useState(""),
    [time, D] = useState(0),
    [asset, I] = useState(""),
    [style, L] = useState("sketch"),
    [prompt, O] = useState(""),
    [artStyle, setArtStyle] = useState<"" | (typeof artModes)[number]>(""),
    [strength, setStrength] = useState(0.4),
    [mask, setMask] = useState({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }),
    [beforeAsset, setBeforeAsset] = useState(""),
    [lastArt, setLastArt] = useState<{
      assetId?: string;
      prompt: string;
      style?: (typeof artModes)[number];
      strength: number;
    }>();
  const [query, V] = useState(""),
    [lastQuery, LastQuery] = useState(""),
    [hits, X] = useState<
      {
        title: string;
        url: string;
        origin?: string;
        text?: string;
        license?: string;
        preview?: string;
        engine?: string;
      }[]
    >([]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    B(true);
    M("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof LocalConnectionError) setConnectionError(e.message);
      else M(e instanceof Error ? e.message : String(e));
    } finally {
      B(false);
    }
  }
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [p, j, q, a] = await Promise.all([
          api("profiles"),
          api("jobs"),
          api("questions?profileId=" + profile),
          api("assets"),
        ]);
        if (alive) {
          setConnectionError("");
          Ps(p);
          J(j);
          Q(q);
          A(a);
        }
      } catch (e) {
        if (alive)
          setConnectionError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) timer = setTimeout(refresh, 2500);
      }
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [profile]);
  const button = (label: string, fn: () => Promise<void>, disabled = false) => (
    <button
      disabled={busy || disabled || Boolean(connectionError)}
      onClick={() => void act(fn)}
    >
      {label}
    </button>
  );
  async function interpretRequest() {
    const next = await api<Plan>("interpret", {
      request,
      profileId: profile,
      director: "local",
      audienceRegion: plan.audienceRegion,
      audience: plan.audience,
    });
    const interpreted = {
      ...next,
      eliteQuality: plan.eliteQuality,
      audience: plan.audience,
      audienceRegion: plan.audienceRegion,
      imageMode: plan.imageMode,
      imageMix: plan.imageMix,
    };
    S(interpreted);
    setPreparedRequest(request.trim());
    return interpreted;
  }
  async function saveArt(settings: NonNullable<typeof lastArt>) {
    const version = await api<Asset>("assets/generate", settings);
    setLastArt(settings);
    setBeforeAsset(settings.assetId || "");
    A(await api("assets"));
    I(version.id);
  }
  return (
    <main>
      <header>
        <h1>GameForge AI — Elite Intelligence</h1>
        <span>استوديو الإنتاج المحلي</span>
      </header>
      <label>
        اللعبة{" "}
        <select value={profile} onChange={(e) => P(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <nav>
        {[
          "الإنتاج",
          "المكتبة",
          "الوسائط",
          "بحث",
          "ملفات الألعاب",
          "AI Engines",
        ].map((t) => (
          <button
            key={t}
            aria-pressed={t === tab}
            onClick={() => {
              T(t);
              M("");
              if (t === "AI Engines")
                void act(async () => E(await api("engines")));
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {connectionError && (
        <p role="alert" className="connection-error">
          {connectionError}
        </p>
      )}
      {msg && <p role="status">{msg}</p>}
      {tab === "AI Engines" && (
        <section>
          <h2>AI Engines</h2>
          {button("تحديث الحالة", async () => E(await api("engines")))}
          {engineInfo && (
            <p>
              ذاكرة حرة {(engineInfo.freeMemory / 2 ** 30).toFixed(1)} من{" "}
              {(engineInfo.totalMemory / 2 ** 30).toFixed(0)} GiB ·{" "}
              {engineInfo.questionsPerMinute?.toFixed(1) ?? "—"} سؤال/دقيقة
            </p>
          )}
          {engineInfo?.googleImages?.checkedAt && (
            <p>
              Google Images ·{" "}
              {engineInfo.googleImages.error ||
                engineInfo.googleImages.count + " نتيجة"}
            </p>
          )}
          {engineInfo?.engines.map((engine: any) => (
            <article key={engine.name}>
              <strong>{engine.name}</strong> · {engine.model} ·{" "}
              {engine.connected ? "متصل" : "غير جاهز"}
              {engine.name === "Gemini" && engine.connected && (
                <p>
                  {engine.detail.productionEnabled
                    ? "التوليد مفعّل. الحصة المتبقية تُعرض في Google AI Studio."
                    : "المفتاح متصل. التوليد بانتظار تأكيد Free Tier."}
                </p>
              )}
              {engine.ms && (
                <p>
                  {engine.ms} ms · {engine.tokensPerSecond?.toFixed(1) ?? "—"}{" "}
                  token/s
                </p>
              )}
              {engine.error && <p>{engine.error}</p>}
              {["Ollama", "ComfyUI", "SearXNG"].includes(engine.name) &&
                button(
                  "إعادة التشغيل",
                  async () => {
                    await api("engines/restart", {
                      engine: (
                        {
                          Ollama: "ollama",
                          ComfyUI: "comfy",
                          SearXNG: "searx",
                        } as Record<string, string>
                      )[engine.name],
                    });
                    M("طُلبت إعادة التشغيل");
                  },
                  !engineInfo.managed,
                )}
            </article>
          ))}
        </section>
      )}
      {tab === "الإنتاج" && (
        <>
          <section>
            <h2>خطة الأسئلة</h2>
            <p>Gemini · بحث وتأليف ومراجعة مستقلة</p>
            <label>
              الطلب بالعربية
              <textarea
                value={request}
                placeholder="عشرة أسئلة عن كأس العالم 2022، نصفها بصور"
                onChange={(e) => R(e.target.value)}
              />
            </label>
            {button(
              "تحليل الطلب",
              async () => {
                await interpretRequest();
              },
              !request,
            )}
            {button(
              "اسأل مساعد الإنتاج",
              async () =>
                Reply(
                  (
                    await api("assistant", {
                      request,
                      profileId: profile,
                      director: "local",
                      audienceRegion: plan.audienceRegion,
                      audience: plan.audience,
                    })
                  ).reply,
                ),
              !request,
            )}
            {reply && <p role="status">{reply}</p>}
            <label>
              الموضوع والموسم أو البطولة
              <input
                value={plan.topic}
                onChange={(e) => {
                  S({ ...plan, topic: e.target.value });
                  setPreparedRequest(request.trim());
                }}
              />
            </label>
            <label>
              الجمهور المستهدف
              <select
                value={plan.audienceRegion || "mixed"}
                onChange={(e) =>
                  S({
                    ...plan,
                    audienceRegion: e.target.value as Plan["audienceRegion"],
                  })
                }
              >
                <option value="jordan">أردني</option>
                <option value="arab">عربي غير أردني</option>
                <option value="mixed">أردني وعربي مختلط</option>
              </select>
            </label>
            <label>
              تفاصيل الجمهور
              <input
                value={plan.audience || ""}
                placeholder="مثلًا متابعون منتظمون للبطولة"
                onChange={(e) => S({ ...plan, audience: e.target.value })}
              />
            </label>
            <label>
              وضع الصور
              <select
                value={plan.imageMode || "auto"}
                onChange={(e) =>
                  S({
                    ...plan,
                    imageMix: undefined,
                    imageMode: e.target.value as Plan["imageMode"],
                  })
                }
              >
                {Object.entries(imageLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                <option value="none">بدون صور</option>
              </select>
            </label>
            <div className="row">
              {([...levels, "imagePercent"] as const).map((k) => (
                <label key={k}>
                  {labels[k]}
                  <input
                    type="number"
                    min="0"
                    max={k === "imagePercent" ? 100 : 10000}
                    value={plan[k]}
                    onChange={(e) =>
                      S({ ...plan, [k]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <details>
              <summary>توزيع الصور حسب النوع</summary>
              <p>
                أدخل عددًا أو نسبة من إجمالي الأسئلة لكل نوع. العدد له الأولوية
                إذا أدخلت القيمتين.
              </p>
              {imageMixModes.map((mode) => (
                <div key={mode} className="row">
                  {(["count", "percent"] as const).map((field) => (
                    <label key={field}>
                      {imageLabels[mode]} ·{" "}
                      {field === "count" ? "عدد" : "نسبة ٪"}
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
                          S({
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
                      />
                    </label>
                  ))}
                </div>
              ))}
            </details>
            {button(
              "بدء مهمة إنتاج",
              async () => {
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
                J((all) => [...all.filter((entry) => entry.id !== j.id), j]);
                M("أُضيفت المهمة");
              },
              !plan.topic.trim() && !request.trim(),
            )}
          </section>
          <section>
            <h2>المهام</h2>
            {jobs
              .filter((j) => j.profileId === profile)
              .reverse()
              .map((j) => (
                <article key={j.id}>
                  <strong>{j.plan.topic}</strong> · {statuses[j.status]} ·{" "}
                  {j.done}/{j.plan.easy + j.plan.medium + j.plan.hard}
                  {j.chatgpt && (
                    <p>
                      ChatGPT · {j.chatgpt.model} ·{" "}
                      {j.plan.audienceRegion === "jordan"
                        ? "أردني"
                        : j.plan.audienceRegion === "arab"
                          ? "عربي غير أردني"
                          : "أردني وعربي مختلط"}
                    </p>
                  )}
                  {j.production && <p>Gemini · {j.production.model}</p>}
                  {j.qualityStage && <p>{j.qualityStage}</p>}
                  {j.metrics && (
                    <p>
                      مصادر فُحصت {j.metrics.sourcesChecked} · صور حُللت{" "}
                      {j.metrics.imagesReviewed}
                    </p>
                  )}
                  {["queued", "running"].includes(j.status) &&
                    button("إيقاف مؤقت", async () => {
                      const changed = await api<Job>(
                        "jobs/" + j.id + "/control",
                        { action: "pause" },
                      );
                      J((all) =>
                        all.map((entry) =>
                          entry.id === changed.id ? changed : entry,
                        ),
                      );
                    })}
                  {["queued", "running", "paused", "failed"].includes(
                    j.status,
                  ) &&
                    button("إلغاء المهمة", async () => {
                      const changed = await api<Job>(
                        "jobs/" + j.id + "/control",
                        { action: "cancel" },
                      );
                      J((all) =>
                        all.map((entry) =>
                          entry.id === changed.id ? changed : entry,
                        ),
                      );
                    })}
                  {j.production && j.done > 0 && (
                    <div className="row">
                      {["json", "csv", "xlsx", "zip"].map((format) => (
                        <a
                          key={format}
                          href={"/api/jobs/" + j.id + "/export/" + format}
                        >
                          {format.toUpperCase()}
                        </a>
                      ))}
                    </div>
                  )}
                  {j.error && <p>{j.error}</p>}
                  {j.qualityVersion &&
                    button("عرض تقرير الجودة", async () =>
                      Report({
                        jobId: j.id,
                        value: await api("jobs/" + j.id + "/quality"),
                      }),
                    )}
                  {qualityReport?.jobId === j.id && (
                    <QualityPanel report={qualityReport.value} />
                  )}
                  {(j.status === "failed" || j.status === "paused") &&
                    (j.production || j.imageQuestionIds) &&
                    button("استئناف من آخر سؤال", async () => {
                      await api("jobs/" + j.id + "/retry", {});
                      M("أُعيدت جدولة المهمة");
                    })}
                </article>
              ))}
          </section>
        </>
      )}
      {tab === "المكتبة" && (
        <section>
          <h2>مكتبة الأسئلة ({questions.length})</h2>
          {button(
            "إضافة صور حقيقية للأسئلة دفعة واحدة",
            async () => {
              await api("jobs/images", { profileId: profile });
              T("الإنتاج");
            },
            !questions.some((q) => !q.image),
          )}
          <div className="row">
            {["json", "csv", "xlsx", "zip"].map((f) => (
              <a key={f} href={"/api/export/" + f + "?profileId=" + profile}>
                تنزيل {f.toUpperCase()}
              </a>
            ))}
          </div>
          {questions.map((q) => (
            <article key={q.id}>
              <strong>{q.question}</strong>
              {q.quality && (
                <details>
                  <summary>
                    {q.quality.score === undefined
                      ? "تفاصيل السؤال"
                      : `تقييم الجودة ${q.quality.score}/100`}{" "}
                    · {q.quality.facet}
                  </summary>
                  <p>{q.quality.event}</p>
                  <p>{q.quality.fact}</p>
                  {q.quality.visual && (
                    <p>
                      التحليل البصري · {q.quality.visual.description} ·{" "}
                      {q.quality.visual.value}/100
                    </p>
                  )}
                  <p>{q.quality.imageNote}</p>
                  {q.quality.scores && (
                    <ul>
                      {Object.entries(q.quality.scores).map(([key, value]) => (
                        <li key={key}>
                          {scoreLabels[key] || key} {value}/100
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              )}
              <p>
                {q.answer} · {difficultyPoints[q.difficulty]}
              </p>
              {q.image && (
                <img src={"/api/assets/" + q.image} alt="صورة السؤال" />
              )}
              <label>
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
                      Q(await api("questions?profileId=" + profile));
                    });
                  }}
                >
                  <option value="">بدون صورة</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.origin} · {a.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </label>
              <details>
                <summary>دليل الإجابة</summary>
                <p>{q.quote}</p>
                {q.quality?.sourceSelectionReason && (
                  <p>سبب اختيار المصدر · {q.quality.sourceSelectionReason}</p>
                )}
                <a href={q.source} target="_blank" rel="noreferrer">
                  المصدر
                </a>
              </details>
            </article>
          ))}
        </section>
      )}
      {tab === "الوسائط" && (
        <>
          <section>
            <h2>إضافة صورة أو إطار فيديو</h2>
            <input
              aria-label="ملف الوسائط"
              type="file"
              accept="image/*,video/*"
              onChange={(e) => F(e.target.files?.[0])}
            />
            {file?.type.startsWith("video/") && (
              <label>
                الثانية
                <input
                  type="number"
                  min="0"
                  step=".1"
                  value={time}
                  onChange={(e) => D(Number(e.target.value))}
                />
              </label>
            )}
            <label>
              صاحب الصورة أو المقطع
              <input value={credit} onChange={(e) => G(e.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={rights}
                onChange={(e) => H(e.target.checked)}
              />{" "}
              لدي إذن الاستخدام
            </label>
            {button(
              "حفظ في المكتبة",
              async () => {
                if (!file) return;
                const video = file.type.startsWith("video/");
                const a = await api("assets", {
                  data: await base64(video ? await frame(file, time) : file),
                  rights,
                  credit,
                  origin: video ? file.name + " @ " + time + "s" : file.name,
                });
                I(a.id);
                A(await api("assets"));
                M("حُفظت الصورة");
              },
              !file || !rights || !credit,
            )}
          </section>
          <section>
            <h2>Media Lab · استوديو الصور</h2>
            <label>
              الصورة الأصلية
              <select
                value={asset}
                onChange={(e) => {
                  I(e.target.value);
                  setBeforeAsset("");
                }}
              >
                <option value="">توليد صورة جديدة</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.origin} · {a.id.slice(0, 6)}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              {beforeAsset && (
                <figure>
                  <img
                    src={"/api/assets/" + beforeAsset}
                    alt="الأصل قبل التحويل"
                  />
                  <figcaption>قبل</figcaption>
                </figure>
              )}
              {asset && (
                <figure>
                  <img src={"/api/assets/" + asset} alt="الصورة المحددة" />
                  <figcaption>
                    {beforeAsset ? "بعد" : "الصورة المحددة"}
                  </figcaption>
                </figure>
              )}
            </div>
            <label>
              التأثير المحلي
              <select value={style} onChange={(e) => L(e.target.value)}>
                {Object.entries({
                  sketch: "تأثير قلم بسيط",
                  bw: "أبيض وأسود",
                  silhouette: "ظل",
                  cartoon: "تبسيط ألوان",
                  "solid-background": "إزالة خلفية موحّدة",
                  background: "إزالة الخلفية · Apple Vision",
                  "subject-silhouette": "ظل العنصر بعد فصل الخلفية",
                  mask: "إخفاء جزء للتخمين",
                }).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {style === "mask" && (
              <div className="row">
                {Object.entries({
                  x: "الموقع الأفقي",
                  y: "الموقع العمودي",
                  width: "العرض",
                  height: "الارتفاع",
                }).map(([field, label]) => (
                  <label key={field}>
                    {label}
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
                    />
                  </label>
                ))}
              </div>
            )}
            {button(
              "تطبيق التأثير",
              async () => {
                const a = await api("assets/transform", {
                  assetId: asset,
                  style,
                  strength,
                  mask,
                });
                setBeforeAsset(asset);
                A(await api("assets"));
                I(a.id);
              },
              !asset,
            )}
            <label>
              التحويل الفني عبر ComfyUI
              <select
                value={artStyle}
                onChange={(e) => setArtStyle(e.target.value as typeof artStyle)}
              >
                <option value="">وصف حرّ</option>
                {artModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {artLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              درجة التأثير {Math.round(strength * 100)}٪
              <input
                type="range"
                min="0.15"
                max="0.85"
                step="0.05"
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
              />
            </label>
            <label>
              وصف التوليد أو التعديل
              <textarea value={prompt} onChange={(e) => O(e.target.value)} />
            </label>
            {button(
              "توليد أو تعديل باستخدام محرك الصور",
              async () =>
                saveArt({
                  prompt,
                  assetId: asset || undefined,
                  style: artStyle || undefined,
                  strength,
                }),
              (!prompt.trim() && !artStyle) || (!!artStyle && !asset),
            )}
            {lastArt &&
              button("إعادة التوليد من الأصل", async () =>
                saveArt({ ...lastArt, strength }),
              )}
          </section>
        </>
      )}
      {tab === "بحث" && (
        <section>
          <h2>بحث المصادر والصور</h2>
          <label>
            عبارة البحث
            <input value={query} onChange={(e) => V(e.target.value)} />
          </label>
          {Object.entries({
            facts: "معلومات",
            images: "صور قابلة للحفظ",
            "image-posts": "منشورات فيها صور",
          }).map(([k, label]) => (
            <React.Fragment key={k}>
              {button(
                label,
                async () => {
                  const rs = await api(
                    "search?kind=" + k + "&q=" + encodeURIComponent(query),
                  );
                  X(rs);
                  LastQuery(query);
                  if (!rs.length) M("لم تظهر نتائج");
                },
                !query,
              )}
            </React.Fragment>
          ))}
          {hits.map((h) => (
            <article key={h.url}>
              <a href={h.origin || h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>
              {h.origin ? (
                <>
                  <img src={h.url} alt={h.title} />
                  <p>{h.license}</p>
                  {button("حفظ الصورة محليًا", async () => {
                    const a = await api("assets/from-search", {
                      query: lastQuery,
                      origin: h.origin,
                    });
                    I(a.id);
                    A(await api("assets"));
                    M("حُفظت الصورة");
                  })}
                </>
              ) : (
                <>
                  {h.preview && (
                    <img
                      src={h.preview}
                      alt={h.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <p>
                    {h.text?.slice(0, 300)}
                    {h.preview && " · حقوق الاستخدام غير محسومة"}
                    {h.engine && " · " + h.engine}
                  </p>
                </>
              )}
            </article>
          ))}
        </section>
      )}
      {tab === "ملفات الألعاب" && (
        <section>
          <h2>ملف لعبة جديد</h2>
          <label>
            اسم اللعبة
            <input value={name} onChange={(e) => N(e.target.value)} />
          </label>
          <label>
            قواعد صياغة الأسئلة
            <textarea value={rules} onChange={(e) => U(e.target.value)} />
          </label>
          <label>
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
                    Y(t.mapping);
                    K(t.columns.map((c: { name: string }) => c.name));
                    M("عدد سجلات النموذج " + t.rows);
                  });
              }}
            />
          </label>
          {fields.map((k) => (
            <label key={k}>
              {
                {
                  question: "السؤال",
                  answer: "الإجابة",
                  image: "مسار الصورة",
                  difficulty: "الصعوبة",
                  source: "المصدر",
                }[k]
              }
              <input
                list="columns"
                value={mapping[k] ?? k}
                onChange={(e) => Y({ ...mapping, [k]: e.target.value })}
              />
            </label>
          ))}
          <datalist id="columns">
            {columns.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {button(
            "إنشاء ملف اللعبة",
            async () => {
              const p = await api("profiles", { name, rules, mapping });
              Ps(await api("profiles"));
              P(p.id);
              N("");
              T("الإنتاج");
            },
            !name.trim(),
          )}
          <details>
            <summary>استيراد أسئلة محفوظة من محادثة</summary>
            <ChatTransfer
              plan={plan}
              request={request}
              rules={
                profiles.find((entry) => entry.id === profile)?.rules || ""
              }
              profileId={profile}
              onImported={async () =>
                Q(await api("questions?profileId=" + profile))
              }
            />
          </details>
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Studio />);
