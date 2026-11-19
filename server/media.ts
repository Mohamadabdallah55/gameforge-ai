import sharp from "sharp";
export const styles = [
  "original",
  "bw",
  "sketch",
  "silhouette",
  "cartoon",
] as const;
export type Style = (typeof styles)[number];
export async function transform(input: Buffer, style: Style): Promise<Buffer> {
  const base = sharp(input, { limitInputPixels: 24e6 })
    .rotate()
    .resize({
      width: 1400,
      height: 1400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toColourspace("srgb");
  if (style === "original") return base.png().toBuffer();
  if (style === "bw") return base.grayscale().png().toBuffer();
  const { data, info } = await base
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: 4 as const };
  const hasMask =
    style === "silhouette" && data.some((v, i) => i % 4 === 3 && v < 128);
  const grey = (i: number) =>
    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const smooth =
    style === "sketch"
      ? await sharp(data, { raw }).blur(4).raw().toBuffer()
      : null;
  for (let i = 0; i < data.length; i += 4) {
    if (style === "cartoon") {
      for (let k = 0; k < 3; k++)
        data[i + k] = Math.min(255, Math.round(data[i + k] / 48) * 48);
      continue;
    }
    const l = grey(i);
    const value = smooth
      ? Math.min(
          255,
          (255 * l) /
            Math.max(
              1,
              0.299 * smooth[i] + 0.587 * smooth[i + 1] + 0.114 * smooth[i + 2],
            ),
        )
      : hasMask || l < 145
        ? 0
        : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  return sharp(data, { raw }).png().toBuffer();
}
