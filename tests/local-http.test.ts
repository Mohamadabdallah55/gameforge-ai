import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { localHttp } from "../server/local-http";

test("a local engine can disconnect mid-response and accept the next request", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/interrupted") {
      res.writeHead(200, { "Content-Length": "15" });
      res.write("partial", () => res.destroy());
    } else {
      res.end('{"ok":true}');
    }
  });
  server.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  await assert.rejects(localHttp(base + "/interrupted", { timeout: 2000 }));
  const response = await localHttp(base + "/ready", { timeout: 2000 });
  assert.deepEqual(await response.json(), { ok: true });
});
