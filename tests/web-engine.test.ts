import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { WebExtractionProvider } from "../server/web-engine";
import { parseBingImagesHtml } from "../server/search";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { QualityEngine } from "../server/quality-engine";
import { runQuestionFirewall } from "../server/quality-firewall";

test("WebExtractionProvider interprets Arabic quiz briefs accurately including player photos and hard cues", async () => {
  const engine = new WebExtractionProvider();

  const playersPlan = await engine.interpret("خمس صور للاعبين محنك الي بعرفهم");
  assert.equal(playersPlan.easy + playersPlan.medium + playersPlan.hard, 5);
  assert.equal(playersPlan.hard, 5);
  assert.equal(playersPlan.imagePercent, 100);
  assert.equal(playersPlan.imageMode, "real");
  assert.match(playersPlan.topic, /كرة القدم|لاعب/);

  const sketchPlan = await engine.interpret("عشرين سؤالًا عن دوري أبطال أوروبا نصفها سكتش");
  assert.equal(sketchPlan.easy + sketchPlan.medium + sketchPlan.hard, 20);
  assert.equal(sketchPlan.imagePercent, 50);
  assert.equal(sketchPlan.imageMode, "sketch");
  assert.match(sketchPlan.topic, /دوري أبطال أوروبا/);
});

test("WebExtractionProvider builds deterministic 768-D semantic embeddings and detects similarity", async () => {
  const engine = new WebExtractionProvider();
  const a = await engine.embed("من هو اللاعب الإيطالي الفائز بالكرة الذهبية 1993؟");
  const b = await engine.embed("من هو اللاعب الإيطالي الفائز بالكرة الذهبية 1993");
  const c = await engine.embed("في أي سنة اكتُشف كوكب نبتون فلكيًا؟");

  assert.equal(a.length, 768);
  const dot = (u: number[], v: number[]) =>
    u.reduce((sum, val, i) => sum + val * v[i], 0);
  assert.ok(dot(a, b) > 0.95);
  assert.ok(dot(a, c) < 0.7);
});

test("parseBingImagesHtml extracts clean https image URLs from /images/async HTML entities", () => {
  const html = `
    <div class="dg_u">
      <a class="iusc" m="{&quot;murl&quot;:&quot;https://cdn.example.com/baggio.jpg&quot;,&quot;purl&quot;:&quot;https://www.bbc.com/sport/baggio&quot;,&quot;turl&quot;:&quot;https://tse1.mm.bing.net/th?id=123&quot;,&quot;t&quot;:&quot;Roberto Baggio Italy 1994&quot;}"></a>
    </div>
    <div class="dg_u">
      <span>&quot;murl&quot;:&quot;https://cdn.example.com/maldini.jpg&quot;,&quot;turl&quot;:&quot;https://tse2.mm.bing.net/th?id=456&quot;,&quot;purl&quot;:&quot;https://www.uefa.com/maldini&quot;,&quot;t&quot;:&quot;Paolo Maldini AC Milan&quot;</span>
    </div>
  `;
  const parsed = parseBingImagesHtml(html);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].img_src, "https://cdn.example.com/baggio.jpg");
  assert.equal(parsed[0].url, "https://www.bbc.com/sport/baggio");
  assert.equal(parsed[1].img_src, "https://cdn.example.com/maldini.jpg");
  assert.equal(parsed[1].url, "https://www.uefa.com/maldini");
});

test("WebExtractionProvider visual verification checks resolution, contrast, and subject match", async () => {
  const engine = new WebExtractionProvider();
  // Create a realistic non-flat 640x480 test PNG buffer (gradient-like pattern via noise/composite)
  const raw = Buffer.alloc(640 * 480 * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i * 13) % 255;
    raw[i + 1] = (i * 7) % 255;
    raw[i + 2] = (i * 29) % 255;
  }
  const goodPng = await sharp(raw, { raw: { width: 640, height: 480, channels: 3 } })
    .png()
    .toBuffer();

  const pass = await engine.assessPicture(
    {
      question: "من اللاعب الظاهر في الصورة؟",
      answer: "روبرتو باجيو",
      event: "Roberto Baggio Italy World Cup 1994",
      recognition: true,
    },
    "Roberto Baggio playing for Italy in 1994 FIFA World Cup",
    goodPng,
  );
  assert.equal(pass.sourceMatch, true);
  assert.equal(pass.eventMatch, true);
  assert.ok(pass.quality >= 72);

  const conflict = await engine.assessPicture(
    {
      question: "من اللاعب الظاهر في الصورة؟",
      answer: "روبرتو باجيو",
      event: "Roberto Baggio",
      recognition: true,
    },
    "Paolo Maldini lifting the Champions League trophy with AC Milan",
    goodPng,
  );
  assert.equal(conflict.sourceMatch, false);
});

test("Zero-key API routes (/engines, /production/eligibility, /interpret, /assistant) work when no Gemini key is configured", async (t) => {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevCustom = process.env.MY_CUSTOM_GEMINI_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.MY_CUSTOM_GEMINI_KEY;

  const dir = mkdtempSync(path.join(tmpdir(), "forge-zero-key-"));
  const db = new Store(dir);
  const { app } = createApp(db);
  const srv = app.listen(0, "127.0.0.1");
  t.after(() => {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    if (prevCustom !== undefined) process.env.MY_CUSTOM_GEMINI_KEY = prevCustom;
    srv.close();
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise<void>((ok) => srv.once("listening", ok));
  const addr = srv.address();
  assert.ok(addr && typeof addr !== "string");
  const base = `http://127.0.0.1:${addr.port}/api`;

  const engines = await (await fetch(`${base}/engines`)).json();
  const webEngineStatus = engines.engines.find(
    (e: any) => e.name === "Web Extraction & Question Engine",
  );
  assert.equal(webEngineStatus?.connected, true);

  const eligRes = await fetch(`${base}/production/eligibility`);
  assert.equal(eligRes.status, 200);
  const elig = await eligRes.json();
  assert.equal(elig.provider, "web-engine");

  const interpRes = await fetch(`${base}/interpret`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: "خمس صور للاعبين محنك الي بعرفهم" }),
  });
  assert.equal(interpRes.status, 200);
  const plan = await interpRes.json();
  assert.equal(plan.easy + plan.medium + plan.hard, 5);
  assert.equal(plan.imagePercent, 100);

  const copilotRes = await fetch(`${base}/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: "خمس صور للاعبين محنك الي بعرفهم", profileId: "default" }),
  });
  assert.equal(copilotRes.status, 200);
  const copilot = await copilotRes.json();
  assert.equal(copilot.suggestedAction?.type, "start_production");
  assert.ok(copilot.suggestedPlan);
});

test("WebExtractionProvider drafts firewall-clean non-leaking Arabic quiz questions", async () => {
  const engine = new WebExtractionProvider();
  const res = await engine.structured(
    "Write one compelling Arabic quiz question based ONLY on the supplied quote",
    {
      picture: true,
      imageMode: "real",
      scope: "أساطير كرة القدم",
      rules: "",
      audience: "عام",
      requestedLevel: "hard",
      fact: "المدافع الأسطوري الذي أمضى مسيرته كاملة في صفوف ميلان وتُوّج بخمس بطولات دوري أبطال أوروبا",
      answer: "باولو مالديني",
      event: "Paolo Maldini — one club defensive icon",
      quote: "Paolo Maldini spent all 25 seasons of his career at AC Milan and won five European Cups.",
      fetchedDocument: {
        publisher: "uefa.com",
        url: "https://www.uefa.com/maldini",
        title: "Paolo Maldini profile",
        excerpt: "Paolo Maldini spent all 25 seasons of his career at AC Milan and won five European Cups.",
      },
    },
    (await import("zod")).z.object({
      question: (await import("zod")).z.string(),
      answer: (await import("zod")).z.string(),
      imageQuery: (await import("zod")).z.string(),
      imagePurpose: (await import("zod")).z.enum(["recognition", "evidence", "none"]),
    }),
  );

  const fw = runQuestionFirewall({
    question: res.question,
    answer: res.answer,
    hasImage: true,
  });
  assert.equal(fw.passed, true);
  assert.equal(res.imagePurpose, "recognition");
  assert.equal(res.imageQuery, "Paolo Maldini");
});

test("WebExtractionProvider interprets and drafts universal non-football topics without sports phrasing", async () => {
  const engine = new WebExtractionProvider();

  const spacePlan = await engine.interpret("خمس صور عن الثقوب السوداء والفضاء");
  assert.equal(spacePlan.easy + spacePlan.medium + spacePlan.hard, 5);
  assert.equal(spacePlan.imagePercent, 100);
  assert.equal(spacePlan.imageMode, "real");
  assert.match(spacePlan.topic, /الثقوب السوداء/);

  const modernPlayersMap = await engine.structured(
    "Build a topic-specific research map for an Arabic quiz.",
    {
      topic: "نجوم كرة القدم المعاصرون",
      headlines: [],
      preferences: { brief: "لاعبين ما بعرفهم الا المتابع القوي جدا و لا تجيبلي قدام" },
      difficultyCounts: { easy: 0, medium: 0, hard: 5 },
    },
    (await import("zod")).z.object({
      arabicSubject: (await import("zod")).z.string(),
      englishSubject: (await import("zod")).z.string(),
      scopeMarkers: (await import("zod")).z.array((await import("zod")).z.string()),
      facets: (await import("zod")).z.array(
        (await import("zod")).z.object({
          name: (await import("zod")).z.string(),
          ar: (await import("zod")).z.string(),
          en: (await import("zod")).z.string(),
          preferredSites: (await import("zod")).z.array((await import("zod")).z.string()),
        }),
      ),
    }),
  );
  assert.ok(modernPlayersMap.facets.every((f) => !/باجيو|مالديني|كرويف|فان باستن|بيكنباور/.test(f.name)));

  const spaceDraft = await engine.structured(
    "Write one compelling Arabic quiz question based ONLY on the supplied quote",
    {
      picture: true,
      imageMode: "real",
      scope: "الثقوب السوداء والفضاء",
      rules: "",
      audience: "عام",
      requestedLevel: "medium",
      fact: "[term] تتميز هذه الظاهرة الكونية بجاذبية هائلة داخل هذا العنصر لا يستطيع حتى الضوء الإفلات منها",
      answer: "أفق الحدث",
      event: "أفق الحدث (Event horizon)",
      quote: "يُعرف الحد الفاصل الذي لا يمكن للضوء الإفلات منه بـ «أفق الحدث» حول الثقب الأسود.",
      fetchedDocument: {
        publisher: "ar.wikipedia.org",
        url: "https://ar.wikipedia.org/wiki/black-hole",
        title: "الثقب الأسود",
        excerpt: "يُعرف الحد الفاصل الذي لا يمكن للضوء الإفلات منه بـ «أفق الحدث» حول الثقب الأسود.",
      },
    },
    (await import("zod")).z.object({
      question: (await import("zod")).z.string(),
      answer: (await import("zod")).z.string(),
      imageQuery: (await import("zod")).z.string(),
      imagePurpose: (await import("zod")).z.enum(["recognition", "evidence", "none"]),
    }),
  );
  assert.doesNotMatch(spaceDraft.question, /اللاعب|الرياضية/);
  assert.equal(spaceDraft.imagePurpose, "evidence");
});

