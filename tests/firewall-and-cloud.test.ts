import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runQuestionFirewall } from "../server/quality-firewall";
import { assertAllowedModel, getGeminiApiKey } from "../server/gemini-client";
import { transform } from "../server/media";
import { Store } from "../server/store";
import { createApp } from "../server/app";

test("Quality Firewall rejects answer leaks, numeric leaks, missing-image cues, and year-swap duplicates", () => {
  const yearLeak = runQuestionFirewall({
    question: "ما هي السنة التي أقيمت فيها كأس العالم ٢٠٢٦؟",
    answer: "2026",
  });
  assert.equal(yearLeak.passed, false);
  assert.equal(yearLeak.stage, "firewall-leak");

  const multiWordLeak = runQuestionFirewall({
    question: "في أي مدينة فاز نادي ريال مدريد باللقب في هذا العام؟",
    answer: "ريال مدريد",
  });
  assert.equal(multiWordLeak.passed, false);
  assert.equal(multiWordLeak.stage, "firewall-leak");

  const noImageRef = runQuestionFirewall({
    question: "من اللاعب الظاهر في هذه الصورة أثناء احتفاله بالهدف؟",
    answer: "محمد صلاح",
    hasImage: false,
  });
  assert.equal(noImageRef.passed, false);
  assert.equal(noImageRef.stage, "firewall-clarity");

  const dup = runQuestionFirewall({
    question: "في أي ملعب أقيم نهائي دوري أبطال أوروبا عام 2016؟",
    answer: "سان سيرو",
    existingQuestions: [
      {
        question: "في أي ملعب أقيم نهائي دوري أبطال أوروبا عام 2015؟",
        answer: "الملعب الأولمبي ببرلين",
      },
    ],
  });
  assert.equal(dup.passed, false);
  assert.equal(dup.stage, "firewall-duplicate");

  const good = runQuestionFirewall({
    question: "أي فريق قلب تأخره بثلاثة أهداف في شوط واحد خلال نهائي إسطنبول 2005؟",
    answer: "ليفربول",
  });
  assert.equal(good.passed, true);
});

test("MY_CUSTOM_GEMINI_KEY supports AQ. keys and rejects deprecated models", () => {
  const prevCustom = process.env.MY_CUSTOM_GEMINI_KEY;
  const prevMain = process.env.GEMINI_API_KEY;
  process.env.MY_CUSTOM_GEMINI_KEY = "AQ.Ab8RN6SampleKeyValue";
  process.env.GEMINI_API_KEY = "AIzaFallback";
  try {
    assert.equal(getGeminiApiKey(), "AQ.Ab8RN6SampleKeyValue");
    assert.doesNotThrow(() => assertAllowedModel("gemini-4-hydrogen"));
    assert.doesNotThrow(() => assertAllowedModel("gemini-3.1-flash-lite"));
    assert.throws(() => assertAllowedModel("gemini-3.8-flash"), {
      code: "gemini_model_not_allowed",
    });
    assert.throws(() => assertAllowedModel("gemini-2.0-flash"), {
      code: "gemini_model_not_allowed",
    });
  } finally {
    if (prevCustom === undefined) delete process.env.MY_CUSTOM_GEMINI_KEY;
    else process.env.MY_CUSTOM_GEMINI_KEY = prevCustom;
    if (prevMain === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevMain;
  }
});

test("Cloud background isolation and silhouette work on Linux without macOS Apple Vision", async () => {
  const img = await sharp({
    create: { width: 40, height: 40, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 14, height: 14, channels: 4, background: { r: 20, g: 40, b: 180, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        left: 13,
        top: 13,
      },
    ])
    .png()
    .toBuffer();

  const isolated = await transform(img, "background");
  const meta = await sharp(isolated).metadata();
  assert.equal(meta.width, 40);
  assert.equal(meta.height, 40);
  const raw = await sharp(isolated).ensureAlpha().raw().toBuffer();
  // Top-left white background corner should become transparent alpha=0
  assert.equal(raw[3], 0);
  // Center blue object pixel should stay opaque alpha=255
  const centerIdx = (20 * 40 + 20) * 4;
  assert.equal(raw[centerIdx + 3], 255);

  const sil = await transform(img, "subject-silhouette");
  const silMeta = await sharp(sil).metadata();
  assert.equal(silMeta.width, 40);
});

test("Question Library CRUD, firewall check, and export preview work end-to-end", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-crud-"));
  const db = new Store(dir);
  const { app } = createApp(db);
  const srv = app.listen(0, "127.0.0.1");
  t.after(() => {
    srv.close();
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise<void>((ok) => srv.once("listening", ok));
  const addr = srv.address();
  assert.ok(addr && typeof addr !== "string");
  const base = `http://127.0.0.1:${addr.port}/api`;

  // Leak fails 422
  const leakRes = await fetch(`${base}/questions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileId: "default",
      question: "ما السنة التي فاز فيها برشلونة 2015؟",
      answer: "2015",
      difficulty: "easy",
    }),
  });
  assert.equal(leakRes.status, 422);

  // Valid manual question creates 201
  const createRes = await fetch(`${base}/questions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileId: "default",
      question: "من سجل هدف الفوز لريال مدريد في نهائي 2022 ضد ليفربول؟",
      answer: "فينيسيوس جونيور",
      difficulty: "medium",
      source: "https://www.uefa.com",
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  // Edit question
  const patchRes = await fetch(`${base}/questions/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileId: "default", difficulty: "hard" }),
  });
  assert.equal(patchRes.status, 200);
  assert.equal((await patchRes.json()).difficulty, "hard");

  // Export preview includes mapped fields
  const preview = await (await fetch(`${base}/export/preview?profileId=default`)).json();
  assert.equal(preview.total, 1);
  assert.equal(preview.rows[0].difficulty, "hard");

  // Delete question
  const delRes = await fetch(`${base}/questions/${created.id}?profileId=default`, {
    method: "DELETE",
  });
  assert.equal(delRes.status, 200);
  const after = await (await fetch(`${base}/questions?profileId=default`)).json();
  assert.equal(after.length, 0);
});
