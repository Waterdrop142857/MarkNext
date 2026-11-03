import { test, expect } from "./fixtures";
import metadata from "../../package.json" with { type: "json" };

const { version } = metadata;

for (const locale of ["zh-CN", "en"] as const) {
  for (const zoom of [100, 200]) {
    test(`${locale} ${zoom}%: about shows the app icon and description with modal keyboard behavior`, async ({ page }) => {
      await page.setViewportSize({ width: 800, height: 600 });
      await page.addInitScript(({ locale, zoom }) => {
        localStorage.setItem("marknext-language-v1", locale);
        localStorage.setItem("marknext-theme-mode", zoom === 100 ? "light" : "dark");
        localStorage.setItem("marknext-settings-v1", JSON.stringify({
          version: 1,
          preferences: {
            language: locale, zoom, editorFont: "system", editorFontSize: 16,
            codeFont: "monospace", defaultEncoding: "utf-8",
          },
        }));
      }, { locale, zoom });
      await page.goto("/tests/e2e/app.html");
      await expect(page.locator(".empty-state")).toBeVisible();
      const openAbout = async () => {
        await page.getByRole("button", { name: locale === "en" ? "Help" : "帮助", exact: true }).click();
        await page.getByRole("button", { name: locale === "en" ? "About MarkNext" : "关于 MarkNext", exact: true }).click();
      };
      await openAbout();
      const dialog = page.getByRole("dialog", { name: "MarkNext", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(locale === "en"
        ? "A lightweight, minimalist Markdown editor" : "一个轻量级的极简主义Markdown编辑器");
      await expect(dialog).toContainText(version);
      const icon = dialog.locator("img");
      await expect(icon).toHaveAttribute("src", /icons\/marknext\.svg$/);
      await expect.poll(() => icon.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

      const confirm = dialog.getByRole("button", { name: locale === "en" ? "OK" : "确定", exact: true });
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Control+N");
      await expect(page.locator(".empty-state")).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
      await page.screenshot({ path: test.info().outputPath("about.png") });

      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await openAbout();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await openAbout();
      await page.mouse.click(8, 8);
      await expect(dialog).toHaveCount(0);
      await page.keyboard.press("Control+N");
      await expect(page.locator(".mu-editor")).toBeVisible();
    });
  }
}
