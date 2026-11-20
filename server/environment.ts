import { existsSync } from "node:fs";
import { localHttp } from "./local-http";
import { endpoint } from "./local";
import { foregroundBinary } from "./foreground";
import {
  getGeminiApiKey,
  getGeminiKeySource,
  isPaidApproved,
  resolveEliteModel,
  resolveEmbedModel,
  resolveFastModel,
} from "./gemini-client";

const reachCache = new Map<string, { ok: boolean; checkedAt: number }>();

export async function probeLoopbackService(
  envKey: string,
  defaultPort: number,
  pathSuffix: string,
  ttlMs = 30_000,
): Promise<boolean> {
  const cacheKey = `${envKey}:${defaultPort}:${pathSuffix}`;
  const cached = reachCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < ttlMs) {
    return cached.ok;
  }
  try {
    const base = endpoint(envKey, defaultPort);
    const r = await localHttp(base + pathSuffix, { timeout: 600 });
    const ok = r.ok;
    reachCache.set(cacheKey, { ok, checkedAt: Date.now() });
    return ok;
  } catch {
    reachCache.set(cacheKey, { ok: false, checkedAt: Date.now() });
    return false;
  }
}

export function clearLoopbackProbeCache() {
  reachCache.clear();
}

export function isCloudEnvironment(): boolean {
  if (process.env.GAMEFORGE_FORCE_LOCAL === "1") return false;
  return (
    process.platform !== "darwin" ||
    Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB)
  );
}

export function hasAppleVisionBinary(): boolean {
  return process.platform === "darwin" && existsSync(foregroundBinary());
}

export function runtimeCapabilities() {
  return {
    environment: isCloudEnvironment() ? ("cloud" as const) : ("local" as const),
    platform: process.platform,
    geminiConfigured: Boolean(getGeminiApiKey()),
    geminiKeySource: getGeminiKeySource(),
    models: {
      elite: resolveEliteModel(),
      fast: resolveFastModel(),
      embed: resolveEmbedModel(),
    },
    paidImageGenerationEnabled: isPaidApproved(),
    appleVisionAvailable: hasAppleVisionBinary(),
  };
}
