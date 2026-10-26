import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type CodeMirror from "codemirror";
import type {} from "./app";

async function source(page: Page, text?: string, untitled = false) {
  await page.keyboard.press(untitled ? "Control+N" : "Control+O");
  await expect(page.locator(".mu-editor")).toBeVisible();
  await page.keyboard.press("Control+Shift+M");
  await expect(page.locator(".source-editor")).toBeVisible();
  if (text !== undefined) {
    await page.locator(".CodeMirror").click(); await page.keyboard.press("Control+A"); await page.keyboard.insertText(text);
  }
}
async function value(page: Page) { return page.locator(".CodeMirror").evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue()); }
async function backup(page: Page, text: string) {
  await expect.poll(() => page.evaluate(() => Object.values(window.nativeFixture.recovery).map(record => record.content))).toContain(text);
}
async function review(page: Page) {
  await page.getByRole("button", { name: "查看恢复记录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "恢复未保存文档", exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/e2e/app.html"); await expect(page.locator(".empty-state")).toBeVisible();
});

test("saving detects external edits without polling; Save As keeps both versions", async ({ page }) => {
  await source(page, "my edits");
  await page.evaluate(() => { window.nativeFixture.disk["/old.md"] = "external"; });
  await page.keyboard.press("Control+S");
  await expect(page.locator(".document-notice")).toContainText("文件已被外部修改");
  expect(await value(page)).toBe("my edits");
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("external");
  await page.locator(".document-notice").getByRole("button", { name: "另存为...", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/saved.md"])).toBe("my edits");
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("external");
});

test("explicit overwrite requires confirmation and clears the conflict after saving", async ({ page }) => {
  await source(page, "my edits"); await page.evaluate(() => { window.nativeFixture.disk["/old.md"] = "external"; });
  await page.keyboard.press("Control+S"); await expect(page.getByRole("button", { name: "保存我的版本", exact: true })).toBeVisible();
  await page.evaluate(() => window.nativeFixture.choices.push("Cancel"));
  await page.getByRole("button", { name: "保存我的版本", exact: true }).click();
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("external");
  await page.evaluate(() => window.nativeFixture.choices.push("Ok"));
  await page.getByRole("button", { name: "保存我的版本", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("my edits");
  await expect(page.getByRole("button", { name: "保存我的版本", exact: true })).toBeHidden();
});

test("focus asks before replacing clean or dirty content and keeps it on dismissal", async ({ page }) => {
  await page.keyboard.press("Control+O"); await expect(page.locator(".mu-editor")).toContainText("original");
  await page.evaluate(() => { window.nativeFixture.choices.push("Cancel"); window.nativeFixture.disk["/old.md"] = "external clean"; window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts.length)).toBe(1);
  await expect(page.locator(".mu-editor")).toContainText("original");
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("external clean");
  await page.evaluate(() => { window.nativeFixture.choices.push("Ok"); window.nativeFixture.disk["/old.md"] = "external accepted"; window.dispatchEvent(new Event("focus")); });
  await expect(page.locator(".mu-editor")).toContainText("external accepted");
  await page.keyboard.press("Control+Shift+M"); await page.locator(".CodeMirror").click();
  await page.keyboard.press("Control+A"); await page.keyboard.insertText("my edits");
  await page.evaluate(() => { window.nativeFixture.choices.push("Cancel"); window.nativeFixture.disk["/old.md"] = "external dirty"; window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts.length)).toBe(3);
  expect(await page.evaluate(() => window.nativeFixture.prompts.at(-1))).toContain("将丢弃");
  await expect(page.getByRole("button", { name: "重新加载磁盘内容", exact: true })).toBeVisible();
  expect(await value(page)).toBe("my edits");
  await page.evaluate(() => window.nativeFixture.choices.push("Cancel"));
  await page.getByRole("button", { name: "重新加载磁盘内容", exact: true }).click();
  expect(await value(page)).toBe("my edits");
});

test("source files keep their editing mode after approving an external reload", async ({ page }) => {
  await source(page);
  await page.evaluate(() => { window.nativeFixture.choices.push("Ok"); window.nativeFixture.disk["/old.md"] = "new disk text"; window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => value(page)).toBe("new disk text");
  await expect(page.locator(".source-editor")).toBeVisible();
});

test("approving an external reload discards existing edits with one prompt and no disk write", async ({ page }) => {
  await source(page, "my edits");
  await page.evaluate(() => { window.nativeFixture.choices.push("Ok"); window.nativeFixture.disk["/old.md"] = "external chosen"; window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => value(page)).toBe("external chosen");
  await expect(page.locator(".source-editor")).toBeVisible();
  expect(await page.evaluate(() => window.nativeFixture.prompts.length)).toBe(1);
  expect(await page.evaluate(() => window.nativeFixture.writes)).toEqual([]);
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("external chosen");
});

test("retaining content does not repeat the prompt on focus or polling and protects ordinary saving", async ({ page }) => {
  await page.clock.install(); await page.reload();
  await expect(page.locator(".empty-state")).toBeVisible(); await source(page);
  await page.evaluate(() => { window.nativeFixture.choices.push("Cancel"); window.nativeFixture.disk["/old.md"] = "external retained"; window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => page.evaluate(() => window.nativeFixture.prompts.length)).toBe(1);
  await page.clock.runFor(15000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await value(page)).toBe("original");
  await page.keyboard.press("Control+S");
  await expect(page.locator(".document-notice")).toContainText("文件已被外部修改");
  expect(await page.evaluate(() => window.nativeFixture.prompts.length)).toBe(1);
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("external retained");
});

for (const untitled of [false, true]) {
  test(`${untitled ? "untitled" : "opened"} drafts survive a simulated crash and restore the source session`, async ({ page }) => {
    const text = "未保存 📝\nsecond line";
    await source(page, text, untitled); await backup(page, text);
    await page.reload(); await expect(page.locator(".empty-state")).toBeVisible(); await review(page);
    await page.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden(); await expect(page.locator(".source-editor")).toBeVisible();
    expect(await value(page)).toBe(text);
    if (!untitled) expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("original");
    await page.keyboard.press("Control+S");
    await expect.poll(() => page.evaluate(() => Object.keys(window.nativeFixture.recovery).length)).toBe(0);
    expect(await page.evaluate(path => window.nativeFixture.disk[path], untitled ? "/saved.md" : "/old.md")).toBe(text);
  });
}

test("recovery after an external change opens a copy and preserves the original", async ({ page }) => {
  await source(page, "recovery edits"); await backup(page, "recovery edits");
  await page.evaluate(() => {
    window.nativeFixture.disk["/old.md"] = "external";
    localStorage.setItem("test-disk", JSON.stringify(window.nativeFixture.disk));
  });
  await page.reload(); await review(page); await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".document-notice")).toContainText("未保存副本"); expect(await value(page)).toBe("recovery edits");
  await page.keyboard.press("Control+S");
  await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/saved.md"])).toBe("recovery edits");
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("external");
});

test("discarding a document clears its backup, while exiting leaves unreviewed records intact", async ({ page }) => {
  await source(page, "discard me", true); await backup(page, "discard me");
  await page.evaluate(() => window.nativeFixture.choices.push("No")); await page.keyboard.press("Control+N");
  await expect.poll(() => page.evaluate(() => Object.keys(window.nativeFixture.recovery).length)).toBe(0);
  await source(page, "keep for later", true); await backup(page, "keep for later");
  await page.reload(); await expect(page.getByRole("button", { name: "查看恢复记录", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Q"); await expect.poll(() => page.evaluate(() => window.nativeFixture.destroyed)).toBe(true);
  expect(await page.evaluate(() => Object.values(window.nativeFixture.recovery).map(record => record.content))).toEqual(["keep for later"]);
});

test("deleting a recovery record requires confirmation and never changes the original", async ({ page }) => {
  await source(page, "old draft"); await backup(page, "old draft"); await page.reload(); await review(page);
  await page.evaluate(() => window.nativeFixture.choices.push("Cancel"));
  await page.getByRole("button", { name: "删除恢复记录", exact: true }).click();
  await expect(page.locator(".recovery-body li")).toHaveCount(1);
  await page.evaluate(() => window.nativeFixture.choices.push("Ok"));
  await page.getByRole("button", { name: "删除恢复记录", exact: true }).click();
  await expect(page.locator(".recovery-body li")).toHaveCount(0);
  expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("original");
});
