import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import { fromEvent, type Subscription } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import loadRenderer from '../../../utils/diagram';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('diagramPreview:');

// Give a fixed-size `<svg>` (one with `width`/`height` px attributes but no
// `viewBox`) a viewBox derived from those dimensions, so `max-width: 100%`
// scales it down to fit instead of clipping it. Returns true once applied.
function addViewBox(target: HTMLElement): boolean {
    const svg = target.querySelector('svg');
    if (!svg || svg.getAttribute('viewBox'))
        return !!svg;
    const width = Number.parseFloat(svg.getAttribute('width') ?? '');
    const height = Number.parseFloat(svg.getAttribute('height') ?? '');
    if (width > 0 && height > 0) {
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        return true;
    }
    return false;
}

// `drawSVG` (js-sequence-diagrams / flowchart.js) renders the `<svg>`
// asynchronously — it's drawn from a theme callback after its font loads — so
// the element and its `width`/`height` attributes aren't there synchronously.
// Try once, then observe `target` until the sized `<svg>` appears.
function ensureViewBox(target: HTMLElement, signal: AbortSignal): Promise<void> {
    if (signal.aborted || addViewBox(target)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const finish = (error?: Error) => {
            observer.disconnect();
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve();
        };
        const abort = () => finish();
        const observer = new MutationObserver(() => { if (addViewBox(target)) finish(); });
        const timer = setTimeout(() => finish(new Error('Diagram renderer did not produce an SVG')), 5000);
        signal.addEventListener('abort', abort, { once: true });
        observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] });
    });
}

interface IRenderOptions {
    type: string;
    code: string;
    target: HTMLElement;
    vegaTheme: string;
    mermaidTheme: string;
    plantumlServer: string;
    sequenceTheme: 'hand' | 'simple';
    signal: AbortSignal;
}

async function renderDiagram({
    type,
    code,
    target,
    vegaTheme,
    mermaidTheme,
    plantumlServer,
    sequenceTheme,
    signal,
}: IRenderOptions) {
    const render = await loadRenderer(type);
    if (signal.aborted) return;
    const options = {};
    if (type === 'vega-lite') {
        Object.assign(options, {
            actions: false,
            tooltip: false,
            renderer: 'svg',
            theme: vegaTheme,
            ast: true,
        });
    }
    else if (type === 'sequence') {
        Object.assign(options, { theme: sequenceTheme });
    }

    if (type === 'plantuml') {
        const diagram = render.parse(code, plantumlServer);
        target.innerHTML = '';
        diagram.insertImgElement(target);
    }
    else if (type === 'vega-lite') {
        const result = await render(target, JSON.parse(code), options);
        return () => result?.view?.finalize();
    }
    else if (type === 'flowchart' || type === 'sequence') {
        const diagram = render.parse(code);
        target.innerHTML = '';
        diagram.drawSVG(target, options);
        // js-sequence-diagrams / flowchart.js emit an <svg> with a fixed pixel
        // width/height but NO viewBox, so the `max-width: 100%` style can only
        // clip a wide diagram, not scale it. Derive a viewBox from those pixel
        // dimensions (once the async draw completes) so it scales to fit.
        await ensureViewBox(target, signal);
    }
    else if (type === 'mermaid') {
        render.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: mermaidTheme,
        });
        await render.parse(code);
        if (signal.aborted) return;
        target.innerHTML = sanitize(code, PREVIEW_DOMPURIFY_CONFIG, true) as string;
        target.removeAttribute('data-processed');
        await render.run({
            nodes: [target],
        });
    }
}

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    private _revision = 0;
    private _key = '';
    private _pending: Promise<void> = Promise.resolve();
    private _controller?: AbortController;
    private _stage?: HTMLElement;
    private _cleanup?: () => void;
    private _observer?: MutationObserver;
    private _clickSubscription?: Subscription;
    private _disposed = false;
    private _onDestroy = () => this.dispose();
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
            'data-diagram-type': this._type,
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.muya.eventCenter?.on('destroy', this._onDestroy);
        if (this.muya.domNode) {
            this._observer = new MutationObserver(() => {
                if (!this.muya.domNode.contains(this.domNode ?? null)) this.dispose();
            });
            this._observer.observe(this.muya.domNode, { childList: true, subtree: true });
        }
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        this._clickSubscription = clickObservable.subscribe(this.clickHandler.bind(this));
    }

    clickHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.parent == null)
            return;

        const cursorBlock = this.parent.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    update(code = this._code): Promise<void> {
        if (this._disposed) return Promise.resolve();
        const { i18n } = this.muya;
        const { mermaidTheme, vegaTheme, plantumlServer, sequenceTheme } = this.muya.options;
        const theme = this._type === 'mermaid' ? mermaidTheme
            : this._type === 'vega-lite' ? vegaTheme
                : this._type === 'plantuml' ? plantumlServer
                    : this._type === 'sequence' ? sequenceTheme : '';
        const key = JSON.stringify([code, theme]);
        if (key === this._key) return this._pending;
        this._key = key;
        this._code = code;
        const revision = ++this._revision;
        this._controller?.abort();
        this._stage?.remove();
        this._cleanup?.();
        this._cleanup = undefined;
        if (code) {
            const controller = this._controller = new AbortController();
            this.domNode!.innerHTML = `<span data-muya-i18n="Loading...">${i18n.t('Loading...')}</span>`;
            // Measurement-dependent renderers need a connected node. Each
            // revision gets its own hidden target; stale callbacks never see
            // the live preview target belonging to a later revision.
            const stage = this._stage = document.createElement('div');
            stage.className = 'mu-diagram-staging';
            stage.style.cssText = 'position:absolute;width:100%;visibility:hidden;pointer-events:none';
            this.domNode!.appendChild(stage);
            const { _type: type } = this;
            this._pending = (async () => {
                try {
                    const cleanup = await renderDiagram({
                        target: stage,
                        code,
                        type,
                        mermaidTheme,
                        vegaTheme,
                        plantumlServer,
                        sequenceTheme,
                        signal: controller.signal,
                    });
                    if (revision !== this._revision || this._disposed) {
                        cleanup?.();
                        return;
                    }
                    this._cleanup = cleanup || undefined;
                    this.domNode!.replaceChildren(...stage.childNodes);
                    this._stage = undefined;
                }
                catch (error) {
                    if (revision !== this._revision || this._disposed) return;
                    this._key = '';
                    const detail = error instanceof Error ? error.message : String(error);
                    debug.error(`render ${type} diagram failed: ${detail}`);
                    this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; <span data-muya-i18n="Invalid Diagram Code">${i18n.t(
                        'Invalid Diagram Code',
                    )}</span> &gt;<div class="mu-diagram-error-detail">${sanitize(
                        detail,
                        PREVIEW_DOMPURIFY_CONFIG,
                        true,
                    )}</div></div>`;
                }
                finally { stage.remove(); }
            })();
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; <span data-muya-i18n="Empty Diagram">${i18n.t(
                'Empty Diagram',
            )}</span> &gt;</div>`;
            this._pending = Promise.resolve();
        }
        return this._pending;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._revision += 1;
        this._controller?.abort();
        this._stage?.remove();
        this._cleanup?.();
        this._observer?.disconnect();
        this._clickSubscription?.unsubscribe();
        this.muya.eventCenter?.off('destroy', this._onDestroy);
    }
}

export default DiagramPreview;
