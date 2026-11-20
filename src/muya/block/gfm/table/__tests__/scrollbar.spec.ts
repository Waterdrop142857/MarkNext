// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

let editor: Muya | undefined;
let previousVersion: string | undefined;

afterEach(() => {
    editor?.destroy();
    editor?.domNode.remove();
    document.getSelection()?.removeAllRanges();
    if (previousVersion === undefined)
        Reflect.deleteProperty(window, 'MUYA_VERSION');
    else
        window.MUYA_VERSION = previousVersion;
    vi.restoreAllMocks();
});

it.each([{ y: 280, prevented: false }, { y: 150, prevented: true }])(
    'keeps scrollbar presses native and content padding model-owned at y=$y', ({ y, prevented }) => {
        previousVersion = window.MUYA_VERSION;
        window.MUYA_VERSION = 'test';
        const host = document.createElement('div');
        document.body.appendChild(host);
        editor = new Muya(host, { markdown: '| A | B |\n| --- | --- |\n| first | last |\n' });
        editor.init();
        const figure = editor.domNode.querySelector<HTMLElement>('.mu-table')!;
        vi.spyOn(figure, 'offsetHeight', 'get').mockReturnValue(100);
        vi.spyOn(figure, 'clientHeight', 'get').mockReturnValue(80);
        vi.spyOn(figure, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 200));
        const event = new MouseEvent('mousedown', { clientX: 100, clientY: y, bubbles: true, cancelable: true });

        figure.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(prevented);
        if (prevented) {
            const last = editor.editor.scrollPage!.lastContentInDescendant()!;
            expect(editor.getSelection()?.anchor.block).toBe(last);
            expect(editor.getSelection()?.anchor.offset).toBe(last.text.length);
        }
    },
);
