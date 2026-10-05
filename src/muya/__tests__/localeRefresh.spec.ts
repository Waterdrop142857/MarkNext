// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en, zhCN } from '../locales';
import { ParagraphQuickInsertMenu } from '../ui/paragraphQuickInsertMenu';
import { ImageToolBar } from '../ui/imageToolbar';
import { TableRowColumMenu } from '../ui/tableRowColumMenu';
import { ParagraphFrontMenu } from '../ui/paragraphFrontMenu';
import { Muya } from '../muya';

// PARITY (Phase G — G8): switching the UI language mid-session must refresh the
// inline placeholder hints (quick-insert "Type / to insert…", code-block
// language, math, front matter). Those hints are DOM attributes baked once in
// each block's constructor. `Muya.locale()` now updates editor-owned labels
// in place, leaving document blocks, selection, history and previews intact.

const bootedHosts: HTMLElement[] = [];
const editors: Muya[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        locale: en,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    editors.push(muya);
    bootedHosts.push(muya.domNode);
    return muya;
}

describe('muya.locale() refreshes rendered hints (Phase G — G8)', () => {
    it('updates an empty paragraph\'s quick-insert hint attribute', () => {
        const muya = bootMuya('\n');
        const para = muya.editor.scrollPage!.firstContentInDescendant()!;
        const before = para.domNode!.getAttribute('empty-hint');
        expect(before).toBe(en.resource['Type / to insert...']);

        muya.locale(zhCN);

        // Hints are refreshed in place on the original block.
        const after = muya.editor.scrollPage!
            .firstContentInDescendant()!
            .domNode!
            .getAttribute('empty-hint');
        expect(after).toBe(zhCN.resource['Type / to insert...']);
        expect(after).not.toBe(before);
    });

    it('updates the code-block language-input hint attribute', () => {
        const muya = bootMuya('```\n\n```\n');
        const findLangInput = (): Element | null =>
            muya.domNode.querySelector('[hint]');
        expect(findLangInput()?.getAttribute('hint')).toBe(
            en.resource['Input Language Identifier...'],
        );

        muya.locale(zhCN);

        expect(findLangInput()?.getAttribute('hint')).toBe(
            zhCN.resource['Input Language Identifier...'],
        );
    });

    it('preserves the undo history across the locale refresh', async () => {
        const muya = bootMuya('alpha\n');
        // Seed an undo entry. The text-setter op flushes to history on the next
        // frame (JSONState._emitStateChange), so wait for the stack to grow.
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        first.setCursor(5, 5, true);
        muya.editor.activeContentBlock = first;
        first.text = 'alpha beta';
        await vi.waitFor(() => {
            expect(muya.getHistory().stack.undo.length).toBeGreaterThan(0);
        });
        const before = muya.getHistory();

        muya.locale(zhCN);

        const after = muya.getHistory();
        expect(after.stack.undo.length).toBe(before.stack.undo.length);
        // Document content is untouched by a pure language switch.
        expect(muya.getMarkdown().trim()).toBe('alpha beta');
    });

    it('restores the caret across the locale refresh', () => {
        const muya = bootMuya('hello world\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(5, 5, true);

        muya.locale(zhCN);

        const sel = muya.editor.selection.getSelection();
        expect(sel).not.toBeNull();
        expect(sel!.anchor.offset).toBe(5);
        expect(sel!.anchor.block.text).toBe('hello world');
    });

    it('is a safe language update when the tree is not yet mounted', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            markdown: 'text\n',
            locale: en,
        } as ConstructorParameters<typeof Muya>[1]);
        bootedHosts.push(host);
        // No init() yet — scrollPage is undefined. locale() must not throw.
        expect(() => muya.locale(zhCN)).not.toThrow();
        expect(muya.i18n.lang).toBe('zh-CN');
    });
    it('keeps block/DOM identities, cross-block selection, scroll and rendered math intact', () => {
        const muya = bootMuya('first\n\nsecond\n\n$$\nx^2\n$$\n');
        const root = muya.domNode;
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        const firstDom = first.domNode;
        muya.selectAllDocument();
        const before = muya.getSelection()!;
        const offsets = [before.anchor.offset, before.focus.offset];
        const paths = [[...before.anchor.path], [...before.focus.path]];
        const math = root.querySelector('.katex');
        expect(math).not.toBeNull();
        root.scrollTop = 23;
        const rebuild = vi.spyOn(muya.editor.scrollPage!, 'updateState');
        muya.locale(zhCN);
        expect(rebuild).not.toHaveBeenCalled();
        expect(muya.domNode).toBe(root);
        expect(muya.editor.scrollPage!.firstContentInDescendant()).toBe(first);
        expect(first.domNode).toBe(firstDom);
        expect(root.querySelector('.katex')).toBe(math);
        expect(root.scrollTop).toBe(23);
        const after = muya.getSelection()!;
        expect([after.anchor.offset, after.focus.offset]).toEqual(offsets);
        expect([after.anchor.path, after.focus.path]).toEqual(paths);
        expect(muya.getMarkdown()).toContain('first');
    });

    it('updates existing preview labels, image hints and code controls, leaving document text alone', () => {
        const muya = bootMuya('# Paragraph\n\n![]()\n\n```\n\n```\n\n$$\n \n$$\n\n```mermaid\n\n```\n');
        const before = muya.getMarkdown();
        muya.locale(zhCN);
        expect(muya.domNode.querySelector('.mu-inline-image')?.getAttribute('empty-text')).toBe('点击添加图片');
        expect(muya.domNode.querySelector('.mu-code-copy')?.getAttribute('title')).toBe('复制内容');
        expect(muya.domNode.querySelector('[data-muya-i18n="Empty Mathematical Formula"]')?.textContent).toBe('空数学公式');
        expect(muya.domNode.querySelector('[data-muya-i18n="Empty Diagram"]')?.textContent).toBe('空图表');
        expect(muya.getMarkdown()).toBe(before);
        muya.locale(en);
        expect(muya.domNode.querySelector('.mu-inline-image')?.getAttribute('empty-text')).toBe('Click to add an image');
    });

    it('does not steal input focus or render unopened tools without their editing context', () => {
        const muya = bootMuya('text\n');
        const tools = [new ImageToolBar(muya), new TableRowColumMenu(muya), new ParagraphFrontMenu(muya)];
        const input = document.createElement('input'); document.body.appendChild(input); input.focus();
        expect(() => muya.locale(zhCN)).not.toThrow();
        expect(document.activeElement).toBe(input);
        tools.forEach(tool => tool.destroy()); input.remove();
    });

    it('refreshes resources for an updated locale with the same name', () => {
        const muya = bootMuya('\n');
        muya.locale({ ...en, resource: { ...en.resource, 'Type / to insert...': 'Updated hint' } });
        expect(muya.domNode.querySelector('[empty-hint]')?.getAttribute('empty-hint')).toBe('Updated hint');
    });

    it('refreshes an open quick-insert menu', () => {
        const muya = bootMuya('/\n');
        const menu = new ParagraphQuickInsertMenu(muya);
        const first = muya.editor.scrollPage!.firstContentInDescendant()!;
        muya.eventCenter.emit('content-change', { block: first });
        expect(menu.status).toBe(true);
        expect(menu.scrollElement!.textContent).toContain('Paragraph');
        muya.locale(zhCN);
        expect(menu.scrollElement!.textContent).toContain('普通段落');
        expect(first.domNode!.getAttribute('placeholder')).toBe('搜索关键字...');
        menu.destroy();
    });

});
