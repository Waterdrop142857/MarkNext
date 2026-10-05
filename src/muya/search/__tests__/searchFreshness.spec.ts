import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
const editors: Muya[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); });
function boot() { const host = document.createElement('div'); document.body.appendChild(host); const editor = new Muya(host, { markdown: 'foo bar foo' }); editor.init(); editors.push(editor); return editor; }
describe('search freshness', () => {
  it('clearing a query clears matches and cannot replace old text', () => {
    const editor = boot(); editor.search('foo'); editor.search(''); editor.replace('X', { isSingle: false, isRegexp: false }); editor.flush();
    expect(editor.getMarkdown().trim()).toBe('foo bar foo'); expect(editor.editor.searchModule.matches).toHaveLength(0);
  });
  it.each([true, false])('refreshes current document offsets before replacement (single=%s)', single => {
    const editor = boot(); editor.search('foo');
    editor.editor.scrollPage!.firstContentInDescendant()!.text = 'prefix foo bar foo'; editor.flush();
    editor.replace('X', { isSingle: single, isRegexp: false }); editor.flush();
    expect(editor.getMarkdown().trim()).toBe(single ? 'prefix X bar foo' : 'prefix X bar X');
  });
  it('navigation after content edits uses fresh matches and wraps', () => {
    const editor = boot(); editor.search('foo');
    editor.editor.scrollPage!.firstContentInDescendant()!.text = 'prefix foo bar foo'; editor.flush(); editor.find('next');
    const search = editor.editor.searchModule; expect(search.matches[search.index].start).toBe(7);
    editor.find('previous'); expect(search.matches[search.index].start).toBe(15);
    editor.find('next'); expect(search.matches[search.index].start).toBe(7);
  });
  it('single replacement advances past query text inside its own replacement', () => {
    const editor = boot(); editor.search('foo'); editor.replace('fooX'); editor.flush();
    expect(editor.editor.searchModule.matches[editor.editor.searchModule.index].start).toBe(9);
    editor.replace('fooX'); editor.flush(); expect(editor.getMarkdown().trim()).toBe('fooX bar fooX');
    expect(editor.editor.searchModule.matches[editor.editor.searchModule.index].start).toBe(0);
  });
  it('replacement preserves case and whole-word search options', () => {
    const editor = boot(); editor.editor.scrollPage!.firstContentInDescendant()!.text = 'Foo foo foobar'; editor.flush();
    editor.search('foo', { isCaseSensitive: true, isWholeWord: true });
    editor.replace('X', { isSingle: false, isRegexp: false }); editor.flush();
    expect(editor.editor.searchModule.matches).toHaveLength(0);
    editor.replace('Y', { isSingle: false, isRegexp: false }); editor.flush(); expect(editor.getMarkdown().trim()).toBe('Foo X foobar');
  });
});
