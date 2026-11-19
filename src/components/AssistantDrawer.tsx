import React, { useState } from "react";
import {
  Bot,
  Send,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { AssistantMessage } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  messages: AssistantMessage[];
  busy: boolean;
  configured: boolean;
  onSend: (message: string) => Promise<void>;
  onClear: () => Promise<void>;
}

const QUICK_PROMPTS = [
  "لخّص حالة المكتبة والمهام الحالية",
  "أنشئ 3 أسئلة سهلة عن كأس العالم 2022",
  "افحص المكتبة للتأكد من عدم وجود تكرار",
  "جهّز رابط تصدير حزمة ZIP",
];

export function AssistantDrawer({
  open,
  onClose,
  messages,
  busy,
  configured,
  onSend,
  onClear,
}: Props) {
  const [input, setInput] = useState("");

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void onSend(text);
  };

  return (
    <aside
      aria-label="المساعد الذكي"
      className="fixed inset-y-0 left-0 z-50 w-full max-w-md bg-white border-r border-slate-200 shadow-xl flex flex-col"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-emerald-900" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              المساعد الذكي للمنصة
            </h2>
            <p className="text-[11px] text-slate-500">
              يتحكم بالإنتاج، البحث، الصور، المحرر، التدقيق، والتصدير
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy || messages.length === 0}
            onClick={() => void onClear()}
            aria-label="مسح المحادثة"
            className="p-1.5 text-slate-500 hover:text-red-700 disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق المساعد"
            className="p-1.5 text-slate-500 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 ? (
          <div className="space-y-4 py-6">
            <p className="text-xs text-slate-600 leading-relaxed">
              اطلب مني أي عملية داخل المنصة بالعربية، وسأنفذها مباشرة عبر أدوات الخادم الفعلية.
            </p>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-500">
                أوامر سريعة:
              </p>
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy || !configured}
                  onClick={() => void onSend(q)}
                  className="block w-full text-right rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 hover:border-emerald-800 hover:bg-emerald-50/30 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col gap-1.5 ${
                m.role === "user" ? "items-start" : "items-end"
              }`}
            >
              <div
                className={`max-w-[90%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-emerald-900 text-white"
                    : "bg-white border border-slate-200 text-slate-900"
                }`}
              >
                {m.content}
              </div>

              {m.actions && m.actions.length > 0 && (
                <div className="max-w-[90%] space-y-1 text-[11px] text-slate-600">
                  {m.actions.map((a, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2 py-1"
                    >
                      {a.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      )}
                      <span>{a.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={submit}
        className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
      >
        <input
          type="text"
          aria-label="رسالة للمساعد الذكي"
          disabled={busy || !configured}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            configured
              ? "اكتب أمرك هنا... (مثال: أنشئ 20 سؤالاً عن الفضاء)"
              : "أضف MY_CUSTOM_GEMINI_KEY لتفعيل المساعد"
          }
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-800 focus:outline-none disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || !configured}
          aria-label="إرسال"
          className="rounded-md bg-emerald-900 p-2.5 text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </aside>
  );
}
