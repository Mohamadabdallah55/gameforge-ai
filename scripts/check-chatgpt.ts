import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { ChatGPTSession } from "../server/chatgpt-session";
import { ChatGPTProvider } from "../server/chatgpt-provider";
import { LocalProvider } from "../server/local";
import { Store } from "../server/store";
import { searchWeb, articleBytes, persistSearch } from "../server/search";
import { articleText, selectResearchSources } from "../server/research";
import { exactQuote } from "../server/quality-gates";
import { audienceContext } from "../server/editorial-context";

assert.equal(
  process.env.GAMEFORGE_CHATGPT_PLAN_USAGE,
  "1",
  "Testing live plan usage requires explicitly enabling GAMEFORGE_CHATGPT_PLAN_USAGE.",
);
const session = new ChatGPTSession(
  path.resolve(process.env.SIWC_DATA_DIR || "./data/.siwc"),
);
const status = session.status();
assert.ok(
  status.authorized,
  "Complete Continue with ChatGPT and grant ChatGPT plan usage before the live test.",
);
const catalog = await session.models();
assert.ok(
  catalog.length,
  "The selected account must expose an eligible model.",
);
if (!status.model)
  await session.pick(
    catalog.find((m) => m.id === "gpt-6.2-sol")?.id || catalog[0].id,
  );
const dir = mkdtempSync(path.join(tmpdir(), "gameforge-siwc-live-"));
const db = new Store(dir);
try {
  persistSearch(db);
  const ai = new ChatGPTProvider(
    session,
    new LocalProvider(),
    db,
    session.bind(),
  );
  const results = await Promise.allSettled([
    searchWeb("البتراء الأنباط اليونسكو", "ar"),
    searchWeb("Petra Nabataean UNESCO World Heritage", "en"),
  ]);
  const audience = audienceContext("mixed", "متابعو التراث الأردني والعربي");
  const hits = results.flatMap((x) =>
    x.status === "fulfilled" ? x.value : [],
  );
  const selected = await selectResearchSources(
    ai,
    {
      scope: "مدينة البتراء الأثرية",
      audience,
      facet: "الأنباط وتاريخ المدينة",
    },
    hits,
  );
  const retrieved = await Promise.allSettled(
    selected.map(async (source) => ({
      source,
      evidence: articleText(await articleBytes(source.url), [
        "Petra",
        "Nabataean",
        "الأنباط",
      ]),
    })),
  );
  const usable = retrieved.find(
    (x) =>
      x.status === "fulfilled" && /Nabataean|الأنباط/i.test(x.value.evidence),
  );
  assert.ok(
    usable?.status === "fulfilled",
    "A ChatGPT-selected page must support the topic.",
  );
  const { source, evidence } = usable.value;
  const sourceUrl = source.url;
  const excerpt = evidence.slice(0, 3200);
  const candidate = await ai.structured(
    "Write one enjoyable Arabic quiz question and its answer for the given audience about the archaeological city of Petra. Use only the supplied evidence. Quote a contiguous verbatim passage of at least 25 characters to support the correct answer.",
    {
      audience,
      topic: "البتراء",
      evidence: excerpt,
    },
    z.object({
      question: z.string().min(8),
      answer: z.string().min(2),
      quote: z.string().min(25),
    }),
  );
  assert.ok(
    exactQuote(excerpt, candidate.quote),
    "the quote must occur in the documented evidence",
  );
  const review = await ai.structured(
    "Independently verify that an unambiguous question is answered by the supplied verbatim excerpt. Return supported=false when the excerpt does not support the answer.",
    { ...candidate, source: sourceUrl },
    z.object({ supported: z.boolean() }),
  );
  assert.equal(review.supported, true);
  console.log(
    JSON.stringify({
      model: session.bind().model,
      searchHits: results.map((x) =>
        x.status === "fulfilled" ? x.value.length : 0,
      ),
      source: sourceUrl,
      sourceSelectionReason: source.sourceSelectionReason,
      question: candidate.question,
      answer: candidate.answer,
      supported: true,
    }),
  );
} finally {
  db.db.close();
  rmSync(dir, { recursive: true, force: true });
}
