import { request } from "node:http";

interface Options {
  timeout: number;
  body?: string | FormData;
  headers?: Record<string, string>;
}

export async function localHttp(url: string | URL, options: Options) {
  const target = new URL(url);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(target.hostname) ||
    target.username ||
    target.password
  ) {
    throw new Error("Expected a local HTTP connection");
  }
  const headers = { ...options.headers };
  let payload: Buffer | undefined;
  if (typeof options.body === "string") {
    payload = Buffer.from(options.body);
  } else if (options.body) {
    const multipart = new Response(options.body);
    headers["content-type"] = multipart.headers.get("content-type")!;
    payload = Buffer.from(await multipart.arrayBuffer());
  }
  if (payload) headers["content-length"] = String(payload.length);

  return new Promise<Response>((resolve, reject) => {
    // Local engines can exit or close a socket mid-response during startup.
    const req = request(
      target,
      {
        agent: false,
        method: payload ? "POST" : "GET",
        headers,
        signal: AbortSignal.timeout(options.timeout),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 24 * 1024 * 1024) {
            req.destroy(new Error("Local engine response exceeds 24 MiB"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined)
                responseHeaders.set(
                  key,
                  Array.isArray(value) ? value.join(", ") : value,
                );
            }
            const bytes = size
              ? new Uint8Array(Buffer.concat(chunks, size))
              : null;
            resolve(
              new Response(bytes, {
                status: res.statusCode ?? 502,
                headers: responseHeaders,
              }),
            );
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
