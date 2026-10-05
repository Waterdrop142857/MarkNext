import type HTMLPreview from '../block/commonMark/html/htmlPreview';
import type { Muya } from '../muya';
import { BLOCK_DOM_PROPERTY, CLASS_NAMES } from '../config';

/** Refresh editor-owned labels without rebuilding content, selections or previews. */
export function refreshLocale(muya: Muya) {
    const { domNode, i18n } = muya;
    const bindings: [string, string, string][] = [
        ['.mu-paragraph-content[empty-hint]', 'empty-hint', 'Type / to insert...'],
        ['.mu-language-input[hint]', 'hint', 'Input Language Identifier...'],
        ['.mu-codeblock-content', 'frontMatter', 'Input Front Matter...'],
        ['.mu-codeblock-content', 'math', 'Input Mathematical Formula...'],
        [`.${CLASS_NAMES.MU_INLINE_IMAGE}`, 'empty-text', 'Click to add an image'],
        [`.${CLASS_NAMES.MU_INLINE_IMAGE}`, 'fail-text', 'Load image failed'],
        [`.${CLASS_NAMES.MU_COPY_HEADER_LINK}`, 'title', 'Copy anchor link to this heading'],
        [`.${CLASS_NAMES.MU_COPY_HEADER_LINK}`, 'aria-label', 'Copy anchor link to this heading'],
        ['.mu-code-copy', 'title', 'Copy content'],
    ];
    for (const [selector, attribute, key] of bindings) {
        for (const element of domNode.querySelectorAll<HTMLElement>(selector)) {
            if (element.closest('.mu-html-preview')) continue;
            const value = i18n.t(key);
            element.setAttribute(attribute, value);
            const block = element[BLOCK_DOM_PROPERTY];
            if (block) block.attributes[attribute] = value;
        }
    }
    for (const element of domNode.querySelectorAll<HTMLElement>('[data-muya-i18n]')) {
        if (!element.closest('.mu-html-preview'))
            element.textContent = i18n.t(element.dataset.muyaI18n!);
    }
    for (const element of domNode.querySelectorAll<HTMLElement>('.mu-html-preview'))
        (element[BLOCK_DOM_PROPERTY] as HTMLPreview | undefined)?.refreshLocale();
    // An open slash prompt has a transient placeholder beyond its empty hint.
    for (const element of domNode.querySelectorAll<HTMLElement>('.mu-paragraph-content[placeholder]'))
        element.setAttribute('placeholder', i18n.t('Search keyword...'));
    for (const element of domNode.querySelectorAll<HTMLElement>(`.${CLASS_NAMES.MU_MATH_RENDER}.${CLASS_NAMES.MU_MATH_ERROR}`))
        element.textContent = `<${i18n.t('Invalid Mathematical Formula')}>`;
    muya.eventCenter.emit('locale-change');
}
