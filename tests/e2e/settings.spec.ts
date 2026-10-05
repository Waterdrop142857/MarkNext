import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";
import type {} from "./app";

async function openSettings(page: Page, category = "外观") {
  await expect(page.locator(".app-footer")).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("tab", { name: category, exact: true }).click();
}
async function apply(page: Page) {
  await page.getByRole("button", { name: /^(应用|Apply)$/, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}
async function openDocument(page: Page, content = "original") {
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(content => { window.nativeFixture.disk["/old.md"] = content; }, content);
  await page.keyboard.press("Control+O"); await expect(page.locator(".mu-editor")).toBeVisible();
}
const sourceValue = (page: Page) => page.locator(".CodeMirror").evaluate(node =>
  (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue(),
);

test("settings menu opens a categorized floating dialog; drafts survive navigation but cancel discards them", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".menu-dropdown, .menu-overlay")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(4);
  await page.locator("#settings-language").selectOption("en"); await page.locator("#settings-zoom").fill("125");
  await page.getByRole("tab", { name: "编辑器", exact: true }).click();
  await page.locator("#settings-font-size").fill("24"); await page.locator("#settings-editor-font").selectOption("Arial");
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  await expect(page.locator("#settings-zoom")).toHaveValue("125");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await openSettings(page); await expect(page.locator("#settings-zoom")).toHaveValue("100");
  await expect(page.locator("#settings-language")).toHaveValue("zh-CN");
  await page.getByRole("tab", { name: "编辑器", exact: true }).click(); await expect(page.locator("#settings-font-size")).toHaveValue("16");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => localStorage.getItem("marknext-settings-v1"))).toBeNull();
});

test("applying all categories persists language, custom fonts, size, encoding and zoom across restart", async ({ page }) => {
  await page.goto("/tests/e2e/app.html"); await openSettings(page);
  await page.locator("#settings-language").selectOption("en"); await page.locator("#settings-zoom").fill("125");
  await page.getByRole("tab", { name: "编辑器", exact: true }).click();
  await page.locator("#settings-editor-font").selectOption("custom");
  await page.getByRole("textbox", { name: "自定义编辑器字体" }).fill("Noto Sans");
  await page.locator("#settings-font-size").fill("20"); await page.locator("#settings-code-font").selectOption("Consolas");
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await page.locator("#settings-encoding").selectOption("utf-16be"); await apply(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload(); await expect(page.locator(".empty-state")).toBeVisible();
  await openSettings(page, "Editor"); await expect(page.locator("#settings-font-size")).toHaveValue("20");
  await expect(page.getByRole("textbox", { name: "Custom editor font" })).toHaveValue("Noto Sans");
  await expect(page.locator("#settings-code-font")).toHaveValue("Consolas");
  await page.getByRole("tab", { name: "Files", exact: true }).click(); await expect(page.locator("#settings-encoding")).toHaveValue("utf-16be");
  await page.getByRole("tab", { name: "Appearance", exact: true }).click(); await expect(page.locator("#settings-zoom")).toHaveValue("125");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

for (const mode of ["wysiwyg", "source"] as const) {
  test(`${mode}: fonts and zoom update in place and retain content, dirty state and undo history`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html"); await openDocument(page);
    if (mode === "source") { await page.keyboard.press("Control+Shift+M"); await expect(page.locator(".source-editor")).toBeVisible(); }
    const editor = page.locator(mode === "source" ? ".CodeMirror" : ".mu-editor"); const original = await editor.elementHandle();
    await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" edit");
    await openSettings(page, "编辑器"); await page.locator("#settings-editor-font").selectOption("Arial");
    await page.locator("#settings-font-size").fill("22"); await page.locator("#settings-code-font").selectOption("Consolas");
    await page.getByRole("tab", { name: "外观", exact: true }).click(); await page.locator("#settings-zoom").fill("125"); await apply(page);
    expect(await original!.evaluate(node => node === document.querySelector(node.classList.contains("CodeMirror") ? ".CodeMirror" : ".mu-editor"))).toBe(true);
    await expect(editor).toHaveCSS("font-size", "22px"); await expect(editor).toHaveCSS("font-family", mode === "source" ? "Consolas, monospace" : "Arial, sans-serif");
    await expect(page.locator(".dirty-dot")).toBeVisible();
    if (mode === "source") expect(await sourceValue(page)).toBe("original edit"); else await expect(editor).toContainText("original edit");
    await page.keyboard.press("Control+Z");
    if (mode === "source") expect(await sourceValue(page)).toBe("original"); else await expect(editor).toContainText("original");
    await page.keyboard.press("Control+Shift+Z");
    if (mode === "source") expect(await sourceValue(page)).toBe("original edit"); else await expect(editor).toContainText("original edit");
    expect(await page.evaluate(() => ({ writes: window.nativeFixture.writes, prompts: window.nativeFixture.prompts }))).toEqual({ writes: [], prompts: [] });
  });
}

for (const zoom of [75, 125, 200]) {
  test(`${zoom}% zoom keeps chrome fixed and settings controls reachable at smaller window sizes`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html"); await openSettings(page); await page.locator("#settings-zoom").fill(String(zoom)); await apply(page);
    for (const viewport of [{ width: 1024, height: 720 }, { width: 640, height: 480 }]) {
      await page.setViewportSize(viewport);
      const shell = await page.locator(".app-shell").boundingBox(); expect(shell!.width).toBeCloseTo(viewport.width, 0); expect(shell!.height).toBeCloseTo(viewport.height, 0);
      const footer = await page.locator(".app-footer").boundingBox(); expect(footer!.y + footer!.height).toBeCloseTo(viewport.height, 0);
      await page.evaluate(() => scrollTo(200, 200)); expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
      await openSettings(page); const box = await page.getByRole("dialog").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.getByRole("tab", { name: "编辑器", exact: true }).click(); await page.locator("#settings-font-size").fill("18"); await apply(page);
    }
  });
}

test("validates values and storage failures without partially applying other categories", async ({ page }) => {
  await page.goto("/tests/e2e/app.html"); await openSettings(page); await page.locator("#settings-language").selectOption("en");
  await page.locator("#settings-zoom").fill("250"); await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("75"); await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.locator("#settings-zoom").fill("125");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("quota"); }; });
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法保存"); await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await openSettings(page); await expect(page.locator("#settings-zoom")).toHaveValue("100");
});

test("shortcut recording rejects conflicts and Escape cancels recording; committed binding survives restart", async ({ page }) => {
  await page.goto("/tests/e2e/app.html"); await openSettings(page, "快捷键");
  await page.getByPlaceholder("搜索命令或快捷键").fill("新建文件");
  await page.locator(".shortcut-row").getByRole("button", { name: "添加", exact: true }).click();
  await page.keyboard.press("Control+O"); await expect(page.locator(".shortcut-error")).toContainText("打开文件");
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.locator("#shortcut-record")).toHaveCount(0);
  await page.locator(".shortcut-row").getByRole("button", { name: "添加", exact: true }).click(); await page.keyboard.press("Control+Alt+N");
  await expect(page.locator(".shortcut-row")).toContainText("Ctrl+Alt+N");
  await page.getByRole("tab", { name: "文件", exact: true }).click(); await page.getByRole("tab", { name: "快捷键", exact: true }).click();
  await expect(page.locator(".shortcut-row")).toContainText("Ctrl+Alt+N"); await apply(page);
  await page.reload(); await expect(page.locator(".empty-state")).toBeVisible();
  await page.keyboard.press("Control+Alt+N"); await expect(page.locator(".titlebar-path")).toContainText("未命名");
});

test("default encoding applies to newly created files while opened files retain their detected format", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(() => { window.nativeFixture.fileFormats["/old.md"] = { encoding: "utf-16le", bom: false }; });
  await openDocument(page); await openSettings(page, "文件"); await page.locator("#settings-encoding").selectOption("utf-16be"); await apply(page);
  await page.keyboard.press("Control+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.writeFormats)).toEqual([{ encoding: "utf-16le", bom: false }]);
  await page.keyboard.press("Control+N"); await expect(page.locator(".titlebar-path")).toContainText("未命名");
  await page.keyboard.press("Control+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.writeFormats)).toEqual([{ encoding: "utf-16le", bom: false }, { encoding: "utf-16be", bom: true }]);
});

test("font changes update both code blocks and inline code without recreating rendered previews", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await openDocument(page, 'Text `inline`\n\n```javascript\nconst value = 1;\n```\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n$$\nx^2\n$$');
  const svg = page.locator(".mu-diagram-preview > svg"); await expect(svg).toBeVisible();
  const diagram = await svg.elementHandle(); const math = await page.locator(".mu-math-preview .katex").elementHandle();
  await openSettings(page, "编辑器"); await page.locator("#settings-font-size").fill("24");
  await page.locator("#settings-code-font").selectOption("Consolas"); await apply(page);
  await expect(page.locator(".mu-code-block .mu-code")).toHaveCSS("font-family", "Consolas, monospace");
  await expect(page.locator("code.mu-inline-rule")).toHaveCSS("font-family", "Consolas, monospace");
  expect(await diagram!.evaluate(node => node === document.querySelector(".mu-diagram-preview > svg"))).toBe(true);
  expect(await math!.evaluate(node => node === document.querySelector(".mu-math-preview .katex"))).toBe(true);
});

test("sidebar keyboard navigation and Tab remain inside the settings dialog; resetting affects only the selected category", async ({ page }) => {
  await page.goto("/tests/e2e/app.html"); await openSettings(page);
  await page.locator("#settings-zoom").fill("125");
  await page.getByRole("tab", { name: "外观", exact: true }).focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "编辑器", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.locator("#settings-font-size").fill("24");
  await page.getByRole("button", { name: "恢复当前类别默认值", exact: true }).click();
  await expect(page.locator("#settings-font-size")).toHaveValue("16");
  await page.getByRole("tab", { name: "外观", exact: true }).click(); await expect(page.locator("#settings-zoom")).toHaveValue("125");
  await page.getByRole("tab", { name: "外观", exact: true }).focus(); await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("tab", { name: "快捷键", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByPlaceholder("搜索命令或快捷键")).toBeFocused();
  await page.getByRole("button", { name: "应用", exact: true }).focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "关闭设置", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(page.getByRole("button", { name: "应用", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden();
});

for (const zoom of [75, 200]) {
  test(`${zoom}% zoom places context menus inside the viewport and resize handles on window edges`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html"); await openSettings(page); await page.locator("#settings-zoom").fill(String(zoom)); await apply(page);
    await page.setViewportSize({ width: 640, height: 480 });
    const edge = await page.locator(".resize-handle.e").boundingBox(); const bottom = await page.locator(".resize-handle.s").boundingBox();
    expect(edge!.x + edge!.width).toBeCloseTo(640, 0); expect(bottom!.y + bottom!.height).toBeCloseTo(480, 0);
    await page.locator(".titlebar-path").click({ button: "right" }); const menu = page.locator(".fluent-menu"); await expect(menu).toBeVisible();
    const box = await menu.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(641); expect(box!.y + box!.height).toBeLessThanOrEqual(481);
    await menu.getByRole("button", { name: "设置...", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  });

  test(`${zoom}% zoom keeps selection highlights aligned with selected text`, async ({ page }, testInfo) => {
    await page.goto("/tests/e2e/app.html"); await openDocument(page, "Selection text\n\nAnother paragraph");
    await openSettings(page); await page.locator("#settings-zoom").fill(String(zoom)); await apply(page);
    await page.locator(".mu-editor").click(); await page.keyboard.press("Control+A");
    await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
    if (testInfo.project.name === "webkit") {
      const rectangles = page.locator(".mu-webkit-selection-rect"); await expect(rectangles.first()).toBeVisible();
      const bounds = await page.locator(".mu-paragraph-content").first().evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      const painted = await rectangles.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
      expect(painted.some(rect => Math.abs(rect.left - bounds.left) <= 5 && Math.abs(rect.right - bounds.right) <= 5
        && Math.abs(rect.top - bounds.top) <= 2 && Math.abs(rect.bottom - bounds.bottom) <= 2)).toBe(true);
    }
  });
}
