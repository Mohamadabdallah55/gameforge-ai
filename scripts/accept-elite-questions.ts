import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import type { Job } from "../shared/contracts";

const directory = mkdtempSync(
  path.join(tmpdir(), "gameforge-elite-questions-"),
);
const reportDirectory = path.resolve(
  process.env.QUALITY_ACCEPTANCE_DIR ||
    "../../work/elite-intelligence-acceptance",
);
mkdirSync(reportDirectory, { recursive: true });
const db = new Store(directory);
const { app } = createApp(db);
const server = app.listen(0, "127.0.0.1");
const report: unknown[] = [];
try {
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Local acceptance server unavailable");
  const url = "http://127.0.0.1:" + address.port + "/api/jobs";
  const cases = [
    [
      "champions",
      "دوري أبطال أوروبا بين 1992 و2025",
      "متابعو كرة القدم الأوروبية",
    ],
    [
      "series",
      "مسلسل Breaking Bad عبر مواسمه الخمسة",
      "مشاهدون تابعوا الحلقات كاملة",
    ],
    [
      "general",
      "ثقافة عامة عن قصص الاكتشافات العلمية",
      "جمهور مسابقات الثقافة العامة",
    ],
  ];
  for (const [name, topic, audience] of cases) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        director: "gemini",
        profileId: "default",
        plan: {
          topic,
          audience,
          audienceRegion: "mixed",
          easy: 10,
          medium: 10,
          hard: 10,
          imagePercent: 0,
        },
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      process.exitCode = 1;
      const row = {
        name,
        requested: 30,
        accepted: 0,
        status: res.status,
        code: body.code,
        error: body.error,
      };
      report.push(row);
      console.log(JSON.stringify(row));
      continue;
    }
    const id = (body as Job).id;
    let job = db.job(id)!;
    while (job.status === "queued" || job.status === "running") {
      await wait(3000);
      job = db.job(id)!;
    }
    const row = {
      name,
      requested: 30,
      job,
      quality: db.qualityReport(id),
      questions: db.acceptedQuestions(id),
    };
    report.push(row);
    console.log(
      JSON.stringify({
        name,
        requested: 30,
        accepted: job.done,
        status: job.status,
        error: job.error,
      }),
    );
    if (job.done !== 30) process.exitCode = 1;
    if (job.status === "paused") {
      process.exitCode = 1;
      break;
    }
  }
} finally {
  const filename = path.join(reportDirectory, "question-acceptance.json");
  writeFileSync(filename, JSON.stringify(report, null, 2));
  server.close();
  db.db.close();
  rmSync(directory, { recursive: true, force: true });
}
