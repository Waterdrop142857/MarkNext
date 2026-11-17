import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { expectEditorConsistent as consistent } from './editorAssertions';
import type {} from './app';

async function open(page: Page, markdown: string) {
  await page.goto('/tests/e2e/app.html');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.evaluate(markdown => { window.nativeFixture.disk['/old.md'] = markdown; }, markdown);
  await page.keyboard.press('Control+O');
  await expect(page.locator('.mu-editor')).toBeVisible();
}

for (const markdown of ['first second\n', '> first second\n', '- first second\n', '```text\nfirst second\n```\n']) {
  test(`word Backspace deletes a word and preserves history in ${JSON.stringify(markdown)}`, async ({ page }) => {
    await open(page, markdown);
    await page.locator('.mu-editor').evaluate(async root => {
      const { getBlock } = await import('../../src/muya/utils/dom');
      const block = getBlock([...root.querySelectorAll('.mu-content')].at(-1));
      if (!block?.isContent()) throw new Error('Expected text content');
      (root as HTMLElement).focus();
      block.setCursor(block.text.length, block.text.length, true);
    });
    const before = await consistent(page);
    await page.keyboard.press('Control+Backspace');
    const after = await consistent(page);
    expect(after.caret?.text).toBe('first ');
    await page.keyboard.press('Control+Z');
    expect((await consistent(page)).markdown).toBe(before.markdown);
    await page.keyboard.press('Control+Shift+Z');
    expect((await consistent(page)).markdown).toBe(after.markdown);
  });
}

for (const markdown of ['sample\n', '## sample\n', 'sample\n===\n', '> sample\n', '- sample\n', '- [x] sample\n', '***\n', 'before $x+y$ after\n', '| head | other |\n| --- | --- |\n| first | sample |\n', '```text\nsample\n```\n', '$$\nx+y\n$$\n', '<div>sample</div>\n', '---\ntitle: sample\n---\n']) {
  test(`background code rendering preserves a live caret in ${JSON.stringify(markdown)}`, async ({ page }) => {
    await open(page, markdown);
    await page.locator('.mu-editor').evaluate(async root => {
      const { getBlock } = await import('../../src/muya/utils/dom');
      const block = getBlock([...root.querySelectorAll('.mu-content')].at(-1));
      if (!block?.isContent()) throw new Error('Expected literal content');
      (root as HTMLElement).focus();
      block.setCursor(2, 2, true);
      block.update();
    });
    const rendered = await consistent(page);
    expect(rendered.caret?.offset).toBe(2);
    await page.keyboard.type('CaretProof');
    expect((await consistent(page)).markdown).toContain('CaretProof');
  });
}

const paddingCases = [
  'sample\n', '## sample\n', 'sample\n===\n', '> sample\n', '- sample\n',
  '1. sample\n', '- [x] sample\n', '```text\nsample\n```\n', '$$\nx+y\n$$\n',
  '<div>sample</div>\n', '---\ntitle: sample\n---\n', '***\n',
  '| head | other |\n| --- | --- |\n| first | sample |\n',
];
for (const markdown of paddingCases) {
  test(`editor padding clicks keep input in the model for ${JSON.stringify(markdown)}`, async ({ page }) => {
    await open(page, markdown);
    const editor = page.locator('.mu-editor');
    for (const edge of ['top', 'bottom']) {
      const box = await editor.boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, edge === 'top' ? box!.y + 2 : box!.y + box!.height - 2);
      await page.keyboard.type(edge === 'top' ? 'TopCaretProof' : 'BottomCaretProof');
      const state = await consistent(page);
      expect(state.markdown).toContain(edge === 'top' ? 'TopCaretProof' : 'BottomCaretProof');
      await page.keyboard.press('Control+S');
      await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'].trimEnd())).toBe(state.markdown.trimEnd());
    }
  });
}

for (const key of ['Backspace', 'Delete', 'Control+X', 'Shift+Delete', 'Control+V', 'Enter', 'Shift+Enter']) {
  test(`rectangular table selection survives ${key}, history and clicking back into a cell`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, '| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n| four | five | six |\n');
    const cells = page.locator('.mu-editor td .mu-content');
    const start = await cells.nth(0).boundingBox();
    const end = await cells.nth(3).boundingBox();
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.mu-table-cell-selected')).toHaveCount(2);
    const before = await consistent(page);
    const clipboardBefore = await page.locator('.mu-editor').evaluate(async root => {
      const { getBlock } = await import('../../src/muya/utils/dom');
      return getBlock(root.querySelector('.mu-content'))!.muya.editor.clipboard.getClipboardData().text;
    });
    if (key === 'Control+V') await page.evaluate(() => navigator.clipboard.writeText('replacement'));
    await page.keyboard.press(key);
    if (key === 'Control+X' || key === 'Shift+Delete') {
      expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(clipboardBefore.trim());
    }
    const after = await consistent(page);
    if (after.markdown !== before.markdown) {
      await page.keyboard.press('Control+Z');
      expect((await consistent(page)).markdown).toBe(before.markdown);
      await page.keyboard.press('Control+Shift+Z');
      expect((await consistent(page)).markdown).toBe(after.markdown);
    }
    await cells.first().click();
    await page.keyboard.type('RectCaretProof');
    const final = await consistent(page);
    expect(final.markdown).toContain('RectCaretProof');
    await page.keyboard.press('Control+S');
    await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'].trimEnd())).toBe(final.markdown.trimEnd());
  });
}

for (const markdown of ['sample\n', '```text\nsample\n```\n', '$$\nx+y\n$$\n']) {
  test(`background rendering defers while composing and resumes on commit in ${JSON.stringify(markdown)}`, async ({ page }) => {
    await open(page, markdown);
    await page.locator('.mu-editor').evaluate(async root => {
      const { getBlock } = await import('../../src/muya/utils/dom');
      const block = getBlock([...root.querySelectorAll('.mu-content')].at(-1));
      if (!block?.isContent()) throw new Error('Expected composition target');
      (root as HTMLElement).focus();
      block.setCursor(0, 0, true);
      root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      block.domNode!.textContent = '预编辑';
      const range = document.createRange();
      range.setStart(block.domNode!.firstChild!, 3); range.collapse(true);
      const selection = document.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      block.update();
      if (block.domNode!.textContent !== '预编辑') throw new Error('Render replaced the live preedit');
      root.dispatchEvent(new CompositionEvent('compositionend', { data: '预编辑', bubbles: true }));
    });
    const state = await consistent(page);
    expect(state.markdown).toContain('预编辑');
  });
}
