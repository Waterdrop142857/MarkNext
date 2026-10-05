import type Content from '../block/base/content';
import type TreeNode from '../block/base/treeNode';
import type { IHighlight } from '../inlineRenderer/types';
import type { Muya } from '../muya';
import type { IMatch } from './types';
import { DEFAULT_SEARCH_OPTIONS } from '../config';
import { buildRegexValue, matchString } from '../utils/search';

export class Search {
    private _value: string = '';
    public matches: IMatch[] = [];
    public index: number = -1;
    private _document = '';
    private _options = {};

    get value() {
        return this._value;
    }

    private get _scrollPage() {
        return this._muya.editor.scrollPage;
    }

    constructor(private _muya: Muya) {}

    // Drop match state when the document is replaced (e.g. a tab switch), so
    // stale matches don't reference the previous document's blocks (#1932).
    reset() {
        this._value = '';
        this.matches = [];
        this.index = -1;
        this._document = '';
        this._options = {};
    }

    private _updateMatches(isClear = false) {
        const { matches, index } = this;
        let i;
        const len = matches.length;
        const matchesMap = new Map<Content, IHighlight[]>();

        for (i = 0; i < len; i++) {
            const { block, start, end } = matches[i];
            const active = i === index;
            const highlight: IHighlight = { start, end, active };
            const highlights = matchesMap.get(block);

            if (matchesMap.has(block) && Array.isArray(highlights)) {
                highlights.push(highlight);
                matchesMap.set(block, highlights);
            }
            else {
                matchesMap.set(block, [highlight]);
            }
        }

        for (const [block, highlights] of matchesMap.entries()) {
            const isActive = highlights.some(h => h.active);

            block.update(undefined, isClear ? [] : highlights);

            if (block.parent?.active && !isActive)
                block.blurHandler();

            if (isActive && !isClear)
                block.focusHandler();
        }
    }

    private _innerReplace(matches: IMatch[], value: string) {
        if (!matches.length)
            return;

        let tempText = '';
        let lastBlock = matches[0].block;
        let lastEnd = 0;

        for (const match of matches) {
            const { start, end, block } = match;
            if (lastBlock !== block) {
                if (lastBlock)
                    lastBlock.text = tempText + lastBlock.text.substring(lastEnd);

                tempText = '';
                lastEnd = 0;
                lastBlock = block;
            }

            tempText += block.text.substring(lastEnd, start);
            tempText += value;
            lastEnd = end;
        }

        lastBlock.text = tempText + lastBlock.text.substring(lastEnd);
    }

    replace(replaceValue: string, opt = { isSingle: true, isRegexp: false }) {
        this._refresh();
        const { isSingle, isRegexp, ...rest } = opt;
        const options = Object.assign({}, DEFAULT_SEARCH_OPTIONS, this._options, rest);
        const { matches, index } = this;
        const value = this._value;

        if (matches.length && (!isSingle || (index >= 0 && index < matches.length))) {
            const replaced = isSingle ? matches[index] : undefined;
            if (isRegexp)
                replaceValue = buildRegexValue(matches[index], replaceValue);

            if (isSingle) {
                // replace one
                this._innerReplace([matches[index]], replaceValue);
            }
            else {
                // replace all
                this._innerReplace(matches, replaceValue);
            }
            // Commit the queued text operations before recording the search
            // snapshot, or the next command mistakes this replacement for an
            // external edit and resets the active match to the first one.
            this._muya.flush();
            this.search(value, {
                ...options,
                highlightIndex: -1,
            });
            if (replaced && this.matches.length) {
                // Follow the replacement boundary, rather than its old match
                // index: the replacement itself may still contain the query.
                const order = new Map<Content, number>();
                this._scrollPage?.depthFirstTraverse((block: TreeNode) => {
                    if (block.isContent()) order.set(block, order.size);
                });
                const replacedOrder = order.get(replaced.block)!;
                const next = this.matches.findIndex(match => {
                    const blockOrder = order.get(match.block)!;
                    return blockOrder > replacedOrder || (blockOrder === replacedOrder && match.start >= replaced.start + replaceValue.length);
                });
                this._updateMatches(true);
                this.index = next < 0 ? 0 : next;
                this._updateMatches();
            }
        }

        return this;
    }

    /**
     * Find preview or next value, and highlight it.
     * @param {string} action : previous or next.
     */
    find(action: 'previous' | 'next'): this {
        if (this._refresh()) {
            if (action === 'previous' && this.matches.length) {
                this.index = this.matches.length - 1;
                this._updateMatches();
            }
            return this;
        }
        const { matches } = this;
        let { index } = this;
        const len = matches.length;

        if (!len)
            return this;

        index = action === 'next' ? index + 1 : index - 1;

        if (index < 0)
            index = len - 1;

        if (index >= len)
            index = 0;

        this.index = index;

        this._updateMatches(true);
        this._updateMatches();

        return this;
    }

    /**
     * Search value in current document.
     * @param {string} value
     * @param {object} opts
     */
    search(value: string, opts = {}) {
        const matches: IMatch[] = [];
        const options = Object.assign({}, DEFAULT_SEARCH_OPTIONS, opts);
        const { highlightIndex, selectHighlight } = options;
        let index = -1;

        // The currently active match, captured before it is cleared below, so a
        // `selectHighlight` request can drop the cursor back onto it when the
        // new search has no match of its own (e.g. closing the search bar).
        const prevActiveMatch = this.matches[this.index];

        // Empty last search.
        this._updateMatches(true);

        // Highlight current search.
        if (value) {
            this._scrollPage?.depthFirstTraverse((block: TreeNode) => {
                if (block.isContent()) {
                    const { text } = block;
                    if (text && typeof text === 'string') {
                        const strMatches = matchString(text, value, options);
                        matches.push(
                            ...strMatches.map(({ index, match, subMatches }) => {
                                return {
                                    block,
                                    start: index,
                                    end: index + match.length,
                                    match,
                                    subMatches,
                                };
                            }),
                        );
                    }
                }
            });
        }

        if (highlightIndex >= 0 && highlightIndex < matches.length) {
            // If set the highlight index, then highlight the highlighIndex
            index = highlightIndex;
        }
        else if (matches.length) {
            // highlight the first word that matches.
            index = 0;
        }

        Object.assign(this, { _value: value, matches, index });
        this._options = options;
        this._document = this._muya.getMarkdown();

        this._updateMatches();

        // Restore the editor cursor onto the active match. Mirrors muyajs's
        // `render(selectHighlight)` -> `setCursor()` path: closing the search
        // bar empties the search with `selectHighlight`, which must place the
        // cursor where the highlight was so the user can keep typing there.
        if (selectHighlight) {
            const activeMatch = matches[index] ?? prevActiveMatch;
            if (activeMatch) {
                const { block, start, end } = activeMatch;
                block.setCursor(start, end, true);
            }
        }

        return this;
    }

    private _refresh(): boolean {
        if (this._value && this._muya.getMarkdown() !== this._document) {
            this.search(this._value, { ...this._options, highlightIndex: -1 });
            return true;
        }
        return false;
    }
}
