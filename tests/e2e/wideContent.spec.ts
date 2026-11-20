import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type {} from './app';

const line = 'WideText_0123456789'.repeat(40);
const table = [
  '| ' + Array.from({ length: 8 }, (_, column) => `Column ${column}`).join(' | ') + ' |',
  '|' + ' --- |'.repeat(8),
  ...Array.from({ length: 30 }, (_, row) => '| ' + Array.from({ length: 8 }, (_, column) =>
    `\`Column${column}_Row${row}_LongIdentifier\``).join(' | ') + ' |'),
].join('\n');
const markdown = `# Wide content\n\n\`\`\`text\n${line}\nshort\n\`\`\`\n\n${table}\n\nAfter table\n`;

async function open(page: Page, zoom = 1) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'AppleWebKit/605.1.15' });
  });
  await page.goto('/tests/e2e/app.html');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.evaluate(({ markdown, zoom }) => {
    window.nativeFixture.disk['/old.md'] = markdown;
    document.documentElement.style.zoom = String(zoom);
  }, { markdown, zoom });
  await page.keyboard.press('Control+O');
  await expect(page.locator('.mu-webkit-selection-fix .mu-editor')).toBeVisible();
}

for (const zoom of [1, 1.25]) {
  test(`wide tables scroll inside the editor at zoom ${zoom}`, async ({ page }) => {
    await open(page, zoom);
    const figure = page.locator('.mu-table');
    const geometry = await figure.evaluate(element => ({
      client: element.clientWidth, scroll: element.scrollWidth,
      overflow: getComputedStyle(element).overflowX,
    }));
    expect(geometry.scroll).toBeGreaterThan(geometry.client);
    expect(['auto', 'scroll']).toContain(geometry.overflow);
    await figure.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => figure.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    const last = await figure.locator('tr').first().locator('td').last().boundingBox();
    const box = await figure.boundingBox();
    expect(last!.x + last!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    expect(await page.locator('.muya-editor').evaluate(element => element.scrollLeft)).toBe(0);
  });

  test(`selected wide code stays clipped to its own scroll area at zoom ${zoom}`, async ({ page }) => {
    await open(page, zoom);
    const code = page.locator('.mu-code .mu-content');
    await code.evaluate(async element => {
      const { getBlock } = await import('../../src/muya/utils/dom');
      const block = getBlock(element);
      if (!block?.isContent()) throw new Error('Expected code content');
      block.muya.domNode.focus();
      block.setCursor(0, block.text.length, true);
    });
    const scroll = page.locator('.mu-code');
    await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(page.locator('.mu-webkit-selection-rect')).not.toHaveCount(0);
    await expect.poll(async () => {
      const box = await scroll.boundingBox();
      return page.locator('.mu-webkit-selection-rect').evaluateAll((elements, box) =>
        elements.every(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= box!.x - 1 && rect.right <= box!.x + box!.width + 1;
        }), box);
    }).toBe(true);
    expect(await page.locator('.muya-editor').evaluate(element => element.scrollLeft)).toBe(0);
  });
}

test('clearing a selected tall document removes its selection geometry and scroll extent', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+A');
  await expect(page.locator('.mu-webkit-selection-rect')).not.toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(page.locator('.mu-table')).toHaveCount(0);
  await expect.poll(() => page.locator('.muya-editor').evaluate(element =>
    element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await page.keyboard.type('AfterClearProof');
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'].trim())).toBe('AfterClearProof');
});

test('the editor fills the content pane and blank edges keep input in the document', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await page.keyboard.press('Enter');
  await page.keyboard.type('third');
  const pane = await page.locator('.editor-area').boundingBox();
  const root = await page.locator('.mu-editor').boundingBox();
  expect(Math.abs(root!.x - pane!.x)).toBeLessThanOrEqual(1);
  const gutter = await page.locator('.muya-editor').evaluate(element =>
    element.getBoundingClientRect().width - element.clientWidth + Number.parseFloat(getComputedStyle(element).paddingInlineEnd));
  expect(Math.abs(pane!.width - root!.width - gutter)).toBeLessThanOrEqual(1);
  expect(await page.locator('.mu-editor').evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  const line = await page.locator('.mu-paragraph-content').nth(1).boundingBox();
  expect(line!.x - root!.x).toBeLessThanOrEqual(25);
  expect(root!.width - line!.width).toBeLessThanOrEqual(50);
  for (const [name, x, y] of [
    ['LeftEdgeProof', root!.x + 10, line!.y + line!.height / 2],
    ['RightEdgeProof', root!.x + root!.width - 10, line!.y + line!.height / 2],
    ['TopEdgeProof', root!.x + root!.width / 2, root!.y + 2],
    ['BottomEdgeProof', root!.x + root!.width / 2, pane!.y + pane!.height - 2],
  ] as const) {
    await page.mouse.click(x, y);
    await page.keyboard.type(name);
    await page.keyboard.press('Control+S');
    await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'])).toContain(name);
  }
});
