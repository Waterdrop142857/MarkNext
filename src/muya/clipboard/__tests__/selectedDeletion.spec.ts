// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Muya } from '../../muya';

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
    if (version === undefined)
        Reflect.deleteProperty(window, 'MUYA_VERSION');
    else
        window.MUYA_VERSION = version;
});

function open(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Muya(host, { markdown });
    editor.init();
    editor.domNode.tabIndex = 0;
    editor.domNode.focus();
    return editor;
}

for (const key of ['Delete', 'Backspace']) {
    it(`${key} clears a selected heading through the model and restores an editable paragraph`, () => {
        const muya = open('## Example title\n');
        muya.selectAllDocument();
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        muya.domNode.dispatchEvent(event);
        muya.flush();
        expect(event.defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trim()).toBe('');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        expect(leaf.blockName).toBe('paragraph.content');
        expect(leaf.domNode?.isConnected).toBe(true);
        expect(muya.getSelection()?.anchor.block).toBe(leaf);
        muya.undo();
        expect(muya.getMarkdown()).toBe('## Example title\n');
        muya.redo();
        expect(muya.getMarkdown().trim()).toBe('');
    });
}

it('partial selection deletion preserves surrounding text and its undo boundary', () => {
    const muya = open('hello world\n');
    const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
    leaf.setCursor(2, 7, true);
    muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    muya.flush();
    expect(muya.getMarkdown()).toBe('heorld\n');
    expect(muya.getSelection()?.anchor.offset).toBe(2);
    muya.undo();
    expect(muya.getMarkdown()).toBe('hello world\n');
});

it.each([{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }])(
    'keeps modified or composing deletion available to its existing handler (%j)', (modifiers) => {
        const muya = open('## Example title\n');
        muya.selectAllDocument();
        const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true, ...modifiers });
        muya.domNode.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(muya.getMarkdown()).toBe('## Example title\n');
    },
);

it('Shift+Backspace deletes the selected heading through the model', () => {
    const muya = open('## Example title\n');
    muya.selectAllDocument();
    const event = new KeyboardEvent('keydown', { key: 'Backspace', shiftKey: true, bubbles: true, cancelable: true });
    muya.domNode.dispatchEvent(event);
    muya.flush();
    expect(event.defaultPrevented).toBe(true);
    expect(muya.getMarkdown().trim()).toBe('');
    muya.undo();
    expect(muya.getMarkdown()).toBe('## Example title\n');
});

it.each(['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward'])(
    '%s handles selected deletion without requiring a keydown', (inputType) => {
        const muya = open('## Example title\n');
        muya.selectAllDocument();
        const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
        muya.domNode.dispatchEvent(event);
        muya.flush();
        expect(event.defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trim()).toBe('');
        muya.undo();
        expect(muya.getMarkdown()).toBe('## Example title\n');
    },
);

for (const markdown of ['## Example title\n', 'Example title\n===\n']) {
    for (const shiftKey of [false, true]) {
        it(`Enter with shift=${shiftKey} over ${JSON.stringify(markdown)} keeps a valid document and one undo transaction`, () => {
            const muya = open(markdown);
            const before = muya.getMarkdown();
            muya.selectAllDocument();
            const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true });
            muya.domNode.dispatchEvent(event);
            muya.flush();
            expect(event.defaultPrevented).toBe(true);
            expect(muya.getMarkdown().trim()).toBe('');
            const cursor = muya.getSelection();
            expect(cursor?.isCollapsed).toBe(true);
            expect(cursor?.anchor.block.blockName).toBe('paragraph.content');
            expect(cursor?.anchor.block.domNode?.isConnected).toBe(true);
            muya.undo();
            expect(muya.getMarkdown()).toBe(before);
            muya.redo();
            expect(muya.getMarkdown().trim()).toBe('');
        });
    }
}

it.each(['replacement', 'first\n\nsecond', '   ', '# New heading'])(
    'pasting %j over a whole ATX heading removes its selected marker and preserves undo', async (text) => {
        const muya = open('## Example title\n');
        muya.selectAllDocument();
        // jsdom has no DataTransfer constructor. The public plain-text entry
        // uses the same paste pipeline as the native clipboard event.
        const { pastePlainText } = await import('../paste');
        await pastePlainText(muya.editor.clipboard, text);
        muya.flush();
        expect(muya.getMarkdown().trim()).toBe(text.trim());
        expect(muya.getMarkdown()).not.toContain('undefined');
        const cursor = muya.getSelection();
        expect(cursor?.isCollapsed).toBe(true);
        expect(cursor?.anchor.block.domNode?.isConnected).toBe(true);
        muya.undo();
        expect(muya.getMarkdown()).toBe('## Example title\n');
        muya.redo();
        expect(muya.getMarkdown().trim()).toBe(text.trim());
    },
);

it.each(['deleteContentBackward', 'deleteContentForward'])(
    '%s converts an emptied Setext heading to a paragraph', (inputType) => {
        const muya = open('Example title\n===\n');
        muya.selectAllDocument();
        muya.domNode.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
        muya.flush();
        expect(muya.getMarkdown().trim()).toBe('');
        expect(muya.getSelection()?.anchor.block.blockName).toBe('paragraph.content');
        muya.undo();
        expect(muya.getMarkdown()).toBe('Example title\n===\n');
    },
);

it.each([
    { inputType: 'deleteByCut' },
    { inputType: 'deleteCompositionText' },
    { inputType: 'deleteContentBackward', isComposing: true },
    { inputType: 'deleteContentBackward', cancelable: false },
])('beforeinput preserves other input owners (%j)', (options) => {
    const muya = open('## Example title\n');
    muya.selectAllDocument();
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, ...options });
    muya.domNode.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(muya.getMarkdown()).toBe('## Example title\n');
});

it('leaves drag deletion blocked by its existing owner without removing text', () => {
    const muya = open('## Example title\n');
    muya.selectAllDocument();
    const event = new InputEvent('beforeinput', { inputType: 'deleteByDrag', bubbles: true, cancelable: true });
    muya.domNode.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(muya.getMarkdown()).toBe('## Example title\n');
});

it('beforeinput keeps collapsed deletion available to the block handler', () => {
    const muya = open('hello\n');
    const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
    leaf.setCursor(3, 3, true);
    const event = new InputEvent('beforeinput', { inputType: 'deleteWordBackward', bubbles: true, cancelable: true });
    muya.domNode.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(muya.getMarkdown()).toBe('hello\n');
});

it('pasting over part of an ATX marker converts the resulting block and restores a trailing-block caret', async () => {
    const muya = open('## Example title\n');
    const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
    leaf.setCursor(0, 3, true);
    const { pastePlainText } = await import('../paste');
    await pastePlainText(muya.editor.clipboard, 'first\n\nsecond');
    muya.flush();
    expect(muya.getMarkdown()).toBe('first\n\nsecondExample title\n');
    expect(muya.editor.scrollPage!.firstContentInDescendant()!.blockName).toBe('paragraph.content');
    expect(muya.getSelection()?.anchor.block.text).toBe('secondExample title');
    expect(muya.getSelection()?.anchor.offset).toBe(6);
    muya.undo();
    expect(muya.getMarkdown()).toBe('## Example title\n');
});

it('beforeinput ignores an already handled deletion', () => {
    const muya = open('## Example title\n');
    muya.selectAllDocument();
    const event = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
    event.preventDefault();
    muya.domNode.dispatchEvent(event);
    expect(muya.getMarkdown()).toBe('## Example title\n');
});

it('beforeinput deletes a cross-block range as a single undo step', () => {
    const muya = open('## title\n\nbody\n');
    muya.selectAllDocument();
    const event = new InputEvent('beforeinput', { inputType: 'deleteWordBackward', bubbles: true, cancelable: true });
    muya.domNode.dispatchEvent(event);
    muya.flush();
    expect(event.defaultPrevented).toBe(true);
    expect(muya.getMarkdown().trim()).toBe('');
    expect(muya.getSelection()?.anchor.block.blockName).toBe('paragraph.content');
    muya.undo();
    expect(muya.getMarkdown()).toBe('## title\n\nbody\n');
});

it.each(['Escape', 'Home', 'End', 'F1', 'Dead', 'Process'])(
    '%s preserves both cross-block content and history', (key) => {
        const muya = open('## title\n\nbody\n');
        muya.selectAllDocument();
        muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        muya.flush();
        expect(muya.getMarkdown()).toBe('## title\n\nbody\n');
        expect(muya.getHistory().stack.undo).toHaveLength(0);
    },
);

it('prepares a cross-block replacement for WebKit IME key code 229', () => {
    const muya = open('## title\n\nbody\n');
    muya.selectAllDocument();
    const event = new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true, cancelable: true });
    muya.domNode.dispatchEvent(event);
    muya.flush();
    expect(event.defaultPrevented).toBe(false);
    expect(muya.getMarkdown().trim()).toBe('');
    expect(muya.getSelection()?.anchor.block.blockName).toBe('paragraph.content');
    muya.undo();
    expect(muya.getMarkdown()).toBe('## title\n\nbody\n');
});

it.each(['x', '你好', '😀'])(
    'beforeinput replaces an image selection with %j through the model', (data) => {
        const muya = open('![sample](image.png)\n');
        muya.selectAllDocument();
        const event = new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true });
        muya.domNode.dispatchEvent(event);
        muya.flush();
        expect(event.defaultPrevented).toBe(true);
        expect(muya.getMarkdown()).toBe(`${data}\n`);
        expect(muya.getSelection()?.anchor.offset).toBe(data.length);
        muya.undo();
        expect(muya.getMarkdown()).toBe('![sample](image.png)\n');
    },
);

it('replacing a Setext title with whitespace demotes the empty heading', () => {
    const muya = open('Example title\n===\n');
    muya.selectAllDocument();
    const event = new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true });
    muya.domNode.dispatchEvent(event);
    muya.flush();
    expect(muya.getMarkdown()).toBe(' \n');
    expect(muya.getSelection()?.anchor.block.blockName).toBe('paragraph.content');
    muya.undo();
    expect(muya.getMarkdown()).toBe('Example title\n===\n');
});
