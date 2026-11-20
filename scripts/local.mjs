import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  statSync,
  renameSync,
} from "node:fs";
import { spawn, spawnSync, fork } from "node:child_process";
import path from "node:path";
const root = path.resolve(process.env.ENGINES_DIR || "../../work/engines");
const searx = path.join(
    root,
    existsSync(path.join(root, "searx-native/.venv/bin/python"))
      ? "searx-native"
      : "searxng",
  ),
  comfy = path.join(root, "comfy");
const checkpointDir = path.join(comfy, "models/checkpoints");
const checkpoint =
  process.env.COMFY_CHECKPOINT || "v1-5-pruned-emaonly-fp16.safetensors";
const processes = new Map();
mkdirSync(path.join(root, "logs"), { recursive: true });
const foreground = path.join(root, "gameforge-foreground");
const foregroundSource = path.resolve("scripts/foreground-mask.swift");
if (
  process.platform === "darwin" &&
  (!existsSync(foreground) ||
    statSync(foregroundSource).mtimeMs > statSync(foreground).mtimeMs)
) {
  const compiled = spawnSync(
    "/usr/bin/swiftc",
    [foregroundSource, "-o", foreground + ".new"],
    { timeout: 45000 },
  );
  if (compiled.status === 0) renameSync(foreground + ".new", foreground);
  else
    console.error(
      "Apple Vision foreground module not built. Check macOS command-line tools.",
    );
}
const commands = {
  ollama: {
    file: process.env.OLLAMA_BIN || path.join(root, "ollama/ollama"),
    args: ["serve"],
    env: {
      OLLAMA_HOST: "127.0.0.1:11434",
      OLLAMA_MODELS: path.join(root, "models"),
      OLLAMA_NO_CLOUD: "1",
      OLLAMA_MAX_LOADED_MODELS: "1",
      OLLAMA_NUM_PARALLEL: "1",
    },
  },
  comfy: {
    file: path.join(comfy, ".venv/bin/python"),
    cwd: comfy,
    args: [
      "main.py",
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
      "--lowvram",
      "--preview-method",
      "none",
      "--disable-all-custom-nodes",
    ],
    env: { PYTORCH_ENABLE_MPS_FALLBACK: "1" },
  },
  searx: {
    file: path.join(searx, ".venv/bin/python"),
    cwd: searx,
    args: ["-m", "searx.webapp"],
    env: { SEARXNG_SETTINGS_PATH: path.join(root, "searx-settings.yml") },
  },
};
function launch(name) {
  if (name === "comfy" && !existsSync(path.join(checkpointDir, checkpoint))) {
    console.log("ComfyUI waiting for " + checkpoint);
    return;
  }
  const c = commands[name];
  if (!existsSync(c.file)) {
    console.error(name + " is not installed at " + c.file);
    return;
  }
  const log = openSync(path.join(root, "logs", name + ".log"), "a");
  const child = spawn(c.file, c.args, {
    cwd: c.cwd,
    env: { ...process.env, ...c.env },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  processes.set(name, child);
  child.on("error", (e) => console.error(name + ": " + e.message));
  child.on("exit", () => {
    if (processes.get(name) === child) processes.delete(name);
  });
}
for (const name of Object.keys(commands)) launch(name);
const server = fork("server/main.ts", process.argv.slice(2), {
  execArgv: ["--import", "tsx"],
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    GAMEFORGE_COMFY_CHECKPOINT_DIR: checkpointDir,
    GAMEFORGE_FOREGROUND_BIN: foreground,
  },
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of processes.values()) child.kill();
  if (server.exitCode === null) server.kill();
}
server.on("message", (m) => {
  if (stopping || !m || !Object.hasOwn(commands, m.restart)) return;
  const old = processes.get(m.restart);
  if (old) {
    old.once("exit", () => {
      if (!stopping) launch(m.restart);
    });
    old.kill();
  } else launch(m.restart);
});
server.on("exit", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
