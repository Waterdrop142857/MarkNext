import { test, expect } from './fixtures';
import { expectEditorConsistent as consistent } from './editorAssertions';
import type {} from './app';

const fixtures = [
  { name: 'paragraph', markdown: 'sample\n' },
  { name: 'inline formats', markdown: '**sample** and `code`\n' },
  { name: 'inline math', markdown: 'before $x+y$ after\n' },
  { name: 'link', markdown: '[sample](https://example.test/note)\n' },
  { name: 'inline image', markdown: '![sample](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIklEQVR4nN3KMREAAAgCQM4zieEMZ0lpADs/f8/tQygYGYFIYgJE6M/vewAAAABJRU5ErkJggg==)\n' },
  { name: 'ATX heading', markdown: '## sample\n' },
  { name: 'Setext heading', markdown: 'sample\n===\n' },
  { name: 'quote', markdown: '> sample\n' },
  { name: 'bullet list', markdown: '- sample\n' },
  { name: 'ordered list', markdown: '1. sample\n' },
  { name: 'task list', markdown: '- [ ] sample\n' },
  { name: 'checked task list', markdown: '- [x] sample\n' },
  { name: 'nested list', markdown: '- outer\n  - sample\n' },
  { name: 'fenced code', markdown: '```text\nsample\n```\n' },
  { name: 'code language', markdown: '```text\nsample\n```\n', language: true },
  { name: 'indented code', markdown: '    sample\n' },
  { name: 'table cell', markdown: '| head | other |\n| --- | --- |\n| first | sample |\n' },
  { name: 'math block', markdown: '$$\nx+y\n$$\n' },
  { name: 'HTML block', markdown: '<div>sample</div>\n' },
  { name: 'frontmatter', markdown: '---\ntitle: sample\n---\n' },
  { name: 'thematic break', markdown: '***\n' },
];


for (const fixture of fixtures) {
  for (const scope of ['block', 'document']) {
    for (const action of ['Delete', 'Backspace', 'Enter', 'Shift+Enter', 'replace', 'paste', 'pair', 'cut', 'image']) {
      test(`${fixture.name} ${scope}: ${action} keeps the DOM, model, save and history consistent`, async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/tests/e2e/app.html');
        await expect(page.locator('.empty-state')).toBeVisible();
        await page.evaluate(markdown => { window.nativeFixture.disk['/old.md'] = markdown; }, fixture.markdown);
        await page.keyboard.press('Control+O');
        const editor = page.locator('.mu-editor');
        await expect(editor).toBeVisible();
        await editor.evaluate(async (root, language) => {
          const { getBlock } = await import('../../src/muya/utils/dom');
          const nodes = [...root.querySelectorAll('.mu-content')];
          const node = language ? nodes.find(node => node.classList.contains('mu-language-input')) : nodes.at(-1);
          const block = getBlock(node);
          if (!block?.isContent()) throw new Error('Expected an editable fixture leaf');
          (root as HTMLElement).focus();
          block.setCursor(block.text.length, block.text.length, true);
        }, 'language' in fixture && fixture.language);
        const before = await consistent(page);
        if (scope === 'document') await page.keyboard.press('Control+A');
        else await editor.evaluate(async root => {
          const { getBlock } = await import('../../src/muya/utils/dom');
          const first = getBlock(root.querySelector('.mu-content'));
          if (!first?.isContent()) throw new Error('Expected the editor model');
          const block = first.muya.editor.activeContentBlock;
          if (!block) throw new Error('Expected the target block');
          block.setCursor(0, block.text.length, true);
        });
        if (action === 'cut') await page.keyboard.press('Control+X');
        else if (action === 'replace') await page.keyboard.type('replacement');
        else if (action === 'pair') await page.keyboard.press('(');
        else if (action === 'image') {
          await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 8;
            canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
            const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          });
          await page.keyboard.press('Control+V');
        }
        else if (action === 'paste') {
          await page.evaluate(() => navigator.clipboard.writeText('first\n\nsecond'));
          await page.keyboard.press('Control+V');
        } else await page.keyboard.press(action);
        const after = await consistent(page);
        if (scope === 'block' && action === 'Enter'
          && ['fenced code', 'indented code', 'math block', 'HTML block', 'frontmatter'].includes(fixture.name)) {
          expect(after.caret?.text).toBe('\n');
        }
        await page.keyboard.press('Control+S');
        await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'].trimEnd())).toBe(after.markdown.trimEnd());
        if (after.markdown !== before.markdown) {
          await page.keyboard.press('Control+Z');
          expect((await consistent(page)).markdown).toBe(before.markdown);
          await page.keyboard.press('Control+Shift+Z');
          expect((await consistent(page)).markdown).toBe(after.markdown);
        }
        await page.keyboard.type('CaretProof42!');
        const continued = await consistent(page);
        expect(continued.markdown).toContain('CaretProof42!');
        await page.keyboard.press('Control+S');
        await expect.poll(() => page.evaluate(() => window.nativeFixture.disk['/old.md'].trimEnd())).toBe(continued.markdown.trimEnd());
      });
    }
  }
}
