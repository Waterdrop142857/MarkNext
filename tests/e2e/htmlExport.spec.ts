import { test, expect } from "./fixtures";

for (const language of ["en", "zh-CN"] as const) {
  test(`${language}: HTML export captures unsaved content and supports cancellation and retry`, async ({ page }) => {
    const english = language === "en";
    await page.addInitScript(language => localStorage.setItem("marknext-language-v1", language), language);
    await page.goto("/tests/e2e/app.html");
    await page.getByRole("button", { name: english ? "File" : "文件", exact: true }).click();
    const command = page.getByRole("button", { name: english ? "Export HTML…" : "导出 HTML…", exact: true });
    await expect(command).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+O");
    await expect(page.locator(".mu-editor")).toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    await page.locator(".CodeMirror").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" unsaved");
    await page.getByRole("button", { name: english ? "File" : "文件", exact: true }).click();
    await command.click();
    const dialog = page.getByRole("dialog", { name: english ? "Export HTML…" : "导出 HTML…" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input,select")).toHaveCount(0);
    const submit = dialog.getByRole("button", { name: english ? "Export" : "导出", exact: true });
    await page.evaluate(() => { window.nativeFixture.cancelSave = true; });
    await submit.click();
    await expect(submit).toBeEnabled();
    expect(await page.evaluate(() => window.nativeFixture.htmlExports)).toEqual([]);
    await page.evaluate(() => { window.nativeFixture.cancelSave = false; window.nativeFixture.htmlError = "Write denied"; });
    await submit.click();
    await expect(dialog.getByRole("alert")).toContainText("Write denied");
    await page.evaluate(async () => {
      window.nativeFixture.htmlError = null;
      window.nativeFixture.savePath = "/output.HTM";
      await window.nativeFixture.deliverFiles(["/new.md"]);
    });
    await submit.click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.nativeFixture.htmlExports)).toMatchObject([
      { path: "/output.HTM", payload: { markdown: "original unsaved", sourcePath: "/old.md", title: "old.md" } },
    ]);
    expect(await page.evaluate(() => window.nativeFixture.writes)).toEqual([]);
    expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("original");
    await page.locator(".document-tab").first().click();
    await page.locator(".CodeMirror").click();
    await page.keyboard.press("Control+Z");
    await expect(page.locator(".CodeMirror")).not.toContainText("unsaved");
  });
}

test("HTML worker produces a portable document with embedded resources and safe static content", async ({ page }) => {
  await page.goto("/tests/e2e/html-worker.html");
  await expect.poll(() => page.evaluate(() => window.htmlWorker.result || window.htmlWorker.error)).not.toBe("");
  expect(await page.evaluate(() => window.htmlWorker.error)).toBe("");
  const output = await page.evaluate(() => ({ html: window.htmlWorker.result, paths: window.htmlWorker.paths }));
  expect(output.paths).toEqual(["/docs/图片 # %.svg"]);
  expect(output.html).toMatch(/^<!DOCTYPE html>/);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:") return route.continue();
    return route.abort();
  });
  await page.setContent(output.html);
  await expect(page).toHaveTitle("Portable 中文.md");
  await expect(page.locator("h1")).toHaveText("Portable 中文");
  await expect(page.locator(".katex")).toHaveCount(1);
  await expect(page.locator(".mermaid svg")).toBeVisible();
  await expect(page.locator(".token.keyword")).toContainText("const");
  expect(await page.locator("img").getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(await page.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await page.locator("article").evaluate(node => getComputedStyle(node).fontSize)).toBe("18px");
  expect(await page.locator("script,link,base,iframe").count()).toBe(0);
  const fonts = output.html.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  expect(fonts).toHaveLength(20);
  for (const font of fonts) expect(font).toMatch(/src:\s*url\(data:font\/woff2;base64,/);
  expect(output.html).not.toContain("asset://");
  expect(output.html).not.toContain("onclick=");
});


test("HTML worker reports resource failures instead of exporting incomplete content", async ({ page }) => {
  await page.goto("/tests/e2e/html-worker.html?bad-image");
  await expect.poll(() => page.evaluate(() => window.htmlWorker.error)).toContain("Unsupported image");
  expect(await page.evaluate(() => window.htmlWorker.result)).toBe("");
});
