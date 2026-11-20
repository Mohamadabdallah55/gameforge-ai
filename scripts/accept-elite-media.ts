import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { LocalProvider } from "../server/local";
import { artisticPrompts, transform } from "../server/media";
import { downloadHit, pictures, type ImageHit } from "../server/search";

const dir = path.resolve(
  process.env.QUALITY_ACCEPTANCE_DIR ||
    "../../work/elite-intelligence-acceptance",
);
mkdirSync(dir, { recursive: true });
const manifest = path.join(dir, "media-inputs.json");
if (process.argv.includes("--prepare")) {
  const sources: ImageHit[] = [];
  for (const term of [
    "Apollo 11",
    "Apollo 15",
    "Apollo 17",
    "Apollo 12",
    "NASA Apollo",
  ]) {
    const hits = await pictures(term);
    for (const item of hits.filter((hit) =>
      hit.origin.startsWith("https://eol.jsc.nasa.gov/"),
    )) {
      if (sources.some((source) => source.origin === item.origin)) continue;
      try {
        const source = await transform(await downloadHit(item), "original");
        const no = sources.length + 1;
        writeFileSync(path.join(dir, `${no}-original.png`), source);
        sources.push(item);
        console.log("Downloaded", no, item.credit);
      } catch (error) {
        console.log("Skipped source", item.credit, (error as Error).message);
      }
      if (sources.length === 10) break;
    }
    if (sources.length === 10) break;
  }
  writeFileSync(manifest, JSON.stringify(sources, null, 2));
  assert.equal(sources.length, 10, "Ten actual photographs must be available");
} else {
  const sources: ImageHit[] = JSON.parse(readFileSync(manifest, "utf8"));
  const ai = new LocalProvider();
  const report = [];
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  for (const [index, source] of sources.entries()) {
    const no = index + 1;
    const original = readFileSync(path.join(dir, `${no}-original.png`));
    const modes = [
      "pencil",
      "cartoon",
      "render3d",
      "eventArt",
      "pencil",
      "cartoon",
      "pencil",
      "cartoon",
      "pencil",
      "cartoon",
    ] as const;
    const mode = modes[index];
    const prompt =
      artisticPrompts[mode] +
      ". Keep the supplied NASA lunar subject, existing pose, framing and scene. No text. " +
      source.title;
    const stylized = await ai.image(prompt, original, 0.6);
    const grey = await transform(original, "bw");
    const mask = await transform(original, "mask");
    assert.notDeepEqual(stylized, original);
    const { width, height, format } = await sharp(stylized).metadata();
    assert.equal(format, "png");
    assert.ok(width && height);
    writeFileSync(path.join(dir, `${no}-${mode}.png`), stylized);
    writeFileSync(path.join(dir, `${no}-bw.png`), grey);
    writeFileSync(path.join(dir, `${no}-mask.png`), mask);
    report.push({
      no,
      mode,
      width,
      height,
      source: source.origin,
      license: source.license,
    });
    for (const [column, image] of [original, stylized, grey, mask].entries()) {
      tiles.push({
        input: await sharp(image)
          .flatten({ background: "#fff" })
          .resize(180, 132, { fit: "contain", background: "#fff" })
          .png()
          .toBuffer(),
        left: column * 184,
        top: index * 136,
      });
    }
    writeFileSync(
      path.join(dir, "media-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log("Rendered", no, mode, width, height);
  }
  await sharp({
    create: {
      width: 736,
      height: sources.length * 136,
      channels: 3,
      background: "#dedede",
    },
  })
    .composite(tiles)
    .png()
    .toFile(path.join(dir, "media-contact-sheet.png"));
  assert.equal(report.length, 10);
}
