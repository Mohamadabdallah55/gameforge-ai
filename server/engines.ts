import { existsSync } from "node:fs";
import path from "node:path";
import { localHttp } from "./local-http";
import { freemem, totalmem } from "node:os";
import { checkpoint, comfy } from "./comfy";
import {
  embedModel,
  endpoint,
  ollama,
  stats,
  textModel,
  visionModel,
} from "./local";
import type { Store } from "./store";
import type { EliteGemini } from "./elite-gemini";
import { googleImagesStatus } from "./search";
import { foregroundBinary } from "./foreground";
export async function engineStatus(db: Store, gemini?: EliteGemini) {
  const probe = async (
    name: string,
    model: string,
    check: () => Promise<unknown>,
  ) => {
    try {
      return {
        name,
        model,
        connected: true,
        detail: await check(),
        ...stats[name],
      };
    } catch (e) {
      return {
        name,
        model,
        connected: false,
        ...stats[name],
        error: (e as Error).message,
      };
    }
  };
  const engines = await Promise.all([
    ...(gemini
      ? [
          gemini.status().then((status) => ({
            name: "Gemini",
            model: gemini.model,
            ...status,
          })),
        ]
      : []),
    probe("Ollama", textModel(), async () => {
      const { models } = await ollama("/api/tags");
      if (!models.some((m: { name: string }) => m.name === textModel()))
        throw Error("نموذج النص غير مثبت");
      return (await ollama("/api/ps")).models.map((m: any) => ({
        name: m.name,
        memory: m.size_vram,
      }));
    }),
    probe("BGE-M3", embedModel(), async () => {
      const { models } = await ollama("/api/tags");
      if (
        !models.some((m: { name: string }) =>
          [embedModel(), embedModel() + ":latest"].includes(m.name),
        )
      )
        throw Error("نموذج التضمين غير مثبت");
      return null;
    }),
    probe("ComfyUI", checkpoint(), async () => {
      const dir = process.env.GAMEFORGE_COMFY_CHECKPOINT_DIR;
      if (dir && !existsSync(path.join(dir, checkpoint())))
        throw Error("ملف نموذج الصور غير مكتمل");
      const models = await (await comfy("/models/checkpoints")).json();
      if (!models.includes(checkpoint())) throw Error("ملف النموذج غير مثبت");
      const s = await (await comfy("/system_stats")).json();
      return s.devices;
    }),
    probe("SearXNG", "Web + Images", async () => {
      const r = await localHttp(endpoint("SEARXNG_URL", 8888) + "/config", {
        timeout: 3000,
      });
      if (!r.ok) throw Error("HTTP " + r.status);
      return null;
    }),
    probe("Apple Vision", "Foreground Instance Mask", async () => {
      if (process.platform !== "darwin" || !existsSync(foregroundBinary()))
        throw Error("أداة فصل الخلفية غير مبنية على هذا الجهاز");
      return "فصل العناصر على الجهاز";
    }),
    ...(visionModel()
      ? [
          probe("Vision", visionModel(), async () => {
            const { models } = await ollama("/api/tags");
            if (!models.some((m: { name: string }) => m.name === visionModel()))
              throw Error("نموذج الرؤية غير مثبت");
            return null;
          }),
        ]
      : []),
  ]);
  const active = db.jobs().find((j) => j.status === "running");
  return {
    engines,
    googleImages: { ...googleImagesStatus },
    totalMemory: totalmem(),
    freeMemory: freemem(),
    managed: !!process.send,
    questionsPerMinute: active?.startedAt
      ? (active.done * 60000) / Math.max(1000, Date.now() - active.startedAt)
      : null,
  };
}
