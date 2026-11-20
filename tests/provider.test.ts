import test from "node:test";
import assert from "node:assert/strict";
import { Gemini } from "../server/provider";
import { EliteGemini } from "../server/elite-gemini";
import { LocalProvider } from "../server/local";
import { Store } from "../server/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("Elite uses the configured official model, sends actual image input, and surfaces quota without retries", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "forge-gemini-gate-"));
  const db = new Store(dir);
  const config = {
    GEMINI_API_KEY: "test-only",
    GEMINI_FREE_PROJECT_CONFIRMED: "0",
    GEMINI_ELITE_MODEL: "gemini-3.8-flash",
  };
  const saved = Object.keys(config).map(
    (key) => [key, process.env[key]] as const,
  );
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of saved)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (target: string, init: RequestInit) => {
      calls++;
      assert.match(
        target,
        /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash/,
      );
      assert.ok(!target.includes("test-only"));
      if (init.method === "GET")
        return Response.json({
          supportedGenerationMethods: ["generateContent"],
        });
      const body = JSON.parse(String(init.body));
      assert.equal(body.tools, undefined);
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
      return Response.json({ error: "rate" }, { status: 429 });
    },
  );
  const provider = new EliteGemini(new LocalProvider(), db);
  const status = await provider.status();
  assert.equal(status.connected, true);
  assert.equal(status.detail?.productionEnabled, false);
  await assert.rejects(provider.ready(), { code: "gemini_setup_required" });
  assert.equal(calls, 1);
  process.env.GEMINI_FREE_PROJECT_CONFIRMED = "1";
  await assert.rejects(
    provider.assessPicture(
      {
        question: "أي موقع يظهر في الصورة؟",
        answer: "البتراء",
        event: "البتراء",
        recognition: true,
      },
      "test caption",
      Buffer.from("image fixture"),
    ),
    { code: "gemini_quota", status: 429 },
  );
  assert.equal(calls, 2);
  await assert.rejects(provider.ready("gemini-3.5-flash-lite"), {
    code: "gemini_model_changed",
  });
  assert.equal(calls, 2);
});
test("Gemini REST adapter validates JSON, maps embeddings and decodes image edits", async (t) => {
  const old = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-only";
  t.after(() => {
    if (old === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = old;
  });
  const gemini = new Gemini(),
    plan = {
      topic: "الموسم الثاني",
      easy: 1,
      medium: 3,
      hard: 2,
      imagePercent: 50,
    };
  const png = Buffer.from("unit-test-response");
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(
      (init.headers as Record<string, string>)["x-goog-api-key"],
      "test-only",
    );
    assert.ok(!url.includes("test-only"));
    const body = JSON.parse(String(init.body));
    let reply;
    if (url.endsWith(":embedContent")) {
      assert.equal(body.taskType, "SEMANTIC_SIMILARITY");
      reply = { embedding: { values: [0, 1] } };
    } else if (body.generationConfig.responseModalities) {
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
      reply = {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: png.toString("base64") } }],
            },
          },
        ],
      };
    } else {
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      reply = {
        candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }],
      };
    }
    return Response.json(reply);
  });
  assert.deepEqual(await gemini.interpret("ستة أسئلة عن الموسم الثاني"), plan);
  assert.deepEqual(await gemini.embed("نص"), [0, 1]);
  assert.deepEqual(await gemini.image("رسم", png), png);
});
test("missing Gemini key reports an actionable error before network access", async (t) => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  t.after(() => {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
  });
  await assert.rejects(new Gemini().interpret("طلب"), /GEMINI_API_KEY/);
});
