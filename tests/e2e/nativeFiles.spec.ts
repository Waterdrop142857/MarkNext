import { test, expect } from "./fixtures";
import type {} from "./app";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";

async function dropFiles(page: Page, selector: string, paths: string[]) {
  const transfer = await page.evaluateHandle(paths => {
    const data = new DataTransfer();
    data.setData("text/uri-list", paths.map(path => new URL(`file://${path.replace(/#/g, "%23")}`).href).join("\r\n"));
    for (const path of paths) data.items.add(new File(["must not be inserted into the active document"], path.split("/").pop()!, { type: "text/markdown" }));
    return data;
  }, paths);
  await page.locator(selector).dispatchEvent("dragover", { dataTransfer: transfer });
  await page.locator(selector).dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
}

test("DOM file drops open through the native queue without requiring a native drop notification", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(() => {
    window.nativeFixture.disk["/文档 # 1.MD"] = "# First";
    window.nativeFixture.disk["/second.txt"] = "second";
  });
  await dropFiles(page, ".empty-state", ["/文档 # 1.MD", "/second.txt"]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".mu-editor")).toContainText("second");
  await dropFiles(page, ".mu-editor", ["/文档 # 1.MD"]);
  await expect(page.getByRole("tab", { selected: true })).toContainText("文档 # 1.MD");
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(await page.evaluate(() => window.nativeFixture.reads)).toEqual(["/文档 # 1.MD", "/second.txt"]);
  expect(await page.evaluate(() => window.nativeFixture.errors)).toEqual([]);
});

test("dropping a file onto source mode opens a tab without inserting file bytes into the dirty document", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(() => window.nativeFixture.deliverFiles(["/old.md"]));
  await expect(page.locator(".mu-editor")).toBeVisible();
  await page.keyboard.press("Control+Shift+M");
  await expect(page.locator(".CodeMirror")).toBeVisible();
  await page.locator(".CodeMirror").click();
  await page.keyboard.press("Control+End"); await page.keyboard.insertText(" unsaved");
  await dropFiles(page, ".CodeMirror", ["/new.md"]);
  await expect(page.getByRole("tab", { selected: true })).toContainText("new.md");
  await page.getByRole("tab", { name: /old.md/ }).click();
  const value = await page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue());
  expect(value).toBe("original unsaved");
  expect(await page.evaluate(() => window.nativeFixture.prompts)).toEqual([]);
  await page.keyboard.press("Control+Z");
  await expect.poll(() => page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue())).toBe("original");
});

test("cold launch drains native file requests after the UI listener is ready", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("test-disk", JSON.stringify({ "/文档 # 1.md": "# Native startup", "/second.txt": "second document" }));
    localStorage.setItem("test-open-requests", JSON.stringify([{ id: 4, paths: ["/文档 # 1.md", "/second.txt"] }]));
  });
  await page.goto("/tests/e2e/app.html");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".mu-editor")).toContainText("second document");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.openRequestAcks)).toEqual([4]);
  await page.getByRole("tab", { name: /文档 # 1.md/ }).click();
  await expect(page.locator(".mu-editor")).toContainText("Native startup");
  expect(await page.evaluate(() => window.nativeFixture.openRequests)).toEqual([]);
});

test("warm deliveries preserve dirty contents and focus existing aliases without rereading", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(() => window.nativeFixture.deliverFiles(["/old.md"]));
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.locator(".mu-editor").click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText(" unsaved edit");
  await page.evaluate(() => window.nativeFixture.deliverFiles(["/new.md"]));
  await expect(page.getByRole("tab", { selected: true })).toContainText("new.md");
  await page.evaluate(() => { window.nativeFixture.pathAliases["/alias.md"] = "/old.md"; return window.nativeFixture.deliverFiles(["/alias.md"]); });
  await expect(page.getByRole("tab", { selected: true })).toContainText("old.md");
  await expect(page.locator(".mu-editor")).toContainText("unsaved edit");
  await page.evaluate(() => window.nativeFixture.deliverFiles([]));
  await expect.poll(() => page.evaluate(() => window.nativeFixture.openRequestAcks.length)).toBe(4);
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(await page.evaluate(() => window.nativeFixture.reads)).toEqual(["/old.md", "/new.md"]);
  expect(await page.evaluate(() => window.nativeFixture.prompts)).toEqual([]);
});

test("native requests arriving during an existing read are queued and acknowledged once", async ({ page }) => {
  await page.goto("/tests/e2e/app.html");
  await expect(page.locator(".empty-state")).toBeVisible();
  await page.evaluate(() => { window.nativeFixture.delayReads = true; return window.nativeFixture.deliverFiles(["/old.md"]); });
  await expect.poll(() => page.evaluate(() => window.nativeFixture.readPending)).toBe(true);
  await page.evaluate(() => window.nativeFixture.deliverFiles(["/new.md"]));
  expect(await page.evaluate(() => window.nativeFixture.openRequestAcks)).toEqual([]);
  await page.evaluate(() => { window.nativeFixture.delayReads = false; window.nativeFixture.finishRead(); });
  await expect.poll(() => page.evaluate(() => window.nativeFixture.openRequestAcks)).toEqual([1, 2]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".mu-editor")).toContainText("replacement");
  expect(await page.evaluate(() => window.nativeFixture.reads)).toEqual(["/old.md", "/new.md"]);
});
