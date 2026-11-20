# التشغيل المحلي على Apple Silicon

اختُبرت مواصفات الجهاز الفعلية باستخدام system_profiler. الجهاز MacBook Air بشريحة Apple M4 وذاكرة 16 GB وبنية arm64. كانت المساحة الحرة قرابة 16 GiB في بداية العمل. احتفظ بمساحة للنظام وملفات المكتبة بعد تنزيل النماذج. ملفات المحركات على هذا الجهاز في work/engines بالنسبة إلى مجلد الجلسة، خارج مستودع Git.

## التشغيل

من مجلد gameforge-ai، شغّل `npm run local` وافتح http://127.0.0.1:3000. يسجل المشغّل خدماته في ENGINES_DIR/logs. يمكنك فتح صفحة AI Engines ثم تحديث الحالة وإعادة تشغيل أي خدمة يديرها المشغّل، عند عدم وجود مهمة قيد الإنتاج. الخادم والخدمات تستمع محليًا على 3000 و11434 و8188 و8888. استخدم npm run dev عند تشغيل المحركات بنفسك.

| المحرك | النموذج أو الوظيفة |
|---|---|
| Ollama | qwen3:8b لتحليل الطلب والمساعدة والترجمة |
| Ollama embeddings | bge-m3 للتضمينات متعددة اللغات |
| ComfyUI | SD 1.5 FP16 بحجم 2.13 GB، توليد 512×512 وتعديل img2img، PyTorch MPS |
| Sharp | معالجة محلية للقلم والتدرج الرمادي والظل وتكميم الألوان |
| SearXNG | بحث عام ومعاينات Google Images عند الإتاحة وبدائل البحث |
| Apple Vision | فصل الخلفية والظل من نموذج macOS المدمج، يحتاج أدوات سطر أوامر Xcode |
| Gemini API | بحث تحريري وتأليف وتحقق وتحليل بصري بعد إعداد مشروع Free Tier مؤهل |
| Wikipedia وOpenverse | سياق نصي وصور مسموحة خارج Wikimedia مع تخزين مؤقت |

تعمل اللغة والتضمينات وتوليد الصور المحلية بعد تثبيت النماذج بلا اشتراك. يحتاج البحث عن المصادر الحية إلى الإنترنت. تعرض الأدلة المصدر والاقتباس القابل للمراجعة. لا يضمن أي نموذج صحة الوقائع أو هوية الوجوه وحده. يرفض المسار التلقائي نتائج الصور ضعيفة المطابقة ويحافظ على مصدر الصورة وترخيصها. وضع التوليد الصريح ينتج رسومًا رمزية للمسابقة. يطبق ComfyUI التحويلات الفنية من صورة أصلية، وتطبق Sharp التأثيرات المباشرة. يراجع النظام البكسلات في مسار الإرفاق التلقائي.

## إعادة التثبيت في مكان آخر

1. استخدم Node 24 و`npm ci`. ضع Ollama الرسمي في ENGINES_DIR/ollama أو عيّن OLLAMA_BIN. بعد تشغيله محليًا استخدم `ollama pull qwen3:8b` ثم `ollama pull bge-m3`. يجب أن يشير OLLAMA_MODELS خلال التشغيل إلى مكان النماذج نفسه.
2. انسخ مستودع ComfyUI الرسمي إلى ENGINES_DIR/comfy. أنشئ بيئة Python 3.12 باسم .venv وثبّت requirements.txt. ضع ملف النموذج في models/checkpoints داخل ComfyUI. البصمة SHA-256 للنموذج المحدد أدناه هي e9476a13728cd75d8279f6ec8bad753a66a1957ca375a1464dc63b37db6e3916.
3. انسخ مستودع SearXNG الرسمي إلى ENGINES_DIR/searxng. أنشئ بيئة .venv مستقلة وثبّت متطلباته. انسخ scripts/searx-settings.yml إلى ENGINES_DIR/searx-settings.yml. يشغّله المشروع كخدمة تطوير محلية.
4. يمكن تفعيل نموذج رؤية Ollama محدد عبر OLLAMA_VISION_MODEL بعد تنزيله وقياس الذاكرة. عند تفعيله يُضاف فحص بصري مرجِّح فوق فحص البيانات الوصفية. لا يُقارن المحرك صور الأشخاص بهوية بيومترية.

[Ollama](https://ollama.com/download) · [ComfyUI](https://github.com/Comfy-Org/ComfyUI) · [نموذج SD 1.5 وبصمته](https://huggingface.co/Comfy-Org/stable-diffusion-1.5/blob/ce8e3e3657a9b767b33fc0171ff91fb04aed1b2f/v1-5-pruned-emaonly-fp16.safetensors) · [SearXNG](https://github.com/searxng/searxng)

## تنزيل النموذج أو استئنافه

شغّل /usr/bin/python3 scripts/install-checkpoint.py من جذر المشروع بعد توفير المساحة. يحتفظ السكربت بالأجزاء المكتملة ويتحقق من SHA-256. ثم جرّب تشغيل المحرك من لوحة AI Engines. راجع [سجل الحالة](PROJECT_STATUS.md) للنتائج الحالية.

## اختبارات فعلية

```sh
npm test
npm run build
CHROME_CHANNEL=chrome npm run test:ui
node --import tsx scripts/smoke-local.ts search
node --import tsx scripts/smoke-local.ts
node --import tsx scripts/smoke-local.ts image
```

الاختبارات الحية تستخدم قاعدة مؤقتة وتستدعي الخدمات الحقيقية. اختبار النص يفرض الإعداد المحلي ويمسح مفاتيح Gemini وTavily من بيئته ثم يفحص الخطة والتضمينات وسؤالًا مدعومًا وصيغ التصدير.
