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
    <div>
      <label>
        رابط محادثتي في ChatGPT
        <input
          type="url"
          value={url}
          placeholder="https://chatgpt.com/c/…"
          onChange={(event) => setUrl(event.target.value)}
          onBlur={() => {
            if (link) localStorage.setItem(preference, url.trim() ? link : "");
          }}
        />
      </label>
      {link ? (
        <p>
          <a href={link} target="_blank" rel="noreferrer">
            افتح محادثتي في ChatGPT
          </a>
        </p>
      ) : (
        <p role="alert">أدخل رابط المحادثة من شريط عنوان ChatGPT.</p>
      )}
      <button
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
      >
        نسخ طلب المسابقة
      </button>
      {prepared && (
        <label>
          الطلب الجاهز
          <textarea value={prepared} readOnly />
        </label>
      )}
      <label>
        رد ChatGPT بصيغة JSON
        <textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
      </label>
      <button
        disabled={busy || !reply.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await api<{ imported: number; duplicates: number }>(
              "questions/from-chat",
              { profileId, text: reply },
            );
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
      >
        استيراد الرد إلى المكتبة
      </button>
      {status && <p role="status">{status}</p>}
    </div>
  );
}
