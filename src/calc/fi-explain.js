// Explain this number (FI engine, F3; DB12 adds the home loan, held-out, bridge and birth-year lines). Plain lines with the same
// figures `fiSummary` carries. It lives apart from fi.js so the Future and What If catalogue it reads stays out of the first load:
// fi.js is pure maths with no strings, and only the Future and What If screens (and the tests) import this file.

import '../i18n/en-lazy-future.js'; // the f.fi.explain lines added in DB12 (en-lazy)
import { t } from '../i18n/strings.js';
import { fiSummary, PRESERVATION_AGE } from './fi.js';

const money = (n) => `A$${Math.round(Math.abs(n)).toLocaleString('en-AU')}`;

/**
 * Explain this number: plain lines with the same figures the summary carries.
 * @param {object} data
 * @param {{summary?:object, today?:*, changes?:Array, resolve?:Function}} [opts]
 * @returns {Array<{id:string, text:string}>}
 */
export function explainFi(data, opts = {}) {
    const s = opts.summary || fiSummary(data, opts);
    const lines = [];
    const add = (id, key, params) => lines.push({ id, text: t(key, params) });
    add('number', 'f.fi.explain.number', { number: money(s.fiNumber), multiple: s.multiple, spend: money(s.spendYear) });
    add('going', 'f.fi.explain.going', { fire: money(s.going.fire), super: money(s.going.super) });
    add('rate', 'f.fi.explain.rate', { real: s.realReturnPct, inflation: s.inflationPct });
    const out = s.loansOut && s.loansOut.count > 0;
    add('now', out ? 'f.fi.explain.nowOut' : 'f.fi.explain.now', { fiNetWorth: money(s.now.fiNetWorth) });
    if (out) add('homeLoanOut', 'f.fi.explain.homeLoanOut', { amount: money(s.loansOut.balance) });
    if (s.fireToHomeLoan) add('fireHomeLoan', 'f.fi.explain.fireHomeLoan');
    if (s.heldOut && s.heldOut.count > 0) add('heldOut', s.heldOut.count === 1 ? 'f.fi.explain.heldOut.one' : 'f.fi.explain.heldOut', { count: s.heldOut.count, amount: money(s.heldOutValue) });
    if (s.superNoBirth) add('noBirth', 'f.fi.explain.noBirth', { age: PRESERVATION_AGE });
    if (s.notes.includes('includesHelp')) add('help', 'f.fi.explain.help', { amount: money(s.now.help) });
    if (s.notes.includes('losesValue')) add('losesValue', 'f.fi.explain.losesValue', { amount: money(s.now.depreciating) });
    if (s.notes.includes('superPreservation')) add('superPreservation', 'f.fi.explain.superPreservation', { age: PRESERVATION_AGE });
    if (s.notes.includes('spendingBias')) add('spendingBias', 'f.fi.explain.spendingBias');
    add('notModelled', 'f.fi.explain.notModelled');
    for (const n of s.nudges) add('minRepayment', 'f.fi.explain.minRepayment', { name: n.name });
    return lines;
}
