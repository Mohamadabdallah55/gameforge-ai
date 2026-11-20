import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import JSZip from "jszip";
import { provider } from "../server/local";
import { information, pictures, persistSearch } from "../server/search";
import { realPicture } from "../server/image-engine";
import { Store } from "../server/store";
import { output } from "../server/files";
import { Worker } from "../server/worker";

delete process.env.GEMINI_API_KEY;
delete process.env.TAVILY_API_KEY;
process.env.AI_PROVIDER = "local";
process.env.EXTERNAL_SEARCH = "";
const dir = mkdtempSync(path.join(tmpdir(), "gameforge-live-"));
const db = new Store(dir);
persistSearch(db);
const ai = provider();
const mode = process.argv[2];
try {
  if (mode === "search") {
    const sources = await information("2022 FIFA World Cup");
    assert.ok(sources.some((s) => s.text.includes("Argentina")));
    console.log("Evidence", sources.length, sources[0]?.url);
    const hits = await pictures("Amman Roman theatre");
    assert.ok(hits.length > 0);
    console.log("Licensed image results", hits.length);
    const image = await realPicture("Amman Roman theatre");
    assert.equal((await sharp(image.png).metadata()).format, "png");
    console.log(
      "Downloaded image",
      image.meta.origin,
      image.meta.license,
      image.png.length,
    );
  } else if (mode === "image") {
    const png = await ai.image(
      "A blue ceramic teapot on white background. Studio product photo.",
    );
    assert.equal((await sharp(png).metadata()).width, 512);
    const edited = await ai.image(
      "A black and white pencil drawing of the same teapot",
      png,
    );
    assert.equal((await sharp(edited).metadata()).width, 512);
    assert.notDeepEqual(png, edited);
    console.log("Generated and edited", png.length, edited.length);
  } else {
    const plan = await ai.interpret(
      "أريد سؤالًا سهلًا واحدًا عن كأس العالم 2022، بدون صور.",
    );
    assert.equal(plan.easy, 1);
    assert.equal(plan.imagePercent, 0);
    console.log("Local Arabic plan", plan);
    const embedding = await ai.embed("أين أقيم كأس العالم 2022؟");
    assert.equal(embedding.length, 1024);
    const worker = new Worker(db, ai, information, "ollama:bge-m3");
    const job = worker.enqueue("default", {
      topic: "2022 FIFA World Cup",
      easy: 1,
      medium: 0,
      hard: 0,
      imagePercent: 0,
    });
    await worker.drain();
    const completed = db.job(job.id)!;
    assert.equal(completed.status, "complete", completed.error);
    const [q] = db.questions("default");
    assert.ok(q.quote && q.source && q.answer);
    console.log("Verified local Q&A", q.question, q.answer, q.source);
    for (const fmt of ["json", "csv", "xlsx", "zip"])
      assert.ok((await output(db, "default", fmt)).length > 20);
    const zip = await JSZip.loadAsync(await output(db, "default", "zip"));
    assert.ok(zip.file("evidence.json"));
    console.log("Exports JSON CSV XLSX ZIP");
  }
} finally {
  db.db.close();
  rmSync(dir, { recursive: true, force: true });
}
