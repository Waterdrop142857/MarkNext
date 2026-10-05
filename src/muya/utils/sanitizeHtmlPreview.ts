import { PREVIEW_DOMPURIFY_CONFIG } from '../config';
import { sanitize } from './index';

// Preserve ordinary document formatting without allowing preview content to
// position itself over the editor shell or reference host CSS variables.
const PRESENTATION_PROPERTIES = new Set([
    'color', 'background-color', 'font-family', 'font-size', 'font-weight',
    'font-style', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-decoration', 'text-decoration-color', 'text-decoration-style',
    'text-transform', 'white-space', 'overflow-wrap', 'word-break', 'vertical-align',
    'border', 'border-color', 'border-style', 'border-width', 'border-radius',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-collapse', 'border-spacing', 'padding', 'padding-top', 'padding-right',
    'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right',
    'margin-bottom', 'margin-left', 'width', 'height', 'max-width', 'max-height',
    'min-width', 'min-height', 'list-style-type', 'list-style-position',
    'fill', 'stroke', 'stroke-width',
]);

const EXTERNAL_OR_INDIRECT_VALUE = /(?:url|image-set|expression|var|env)\s*\(|@import|[\\<>\u0000-\u001F]/i;

/** Shared by block previews and rendered inline HTML. */
export function sanitizePreviewStyle(value: string, doc = document): string {
    const source = doc.createElement('span').style;
    const safe = doc.createElement('span').style;
    source.cssText = value;
    for (let index = 0; index < source.length; index += 1) {
        const property = source.item(index).toLowerCase();
        const declaration = source.getPropertyValue(property);
        if (PRESENTATION_PROPERTIES.has(property) && !EXTERNAL_OR_INDIRECT_VALUE.test(declaration))
            safe.setProperty(property, declaration);
    }
    return safe.cssText;
}

/** Sanitize before attaching any HTML/CSS to the application document. */
export function parseHtmlPreview(html: string, disableHtml: boolean): Document {
    const cleaned = sanitize(html, PREVIEW_DOMPURIFY_CONFIG, disableHtml) as string;
    const doc = new DOMParser().parseFromString(cleaned, 'text/html');
    for (const element of doc.body.querySelectorAll<HTMLElement>('[style]')) {
        const safe = sanitizePreviewStyle(element.getAttribute('style') ?? '', doc);
        if (safe)
            element.setAttribute('style', safe);
        else
            element.removeAttribute('style');
    }
    return doc;
}
