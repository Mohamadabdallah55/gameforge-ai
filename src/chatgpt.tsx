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
      <section>
        <h2>ChatGPT</h2>
        <p>
          الحصة المشتركة موقوفة. خيار «محادثتي في ChatGPT» متاح في تبويب
          الإنتاج.
        </p>
      </section>
    );
  return (
    <section>
      <h2>ChatGPT</h2>
      <p>
        {status?.authorized
          ? "استخدام حصة خطة ChatGPT مفوّض"
          : status?.signedIn
            ? "تم تسجيل الدخول. تفويض حصة الخطة مطلوب."
            : "اربط حسابك لاستخدام ChatGPT عند اختياره لمهمة."}
      </p>
      {status?.email && <p>{status.email}</p>}
      <button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const { url } = await api<{ url: string }>("chatgpt/start", {});
            window.location.assign(url);
          })
        }
      >
        Continue with ChatGPT
      </button>
      {status?.authorized && (
        <label>
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
      {status?.signedIn && (
        <button
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
        >
          تسجيل الخروج من ChatGPT
        </button>
      )}
      {message && <p role="alert">{message}</p>}
      <p>
        <a
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noreferrer"
        >
          عرض حصة ChatGPT
        </a>
      </p>
    </section>
  );
}
