// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { en, zhCN } from '../../../../locales';
import { Muya } from '../../../../muya';

const editors: Muya[] = [];
const originalVersion = window.MUYA_VERSION;
afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    document.body.replaceChildren();
    if (originalVersion === undefined) delete (window as Partial<Window>).MUYA_VERSION;
    else window.MUYA_VERSION = originalVersion;
});

function preview(html: string) {
    window.MUYA_VERSION = 'test';
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    document.body.appendChild(shell);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = new Muya(host, { markdown: `${html}\n\nafter` });
    editor.init();
    editors.push(editor);
    return { editor, shell, node: editor.domNode.querySelector<HTMLElement>('.mu-html-preview')! };
}

describe('HTML preview isolation', () => {
    it.each(['style', 'STYLE', 'sTyLe'])('does not let a %s tag style the application', tag => {
        const raw = `<div><${tag}>.app-shell { display:none !important }</${tag}><p>content</p></div>`;
        const { editor, shell, node } = preview(raw);
        expect(node.querySelector('style')).toBeNull();
        expect(getComputedStyle(shell).display).not.toBe('none');
        expect(node.textContent).toContain('content');
        expect(editor.getMarkdown()).toContain(raw);
    });

    it('removes viewport positioning, stacking, transforms and host variable references', () => {
        const { node } = preview('<div><p style="position:fixed;inset:0;z-index:999999;transform:scale(99);color:var(--app-fg);background-color:red">overlay</p></div>');
        const styled = node.querySelector<HTMLElement>('p')!;
        expect(styled.style.position).toBe('');
        expect(styled.style.zIndex).toBe('');
        expect(styled.style.transform).toBe('');
        expect(styled.style.color).toBe('');
        expect(styled.getAttribute('style')).not.toContain('inset');
        expect(styled.style.backgroundColor).toBe('red');
    });

    it('keeps safe text, table and image formatting without changing source Markdown', () => {
        const raw = '<div><p style="color:SteelBlue;text-align:center;font-weight:bold;padding:4px;border:1px solid black">styled</p><table><tbody><tr><td>cell</td></tr></tbody></table><img src="https://example.com/a.png" alt="picture"></div>';
        const { editor, node } = preview(raw);
        expect(node.querySelector<HTMLElement>('p')!.style.textAlign).toBe('center');
        expect(node.querySelector<HTMLElement>('p')!.style.fontWeight).toBe('bold');
        expect(node.querySelector<HTMLElement>('p')!.style.color.toLowerCase()).toBe('steelblue');
        expect(node.querySelector('td')!.textContent).toBe('cell');
        expect(node.querySelector('img')!.getAttribute('src')).toBe('https://example.com/a.png');
        expect(editor.getMarkdown()).toContain(raw);
    });

    it('rejects stylesheet links, SVG animation and event handlers before insertion', () => {
        const { node } = preview('<div><link rel="stylesheet" href="/tests/e2e/fixtures/host-style.css"><svg><set attributeName="style" to="position:fixed"/><text>SVG</text></svg><p onclick="alert(1)" style="color:red!important">text</p></div>');
        expect(node.querySelector('link,style,set,animate')).toBeNull();
        expect(node.querySelector('p')!.hasAttribute('onclick')).toBe(false);
        expect(node.querySelector<HTMLElement>('p')!.style.getPropertyPriority('color')).toBe('');
    });

    it('applies the same style policy to inline HTML without changing its source', () => {
        const raw = 'before <span style="position:fixed;inset:0;z-index:999999;color:SteelBlue">inline content</span> after';
        const { editor } = preview(raw);
        const inline = editor.domNode.querySelector<HTMLElement>('.mu-raw-html')!;
        expect(inline).not.toBeNull();
        expect(inline.style.position).toBe('');
        expect(inline.style.zIndex).toBe('');
        expect(inline.style.color.toLowerCase()).toBe('steelblue');
        expect(editor.getMarkdown()).toContain(raw);
    });
    it('changes only the empty-preview label, preserving rendered user HTML and source', () => {
        const raw = '<div><p>Paragraph</p><span data-muya-i18n="Empty Diagram">user label</span></div>';
        const { editor, node } = preview(raw);
        const child = node.querySelector('p')!;
        const label = node.querySelector('span')!;
        // Even a user-supplied translation attribute cannot become app UI.
        label.setAttribute('data-muya-i18n', 'Empty Diagram');
        const before = editor.getMarkdown();
        editor.locale(zhCN);
        expect(node.querySelector('p')).toBe(child);
        expect(child.textContent).toBe('Paragraph');
        expect(label.textContent).toBe('user label');
        expect(editor.getMarkdown()).toBe(before);
        const empty = preview('<div></div>');
        empty.editor.locale(zhCN); expect(empty.node.textContent).toBe('<空 HTML 块>');
        empty.editor.locale(en); expect(empty.node.textContent).toBe('<Empty HTML Block>');
    });

});
