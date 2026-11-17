import type { Muya } from '../muya';
import type { ISelection } from '../selection/types';
import type { IClipboardPayload } from './copyData';
import Format from '../block/base/format';
import { isClipboardEvent, isInputEvent, isKeyboardEvent } from '../utils';
import { getClipboardData, writeClipboardData } from './copyData';
import { cutSelection, deleteTableSelection } from './cut';
import { pastePlainText, pasteSelection } from './paste';
import { pasteImageSrc } from './pasteImage';
import { CopyType, PasteType } from './types';

// After the table/same-block guards, decide whether a keydown over a
// cross-block selection should cut (replace) the selected text. Non-editing
// keys and any modifier combo must NOT cut — in particular Ctrl+<key> (e.g.
// Ctrl+C copy on Windows/Linux), which was previously not excluded and
// silently deleted the selection (#3491). Mirrors the macOS metaKey guard.
export function shouldCrossBlockCut(key: string, metaKey: boolean, ctrlKey: boolean, altKey = false): boolean {
    if (metaKey || ctrlKey || altKey)
        return false;

    return key === 'Backspace' || key === 'Delete' || key === 'Enter' || Array.from(key).length === 1;
}

class Clipboard {
    public copyType: CopyType = CopyType.NORMAL;
    public pasteType: PasteType = PasteType.NORMAL;
    public copyInfo: string = '';

    get selection() {
        return this.muya.editor.selection;
    }

    get scrollPage() {
        return this.muya.editor.scrollPage;
    }

    static create(muya: Muya) {
        const clipboard = new Clipboard(muya);
        clipboard._listen();

        return clipboard;
    }

    constructor(public muya: Muya) {}

    private _listen() {
        const ownsEvent = () => this.muya.hasFocus();

        const replaceSelection = (event: Event, selection: ISelection, text?: string) => {
            event.preventDefault();
            this.muya.flush();
            this.muya.editor.history.breakGroup();
            if (text === undefined) {
                this.cutHandler();
            }
            else {
                this.muya.editor.history.markInputBoundary('insertText', text);
                let block = selection.anchor.block;
                let start = Math.min(selection.anchor.offset, selection.focus.offset);
                let end = Math.max(selection.anchor.offset, selection.focus.offset);
                if (!selection.isSelectionInSameBlock) {
                    this.cutHandler();
                    // A cross-block cut seats a caret in its surviving leaf.
                    block = this.muya.editor.activeContentBlock!;
                    start = end = block.getCursor()!.start.offset;
                }
                // Replace in one mutation so a non-empty Setext title keeps its
                // heading metadata while an ATX marker can convert normally.
                block.text = block.text.slice(0, start) + text + block.text.slice(end);
                const offset = start + text.length;
                block.setCursor(offset, offset, true);
                // Reuse each content type's input rules, including pairing,
                // language metadata and preview updates.
                block.inputHandler(event);
            }
            this.muya.flush();
            if (text === undefined)
                this.muya.editor.history.breakGroup();
        };

        const beforeInputHandler = (event: Event) => {
            if (
                !ownsEvent() || !isInputEvent(event)
                || event.defaultPrevented || !event.cancelable || event.isComposing
                || this.selection.table.hasSelection
            ) return;

            const deletesText = event.inputType.startsWith('delete')
                && !['deleteByCut', 'deleteByDrag', 'deleteCompositionText'].includes(event.inputType);
            const insertsText = event.inputType === 'insertText' && event.data !== null && event.data.length > 0;
            if (!deletesText && !insertsText)
                return;
            const selection = this.selection.getSelection();
            if (selection && !selection.isCollapsed)
                replaceSelection(event, selection, insertsText ? event.data! : undefined);
        };

        const copyCutHandler = (event: Event) => {
            if (!ownsEvent() || !isClipboardEvent(event))
                return;
            event.preventDefault();
            event.stopPropagation();

            const isCut = event.type === 'cut';

            this.copyHandler(event);

            if (isCut) {
                this.muya.flush();
                this.muya.editor.history.breakGroup();
                this.cutHandler();
                this.muya.flush();
                this.muya.editor.history.breakGroup();
            }
        };

        const keydownHandler = (event: Event) => {
            if (!ownsEvent() || !isKeyboardEvent(event))
                return;
            const { key, metaKey } = event;

            // Let the platform dispatch the cut event so Shift+Delete writes
            // the same clipboard payload as Ctrl/Cmd+X.
            if (key === 'Delete' && event.shiftKey)
                return;

            if (this.selection.table.hasSelection) {
                if (!metaKey && (key === 'Backspace' || key === 'Delete')) {
                    event.preventDefault();
                    deleteTableSelection(this);
                }
                return;
            }

            const selection = this.selection.getSelection();
            if (!selection)
                return;
            if (selection.isSelectionInSameBlock) {
                if (
                    !selection.isCollapsed
                    && !event.defaultPrevented
                    && !event.isComposing && event.keyCode !== 229
                    && !event.metaKey && !event.ctrlKey && !event.altKey
                    && (!event.shiftKey || key === 'Backspace')
                    && (key === 'Backspace' || key === 'Delete')
                ) {
                    // WebKit can remove the content span when deleting a whole
                    // heading. Its subsequent input event has no model endpoint.
                    replaceSelection(event, selection);
                }
                return;
            }

            // WebKit reports the IME's initial replacement key as code 229
            // with a non-printable key name. Prepare its cross-block range
            // through the model before the native preedit starts.
            const startsComposition = event.keyCode === 229;
            if (event.defaultPrevented || (!startsComposition && !shouldCrossBlockCut(key, metaKey, event.ctrlKey, event.altKey)))
                return;

            if (key === 'Backspace' || key === 'Delete') {
                replaceSelection(event, selection);
                return;
            }

            this.muya.flush();
            this.muya.editor.history.breakGroup();
            // Enter over a cross-block selection: suppress the corrupting native
            // Enter and mirror the same-block path — delete then split (#2443).
            if (key === 'Enter') {
                event.preventDefault();
                this.cutHandler();
                const block = this.muya.editor.activeContentBlock;
                if (!event.shiftKey && block instanceof Format)
                    block.enterHandler(event);
                this.muya.flush();
                this.muya.editor.history.breakGroup();
                return;
            }

            this.cutHandler();
        };

        const pasteHandler = (event: Event) => {
            if (ownsEvent() && isClipboardEvent(event))
                this.pasteHandler(event);
        };

        const { eventCenter } = this.muya;

        eventCenter.attachDOMEvent(document, 'copy', copyCutHandler);
        eventCenter.attachDOMEvent(document, 'cut', copyCutHandler);
        eventCenter.attachDOMEvent(document, 'paste', pasteHandler);
        eventCenter.attachDOMEvent(document, 'keydown', keydownHandler);
        // Covers modifier-assisted and native-menu deletion before WebKit can
        // remove the content span that connects the DOM selection to the model.
        eventCenter.attachDOMEvent(this.muya.domNode, 'beforeinput', beforeInputHandler);
    }

    getClipboardData(): IClipboardPayload {
        return getClipboardData(this);
    }

    copyHandler(event: ClipboardEvent): void {
        writeClipboardData(this, event);
    }

    cutHandler(): void {
        cutSelection(this);
    }

    pasteHandler(
        event: ClipboardEvent,
        rawText?: string,
        rawHtml?: string,
    ): Promise<void> {
        return this.muya.trackTask(() => pasteSelection(this, event, rawText, rawHtml));
    }

    copyAsMarkdown() {
        this.copyType = CopyType.COPY_AS_MARKDOWN;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    copyAsHtml() {
        this.copyType = CopyType.COPY_AS_HTML;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    copyAsRich() {
        this.copyType = CopyType.COPY_AS_RICH;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    // Chromium removed programmatic clipboard reads via
    // `document.execCommand('paste')` — it returns false and fires no paste
    // event, so the old flag + execCommand approach pasted nothing. Read the
    // clipboard text ourselves and feed it through the paste pipeline.
    async pasteAsPlainText(): Promise<void> {
        await this.muya.trackTask(async () => {
            const text = await this._readClipboardText();
            if (text && !this.muya.destroyed) await pastePlainText(this, text);
        });
    }

    // Insert an image at the cursor from an explicit `src` (a saved file path or
    // `data:` URL), routing through `imageAction` like a clipboard image paste.
    // Drives the macOS screenshot flow, which can no longer use the removed
    // `document.execCommand('paste')`.
    pasteImage(src: string): Promise<void> {
        return this.muya.trackTask(() => pasteImageSrc(this, src));
    }

    private async _readClipboardText(): Promise<string> {
        // Sandboxed Electron renderers can't reach the system clipboard
        // directly, so the embedder supplies a reader (e.g. an IPC bridge to
        // Electron's native `clipboard`). Fall back to the async Clipboard API
        // for standalone (browser) use.
        const reader = this.muya.options.clipboardText;
        if (typeof reader === 'function') {
            try {
                return await reader();
            }
            catch {
                return '';
            }
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
            try {
                return await navigator.clipboard.readText();
            }
            catch {
                return '';
            }
        }

        return '';
    }

    copy(type: CopyType, info: string) {
        this.copyType = type;
        this.copyInfo = info;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }
}

export default Clipboard;
