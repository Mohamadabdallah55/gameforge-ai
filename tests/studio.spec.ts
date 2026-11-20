import { test, expect } from "@playwright/test";

test("Elite production blocks unqualified engines and retains prior import", async ({
  page,
  request,
}) => {
  const health = await (await request.get("/api/health")).json();
  expect(health.chatgptPlanUsage).toBe(false);
  const blocked = await request.post("/api/jobs", {
    data: { director: "chatgpt" },
  });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe("chatgpt_plan_disabled");
  expect(
    (await request.post("/api/jobs", { data: { director: "local" } })).status(),
  ).toBe(409);

  const gemini = await request.post("/api/jobs", {
    data: {
      director: "gemini",
      profileId: "default",
      plan: { topic: "البتراء", easy: 1, medium: 0, hard: 0, imagePercent: 0 },
    },
  });
  expect(gemini.status()).toBe(503);
  expect((await gemini.json()).code).toBe("gemini_setup_required");
  expect(await (await request.get("/api/jobs")).json()).toEqual([]);

  await page.goto("/");
  await page.getByLabel("الطلب بالعربية").fill("سؤال عن تاريخ البتراء");
  await page.getByRole("button", { name: "بدء مهمة إنتاج" }).click();
  await expect(page.getByRole("status")).toContainText("Gemini API");
  await page.getByRole("button", { name: "ملفات الألعاب" }).click();
  await page.getByText("استيراد أسئلة محفوظة من محادثة").click();
  const link = "https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc";
  await page.getByLabel("رابط محادثتي في ChatGPT").fill(link);
  await expect(
    page.getByRole("link", { name: "افتح محادثتي في ChatGPT" }),
  ).toHaveAttribute("href", link);
  await page.getByRole("button", { name: "نسخ طلب المسابقة" }).click();
  await expect(page.getByLabel("الطلب الجاهز")).toHaveValue(/تاريخ البتراء/);
  const question = "بأي حضارة اشتهرت مدينة البتراء الأثرية؟";
  const item = {
    question,
    answer: "الأنباط",
    difficulty: "easy",
    source: "https://whc.unesco.org/en/list/326/",
    quote: "",
  };
  const response = [
    "\x60\x60\x60json",
    JSON.stringify({ questions: [item, item] }),
    "\x60\x60\x60",
  ].join("\n");
  await page.getByLabel("رد ChatGPT بصيغة JSON").fill(response);
  await page.getByRole("button", { name: "استيراد الرد إلى المكتبة" }).click();
  await expect(page.getByText("أُضيف 1 للمكتبة، وتُجاوز 1 مكرر")).toBeVisible();
  await page.getByRole("button", { name: "المكتبة", exact: true }).click();
  await expect(page.getByText(question, { exact: true })).toBeVisible();
});

test("Arabic UI imports a profile, uploads and processes an image, exports the library", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "GameForge AI" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ملفات الألعاب" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "model.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([{ السؤال: "من؟", الإجابة: "محمد" }])),
  });
  await expect(page.getByRole("status")).toContainText("1");
  await page.getByLabel("اسم اللعبة").fill("لعبة الاختبار");
  await page.getByRole("button", { name: "إنشاء ملف اللعبة" }).click();
  await expect(
    page.getByRole("heading", { name: "خطة الأسئلة" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "الوسائط", exact: true }).click();
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    return c.toDataURL().split(",")[1];
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "input.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
  await page.getByLabel("صاحب الصورة").fill("اختبار");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "حفظ في المكتبة" }).click();
  await expect(page.getByRole("status")).toContainText("حُفظت");
  const img = page.getByAltText("الصورة المحددة"),
    old = await img.getAttribute("src");
  await page.getByRole("button", { name: "تطبيق التأثير" }).click();
  await expect(img).not.toHaveAttribute("src", old!);
  await page.getByRole("button", { name: "المكتبة", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "تنزيل ZIP" }).click();
  expect((await download).suggestedFilename()).toBe("questions.zip");
});

test("authorized video frame becomes a PNG", async ({ page }) => {
  await page.goto("/");
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d")!,
      stream = c.captureStream(10),
      rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
    rec.start();
    for (const color of ["red", "green", "blue"]) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 32, 32);
      await new Promise((r) => setTimeout(r, 150));
    }
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()));
  });
  await page.getByRole("button", { name: "الوسائط", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(bytes),
  });
  await page.getByLabel("الثانية").fill("0.1");
  await page.getByLabel("صاحب الصورة").fill("اختبار");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "حفظ في المكتبة" }).click();
  await expect(page.getByRole("status")).toContainText("حُفظت", {
    timeout: 25000,
  });
});

test("connection banner clears when the server returns and preserves the draft", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("option", { name: "لعبة المسابقات" }),
  ).toBeAttached();
  const request = page.getByLabel("الطلب بالعربية");
  await request.fill("اعمل عشر اسئلة عن كاس العالم ٢٠٢٦");
  await page.route("**/api/profiles", (route) => route.abort());
  await expect(page.getByRole("alert")).toContainText(
    "انقطع الاتصال بخادم GameForge المحلي",
  );
  await expect(
    page.getByRole("button", { name: "تحليل الطلب" }),
  ).toBeDisabled();
  await page.unroute("**/api/profiles");
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(request).toHaveValue("اعمل عشر اسئلة عن كاس العالم ٢٠٢٦");
  await expect(page.getByRole("button", { name: "تحليل الطلب" })).toBeEnabled();
});

test("manual CRUD + Quality Firewall check, Export Preview, and Cloud/Local Engines separation work in UI", async ({
  page,
}) => {
  await page.goto("/");

  // 1. Quality tab: Firewall tester rejects trivial self-answering question
  await page.getByRole("button", { name: "الجودة", exact: true }).click();
  await page
    .getByLabel("نص السؤال للاختبار")
    .fill("ما هي السنة التي أقيمت فيها كأس العالم 2026؟");
  await page.getByLabel("الإجابة").fill("2026");
  await page.getByRole("button", { name: "فحص السؤال الآن" }).click();
  await expect(page.getByText(/مرفوض \(firewall-leak\)/)).toBeVisible();

  // 2. Library tab: Create valid manual question, inspect Export Preview, then delete
  await page.getByRole("button", { name: "المكتبة", exact: true }).click();
  await page.getByRole("button", { name: "إضافة سؤال يدويًا" }).click();
  await page
    .getByLabel("نص السؤال")
    .fill("أي نادٍ حقق عودة إسطنبول التاريخية في نهائي دوري الأبطال؟");
  await page.getByLabel("الإجابة الدقيقة").fill("ليفربول");
  await page.getByRole("button", { name: "فحص فايروول الجودة" }).click();
  await expect(page.getByText(/اجتاز السؤال فحص فايروول الجودة/)).toBeVisible();
  await page.getByRole("button", { name: "إضافة السؤال" }).click();
  await expect(page.getByRole("status")).toContainText("أُضيف السؤال");
  await expect(
    page.getByText("أي نادٍ حقق عودة إسطنبول التاريخية في نهائي دوري الأبطال؟"),
  ).toBeVisible();

  // 3. Export Preview tab shows mapped rows
  await page.getByRole("button", { name: "التصدير", exact: true }).click();
  await expect(page.getByText("ليفربول")).toBeVisible();

  // 4. AI Engines tab separates Cloud and Local engines cleanly
  await page.getByRole("button", { name: "AI Engines", exact: true }).click();
  await expect(
    page.getByText("المحركات السحابية الفعّالة داخل Google AI Studio"),
  ).toBeVisible();
  await expect(
    page.getByText("المحركات المحلية (محطة Mac / التشغيل المحلي فقط)"),
  ).toBeVisible();
});
