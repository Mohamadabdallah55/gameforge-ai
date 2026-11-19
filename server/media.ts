import sharp from "sharp";

export const styles = [
  "original",
  "bw",
  "sketch",
  "silhouette",
  "cartoon",
] as const;
export type Style = (typeof styles)[number];

function otsuThreshold(lums: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < lums.length; i++) hist[lums[i]]++;
  const total = lums.length || 1;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 145;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

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
  if (style === "bw") return base.grayscale().normalize().png().toBuffer();

  const { data, info } = await base
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const raw = { width: w, height: h, channels: 4 as const };
  const hasMask =
    style === "silhouette" && data.some((v, i) => i % 4 === 3 && v < 128);

  const grey = (i: number) =>
    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

  if (style === "sketch") {
    const smooth = await sharp(data, { raw }).blur(3.5).raw().toBuffer();
    for (let i = 0; i < data.length; i += 4) {
      const l = grey(i);
      const sl = 0.299 * smooth[i] + 0.587 * smooth[i + 1] + 0.114 * smooth[i + 2];
      let val = Math.min(255, (255 * l) / Math.max(1, sl));
      // Sharpen pencil contrast softly
      val = val < 225 ? Math.max(0, Math.round(val * 0.88)) : 255;
      data[i] = data[i + 1] = data[i + 2] = val;
    }
    return sharp(data, { raw }).png().toBuffer();
  }

  if (style === "silhouette") {
    if (hasMask) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
      return sharp(data, { raw }).png().toBuffer();
    }
    const pixelCount = w * h;
    const lums = new Uint8Array(pixelCount);
    for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
      lums[p] = Math.round(grey(i));
    }
    const thresh = otsuThreshold(lums);
    // Check average border luminance: if border is darker than threshold, invert so subject stays black on white
    let borderSum = 0;
    let borderN = 0;
    for (let x = 0; x < w; x++) {
      borderSum += lums[x] + lums[(h - 1) * w + x];
      borderN += 2;
    }
    for (let y = 1; y < h - 1; y++) {
      borderSum += lums[y * w] + lums[y * w + w - 1];
      borderN += 2;
    }
    const darkBg = borderN > 0 && borderSum / borderN < thresh;
    for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
      const isForeground = darkBg ? lums[p] >= thresh : lums[p] <= thresh;
      const v = isForeground ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    return sharp(data, { raw }).png().toBuffer();
  }

  // Cartoon: median smooth + quantized palette + Sobel dark ink edges
  const smoothed = await sharp(data, { raw })
    .median(w >= 64 && h >= 64 ? 3 : 1)
    .raw()
    .toBuffer();

  const lums = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    lums[p] = 0.299 * smoothed[i] + 0.587 * smoothed[i + 1] + 0.114 * smoothed[i + 2];
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      let edge = 0;
      if (w >= 3 && h >= 3 && x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const gx =
          -lums[(y - 1) * w + (x - 1)] +
          lums[(y - 1) * w + (x + 1)] -
          2 * lums[y * w + (x - 1)] +
          2 * lums[y * w + (x + 1)] -
          lums[(y + 1) * w + (x - 1)] +
          lums[(y + 1) * w + (x + 1)];
        const gy =
          -lums[(y - 1) * w + (x - 1)] -
          2 * lums[(y - 1) * w + x] -
          lums[(y - 1) * w + (x + 1)] +
          lums[(y + 1) * w + (x - 1)] +
          2 * lums[(y + 1) * w + x] +
          lums[(y + 1) * w + (x + 1)];
        edge = Math.hypot(gx, gy);
      }
      if (edge > 115) {
        data[i] = 18;
        data[i + 1] = 24;
        data[i + 2] = 28;
      } else {
        for (let k = 0; k < 3; k++) {
          data[i + k] = Math.min(255, Math.round(smoothed[i + k] / 42) * 42);
        }
      }
      data[i + 3] = smoothed[i + 3];
    }
  }
  return sharp(data, { raw }).png().toBuffer();
}
