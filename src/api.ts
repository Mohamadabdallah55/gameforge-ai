export async function api<T = any>(
  route: string,
  body?: unknown,
  method?: "GET" | "POST" | "PATCH" | "DELETE",
): Promise<T> {
  const resolvedMethod = method ?? (body === undefined ? "GET" : "POST");
  const init: RequestInit =
    resolvedMethod === "GET"
      ? {}
      : {
          method: resolvedMethod,
          headers:
            body !== undefined
              ? { "content-type": "application/json" }
              : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        };

  const r = await fetch("/api/" + route, init);
  if (!r.ok) {
    const t = await r.text();
    try {
      const e = JSON.parse(t);
      throw new Error(e.error || t);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error("HTTP " + r.status);
      throw e;
    }
  }
  return r.json();
}
