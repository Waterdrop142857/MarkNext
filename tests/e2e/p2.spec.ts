import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";
import type {} from "./app";

async function open(page: Page, content = "foo bar foo", path = "/old.md") {
  await page.evaluate(({ content, path }) => { window.nativeFixture.openPath = path; window.nativeFixture.disk[path] = content; }, { content, path });
  await page.keyboard.press("Control+O"); await expect(page.locator(".mu-editor")).toBeVisible();
}
async function sourceValue(page: Page) { return page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue()); }
async function sourceMode(page: Page) { await page.keyboard.press("Control+Shift+M"); await expect(page.locator(".source-editor")).toBeVisible(); }
async function replacePanel(page: Page) { await page.keyboard.press("Control+H"); await expect(page.getByPlaceholder("查找")).toBeVisible(); }
test.beforeEach(async ({ page }) => { await page.goto("/tests/e2e/app.html"); await expect(page.locator(".empty-state")).toBeVisible(); });

for (const mode of ["wysiwyg", "source"]) {
  test(`${mode}: a replacement containing the query still advances to the next match`, async ({ page }) => {
    await open(page); if (mode === "source") await sourceMode(page);
    await replacePanel(page); await page.getByPlaceholder("查找").fill("foo"); await page.getByPlaceholder("替换为").fill("fooX");
    await page.getByRole("button", { name: "替换", exact: true }).click();
    await page.getByRole("button", { name: "替换", exact: true }).click();
    if (mode === "source") expect(await sourceValue(page)).toBe("fooX bar fooX"); else await expect(page.locator(".mu-editor")).toContainText("fooX bar fooX");
  });
  test(`${mode}: empty query cannot replace stale matches; file changes refresh search`, async ({ page }) => {
    await open(page); if (mode === "source") await sourceMode(page);
    await replacePanel(page); await page.getByPlaceholder("查找").fill("foo"); await page.getByPlaceholder("替换为").fill("X");
    await page.getByPlaceholder("查找").fill(""); await expect(page.getByRole("button", { name: "全部替换", exact: true })).toBeDisabled();
    if (mode === "source") expect(await sourceValue(page)).toBe("foo bar foo"); else await expect(page.locator(".mu-editor")).toContainText("foo bar foo");
    await page.getByPlaceholder("查找").fill("FOO");
    await open(page, "new foo content", "/new.md");
    await page.keyboard.press("F3"); await page.getByRole("button", { name: "全部替换", exact: true }).click();
    await expect(page.locator(".mu-editor")).toContainText("new X content");
  });
  test(`${mode}: edits before search matches do not leave stale replacement offsets`, async ({ page }) => {
    await open(page); if (mode === "source") await sourceMode(page);
    await replacePanel(page); await page.getByPlaceholder("查找").fill("foo"); await page.getByPlaceholder("替换为").fill("X");
    await page.locator(mode === "source" ? ".CodeMirror" : ".mu-editor").click();
    await page.keyboard.press("Control+Home"); await page.keyboard.type("prefix ");
    await page.getByRole("button", { name: "全部替换", exact: true }).click();
    if (mode === "source") expect(await sourceValue(page)).toBe("prefix X bar X"); else await expect(page.locator(".mu-editor")).toContainText("prefix X bar X");
  });
}

test("saving with search open does not rerun an unchanged search", async ({ page }) => {
  await open(page); await replacePanel(page);
  await page.getByPlaceholder("查找").fill("foo");
  await page.evaluate(async () => {
    const modulePath = "/src/muya/index.ts";
    const { Muya } = await import(/* @vite-ignore */ modulePath);
    const original = Muya.prototype.search;
    const counters = window as Window & { searchCalls?: number };
    counters.searchCalls = 0;
    Muya.prototype.search = function (...args: unknown[]) {
      counters.searchCalls = (counters.searchCalls ?? 0) + 1;
      return original.apply(this, args);
    };
  });
  await page.keyboard.press("Control+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.writes.length)).toBe(1);
  await expect(page.locator('.document-tabs[aria-busy="true"]')).toHaveCount(0);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (window as Window & { searchCalls?: number }).searchCalls ?? 0)).toBe(0);
  await page.getByPlaceholder("查找").fill("bar");
  await expect.poll(() => page.evaluate(() => (window as Window & { searchCalls?: number }).searchCalls ?? 0)).toBeGreaterThan(0);
});

test("closing search during composition clears highlights when the editor is available", async ({ page }) => {
  await open(page); await replacePanel(page);
  await page.getByPlaceholder("查找").fill("foo");
  await page.evaluate(async () => {
    const modulePath = "/src/muya/index.ts";
    const { Muya } = await import(/* @vite-ignore */ modulePath);
    const original = Muya.prototype.search;
    const state = window as Window & { clearedSearch?: number };
    state.clearedSearch = 0;
    Muya.prototype.search = function (...args: unknown[]) {
      if (args[0] === "") state.clearedSearch = (state.clearedSearch ?? 0) + 1;
      return original.apply(this, args);
    };
  });
  await page.locator(".mu-editor").dispatchEvent("compositionstart", { data: "测" });
  await expect(page.getByRole("button", { name: "全部替换", exact: true })).toBeDisabled();
  await page.locator(".search-close").click();
  await page.locator(".mu-editor").dispatchEvent("compositionend", { data: "测" });
  await expect.poll(() => page.evaluate(() => (window as Window & { clearedSearch?: number }).clearedSearch ?? 0)).toBe(1);
});

test("closing a document clears its search context", async ({ page }) => {
  await open(page); await replacePanel(page); await page.getByPlaceholder("查找").fill("foo"); await page.getByPlaceholder("替换为").fill("X");
  await page.keyboard.press("Control+W"); await expect(page.locator(".empty-state")).toBeVisible();
  await expect(page.getByRole("button", { name: "全部替换", exact: true })).toBeDisabled();
  await page.keyboard.press("F3"); await open(page, "new foo", "/new.md");
  await page.getByRole("button", { name: "全部替换", exact: true }).click(); await expect(page.locator(".mu-editor")).toContainText("new X");
});

test("source replacement protects unrelated selection and advances after a valid match", async ({ page }) => {
  await open(page); await sourceMode(page); await replacePanel(page);
  await page.getByPlaceholder("查找").fill("foo"); await page.getByPlaceholder("替换为").fill("X");
  await page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 7 }));
  await page.getByRole("button", { name: "替换", exact: true }).click(); expect(await sourceValue(page)).toBe("foo bar foo");
  await page.getByPlaceholder("查找").fill("FOO");
  await page.getByRole("button", { name: "替换", exact: true }).click(); expect(await sourceValue(page)).toBe("X bar foo");
  expect(await page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getSelection())).toBe("foo");
});

for (const zoom of [100, 200]) {
  test(`${zoom}% zoom: search navigation and close share one row and remain independently clickable`, async ({ page }) => {
    await open(page); await sourceMode(page);
    await page.keyboard.press("Control+,");
    await page.getByRole("tab", { name: "外观", exact: true }).click();
    await page.locator("#settings-zoom").fill(String(zoom));
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.setViewportSize({ width: 640, height: 480 });
    const matchStart = () => page.locator(".CodeMirror").evaluate(node =>
      (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getCursor("from").ch,
    );
    for (const shortcut of ["Control+f", "Control+h"]) {
      await page.keyboard.press(shortcut);
      await page.getByPlaceholder("查找", { exact: true }).fill("foo");
      const controls = page.locator('.search-panel input[placeholder="查找"], .search-panel button[title], .search-close');
      await expect(controls).toHaveCount(4);
      const bounds = await controls.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, centerY: rect.top + rect.height / 2 };
      }));
      for (let index = 0; index < bounds.length; index++) {
        expect(bounds[index]!.left).toBeGreaterThanOrEqual(0);
        expect(bounds[index]!.right).toBeLessThanOrEqual(640);
        expect(Math.abs(bounds[index]!.centerY - bounds[0]!.centerY)).toBeLessThan(1);
        if (index) expect(bounds[index]!.left).toBeGreaterThan(bounds[index - 1]!.right);
      }
      await page.getByTitle("下一个", { exact: true }).click();
      await expect.poll(matchStart).toBe(8);
      await expect(page.locator(".search-panel")).toBeVisible();
      await page.getByTitle("上一个", { exact: true }).click();
      await expect.poll(matchStart).toBe(0);
      await page.locator(".search-close").click();
      await expect(page.locator(".search-panel")).toBeHidden();
    }
  });
}

test("source undo history survives mode toggles, but cannot affect another document", async ({ page }) => {
  await open(page, "original"); await sourceMode(page); const original = await page.locator(".CodeMirror").elementHandle();
  await page.keyboard.press("Control+End"); await page.keyboard.type(" edit"); expect(await sourceValue(page)).toBe("original edit");
  await page.keyboard.press("Control+Shift+M"); await expect(page.locator(".source-editor")).toBeHidden();
  await sourceMode(page); expect(await original!.evaluate(node => node === document.querySelector(".CodeMirror"))).toBe(true);
  await page.keyboard.press("Control+Z"); expect(await sourceValue(page)).toBe("original");
  await page.keyboard.press("Control+Shift+Z"); expect(await sourceValue(page)).toBe("original edit");
  await page.evaluate(() => { window.nativeFixture.choices = ["不保存"]; }); await open(page, "another document", "/new.md"); await sourceMode(page);
  await page.keyboard.press("Control+Z"); expect(await sourceValue(page)).toBe("another document");
});

test("WYSIWYG edits invalidate incompatible source history", async ({ page }) => {
  await open(page, "original"); await sourceMode(page); await page.keyboard.press("Control+End"); await page.keyboard.type(" source");
  await page.keyboard.press("Control+Shift+M"); await page.locator(".mu-editor").click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" visual");
  await sourceMode(page); const before = await sourceValue(page); expect(before).toContain("visual");
  await page.keyboard.press("Control+Z"); expect(await sourceValue(page)).toBe(before);
});

test("local inline, reference and HTML images update their document context after save-as", async ({ page }) => {
  const imageRequests: string[] = [];
  page.on("request", request => { const path = new URL(request.url()).searchParams.get("path"); if (path) imageRequests.push(path); });
  await open(page, '![inline](images/a.png)\n\n![ref][image]\n\n[image]: ../shared/图片.png\n\n<div><img src="images/html.png" alt="html"></div>', "/docs/note.md");
  const pictures = page.locator('.mu-editor img[alt="inline"], .mu-editor img[alt="ref"], .mu-editor img[alt="html"]');
  await expect(pictures).toHaveCount(3);
  await expect.poll(() => pictures.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth === 32))).toBe(true);
  expect(await page.evaluate(() => window.nativeFixture.allowedImages)).toEqual(expect.arrayContaining(["/docs/images/a.png", "/shared/图片.png", "/docs/images/html.png"]));
  await page.evaluate(() => { window.nativeFixture.savePath = "/other/note.md"; }); await page.keyboard.press("Control+Shift+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.allowedImages.includes("/other/images/a.png") && window.nativeFixture.allowedImages.includes("/other/images/html.png"))).toBe(true);
  await expect.poll(() => pictures.evaluateAll(nodes => nodes.filter(node => (node as HTMLImageElement).src.includes(encodeURIComponent("/other/images/"))).length)).toBe(2);
  expect(imageRequests).toContain("/other/images/a.png"); expect(imageRequests).toContain("/other/images/html.png");
});

test("window chrome stays fixed and long content scrolls only inside the editor", async ({ page }) => {
  await open(page, Array.from({ length: 100 }, (_, index) => `Paragraph ${index} ${"wide ".repeat(30)}`).join("\n\n"));
  for (const viewport of [{ width: 640, height: 480 }, { width: 800, height: 500 }, { width: 1024, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const source of [false, true]) {
      if (source) await sourceMode(page);
      const scrollTarget = page.locator(source ? ".CodeMirror-scroll" : ".muya-editor");
      const before = await page.locator(".app-titlebar,.app-footer").evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })));
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, clientWidth: innerWidth, clientHeight: innerHeight }));
      expect(dimensions.width).toBeLessThanOrEqual(dimensions.clientWidth); expect(dimensions.height).toBeLessThanOrEqual(dimensions.clientHeight);
      expect(before[0]!.top).toBe(0); expect(before[1]!.bottom).toBe(viewport.height);
      await scrollTarget.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect.poll(() => scrollTarget.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      expect(await page.locator(".app-titlebar,.app-footer").evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })))).toEqual(before);
      await page.evaluate(() => scrollTo(200, 200)); expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
      if (source) await page.keyboard.press("Control+Shift+M");
    }
  }
});
