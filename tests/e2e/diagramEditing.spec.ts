import { test, expect } from '@playwright/test';
import { expectEditorConsistent as consistent } from './editorAssertions';
import type {} from './app';

const diagrams = [
  { type: 'mermaid', code: 'graph LR\n A --> B', replacement: 'graph LR\n C --> D' },
  { type: 'vega-lite', code: '{"mark":"point","data":{"values":[{"x":1},{"x":2}]},"encoding":{"x":{"field":"x","type":"quantitative"}}}',
    replacement: '{"mark":"bar","data":{"values":[{"x":2},{"x":3}]},"encoding":{"x":{"field":"x","type":"quantitative"}}}' },
];

for (const diagram of diagrams) {
  for (const action of ['Delete', 'Backspace', 'Enter', 'Shift+Enter', 'replace', 'paste', 'pair', 'cut', 'image']) {
    test(`${diagram.type} source ${action} keeps editing and preview recovery consistent`, async ({ page, context }) => {
      // Incomplete source intentionally produces a diagram parse diagnostic.
      // Every other console error and every uncaught exception still fails.
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && !message.text().startsWith(`diagramPreview: render ${diagram.type} diagram failed:`))
          errors.push(message.text());
      });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === '127.0.0.1' || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
        errors.push(`Unexpected external request: ${url.origin}`);
        return route.abort();
      });
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/tests/e2e/app.html');
      await expect(page.locator('.empty-state')).toBeVisible();
      await page.evaluate(markdown => { window.nativeFixture.disk['/old.md'] = markdown; }, `\`\`\`${diagram.type}\n${diagram.code}\n\`\`\`\n`);
      await page.keyboard.press('Control+O');
      await expect(page.locator('.mu-diagram-preview svg')).toHaveCount(1);
      await page.locator('.mu-editor').evaluate(async root => {
        const { getBlock } = await import('../../src/muya/utils/dom');
        const block = getBlock(root.querySelector('.mu-content'));
        if (!block?.isContent()) throw new Error('Expected diagram source');
        (root as HTMLElement).focus();
        block.setCursor(0, block.text.length, true);
      });
      const before = await consistent(page);
      if (action === 'cut') await page.keyboard.press('Control+X');
      else if (action === 'pair') await page.keyboard.press('(');
      else if (action === 'replace') await page.keyboard.type('temporary');
      else if (action === 'paste') {
        await page.evaluate(code => navigator.clipboard.writeText(code), diagram.replacement);
        await page.keyboard.press('Control+V');
      } else if (action === 'image') {
        await page.evaluate(async () => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
          const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        });
        await page.keyboard.press('Control+V');
      } else await page.keyboard.press(action);
      const after = await consistent(page);
      await page.keyboard.press('Control+S');
      await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'].trimEnd())).toBe(after.markdown.trimEnd());
      if (before.markdown !== after.markdown) {
        await page.keyboard.press('Control+Z');
        expect((await consistent(page)).markdown).toBe(before.markdown);
        await expect(page.locator('.mu-diagram-preview svg')).toHaveCount(1);
        await page.keyboard.press('Control+Shift+Z');
        expect((await consistent(page)).markdown).toBe(after.markdown);
      }
      // Shift+Enter exits to a paragraph. Re-enter the diagram's source before
      // replacing it so recovery exercises the same source block.
      await page.locator('.mu-editor').evaluate(async root => {
        const { getBlock } = await import('../../src/muya/utils/dom');
        const block = getBlock(root.querySelector('.mu-diagram-block .mu-content'));
        if (!block?.isContent()) throw new Error('Expected the original diagram source');
        (root as HTMLElement).focus();
        block.setCursor(0, block.text.length, true);
      });
      await page.evaluate(code => navigator.clipboard.writeText(code), diagram.replacement);
      await page.keyboard.press('Control+V');
      await expect(page.locator('.mu-diagram-preview svg')).toHaveCount(1);
      await page.keyboard.type(' ');
      const final = await consistent(page);
      expect(final.caret?.text).toBe(diagram.replacement + ' ');
      await page.keyboard.press('Control+S');
      await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'].trimEnd())).toBe(final.markdown.trimEnd());
      expect(await page.evaluate(() => window.nativeFixture.errors)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
