import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { assessPixels, visionModel } from "../server/local";
import { publicImage } from "../server/net-image";
import { articleBytes, pictures } from "../server/search";
import { articleText } from "../server/research";
import { blockedImageOrigin } from "../server/image-policy";
import { realPicture } from "../server/image-engine";
const dir = path.resolve(
  process.env.QUALITY_ACCEPTANCE_DIR || "../../work/quality-acceptance",
);
mkdirSync(dir, { recursive: true });
if (!process.argv.includes("--selection")) {
  const source =
    "https://eol.jsc.nasa.gov/SearchPhotos/photo.pl?frame=5903&mission=AS11&roll=40";
  const raw =
    "https://eol.jsc.nasa.gov/DatabaseImages/ISD/highres/AS11/AS11-40-5903.JPG";
  const article = await articleBytes(source);
  const names = ["Buzz Aldrin", "Apollo 11", "lunar module"];
  let caption = articleText(article, names);
  if (!caption.includes("lunar module pilot")) {
    const extract = article.match(
      /Astronaut Edwin F\. Aldrin Jr\.[\s\S]{50,650}?(?:foregroun[d]|camera)\./i,
    );
    if (extract)
      caption = extract[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }
  assert.match(caption, /Aldrin/i);
  const png = await sharp(await publicImage(raw, "GameForgeAI/0.3"))
    .resize(640, 640, { fit: "inside" })
    .png()
    .toBuffer();
  const match = await assessPixels(
    {
      question: "أي رائد فضاء يظهر واقفًا على سطح القمر في صورة أبولو 11؟",
      answer: "باز ألدرين",
      event:
        "Apollo 11 lunar surface EVA, NASA AS11-40-5903 portrait of Buzz Aldrin photographed by Neil Armstrong",
      recognition: true,
    },
    caption.slice(0, 1400),
    png,
  );
  const mismatch = await assessPixels(
    {
      question: "أي لاعب سجل هدف الفوز في نهائي دوري الأبطال 1999؟",
      answer: "أولي غونار سولشاير",
      event:
        "1999 UEFA Champions League Final Ole Gunnar Solskjaer scores at Camp Nou",
      recognition: false,
    },
    caption.slice(0, 1400),
    png,
  );
  const decoyUrl =
    "https://eol.jsc.nasa.gov/DatabaseImages/ISD/highres/AS17/AS17-148-22727.JPG";
  const decoy = await sharp(await publicImage(decoyUrl, "GameForgeAI/0.3"))
    .resize(640, 640, { fit: "inside" })
    .png()
    .toBuffer();
  const mismatchedPixels = await assessPixels(
    {
      question: "Who is standing on the Moon in this Apollo 11 photograph?",
      answer: "Buzz Aldrin",
      event:
        "Apollo 11 lunar surface EVA, NASA AS11-40-5903 portrait of Buzz Aldrin",
      recognition: true,
    },
    caption.slice(0, 1400),
    decoy,
  );
  const report = {
    model: visionModel(),
    source,
    image: raw,
    matching: match,
    unrelated: mismatch,
    wrongPixelsWithCorrectCaption: mismatchedPixels,
  };
  writeFileSync(path.join(dir, "vision.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.ok(
    match.eventMatch && match.sourceMatch && match.questionMatch,
    "correct photo did not match its sourced quiz",
  );
  assert.ok(
    !mismatch.eventMatch || !mismatch.questionMatch || !mismatch.sourceMatch,
    "wrong event incorrectly passed",
  );
  assert.ok(
    !mismatchedPixels.eventMatch ||
      !mismatchedPixels.questionMatch ||
      !mismatchedPixels.sourceMatch,
    "caption overrode conflicting image pixels",
  );
}
const terms = "AS11-40-5903 Apollo 11 Buzz Aldrin lunar surface";
const hits = await pictures(terms);
assert.ok(
  hits.every(
    (h) => !blockedImageOrigin(h.origin, h.original, h.url, h.provenance),
  ),
);
console.log("searched licensed non-Wikimedia images", hits.length);
assert.ok(hits.length > 0, "no licensed non-Wikimedia candidates");
const selected = await realPicture(terms, false, {
  question: "أي رائد فضاء يظهر في صورة أبولو 11 الأصلية؟",
  answer: "باز ألدرين",
  event: "Apollo 11 1969 lunar surface portrait of Buzz Aldrin",
  recognition: true,
});
writeFileSync(
  path.join(dir, "visual-selection.json"),
  JSON.stringify({ asset: selected.meta, visual: selected.visual }, null, 2),
);
console.log("selected", selected.meta, selected.visual);
