import { defineConfig } from "@playwright/test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function detectHeadlessShell(): string | undefined {
  if (process.env.CHROME_EXECUTABLE) return process.env.CHROME_EXECUTABLE;
  const root = "/ms-playwright";
  if (!existsSync(root)) return undefined;
  try {
    for (const dir of readdirSync(root)) {
      if (dir.startsWith("chromium_headless_shell-")) {
        const candidate = path.join(
          root,
          dir,
          "chrome-headless-shell-linux64",
          "chrome-headless-shell",
        );
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  return undefined;
}

const executablePath = detectHeadlessShell();

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3417",
    channel: executablePath ? undefined : process.env.CHROME_CHANNEL || undefined,
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3417/api/health",
    env: {
      PORT: "3417",
      HOST: "127.0.0.1",
      GEMINI_FREE_PROJECT_CONFIRMED: "0",
      GEMINI_API_KEY: "",
      MY_CUSTOM_GEMINI_KEY: "",
      DATA_DIR: mkdtempSync(path.join(tmpdir(), "forge-e2e-")),
    },
  },
});
