# عقود HTTP

البادئة /api. الأجسام JSON بترميز UTF-8. ملفات الرفع ترسل base64 خامًا بلا بادئة data URI، بحد 12 MB للملف في الواجهة. تعيد العمليات الفاشلة عادةً كائنًا يحوي error. تعيد بعض مسارات العناصر المفقودة نص HTTP 404. يفيد 400 بمدخل أو عملية غير مقبولة، و409 بمحاولة استئناف مهمة غير متوقفة، و502 بفشل مزود. تنتقل أخطاء العامل إلى Job.error.

| الطريقة والمسار | المدخل | المخرج |
|---|---|---|
| GET /health | — | {ok,provider,chatgptPlanUsage} |
| POST /questions/from-chat | {profileId,text} ويرد JSON بعنوان questions | 201 {imported,duplicates}، حفظ محلي من دون اتصال بـ ChatGPT |
| GET /profiles | — | مصفوفة {id,name,rules,mapping} |
| POST /profiles | {name,rules?,mapping?} | 201 الملف المحفوظ |
| POST /interpret | {request} | Plan |
| GET /search | kind=facts أو images أو image-posts وq | Evidence[] للمعلومات وروابط المنشورات، وImageHit[] للصور القابلة للحفظ |
| GET /production/eligibility | — | {model} بعد تحقق كتالوج Gemini، أو 503 مع code يصف العائق |
| POST /jobs | {profileId,plan} | 202 Job مربوط بـ Gemini، أو 503 عند غياب إعداد التشغيل |
| GET /jobs | — | Job[] لكل الألعاب |
| POST /jobs/:id/retry | {} | 202 Job على النموذج المحفوظ |
| POST /jobs/:id/control | {action:pause أو cancel} | الحالة الجديدة مع التقدم السابق |
| GET /jobs/:id/export/:format | json أو csv أو xlsx أو zip | ملف بأسئلة المهمة المحفوظة |
| GET /questions | profileId | Question[] |
| POST /questions/:id/image | {profileId,assetId}، يقبل null | السؤال بعد تعديل صورته |
| GET /assets | — | Asset[] تشمل المعرف والمصدر والنسبة والترخيص وrightsStatus وoriginalId عند انطباقهما |
| GET /assets/:id | — | image/png |
| POST /assets | {data,rights:true,credit,origin?} | 201 Asset |
| POST /assets/transform | {assetId,style,strength?,mask?} | 201 Asset جديد. إضافة background وsubject-silhouette لفصل الخلفية وmask لإخفاء جزء. إحداثيات mask من صفر إلى واحد |
| POST /assets/generate | {prompt?,assetId?,style?,strength?} | 201 Asset محلي من ComfyUI، والأنماط pencil وcartoon وrender3d وeventArt. القوة من 0.15 إلى 0.85 للتحويل |
| POST /templates/infer | {format,data} بصيغة json أو csv أو xlsx | {columns:[{name,type}],mapping,rows} |
| GET /export/:format | profileId، والصيغة json أو csv أو xlsx أو zip | ملف قابل للتنزيل |

## إنشاء مهمة

```json
{"profileId":"default","plan":{"topic":"كأس العالم 2022","easy":3,"medium":2,"hard":1,"imagePercent":50}}
```

تقبل الخطة 0 إلى 10000 لكل مستوى وبمجموع موجب، ونسبة صحيحة من 0 إلى 100. يتضمن Job حقول id وprofileId وplan وdone وstatus وerror. يشير done إلى عدد الأسئلة المحفوظة. تعيد المكتبة question وanswer وdifficulty وsource وquote وimage إضافة إلى id وprofileId. قيمة image هي معرّف أو null.

## حقول التصدير

يربط mapping المفاتيح question وanswer وdifficulty وimage وsource بأسماء الحقول في لعبة الوجهة. تبقى المفاتيح غير المخصصة بأسمائها الافتراضية. قيم الصعوبة easy وmedium وhard. في ZIP يوجد questions.json وcredits.json وevidence.json وimages/<id>.png للصور المستخدمة. يسبق المصدّر قيم CSV التي يمكن تفسيرها كصيغة بعلامة اقتباس مفردة. أنواع TypeScript والتحقق من الخطة والملف في shared/contracts.ts.

## Local-first endpoints

| Method and route | Input | Output |
|---|---|---|
| POST /assistant | {request} | {reply} |
| GET /engines | — | engines, freeMemory, totalMemory, managed, questionsPerMinute, googleImages |
| POST /engines/restart | {engine} with ollama, comfy or searx | 202 restart requested, 409 if unmanaged or a job is running |
| POST /jobs/images | {profileId} | 202 Job to attach licensed images to questions missing images |
| POST /assets/from-search | {query,origin} from licensed results | 201 Asset stored as local PNG |

يدعم `Plan.imageMode` الأنماط real وgenerated وedited وauto وnone وsketch وcartoon وbw وsilhouette. يمكن استبدال الخيار الموحد بـ `Plan.imageMix` مع عدد أو نسبة لكل نوع. `Job.metrics` يعرض عدادات الصفحات المقروءة ومراجعات البكسلات. يعرض `Job.imageFailures` حالات تعذر ربط صورة.

## إنتاج الجودة

- قد تحتوي جودة السؤال على `sourceSelectionReason`، وهو سبب اختيار صفحة من نتائج البحث. يبقى الرابط في `source` والدليل الحرفي في `quote`. قد يغيب تقييم الجودة عن البيانات الأقدم أو المستوردة.

- يدعم Plan حقلي audience وeliteQuality. تحتوي المهام الجديدة على qualityVersion وqualityStage ومؤشر منفصل عن عدد الأسئلة المقبولة.
- GET /jobs/:id/quality يعيد المقبولة والمرفوضة وإعادات التوليد ونسبة التكرار الفكري وتوزيع الصعوبة والنوع والمحاور والمصادر وآخر 60 رفضًا.
- قد تنتهي المهمة بحالة partial عند نفاد الحقائق التي اجتازت المراجعة. تحتوي الأسئلة الحديثة على quality ودرجاتها. تحتوي answers على الترتيب المعتاد في ملفات التصدير، ويضيف ZIP الدرجات إلى evidence.json.

## أهلية Gemini

تُثبت المهمة على مزودها ونموذجها في `Job.production`. تُوقَف عند أخطاء إتاحة النموذج وانتهاء الحصة، ويحتفظ الاستئناف بالنموذج المحدد. يشير `gemini_setup_required` إلى إعداد مشروع Free Tier ومفتاحه قبل الإنتاج. يرفض الإصدار الحالي طلبات الإنتاج الموجهة إلى ChatGPT.
