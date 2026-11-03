import { test, expect } from "./fixtures";
import type CodeMirror from "codemirror";
import type {} from "./app";

for (const theme of ["light", "dark"]) for (const zoom of [100, 200]) {
  test(`source selection and native drag use readable colors and a bounded preview: ${theme}, ${zoom}%`, async ({ page }) => {
    await page.addInitScript(({ theme, zoom }) => {
      localStorage.setItem("marknext-theme-mode", theme);
      localStorage.setItem("marknext-settings-v1", JSON.stringify({ version: 1, preferences: {
        language: "zh-CN", editorFont: "system", editorFontSize: 16, codeFont: "monospace", defaultEncoding: "utf-8", zoom,
      } }));
      const original = DataTransfer.prototype.setDragImage;
      DataTransfer.prototype.setDragImage = function (element, x, y) {
        document.documentElement.dataset.sourceDragImage = JSON.stringify({ tag: element.tagName,
          connected: element.isConnected, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height });
        return original.call(this, element, x, y);
      };
    }, { theme, zoom });
    await page.goto("/tests/e2e/app.html");
    await expect(page.locator(".empty-state")).toBeVisible();
    await page.evaluate(() => { window.nativeFixture.disk["/old.md"] = "# Heading\n\nalpha beta gamma"; });
    await page.getByRole("button", { name: "打开文件", exact: true }).click();
    await expect(page.locator(".mu-editor")).toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    const source = page.locator(".CodeMirror");
    await expect(source).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const selection = await source.evaluate(node => {
      const cm = (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
      cm.focus(); cm.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 9 });
      const text = node.querySelector(".CodeMirror-selectedtext")!;
      return { foreground: getComputedStyle(text).color, background: getComputedStyle(node.querySelector(".CodeMirror-selected")!).backgroundColor,
        history: cm.historySize(), value: cm.getValue() };
    });
    expect(selection.foreground).toBe(theme === "dark" ? "rgb(255, 255, 255)" : "rgb(31, 31, 31)");
    expect(selection.background).toBe(theme === "dark" ? "rgb(38, 79, 120)" : "rgb(204, 232, 255)");
    const points = await source.evaluate(node => {
      const cm = (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror;
      cm.setSelection({ line: 2, ch: 6 }, { line: 2, ch: 10 });
      const selected = node.querySelector(".CodeMirror-selectedtext")!.getBoundingClientRect();
      const line = node.querySelectorAll(".CodeMirror-code .CodeMirror-line")[2];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let last: Node | null = null, text: Node | null;
      while ((text = walker.nextNode())) { if (text.textContent) last = text; }
      if (!last) throw new Error("Missing drag destination");
      const range = document.createRange(); range.setStart(last, last.textContent!.length); range.collapse(true);
      const end = range.getBoundingClientRect();
      return { from: { x: selected.x + selected.width / 2, y: selected.y + selected.height / 2 },
        to: { x: end.x + 2, y: end.y + end.height / 2 } };
    });
    await page.mouse.move(points.from.x, points.from.y); await page.mouse.down();
    await page.mouse.move(points.from.x + 10, points.from.y, { steps: 5 });
    await page.mouse.move(points.to.x, points.to.y, { steps: 20 }); await page.mouse.up();
    const preview = JSON.parse((await page.locator("html").getAttribute("data-source-drag-image")) ?? "null");
    expect(preview).toEqual({ tag: "CANVAS", connected: true, width: zoom / 100, height: zoom / 100 });
    await expect(page.locator(".source-drag-image")).toHaveCount(0);
    const value = () => source.evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue());
    await expect.poll(value).toBe("# Heading\n\nalpha  gammabeta");
    await page.keyboard.press("Control+Z"); await expect.poll(value).toBe(selection.value);
    await page.keyboard.press("Control+Shift+Z"); await expect.poll(value).toBe("# Heading\n\nalpha  gammabeta");
    await page.keyboard.press("Control+S");
    await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("# Heading\n\nalpha  gammabeta");
  });
}
