import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Store } from "../server/store";
import { provider, embeddingSpace } from "../server/local";
import { persistSearch, information } from "../server/search";
import { Worker } from "../server/worker";
import { StructuredProvider } from "../server/provider";
import { QualityEngine } from "../server/quality-engine";
import type { Plan } from "../shared/contracts";

process.env.AI_PROVIDER = "local";
process.env.EXTERNAL_SEARCH = "";
const location = path.resolve(
  process.env.QUALITY_ACCEPTANCE_DIR || "../../work/quality-acceptance",
);
const mode = process.argv.includes("--pilot") ? "pilot" : "full";
mkdirSync(location, { recursive: true });
const db = new Store(location);
persistSearch(db);
const ai = provider();
if (!(ai instanceof StructuredProvider))
  throw Error("Structured native provider required");
const worker = new Worker(
  db,
  ai,
  information,
  embeddingSpace(),
  new QualityEngine(db, ai, information),
);
const plans: { name: string; plan: Plan }[] = [
  {
    name: "champions",
    plan: {
      topic: "دوري أبطال أوروبا UEFA Champions League (1992–2025)",
      easy: mode === "pilot" ? 1 : 34,
      medium: mode === "pilot" ? 1 : 33,
      hard: mode === "pilot" ? 1 : 33,
      imagePercent: mode === "pilot" ? 0 : 20,
      eliteQuality: true,
      audience: "متابعو كرة القدم الأوروبية",
    },
  },
  {
    name: "series",
    plan: {
      topic: "مسلسل Breaking Bad، أحداث وشخصيات المواسم الخمسة",
      easy: mode === "pilot" ? 1 : 4,
      medium: mode === "pilot" ? 1 : 4,
      hard: mode === "pilot" ? 1 : 4,
      imagePercent: 0,
      eliteQuality: true,
      audience: "متابعو المسلسل الذين شاهدوا كل الحلقات",
    },
  },
  {
    name: "general",
    plan: {
      topic:
        "ثقافة عامة عن الاكتشافات العلمية، مع قصص التحولات الكبرى والتجارب التي غيرت فهمنا للعالم",
      easy: mode === "pilot" ? 1 : 4,
      medium: mode === "pilot" ? 1 : 4,
      hard: mode === "pilot" ? 1 : 4,
      imagePercent: 0,
      eliteQuality: true,
      audience: "مسابقة ثقافة عامة للبالغين",
    },
  },
];
const selected = process.argv
  .find((s) => s.startsWith("--group="))
  ?.split("=")[1];
for (const { name, plan } of plans.filter(
  (item) => !selected || item.name === selected,
)) {
  const profileId = mode + "-" + name;
  if (!db.profile(profileId))
    db.saveProfile(profileId, { name: plan.topic, rules: "", mapping: {} });
  let job = db.jobs().find((j) => j.profileId === profileId);
  if (!job) job = worker.enqueue(profileId, plan);
  if (job.status === "failed") {
    job.status = "queued";
    job.error = "";
    db.saveJob(job);
  }
  const jobId = job.id;
  const printProgress = () => {
    const current = db.job(jobId)!;
    console.log(
      JSON.stringify({
        name,
        mode,
        stage: current.qualityStage,
        done: current.done,
        cursor: current.cursor,
        status: current.status,
      }),
    );
  };
  const timer = setInterval(printProgress, 30000);
  try {
    await worker.drain();
  } finally {
    clearInterval(timer);
  }
  printProgress();
  const final = db.job(jobId)!;
  const report = db.qualityReport(jobId);
  writeFileSync(
    path.join(location, profileId + ".json"),
    JSON.stringify(
      { job: final, report, questions: db.acceptedQuestions(jobId) },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      name,
      mode,
      requested: plan.easy + plan.medium + plan.hard,
      accepted: report.accepted,
      rejected: report.rejected,
      stages: report.rejectedByStage,
      types: report.types,
      sources: report.sources,
      error: final.error,
    }),
  );
}
db.db.close();
