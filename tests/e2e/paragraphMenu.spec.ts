import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type {} from "./app";

async function menu(page: Page, label: string) {
  await page.getByRole("button", { name: "段落", exact: true }).click();
  await page.locator(".menu-dropdown").getByRole("button", { name: label, exact: true }).click();
}
async function saved(page: Page, expected: string) {
  await page.keyboard.press("Control+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe(expected);
}
async function open(page: Page, source: boolean) {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(() => { window.nativeFixture.disk["/old.md"] = "original"; });
  await page.keyboard.press("Control+O");
  await expect(page.locator(".mu-editor")).toBeVisible();
  if (source) {
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".source-editor")).toBeVisible();
  }
  await page.locator(source ? ".CodeMirror" : ".mu-editor").click();
}

test("paragraph menu has three categories, unbound commands, and disables editing without a document", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await page.getByRole("button", { name: "段落", exact: true }).click();
  await expect(page.locator(".menu-group-label")).toHaveText(["标题", "文本格式", "插入"]);
  await expect(page.locator(".menu-command")).toHaveCount(13);
  await expect(page.locator(".menu-command:disabled")).toHaveCount(13);
  await expect(page.locator(".menu-command-shortcut")).toHaveCount(0);
});

test("custom paragraph bindings load from settings and execute the same model command", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("marknext-shortcuts-v1", JSON.stringify({
    version: 1, bindings: { bold: ["Ctrl+Alt+B"] },
  })));
  await open(page, false);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+Alt+B");
  await saved(page, "**original**");
  await page.getByRole("button", { name: "段落", exact: true }).click();
  await expect(page.locator(".menu-dropdown").getByRole("button", { name: "粗体", exact: false })).toContainText("Ctrl+Alt+B");
});

for (const source of [false, true]) {
  test(`paragraph formatting keeps selection and history (${source ? "source" : "wysiwyg"})`, async ({ page }) => {
    await open(page, source);
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Control+B");
    await page.keyboard.press("Control+I");
    await saved(page, "original");
    for (const [label, expected] of [["粗体", "**original**"], ["斜体", "*original*"], ["删除线", "~~original~~"]]) {
      await page.keyboard.press("Control+A");
      await menu(page, label);
      await saved(page, expected);
      await page.keyboard.press("Control+Z");
      await saved(page, "original");
      await page.keyboard.press("Control+Shift+Z");
      await saved(page, expected);
      await page.keyboard.press("Control+Z");
    }
    await menu(page, "二级标题");
    await saved(page, "## original");
    await menu(page, "普通段落");
    await saved(page, "original");
    expect(await page.evaluate(() => window.nativeFixture.errors)).toEqual([]);
  });

  test(`paragraph insertions are model edits and undoable (${source ? "source" : "wysiwyg"})`, async ({ page }) => {
    await open(page, source);
    for (const [label, expected] of [["超链接", "[original]()"], ["图片", "![original]()"]]) {
      await page.keyboard.press("Control+A");
      await menu(page, label);
      await saved(page, expected);
      await page.keyboard.press("Control+Z");
      await saved(page, "original");
    }
    await menu(page, "表格");
    await page.keyboard.press("Control+S");
    await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/old.md"])).toContain("| --- | --- | --- |");
    expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toContain("original");
    await page.keyboard.press("Control+Z");
    await saved(page, "original");
  });
}
