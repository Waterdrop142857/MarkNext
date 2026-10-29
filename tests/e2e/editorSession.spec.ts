import { test, expect } from "./fixtures";
import type {} from "./editorSession";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/e2e/editorSession.html");
  await expect(page.locator(".mu-editor")).toBeVisible();
});

test("WYSIWYG captures the last input and preserves both stacks through renderer and component reconstruction", async ({ page }) => {
  await page.locator(".mu-editor").click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText(" pending");
  const before = await page.evaluate(async () => {
    await window.editorSessionFixture.replace("# Changed\n\n- item");
    window.editorSessionFixture.undo();
    return window.editorSessionFixture.state().markdown;
  });
  expect(await page.evaluate(() => window.editorSessionFixture.suspend())).toBe(true);
  await expect(page.locator(".mu-editor")).toHaveCount(0);
  expect(await page.evaluate(() => window.editorSessionFixture.state().oldEvents)).toBe(0);
  expect(await page.evaluate(() => window.editorSessionFixture.state().oldListeners)).toBe(0);
  await page.evaluate(() => window.editorSessionFixture.recreate());
  await expect(page.locator(".mu-editor")).toContainText("pending");
  expect(await page.evaluate(() => window.editorSessionFixture.state().markdown)).toBe(before);
  await page.evaluate(() => window.editorSessionFixture.redo());
  await expect(page.locator(".mu-editor h1")).toContainText("Changed");
  await page.evaluate(() => { window.editorSessionFixture.undo(); window.editorSessionFixture.undo(); });
  await expect(page.locator(".mu-editor")).not.toContainText("pending");
  expect(await page.evaluate(() => window.editorSessionFixture.state().errors)).toEqual([]);
});

test("source history survives suspension and its Muya bridge remains undoable", async ({ page }) => {
  await page.evaluate(() => window.editorSessionFixture.replace("# Before source\n\nBody"));
  expect(await page.evaluate(() => window.editorSessionFixture.toggle())).toBe(true);
  await page.locator(".CodeMirror").click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText(" extra");
  const before = await page.evaluate(() => window.editorSessionFixture.state().markdown);
  expect(await page.evaluate(() => window.editorSessionFixture.suspend())).toBe(true);
  expect(await page.evaluate(() => window.editorSessionFixture.resume())).toBe(true);
  await expect(page.locator(".CodeMirror")).toBeVisible();
  await expect(page.locator(".mu-editor")).toHaveCount(0);
  await page.evaluate(() => window.editorSessionFixture.undo());
  expect(await page.evaluate(() => window.editorSessionFixture.source().getValue())).not.toContain("extra");
  await page.evaluate(() => window.editorSessionFixture.redo());
  expect(await page.evaluate(() => window.editorSessionFixture.source().getValue())).toBe(before);
  await page.evaluate(() => window.editorSessionFixture.toggle());
  await page.evaluate(() => window.editorSessionFixture.undo());
  await expect(page.locator(".mu-editor h1")).toContainText("Before source");
  await expect(page.locator(".mu-editor")).not.toContainText("extra");
  await page.evaluate(() => window.editorSessionFixture.undo());
  await expect(page.locator(".mu-editor h1")).toContainText("Heading");
  expect(await page.evaluate(() => window.editorSessionFixture.state().errors)).toEqual([]);
});

test("source multi-selection and scroll return without importing search highlights or recording restoration", async ({ page }) => {
  await page.evaluate(() => window.editorSessionFixture.replace(Array.from({ length: 150 }, (_, i) => `Line ${i}`).join("\n\n")));
  await page.evaluate(() => window.editorSessionFixture.toggle());
  const before = await page.evaluate(() => {
    const cm = window.editorSessionFixture.source();
    cm.setSelections([{ anchor: { line: 10, ch: 0 }, head: { line: 10, ch: 3 } }, { anchor: { line: 80, ch: 0 }, head: { line: 80, ch: 4 } }], 1);
    cm.scrollTo(0, 900);
    return { selections: cm.listSelections(), head: cm.getCursor("head"), scroll: cm.getScrollInfo().top, history: cm.historySize() };
  });
  await page.evaluate(() => window.editorSessionFixture.suspend());
  await page.evaluate(() => window.editorSessionFixture.recreate());
  await expect(page.locator(".CodeMirror")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.editorSessionFixture.source().getScrollInfo().top)).toBe(before.scroll);
  expect(await page.evaluate(() => {
    const cm = window.editorSessionFixture.source(); return { selections: cm.listSelections(), head: cm.getCursor("head"), history: cm.historySize() };
  })).toEqual({ selections: before.selections, head: before.head, history: before.history });
});

test("WYSIWYG restores the actual scrolling host rather than its contenteditable child", async ({ page }) => {
  await page.evaluate(() => window.editorSessionFixture.replace(Array.from({ length: 100 }, (_, i) => `Paragraph ${i}`).join("\n\n")));
  await page.locator(".muya-editor").evaluate(node => { node.scrollTop = 800; });
  const before = await page.locator(".muya-editor").evaluate(node => node.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => window.editorSessionFixture.suspend());
  await page.evaluate(() => window.editorSessionFixture.resume());
  await expect.poll(() => page.locator(".muya-editor").evaluate(node => node.scrollTop)).toBe(before);
});

test("WYSIWYG restores a text range without adding a history entry", async ({ page }) => {
  await page.locator(".mu-editor p").evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.textContent?.includes("Body")) text = walker.nextNode();
    if (!text) throw new Error("Missing text node");
    const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 3);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("od");
  await page.evaluate(() => window.editorSessionFixture.suspend());
  await page.evaluate(() => window.editorSessionFixture.recreate());
  await expect(page.locator(".mu-editor")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("od");
  expect(await page.evaluate(() => window.editorSessionFixture.state().errors)).toEqual([]);
});

test("composition defers suspension and repeated cycles do not leave old editor roots or listeners", async ({ page }) => {
  await page.locator(".mu-editor").dispatchEvent("compositionstart", { data: "测" });
  await page.evaluate(() => {
    Object.assign(window, { pendingSuspend: window.editorSessionFixture.suspend() });
  });
  await expect(page.locator(".mu-editor")).toBeVisible();
  await page.locator(".mu-editor").dispatchEvent("compositionend", { data: "测" });
  await expect(page.locator(".mu-editor")).toHaveCount(0);
  expect(await page.evaluate(() => window.editorSessionFixture.resume())).toBe(true);
  for (let i = 0; i < 4; i++) {
    expect(await page.evaluate(() => window.editorSessionFixture.suspend())).toBe(true);
    expect(await page.evaluate(() => window.editorSessionFixture.resume())).toBe(true);
    await expect(page.locator(".mu-editor")).toHaveCount(1);
    expect(await page.evaluate(() => window.editorSessionFixture.state().oldEvents)).toBe(0);
  }
  expect(await page.evaluate(() => window.editorSessionFixture.state().errors)).toEqual([]);
});
