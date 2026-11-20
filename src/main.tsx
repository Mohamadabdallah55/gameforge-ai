import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Sparkles,
  Library,
  Image,
  Search,
  ShieldCheck,
  FolderCog,
  FileSpreadsheet,
  Cpu,
  AlertTriangle,
} from "lucide-react";
import type { Asset, Job, Plan, Profile, Question } from "../shared/contracts";
import { api, LocalConnectionError } from "./api";
import { ProductionWorkspace } from "./components/ProductionWorkspace";
import { LibraryWorkspace } from "./components/LibraryWorkspace";
import { MediaStudioWorkspace } from "./components/MediaStudioWorkspace";
import { ResearchWorkspace } from "./components/ResearchWorkspace";
import {
  ExportPreviewWorkspace,
  QualityWorkspace,
} from "./components/QualityAndExportWorkspace";
import {
  EnginesWorkspace,
  ProfilesWorkspace,
} from "./components/ProfilesAndEnginesWorkspace";
import type { TabId } from "./components/shared";
import "./style.css";

const NAV_ITEMS: { id: TabId; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "الإنتاج", icon: Sparkles },
  { id: "المكتبة", icon: Library },
  { id: "الوسائط", icon: Image },
  { id: "بحث", icon: Search },
  { id: "الجودة", icon: ShieldCheck },
  { id: "ملفات الألعاب", icon: FolderCog },
  { id: "التصدير", icon: FileSpreadsheet },
  { id: "AI Engines", icon: Cpu },
];

function Studio() {
  const [profile, setProfile] = useState("default");
  const [profiles, setProfiles] = useState<(Profile & { id: string })[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);

  const [tab, setTab] = useState<TabId>(
    new URLSearchParams(window.location.search).has("chatgpt")
      ? "AI Engines"
      : "الإنتاج",
  );
  const [msg, setMsg] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [engineInfo, setEngineInfo] = useState<any>();

  const [plan, setPlan] = useState<Plan>({
    topic: "",
    easy: 2,
    medium: 2,
    hard: 1,
    imagePercent: 0,
    audienceRegion: "mixed",
  });
  const [request, setRequest] = useState("");
  const [preparedRequest, setPreparedRequest] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");

  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof LocalConnectionError) setConnectionError(e.message);
      else setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
          setProfiles(p);
          setJobs(j);
          setQuestions(q);
          setAssets(a);
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

  function switchTab(nextTab: TabId) {
    setTab(nextTab);
    setMsg("");
    if (nextTab === "AI Engines") {
      void act(async () => setEngineInfo(await api("engines")));
    }
  }

  const runningJobs = jobs.filter(
    (j) => j.profileId === profile && ["queued", "running"].includes(j.status),
  ).length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      {/* Three-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">
              GameForge AI — Elite Intelligence
            </h1>
            <span className="hidden text-xs font-medium text-slate-500 sm:inline">
              · مصنع إنتاج المسابقات
            </span>
          </div>

          {/* Zone 2: Active Game Profile Selector & Stats */}
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              اللعبة
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-900 focus:border-emerald-800 focus:outline-none"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="hidden items-center gap-2 text-xs text-slate-500 tabular-nums md:flex">
              <span>{questions.length} سؤال</span>
              <span>·</span>
              <span>{assets.length} وسائط</span>
              {runningJobs > 0 && (
                <>
                  <span>·</span>
                  <span className="font-semibold text-emerald-800">
                    {runningJobs} مهام نشطة
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Zone 3: Primary Studio Action */}
          <div className="hidden sm:block">
            <button
              type="button"
              onClick={() => switchTab("التصدير")}
              className="rounded-lg bg-emerald-900 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-950"
            >
              معاينة التصدير
            </button>
          </div>
        </div>

        {/* Mobile Compact Horizontal Nav (<15% viewport height) */}
        <nav
          aria-label="التنقل الرئيسي للهاتف"
          className="flex gap-1.5 overflow-x-auto border-t border-slate-100 bg-slate-50/70 px-4 py-2 lg:hidden"
        >
          {NAV_ITEMS.map(({ id, icon: Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => switchTab(id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-emerald-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {id}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Layout: Desktop RTL Sidebar + Content Canvas */}
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav
            aria-label="التنقل الرئيسي"
            className="sticky top-20 space-y-1 rounded-xl border border-slate-200 bg-white p-2.5"
          >
            {NAV_ITEMS.map(({ id, icon: Icon }) => {
              const active = id === tab;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => switchTab(id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-right text-sm font-semibold transition ${
                    active
                      ? "bg-emerald-900 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{id}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 space-y-5">
          {connectionError && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {connectionError}
            </p>
          )}

          {msg && (
            <p
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950"
            >
              {msg}
            </p>
          )}

          {tab === "الإنتاج" && (
            <ProductionWorkspace
              profile={profile}
              jobs={jobs}
              setJobs={setJobs}
              plan={plan}
              setPlan={setPlan}
              request={request}
              setRequest={setRequest}
              preparedRequest={preparedRequest}
              setPreparedRequest={setPreparedRequest}
              busy={busy}
              connectionError={connectionError}
              act={act}
              setMessage={setMsg}
              onNavigate={switchTab}
            />
          )}

          {tab === "المكتبة" && (
            <LibraryWorkspace
              profile={profile}
              questions={questions}
              setQuestions={setQuestions}
              assets={assets}
              busy={busy}
              connectionError={connectionError}
              act={act}
              setMessage={setMsg}
              onNavigate={switchTab}
            />
          )}

          {tab === "الوسائط" && (
            <MediaStudioWorkspace
              assets={assets}
              setAssets={setAssets}
              selectedAssetId={selectedAssetId}
              setSelectedAssetId={setSelectedAssetId}
              busy={busy}
              connectionError={connectionError}
              act={act}
              setMessage={setMsg}
            />
          )}

          {tab === "بحث" && (
            <ResearchWorkspace
              profile={profile}
              jobs={jobs}
              setAssets={setAssets}
              setSelectedAssetId={setSelectedAssetId}
              busy={busy}
              connectionError={connectionError}
              act={act}
              setMessage={setMsg}
            />
          )}

          {tab === "الجودة" && (
            <QualityWorkspace
              profile={profile}
              busy={busy}
              connectionError={connectionError}
              act={act}
            />
          )}

          {tab === "ملفات الألعاب" && (
            <ProfilesWorkspace
              profile={profile}
              setProfile={setProfile}
              profiles={profiles}
              setProfiles={setProfiles}
              plan={plan}
              request={request}
              setQuestions={setQuestions}
              busy={busy}
              connectionError={connectionError}
              act={act}
              setMessage={setMsg}
              onNavigate={switchTab}
            />
          )}

          {tab === "التصدير" && (
            <ExportPreviewWorkspace
              profile={profile}
              busy={busy}
              connectionError={connectionError}
              act={act}
            />
          )}

          {tab === "AI Engines" && (
            <EnginesWorkspace
              engineInfo={engineInfo}
              setEngineInfo={setEngineInfo}
              busy={busy}
              connectionError={connectionError}
              act={act}
              setMessage={setMsg}
            />
          )}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Studio />);
