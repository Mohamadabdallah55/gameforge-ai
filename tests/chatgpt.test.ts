import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { ChatGPTError, ChatGPTSession } from "../server/chatgpt-session";
import { completedText } from "../server/chatgpt-provider";
import { audienceContext } from "../server/editorial-context";
import { Store } from "../server/store";
import { Worker } from "../server/worker";
import type { Provider } from "../shared/contracts";
import type { QualityEngine } from "../server/quality-engine";
import type { StructuredProvider } from "../server/provider";
import type { Fact, ResearchState } from "../server/research";
import type { ZodType } from "zod";
const temp = () => mkdtempSync(path.join(tmpdir(), "forge-siwc-"));
const stream = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const text of chunks) c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
test("official first registration uses loopback, PKCE and a stable host; rejects a foreign state", async () => {
  const dir = temp();
  try {
    const session = new ChatGPTSession(dir);
    const first = new URL(session.start(3021)),
      second = new URL(session.start(3022));
    assert.equal(first.origin, "https://auth.openai.com");
    assert.equal(first.pathname, "/api/accounts/authorize");
    assert.equal(first.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(
      first.searchParams.get("redirect_uri"),
      "http://127.0.0.1:3021/api/chatgpt/callback",
    );
    assert.equal(first.searchParams.get("code_challenge_method"), "S256");
    assert.notEqual(
      first.searchParams.get("state"),
      second.searchParams.get("state"),
    );
    assert.equal(
      first.searchParams.get("ext_agent_host_id"),
      second.searchParams.get("ext_agent_host_id"),
    );
    assert.equal(statSync(path.join(dir, "host.json")).mode & 0o777, 0o600);
    await assert.rejects(
      session.complete(
        new URLSearchParams({ state: "incorrect", code: "ignore" }),
      ),
    );
    assert.equal(session.status().signedIn, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Responses requires completion and recognizes streamed usage failure", async () => {
  assert.equal(
    await completedText(
      stream(
        'data: {"type":"response.output_',
        'text.delta","delta":"نعم"}\r\n\r\n',
        'data: {"type":"response.completed"}\n\n',
      ),
    ),
    "نعم",
  );
  await assert.rejects(
    completedText(
      stream('data: {"type":"response.output_text.delta","delta":"جزء"}\n\n'),
    ),
    /دون جواب مكتمل/,
  );
  await assert.rejects(
    completedText(
      stream(
        'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n',
      ),
    ),
    (e) => e instanceof ChatGPTError && e.pause,
  );
});
test("quota stops queued ChatGPT jobs for the same account and preserves the saved checkpoint", async () => {
  const dir = temp(),
    db = new Store(dir);
  try {
    const engine = {
      run: async () => {
        throw new ChatGPTError(
          "quota",
          "subscription_sharing_usage_limit_exceeded",
          429,
        );
      },
    } as unknown as QualityEngine;
    const worker = new Worker(
      db,
      {} as Provider,
      undefined,
      undefined,
      undefined,
      () => engine,
    );
    const pin = { account: "original", model: "selected" };
    const plan = {
      topic: "تراث",
      easy: 3,
      medium: 0,
      hard: 0,
      imagePercent: 0,
      audienceRegion: "jordan" as const,
    };
    const first = worker.enqueue("default", plan, pin),
      next = worker.enqueue("default", plan, pin);
    db.saveJob({ ...first, done: 1, cursor: 2 });
    await worker.drain();
    assert.equal(db.job(first.id)?.status, "paused");
    assert.equal(db.job(first.id)?.done, 1);
    assert.equal(db.job(first.id)?.cursor, 2);
    assert.deepEqual(db.job(next.id)?.chatgpt, pin);
    assert.equal(db.job(next.id)?.status, "paused");
    assert.notEqual(audienceContext("jordan"), audienceContext("arab"));
    assert.match(audienceContext("mixed", "طلاب جامعة"), /طلاب جامعة/);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("research maps keep assignments out of model output validation", async () => {
  const { mapSchema } = await import("../server/research");
  const facet = {
    name: "تبديلات",
    ar: "نهائي كأس العالم تبديلات",
    en: "World Cup final substitutions",
    preferredSites: ["fifa.com"],
  };
  const result = mapSchema.parse({
    scope: "نهائي كأس العالم ".repeat(25),
    audience: "جمهور أردني وعربي ".repeat(25),
    arabicSubject: "نهائي كأس العالم",
    englishSubject: "World Cup final",
    scopeMarkers: ["World Cup final", "نهائي كأس العالم"],
    facets: [facet, facet, facet, facet],
  });
  assert.ok(!("scope" in result));
  assert.ok(!("audience" in result));
  assert.equal(result.facets.length, 4);
});

test("the ChatGPT director selects exact search results, with no automatic choice", async () => {
  const { selectResearchSources } = await import("../server/research");
  const editorial = {
    brief: "مصدر من مؤسسة مختصة",
    rules: "استعمل تقريرًا منشورًا",
  };
  const context = {
    scope: "البتراء",
    audience: "أردني وعربي",
    facet: "الأنباط",
    editorial,
  };
  const first = {
    url: "https://example.org/overview",
    title: "Petra",
    text: "Overview",
  };
  const official = {
    url: "https://whc.unesco.org/en/list/326/",
    title: "Petra",
    text: "World Heritage List",
  };
  const hits = [
    first,
    { ...first, url: "https://www.reddit.com/r/jordan/" },
    official,
    official,
  ];
  const selector = {
    structured: async (
      _prompt: string,
      input: { candidates: { url: string }[]; editorial: typeof editorial },
    ) => {
      assert.deepEqual(
        input.candidates.map((x) => x.url),
        [first.url, official.url],
      );
      assert.deepEqual(input.editorial, editorial);
      return {
        picks: [
          { index: 1, reason: "وثيقة رسمية عن الأنباط" },
          { index: 1, reason: "رابط مكرر يُتجاهل" },
          { index: 8, reason: "اختيار خارج القائمة يُتجاهل" },
        ],
      };
    },
  } as unknown as StructuredProvider;
  assert.deepEqual(await selectResearchSources(selector, context, hits), [
    { ...official, sourceSelectionReason: "وثيقة رسمية عن الأنباط" },
  ]);
  const refuses = {
    structured: async () => ({ picks: [] }),
  } as unknown as StructuredProvider;
  assert.deepEqual(await selectResearchSources(refuses, context, hits), []);
});

test("normal ChatGPT production drafts several questions in one call without a second review", async () => {
  const { QualityEngine } = await import("../server/quality-engine");
  const dir = temp(),
    db = new Store(dir);
  try {
    const quote = "تقرير الجهة الناشرة عن تطور معالم الموقع التاريخي.";
    const facts: Fact[] = (["easy", "medium"] as const).map((level, i) => ({
      id: String(i),
      facet: "التراث",
      bestLevel: level,
      importance: 88,
      surprise: 75,
      event: "معلم " + level,
      entity: level,
      fact: quote,
      answer: "جواب " + level,
      quote,
      sourceIndex: 0,
      audienceReason: "تفصيل مهم",
      communityOnly: false,
      sourceLabel: "example.org",
      sourceSelectionReason: "تقرير مختص",
      source: {
        url: "https://example.org/report",
        title: "التقرير",
        text: quote,
      },
      audienceSignals: {
        recognition: 90,
        historicalImpact: 90,
        audienceInterest: 90,
        surprise: 75,
        documentedControversy: 0,
        quizValue: 90,
      },
    }));
    const questions = [
      "أين يقع المعلم التاريخي الأول؟",
      "ما الغرض من بناء المعلم الثاني؟",
    ];
    let calls = 0;
    const ai = {
      structured: async (
        prompt: string,
        input: { batch: { position: number; level: string }[] },
        schema: ZodType,
      ) => {
        calls++;
        assert.match(prompt, /in one response/);
        assert.deepEqual(
          input.batch.map((item) => item.level),
          ["easy", "medium"],
        );
        return schema.parse({
          items: questions.map((question, position) => ({
            position,
            question,
            imagePurpose: "none",
            imageQuery: "",
            fingerprint: {
              type: "identification",
              idea: "idea " + position,
              target: "target " + position,
              event: "event " + position,
              entity: "entity " + position,
              answerPattern: "name",
              template: "formula " + position,
            },
          })),
        });
      },
      embed: async (text: string) => (text === questions[0] ? [1, 0] : [0, 1]),
    } as unknown as StructuredProvider;
    const job = new Worker(db, ai).enqueue(
      "default",
      { topic: "التراث", easy: 1, medium: 1, hard: 0, imagePercent: 0 },
      { account: "test", model: "test-model" },
    );
    db.saveResearchState(job.id, {
      revision: 2,
      facts,
      next: 0,
      errors: [],
      map: {
        scope: "التراث",
        audience: "أردني وعربي",
        arabicSubject: "التراث",
        englishSubject: "Heritage",
        scopeMarkers: [],
        facets: [
          { name: "التراث", ar: "التراث", en: "Heritage", preferredSites: [] },
        ],
      },
    } satisfies ResearchState);
    await new QualityEngine(db, ai, async () =>
      assert.fail("already has sources"),
    ).run(job);
    assert.equal(calls, 1);
    assert.equal(db.job(job.id)?.status, "complete");
    assert.equal(db.job(job.id)?.cursor, 2);
    assert.deepEqual(
      db.acceptedQuestions(job.id).map((q) => [q.question, q.quality?.score]),
      [
        [questions[0], undefined],
        [questions[1], undefined],
      ],
    );
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed ChatGPT output gets one repair with the same model and caches only valid output", async (t) => {
  const { z } = await import("zod");
  const { ChatGPTProvider } = await import("../server/chatgpt-provider");
  const { LocalProvider } = await import("../server/local");
  const dir = temp();
  const db = new Store(dir);
  try {
    const session = new ChatGPTSession(dir);
    t.mock.method(session, "authorization", async () => "test-only");
    const requests: {
      model: string;
      store: boolean;
      stream: boolean;
      instructions: string;
    }[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string | URL | Request, options?: RequestInit) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        requests.push(JSON.parse(String(options?.body)));
        const delta = JSON.stringify({
          value: requests.length === 1 ? "too long" : "ok",
        });
        return new Response(
          stream(
            "data: " +
              JSON.stringify({ type: "response.output_text.delta", delta }) +
              "\n\n",
            'data: {"type":"response.completed"}\n\n',
          ),
        );
      },
    );
    const provider = new ChatGPTProvider(session, new LocalProvider(), db, {
      account: "same",
      model: "selected",
    });
    const schema = z.object({ value: z.string().max(2) });
    assert.deepEqual(await provider.structured("test", {}, schema), {
      value: "ok",
    });
    assert.deepEqual(await provider.structured("test", {}, schema), {
      value: "ok",
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(
      requests.map((r) => [r.model, r.store, r.stream]),
      [
        ["selected", false, true],
        ["selected", false, true],
      ],
    );
    assert.match(requests[1].instructions, /Fix these schema constraints/);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
