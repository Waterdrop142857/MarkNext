import type Content from '../../block/base/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const editors: Muya[] = [];
const originalCaretRange = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint');
const originalCaretPosition = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint');

function boot(markdown = 'alpha beta gamma') {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown });
    muya.init(); editors.push(muya);
    return muya;
}
function first(muya: Muya) { return muya.editor.scrollPage!.firstContentInDescendant()!; }
function data(text = 'beta') { const transfer = new DataTransfer(); transfer.setData('text/plain', text); return transfer; }
function dispatch(muya: Muya, type: string, transfer: DataTransfer, options: DragEventInit = {}) {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, ...options });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    for (const key of ['ctrlKey', 'altKey'] as const) Object.defineProperty(event, key, { value: options[key] ?? false });
    muya.domNode.dispatchEvent(event);
    return event;
}
function aim(block: Content, offset: number, api: 'range' | 'position' = 'range') {
    block.setCursor(offset, offset, true);
    const selection = document.getSelection()!;
    const range = selection.getRangeAt(0).cloneRange();
    Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: api === 'position' ? () => ({ offsetNode: range.startContainer, offset: range.startOffset }) : undefined });
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => range });
}
function start(muya: Muya, transfer: DataTransfer, begin = 6, end = 10) {
    first(muya).setCursor(begin, end, true);
    dispatch(muya, 'dragstart', transfer);
}
afterEach(() => {
    for (const muya of editors.splice(0)) muya.destroy();
    document.body.innerHTML = '';
    document.getSelection()?.removeAllRanges();
    if (originalCaretRange) Object.defineProperty(document, 'caretRangeFromPoint', originalCaretRange);
    else Reflect.deleteProperty(document, 'caretRangeFromPoint');
    if (originalCaretPosition) Object.defineProperty(document, 'caretPositionFromPoint', originalCaretPosition);
    else Reflect.deleteProperty(document, 'caretPositionFromPoint');
    vi.restoreAllMocks();
});

describe('model-owned text dragging', () => {
    for (const api of ['range', 'position'] as const) {
        it(`moves selected text once using the ${api} caret API and preserves undo/redo`, () => {
            const muya = boot(), transfer = data();
            const before = muya.getMarkdown();
            start(muya, transfer);
            aim(first(muya), 16, api);
            expect(dispatch(muya, 'drop', transfer).defaultPrevented).toBe(true);
            expect(muya.getMarkdown().trimEnd()).toBe('alpha  gammabeta');
            expect(muya.domNode.textContent).toContain('alpha  gammabeta');
            expect(muya.getHistory().stack.undo).toHaveLength(1);
            muya.undo(); expect(muya.getMarkdown()).toBe(before);
            muya.redo(); expect(muya.getMarkdown().trimEnd()).toBe('alpha  gammabeta');
        });
    }
    it('moves backward selections to an earlier offset without deleting other text', () => {
        const muya = boot(), transfer = data();
        const block = first(muya);
        muya.editor.selection.setSelection({ block, path: [...block.path], offset: 10 }, { block, path: [...block.path], offset: 6 });
        dispatch(muya, 'dragstart', transfer); aim(block, 0);
        dispatch(muya, 'drop', transfer);
        expect(muya.getMarkdown().trimEnd()).toBe('betaalpha  gamma');
    });
    it('copies on Ctrl-drag and does not remove the selected original', () => {
        const muya = boot(), transfer = data();
        start(muya, transfer); aim(first(muya), 16);
        dispatch(muya, 'drop', transfer, { ctrlKey: true });
        expect(muya.getMarkdown().trimEnd()).toBe('alpha beta gammabeta');
        muya.undo(); expect(muya.getMarkdown().trimEnd()).toBe('alpha beta gamma');
    });
    it('keeps a drop inside its own selection as a no-op', () => {
        const muya = boot(), transfer = data();
        start(muya, transfer); aim(first(muya), 8);
        expect(dispatch(muya, 'drop', transfer).defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trimEnd()).toBe('alpha beta gamma');
        expect(muya.getHistory().stack.undo).toHaveLength(0);
    });
    it('moves a cross-paragraph selection as one history entry', () => {
        const muya = boot('first alpha\n\nsecond beta\n\nthird gamma'), transfer = data('alpha\nsecond');
        const before = muya.getMarkdown();
        const blocks = [...muya.editor.scrollPage!.children.iterator()].filter(block => block.isParent());
        const a = blocks[0].firstContentInDescendant()!, b = blocks[1].firstContentInDescendant()!, c = blocks[2].firstContentInDescendant()!;
        muya.editor.selection.setSelection({ block: a, path: [...a.path], offset: 6 }, { block: b, path: [...b.path], offset: 6 });
        dispatch(muya, 'dragstart', transfer); aim(c, 11);
        dispatch(muya, 'drop', transfer);
        expect(muya.getMarkdown().trimEnd()).toBe('first  beta\n\nthird gammaalpha\n\nsecond');
        expect(muya.getHistory().stack.undo).toHaveLength(1);
        muya.undo(); expect(muya.getMarkdown()).toBe(before);
    });
    it('inserts external text through the model and ignores transferred HTML', () => {
        const muya = boot('hello'), transfer = data(' world\r\nnext');
        transfer.setData('text/html', '<img src=x onerror="alert(1)">');
        aim(first(muya), 5);
        expect(dispatch(muya, 'drop', transfer).defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trimEnd()).toBe('hello world\nnext');
        expect(muya.domNode.querySelector('img')).toBeNull();
        muya.undo(); expect(muya.getMarkdown().trimEnd()).toBe('hello');
    });
    it('rejects a stale drag after editing and blocks invalid drop targets', () => {
        const muya = boot(), transfer = data();
        start(muya, transfer);
        muya.replaceContent('changed document'); aim(first(muya), 0);
        expect(dispatch(muya, 'drop', transfer).defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trimEnd()).toBe('changed document');
        Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => null });
        expect(dispatch(muya, 'drop', transfer).defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trimEnd()).toBe('changed document');
    });
    it('does not edit while composing or when the renderer is read-only', () => {
        const muya = boot(), transfer = data();
        aim(first(muya), 16);
        muya.domNode.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        expect(dispatch(muya, 'drop', transfer).defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trimEnd()).toBe('alpha beta gamma');
        muya.domNode.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        muya.domNode.setAttribute('contenteditable', 'false');
        expect(dispatch(muya, 'drop', transfer).defaultPrevented).toBe(true);
        expect(muya.getMarkdown().trimEnd()).toBe('alpha beta gamma');
    });
    it('leaves image files to the existing image handler without a second insertion', () => {
        const muya = boot('body');
        muya.options.getPathForFile = () => '/tmp/dragged.png';
        const target = first(muya).domNode!;
        const transfer = new DataTransfer();
        transfer.items.add(new File(['image'], 'dragged.png', { type: 'image/png' }));
        const event = new DragEvent('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: transfer });
        target.dispatchEvent(event);
        muya.flush();
        expect(event.defaultPrevented).toBe(true);
        expect(muya.getMarkdown()).toContain('![dragged.png](/tmp/dragged.png)');
        expect(muya.getMarkdown().match(/dragged\.png\]/g)).toHaveLength(1);
    });
    it('prevents native drag insertion/deletion and releases listeners on destroy', () => {
        const muya = boot();
        for (const inputType of ['insertFromDrop', 'deleteByDrag']) {
            const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
            muya.domNode.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        }
        const ordinary = new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true });
        muya.domNode.dispatchEvent(ordinary); expect(ordinary.defaultPrevented).toBe(false);
        muya.destroy(); expect(muya.eventCenter.events).toHaveLength(0);
    });
});
