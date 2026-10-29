import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";
import type {} from "./app";

async function openDocument(page: Page, content: string) {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(content => { window.nativeFixture.disk["/old.md"] = content; }, content);
  await page.keyboard.press("Control+O");
  await expect(page.locator(".mu-editor")).toBeVisible();
}
async function showOutline(page: Page) {
  await page.locator("#outline-toggle").click();
  await expect(page.locator(".document-outline")).toBeVisible();
}
async function sourceValue(page: Page) {
  return page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue());
}

test("statistics count readable Chinese and English text and reset on a new file", async ({ page }) => {
  await openDocument(page, "# **Hello**\n\n你好 [world](https://example.com/ignored)");
  await expect(page.locator(".word-count")).toHaveText("字数：4");
  await expect(page.locator(".character-count")).toHaveText("字符：12");
  await showOutline(page); await expect(page.locator(".outline-label")).toHaveText(["Hello"]);
  await page.keyboard.press("Control+N");
  await expect(page.locator(".outline-empty")).toBeVisible();
  await expect(page.locator(".word-count")).toHaveText("字数：0");
  await expect(page.locator(".character-count")).toHaveText("字符：0");
});

test("source outline updates live, ignores code headings and jumps to the correct duplicate", async ({ page }) => {
  await openDocument(page, "# Initial"); await page.keyboard.press("Control+Shift+M"); await showOutline(page);
  const text = "# First\n\n## Same\n\n```md\n# Not a heading\n```\n\n### Third\n\n#### Four\n\n##### Five\n\n###### Six\n\nSetext\n======\n\n## Same";
  await page.locator(".CodeMirror").click(); await page.keyboard.press("Control+A"); await page.keyboard.insertText(text);
  await expect(page.locator(".outline-label")).toHaveText(["First", "Same", "Third", "Four", "Five", "Six", "Setext", "Same"]);
  const headingButtons = page.locator(".outline-heading");
  expect(await headingButtons.nth(2).evaluate(node => parseFloat(getComputedStyle(node).paddingLeft))).toBeGreaterThan(await headingButtons.nth(0).evaluate(node => parseFloat(getComputedStyle(node).paddingLeft)));
  await headingButtons.last().click();
  const line = await page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getCursor().line);
  expect(line).toBe(text.slice(0, text.lastIndexOf("## Same")).split("\n").length - 1);
  expect(await sourceValue(page)).toBe(text);
  await page.keyboard.press("Control+Z");
  await expect(page.locator(".outline-label")).toHaveText(["Initial"]);
});

test("WYSIWYG outline navigation scrolls to the heading without replacing the editor or content", async ({ page }) => {
  await openDocument(page, `# Start\n\n${"Paragraph content.\n\n".repeat(100)}## Destination\n\nEnd.`);
  await page.locator(".mu-editor").evaluate(node => { Reflect.set(node, "outlineIdentity", true); });
  await showOutline(page);
  await page.getByRole("button", { name: "2 级标题：Destination", exact: true }).click();
  const target = page.locator(".mu-editor h2");
  const box = await target.boundingBox(); const viewport = await page.locator(".muya-editor").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
  expect(await page.locator(".mu-editor").evaluate(node => Reflect.get(node, "outlineIdentity"))).toBe(true);
  expect(await page.evaluate(() => window.nativeFixture.writes)).toEqual([]);
  await expect(page.locator(".dirty-dot")).toBeHidden();
  await page.keyboard.insertText("Edited ");
  await expect(page.locator(".outline-label").last()).toHaveText("Edited Destination");
  await page.keyboard.press("Control+Z"); await expect(page.locator(".outline-label").last()).toHaveText("Destination");
});

for (const mode of ["wysiwyg", "source"]) {
  test(`${mode}: toggling the outline preserves editor identity and undo`, async ({ page }) => {
    await openDocument(page, "# Heading\n\nBody");
    if (mode === "source") await page.keyboard.press("Control+Shift+M");
    const editor = page.locator(mode === "source" ? ".CodeMirror" : ".mu-editor");
    await editor.evaluate(node => { Reflect.set(node, "outlineIdentity", true); });
    await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText(" extra");
    await expect(page.locator(".word-count")).toHaveText("字数：3");
    await showOutline(page); await page.locator(".outline-header button").click();
    await expect(page.locator("#outline-toggle")).toBeFocused();
    expect(await editor.evaluate(node => Reflect.get(node, "outlineIdentity"))).toBe(true);
    await editor.click(); await page.keyboard.press("Control+Z");
    await expect(page.locator(".word-count")).toHaveText("字数：2");
  });
}

test("language and mode switches keep the same counts, heading nodes and editor", async ({ page }) => {
  await openDocument(page, "# Hello\n\n你好 world"); await showOutline(page);
  await page.locator(".mu-editor").evaluate(node => { Reflect.set(node, "outlineIdentity", true); });
  await page.keyboard.press("Control+Shift+M"); await expect(page.locator(".word-count")).toHaveText("字数：4");
  await page.keyboard.press("Control+Shift+M");
  await page.keyboard.press("Control+,"); await page.locator("#settings-tab-appearance").click();
  await page.locator("#settings-language").selectOption("en"); await page.locator(".settings-apply").click();
  await expect(page.locator(".document-outline h2")).toHaveText("Document Outline");
  await expect(page.locator(".word-count")).toHaveText("Words: 4");
  await expect(page.locator(".character-count")).toHaveText("Characters: 12");
  expect(await page.locator(".mu-editor").evaluate(node => Reflect.get(node, "outlineIdentity"))).toBe(true);
  await page.locator(".outline-heading").focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".mu-editor")).toBeFocused();
});

test("outline scroll stays inside the sidebar and chrome remains fixed at high zoom", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("marknext-settings-v1", JSON.stringify({ version: 1, preferences: {
    language: "zh-CN", zoom: 200, editorFont: "system", editorFontSize: 16, codeFont: "monospace", defaultEncoding: "utf-8",
  } })));
  await openDocument(page, Array.from({ length: 50 }, (_, index) => `## Heading ${index}`).join("\n\n"));
  await page.setViewportSize({ width: 800, height: 600 }); await showOutline(page);
  const header = await page.locator(".app-titlebar").boundingBox(), footer = await page.locator(".app-footer").boundingBox();
  await page.locator(".outline-content").evaluate(node => { node.scrollTop = node.scrollHeight; });
  expect(await page.locator(".outline-content").evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".app-titlebar").boundingBox()).toEqual(header);
  expect(await page.locator(".app-footer").boundingBox()).toEqual(footer);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
});
