import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Muya } from '../../../../muya';
import DiagramPreview from '../diagramPreview';
import I18n from '../../../../i18n';
import { en } from '../../../../locales/en';
import { zhCN } from '../../../../locales/zh-CN';
import { refreshLocale } from '../../../../i18n/refresh';
import EventCenter from '../../../../event';

const loader = vi.hoisted(() => vi.fn());
vi.mock('../../../../utils/diagram', () => ({ default: loader }));
const previews: DiagramPreview[] = [];
afterEach(() => { previews.splice(0).forEach(preview => preview.dispose()); document.body.replaceChildren(); loader.mockReset(); });
function boot(type: 'flowchart' | 'vega-lite' = 'flowchart') {
  const root = document.createElement('div'); document.body.appendChild(root);
  const muya = { domNode: root, options: { mermaidTheme: 'default', sequenceTheme: 'hand' }, eventCenter: new EventCenter() } as unknown as Muya;
  muya.i18n = new I18n(muya, en);
  const preview = new DiagramPreview(muya, { name: 'diagram', text: '', meta: { type, lang: 'yaml' } });
  root.appendChild(preview.domNode!); previews.push(preview);
  return { preview, muya };
}
const renderer = { parse: (code: string) => ({ drawSVG(target: HTMLElement) { target.innerHTML = `<svg width="10" height="20"><text>${code}</text></svg>`; } }) };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('diagram render revisions', () => {
  it.each(['success', 'error'])("old %s cannot replace a newer render", async outcome => {
    const old = deferred<typeof renderer>();
    loader.mockReturnValueOnce(old.promise).mockResolvedValue(renderer);
    const { preview } = boot();
    const earlier = preview.update('old'); await preview.update('new');
    expect(preview.domNode!.textContent).toBe('new');
    if (outcome === 'success') old.resolve(renderer); else old.reject(new Error('old failed'));
    await earlier;
    expect(preview.domNode!.textContent).toBe('new');
    expect(preview.domNode!.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 10 20');
  });
  it('clearing invalidates pending results', async () => {
    const old = deferred<typeof renderer>(); loader.mockReturnValue(old.promise);
    const { preview } = boot(); const earlier = preview.update('old'); await preview.update('');
    old.resolve(renderer); await earlier;
    expect(preview.domNode!.textContent).toContain('Empty Diagram');
    expect(preview.domNode!.querySelector('svg')).toBeNull();
  });
  it.each(['destroy', 'remove'])("%s invalidates pending work and subscriptions", async action => {
    const old = deferred<typeof renderer>(); loader.mockReturnValue(old.promise);
    const { preview, muya } = boot(); const earlier = preview.update('old');
    if (action === 'destroy') muya.eventCenter.emit('destroy');
    else { preview.domNode!.remove(); await Promise.resolve(); }
    const before = preview.domNode!.innerHTML;
    old.resolve(renderer); await earlier;
    expect(preview.domNode!.innerHTML).toBe(before);
    expect(muya.eventCenter.listeners.destroy ?? []).toHaveLength(0);
  });
  it('late drawing callbacks mutate only their isolated target', async () => {
    const targets = new Map<string, HTMLElement>();
    loader.mockResolvedValue({ parse: (code: string) => ({ drawSVG: (target: HTMLElement) => { targets.set(code, target); } }) });
    const { preview } = boot(); const old = preview.update('old'); await vi.waitFor(() => expect(targets.has('old')).toBe(true));
    const current = preview.update('new'); await vi.waitFor(() => expect(targets.has('new')).toBe(true));
    targets.get('new')!.innerHTML = '<svg width="10" height="20"><text>new</text></svg>'; await current;
    targets.get('old')!.innerHTML = '<svg width="10" height="20"><text>old</text></svg>'; await old;
    expect(preview.domNode!.textContent).toBe('new');
    expect(targets.get('old')!.isConnected).toBe(false);
  });
  it('identical requests share pending work and do not rerender after success', async () => {
    loader.mockResolvedValue(renderer); const { preview } = boot();
    const a = preview.update('same'), b = preview.update('same'); expect(a).toBe(b); await a;
    const svg = preview.domNode!.querySelector('svg'); await preview.update('same');
    expect(loader).toHaveBeenCalledTimes(1); expect(preview.domNode!.querySelector('svg')).toBe(svg);
  });
  it('stale and destroyed Vega views are finalized', async () => {
    const old = deferred<{ view: { finalize: () => void } }>(); const oldFinalize = vi.fn(), currentFinalize = vi.fn();
    loader.mockResolvedValue(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ view: { finalize: currentFinalize } }));
    const { preview } = boot('vega-lite'); const earlier = preview.update('{"old":true}');
    await Promise.resolve(); await Promise.resolve();
    await preview.update('{"new":true}'); old.resolve({ view: { finalize: oldFinalize } }); await earlier;
    expect(oldFinalize).toHaveBeenCalledTimes(1); expect(currentFinalize).not.toHaveBeenCalled();
    preview.dispose(); expect(currentFinalize).toHaveBeenCalledTimes(1);
  });
  it('updates a pending loading label without restarting rendering, then preserves the successful SVG', async () => {
    const pending = deferred<typeof renderer>(); loader.mockReturnValue(pending.promise);
    const { preview, muya } = boot(); const rendering = preview.update('same');
    muya.i18n.locale(zhCN); refreshLocale(muya);
    expect(preview.domNode!.textContent).toBe('加载中...');
    expect(loader).toHaveBeenCalledTimes(1);
    pending.resolve(renderer); await rendering;
    const svg = preview.domNode!.querySelector('svg');
    muya.i18n.locale(en); refreshLocale(muya); await preview.update('same');
    expect(preview.domNode!.querySelector('svg')).toBe(svg);
    expect(loader).toHaveBeenCalledTimes(1);
  });

});
