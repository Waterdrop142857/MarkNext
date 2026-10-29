import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function checkMenu(page: Page, zoom: number, y: number) {
  const scale = zoom / 100;
  const viewport = page.viewportSize()!;
  const widths: number[] = [];
  const edge = Math.max(12, 12 * scale);
  let labels: string[] | undefined;
  for (const x of [edge, viewport.width / 2, viewport.width - edge]) {
    await page.mouse.click(x, y, { button: "right" });
    const menu = page.locator(".fluent-menu");
    await expect(menu).toBeVisible();
    const currentLabels = await menu.locator(".fluent-menu-label").allTextContents();
    if (labels) expect(currentLabels).toEqual(labels);
    else labels = currentLabels;
    await expect.poll(() => menu.evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(viewport.width + 1);
    const size = await menu.evaluate((node, scale) => {
      const rect = node.getBoundingClientRect();
      const px = (value: string) => parseFloat(value) || 0;
      const style = getComputedStyle(node);
      const chrome = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
      const rows = [...node.querySelectorAll(".fluent-menu-item")].map(row => {
        const rowStyle = getComputedStyle(row);
        const children = [...row.children];
        const content = children.reduce((total, child) => {
          const childStyle = getComputedStyle(child);
          const text = child.matches(".fluent-menu-label, .fluent-menu-shortcut");
          const range = document.createRange();
          range.selectNodeContents(child);
          const width = text ? range.getBoundingClientRect().width : child.getBoundingClientRect().width;
          return total + width / scale + px(childStyle.marginLeft) + px(childStyle.marginRight);
        }, 0);
        return content + px(rowStyle.paddingLeft) + px(rowStyle.paddingRight) + px(rowStyle.columnGap) * (children.length - 1);
      });
      return { width: rect.width / scale, natural: Math.max(200, Math.max(...rows) + chrome), left: rect.left };
    }, scale);
    expect(size.left).toBeGreaterThanOrEqual(0);
    // Equal oversized menus would hide the original percentage-width cycle.
    expect(Math.abs(size.width - size.natural)).toBeLessThan(2);
    widths.push(size.width);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
}

for (const language of ["zh-CN", "en"]) {
  for (const zoom of [75, 100, 125, 200]) {
    test(`${language} / ${zoom}%: context menus keep their natural width near both window edges`, async ({ page }) => {
      await page.addInitScript(({ language, zoom }) => {
        localStorage.setItem("marknext-language-v1", language);
        localStorage.setItem("marknext-settings-v1", JSON.stringify({ version: 1, preferences: {
          language, zoom, editorFont: "system", editorFontSize: 16, codeFont: "monospace", defaultEncoding: "utf-8",
        } }));
      }, { language, zoom });
      await page.goto("/tests/e2e/app.html");
      await expect(page.locator(".empty-state")).toBeVisible();
      await checkMenu(page, zoom, 16);
      await page.keyboard.press("Control+N");
      await expect(page.locator(".mu-editor")).toBeVisible();
      const editor = await page.locator(".editor-area").boundingBox();
      expect(editor).not.toBeNull();
      await checkMenu(page, zoom, editor!.y + editor!.height / 2);
    });
  }
}

test("long translated labels fit a narrow zoomed viewport without horizontal scrolling", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 480 });
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--app-ui-zoom", "2");
    document.documentElement.style.setProperty("--app-viewport-width", "160px");
    document.documentElement.style.setProperty("--app-viewport-height", "240px");
  });
  await page.mouse.click(8, 16, { button: "right" });
  const menu = page.locator(".fluent-menu");
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(305);
  expect(await menu.evaluate(node => node.getBoundingClientRect().left)).toBeGreaterThanOrEqual(15);
  expect(await menu.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
});
