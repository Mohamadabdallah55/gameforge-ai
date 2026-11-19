# الاستكمال في Google AI Studio

## فتح المشروع

1. ارفع محتويات هذا المستودع المحلي إلى مستودع GitHub تملكه، مع package.json في الجذر. يتجاهل Git الأسرار والمكتبة المحلية. إذا استخدمت ZIP ففكّه أولًا. سجل المراحل موجود في مجلد المشروع المحلي.
2. من Build اختر تطبيق ويب ثم Add files (+) وImport from GitHub وحدد المستودع والفرع main. [تعليمات Google الرسمية](https://ai.google.dev/gemini-api/docs/aistudio-build-mode)
3. عيّن GEMINI_API_KEY في أسرار الخادم. تأكد من إتاحة نموذج النص والصور والتضمينات في حسابك، وعدّل الأسماء من .env.example عند الحاجة. يحتاج البحث العام الاختياري إلى TAVILY_API_KEY.
4. استخدم Node 24. شغّل npm ci ثم npm run dev. عند استخدام معاينة حاوية، اضبط HOST=0.0.0.0 وPORT على المنفذ الذي تطلبه المنصة. إذا رفض Vite اسم مضيف المعاينة فعيّن __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS إلى اسم المضيف الفعلي. بديل التشغيل المبني هو npm run build ثم npm start. اجعل المعاينة خاصة.
5. تحقق من /api/health، وأنشئ ملف لعبة ثم مهمة بسؤال سهل واحد دون صورة. راجع الدليل، ثم جرّب سؤالًا مصورًا وتوليد صورة أو تعديلها. راقب Job.error إذا افتقر الحساب إلى نموذج أو حصة. نفّذ تجربة ثانية بعد إعادة تشغيل الخادم للتحقق من بقاء DATA_DIR.

## نقطة بدء للمساعد

«اقرأ PROJECT_STATUS.md وAPI_CONTRACTS.md وARCHITECTURE.md. شغّل npm test وnpm run build. حافظ على shared/contracts.ts وعلى استئناف المهام. اختبر دورة Gemini الحية بسؤال واحد قبل رفع حجم الدفعة، ثم استكمل TODO.md. احتفظ بمفاتيح المزود في خادم Node.»

## ما يلزم عند نقل التشغيل

شغّل خادمًا واحدًا لكل قاعدة. تستخدم الاستضافة المستمرة قرصًا دائمًا لـDATA_DIR أو تحتاج إلى محوّل تخزين دائم. عند تغيير نموذج embedding، خطط لإعادة حساب التضمينات المخزنة. المحوّل الحالي يستخدم embedContent وSEMANTIC_SIMILARITY؛ تحقّق من عقد النموذج البديل قبل التبديل. [توثيق Gemini](https://ai.google.dev/gemini-api/docs/embeddings) · [توثيق Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search)
