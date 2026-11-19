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
  assert.equal(gemini.embedModel, "gemini-embedding-2");
  assert.deepEqual(await gemini.interpret("ستة أسئلة عن الموسم الثاني"), plan);
  assert.deepEqual(await gemini.embed("نص"), [0, 1]);
  assert.deepEqual(
    await gemini.image("رسم", png, { model: "gemini-3.1-flash-lite-image" }),
    png,
  );
  const evidence = await gemini.searchEvidence("كأس العالم 1930");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].url, "https://example.org/wc");

  const standardOpts = buildGoogleGenAIOptions("AIzaFakeStandardKey");
  assert.equal((standardOpts as any).enterprise, undefined);
  const expressOpts = buildGoogleGenAIOptions("AQ.FakeExpressKey");
  assert.equal((expressOpts as any).enterprise, true);
});

test("missing Gemini key reports an actionable error before network access", async (t) => {
  const oldGemini = process.env.GEMINI_API_KEY;
  const oldGoogle = process.env.GOOGLE_API_KEY;
  const oldVertex = process.env.VERTEX_EXPRESS_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.VERTEX_EXPRESS_API_KEY;
  t.after(() => {
    if (oldGemini !== undefined) process.env.GEMINI_API_KEY = oldGemini;
    if (oldGoogle !== undefined) process.env.GOOGLE_API_KEY = oldGoogle;
    if (oldVertex !== undefined) process.env.VERTEX_EXPRESS_API_KEY = oldVertex;
  });
  assert.equal(resolveGeminiKey(), "");
  await assert.rejects(new Gemini().interpret("طلب"), /GEMINI_API_KEY/);
});
