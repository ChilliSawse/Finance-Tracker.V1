// t() — string lookup with {param} interpolation.
// English-only ships today; a translation is a sibling catalogue with the same
// keys. Missing keys warn and fall back to the key itself so a hole in a
// catalogue never blanks the UI.

import { en } from './en.js';

const strings = en;

/**
 * @param {string} key - catalogue key (e.g. 'feed.today').
 * @param {Object<string, string|number>} [params] - {placeholder} fills.
 * @returns {string}
 */
export function t(key, params) {
    let s = strings[key];
    if (s == null) {
        console.warn(`Missing i18n key: ${key}`);
        return key;
    }
    if (params) {
        s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
    }
    return s;
}

/** Convenience for the one/many word pairs the catalogue uses. */
export function plural(count, oneKey, manyKey) {
    return t(count === 1 ? oneKey : manyKey, { count });
}
