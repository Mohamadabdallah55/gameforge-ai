import path from "node:path";
import express from "express";
import { Store } from "./store";
import { createApp } from "./app";
const { app, worker } = createApp(new Store(process.env.DATA_DIR || "./data"));
if (process.argv.includes("--production")) {
  app.use(express.static("dist"));
  app.get("/{*path}", (_, r) => r.sendFile(path.resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log("GameForge AI port " + port);
  void worker.drain();
});
