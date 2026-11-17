// @vitest-environment jsdom
import type { IMuyaOptions } from '../types';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Muya } from '../muya';
import { pastePlainText } from '../clipboard/paste';

let editor: Muya | undefined;
let version: string | undefined;

beforeEach(() => {
    version = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});
afterEach(() => {
    editor?.destroy();
    editor?.domNode.remove();
    document.getSelection()?.removeAllRanges();
    if (version === undefined) Reflect.deleteProperty(window, 'MUYA_VERSION');
    else window.MUYA_VERSION = version;
});

function open(markdown: string, options: Partial<IMuyaOptions> = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    editor = new Muya(host, { markdown, ...options });
    editor.init();
    editor.domNode.tabIndex = 0;
    editor.domNode.focus();
    return editor;
}

function consistent(muya: Muya) {
    muya.flush();
    const scroll = muya.editor.scrollPage!;
    const live = scroll.children.map(block => {
        if (!block.isParent()) throw new Error('Expected a root block');
        return block.getState();
    });
    expect(live).toEqual(muya.getState());
    const selection = muya.getSelection();
    expect(selection).not.toBeNull();
    for (const endpoint of [selection!.anchor, selection!.focus]) {
        expect(endpoint.block.domNode?.isConnected).toBe(true);
        expect(scroll.queryBlock([...endpoint.path])).toBe(endpoint.block);
    }
}

it('language input has a distinct, JSON-resolvable path and synchronizes metadata on cut and pairing', () => {
    const muya = open('```text\nsample\n```\n');
    const language = muya.editor.scrollPage!.firstContentInDescendant()!;
    const body = muya.editor.scrollPage!.lastContentInDescendant()!;
    expect(language.blockName).toBe('language-input');
    expect(language.path).toEqual([0, 'meta', 'lang']);
    expect(body.path).toEqual([0, 'text']);
    expect(muya.editor.scrollPage!.queryBlock([...language.path])).toBe(language);
    language.setCursor(0, language.text.length, true);
    muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: '(', bubbles: true, cancelable: true }));
    consistent(muya);
    expect(muya.getMarkdown()).toBe('```(text)\nsample\n```\n');
    language.setCursor(0, language.text.length, true);
    muya.editor.clipboard.cutHandler();
    consistent(muya);
    expect(muya.getMarkdown()).toBe('```\nsample\n```\n');
});

it('language cursor round-trips through source offsets and repeated focus preserves cached paths', () => {
    const muya = open('first\n\n```text\nsample\n```\n');
    const code = muya.editor.scrollPage!.lastChild!;
    if (!code.isParent()) throw new Error('Expected a code block');
    const language = code.firstContentInDescendant()!;
    language.setCursor(2, 2, true);
    const path = [...language.path];
    expect(muya.getCursorOffset()).toEqual({ anchor: { line: 2, ch: 5 }, focus: { line: 2, ch: 5 } });
    muya.focus();
    muya.focus();
    expect(muya.editor.selection.anchorPath).toEqual(path);
    expect(muya.getSelection()?.anchor.block).toBe(language);
    expect(muya.getSelection()?.anchor.offset).toBe(2);
});

for (const markdown of ['## sample\n', '***\n']) {
    it(`pairing a full ${JSON.stringify(markdown)} selection keeps all characters in a valid paragraph`, () => {
        const muya = open(markdown);
        muya.selectAllDocument();
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: '(', bubbles: true, cancelable: true }));
        consistent(muya);
        expect(muya.getMarkdown()).toBe(`(${markdown.trim()})\n`);
        expect(muya.editor.scrollPage!.firstContentInDescendant()!.blockName).toBe('paragraph.content');
        muya.undo();
        consistent(muya);
        expect(muya.getMarkdown()).toBe(markdown);
    });
}

for (const markdown of ['## sample\n', '- sample\n', 'first\n\nsecond\n']) {
    it(`undo of the first structural edit in ${JSON.stringify(markdown)} restores a usable caret`, async () => {
        const muya = open(markdown);
        muya.selectAllDocument();
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        consistent(muya);
        muya.undo();
        consistent(muya);
        expect(muya.getMarkdown()).toBe(markdown);
        await pastePlainText(muya.editor.clipboard, 'Z');
        consistent(muya);
        expect(muya.getMarkdown()).toContain('Z');
    });
}

it('an asynchronous image placeholder follows the surviving block after a heading converts', async () => {
    let finish: ((src: string) => void) | undefined;
    const muya = open('## sample\n', { imageAction: () => new Promise(resolve => { finish = resolve; }) });
    muya.selectAllDocument();
    const pending = muya.editor.clipboard.pasteImage('data:image/png;base64,first');
    consistent(muya);
    expect(muya.editor.scrollPage!.firstContentInDescendant()!.blockName).toBe('paragraph.content');
    expect(muya.getMarkdown()).toContain('loading-');
    expect(finish).toBeDefined();
    finish!('data:image/png;base64,final');
    await pending;
    consistent(muya);
    expect(muya.getMarkdown()).toBe('![](data:image/png;base64,final)\n');
    muya.undo();
    consistent(muya);
    expect(muya.getMarkdown()).toBe('## sample\n');
});

it('footnote content preserves its container, model and history across deletion and paste', async () => {
    const muya = open('[^note]: sample\n', { footnote: true });
    const block = muya.editor.scrollPage!.firstContentInDescendant()!;
    expect(block.closestBlock('footnote')).not.toBeNull();
    block.setCursor(0, block.text.length, true);
    muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    consistent(muya);
    await pastePlainText(muya.editor.clipboard, 'continued');
    consistent(muya);
    expect(muya.getMarkdown()).toContain('[^note]: continued');
    muya.undo();
    consistent(muya);
    muya.undo();
    consistent(muya);
    expect(muya.getMarkdown()).toContain('[^note]: sample');
});

it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
    'modified Backspace delegates its range to the platform (%j)', (modifier) => {
        const muya = open('first second\n');
        const block = muya.editor.scrollPage!.firstContentInDescendant()!;
        block.setCursor(block.text.length, block.text.length, true);
        const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, ...modifier });
        muya.domNode.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(muya.getMarkdown()).toBe('first second\n');
    },
);
