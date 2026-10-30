import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";
import type {} from "./app";

async function open(page: Page, path: string, content?: string) {
  await page.evaluate(({ path, content }) => {
    window.nativeFixture.openPath = path;
    if (content !== undefined) window.nativeFixture.disk[path] = content;
  }, { path, content });
  await page.keyboard.press("Control+O");
  const canonical = await page.evaluate(path => window.nativeFixture.pathAliases[path] ?? path, path);
  await expect(page.getByRole("tab", { selected: true })).toContainText(canonical.split("/").pop()!);
  await expect(page.locator('.document-tabs[aria-busy="true"]')).toHaveCount(0);
}
async function sourceText(page: Page) {
  return page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue());
}
test.beforeEach(async ({ page }) => { await page.goto("/tests/e2e/app.html"); await expect(page.locator(".empty-state")).toBeVisible(); });

test("new and open retain dirty tabs and each WYSIWYG undo stack while keeping only one renderer", async ({ page }) => {
  await open(page, "/one.md", "# One\n\nBody\n");
  await page.locator(".mu-editor").click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText(" first edit");
  await expect(page.locator(".tab-dirty")).toHaveCount(1);
  const old = await page.locator(".mu-editor").elementHandle();
  await open(page, "/two.md", "# Two\n\nSecond");
  expect(await old!.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.locator(".mu-editor")).toHaveCount(1); await expect(page.getByRole("tab")).toHaveCount(2);
  await page.keyboard.press("Control+N");
  await expect(page.getByRole("tab")).toHaveCount(3); await expect(page.locator(".mu-editor")).not.toContainText("Second");
  await page.keyboard.press("Control+Shift+Tab"); await expect(page.getByRole("tab", { selected: true })).toContainText("two.md");
  await page.keyboard.press("Control+Shift+Tab"); await expect(page.getByRole("tab", { selected: true })).toContainText("one.md");
  await expect(page.locator(".mu-editor")).toContainText("first edit");
  await page.keyboard.press("Control+Z"); await expect(page.locator(".mu-editor")).not.toContainText("first edit");
  await expect(page.locator(".tab-dirty")).toHaveCount(0);
  expect(await page.evaluate(() => window.nativeFixture.prompts)).toEqual([]);
});

test("source tabs retain mode, history, cursor and scroll with a preserved Muya bridge", async ({ page }) => {
  const text = `# Original\n\n${Array.from({ length: 150 }, (_, i) => `Paragraph ${i}`).join("\n\n")}`;
  await open(page, "/one.md", text);
  await page.keyboard.press("Control+Shift+M");
  await page.locator(".CodeMirror").click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText(" source edit");
  const before = await page.locator(".CodeMirror").evaluate(node => {
    const cm = (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
    cm.scrollTo(0, 900); return { value: cm.getValue(), cursor: cm.getCursor(), scroll: cm.getScrollInfo().top };
  });
  await open(page, "/two.md", "Other");
  await expect(page.locator(".CodeMirror")).toHaveCount(0);
  await page.getByRole("tab", { name: /one.md/ }).click();
  await expect(page.locator(".CodeMirror")).toBeVisible();
  await expect(page.locator(".mu-editor")).toHaveCount(0);
  expect(await sourceText(page)).toBe(before.value);
  expect(await page.locator(".CodeMirror").evaluate(node => {
    const cm = (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror; return { cursor: cm.getCursor(), scroll: cm.getScrollInfo().top };
  })).toEqual({ cursor: before.cursor, scroll: before.scroll });
  await page.keyboard.press("Control+Z"); expect(await sourceText(page)).not.toContain("source edit");
  await page.keyboard.press("Control+Y"); expect(await sourceText(page)).toBe(before.value);
  await page.keyboard.press("Control+Shift+M"); await page.keyboard.press("Control+Z");
  await expect(page.locator(".mu-editor")).not.toContainText("source edit");
});

test("search and replace remain available after a source-only tab is restored", async ({ page }) => {
  await open(page, "/one.md", "foo bar foo");
  await page.keyboard.press("Control+Shift+M");
  await expect(page.locator(".CodeMirror")).toBeVisible();
  await open(page, "/two.md", "other");
  await page.getByRole("tab", { name: /one.md/ }).click();
  await expect(page.locator(".CodeMirror")).toBeVisible();
  await expect(page.locator(".mu-editor")).toHaveCount(0);
  await page.keyboard.press("Control+H");
  await page.getByPlaceholder("查找").fill("foo");
  await page.getByPlaceholder("替换为").fill("X");
  const replaceAll = page.getByRole("button", { name: "全部替换", exact: true });
  await expect(replaceAll).toBeEnabled();
  await replaceAll.click();
  expect(await sourceText(page)).toBe("X bar X");
  await page.keyboard.press("Control+Z");
  expect(await sourceText(page)).toBe("foo bar foo");
});

test("multiple selection and canonical aliases focus existing tabs without duplicate reads", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.nativeFixture;
    f.pathAliases["/alias.md"] = "/old.md"; f.openPath = ["/old.md", "/alias.md", "/new.md"];
  });
  await page.keyboard.press("Control+O"); await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText("new.md");
  expect(await page.evaluate(() => window.nativeFixture.reads)).toEqual(["/old.md", "/new.md"]);
  await open(page, "/alias.md"); await expect(page.getByRole("tab", { selected: true })).toContainText("old.md");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("Save As cannot overwrite another open tab and Save All writes each document", async ({ page }) => {
  await open(page, "/one.md", "first"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("edit ");
  await open(page, "/two.md", "second"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("more ");
  await page.evaluate(() => { window.nativeFixture.savePath = "/one.md"; }); await page.keyboard.press("Control+Shift+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.notifications.length)).toBe(1);
  expect(await page.evaluate(() => window.nativeFixture.disk["/one.md"])).toBe("first");
  await page.keyboard.press("Control+Alt+S");
  await expect(page.locator(".tab-dirty")).toHaveCount(0);
  const writes = await page.evaluate(() => window.nativeFixture.writes);
  expect(writes.map(write => write.path)).toEqual(["/one.md", "/two.md"]);
  expect(writes[0].content).toContain("edit"); expect(writes[1].content).toContain("more");
});

test("closing a background dirty tab uses a named prompt and leaves other files intact", async ({ page }) => {
  await open(page, "/one.md", "first"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("edit ");
  await open(page, "/two.md", "second");
  await page.evaluate(() => window.nativeFixture.choices.push("Cancel"));
  await page.getByRole("button", { name: "关闭 one.md", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts.length)).toBe(1);
  expect(await page.evaluate(() => window.nativeFixture.prompts[0])).toContain("one.md");
  await expect(page.locator(".mu-editor")).toContainText("edit");
  await page.evaluate(() => window.nativeFixture.choices.push("No")); await page.keyboard.press("Control+W");
  await expect(page.getByRole("tab")).toHaveCount(1); await expect(page.locator(".mu-editor")).toContainText("second");
  await page.keyboard.press("Control+W"); await expect(page.locator(".empty-state")).toBeVisible();
});

test("exit cancellation after an earlier discard keeps every tab and backup", async ({ page }) => {
  await open(page, "/one.md", "first"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("edit ");
  await open(page, "/two.md", "second"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("more ");
  await expect.poll(() => page.evaluate(() => Object.values(window.nativeFixture.recovery).length)).toBe(2);
  await page.evaluate(() => window.nativeFixture.choices.push("No", "Cancel")); await page.keyboard.press("Control+Q");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts.length)).toBe(2);
  expect(await page.evaluate(() => window.nativeFixture.destroyed)).toBe(false);
  await expect(page.getByRole("tab")).toHaveCount(2); await expect(page.locator(".tab-dirty")).toHaveCount(2);
  expect(await page.evaluate(() => Object.values(window.nativeFixture.recovery).length)).toBe(2);
  await page.evaluate(() => window.nativeFixture.choices.push("No", "No")); await page.keyboard.press("Control+Q");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.destroyed)).toBe(true);
  expect(await page.evaluate(() => Object.values(window.nativeFixture.recovery))).toEqual([]);
});

test("tab keyboard navigation and many long file names scroll inside the strip without moving chrome", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.nativeFixture;
    const paths = Array.from({ length: 12 }, (_, index) => `/folder-${index}/long-file-name-${index}.md`);
    paths.forEach(path => { f.disk[path] = "file"; }); f.openPath = paths;
  });
  await page.keyboard.press("Control+O"); await expect(page.getByRole("tab")).toHaveCount(12);
  await expect(page.locator('.document-tabs[aria-busy="true"]')).toHaveCount(0);
  await page.setViewportSize({ width: 800, height: 600 });
  const title = await page.locator(".app-titlebar").boundingBox(), footer = await page.locator(".app-footer").boundingBox();
  expect(await page.locator(".document-tab-list").evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.getByRole("tab", { selected: true }).focus(); await page.keyboard.press("Home");
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab").first()).toBeFocused();
  await page.keyboard.press("ArrowRight"); await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  expect(await page.locator(".app-titlebar").boundingBox()).toEqual(title); expect(await page.locator(".app-footer").boundingBox()).toEqual(footer);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
});

test("tab context menu and middle click close their target rather than the active file", async ({ page }) => {
  await open(page, "/one.md", "first");
  await open(page, "/two.md", "second");
  await open(page, "/three.md", "third");
  await page.getByRole("tab", { name: /one.md/ }).click({ button: "right" });
  await page.locator(".fluent-menu").getByRole("button", { name: /^关闭\s/ }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText("three.md");
  await page.getByRole("tab", { name: /two.md/ }).click({ button: "middle" });
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".mu-editor")).toContainText("third");
});

test("background external changes prompt only when activated and do not replace unsaved edits", async ({ page }) => {
  await open(page, "/one.md", "first"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("edit ");
  await open(page, "/two.md", "second");
  await page.evaluate(() => { window.nativeFixture.disk["/one.md"] = "external"; window.dispatchEvent(new Event("focus")); });
  await expect(page.locator(".tab-conflict")).toHaveCount(1);
  expect(await page.evaluate(() => window.nativeFixture.prompts)).toEqual([]);
  await page.evaluate(() => window.nativeFixture.choices.push("Cancel"));
  await page.getByRole("tab", { name: /one.md/ }).click();
  await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts.length)).toBe(1);
  await expect(page.locator(".mu-editor")).toContainText("edit");
  await expect(page.locator(".mu-editor")).not.toContainText("external");
});

test("multiple crashed drafts recover to independent tabs without replacing earlier recoveries", async ({ page }) => {
  await open(page, "/one.md", "first"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("draft-one ");
  await open(page, "/two.md", "second"); await page.locator(".mu-editor").click(); await page.keyboard.insertText("draft-two ");
  await expect.poll(() => page.evaluate(() => Object.values(window.nativeFixture.recovery).length)).toBe(2);
  await page.evaluate(() => localStorage.setItem("test-disk", JSON.stringify(window.nativeFixture.disk)));
  await page.reload();
  for (const name of ["one.md", "two.md"]) {
    await page.getByRole("button", { name: "查看恢复记录", exact: true }).click();
    await page.locator(".recovery-body li").filter({ hasText: name }).getByRole("button", { name: "恢复", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".tab-dirty")).toHaveCount(2);
  await expect(page.locator(".mu-editor")).toContainText("draft-two");
  await page.getByRole("tab", { name: /one.md/ }).click();
  await expect(page.locator(".mu-editor")).toContainText("draft-one");
  expect(await page.evaluate(() => window.nativeFixture.prompts)).toEqual([]);
});
