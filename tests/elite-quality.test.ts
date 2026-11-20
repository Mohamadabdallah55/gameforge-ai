import { test } from "node:test";
import assert from "node:assert/strict";
import { criteria, type Fingerprint, type Scorecard } from "../shared/quality";
import {
  Diversity,
  assess,
  audienceValue,
  reveals,
  exactQuote,
} from "../server/quality-gates";
import { blockedImageOrigin } from "../server/image-policy";
import { publisherLicense } from "../server/licensed-publisher";
import { articleText, community } from "../server/research";
import { pictureQueries } from "../server/image-engine";
import { planSchema, slots } from "../shared/contracts";

test("the year answer is rejected even when the question uses Arabic numerals", () => {
  assert.ok(reveals("ما السنة التي أقيم فيها كأس العالم ٢٠٢٦؟", "2026"));
});

test("each selected photo mode gets its own validated allocation", () => {
  const plan = planSchema.parse({
    topic: "تراث",
    easy: 4,
    medium: 3,
    hard: 3,
    imagePercent: 0,
    imageMix: { real: { count: 2 }, cartoon: { percent: 30 } },
  });
  const assigned = slots(plan);
  assert.equal(assigned.filter((slot) => slot.mode === "real").length, 2);
  assert.equal(assigned.filter((slot) => slot.mode === "cartoon").length, 3);
  assert.equal(assigned.filter((slot) => !slot.image).length, 5);
  assert.equal(
    planSchema.safeParse({ ...plan, imageMix: { real: { count: 11 } } })
      .success,
    false,
  );
});

test("recognition searches the player's name first while event questions keep their event query", () => {
  const context = {
    question: "من اللاعب في الصورة؟",
    answer: "محمد صلاح",
    event: "نهائي دوري أبطال أوروبا 2019",
    recognition: true,
    arabicQuery: "محمد صلاح",
  };
  assert.deepEqual(pictureQueries("Mohamed Salah", context), [
    "محمد صلاح",
    "Mohamed Salah",
    "نهائي دوري أبطال أوروبا 2019 Mohamed Salah",
  ]);
  const event = "Liverpool Tottenham 2019 final penalty";
  assert.deepEqual(
    pictureQueries(event, {
      ...context,
      recognition: false,
      arabicQuery: undefined,
    }),
    [event, "نهائي دوري أبطال أوروبا 2019 " + event],
  );
});

const stadium: Fingerprint = {
  type: "match detail",
  idea: "venue of final",
  target: "venue of final 2015",
  event: "final 2015",
  entity: "Barcelona",
  answerPattern: "stadium name",
  template: "identify final venue 2015",
};
test("different years and different answers still compete for the same intellectual template", () => {
  const diversity = new Diversity(true, 100, [stadium]);
  assert.match(
    diversity.reason({
      ...stadium,
      entity: "Real Madrid",
      target: "venue of final 2016",
      event: "final 2016",
      template: "name the stadium of the final 2016",
    }),
    /قالب/,
  );
  assert.match(
    diversity.reason({
      ...stadium,
      idea: "historic location",
      template: "identify stadium",
    }),
    /المعلومة/,
  );
});
test("an excellent overall score cannot compensate for weak evidence or false difficulty", () => {
  const high = Object.fromEntries(
    criteria.map((k) => [k, 98]),
  ) as Scorecard["scores"];
  const review: Scorecard = {
    scores: high,
    level: "hard",
    trivial: false,
    ambiguous: false,
    leaksAnswer: false,
    supported: true,
    reason: "editorial",
    fingerprint: stadium,
  };
  assert.equal(assess(review, "hard", true).reason, "");
  assert.notEqual(
    assess({ ...review, scores: { ...high, sourceStrength: 79 } }, "hard", true)
      .reason,
    "",
  );
  assert.notEqual(
    assess({ ...review, supported: false }, "hard", true).reason,
    "",
  );
  assert.notEqual(assess(review, "easy", true).reason, "");
  assert.ok(
    reveals("لماذا اختار اللاعبُ أنْدريس إنييستا ذلك؟", "أندريس إنييستا"),
  );
  assert.equal(
    exactQuote(
      "Actual 2016 final was played in Milan.",
      "Actual 2015 final was played in Milan.",
    ),
    false,
  );
});
test("licensed proxies and encoded Wikimedia URLs cannot bypass image policy", () => {
  assert.ok(blockedImageOrigin("Openverse", "wikimedia"));
  assert.ok(
    blockedImageOrigin(
      "https://proxy.example/?src=https%253A%252F%252Fupload.wikimedia.org%252Ffile.jpg",
    ),
  );
  assert.equal(
    blockedImageOrigin("https://www.flickr.com/photos/author/42"),
    false,
  );
  const article = "https://publisher.example/story";
  const img = "https://publisher.example/media/winning-goal.jpg";
  const structured = (obj: unknown) =>
    '<script type="application/ld+json">' + JSON.stringify(obj) + "</script>";
  const data = {
    "@type": "ImageObject",
    contentUrl: img,
    license: "https://creativecommons.org/licenses/by/4.0/",
    creditText: "Official archive",
    caption: "The winning goal in the final",
  };
  assert.equal(
    publisherLicense(structured(data), img, article)?.license,
    "by 4.0",
  );
  assert.equal(
    publisherLicense(
      structured({ ...data, creditText: "Wikimedia Commons" }),
      img,
      article,
    ),
    undefined,
  );
  assert.equal(
    publisherLicense(
      structured({
        ...data,
        contentUrl: "https://publisher.example/other.jpg",
      }),
      img,
      article,
    ),
    undefined,
  );
  assert.equal(
    publisherLicense(
      structured({
        ...data,
        license: "https://creativecommons.org/licenses/by-nc/4.0/",
      }),
      img,
      article,
    ),
    undefined,
  );
});
test("article parser retains relevant captions and ignores navigation; discussion stays non-evidence", () => {
  const doc =
    "<html><nav><p>Long nav teaser for the Milan match, avoid entirely</p></nav><main><p>The 2016 final was played in Milan according to the match report.</p><figure><figcaption>The players celebrate at the final in Milan after the penalty shootout.</figcaption></figure></main></html>";
  const text = articleText(doc, ["Milan final"]);
  assert.match(text, /penalty shootout/);
  assert.doesNotMatch(text, /teaser/);
  assert.ok(community("https://www.reddit.com/r/soccer/comments/abc"));
  assert.ok(community("https://example.org/forums/final"));
  assert.equal(community("https://www.uefa.com/news/abc"), false);
});

test("an uncontroversial important event can rank without rewarding rumor", () => {
  const important = {
    recognition: 90,
    historicalImpact: 100,
    audienceInterest: 90,
    surprise: 30,
    documentedControversy: 0,
    quizValue: 90,
  };
  const tabloid = {
    recognition: 30,
    historicalImpact: 20,
    audienceInterest: 90,
    surprise: 85,
    documentedControversy: 0,
    quizValue: 30,
  };
  assert.ok(audienceValue(important) > 85);
  assert.ok(audienceValue(tabloid) < 65);
});
