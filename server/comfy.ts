import { localHttp } from "./local-http";
import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { endpoint } from "./local";
export const checkpoint = () =>
  process.env.COMFY_CHECKPOINT || "v1-5-pruned-emaonly-fp16.safetensors";
export async function comfy(path: string, body?: string | FormData) {
  try {
    const r = await localHttp(endpoint("COMFY_URL", 8188) + path, {
      body,
      headers:
        typeof body === "string"
          ? { "content-type": "application/json" }
          : undefined,
      timeout: 12000,
    });
    if (!r.ok)
      throw Error("HTTP " + r.status + " " + (await r.text()).slice(0, 300));
    return r;
  } catch (e) {
    throw Error("ComfyUI: " + (e as Error).message);
  }
}
const node = (class_type: string, inputs: Record<string, unknown>) => ({
  class_type,
  inputs,
});
export async function diffuse(prompt: string, input?: Buffer, strength = 0.55) {
  const name = randomUUID();
  const graph: Record<string, ReturnType<typeof node>> = {
    "1": node("CheckpointLoaderSimple", { ckpt_name: checkpoint() }),
    "2": node("CLIPTextEncode", { clip: ["1", 1], text: prompt }),
    "3": node("CLIPTextEncode", {
      clip: ["1", 1],
      text: "watermark, text, deformed, blurry",
    }),
    "4": node("EmptyLatentImage", { width: 512, height: 512, batch_size: 1 }),
    "5": node("KSampler", {
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: input ? ["8", 0] : ["4", 0],
      seed: randomInt(2 ** 32),
      steps: 20,
      cfg: 7,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: input ? strength : 1,
    }),
    "6": node("VAEDecode", { samples: ["5", 0], vae: ["1", 2] }),
    "9": node("PreviewImage", { images: ["6", 0] }),
  };
  if (input) {
    const sharp = (await import("sharp")).default;
    const original = sharp(input, { limitInputPixels: 24e6 }).rotate();
    const {
      width = 512,
      height = 512,
      orientation,
    } = await original.metadata();
    const ratio =
      orientation && orientation >= 5 ? height / width : width / height;
    const dimension = (value: number) =>
      Math.max(256, Math.min(512, Math.round(value / 64) * 64));
    const resized = await original
      .resize(
        dimension(512 * Math.min(1, ratio)),
        dimension(512 / Math.max(1, ratio)),
        { fit: "contain", background: "#fff" },
      )
      .png()
      .toBuffer();
    const form = new FormData();
    form.set(
      "image",
      new Blob([new Uint8Array(resized)], { type: "image/png" }),
      "gameforge-input.png",
    );
    form.set("overwrite", "true");
    const upload = await (await comfy("/upload/image", form)).json();
    graph["7"] = node("LoadImage", { image: upload.name });
    graph["8"] = node("VAEEncode", { pixels: ["7", 0], vae: ["1", 2] });
  }
  const { prompt_id } = await (
    await comfy("/prompt", JSON.stringify({ prompt: graph, client_id: name }))
  ).json();
  try {
    const end = Date.now() + 600000;
    while (Date.now() < end) {
      await wait(1500);
      const record = (
        await (await comfy("/history/" + encodeURIComponent(prompt_id))).json()
      )[prompt_id];
      if (!record) continue;
      if (record.status?.status_str === "error")
        throw Error(
          "ComfyUI: " + JSON.stringify(record.status.messages).slice(-900),
        );
      const image = record.outputs?.["9"]?.images?.[0];
      if (image)
        return Buffer.from(
          await (
            await comfy(
              "/view?" +
                new URLSearchParams({
                  filename: image.filename,
                  subfolder: image.subfolder,
                  type: image.type,
                }),
            )
          ).arrayBuffer(),
        );
      throw Error("ComfyUI finished without an image");
    }
    await comfy("/interrupt", "{}");
    throw Error("ComfyUI image timeout");
  } finally {
    await comfy(
      "/free",
      JSON.stringify({ unload_models: true, free_memory: true }),
    ).catch(() => {});
  }
}
