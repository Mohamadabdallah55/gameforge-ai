# الاستكمال في Google AI Studio

1. استخدم المستودع المعتمد بعد المراجعة عبر Import from GitHub في Build Mode. احفظ مجلد البيانات والنماذج والأسرار خارج Git. [توثيق Google الرسمي](https://ai.google.dev/gemini-api/docs/aistudio-build-mode)
2. عيّن `GEMINI_API_KEY` في أسرار الخادم وتحقق في مشروع Google AI Studio الخاص بالمفتاح أن Cloud Billing غير مفعّل. بعد التحقق عيّن `GEMINI_FREE_PROJECT_CONFIRMED=1` وراجع حصص النموذج. مرشح النص والرؤية المبدئي `gemini-3.8-flash`، ويمكن اختيار `gemini-3.5-flash-lite` صراحةً قبل إنشاء المهمة.
3. للتطوير شغّل `npm ci` و`npm run dev` باستخدام Node.js 24. البناء المحلي الكامل شغّل `npm run build` ثم `npm run local`. افحص `/api/health` و`/api/engines` ثم اقرأ [عقود HTTP](API_CONTRACTS.md).
4. نسخة المعاينة السحابية تحتاج إلى بيئة تشغّل خدمات Ollama وSearXNG وComfyUI على loopback في نطاق الخادم ذاته. Mac مع Apple Vision مطلوب لفصل الخلفية الأصلي على هذا المسار. احفظ المكتبة على قرص دائم. يمكن استخدام الواجهة والتصدير في المعاينة حتى قبل تهيئة الخدمات.
5. راجع [حالة القبول](PROJECT_STATUS.md) قبل زيادة حجم الإنتاج. شغّل `node --env-file-if-exists=.env --import tsx scripts/accept-elite-questions.ts` بعد تهيئة مشروع Gemini المؤهل. استأنف أي دفعة بحاجة لاستئناف من لوحة المهام.
