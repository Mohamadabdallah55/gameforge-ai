export class LocalConnectionError extends Error {
  constructor() {
    super(
      "انقطع الاتصال بخادم GameForge المحلي. أعد الاتصال بالخادم أو شغّل npm run local من مجلد المشروع.",
    );
    this.name = "LocalConnectionError";
  }
}

export async function api<T = any>(
  route: string,
  body?: unknown,
  method?: "GET" | "POST" | "PATCH" | "DELETE",
): Promise<T> {
  const actualMethod = method || (body === undefined ? "GET" : "POST");
  const r = await fetch("/api/" + route, {
    method: actualMethod,
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  }).catch(() => {
    throw new LocalConnectionError();
  });
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
