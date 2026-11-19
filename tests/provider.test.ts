import test from "node:test";
import assert from "node:assert/strict";
import type { GoogleGenAI } from "@google/genai";
import {
  buildGoogleGenAIOptions,
  Gemini,
  resolveGeminiKey,
} from "../server/provider";

test("Gemini SDK adapter validates JSON, Search Grounding, embeddings, and image edits", async () => {
  const plan = {
    topic: "الموسم الثاني",
    easy: 1,
    medium: 3,
    hard: 2,
    imagePercent: 50,
  };
  const png = Buffer.from("unit-test-response");

  const fakeClient = {
    models: {
      generateContent: async (req: any) => {
        if (req.config?.tools?.some((x: any) => x.googleSearch)) {
          return {
            text: "تم التأسيس عام 1930 في الأوروغواي.",
            candidates: [
              {
                groundingMetadata: {
                  groundingChunks: [
                    { web: { uri: "https://example.org/wc", title: "WC 1930" } },
                  ],
                  groundingSupports: [
                    {
                      segment: { text: "تم التأسيس عام 1930 في الأوروغواي." },
                      groundingChunkIndices: [0],
                    },
                  ],
                },
              },
            ],
          };
        }
        if (req.config?.imageConfig) {
          assert.equal(req.contents.parts[0].inlineData.mimeType, "image/png");
          return {
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { data: png.toString("base64") } }],
                },
              },
            ],
          };
        }
        assert.equal(req.config?.responseMimeType, "application/json");
        return { text: JSON.stringify(plan) };
      },
      embedContent: async (req: any) => {
        assert.equal(req.config.taskType, "SEMANTIC_SIMILARITY");
        return { embeddings: [{ values: [0, 1] }] };
      },
    },
  } as unknown as GoogleGenAI;

  const gemini = new Gemini(fakeClient);
  assert.equal(gemini.textModel, "gemini-3.1-flash-lite");
  assert.equal(gemini.fastThinkingConfig?.thinkingLevel, "MINIMAL");
  assert.equal(gemini.embedModel, "gemini-embedding-2");
  assert.equal(new Gemini().defaultDelayMs, 3000);
  assert.deepEqual(await gemini.interpret("ستة أسئلة عن الموسم الثاني"), plan);
  assert.deepEqual(await gemini.embed("نص"), [0, 1]);
  assert.deepEqual(
    await gemini.image("رسم", png, { model: "gemini-3.1-flash-lite-image" }),
    png,
  );
  const evidence = await gemini.searchEvidence("كأس العالم 1930");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].url, "https://example.org/wc");

  const pacedGemini = new Gemini(fakeClient, 60);
  const timestamps: number[] = [];
  await pacedGemini.runCall(async () => {
    timestamps.push(Date.now());
    return "first";
  });
  await pacedGemini.runCall(async () => {
    timestamps.push(Date.now());
    return "second";
  });
  assert.ok(
    timestamps[1] - timestamps[0] >= 50,
    `Expected consecutive paced calls to wait >= 50ms, got ${timestamps[1] - timestamps[0]}ms`,
  );

  const standardOpts = buildGoogleGenAIOptions("AIzaFakeStandardKey");
  assert.equal(standardOpts.apiKey, "AIzaFakeStandardKey");
  assert.equal((standardOpts as any).enterprise, undefined);
  const aqOpts = buildGoogleGenAIOptions("AQ.FakeKey");
  assert.equal(aqOpts.apiKey, "AQ.FakeKey");
  assert.equal((aqOpts as any).enterprise, undefined);
});

test("missing Gemini key reports an actionable error before network access", async (t) => {
  const oldCustom = process.env.MY_CUSTOM_GEMINI_KEY;
  delete process.env.MY_CUSTOM_GEMINI_KEY;
  t.after(() => {
    if (oldCustom !== undefined) process.env.MY_CUSTOM_GEMINI_KEY = oldCustom;
  });
  assert.equal(resolveGeminiKey(), "");
  await assert.rejects(new Gemini().interpret("طلب"), /MY_CUSTOM_GEMINI_KEY/);
  process.env.MY_CUSTOM_GEMINI_KEY = ' "AQ.TestTrimmedKey" ';
  assert.equal(resolveGeminiKey(), "AQ.TestTrimmedKey");
});
