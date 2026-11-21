// HTML-string helpers for the legacy template-literal renderers (S2).
// Every data value that reaches innerHTML or an attribute goes through one of these.
// utils.js owns escapeHtml; this file only adds the numeric twin and a safe attr alias.

import { escapeHtml } from '../utils.js';

// Text or attribute context, any value (numbers and null included).
export function esc(value) {
    return escapeHtml(value);
}

// Numeric field: a finite number prints as itself, null/undefined/'' print as '',
// anything else (a hostile string, NaN, Infinity) prints as ''. The result is
// digits, sign, dot and exponent only, so it is safe in text and in value="".
export function escNum(value) {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? String(n) : '';
}

export { escapeHtml };
