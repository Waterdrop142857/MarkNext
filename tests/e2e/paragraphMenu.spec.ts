import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";
import type {} from "./app";

async function menu(page: Page, label: string) {
  await page.getByRole("button", { name: "段落", exact: true }).click();
  await page.locator(".menu-dropdown").getByRole("button", { name: label, exact: true }).click();
}
async function saved(page: Page, expected: string) {
  await page.keyboard.press("Control+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe(expected);
}
async function open(page: Page, source: boolean, content = "original") {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(content => { window.nativeFixture.disk["/old.md"] = content; }, content);
  await page.keyboard.press("Control+O");
  await expect(page.locator(".mu-editor")).toBeVisible();
  if (source) {
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".source-editor")).toBeVisible();
  }
  await page.locator(source ? ".CodeMirror" : ".mu-editor").click();
}

const sourceValue = (page: Page) => page.locator(".CodeMirror").evaluate(node =>
  (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue());

for (const underline of ["-----", "====="]) {
  test(`source Setext conversion keeps content and undo history (${underline})`, async ({ page }) => {
    await open(page, true, `Title\n${underline}\n`);
    await page.keyboard.press("Control+Home");
    await menu(page, "普通段落");
    await expect.poll(() => sourceValue(page)).toBe("Title\n");
    await saved(page, "Title");
    await page.keyboard.press("Control+Z");
    await expect.poll(() => sourceValue(page)).toBe(`Title\n${underline}\n`);
    await page.keyboard.press("Control+Home");
    await menu(page, "三级标题");
    await saved(page, "### Title");
    await page.keyboard.press("Control+Z");
    await expect.poll(() => sourceValue(page)).toBe(`Title\n${underline}\n`);
    await page.keyboard.press("Control+Shift+Z");
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".mu-editor h3")).toContainText("Title");
    await expect(page.locator(".mu-editor hr")).toHaveCount(0);
  });
}

test("source link labels escape brackets and render the selected text", async ({ page }) => {
  await open(page, true, "a]b");
  await page.keyboard.press("Control+A");
  await menu(page, "超链接");
  await expect.poll(() => sourceValue(page)).toBe("[a\\]b]()");
  await page.keyboard.type("https://example.test/note");
  await saved(page, "[a\\]b](https://example.test/note)");
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await expect.poll(() => sourceValue(page)).toBe("a]b");
  await page.keyboard.press("Control+Shift+Z");
  await page.keyboard.press("Control+Shift+Z");
  await page.keyboard.press("Control+Shift+M");
  const link = page.locator(".mu-editor .mu-link");
  await expect.poll(() => link.evaluate(element => {
    // Zero-size source markers remain in textContent and innerText.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let visible = "";
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) {
        visible += walker.currentNode.textContent;
      }
    }
    return visible;
  })).toBe("a]b");
  await expect(link).toHaveAttribute("href", "https://example.test/note");
});

test("hidden source defers document replacement until it is activated", async ({ page }) => {
  await open(page, true);
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" source");
  await page.keyboard.press("Control+Shift+M");
  await expect(page.locator(".mu-editor")).toBeVisible();
  await page.locator(".CodeMirror").evaluate(node => {
    const cm = (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
    const original = cm.setValue.bind(cm);
    (node as HTMLElement).dataset.replacements = "0";
    cm.setValue = value => {
      const element = node as HTMLElement;
      element.dataset.replacements = String(Number(element.dataset.replacements) + 1);
      original(value);
    };
  });
  await page.locator(".mu-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" updated", { delay: 30 });
  await saved(page, "original source updated");
  const latest = await page.evaluate(() => window.nativeFixture.disk["/old.md"]);
  await expect(page.locator(".CodeMirror")).toHaveAttribute("data-replacements", "0");
  await page.keyboard.press("Control+Shift+M");
  await expect.poll(() => sourceValue(page)).toBe(latest);
  await expect(page.locator(".CodeMirror")).toHaveAttribute("data-replacements", "1");
  await page.keyboard.press("Control+Z");
  await expect.poll(() => sourceValue(page)).toBe(latest);
});

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
