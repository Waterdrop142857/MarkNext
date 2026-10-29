import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type {} from "./app";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
});

async function openDocument(page: Page, content?: string) {
  if (content !== undefined) await page.evaluate(text => { window.nativeFixture.disk["/old.md"] = text; }, content);
  await page.keyboard.press("Control+O");
  await expect(page.locator(".mu-editor")).toBeVisible();
}

for (const choice of ["取消", "不保存", "保存"]) {
  test(`retains edits during a multi-file open and protects closing the old tab: ${choice}`, async ({ page }) => {
    await openDocument(page);
    await page.evaluate(answer => {
      const f = window.nativeFixture;
      f.openPath = "/new.md"; f.delayReads = true; f.choices = [answer];
    }, choice);
    await page.keyboard.press("Control+O");
    await expect.poll(() => page.evaluate(() => window.nativeFixture.readPending)).toBe(true);
    await page.locator(".mu-editor").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" pending edit");
    await expect(page.locator(".mu-editor")).toContainText("pending edit");
    await page.evaluate(() => window.nativeFixture.finishRead());
    await expect(page.getByRole("tab", { selected: true })).toContainText("new.md");
    expect(await page.evaluate(() => window.nativeFixture.prompts)).toEqual([]);
    await page.getByRole("button", { name: "关闭 old.md", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts.length)).toBe(1);
    if (choice === "取消") await expect(page.locator(".mu-editor")).toContainText("pending edit");
    else await expect(page.locator(".mu-editor")).toContainText("replacement");
    const result = await page.evaluate(() => ({ reads: window.nativeFixture.reads, writes: window.nativeFixture.writes, errors: window.nativeFixture.errors }));
    expect(result.reads).toEqual(["/old.md", "/new.md"]);
    expect(result.errors).toEqual([]);
    expect(result.writes).toHaveLength(choice === "保存" ? 1 : 0);
    if (choice === "保存") {
      expect(result.writes[0]!.path).toBe("/old.md");
      expect(result.writes[0]!.content).toContain("pending edit");
    }
  });
}

test("HTML CSS cannot hide or cover the application, while safe formatting survives", async ({ page }) => {
  const stylesheetRequests: string[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/tests/e2e/fixtures/host-style.css")) stylesheetRequests.push(request.url());
  });
  const html = '<div><STYLE>.app-shell{display:none!important}</STYLE>'
    + '<LINK rel="stylesheet" href="/tests/e2e/fixtures/host-style.css">'
    + '<p style="position:fixed;inset:0;z-index:999999;transform:scale(99);color:SteelBlue;text-align:center">safe text</p>'
    + '<p style="height:100000px;background-color:red">oversized content</p></div>';
  await openDocument(page, html);
  const preview = page.locator(".mu-html-preview");
  await expect(preview).toContainText("safe text");
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(await preview.locator("style,link").count()).toBe(0);
  const styles = await preview.locator("p").first().evaluate(node => {
    const style = getComputedStyle(node);
    return { position: style.position, color: style.color, textAlign: style.textAlign };
  });
  expect(styles.position).toBe("static");
  expect(styles.color).toBe("rgb(70, 130, 180)");
  expect(styles.textAlign).toBe("center");
  const boundary = await preview.evaluate(node => {
    const menu = document.querySelector(".menu-bar")!.getBoundingClientRect();
    return {
      height: node.getBoundingClientRect().height,
      contain: getComputedStyle(node).contain,
      menuReceivesPointer: !!document.elementFromPoint(menu.x + menu.width / 2, menu.y + menu.height / 2)?.closest(".menu-bar"),
    };
  });
  expect(boundary.height).toBeLessThanOrEqual(480);
  expect(boundary.contain).toContain("paint");
  expect(boundary.menuReceivesPointer).toBe(true);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await expect(page.getByRole("button", { name: /新建/ })).toBeVisible();
  expect(stylesheetRequests).toEqual([]);
});

test("production build hides developer tools and mounts without runtime errors", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.getByRole("button", { name: "帮助", exact: true }).click();
  await expect(page.getByRole("button", { name: "关于 MarkNext", exact: true })).toBeVisible();
  expect(await page.getByRole("button", { name: "打开开发者工具", exact: true }).count()).toBe(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByRole("tab")).toHaveCount(4);
  await page.getByRole("tab", { name: "编辑器", exact: true }).click();
  await page.locator("#settings-font-size").fill("18"); await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("marknext-settings-v1")!).preferences.editorFontSize)).toBe(18);
});

test("inline HTML and host class names cannot paint over the menu", async ({ page }) => {
  await openDocument(page, 'before <span class="fluent-menu" style="position:fixed;inset:0;z-index:999999;color:SteelBlue">inline content</span> after');
  const inline = page.locator(".mu-raw-html");
  await expect(inline).toContainText("inline content");
  expect(await inline.evaluate(node => (node as HTMLElement).style.position)).toBe("");
  const protectedMenu = await page.locator(".menu-bar").evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return !!document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest(".menu-bar");
  });
  expect(protectedMenu).toBe(true);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await expect(page.getByRole("button", { name: /新建/ })).toBeVisible();
});
