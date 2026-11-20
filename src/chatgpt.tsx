import { useEffect, useState } from "react";
import { api } from "./api";

export function ChatGPTControls() {
  const [status, setStatus] = useState<{
    signedIn: boolean;
    authorized: boolean;
    planUsageEnabled: boolean;
    model?: string;
    email?: string;
  }>();
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [message, setMessage] = useState(() => {
    const result = new URLSearchParams(window.location.search).get("chatgpt");
    return result === "exchange" || result === "authorization"
      ? "لم يكتمل الربط. اضغط Continue with ChatGPT لإعادة المحاولة."
      : "";
  });
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const account = await api<NonNullable<typeof status>>("chatgpt/status");
    setStatus(account);
    const catalog =
      account.planUsageEnabled && account.authorized
        ? await api<{ id: string; name: string }[]>("chatgpt/models")
        : [];
    setModels(catalog);
    if (account.authorized && !account.model && catalog.length) {
      const recommended =
        catalog.find((m) => m.id === "gpt-6.2-sol") || catalog[0];
      const selected = await api<NonNullable<typeof status>>("chatgpt/model", {
        model: recommended.id,
      });
      setStatus(selected);
    }
  }

  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, []);

  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.planUsageEnabled)
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-900">
            ChatGPT · وضع الاستيراد اليدوي
          </h3>
          <span className="text-xs font-medium text-slate-500">
            الإنتاج الآلي يعتمد على Gemini
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          الربط التلقائي بحصة ChatGPT موقوف لحماية البنية الإنتاجية. يمكنك دائمًا
          نسخ طلب المسابقة واستيراد الرد من تبويب «ملفات الألعاب».
        </p>
      </section>
    );

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900">ChatGPT</h3>
        {status?.email && (
          <span className="font-mono text-xs text-slate-500">{status.email}</span>
        )}
      </div>
      <p className="text-sm text-slate-600">
        {status?.authorized
          ? "استخدام حصة خطة ChatGPT مفوّض"
          : status?.signedIn
            ? "تم تسجيل الدخول. تفويض حصة الخطة مطلوب."
            : "اربط حسابك لاستخدام ChatGPT عند اختياره لمهمة."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const { url } = await api<{ url: string }>("chatgpt/start", {});
              window.location.assign(url);
            })
          }
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          Continue with ChatGPT
        </button>
        {status?.signedIn && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const { revoked } = await api("chatgpt/signout", {});
                await refresh();
                if (!revoked)
                  setMessage(
                    "تم تسجيل الخروج محليًا. تعذّر تأكيد إلغاء الربط في ChatGPT.",
                  );
              })
            }
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            تسجيل الخروج من ChatGPT
          </button>
        )}
      </div>
      {status?.authorized && (
        <label className="block text-sm font-medium text-slate-700">
          نموذج ChatGPT
          <select
            value={status.model || ""}
            disabled={busy}
            onChange={(e) => {
              const model = e.target.value;
              if (model)
                void action(async () => {
                  await api("chatgpt/model", { model });
                  await refresh();
                });
            }}
            className="mt-1.5 w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-800 focus:outline-none"
          >
            <option value="">اختر نموذجًا متاحًا في حسابك</option>
            {models.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {message && (
        <p role="alert" className="text-sm font-medium text-rose-700">
          {message}
        </p>
      )}
      <p className="text-xs text-slate-500">
        <a
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-slate-700"
        >
          عرض حصة ChatGPT
        </a>
      </p>
    </section>
  );
}
