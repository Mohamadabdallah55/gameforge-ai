import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3417",
    channel: process.env.CHROME_CHANNEL || undefined,
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3417/api/health",
    env: {
      PORT: "3417",
      HOST: "127.0.0.1",
      GEMINI_FREE_PROJECT_CONFIRMED: "0",
      DATA_DIR: mkdtempSync(path.join(tmpdir(), "forge-e2e-")),
    },
  },
});
