import type { QualityReport } from "../../server/store";

export type TabId =
  | "الإنتاج"
  | "المكتبة"
  | "الوسائط"
  | "بحث"
  | "الجودة"
  | "ملفات الألعاب"
  | "التصدير"
  | "AI Engines";

export const difficultyLabels = {
  easy: "200 · سهل",
  medium: "400 · متوسط",
  hard: "600 · صعب",
  imagePercent: "نسبة الأسئلة المصوّرة ٪",
} as const;

export const jobStatuses: Record<string, string> = {
  queued: "في الانتظار",
  running: "قيد الإنتاج",
  failed: "توقفت",
  complete: "مكتملة",
  partial: "مكتملة بعدد أقل بسبب شروط الجودة",
  paused: "متوقفة مؤقتًا",
  cancelled: "ملغاة",
};

export const imageLabels: Record<string, string> = {
  real: "صور حقيقية",
  generated: "رسوم مفاهيم مولّدة",
  sketch: "سكتش فني",
  cartoon: "كرتون فني",
  silhouette: "ظلال",
  bw: "أبيض وأسود",
  auto: "تلقائي",
};

export const artLabels: Record<string, string> = {
  pencil: "سكتش فني",
  cartoon: "كرتون فني",
  render3d: "مظهر ثلاثي الأبعاد",
  eventArt: "رسم فني للحدث",
};

export const scoreLabels: Record<string, string> = {
  accuracy: "الصحة",
  importance: "الأهمية",
  engagement: "المتعة",
  originality: "الأصالة",
  clarity: "الوضوح",
  difficulty: "الصعوبة",
  diversity: "التنوع",
  sourceStrength: "قوة المصدر",
};

export const stageLabels: Record<string, string> = {
  firewall: "فايروول الجودة",
  jury: "لجنة التحكيم",
  intellectual: "منع التكرار الفكري",
  duplicate: "منع التكرار النصي/الدلالي",
  image: "التدقيق البصري للصور",
  source: "التحقق من المصدر",
  verify: "مراجعة الحقائق",
};

export interface JobResearchData {
  jobId: string;
  topic: string;
  map: {
    axes?: string[];
    landmarks?: string[];
    controversies?: string[];
    questionAngles?: string[];
    recommendedTypes?: string[];
  } | null;
  facts: {
    id: string;
    event: string;
    entity: string;
    fact: string;
    answer: string;
    facet: string;
    bestLevel: string;
    importance: number;
    surprise: number;
    audienceReason: string;
    sourceLabel: string;
    sourceUrl: string;
    sourceTitle: string;
  }[];
  errors: string[];
}

export function QualityPanel({ report }: { report: QualityReport }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium tabular-nums">
        <span>المقبولة {report.accepted}</span>
        <span>·</span>
        <span>المرفوضة {report.rejected}</span>
        <span>·</span>
        <span>بدائل جُرّبت بعد الرفض {report.retries}</span>
        <span>·</span>
        <span>
          التكرار الفكري {(report.intellectualRepeatRate * 100).toFixed(1)}%
        </span>
      </div>
      <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        {(["difficulty", "types", "facets", "sources"] as const).map((k) => (
          <div key={k} className="rounded-md border border-slate-200 bg-white p-2.5">
            <div className="font-semibold text-slate-900">
              {
                {
                  difficulty: "الصعوبة",
                  types: "الأنواع",
                  facets: "المحاور",
                  sources: "المصادر",
                }[k]
              }
            </div>
            <div className="mt-1 tabular-nums">
              {Object.entries(report[k])
                .map(
                  ([name, count]) =>
                    (difficultyLabels[name as keyof typeof difficultyLabels] ||
                      name) +
                    " " +
                    count,
                )
                .join(" · ") || "—"}
            </div>
          </div>
        ))}
      </div>
      {!!report.reasons.length && (
        <details className="rounded-md border border-slate-200 bg-white p-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-slate-800">
            آخر أسباب الرفض واستبعاد الصور ({report.reasons.length})
          </summary>
          <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-xs text-slate-600">
            {report.reasons.map((r, i) => (
              <li key={i} className="border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
                <span className="font-semibold text-slate-800">
                  [{stageLabels[r.stage] || r.stage}]
                </span>{" "}
                {r.reason}
                {r.candidate && (
                  <div className="mt-0.5 text-slate-500">{r.candidate}</div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ResearchMapPanel({ data }: { data: JobResearchData }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-bold text-slate-900">
          خريطة البحث المعرفية · {data.topic}
        </h4>
        <span className="text-xs font-medium text-slate-600 tabular-nums">
          حقائق مستخلصة: {data.facts.length}
        </span>
      </div>

      {data.map && (
        <div className="grid gap-2.5 text-xs sm:grid-cols-2">
          {data.map.axes?.length ? (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="font-semibold text-slate-900">المحاور البحثية</div>
              <p className="mt-1 text-slate-600">{data.map.axes.join(" · ")}</p>
            </div>
          ) : null}
          {data.map.landmarks?.length ? (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="font-semibold text-slate-900">محطات ولحظات فارقة</div>
              <p className="mt-1 text-slate-600">
                {data.map.landmarks.join(" · ")}
              </p>
            </div>
          ) : null}
          {data.map.controversies?.length ? (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="font-semibold text-slate-900">جدل وكواليس موثقة</div>
              <p className="mt-1 text-slate-600">
                {data.map.controversies.join(" · ")}
              </p>
            </div>
          ) : null}
          {data.map.questionAngles?.length ? (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="font-semibold text-slate-900">زوايا إبداعية للأسئلة</div>
              <p className="mt-1 text-slate-600">
                {data.map.questionAngles.join(" · ")}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {data.facts.length > 0 && (
        <details open className="rounded-md border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-900">
            الحقائق والمصادر الموثقة ({data.facts.length})
          </summary>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs">
            {data.facts.map((f) => (
              <div
                key={f.id}
                className="rounded border border-slate-100 bg-slate-50/70 p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-900">
                  <span>
                    {f.event} · {f.entity}
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    {f.bestLevel} · أهمية {f.importance} · مفاجأة {f.surprise}
                  </span>
                </div>
                <p className="mt-1 text-slate-700">{f.fact}</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-slate-500">
                  <span>الإجابة المرشحة: {f.answer}</span>
                  <a
                    href={f.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-800 underline underline-offset-4"
                  >
                    {f.sourceLabel || f.sourceTitle || "المصدر"}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
