import sharp from "sharp";
import { removeForegroundBackground } from "./foreground";
import { hasAppleVisionBinary } from "./environment";

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

function floodIsolateBackground(
  data: Buffer,
  width: number,
  height: number,
  tolerance: number,
) {
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  const ref = [0, 0, 0];
  for (const offset of corners) {
    ref[0] += data[offset];
    ref[1] += data[offset + 1];
    ref[2] += data[offset + 2];
  }
  ref[0] = Math.round(ref[0] / corners.length);
  ref[1] = Math.round(ref[1] / corners.length);
  ref[2] = Math.round(ref[2] / corners.length);

  const count = width * height;
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let end = 0;

  const enqueue = (pixel: number) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const offset = pixel * 4;
    const dist =
      Math.abs(ref[0] - data[offset]) +
      Math.abs(ref[1] - data[offset + 1]) +
      Math.abs(ref[2] - data[offset + 2]);
    if (dist <= tolerance * 3) {
      queue[end++] = pixel;
    }
  };

  for (let col = 0; col < width; col++) {
    enqueue(col);
    enqueue((height - 1) * width + col);
  }
  for (let row = 0; row < height; row++) {
    enqueue(row * width);
    enqueue(row * width + width - 1);
  }
  for (let i = 0; i < end; i++) {
    const pixel = queue[i];
    data[pixel * 4 + 3] = 0;
    if (pixel % width) enqueue(pixel - 1);
    if (pixel % width < width - 1) enqueue(pixel + 1);
    if (pixel >= width) enqueue(pixel - width);
    if (pixel < count - width) enqueue(pixel + width);
  }
}

export async function transform(
  input: Buffer,
  style: Style,
  options: TransformOptions = {},
): Promise<Buffer> {
  const strength = Math.max(0, Math.min(1, options.strength ?? 0.5));
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
  if (style === "bw") {
    return base
      .grayscale()
      .linear(1 + strength * 0.35, -18 * strength)
      .png()
      .toBuffer();
  }
  if (style === "background" || style === "subject-silhouette") {
    if (hasAppleVisionBinary()) {
      const foreground = await removeForegroundBackground(
        await base.png().toBuffer(),
      );
      return style === "subject-silhouette"
        ? transform(foreground, "silhouette")
        : foreground;
    }
    // Cloud fallback using multi-corner border flood fill for clean non-macOS operation
    const { data, info } = await base
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    floodIsolateBackground(data, info.width, info.height, 26 + 85 * strength);
    const isolated = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return style === "subject-silhouette"
      ? transform(isolated, "silhouette")
      : isolated;
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
    ) {
      for (
        let column = Math.floor(x * raw.width);
        column < Math.min(raw.width, Math.ceil((x + width) * raw.width));
        column++
      ) {
        const offset = (row * raw.width + column) * 4;
        data.fill(18, offset, offset + 3);
        data[offset + 3] = 255;
      }
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

  if (style === "cartoon") {
    const smoothed =
      raw.width >= 6 && raw.height >= 6
        ? await sharp(data, { raw }).median(3).raw().toBuffer()
        : data;
    const step = Math.round(32 + strength * 36);
    const w = raw.width;
    for (let row = 0; row < raw.height; row++) {
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        const l0 =
          0.299 * smoothed[i] + 0.587 * smoothed[i + 1] + 0.114 * smoothed[i + 2];
        const rx = col + 1 < w ? i + 4 : i;
        const dy = row + 1 < raw.height ? i + w * 4 : i;
        const lr =
          0.299 * smoothed[rx] + 0.587 * smoothed[rx + 1] + 0.114 * smoothed[rx + 2];
        const ld =
          0.299 * smoothed[dy] + 0.587 * smoothed[dy + 1] + 0.114 * smoothed[dy + 2];
        const edge = Math.abs(l0 - lr) + Math.abs(l0 - ld);
        if (edge > 34 - strength * 12) {
          data[i] = 28;
          data[i + 1] = 28;
          data[i + 2] = 32;
        } else {
          for (let k = 0; k < 3; k++) {
            data[i + k] = Math.min(255, Math.round(smoothed[i + k] / step) * step);
          }
        }
      }
    }
    return sharp(data, { raw }).png().toBuffer();
  }

  const hasMask =
    style === "silhouette" && data.some((v, i) => i % 4 === 3 && v < 128);
  const grey = (i: number) =>
    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const smooth =
    style === "sketch"
      ? await sharp(data, { raw })
          .blur(Math.max(1.5, 2 + strength * 4))
          .raw()
          .toBuffer()
      : null;
  for (let i = 0; i < data.length; i += 4) {
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
