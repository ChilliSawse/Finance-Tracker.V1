// Learned rules, review status and the manual/import merge (owner: B8).
//
// financeData.rules = [{ key, categoryId, bucketId? }], key = merchantKey(description).
// Categorise order: learned rules, then category keywords, then 'other' (categories.js).

import { merchantKey, categoriseDescription, categoriseDetailed, resolveCategory, ruleMatchLength } from './categories.js';
import { listTransactions, updateTransaction, isValidIsoDate, addTransactions } from './transactions.js';
import { withStore } from './db.js';
import { matchBills } from '../calc/bill-match.js';

export { merchantKey, categoriseDetailed, resolveCategory };

/**
 * @param {string} description
 * @param {Array} categories - financeData.categories.
 * @param {Array} [rules] - financeData.rules.
 * @returns {string} category id.
 */
export function categorise(description, categories, rules = []) {
    return categoriseDescription(description, categories, rules);
}

/**
 * Learn on correct (FT-R-54). Adds or updates the rule for this merchant on `data.rules`.
 * @returns {{ok:boolean, rule?:object, created?:boolean, onUndo?:Function}}
 */
export function learnRule(data, description, categoryId, bucketId) {
    const key = merchantKey(description);
    if (!data || !key || !categoryId) return { ok: false };
    if (!Array.isArray(data.rules)) data.rules = [];
    const rule = { key, categoryId };
    if (bucketId) rule.bucketId = bucketId;
    const i = data.rules.findIndex((r) => r && r.key === key);
    const prev = i >= 0 ? data.rules[i] : null;
    if (i >= 0) data.rules[i] = rule; else data.rules.push(rule);
    const onUndo = () => {
        const j = data.rules.indexOf(rule);
        if (j < 0) return;
        if (prev) data.rules[j] = prev; else data.rules.splice(j, 1);
    };
    return { ok: true, rule, created: !prev, onUndo };
}

/** Remove the rule for a key (Settings list). Returns true when one was removed. */
export function removeRule(data, key) {
    if (!data || !Array.isArray(data.rules)) return false;
    const i = data.rules.findIndex((r) => r && r.key === key);
    if (i < 0) return false;
    data.rules.splice(i, 1);
    return true;
}

const sameMerchant = (rule, description) => ruleMatchLength(rule, merchantKey(description)) > 0;

/**
 * Past rows a rule may re-categorise: still unconfirmed (status 'review', not flagged confirmed)
 * and the same merchant. A row the user confirmed (status 'ok', or `confirmed`) is never listed.
 */
export function similarUnconfirmed(rule, rows) {
    if (!rule || !rule.key) return [];
    return (rows || []).filter((r) => r && r.status === 'review' && !r.confirmed && sameMerchant(rule, r.description));
}

/**
 * Apply a rule to similar past unconfirmed rows. Pure: returns new row objects (category from the
 * rule, status 'ok', the rule's bucket when it has one) for the caller to store. Never touches a
 * confirmed row; running it again on the result finds nothing.
 */
export function applyRuleToSimilar(rule, rows) {
    return similarUnconfirmed(rule, rows).map((r) => {
        const next = { ...r, categoryId: rule.categoryId, status: 'ok' };
        if (rule.bucketId) next.bucketId = rule.bucketId;
        return next;
    });
}

/** Stored version of applyRuleToSimilar; returns how many rows changed. */
export async function applyRuleToStored(rule) {
    const changed = applyRuleToSimilar(rule, await listTransactions());
    for (const r of changed) await updateTransaction(r);
    return changed.length;
}

// ---- Manual vs imported duplicates (FT-R-57) ----

const DAY_MS = 86400000;
const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };

/**
 * Pure. Pair each new csv/pdf row with an unreconciled manual row of the same amount within
 * +-3 days (nearest date first, each manual row used once). Rows whose (numbered) hash is already
 * stored are left alone, so a re-import is never merged into a manual entry.
 * @returns {{remaining:Array, merges:Array<{manualId:string, hash:string, bank:object, manual:object}>}}
 */
export function planManualMerges(newRows, existing) {
    const stored = new Set((existing || []).map((r) => r.hash));
    const manual = (existing || []).filter((r) => r.source === 'manual' && !r.reconciled && isValidIsoDate(r.date))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));
    const used = new Set(), seen = new Map(), remaining = [], merges = [];
    for (const t of newRows || []) {
        if (!t || t.source === 'manual' || t.source === 'sample' || !isValidIsoDate(t.date)) { remaining.push(t); continue; }
        const n = (seen.get(t.hash) || 0) + 1;
        seen.set(t.hash, n);
        const hash = n === 1 ? t.hash : `${t.hash}#${n}`;
        if (stored.has(hash)) { remaining.push(t); continue; }
        let best = null, bestDist = 4;
        for (const m of manual) {
            if (used.has(m.id) || m.amountCents !== t.amountCents) continue;
            const dist = Math.abs(dayNum(m.date) - dayNum(t.date));
            if (dist < bestDist) { best = m; bestDist = dist; }
        }
        if (!best) { remaining.push(t); continue; }
        used.add(best.id);
        merges.push({ manualId: best.id, hash, bank: t, manual: best });
    }
    return { remaining, merges };
}

/**
 * Run before addTransactions on an import commit. Each matching manual row takes the bank hash and
 * `reconciled:true`; the rows still to add come back with one entry per merge for the import
 * summary. Undo of the batch leaves the manual row. Rows not merged here still go through
 * addTransactions, which dedupes by hash.
 * @returns {Promise<{rows:Array, merges:Array<{manualId, date, description, bankDescription, amountCents}>}>}
 */
export async function mergeManualRows(newRows) {
    const dates = (newRows || []).map((r) => r && r.date).filter(isValidIsoDate).sort();
    if (!dates.length) return { rows: newRows || [], merges: [] };
    const shift = (iso, n) => new Date((dayNum(iso) + n) * DAY_MS).toISOString().slice(0, 10);
    const existing = await listTransactions({ from: shift(dates[0], -3), to: shift(dates[dates.length - 1], 3) });
    const { remaining, merges } = planManualMerges(newRows, existing);
    if (merges.length) {
        const stamp = new Date().toISOString();
        // updateTransaction keeps the stored hash, so the merge writes the bank hash directly.
        await withStore('transactions', 'readwrite', (store) => {
            for (const m of merges) store.put({ ...m.manual, hash: m.hash, reconciled: true, updatedAt: stamp });
        });
    }
    return {
        rows: remaining,
        merges: merges.map((m) => ({ manualId: m.manualId, date: m.manual.date, description: m.manual.description,
            bankDescription: m.bank.description, amountCents: m.bank.amountCents })),
    };
}

/**
 * The one import-commit path (A12b: the merge used to run here AND inside addTransactions): merge
 * matching manual rows (FT-R-56/57), then add the rest. `result.merged` counts the merges.
 * @returns {Promise<{result:{added:number, duplicates:number, merged:number, invalid?:number}, merges:Array}>}
 */
export async function commitImportRows(newRows) {
    const m = await mergeManualRows(newRows);
    const result = await addTransactions(m.rows);
    result.merged = (result.merged || 0) + m.merges.length;
    return { result, merges: m.merges };
}

/**
 * Re-run bill matching over the last `days` (default 120) of stored rows and save the rows that
 * changed. Call after an import commit, a manual add and a transaction edit.
 * @returns {Promise<number>} rows changed.
 */
export async function rematchBills(data, { today, days = 120 } = {}) {
    if (!data || !Array.isArray(data.plan)) return 0;
    const end = today || new Date().toISOString().slice(0, 10);
    const from = new Date(dayNum(end) * DAY_MS - days * DAY_MS).toISOString().slice(0, 10);
    const rows = await listTransactions({ from });
    const { rows: next, changed } = matchBills(rows, data.plan);
    const ids = new Set(changed);
    const stamp = new Date().toISOString();
    if (ids.size) {
        await withStore('transactions', 'readwrite', (store) => {
            for (const r of next) if (ids.has(r.id)) store.put({ ...r, updatedAt: stamp });
        });
    }
    return ids.size;
}
