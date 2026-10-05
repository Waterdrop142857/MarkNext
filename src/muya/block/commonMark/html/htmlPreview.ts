import type { Muya } from '../../../muya';
import type { IHtmlBlockState, TState } from '../../../state/types';
import { CLASS_NAMES } from '../../../config';
import { getImageSrc } from '../../../utils/image';
import { parseHtmlPreview } from '../../../utils/sanitizeHtmlPreview';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('htmlPreview:');

// Elements whose rendered content comes from attributes (e.g. `src`) rather
// than child nodes, so an empty tag body must not be treated as an empty block.
const SELF_CONTAINED_MEDIA = new Set(['video', 'audio']);

// A single element with an empty body (`<div></div>`), except self-contained
// media elements whose content lives in attributes (`<video src=...></video>`).
export function isEmptyHtmlBlock(html: string): boolean {
    // eslint-disable-next-line regexp/no-super-linear-backtracking, regexp/optimal-quantifier-concatenation
    const match = html.trim().match(/^<([a-z][a-z\d]*)[^>]*>\s*<\/\1>$/);
    return !!match && !SELF_CONTAINED_MEDIA.has(match[1]);
}

class HTMLPreview extends Parent {
    private _html: string;
    private _revision = 0;
    private _empty = false;

    static override blockName = 'html-preview';

    static create(muya: Muya, state: IHtmlBlockState) {
        const htmlBlock = new HTMLPreview(muya, state);

        return htmlBlock;
    }

    override get path() {
        debug.warn('You can never call `get path` in htmlPreview');
        return [];
    }

    constructor(muya: Muya, { text }: IHtmlBlockState) {
        super(muya);
        this.tagName = 'div';
        this._html = text;
        this.classList = [CLASS_NAMES.MU_HTML_PREVIEW];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this.update();
    }

    update(html = this._html) {
        const revision = ++this._revision;
        if (this._html !== html)
            this._html = html;

        const { disableHtml, resolveImageSrc, prepareImageSrc } = this.muya.options;
        const doc = parseHtmlPreview(html, disableHtml);
        const htmlContent = doc.body.innerHTML;

        // handle empty html bock
        this._empty = isEmptyHtmlBlock(htmlContent);
        if (this._empty) this.refreshLocale();
        else {
            const imgs = doc.documentElement.querySelectorAll('img');

            for (const img of imgs) {
                const src = img.getAttribute('src')!;
                const imageSrc = getImageSrc(src, resolveImageSrc);
                if (prepareImageSrc) {
                    img.removeAttribute('src');
                    // Keep this exact element so stale preparations cannot mutate
                    // a subsequent preview. No asset request precedes permission.
                    void prepareImageSrc(imageSrc.src).then(() => {
                        if (revision === this._revision && imageSrc.src && this.domNode?.contains(img)) img.src = imageSrc.src;
                    }).catch(() => img.classList.add(CLASS_NAMES.MU_IMAGE_FAIL));
                }
                else if (imageSrc.src) img.setAttribute('src', imageSrc.src);
                else img.removeAttribute('src');
            }

            this.domNode!.replaceChildren(...doc.body.childNodes);
        }
    }

    refreshLocale() {
        if (this._empty) {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}"></div>`;
            this.domNode!.firstElementChild!.textContent = `<${this.muya.i18n.t('Empty HTML Block')}>`;
        }
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in htmlPreview');
        return {} as TState;
    }
}

export default HTMLPreview;
