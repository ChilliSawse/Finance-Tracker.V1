// Explain this number (owner: F8b, 03d section 8 "Trust"). Plain lines for one output, built from the same figures
// the result set holds: F4's `explainRequired` for the goal figures, F3's `explainFi` for the long-range ones, and the
// split for the rest. No amount is typed here; words come from the catalogue (`f.res.ex.*`).

import { t } from '../../i18n/strings.js';
import { explainRequired, audCents } from '../../calc/goal-planner.js';
import { explainFi } from '../../calc/fi.js';
import { fmtMoney } from './starters.js';
import { openSheet } from '../sheet.js';

const money = (c) => fmtMoney(c / 100);
const FI_ROWS = new Set(['fiYears', 'fiNumber', 'nw1', 'nw5', 'nw10', 'nw20']);
const PLAN_ROWS = new Set(['required', 'short', 'earnGap']);

/**
 * The lines for one row of a result set, as plain strings (the scenario figure's working, after "Now x; scenario y").
 * @param {object} set from buildResultSet
 * @param {string} rowId
 * @returns {string[]}
 */
export function explainLines(set, rowId) {
    const row = set.rows.find((r) => r.id === rowId);
    if (!row) return [];
    const lines = [t('f.res.ex.vs', { now: row.now.text || t('f.res.dash'), scenario: row.scen.text || t('f.res.dash') })];
    const s = set.scen;
    if (row.id === 'takeHome') {
        lines.push(t('f.res.ex.takeHome', { amount: money(s.net) }));
    } else if (row.role && s.byRole[row.role] && row.id === row.role) {
        const b = s.byRole[row.role];
        lines.push(t('f.res.ex.bucket', { name: b.name, pct: b.pct, net: money(s.net), amount: money(b.perPay) }));
    } else if (row.id === 'savingsRate') {
        const save = s.buckets.filter((b) => b.kind === 'save').reduce((sum, b) => sum + b.perPayCents, 0);
        const all = s.buckets.reduce((sum, b) => sum + b.perPayCents, 0);
        lines.push(t('f.res.ex.savings', { save: money(save), net: money(all) }));
    } else if (row.kind === 'goal' || PLAN_ROWS.has(row.id)) {
        const plan = s.plan;
        if (plan) {
            const ex = explainRequired(plan);
            if (ex.lines.length) {
                lines.push(t('f.res.ex.binding', { name: ex.goalName || t('f.res.goal.unnamed') }), ...ex.lines);
                lines.push(t('f.res.ex.smileGets', { smile: audCents(plan.smilePerPayCents), gap: audCents(plan.gapCents) }));
            } else lines.push(t('f.res.ex.noGoalNeed'));
        }
    } else if (FI_ROWS.has(row.id)) {
        if (s.summary) for (const l of explainFi(s.resolved, { summary: s.summary })) lines.push(l.text);
    } else if (row.id === 'debts') {
        lines.push(t('f.res.ex.debts', { amount: money(s.debts) }));
    } else if (row.id === 'help') {
        lines.push(t('f.res.ex.help'));
    } else if (row.id === 'mojoBalance' || row.id === 'mojo') {
        lines.push(t('f.res.ex.mojo'));
    }
    return lines;
}

/** Open the lines in a read-only sheet. Everything is set with textContent. */
export function openExplain(set, rowId) {
    const row = set.rows.find((r) => r.id === rowId);
    if (!row) return false;
    const ol = document.createElement('ol');
    ol.className = 'res-explain-lines';
    for (const line of explainLines(set, rowId)) {
        const li = document.createElement('li');
        li.textContent = line;
        ol.appendChild(li);
    }
    openSheet({ title: t('f.res.explainTitle', { name: row.label }), readOnly: true, content: [ol] });
    return true;
}
