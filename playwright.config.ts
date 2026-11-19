import { defineConfig } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const fallbackExecutable =
  "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell";
const executablePath =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  (!process.env.CHROME_CHANNEL && existsSync(fallbackExecutable)
    ? fallbackExecutable
    : undefined);

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3417",
    channel: process.env.CHROME_CHANNEL || undefined,
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3417/api/health",
    env: {
      PORT: "3417",
      HOST: "127.0.0.1",
      DATA_DIR: mkdtempSync(path.join(tmpdir(), "forge-e2e-")),
    },
  },
});
