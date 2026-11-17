import { expect } from './fixtures';
import type { Page } from '@playwright/test';

export async function editorSnapshot(page: Page) {
  return page.locator('.mu-editor').evaluate(async root => {
    const { getBlock } = await import('../../src/muya/utils/dom');
    const { getTextContent } = await import('../../src/muya/selection/dom');
    const { CLASS_NAMES } = await import('../../src/muya/config');
    const first = getBlock(root.querySelector('.mu-content'));
    if (!first?.isContent()) throw new Error('Expected a content block');
    const muya = first.muya;
    muya.flush();
    const scroll = muya.editor.scrollPage!;
    const live = scroll.children.map(block => {
      if (!block.isParent()) throw new Error('Unexpected root content leaf');
      return block.getState();
    });
    const invalid: string[] = [];
    for (const node of root.querySelectorAll('.mu-content')) {
      const block = getBlock(node);
      if (!block?.isContent() || block.domNode !== node || scroll.queryBlock(block.path) !== block) {
        invalid.push('Unmanaged content DOM');
        continue;
      }
      if (block.blockName === 'atxheading.content') {
        const marker = block.text.match(/^ {0,3}(#{1,6})(?:\s+|$)/);
        const parent = block.parent?.getState();
        if (!marker || parent?.name !== 'atx-heading' || marker[1].length !== parent.meta.level)
          invalid.push('ATX marker and block type disagree');
      }
      if (block.blockName === 'thematicbreak.content' && !/^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$/.test(block.text))
        invalid.push('Thematic break marker and block type disagree');
      const text = getTextContent(node, [CLASS_NAMES.MU_MATH_RENDER, CLASS_NAMES.MU_RUBY_RENDER]);
      if (text.replace(/\u200b/g, '') !== block.text.replace(/\u200b/g, '')) {
        invalid.push(`${block.blockName}: DOM ${JSON.stringify(text)} != model ${JSON.stringify(block.text)}`);
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const owner = node.parentElement;
      if (owner && !owner.closest('.mu-content, [contenteditable="false"], .mu-footnote-input, .mu-line-numbers'))
        invalid.push('Editable text outside a model content block');
    }
    const selection = muya.getSelection();
    const validSelection = muya.editor.selection.table.hasSelection || Boolean(selection
      && root.contains(selection.anchor.block.domNode ?? null)
      && root.contains(selection.focus.block.domNode ?? null)
      && scroll.queryBlock([...selection.anchor.path]) === selection.anchor.block
      && scroll.queryBlock([...selection.focus.path]) === selection.focus.block);
    const nativeSelection = document.getSelection();
    const selectionDiagnostics = validSelection ? null : {
      anchorNode: nativeSelection?.anchorNode?.nodeName,
      anchorParent: nativeSelection?.anchorNode?.parentElement?.className,
      anchorOffset: nativeSelection?.anchorOffset,
      focusNode: nativeSelection?.focusNode?.nodeName,
      focusOffset: nativeSelection?.focusOffset,
      activeBlock: muya.editor.activeContentBlock?.blockName,
      focused: muya.hasFocus(),
    };
    return { markdown: muya.getMarkdown(), live, state: muya.getState(), invalid, validSelection, selectionDiagnostics, busy: muya.busy, caret: selection ? { offset: selection.anchor.offset, text: selection.anchor.block.text } : null };
  });
}

export async function expectEditorConsistent(page: Page) {
  await expect.poll(async () => (await editorSnapshot(page)).busy).toBe(false);
  const value = await editorSnapshot(page);
  expect(value.invalid).toEqual([]);
  expect(value.live).toEqual(value.state);
  expect(value.validSelection, JSON.stringify(value.selectionDiagnostics)).toBe(true);
  expect(value.markdown).not.toContain('undefined undefined');
  return value;
}
