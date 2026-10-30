import { test, expect } from "./fixtures";
import { test as isolatedTest, expect as isolatedExpect } from "@playwright/test";

for (const environment of ["dev", "production"]) for (const theme of ["dark", "light"]) {
  test(`${environment} / ${theme}: matching startup surface is painted before the application module loads`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("marknext-theme-mode", theme), theme);
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    await page.route(environment === "dev" ? "**/src/App.vue" : "**/assets/App-*.js", async route => { await loading; await route.continue(); });
    const editorRequests: string[] = [];
    page.on("request", request => { if (/\/assets\/EditorSession-.*\.js$|\/src\/components\/EditorSession\.vue$/.test(request.url())) editorRequests.push(request.url()); });
    await page.goto(environment === "dev" ? "/" : "http://127.0.0.1:4174", { waitUntil: "commit" });
    try {
      await expect(page.locator("#startup")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.locator("#startup").evaluate(node => getComputedStyle(node).backgroundColor)).toBe(theme === "dark" ? "rgb(30, 30, 30)" : "rgb(245, 245, 245)");
      await expect(page.locator(".app-shell")).toHaveCount(0);
    } finally { release(); }
    await expect(page.locator(".empty-state")).toBeVisible();
    await expect(page.locator("#startup")).toHaveCount(0);
    expect(editorRequests).toEqual([]);
    await page.keyboard.press("Control+N");
    await expect(page.locator(".mu-editor")).toBeVisible();
    expect(editorRequests.length).toBeGreaterThan(0);
  });
}

isolatedTest("failed application import presents a reload action and a retry starts successfully", async ({ page }) => {
  let reject = true;
  await page.route("**/assets/App-*.js", route => reject
    ? route.fulfill({ status: 200, contentType: "text/javascript", body: "throw new Error('controlled startup failure')" })
    : route.continue());
  await page.goto("http://127.0.0.1:4174");
  await isolatedExpect(page.locator("#startup")).toHaveAttribute("role", "alert");
  await isolatedExpect(page.locator("#startup-retry")).toBeVisible();
  reject = false;
  await page.locator("#startup-retry").click();
  await isolatedExpect(page.locator(".empty-state")).toBeVisible();
  await isolatedExpect(page.locator("#startup")).toHaveCount(0);
});

isolatedTest("the app remains reachable if the early appearance script cannot be fetched", async ({ page }) => {
  await page.route("**/startup.js", route => route.abort());
  await page.goto("http://127.0.0.1:4174");
  await isolatedExpect(page.locator(".empty-state")).toBeVisible();
  await isolatedExpect(page.locator("#startup")).toHaveCount(0);
});

test("a native launch reveals chrome even while its first editor import is pending", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("test-open-requests", JSON.stringify([{ id: 1, paths: ["/old.md"] }])));
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/src/components/EditorSession.vue", async route => { await loading; await route.continue(); });
  await page.goto("/tests/e2e/app.html", { waitUntil: "commit" });
  try {
    await expect(page.locator(".app-titlebar")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.nativeFixture.startupReady)).toEqual([{ generation: 1, dark: false }]);
    expect(await page.evaluate(() => window.nativeFixture.openRequestAcks)).toEqual([]);
  } finally { release(); }
  await expect(page.locator(".mu-editor")).toContainText("original");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.openRequestAcks)).toEqual([1]);
});
