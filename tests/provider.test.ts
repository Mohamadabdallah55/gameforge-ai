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
    GEMINI_API_KEY: "AQ.test-only-key",
    MY_CUSTOM_GEMINI_KEY: "",
    GEMINI_FREE_PROJECT_CONFIRMED: "0",
    GEMINI_ELITE_MODEL: "gemini-4-hydrogen",
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
    async (target: string | URL | Request, init?: RequestInit) => {
      const url = typeof target === "string" ? target : target instanceof URL ? target.toString() : target.url;
      calls++;
      assert.match(
        url,
        /\/models\/gemini-4-hydrogen/,
      );
      assert.ok(!url.includes("AQ.test-only-key"));
      const hdrs = new Headers(
        init?.headers ?? (target instanceof Request ? target.headers : undefined),
      );
      assert.equal(hdrs.get("x-goog-api-key"), "AQ.test-only-key");
      assert.match(hdrs.get("user-agent") || "", /aistudio-build/);

      const method = init?.method || (target instanceof Request ? target.method : "GET");
      if (method.toUpperCase() === "GET") {
        return Response.json({
          name: "models/gemini-4-hydrogen",
          supportedActions: ["generateContent"],
        });
      }
      const bodyText =
        typeof init?.body === "string"
          ? init.body
          : target instanceof Request
            ? await target.text()
            : "{}";
      const body = JSON.parse(bodyText);
      assert.equal(body.tools, undefined);
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
      return Response.json({ error: { code: 429, message: "quota exceeded" } }, { status: 429 });
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
  await assert.rejects(provider.ready("gemini-3.1-flash-lite"), {
    code: "gemini_model_changed",
  });
  assert.equal(calls, 2);
});

test("Gemini SDK adapter validates JSON, maps embeddings and gates/decodes image edits", async (t) => {
  const keys = [
    "GEMINI_API_KEY",
    "MY_CUSTOM_GEMINI_KEY",
    "GEMINI_PAID_KEY_APPROVED",
  ] as const;
  const saved = keys.map((k) => [k, process.env[k]] as const);
  process.env.MY_CUSTOM_GEMINI_KEY = "AQ.custom-secret-key";
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_PAID_KEY_APPROVED;
  t.after(() => {
    for (const [k, v] of saved)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
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

  t.mock.method(
    globalThis,
    "fetch",
    async (target: string | URL | Request, init?: RequestInit) => {
      const url = typeof target === "string" ? target : target instanceof URL ? target.toString() : target.url;
      const hdrs = new Headers(
        init?.headers ?? (target instanceof Request ? target.headers : undefined),
      );
      assert.equal(hdrs.get("x-goog-api-key"), "AQ.custom-secret-key");
      assert.ok(!url.includes("AQ.custom-secret-key"));
      const bodyText =
        typeof init?.body === "string"
          ? init.body
          : target instanceof Request
            ? await target.text()
            : "{}";
      const body = JSON.parse(bodyText);
      let reply;
      if (url.includes(":embedContent") || url.includes(":batchEmbedContents")) {
        reply = { embedding: { values: [0, 1] }, embeddings: [{ values: [0, 1] }] };
      } else if (url.includes("flash-lite-image")) {
        assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
        reply = {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { data: png.toString("base64"), mimeType: "image/png" } }],
              },
            },
          ],
        };
      } else {
        assert.equal(body.generationConfig?.responseMimeType, "application/json");
        reply = {
          candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }],
        };
      }
      return Response.json(reply);
    },
  );

  assert.deepEqual(await gemini.interpret("ستة أسئلة عن الموسم الثاني"), plan);
  assert.deepEqual(await gemini.embed("نص"), [0, 1]);

  // Paid image models blocked cleanly until explicit approval
  await assert.rejects(gemini.image("رسم", png), {
    code: "paid_image_model_required",
  });
  process.env.GEMINI_PAID_KEY_APPROVED = "1";
  assert.deepEqual(await gemini.image("رسم", png), png);
});

test("missing Gemini key reports an actionable error before network access", async (t) => {
  const old = process.env.GEMINI_API_KEY;
  const oldCustom = process.env.MY_CUSTOM_GEMINI_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.MY_CUSTOM_GEMINI_KEY;
  t.after(() => {
    if (old !== undefined) process.env.GEMINI_API_KEY = old;
    if (oldCustom !== undefined) process.env.MY_CUSTOM_GEMINI_KEY = oldCustom;
  });
  await assert.rejects(new Gemini().interpret("طلب"), /GEMINI_API_KEY/);
});
