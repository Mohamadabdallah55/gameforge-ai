import { existsSync } from "node:fs";
import path from "node:path";
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
import {
  isCloudEnvironment,
  probeLoopbackService,
  runtimeCapabilities,
} from "./environment";

export async function engineStatus(db: Store, gemini?: EliteGemini) {
  const cloud = isCloudEnvironment();
  const probeLocal = async (
    name: string,
    model: string,
    envKey: string,
    defaultPort: number,
    pingPath: string,
    check: () => Promise<unknown>,
  ) => {
    try {
      const reachable = await probeLoopbackService(
        envKey,
        defaultPort,
        pingPath,
      );
      if (!reachable) {
        return {
          name,
          model,
          scope: "local" as const,
          connected: false,
          ...stats[name],
          error: cloud
            ? `محرك محلي (${name}) غير متاح داخل بيئة Google AI Studio السحابية — يعمل فقط عند تشغيله على جهازك.`
            : `المحرك المحلي ${name} غير شغّال على الجهاز.`,
        };
      }
      return {
        name,
        model,
        scope: "local" as const,
        connected: true,
        detail: await check(),
        ...stats[name],
      };
    } catch (e) {
      return {
        name,
        model,
        scope: "local" as const,
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
            scope: "cloud" as const,
            ...status,
          })),
        ]
      : []),
    {
      name: "Cloud Web & Image Search",
      model: "Bing + DuckDuckGo Images + Google News RSS + Openverse",
      scope: "cloud" as const,
      connected: true,
      detail: {
        channels: ["Bing Web", "DuckDuckGo Images", "Bing Images", "Google News RSS", "Openverse", "NASA Archive"],
      },
    },
    {
      name: "Sharp Local Media Studio",
      model: "Sketch / Cartoon / B&W / Silhouette / Mask / BG Flood",
      scope: "cloud" as const,
      connected: true,
      detail: {
        aiGenerativeImages: runtimeCapabilities().paidImageGenerationEnabled,
      },
    },
    probeLocal("Ollama", textModel(), "OLLAMA_URL", 11434, "/api/tags", async () => {
      const { models } = await ollama("/api/tags");
      if (!models.some((m: { name: string }) => m.name === textModel()))
        throw Error("نموذج النص غير مثبت");
      return (await ollama("/api/ps")).models.map((m: any) => ({
        name: m.name,
        memory: m.size_vram,
      }));
    }),
    probeLocal("BGE-M3", embedModel(), "OLLAMA_URL", 11434, "/api/tags", async () => {
      const { models } = await ollama("/api/tags");
      if (
        !models.some((m: { name: string }) =>
          [embedModel(), embedModel() + ":latest"].includes(m.name),
        )
      )
        throw Error("نموذج التضمين غير مثبت");
      return null;
    }),
    probeLocal("ComfyUI", checkpoint(), "COMFY_URL", 8188, "/system_stats", async () => {
      const dir = process.env.GAMEFORGE_COMFY_CHECKPOINT_DIR;
      if (dir && !existsSync(path.join(dir, checkpoint())))
        throw Error("ملف نموذج الصور غير مكتمل");
      const models = await (await comfy("/models/checkpoints")).json();
      if (!models.includes(checkpoint())) throw Error("ملف النموذج غير مثبت");
      const s = await (await comfy("/system_stats")).json();
      return s.devices;
    }),
    probeLocal("SearXNG", "Web + Images", "SEARXNG_URL", 8888, "/config", async () => null),
    (async () => {
      if (process.platform !== "darwin" || !existsSync(foregroundBinary())) {
        return {
          name: "Apple Vision",
          model: "Foreground Instance Mask",
          scope: "local" as const,
          connected: false,
          error: cloud
            ? "يتطلب macOS 14+ (متاح على Mac محليًا فقط؛ البديل السحابي المدمج يعمل عبر Sharp)."
            : "أداة فصل الخلفية غير مبنية على هذا الجهاز",
        };
      }
      return {
        name: "Apple Vision",
        model: "Foreground Instance Mask",
        scope: "local" as const,
        connected: true,
        detail: "فصل العناصر على الجهاز",
      };
    })(),
    ...(visionModel()
      ? [
          probeLocal("Vision", visionModel(), "OLLAMA_URL", 11434, "/api/tags", async () => {
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
    environment: runtimeCapabilities(),
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
