import { test, expect } from "./fixtures";

for (const language of ["en", "zh-CN"] as const) {
  test(`${language}: PDF settings validate geometry and export a frozen unsaved document`, async ({ page }) => {
    const english = language === "en";
    await page.addInitScript(language => localStorage.setItem("marknext-language-v1", language), language);
    await page.goto("/tests/e2e/app.html");
    const openExport = async () => {
      await page.getByRole("button", { name: english ? "File" : "文件", exact: true }).click();
    };
    await openExport();
    const command = page.getByRole("button", { name: english ? "Export PDF…" : "导出 PDF…", exact: true });
    await expect(command).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+O");
    await expect(page.locator(".mu-editor")).toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    await page.locator(".CodeMirror").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" unsaved");
    await openExport();
    await command.click();
    const dialog = page.getByRole("dialog", { name: english ? "Export PDF…" : "导出 PDF…" });
    await expect(dialog).toBeVisible();
    const avoidBreaks = dialog.getByRole("checkbox", { name: english ? "Avoid awkward page breaks" : "避免破页", exact: true });
    await expect(avoidBreaks).not.toBeChecked();
    await avoidBreaks.check();
    await page.keyboard.press("Control+N");
    await expect(page.locator(".document-tab")).toHaveCount(1);
    const paper = dialog.getByLabel(english ? "Paper size" : "纸张大小");
    await paper.selectOption("b5");
    await dialog.getByLabel(english ? "Orientation" : "方向").selectOption("landscape");
    await expect(dialog).toContainText("250 × 176 mm");
    const top = dialog.getByLabel(english ? "Top" : "上", { exact: true });
    await top.fill("170");
    const submit = dialog.getByRole("button", { name: english ? "Export" : "导出", exact: true });
    await expect(submit).toBeDisabled();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await top.fill("10");
    await paper.selectOption("custom");
    await dialog.getByLabel(english ? "Width (mm)" : "宽度 (mm)", { exact: true }).fill("120");
    await dialog.getByLabel(english ? "Height (mm)" : "高度 (mm)", { exact: true }).fill("180");
    await expect(dialog).toContainText("180 × 120 mm");
    await page.evaluate(async () => {
      window.nativeFixture.savePath = "/export.pdf";
      await window.nativeFixture.deliverFiles(["/new.md"]);
    });
    await expect(page.locator(".document-tab")).toHaveCount(2);
    await submit.click();
    await expect(dialog).toHaveCount(0);
    const requests = await page.evaluate(() => window.nativeFixture.pdfExports);
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("/export.pdf");
    expect(requests[0].payload).toMatchObject({
      markdown: "original unsaved", sourcePath: "/old.md", title: "old.md",
      options: { paper: "custom", width: 120, height: 180, orientation: "landscape", avoidPageBreaks: true, margins: { top: 10, bottom: 20, left: 20, right: 20 } },
    });
    expect(await page.evaluate(() => window.nativeFixture.writes)).toEqual([]);
    expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("original");
  });
}

test("PDF save cancellation and native errors preserve the dialog settings and editor history", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.keyboard.press("Control+O");
  await expect(page.locator(".mu-editor")).toBeVisible();
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("button", { name: "导出 PDF…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出 PDF…" });
  await dialog.getByLabel("纸张大小").selectOption("a5");
  await page.evaluate(() => { window.nativeFixture.cancelSave = true; });
  await dialog.getByRole("button", { name: "导出", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "导出", exact: true })).toBeEnabled();
  await expect(dialog.getByLabel("纸张大小")).toHaveValue("a5");
  expect(await page.evaluate(() => window.nativeFixture.pdfExports)).toEqual([]);
  await page.evaluate(() => { window.nativeFixture.cancelSave = false; window.nativeFixture.pdfError = "Printer unavailable"; });
  await dialog.getByRole("button", { name: "导出", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Printer unavailable");
  await expect(dialog.getByLabel("纸张大小")).toHaveValue("a5");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".mu-editor")).toContainText("original");
});

test("PDF settings remain reachable at 200% zoom in the minimum window", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.addInitScript(() => {
    localStorage.setItem("marknext-settings-v1", JSON.stringify({ version: 1, preferences: {
      language: "en", zoom: 200, editorFont: "system", editorFontSize: 16, codeFont: "monospace", defaultEncoding: "utf-8",
    } }));
    localStorage.setItem("test-open-requests", JSON.stringify([{ id: 1, paths: ["/old.md"] }]));
  });
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".mu-editor")).toBeVisible();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: "Export PDF…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export PDF…" });
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(800);
  expect(box!.y + box!.height).toBeLessThanOrEqual(600);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
