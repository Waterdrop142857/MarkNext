import type { Muya } from '../muya';
import type { IIndexPosition } from '../selection/offsetCursor';
import type { IHistorySelection, ISelection } from '../selection/types';
import type { TState } from '../state/types';
import { CLASS_NAMES } from '../config';
import { findContentDOM, getOffsetOfParagraph, getTextContent } from '../selection/dom';
import { injectStateSentinels, locateSentinelOffsets } from '../selection/offsetCursor';
import { SelectionCaretType, SelectionDirection } from '../selection/types';
import { getUniqueId } from '../utils';
import { getBlock } from '../utils/dom';

interface TextDrag {
    markdown: string;
    start: number;
    end: number;
    selection: IHistorySelection;
}

function flatOffset(markdown: string, position: IIndexPosition | null): number | null {
    if (!position) return null;
    const lines = markdown.split('\n');
    if (position.line < 0 || position.line >= lines.length || position.ch < 0 || position.ch > lines[position.line].length) return null;
    return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
}

function dropOffset(muya: Muya, event: DragEvent): number | null {
    const doc = muya.domNode.ownerDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = position ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = position?.offsetNode ?? range?.startContainer;
    const nodeOffset = position?.offset ?? range?.startOffset;
    if (!node || nodeOffset === undefined) return null;
    const content = findContentDOM(node);
    if (!content || !muya.domNode.contains(content)) return null;
    const element = node instanceof Element ? node : node.parentElement;
    if (element?.closest(`[contenteditable="false"], .${CLASS_NAMES.MU_MATH_RENDER}, .${CLASS_NAMES.MU_RUBY_RENDER}, .${CLASS_NAMES.MU_IMAGE_CONTAINER}`)) return null;
    const block = getBlock(content);
    if (!block?.isContent() || block.path.at(-1) !== 'text') return null;
    const localOffset = node.nodeType === Node.TEXT_NODE ? nodeOffset
        : Array.from(node.childNodes).slice(0, nodeOffset).reduce((sum, child) => sum + getTextContent(child, [CLASS_NAMES.MU_MATH_RENDER, CLASS_NAMES.MU_RUBY_RENDER]).length, 0);
    const offset = getOffsetOfParagraph(node, content) + localOffset;
    if (offset < 0 || offset > block.text.length) return null;
    const endpoint = { block, path: [...block.path], offset };
    const selection: ISelection = {
        anchor: endpoint, focus: endpoint, isCollapsed: true, isSelectionInSameBlock: true,
        direction: SelectionDirection.NONE, type: SelectionCaretType.CARET,
    };
    const state = injectStateSentinels(muya.getState(), selection);
    if (!state) return null;
    const cursor = locateSentinelOffsets(muya.editor.jsonState.getMarkdownFromState(state));
    return flatOffset(muya.getMarkdown(), cursor?.anchor ?? null);
}

// Resolve the post-drop caret using detached states. Never put sentinels into
// the live editor or rebuild it just to locate the caret.
function caretAfterDrop(clean: TState[], marked: TState[], marker: string, prefix: (string | number)[] = []): { path: (string | number)[]; offset: number } | null {
    for (let index = 0; index < marked.length; index++) {
        const node = marked[index], original = clean[index];
        if (!original || original.name !== node.name) continue;
        const path = [...prefix, index];
        if ('text' in node && 'text' in original) {
            const offset = node.text.indexOf(marker);
            if (offset >= 0 && node.text.replace(marker, '') === original.text) return { path: [...path, 'text'], offset };
        }
        if ('children' in node && 'children' in original) {
            const found = caretAfterDrop(original.children, node.children, marker, [...path, 'children']);
            if (found) return found;
        }
    }
    return null;
}

/** Own text drops: native contenteditable insertion clones unmanaged DOM. */
export function attachDragDropTextHandlers(muya: Muya): void {
    const { domNode, eventCenter } = muya;
    let source: TextDrag | null = null;
    let composing = false;
    const editable = () => !muya.destroyed && !muya.busy && !composing
        && domNode.getAttribute('contenteditable') !== 'false' && !domNode.closest('[inert]');
    const clear = () => { source = null; };

    eventCenter.attachDOMEvent(document, 'dragstart', clear, true);
    eventCenter.attachDOMEvent(document, 'dragend', clear);
    eventCenter.attachDOMEvent(domNode, 'compositionstart', () => { composing = true; clear(); });
    eventCenter.attachDOMEvent(domNode, 'compositionend', () => { composing = false; });
    eventCenter.attachDOMEvent(domNode, 'dragstart', event => {
        if (event.defaultPrevented) return;
        if (!editable()) { event.preventDefault(); return; }
        muya.flush();
        const selection = muya.getSelection();
        if (!selection || selection.isCollapsed || !domNode.contains(selection.anchor.block.domNode ?? null)
            || !domNode.contains(selection.focus.block.domNode ?? null)) return;
        const markdown = muya.getMarkdown(), cursor = muya.getCursorOffset();
        const anchor = flatOffset(markdown, cursor?.anchor ?? null);
        const focus = flatOffset(markdown, cursor?.focus ?? null);
        if (anchor === null || focus === null || anchor === focus) { event.preventDefault(); return; }
        source = {
            markdown, start: Math.min(anchor, focus), end: Math.max(anchor, focus),
            selection: { ...selection,
                anchor: { offset: selection.anchor.offset, path: [...selection.anchor.path] },
                focus: { offset: selection.focus.offset, path: [...selection.focus.path] },
            },
        };
    });
    eventCenter.attachDOMEvent(domNode, 'dragover', event => {
        const transfer = (event as DragEvent).dataTransfer;
        if (!transfer || !Array.from(transfer.types).includes('text/plain') || Array.from(transfer.types).includes('Files')) return;
        event.preventDefault();
        transfer.dropEffect = editable() ? source && !(event as DragEvent).ctrlKey && !(event as DragEvent).altKey ? 'move' : 'copy' : 'none';
    });
    eventCenter.attachDOMEvent(domNode, 'drop', event => {
        // Even unsupported payloads/locations must not mutate the DOM or navigate.
        // The separately registered image handler already owns image insertion.
        event.preventDefault();
        const drag = event as DragEvent, transfer = drag.dataTransfer;
        const internal = source;
        clear();
        if (!editable() || !transfer || Array.from(transfer.types).includes('Files')) return;
        const plain = transfer.getData('text/plain');
        if (!plain) return;
        muya.flush();
        const markdown = muya.getMarkdown();
        if (internal && internal.markdown !== markdown) return;
        let target = dropOffset(muya, drag);
        if (target === null) return;
        const copy = drag.ctrlKey || drag.altKey;
        let next = markdown;
        const text = internal ? markdown.slice(internal.start, internal.end) : plain.replace(/\r\n?/g, '\n');
        if (internal && !copy) {
            if (target >= internal.start && target <= internal.end) return;
            next = markdown.slice(0, internal.start) + markdown.slice(internal.end);
            if (target > internal.end) target -= internal.end - internal.start;
        }
        next = next.slice(0, target) + text + next.slice(target);
        if (next === markdown) return;
        let marker: string;
        do { marker = `mUyAdRoP${getUniqueId().replace(/\W/g, '')}`; } while (next.includes(marker));
        const state = muya.editor.jsonState.markdownToState(next);
        const marked = muya.editor.jsonState.markdownToState(next.slice(0, target + text.length) + marker + next.slice(target + text.length));
        const caret = caretAfterDrop(state, marked, marker);
        if (muya.replaceContent(state, internal?.selection) && caret) {
            muya.setCursor({ path: caret.path, anchor: { offset: caret.offset }, focus: { offset: caret.offset } });
        }
    });
    // Also block native source deletion when text is dragged into another app.
    eventCenter.attachDOMEvent(domNode, 'beforeinput', event => {
        const type = (event as InputEvent).inputType;
        if (type === 'insertFromDrop' || type === 'deleteByDrag') event.preventDefault();
    });
}
