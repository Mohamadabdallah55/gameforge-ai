import express from "express";
import { z } from "zod";
import { ChatGPTError, ChatGPTSession } from "./chatgpt-session";
export function chatGPTRoutes(
  session: ChatGPTSession,
  planUsageEnabled: boolean,
  requirePlanUsage: () => void,
) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
    if (
      !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.get("host") || "") ||
      !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(
        req.socket.remoteAddress || "",
      )
    ) {
      res.sendStatus(403);
      return;
    }
    if (
      req.method === "POST" &&
      (!req.is("application/json") ||
        (req.get("origin") &&
          new URL(req.get("origin")!).host !== req.get("host")))
    ) {
      res.sendStatus(403);
      return;
    }
    next();
  });
  router.get("/status", (_, r) =>
    r.json({ ...session.status(), planUsageEnabled }),
  );
  router.use((q, _, next) => {
    if (q.path !== "/signout") requirePlanUsage();
    next();
  });
  router.post("/start", (q, r) => {
    const address = q.socket.localPort;
    if (!address) {
      r.sendStatus(503);
      return;
    }
    r.json({ url: session.start(address) });
  });
  router.get("/callback", async (q, r) => {
    try {
      await session.complete(
        new URL(q.originalUrl, "http://127.0.0.1").searchParams,
      );
      r.redirect(303, "/?chatgpt=connected");
    } catch (e) {
      // Consume the callback without echoing its URL, code, or token payload.
      const reason = e instanceof ChatGPTError ? "exchange" : "authorization";
      r.redirect(303, "/?chatgpt=" + reason);
    }
  });
  router.get("/models", async (_, r) => r.json(await session.models()));
  router.post("/model", async (q, r) => {
    await session.pick(z.string().trim().min(1).max(120).parse(q.body?.model));
    r.json({ ...session.status(), planUsageEnabled });
  });
  router.post("/signout", async (_, r) => r.json(await session.signOut()));
  return router;
}
