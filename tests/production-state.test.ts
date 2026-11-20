import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import {
  checkJobControl,
  JobInterrupted,
  ProductionUnavailable,
} from "../server/production-state";
import { LocalProvider } from "../server/local";
import { Worker } from "../server/worker";

test("Gemini quota pauses the same model's pending jobs and preserves their checkpoints", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-job-quota-"));
  const db = new Store(dir);
  try {
    let attempts = 0;
    const worker = new Worker(
      db,
      new LocalProvider(),
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        attempts++;
        throw new ProductionUnavailable("quota", "gemini_quota", 429);
      },
    );
    const plan = {
      topic: "تراث",
      easy: 2,
      medium: 0,
      hard: 0,
      imagePercent: 0,
    };
    const pin = { provider: "gemini", model: "gemini-3.8-flash" } as const;
    const job = worker.enqueue("default", plan, undefined, pin);
    db.saveJob({ ...job, cursor: 1, done: 1 });
    const other = worker.enqueue("default", plan, undefined, pin);
    await worker.drain();
    assert.equal(attempts, 1);
    assert.equal(db.job(job.id)?.done, 1);
    assert.equal(db.job(job.id)?.cursor, 1);
    assert.equal(db.job(other.id)?.pauseCode, "gemini_quota");
    assert.ok(db.jobs().every((item) => item.status === "paused"));
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pause, resume from saved progress and cancel are persisted through the production API", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-job-state-"));
  const db = new Store(dir);
  const { app } = createApp(db);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = "http://127.0.0.1:" + address.port + "/api/jobs/";
    const post = (suffix: string, body = {}) =>
      fetch(base + suffix, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const plan = {
      topic: "صور",
      easy: 1,
      medium: 0,
      hard: 0,
      imagePercent: 100,
    };
    const saved = {
      id: "test-paused",
      profileId: "default",
      plan,
      done: 1,
      cursor: 1,
      imageQuestionIds: ["already-processed"],
      status: "queued" as const,
      error: "",
    };
    db.saveJob(saved);
    const pause = await post(saved.id + "/control", { action: "pause" });
    assert.equal(pause.status, 200);
    assert.equal(db.job(saved.id)?.done, 1);
    assert.throws(() => checkJobControl(db, saved), JobInterrupted);
    const resume = await post(saved.id + "/retry");
    assert.equal(resume.status, 202);
    for (let i = 0; i < 20 && db.job(saved.id)?.status !== "complete"; i++)
      await wait(20);
    assert.equal(db.job(saved.id)?.status, "complete");
    assert.equal(db.job(saved.id)?.done, 1);
    assert.equal(db.job(saved.id)?.cursor, 1);

    const cancelled = { ...saved, id: "test-cancelled" };
    db.saveJob(cancelled);
    assert.equal(
      (await post(cancelled.id + "/control", { action: "cancel" })).status,
      200,
    );
    assert.equal((await post(cancelled.id + "/retry")).status, 409);
    assert.equal(db.job(cancelled.id)?.status, "cancelled");
  } finally {
    server.close();
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
