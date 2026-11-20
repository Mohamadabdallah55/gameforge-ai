import { useState } from "react";
import type { Plan } from "../shared/contracts";
import { api } from "./api";

const preference = "gameforge-chat-url";

function chatLink(value: string) {
  if (!value.trim()) return "https://chatgpt.com/";
  try {
    const url = new URL(value);
    if (
      url.origin === "https://chatgpt.com" &&
      /\/c\/[0-9a-f-]{36}\/?$/i.test(url.pathname)
    )
      return url.origin + url.pathname;
  } catch {}
  return "";
}

export function ChatTransfer({
  plan,
  request,
  rules,
  profileId,
  onImported,
}: {
  plan: Plan;
  request: string;
  rules: string;
  profileId: string;
  onImported: () => Promise<void>;
}) {
  const [url, setUrl] = useState(() => localStorage.getItem(preference) || "");
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState("");
  const link = chatLink(url);
  const audience = {
    jordan: "أردني",
    arab: "عربي غير أردني",
    mixed: "أردني وعربي مختلط",
  }[plan.audienceRegion || "mixed"];

  const prompt = [
    "اكتب أسئلة مسابقة عربية مناسبة للجمهور. اختر مصادر موثوقة عن الموضوع، وصغ أسئلة متنوعة غير مكررة مع الإجابات.",
    request.trim() && "الطلب: " + request.trim(),
    plan.topic.trim() && "الموضوع: " + plan.topic.trim(),
    `التوزيع المطلوب: ${plan.easy} سهلة، ${plan.medium} متوسطة، ${plan.hard} صعبة، ما لم يحدد الطلب أعلاه أعدادًا أخرى.`,
    "الجمهور: " + [audience, plan.audience].filter(Boolean).join("، "),
    rules.trim() && "قواعد اللعبة: " + rules.trim(),
    "أرسل JSON صالحًا فقط، حتى 100 سؤال في الرد. لا تكرر أسئلة الدفعات الماضية. استخدم easy أو medium أو hard. أضف لكل سؤال رابط HTTPS مباشر للمصدر واقتباسًا قصيرًا منه عندما يتاح. لا تختلق روابط.",
    '{"questions":[{"question":"…","answer":"…","difficulty":"easy","source":"https://…","quote":"…"}]}',
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="space-y-4 pt-3">
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700">
          رابط محادثتي في ChatGPT
          <input
            type="url"
            value={url}
            placeholder="https://chatgpt.com/c/…"
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => {
              if (link) localStorage.setItem(preference, url.trim() ? link : "");
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
            dir="ltr"
          />
        </label>
        {link ? (
          <p className="text-xs text-slate-600">
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-950"
            >
              افتح محادثتي في ChatGPT
            </a>
          </p>
        ) : (
          <p role="alert" className="text-xs font-medium text-rose-700">
            أدخل رابط المحادثة من شريط عنوان ChatGPT.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!plan.topic.trim() && !request.trim()}
          onClick={async () => {
            setPrepared(prompt);
            try {
              await navigator.clipboard.writeText(prompt);
              setStatus("نُسخ الطلب. الصقه في محادثتك، ثم انسخ الرد هنا.");
            } catch {
              setStatus("انسخ الطلب من الحقل الظاهر.");
            }
          }}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          نسخ طلب المسابقة
        </button>
      </div>

      {prepared && (
        <label className="block text-sm font-medium text-slate-700">
          الطلب الجاهز
          <textarea
            value={prepared}
            readOnly
            rows={4}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 focus:outline-none"
          />
        </label>
      )}

      <label className="block text-sm font-medium text-slate-700">
        رد ChatGPT بصيغة JSON
        <textarea
          value={reply}
          rows={5}
          placeholder='{"questions":[{"question":"...","answer":"...","difficulty":"easy"}]}'
          onChange={(event) => setReply(event.target.value)}
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
          dir="ltr"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !reply.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api<{
                imported: number;
                duplicates: number;
              }>("questions/from-chat", { profileId, text: reply });
              setStatus(
                `أُضيف ${result.imported} للمكتبة، وتُجاوز ${result.duplicates} مكرر.`,
              );
              setReply("");
              await onImported();
            } catch (e) {
              setStatus((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          استيراد الرد إلى المكتبة
        </button>
      </div>

      {status && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
          {status}
        </p>
      )}
    </div>
  );
}
