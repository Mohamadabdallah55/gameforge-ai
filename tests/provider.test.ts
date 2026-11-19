import test from "node:test";
import assert from "node:assert/strict";
import { Gemini } from "../server/provider";
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
