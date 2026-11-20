export class LocalConnectionError extends Error {
  constructor() {
    super(
      "انقطع الاتصال بخادم GameForge المحلي. شغّل npm run local من مجلد المشروع. ستعاود الصفحة الاتصال تلقائيًا.",
    );
    this.name = "LocalConnectionError";
  }
}

export async function api<T = any>(route: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api/" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  ).catch(() => {
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
