import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

async function settings(page: Page, category = "appearance") {
  await page.keyboard.press("Control+,");
  await page.locator(`#settings-tab-${category}`).click();
}

async function dimensions(control: Locator) {
  return control.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
}

for (const zoom of [100, 150, 200]) {
  test(`${zoom}% zoom: controls retain their dimensions across languages, themes and font fallback`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html");
    await expect(page.locator(".empty-state")).toBeVisible();
    await settings(page);
    await page.locator("#settings-zoom").fill(String(zoom));
    await page.locator(".settings-apply").click();
    const scale = zoom / 100;
    const reference = new Map<string, { width: number; height: number }>();
    async function check(selector: string, height: number, stableWidth = true) {
      const current = await dimensions(page.locator(selector));
      expect(current.height, selector).toBeCloseTo(height * scale, 1);
      expect(current.width, selector).toBeGreaterThan(0);
      const previous = reference.get(selector);
      if (stableWidth && previous) expect(current.width, selector).toBeCloseTo(previous.width, 1);
      reference.set(selector, current);
    }

    for (const language of ["zh-CN", "en"]) {
      await settings(page);
      await page.locator("#settings-language").selectOption(language);
      await page.locator(".settings-apply").click();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      for (const font of ["system-ui, sans-serif", '"Noto Sans CJK SC", sans-serif', '"MarkNext Missing UI Font", sans-serif']) {
        await page.evaluate(font => document.documentElement.style.setProperty("--app-ui-font-family", font), font);
        for (const theme of ["light", "dark"]) {
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          await check(".menu-trigger >> nth=0", 32, false);
          await settings(page);
          await check("#settings-language", 36);
          await check("#settings-zoom", 36);
          await check("#settings-tab-shortcuts", 36);
          expect((await dimensions(page.locator("#settings-tab-shortcuts > span"))).height).toBeCloseTo(20 * scale, 1);
          await check(".settings-apply", 36, false);
          await page.locator("#settings-tab-editor").click();
          await check("#settings-font-size", 36);
          await check("#settings-editor-font", 36);
          await check("#settings-code-font", 36);
          await page.locator("#settings-tab-files").click();
          await check("#settings-encoding", 36);
          await page.locator("#settings-tab-shortcuts").click();
          const chip = page.locator(".shortcut-chip").filter({ hasText: "Ctrl+N" });
          expect((await dimensions(chip)).height).toBeCloseTo(28 * scale, 1);
          const centers = await chip.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return [...node.children].map(child => {
              const childRect = child.getBoundingClientRect();
              return Math.abs(childRect.top + childRect.height / 2 - rect.top - rect.height / 2);
            });
          });
          centers.forEach(offset => expect(offset).toBeLessThan(0.6));
          await check(".shortcut-search", 36);
          await page.keyboard.press("Escape");
        }
      }
    }
  });
}

test("shared select/input styles preserve native keyboard editing, focus and cancellation", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await settings(page);
  const language = page.locator("#settings-language");
  await language.selectOption("zh-CN");
  await language.focus();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(language).toHaveValue("en");
  await expect(language).toBeFocused();
  await page.locator("#settings-tab-editor").click();
  const size = page.locator("#settings-font-size");
  await size.fill("17"); await page.keyboard.press("ArrowUp");
  await expect(size).toHaveValue("18");
  await expect(size).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await settings(page, "editor");
  await expect(page.locator("#settings-font-size")).toHaveValue("16");
});

for (const zoom of [100, 200]) {
  test(`${zoom}% zoom: scrollbars stay clear of shortcut actions while scrolling and filtering`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html");
    await expect(page.locator(".empty-state")).toBeVisible();
    await settings(page);
    await page.locator("#settings-zoom").fill(String(zoom));
    await page.locator(".settings-apply").click();
    await page.setViewportSize({ width: 640, height: 480 });
    await settings(page, "shortcuts");
    const list = page.locator(".settings-shortcuts");
    await expect.poll(() => list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    const firstRight = await page.locator(".shortcut-row-actions").first().evaluate(node => node.getBoundingClientRect().right);
    await page.locator(".shortcut-search").fill("新建文件");
    await expect(page.locator(".shortcut-row")).toHaveCount(1);
    expect(await page.locator(".shortcut-row-actions").evaluate(node => node.getBoundingClientRect().right)).toBeCloseTo(firstRight, 1);
    await page.locator(".shortcut-search").fill("");
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const restore = page.locator(".shortcut-row-actions").last().getByRole("button", { name: /恢复/, exact: false });
    await restore.scrollIntoViewIfNeeded();
    const clearance = await restore.evaluate(button => {
      const scroller = button.closest(".settings-shortcuts")!;
      return scroller.getBoundingClientRect().right - button.getBoundingClientRect().right;
    });
    expect(clearance).toBeGreaterThanOrEqual(16 * zoom / 100);
    await restore.evaluate(button => {
      button.addEventListener("click", () => { (button as HTMLElement).dataset.clicked = "true"; }, { once: true });
    });
    const box = await restore.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width - 2, box!.y + box!.height / 2);
    await expect(restore).toHaveAttribute("data-clicked", "true");
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

test("Muya keeps its scrollbar outside the document surface across zoom, theme and scrolling", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(() => {
    window.nativeFixture.disk["/old.md"] = Array.from({ length: 100 }, (_, index) => `Paragraph ${index}`).join("\n\n");
  });
  await page.keyboard.press("Control+O");
  const editor = page.locator(".mu-editor");
  await expect(editor).toBeVisible();
  const original = await editor.elementHandle();
  for (const zoom of [100, 200]) {
    await settings(page);
    await page.locator("#settings-zoom").fill(String(zoom));
    await page.locator(".settings-apply").click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const scroller = page.locator(".muya-editor");
      await expect.poll(() => scroller.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      const clearance = await scroller.evaluate(host => host.getBoundingClientRect().right - host.querySelector(".mu-editor")!.getBoundingClientRect().right);
      expect(clearance).toBeGreaterThanOrEqual(16 * zoom / 100);
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(editor.locator(".mu-paragraph-content").last()).toBeInViewport();
      expect(await original!.evaluate(node => node === document.querySelector(".mu-editor"))).toBe(true);
      expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
    }
  }
});
