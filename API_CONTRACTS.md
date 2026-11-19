# عقود HTTP

البادئة /api. الأجسام JSON بترميز UTF-8. ملفات الرفع ترسل base64 خامًا بلا بادئة data URI، بحد 12 MB للملف في الواجهة. تعيد العمليات الفاشلة عادةً كائنًا يحوي error. تعيد بعض مسارات العناصر المفقودة نص HTTP 404. يفيد 400 بمدخل أو عملية غير مقبولة، و409 بمحاولة استئناف مهمة غير متوقفة، و502 بفشل مزود. تنتقل أخطاء العامل إلى Job.error.

| الطريقة والمسار | المدخل | المخرج |
|---|---|---|
| GET /health | — | {ok,geminiConfigured}، وجود المفتاح فقط |
| GET /profiles | — | مصفوفة {id,name,rules,mapping} |
| POST /profiles | {name,rules?,mapping?} | 201 الملف المحفوظ |
| POST /interpret | {request} | Plan |
| GET /search | kind=facts أو images وq | Evidence[] أو {title,url,origin,credit,license}[] |
| POST /jobs | {profileId,plan} | 202 Job، ثم معالجة خلفية |
| GET /jobs | — | Job[] لكل الألعاب |
| POST /jobs/:id/retry | {} | 202 Job |
| GET /questions | profileId | Question[] |
| POST /questions/:id/image | {profileId,assetId}، يقبل null | السؤال بعد تعديل صورته |
| GET /assets | — | Asset[] تشمل المعرّف والمصدر والنسبة والترخيص |
| GET /assets/:id | — | image/png |
| POST /assets | {data,rights:true,credit,origin?} | 201 Asset |
| POST /assets/transform | {assetId,style} | 201 Asset جديد. القيم original وbw وsketch وsilhouette وcartoon |
| POST /assets/generate | {prompt,assetId?} | 201 Asset. وجود assetId يرسل الصورة مع أمر التعديل |
| POST /templates/infer | {format,data} بصيغة json أو csv أو xlsx | {columns:[{name,type}],mapping,rows} |
| GET /export/:format | profileId، والصيغة json أو csv أو xlsx أو zip | ملف قابل للتنزيل |

## إنشاء مهمة

```json
{"profileId":"default","plan":{"topic":"كأس العالم 2022","easy":3,"medium":2,"hard":1,"imagePercent":50}}
```

تقبل الخطة 0 إلى 100 لكل مستوى وبمجموع موجب، ونسبة صحيحة من 0 إلى 100. يتضمن Job حقول id وprofileId وplan وdone وstatus وerror. يشير done إلى عدد الأسئلة المحفوظة. تعيد المكتبة question وanswer وdifficulty وsource وquote وimage إضافة إلى id وprofileId. قيمة image هي معرّف أو null.

## حقول التصدير

يربط mapping المفاتيح question وanswer وdifficulty وimage وsource بأسماء الحقول في لعبة الوجهة. تبقى المفاتيح غير المخصصة بأسمائها الافتراضية. قيم الصعوبة easy وmedium وhard. في ZIP يوجد questions.json وcredits.json وevidence.json وimages/<id>.png للصور المستخدمة. يسبق المصدّر قيم CSV التي يمكن تفسيرها كصيغة بعلامة اقتباس مفردة. أنواع TypeScript والتحقق من الخطة والملف في shared/contracts.ts.
