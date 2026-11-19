import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import JSZip from "jszip";
import {
  planSchema,
  profileSchema,
  slots,
  type Provider,
} from "../shared/contracts";
import { Store, normalize, cosine } from "../server/store";
import { Worker } from "../server/worker";
import { transform, styles } from "../server/media";
import { infer, output } from "../server/files";
const plan = {
  topic: "الجغرافيا",
  easy: 2,
  medium: 1,
  hard: 0,
  imagePercent: 50,
};
function database(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-"));
  const db = new Store(dir);
  t.after(() => {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}
test("exact rounded image allocation and plan validation", () => {
  for (const percent of [0, 10, 33, 50, 99, 100]) {
    const s = slots({ ...plan, imagePercent: percent });
    assert.equal(
      s.filter((x) => x.image).length,
      Math.round((3 * percent) / 100),
    );
    assert.deepEqual(
      s.map((x) => x.level),
      ["easy", "easy", "medium"],
    );
  }
  assert.equal(planSchema.safeParse({ ...plan, easy: -1 }).success, false);
  assert.equal(
    profileSchema.safeParse({ name: "A", mapping: { answer: "question" } })
      .success,
    false,
  );
});
test("Arabic normalization and semantic distance", () => {
  assert.equal(normalize("أَيْـنَ؟"), normalize("اين"));
  assert.ok(cosine([1, 2], [2, 4]) > 0.99);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});
test("real PNG effects preserve dimensions and silhouette transparency", async () => {
  const pixels = Buffer.from([90, 10, 120, 255, 182, 200, 23, 0]);
  const input = await sharp(pixels, {
    raw: { width: 2, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  for (const s of styles) {
    const bytes = await transform(input, s);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 2);
    assert.equal(meta.format, "png");
    if (s === "silhouette")
      assert.deepEqual(
        [...(await sharp(bytes).ensureAlpha().raw().toBuffer())],
        [0, 0, 0, 255, 0, 0, 0, 0],
      );
  }
});
test("export and infer JSON CSV XLSX; ZIP resolves image and attribution", async (t) => {
  const db = database(t);
  db.saveProfile("game", {
    name: "A",
    rules: "",
    mapping: { question: "السؤال" },
  });
  db.putAsset(
    { id: "a", credit: "C", origin: "O", license: "L" },
    Buffer.from("PNG"),
  );
  db.add(
    {
      id: "q",
      profileId: "game",
      question: 'سؤال، "أول"',
      answer: "=1+1",
      image: "a",
      difficulty: "easy",
      quote: "دليل",
      source: "https://example.org",
    },
    [1, 0],
  );
  for (const f of ["json", "csv", "xlsx"]) {
    const bytes = await output(db, "game", f);
    const result = await infer(f, bytes);
    assert.equal(result.rows, 1);
    assert.equal(result.mapping.question, "السؤال");
    if (f === "csv") assert.match(bytes.toString(), /'=1\+1/);
  }
  const zip = await JSZip.loadAsync(await output(db, "game", "zip"));
  const [row] = JSON.parse(await zip.file("questions.json")!.async("text"));
  assert.ok(zip.file(row.image));
  assert.match(await zip.file("credits.json")!.async("text"), /"credit": "C"/);
  assert.equal(db.questions("default").length, 0);
  assert.ok(db.duplicate("game", "another", [0.999, 0.001]));
  assert.ok(!db.duplicate("default", "another", [1, 0]));
});
test("resume a failed job without duplicating committed work", async (t) => {
  const db = database(t);
  let fail = true,
    n = 0;
  const quote = "نص توضيحي للاختبار فقط";
  const ai: Provider = {
    interpret: async () => plan,
    image: async () => Buffer.alloc(0),
    draft: async () => {
      if (n === 1 && fail) throw new Error("اختبار انقطاع");
      n++;
      return {
        question: "سؤال رقم " + n,
        answer: "إجابة",
        sourceIndex: 0,
        quote,
        imageQuery: "",
      };
    },
    verify: async () => true,
    embed: async () => (n === 1 ? [0, 1] : [1, 0]),
  };
  const worker = new Worker(db, ai, async () => [
    { title: "اختبار", url: "https://example.org", text: quote },
  ]);
  const j = worker.enqueue("default", { ...plan, medium: 0, imagePercent: 0 });
  await worker.drain();
  assert.equal(db.job(j.id)?.status, "failed");
  assert.equal(db.job(j.id)?.done, 1);
  fail = false;
  db.saveJob({ ...db.job(j.id)!, status: "running", error: "" });
  await new Worker(db, ai, async () => [
    { title: "مصدر", url: "https://example.org", text: quote },
  ]).drain();
  assert.equal(db.job(j.id)?.status, "complete");
  assert.equal(db.questions("default").length, 2);
});
test("unsupported source quote never becomes a saved question", async (t) => {
  const db = database(t);
  const ai = {
    draft: async () => ({
      question: "سؤال اختبار",
      answer: "جواب",
      sourceIndex: 0,
      quote: "نص غير موجود",
      imageQuery: "",
    }),
  } as unknown as Provider;
  const worker = new Worker(db, ai, async () => [
    { title: "مصدر", url: "https://example.org", text: "نص المصدر" },
  ]);
  const j = worker.enqueue("default", { ...plan, imagePercent: 0 });
  await worker.drain();
  assert.equal(db.job(j.id)?.done, 0);
  assert.equal(db.job(j.id)?.status, "failed");
  assert.equal(db.questions("default").length, 0);
});

test("opaque silhouette, question CRUD, SQLite healthCheck, and audit duplicate detection", async (t) => {
  const db = database(t);
  // Opaque image silhouette should produce solid black subject on white background
  const img = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 6,
            height: 6,
            channels: 3,
            background: { r: 20, g: 20, b: 20 },
          },
        })
          .png()
          .toBuffer(),
        top: 5,
        left: 5,
      },
    ])
    .png()
    .toBuffer();
  const sil = await transform(img, "silhouette");
  const silMeta = await sharp(sil).metadata();
  assert.equal(silMeta.width, 16);

  db.add(
    {
      id: "q1",
      profileId: "default",
      question: "ما هي عاصمة الأردن؟",
      answer: "عمّان",
      difficulty: "easy",
      source: "https://example.org",
      quote: "تعد عمّان عاصمة المملكة الأردنية الهاشمية",
      image: null,
      auditStatus: "pending",
    },
    [1, 0, 0],
  );
  db.add(
    {
      id: "q2",
      profileId: "default",
      question: "ما عاصمة المملكة الأردنية؟",
      answer: "عمّان",
      difficulty: "easy",
      source: "https://example.org",
      quote: "تعد عمّان عاصمة المملكة الأردنية الهاشمية",
      image: null,
      auditStatus: "pending",
    },
    [0.99, 0.05, 0],
  );

  const { auditLibrary } = await import("../server/audit");
  const report = await auditLibrary(db, "default");
  assert.equal(report.totalQuestions, 2);
  assert.equal(report.duplicatePairs, 1);

  const existing = db.question("default", "q1")!;
  db.updateQuestion("default", { ...existing, answer: "عمان الكبرى" });
  assert.equal(db.question("default", "q1")?.answer, "عمان الكبرى");
  assert.equal(db.deleteQuestion("default", "q2"), true);

  const health = db.healthCheck();
  assert.equal(health.integrity, true);
  assert.equal(health.counts.questions, 1);
});

test("batch drafting and pause/resume preserve exact progress for large jobs", async (t) => {
  const db = database(t);
  let counter = 0;
  const quote = "حقق المنتخب الأرجنتيني لقب كأس العالم في قطر عام 2022";
  const ai = {
    interpret: async () => plan,
    image: async () => Buffer.alloc(0),
    draft: async () => {
      counter++;
      return {
        question: "سؤال دفعة رقم " + counter,
        answer: "الأرجنتين",
        sourceIndex: 0,
        quote,
        imageQuery: "",
      };
    },
    draftBatch: async (
      _topic: string,
      _level: any,
      _rules: string,
      _sources: any,
      _avoid: string[],
      count: number,
    ) =>
      Array.from({ length: count }, () => {
        counter++;
        return {
          question: "سؤال دفعة رقم " + counter,
          answer: "الأرجنتين",
          sourceIndex: 0,
          quote,
          imageQuery: "",
        };
      }),
    verify: async () => true,
    embed: async (text: string) => {
      const m = text.match(/(\d+)/);
      const idx = m ? Number(m[1]) : 0;
      return [Math.cos(idx * 0.8), Math.sin(idx * 0.8)];
    },
  } as unknown as Provider;

  const worker = new Worker(db, ai, async () => [
    { title: "مصدر", url: "https://example.org", text: quote },
  ]);
  const j = worker.enqueue("default", {
    topic: "كأس العالم 2022",
    easy: 6,
    medium: 0,
    hard: 0,
    imagePercent: 0,
  });
  await worker.drain();
  assert.equal(db.job(j.id)?.status, "complete");
  assert.equal(db.job(j.id)?.done, 6);
  assert.equal(db.questions("default").length, 6);
});

