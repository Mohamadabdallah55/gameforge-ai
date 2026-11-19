import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  BookOpen,
  Gamepad2,
  Image as ImageIcon,
  Layers,
  Menu,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "./api";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { AuditCenter } from "./components/AuditCenter";
import { MediaLab } from "./components/MediaLab";
import { ProductionStudio } from "./components/ProductionStudio";
import { ProfilesAndExport } from "./components/ProfilesAndExport";
import { QuestionLibrary } from "./components/QuestionLibrary";
import { ResearchHub } from "./components/ResearchHub";
import "./style.css";
import type {
  Asset,
  AssistantMessage,
  CopilotTurnResponse,
  ExportPreview,
  HealthStatus,
  Job,
  Plan,
  Profile,
  Question,
  TabKey,
} from "./types";

const NAV_ITEMS: { key: TabKey; label: string; icon: React.ComponentType<any> }[] = [
  { key: "production", label: "الإنتاج", icon: Layers },
  { key: "library", label: "المكتبة", icon: BookOpen },
  { key: "media", label: "الوسائط", icon: ImageIcon },
  { key: "search", label: "بحث", icon: Search },
  { key: "audit", label: "التدقيق", icon: ShieldCheck },
  { key: "profiles", label: "ملفات الألعاب", icon: Gamepad2 },
];

function Studio() {
  const [profileId, setProfileId] = useState("default");
  const [profiles, setProfiles] = useState<(Profile & { id: string })[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<
    AssistantMessage[]
  >([]);

  const [tab, setTab] = useState<TabKey>("production");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const refreshNow = useCallback(async (pid = profileId) => {
    const [p, j, q, a, h, ah] = await Promise.all([
      api("profiles"),
      api("jobs"),
      api("questions?profileId=" + pid),
      api("assets"),
      api("health"),
      api("assistant/history?profileId=" + pid),
    ]);
    setProfiles(p);
    setJobs(j);
    setQuestions(q);
    setAssets(a);
    setHealth(h);
    setAssistantMessages(ah);
  }, [profileId]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function loop() {
      try {
        await refreshNow(profileId);
      } catch (e) {
        if (alive) setMsg(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) timer = setTimeout(loop, 2500);
      }
    }
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [profileId, refreshNow]);

  async function act<T>(fn: () => Promise<T>): Promise<T> {
    if (busy) throw new Error("توجد عملية جارية بالفعل");
    setBusy(true);
    setMsg("");
    try {
      return await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg(m);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  const configured = Boolean(health?.geminiConfigured);
  const activeProfile = profiles.find((p) => p.id === profileId);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 lg:px-8 h-16 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            aria-label="فتح القائمة"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="lg:hidden p-1.5 text-slate-700 hover:bg-slate-100 rounded"
          >
            {mobileNavOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
          <h1
            dir="ltr"
            className="text-xl font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            GameForge AI
          </h1>
        </div>

        <div className="hidden md:flex items-center gap-4 text-xs text-slate-600 min-w-0">
          <label className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-medium text-slate-700">اللعبة</span>
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-emerald-800 focus:outline-none"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums whitespace-nowrap">
            {questions.length} سؤال
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums whitespace-nowrap">
            {assets.length} صورة
          </span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">
            {configured
              ? `Gemini · ${health?.models?.text || "gemini-3.1-flash-lite"}`
              : "مفتاح Gemini غير مضبوط"}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
          >
            <Bot className="w-4 h-4" />
            المساعد الذكي
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative">
        {mobileNavOpen && (
          <div
            aria-hidden="true"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 top-16 z-30 bg-slate-900/30 lg:hidden"
          />
        )}
        {/* RTL Sidebar Navigation */}
        <aside
          className={`${
            mobileNavOpen
              ? "fixed top-16 bottom-0 right-0 z-40 block overflow-y-auto shadow-lg"
              : "hidden"
          } lg:block lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto w-60 shrink-0 bg-white border-l border-slate-200 p-4 space-y-6`}
        >
          <div className="md:hidden pb-3 border-b border-slate-100">
            <label className="block text-xs font-medium text-slate-700">
              اللعبة
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <nav aria-label="أقسام المنصة" className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setTab(item.key);
                    setMsg("");
                    setMobileNavOpen(false);
                    window.scrollTo({ top: 0 });
                  }}
                  className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? "bg-emerald-900 text-white"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {activeProfile && (
            <div className="border-t border-slate-100 pt-4 space-y-1.5 text-xs text-slate-500">
              <p className="font-semibold text-slate-800 truncate">
                {activeProfile.name}
              </p>
              <p className="line-clamp-3 leading-relaxed">
                {activeProfile.rules || "بدون قواعد مخصصة بعد."}
              </p>
            </div>
          )}
        </aside>

        {/* Main Studio Viewport */}
        <main className="flex-1 min-w-0 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-5">
          {msg && (
            <p
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
            >
              {msg}
            </p>
          )}

          {tab === "production" && (
            <ProductionStudio
              profileId={profileId}
              jobs={jobs}
              busy={busy}
              configured={configured}
              onInterpret={(request) =>
                act(() => api<Plan>("interpret", { request }))
              }
              onStartJob={(plan) =>
                act(async () => {
                  const j = await api<Job>("jobs", { profileId, plan });
                  setJobs((s) => [...s.filter((v) => v.id !== j.id), j]);
                  setMsg("أُضيفت المهمة إلى قائمة الإنتاج");
                })
              }
              onPauseJob={(jobId) =>
                act(async () => {
                  await api("jobs/" + jobId + "/pause", {});
                  await refreshNow();
                  setMsg("تم إيقاف المهمة مؤقتًا");
                })
              }
              onResumeJob={(jobId) =>
                act(async () => {
                  await api("jobs/" + jobId + "/retry", {});
                  await refreshNow();
                  setMsg("أُعيدت جدولة المهمة");
                })
              }
            />
          )}

          {tab === "library" && (
            <QuestionLibrary
              profileId={profileId}
              questions={questions}
              assets={assets}
              busy={busy}
              onCreateQuestion={(input) =>
                act(async () => {
                  await api("questions", { profileId, ...input });
                  await refreshNow();
                  setMsg("أُضيف السؤال إلى المكتبة");
                })
              }
              onUpdateQuestion={(id, patch) =>
                act(async () => {
                  await api("questions/" + id, { profileId, ...patch }, "PATCH");
                  await refreshNow();
                  setMsg("تم حفظ التعديلات");
                })
              }
              onDeleteQuestion={(id) =>
                act(async () => {
                  await api(
                    "questions/" + id + "?profileId=" + profileId,
                    undefined,
                    "DELETE",
                  );
                  await refreshNow();
                  setMsg("حُذف السؤال");
                })
              }
              onBulkAction={(ids, action, difficulty) =>
                act(async () => {
                  await api("questions/bulk", {
                    profileId,
                    ids,
                    action,
                    difficulty,
                  });
                  await refreshNow();
                  setMsg("تم تنفيذ الإجراء الجماعي");
                })
              }
            />
          )}

          {tab === "media" && (
            <MediaLab
              assets={assets}
              selectedAssetId={selectedAssetId}
              onSelectAsset={setSelectedAssetId}
              busy={busy}
              onUploadAsset={(payload) =>
                act(async () => {
                  const a = await api<Asset>("assets", payload);
                  setSelectedAssetId(a.id);
                  await refreshNow();
                  setMsg("حُفظت الصورة في المكتبة");
                })
              }
              onTransformAsset={(payload) =>
                act(async () => {
                  const a = await api<Asset>("assets/transform", payload);
                  setSelectedAssetId(a.id);
                  await refreshNow();
                  setMsg("تم تطبيق التأثير وحفظ نسخة جديدة");
                })
              }
              onGenerateAsset={(payload) =>
                act(async () => {
                  const a = await api<Asset>("assets/generate", payload);
                  setSelectedAssetId(a.id);
                  await refreshNow();
                  setMsg("تم تنفيذ التوليد وحفظ الصورة");
                })
              }
            />
          )}

          {tab === "search" && (
            <ResearchHub
              busy={busy}
              onSearchFacts={(q, source) =>
                act(async () => {
                  const res = await api(
                    "search?kind=facts&source=" +
                      source +
                      "&q=" +
                      encodeURIComponent(q),
                  );
                  if (!res.length) setMsg("لم تظهر نتائج معلومات");
                  return res;
                })
              }
              onSearchImages={(q, source) =>
                act(async () => {
                  const res = await api(
                    "search?kind=images&source=" +
                      source +
                      "&q=" +
                      encodeURIComponent(q),
                  );
                  if (!res.length) setMsg("لم تظهر نتائج صور");
                  return res;
                })
              }
              onImportImageHit={(hit) =>
                act(async () => {
                  const a = await api<Asset>("assets/import-url", {
                    url: hit.url,
                    fallbackUrl: hit.fallbackUrl,
                    origin: hit.origin,
                    credit: hit.credit,
                    license: hit.license,
                  });
                  setSelectedAssetId(a.id);
                  await refreshNow();
                  setMsg("استُوردت الصورة إلى المكتبة بنجاح");
                })
              }
            />
          )}

          {tab === "audit" && (
            <AuditCenter
              profileId={profileId}
              health={health}
              busy={busy}
              onRunAudit={(opts) =>
                act(async () => {
                  const report = await api("questions/audit", {
                    profileId,
                    ...opts,
                  });
                  await refreshNow();
                  return report;
                })
              }
              onReindex={() =>
                act(async () => {
                  const res = await api<{ reindexed: number }>(
                    "questions/reindex",
                    { profileId },
                  );
                  await refreshNow();
                  setMsg(`أُعيدت فهرسة ${res.reindexed} سؤال`);
                  return res.reindexed;
                })
              }
              onDeleteQuestion={(id) =>
                act(async () => {
                  await api(
                    "questions/" + id + "?profileId=" + profileId,
                    undefined,
                    "DELETE",
                  );
                  await refreshNow();
                })
              }
            />
          )}

          {tab === "profiles" && (
            <ProfilesAndExport
              activeProfileId={profileId}
              profiles={profiles}
              busy={busy}
              onInferTemplate={(payload) =>
                act(async () => {
                  const t = await api("templates/infer", payload);
                  setMsg("عدد سجلات النموذج المستنتجة: " + t.rows);
                  return t;
                })
              }
              onCreateProfile={(p) =>
                act(async () => {
                  const created = await api<Profile & { id: string }>(
                    "profiles",
                    p,
                  );
                  setProfileId(created.id);
                  await refreshNow(created.id);
                  setTab("production");
                  setMsg("تم إنشاء ملف اللعبة والتبديل إليه");
                })
              }
              onUpdateProfile={(id, p) =>
                act(async () => {
                  await api("profiles/" + id, p, "PATCH");
                  await refreshNow();
                  setMsg("تم حفظ إعدادات الملف");
                })
              }
              onDeleteProfile={(id) =>
                act(async () => {
                  await api("profiles/" + id, undefined, "DELETE");
                  setProfileId("default");
                  await refreshNow("default");
                  setMsg("تم حذف ملف اللعبة");
                })
              }
              onFetchExportPreview={(pid) =>
                api<ExportPreview>("export/json/preview?profileId=" + pid)
              }
            />
          )}
        </main>
      </div>

      <AssistantDrawer
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        messages={assistantMessages}
        busy={busy}
        configured={configured}
        onSend={(message) =>
          act(async () => {
            const res = await api<CopilotTurnResponse>("assistant/chat", {
              profileId,
              message,
            });
            const nextPid = res.hints.selectProfileId || profileId;
            if (res.hints.selectProfileId) setProfileId(res.hints.selectProfileId);
            if (res.hints.selectAssetId) setSelectedAssetId(res.hints.selectAssetId);
            if (res.hints.switchTab) setTab(res.hints.switchTab as TabKey);
            await refreshNow(nextPid);
          })
        }
        onClear={() =>
          act(async () => {
            await api(
              "assistant/history?profileId=" + profileId,
              undefined,
              "DELETE",
            );
            await refreshNow();
          })
        }
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Studio />);
