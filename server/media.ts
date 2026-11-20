import sharp from "sharp";
import { removeForegroundBackground } from "./foreground";
export const styles = [
  "original",
  "bw",
  "sketch",
  "silhouette",
  "cartoon",
  "solid-background",
  "background",
  "subject-silhouette",
  "mask",
] as const;
export type Style = (typeof styles)[number];
export const artisticPrompts = {
  pencil: "Detailed graphite pencil sketch on paper",
  cartoon:
    "Expressive hand-drawn editorial cartoon, clean linework and cel shading",
  render3d:
    "Stylized three-dimensional character render with soft studio lighting",
  eventArt:
    "Hand-painted sports illustration translating the exact source composition into brushwork",
};
type TransformOptions = {
  strength?: number;
  mask?: { x: number; y: number; width: number; height: number };
};
export async function transform(
  input: Buffer,
  style: Style,
  options: TransformOptions = {},
): Promise<Buffer> {
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
  if (style === "background" || style === "subject-silhouette") {
    const foreground = await removeForegroundBackground(
      await base.png().toBuffer(),
    );
    return style === "subject-silhouette"
      ? transform(foreground, "silhouette")
      : foreground;
  }
  const { data, info } = await base
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: 4 as const };
  if (style === "mask") {
    const { x, y, width, height } = options.mask || {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    };
    for (
      let row = Math.floor(y * raw.height);
      row < Math.min(raw.height, Math.ceil((y + height) * raw.height));
      row++
    )
      for (
        let column = Math.floor(x * raw.width);
        column < Math.min(raw.width, Math.ceil((x + width) * raw.width));
        column++
      ) {
        const offset = (row * raw.width + column) * 4;
        data.fill(0, offset, offset + 3);
        data[offset + 3] = 255;
      }
    return sharp(data, { raw }).png().toBuffer();
  }
  if (style === "solid-background") {
    const edge = [data[0], data[1], data[2]];
    const tolerance = 20 + 75 * (options.strength ?? 0.45);
    const count = raw.width * raw.height;
    const visited = new Uint8Array(count);
    const queue = new Int32Array(count);
    let end = 0;
    const enqueue = (pixel: number) => {
      if (visited[pixel]) return;
      visited[pixel] = 1;
      const offset = pixel * 4;
      if (
        edge.every(
          (channel, k) => Math.abs(channel - data[offset + k]) <= tolerance,
        )
      )
        queue[end++] = pixel;
    };
    for (let column = 0; column < raw.width; column++) {
      enqueue(column);
      enqueue((raw.height - 1) * raw.width + column);
    }
    for (let row = 0; row < raw.height; row++) {
      enqueue(row * raw.width);
      enqueue(row * raw.width + raw.width - 1);
    }
    for (let i = 0; i < end; i++) {
      const pixel = queue[i];
      data[pixel * 4 + 3] = 0;
      if (pixel % raw.width) enqueue(pixel - 1);
      if (pixel % raw.width < raw.width - 1) enqueue(pixel + 1);
      if (pixel >= raw.width) enqueue(pixel - raw.width);
      if (pixel < count - raw.width) enqueue(pixel + raw.width);
    }
    return sharp(data, { raw }).png().toBuffer();
  }
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
