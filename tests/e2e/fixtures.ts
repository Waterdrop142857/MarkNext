import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ runtimeChecks: void }>({
  runtimeChecks: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
      errors.push(`Unexpected external request: ${url.origin}`);
      return route.abort();
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem("marknext-language-v1")) localStorage.setItem("marknext-language-v1", "zh-CN");
    });
    await use();
    expect(errors, "No uncaught runtime errors, console errors or external requests").toEqual([]);
  }, { auto: true }],
});
export { expect };
