import { test, expect } from "./fixtures";

for (const level of [1, 2, 6]) {
  for (const key of ["Delete", "Backspace"]) {
    test(`heading ${level}: ${key} keeps the empty document editable, selectable and undoable`, async ({ page }) => {
      await page.goto("/tests/e2e/app.html");
      await expect(page.locator(".empty-state")).toBeVisible();
      await page.keyboard.press("Control+O");
      const editor = page.locator(".mu-editor");
      await expect(editor).toBeVisible();
      await page.keyboard.press("Control+A");
      await page.keyboard.type(`${"#".repeat(level)} Example title`, { delay: 25 });
      await expect(editor.locator(`h${level}`)).toContainText("Example title");
      await page.keyboard.press("Control+A");
      await page.keyboard.press(key);
      await expect(editor.locator("h1,h2,h3,h4,h5,h6")).toHaveCount(0);
      await expect(editor.locator(".mu-paragraph-content")).toHaveCount(1);
      await page.keyboard.press("Control+S");
      expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe("");
      await page.keyboard.press("Control+Z");
      await expect(editor.locator(`h${level}`)).toContainText("Example title");
      await page.keyboard.press("Control+Shift+Z");
      await expect(editor.locator(".mu-paragraph-content")).toHaveCount(1);
      const box = await editor.boundingBox();
      await page.mouse.click(box!.x + 85, box!.y + 2);
      await page.keyboard.type("first");
      await page.keyboard.press("Enter");
      await page.keyboard.type("second");
      await page.keyboard.press("Control+S");
      expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe("first\n\nsecond");
      await page.keyboard.press("Control+A");
      await page.keyboard.type("replacement");
      await page.keyboard.press("Control+S");
      expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe("replacement");
    });
  }
}

for (const markdown of ["## Example title\n", "Example title\n===\n"]) {
  for (const key of ["Enter", "Shift+Enter", "Shift+Backspace", "Control+Backspace", "Control+Delete"]) {
    test(`${JSON.stringify(markdown)} selected ${key} keeps view, saved content and history consistent`, async ({ page }) => {
      await page.goto("/tests/e2e/app.html");
      await expect(page.locator(".empty-state")).toBeVisible();
      await page.evaluate(content => { window.nativeFixture.disk["/old.md"] = content; }, markdown);
      await page.keyboard.press("Control+O");
      const editor = page.locator(".mu-editor");
      await expect(editor.locator("h1,h2")).toHaveCount(1);
      await page.keyboard.press("Control+A");
      await page.keyboard.press(key);
      await expect(editor.locator("h1,h2")).toHaveCount(0);
      await page.keyboard.press("Control+S");
      expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe("");
      await page.keyboard.press("Control+Z");
      await expect(editor.locator("h1,h2")).toContainText("Example title");
      await page.keyboard.press("Control+Shift+Z");
      await expect(editor.locator("h1,h2")).toHaveCount(0);
      await page.keyboard.type("continued");
      await page.keyboard.press("Control+S");
      expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe("continued");
    });
  }
}

for (const text of ["replacement", "first\n\nsecond", "   "]) {
  test(`paste ${JSON.stringify(text)} over an ATX heading repairs its type and keeps the final caret`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/tests/e2e/app.html");
    await expect(page.locator(".empty-state")).toBeVisible();
    await page.evaluate(() => { window.nativeFixture.disk["/old.md"] = "## Example title\n"; });
    await page.keyboard.press("Control+O");
    const editor = page.locator(".mu-editor");
    await expect(editor.locator("h2")).toBeVisible();
    await page.keyboard.press("Control+A");
    await page.evaluate(text => navigator.clipboard.writeText(text), text);
    await page.keyboard.press("Control+V");
    await expect(editor.locator("h2")).toHaveCount(0);
    await page.keyboard.press("Control+S");
    expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe(text.trim());
    await page.keyboard.press("Control+Z");
    await expect(editor.locator("h2")).toContainText("Example title");
    await page.keyboard.press("Control+Shift+Z");
    await expect(editor.locator("h2")).toHaveCount(0);
    await page.keyboard.type("CARET");
    await page.keyboard.press("Control+S");
    expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe(`${text}CARET`.trim());
  });
}

for (const key of ["Escape", "Home", "End"]) {
  test(`${key} over a cross-block selection preserves saved content and creates no undo step`, async ({ page }) => {
    await page.goto("/tests/e2e/app.html");
    await expect(page.locator(".empty-state")).toBeVisible();
    await page.evaluate(() => { window.nativeFixture.disk["/old.md"] = "## title\n\nbody\n"; });
    await page.keyboard.press("Control+O");
    await expect(page.locator(".mu-editor h2")).toBeVisible();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Control+A");
    await page.keyboard.press(key);
    await page.keyboard.press("Control+S");
    expect(await page.evaluate(() => window.nativeFixture.disk["/old.md"])).toBe("## title\n\nbody\n");
    await page.keyboard.press("Control+Z");
    await expect(page.locator(".mu-editor h2")).toContainText("title");
    await expect(page.locator(".mu-editor .mu-paragraph-content")).toContainText("body");
  });
}

for (const before of ["Example title", "## Example title", "## Example title\n\nbody"]) {
  for (const key of ["Control+X", "Shift+Delete", "Control+V", "Delete", "Backspace", "Enter", "Shift+Enter", "replace"]) {
    test(`${key} after typing ${JSON.stringify(before)} has its own undo boundary`, async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto("/tests/e2e/app.html");
      await expect(page.locator(".empty-state")).toBeVisible();
      await page.evaluate(() => { window.nativeFixture.disk["/old.md"] = ""; });
      await page.keyboard.press("Control+O");
      await expect(page.locator(".mu-editor")).toBeVisible();
      if (key === "Control+V") await page.evaluate(() => navigator.clipboard.writeText("replacement"));
      if (before.includes("\n\n")) {
        await page.keyboard.type("## Example title");
        await page.keyboard.press("Enter");
        await page.keyboard.type("body");
      } else await page.keyboard.type(before);
      await page.keyboard.press("Control+A");
      if (key === "replace") await page.keyboard.type("replacement");
      else await page.keyboard.press(key);
      if (key === "Control+X" || key === "Shift+Delete") {
        expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(before);
      }
      await page.keyboard.press("Control+Z");
      await page.keyboard.press("Control+S");
      await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe(before);
      await page.keyboard.press("Control+Shift+Z");
      await page.keyboard.press("Control+S");
      await expect.poll(() => page.evaluate(() => window.nativeFixture.disk["/old.md"].trim())).toBe(key === "Control+V" || key === "replace" ? "replacement" : "");
    });
  }
}
