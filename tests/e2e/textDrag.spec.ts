import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type CodeMirror from 'codemirror';
import type {} from './app';

async function open(page: Page, content: string) {
  await page.goto('/tests/e2e/app.html');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.evaluate(content => { window.nativeFixture.disk['/old.md'] = content; }, content);
  await page.keyboard.press('Control+O');
  await expect(page.locator('.mu-editor')).toBeVisible();
}

async function dragBeta(page: Page, targetParagraph: number) {
  const points = await page.locator('.mu-editor').evaluate((root, targetParagraph) => {
    root.focus();
    root.addEventListener('dragstart', () => { document.documentElement.dataset.textDragStarted = 'true'; }, { once: true });
    const contents = root.querySelectorAll('.mu-content');
    const firstWalker = document.createTreeWalker(contents[0], NodeFilter.SHOW_TEXT);
    let first: Node | null = null;
    while ((first = firstWalker.nextNode()) && !first.textContent?.includes('alpha beta gamma')) { /* Skip wrapper nodes. */ }
    if (!first) throw new Error('Expected source text node');
    const targetWalker = document.createTreeWalker(contents[targetParagraph], NodeFilter.SHOW_TEXT);
    let target: Node | null = null, candidate: Node | null;
    while ((candidate = targetWalker.nextNode())) { if (candidate.textContent) target = candidate; }
    if (!target) throw new Error('Expected destination text node');
    const selected = document.createRange(); selected.setStart(first, 6); selected.setEnd(first, 10);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(selected);
    const rect = selected.getBoundingClientRect();
    const end = document.createRange(); end.setStart(target, target.textContent!.length); end.collapse(true);
    const endRect = end.getBoundingClientRect();
    return { from: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, to: { x: endRect.x + 3, y: endRect.y + endRect.height / 2 } };
  }, targetParagraph);
  await page.mouse.move(points.from.x, points.from.y);
  await page.mouse.down();
  await page.mouse.move(points.from.x + 8, points.from.y, { steps: 5 });
  await page.mouse.move(points.to.x, points.to.y, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('html')).toHaveAttribute('data-text-drag-started', 'true');
}

test('native text dragging stays in the model, source and history; Backspace and Select All still work', async ({ page }) => {
  await open(page, 'alpha beta gamma');
  await dragBeta(page, 0);
  await expect(page.locator('.mu-content')).toHaveCount(1);
  await expect(page.locator('.mu-content')).toHaveText('alpha  gammabeta');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.mu-content')).toHaveText('alpha beta gamma');
  await page.keyboard.press('Control+Shift+Z');
  await expect(page.locator('.mu-content')).toHaveText('alpha  gammabeta');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.mu-content')).toHaveText('alpha  gammabet');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.mu-content')).toHaveText('alpha  gammabeta');
  await page.keyboard.press('Control+Shift+M');
  const source = await page.locator('.CodeMirror').evaluate(node => (node as HTMLElement & { CodeMirror: CodeMirror.Editor }).CodeMirror.getValue());
  expect(source.trimEnd()).toBe('alpha  gammabeta');
  await page.keyboard.press('Control+Shift+M');
  await page.locator('.mu-editor').click();
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  await expect(page.locator('.mu-editor')).toHaveText('');
  expect(await page.evaluate(() => window.nativeFixture.errors)).toEqual([]);
});

test('dragging between paragraphs never leaves cloned content outside the document tree', async ({ page }) => {
  await open(page, 'alpha beta gamma\n\ndestination');
  await dragBeta(page, 1);
  await expect(page.locator('.mu-content')).toHaveCount(2);
  await expect(page.locator('.mu-content').nth(0)).toHaveText('alpha  gamma');
  await expect(page.locator('.mu-content').nth(1)).toHaveText('destinationbeta');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.mu-content').nth(0)).toHaveText('alpha beta gamma');
  await expect(page.locator('.mu-content').nth(1)).toHaveText('destination');
  await page.keyboard.press('Control+Shift+Z');
  await expect(page.locator('.mu-content').nth(1)).toHaveText('destinationbeta');
  expect(await page.evaluate(() => window.nativeFixture.errors)).toEqual([]);
});
