import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";
import type {} from "./app";

async function switchLanguage(page: Page, english: boolean) {
  await page.keyboard.press("Control+,");
  await page.getByRole("tab", { name: /^(外观|Appearance)$/, exact: true }).click();
  await page.locator("#settings-language").selectOption(english ? "en" : "zh-CN");
  await page.getByRole("button", { name: /^(应用|Apply)$/, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", english ? "en" : "zh-CN");
}
async function openDocument(page: Page, text = "original") {
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(text => { window.nativeFixture.disk["/old.md"] = text; }, text);
  await page.keyboard.press("Control+O"); await expect(page.locator(".mu-editor")).toBeVisible();
}
const sourceValue = (page: Page) => page.locator(".CodeMirror").evaluate(node =>
  (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue(),
);

test("translates application chrome, search, context menus and shortcut settings; remembers the choice", async ({ page }) => {
  await page.goto("/tests/e2e/app.html"); await expect(page.locator(".empty-state")).toContainText("打开一个 Markdown 文件开始编辑");
  await switchLanguage(page, true);
  await expect(page.locator(".empty-state")).toContainText("Open a Markdown file to start editing");
  await expect(page.locator(".titlebar-path")).toContainText("No File Open");
  await expect(page.locator(".titlebar-window-controls").getByRole("button", { name: "Minimize", exact: true })).toBeVisible();
  await expect(page.locator(".app-footer")).toContainText("Edit with live Markdown rendering");
  await page.getByRole("button", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".menu-dropdown, .menu-overlay")).toHaveCount(0);
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(page.locator("#settings-language")).toHaveValue("en");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await openDocument(page);
  expect(await page.evaluate(() => window.nativeFixture.dialogTitles)).toEqual(["Open File"]);
  await page.keyboard.press("Control+N"); await expect(page.locator(".titlebar-path")).toContainText("Untitled");
  await expect(page.locator(".mu-paragraph-content").first()).toHaveAttribute("empty-hint", "Type / to insert...");
  await page.keyboard.press("Control+H"); await expect(page.getByPlaceholder("Find", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Replace with")).toBeVisible(); await expect(page.getByRole("button", { name: "Replace All", exact: true })).toBeVisible();
  await switchLanguage(page, false); await expect(page.getByPlaceholder("查找", { exact: true })).toBeVisible();
  await switchLanguage(page, true); await page.getByRole("button", { name: "Close Search", exact: true }).click();
  await page.locator(".titlebar-path").click({ button: "right" });
  await expect(page.locator(".fluent-menu")).toContainText("Keyboard Shortcuts...");
  await page.keyboard.press("Escape"); await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog"); await expect(dialog).toContainText("Keyboard Shortcuts");
  await page.getByPlaceholder("Search commands or shortcuts").fill("New File");
  await expect(dialog.locator(".shortcut-row")).toHaveCount(1); await expect(dialog).toContainText("File");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".empty-state")).toContainText("Open a Markdown file");
});

for (const [system, locale] of [["en-GB", "en"], ["zh-TW", "zh-CN"], ["fr-FR", "en"]] as const) {
  test(`first startup detects ${system} with fallback ${locale}`, async ({ page }) => {
    await page.addInitScript(language => {
      localStorage.removeItem("marknext-language-v1");
      Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
    }, system);
    await page.goto("/tests/e2e/app.html"); await expect(page.locator(".empty-state")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.keyboard.press("Control+N");
    await expect(page.locator(".mu-paragraph-content").first()).toHaveAttribute("empty-hint", locale === "en" ? "Type / to insert..." : "输入 / 插入段落");
  });
}

for (const [choice, expected] of [["Cancel", "original edit"], ["Don't Save", ""], ["Save", ""]] as const) {
  test(`English unsaved dialog: ${choice} preserves the document action semantics`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html"); await openDocument(page); await switchLanguage(page, true);
    await page.keyboard.press("Control+Shift+M"); await expect(page.locator(".source-editor")).toBeVisible();
    await page.keyboard.press("Control+End"); await page.keyboard.type(" edit");
    expect(await sourceValue(page)).toBe("original edit");
    await page.evaluate(choice => { window.nativeFixture.choices = [choice]; }, choice);
    await page.keyboard.press("Control+N");
    await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts)).toEqual(["The current file has unsaved changes."]);
    expect(await page.evaluate(() => window.nativeFixture.promptButtons)).toEqual([{ YesNoCancelCustom: ["Save", "Don't Save", "Cancel"] }]);
    if (choice === "Cancel") expect(await sourceValue(page)).toBe(expected);
    else { await expect(page.locator(".titlebar-path")).toContainText("Untitled"); await expect(page.locator(".mu-editor")).toHaveText(""); }
    const writes = await page.evaluate(() => window.nativeFixture.writes);
    expect(writes).toEqual(choice === "Save" ? [{ path: "/old.md", content: "original edit" }] : []);
  });
}

for (const mode of ["wysiwyg", "source"] as const) {
  test(`${mode}: language switches preserve editor identity, content and undo/redo`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html"); await openDocument(page);
    if (mode === "source") { await page.keyboard.press("Control+Shift+M"); await expect(page.locator(".source-editor")).toBeVisible(); }
    const editor = page.locator(mode === "source" ? ".CodeMirror" : ".mu-editor");
    const original = await editor.elementHandle();
    await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" edit");
    await expect(page.locator(".dirty-dot")).toBeVisible();
    await switchLanguage(page, true);
    expect(await original!.evaluate(node => node === document.querySelector(node.classList.contains("CodeMirror") ? ".CodeMirror" : ".mu-editor"))).toBe(true);
    if (mode === "source") { expect(await sourceValue(page)).toBe("original edit"); await expect(page.locator(".app-footer")).toContainText("Source mode"); }
    else await expect(editor).toContainText("original edit");
    await page.keyboard.press("Control+Z");
    if (mode === "source") expect(await sourceValue(page)).toBe("original"); else await expect(editor).toContainText("original");
    await page.keyboard.press("Control+Shift+Z");
    if (mode === "source") expect(await sourceValue(page)).toBe("original edit"); else await expect(editor).toContainText("original edit");
    await switchLanguage(page, false);
    expect(await page.evaluate(() => ({ writes: window.nativeFixture.writes, prompts: window.nativeFixture.prompts }))).toEqual({ writes: [], prompts: [] });
  });
}

test("changing language keeps rendered diagrams and mathematical formulas intact", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await openDocument(page, "```mermaid\nflowchart LR\nA --> B\n```\n\n$$\nx^2\n$$\n\nParagraph");
  const svg = page.locator(".mu-diagram-preview > svg"); await expect(svg).toBeVisible();
  const originalSvg = await svg.elementHandle(); const math = await page.locator(".mu-math-preview .katex").elementHandle();
  const paragraph = await page.locator(".mu-paragraph-content").last().elementHandle();
  await switchLanguage(page, true); await switchLanguage(page, false);
  expect(await originalSvg!.evaluate(node => node === document.querySelector(".mu-diagram-preview > svg"))).toBe(true);
  expect(await math!.evaluate(node => node === document.querySelector(".mu-math-preview .katex"))).toBe(true);
  expect(await paragraph!.evaluate(node => node.isConnected && node.textContent === "Paragraph")).toBe(true);
});
