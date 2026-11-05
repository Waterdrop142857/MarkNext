// @vitest-environment happy-dom

import katexCss from 'katex/dist/katex.css?inline';
import { describe, expect, it } from 'vitest';
import { embedKatexFonts } from '../embedKatexFonts';

describe('embedKatexFonts', () => {
    it('rewrites every @font-face src to an embedded woff2 data URI', () => {
        const out = embedKatexFonts(katexCss);

        const faces = out.match(/@font-face\s*\{[^}]*\}/g) ?? [];
        expect(faces.length).toBe(20);
        for (const face of faces) {
            expect(face).toMatch(/src:\s*url\(data:font\/woff2;base64,[^)]+\)\s*format\("woff2"\);/);
        }
    });

    it('drops the now-broken relative font references and woff/ttf fallbacks', () => {
        const out = embedKatexFonts(katexCss);

        expect(out).not.toMatch(/url\(\s*fonts\//);
        expect(out).not.toContain('format("woff")');
        expect(out).not.toContain('format("truetype")');
    });

    it('embeds every face after production minification normalizes font weights', () => {
        const minified = katexCss.replace(/font-weight:\s*normal/g, 'font-weight:400')
            .replace(/font-weight:\s*bold/g, 'font-weight:700');
        const out = embedKatexFonts(minified);
        const faces = out.match(/@font-face\s*\{[^}]*\}/g) ?? [];
        expect(faces).toHaveLength(20);
        for (const face of faces) {
            expect(face).toMatch(/src:\s*url\(data:font\/woff2;base64,[^)]+\)\s*format\("woff2"\);/);
            expect(face).not.toContain('format("woff")');
            expect(face).not.toContain('format("truetype")');
        }
    });

    it('leaves non @font-face css untouched', () => {
        const out = embedKatexFonts('.katex { font-size: 1.21em; }');
        expect(out).toBe('.katex { font-size: 1.21em; }');
    });

    it('replaces an already inlined source without leaving data URL fragments', () => {
        const css = '@font-face{font-family:KaTeX_Size3;src:url(data:font/woff2;base64,OLD_FONT) format("woff2"),url(old.ttf) format("truetype");font-weight:400;font-style:normal;}';
        const out = embedKatexFonts(css);
        expect(out).not.toContain('OLD_FONT');
        expect(out).not.toContain('old.ttf');
        expect(out.match(/base64,/g)).toHaveLength(1);
        expect(out).toContain('font-weight:400;font-style:normal;');
    });
});
