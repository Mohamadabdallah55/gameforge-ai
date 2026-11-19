import { test, expect } from "@playwright/test";
test("Arabic UI imports a profile, uploads and processes an image, exports the library", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "GameForge AI" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ملفات الألعاب" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
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
  await page
    .locator("input[type=file]")
    .setInputFiles({
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
  await page
    .locator("input[type=file]")
    .setInputFiles({
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
