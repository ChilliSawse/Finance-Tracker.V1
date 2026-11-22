// Learn on correct (FT-R-54, FT-R-56; step DB9), and the home of learnRule and the apply-to-similar helpers.
// Loaded by dynamic import() at save time from Quick-add edit, so none of this is in the cold-load core.
//
// Correcting an existing spending row's category stores a merchant rule (key only) that runs ahead of the
// keywords, then offers to apply it to past rows still waiting for review. Manual and sample rows, transfers,
// income, the 'other' bucket and empty or bank-wording keys never learn.

import { merchantKey } from './categories.js';
import { categorise } from './rules.js';
import { listTransactions, updateTransaction } from './transactions.js';

// Words that are only bank or payment-rail wording: a key made of nothing else names no merchant.
const RAIL_WORDS = new Set(('internet online mobile phone bank banking transfer payment payments pay bpay osko npp direct credit debit ' +
    'deposit withdrawal atm card visa mastercard eftpos purchase cash cheque funds account acct ref received sent to from').split(' '));

/** True when `key` can name a merchant: not empty and not made only of bank or rail wording. */
export function isLearnableKey(key) {
    if (!key || typeof key !== 'string') return false;
    return key.split(/\s+/).some((w) => w && !RAIL_WORDS.has(w));
}

/**
 * Learn on correct (FT-R-54, FT-R-56). Adds or updates the rule for this merchant on `data.rules`.
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


// Same matching as categorise (lookup-time key fallback), asked of a one-category list so only this rule can answer.
const sameMerchant = (rule, description) => categorise(description, [{ id: rule.categoryId, keywords: [] }], [rule]) === rule.categoryId;

/**
 * Past rows a rule may re-categorise: still unconfirmed (status 'review', not flagged confirmed)
 * and the same merchant. A row the user confirmed (status 'ok', or `confirmed`) is never listed.
 */
export function similarUnconfirmed(rule, rows) {
    if (!rule || !rule.key) return [];
    return (rows || []).filter((r) => r && r.status === 'review' && !r.confirmed && r.categoryId !== 'transfer' && !r.split && !r.splits && sameMerchant(rule, r.description));
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

/** Stored version of applyRuleToSimilar with an undo: { count, undo }. undo writes the rows back as they were. */
export async function applyRuleToStoredUndoable(rule) {
    const all = await listTransactions();
    const before = new Map(all.map((r) => [r.id, r]));
    const changed = applyRuleToSimilar(rule, all);
    for (const r of changed) await updateTransaction(r);
    return { count: changed.length, undo: async () => { for (const r of changed) await updateTransaction(before.get(r.id)); } };
}

/** Stored version of applyRuleToSimilar; returns how many rows changed. */
export async function applyRuleToStored(rule) {
    return (await applyRuleToStoredUndoable(rule)).count;
}

/**
 * Should this edit learn a rule? Returns the rule key, or '' when it should not.
 * `txn` is the row before the edit, `nextCategoryId` the category it was saved with.
 */
export function learnKeyFor(txn, nextCategoryId, categories) {
    if (!txn || !nextCategoryId || nextCategoryId === txn.categoryId) return '';
    if (nextCategoryId === 'other') return '';
    if (txn.source === 'manual' || txn.source === 'sample') return '';
    if (!(txn.amountCents < 0)) return '';
    const cats = Array.isArray(categories) ? categories : [];
    const target = cats.find((c) => c && c.id === nextCategoryId);
    if (!target || target.kind === 'transfer' || nextCategoryId === 'transfer' || txn.categoryId === 'transfer') return '';
    const key = merchantKey(txn.description);
    return isLearnableKey(key) ? key : '';
}

/**
 * Learn from a saved correction. `data` is financeData. Returns null when nothing was learned, else
 * { rule, created, count, onUndo } where count is how many past unconfirmed rows the rule could sort.
 */
export async function learnFromCorrection(data, txn, nextCategoryId) {
    const key = learnKeyFor(txn, nextCategoryId, data && data.categories);
    if (!key) return null;
    const res = learnRule(data, key, nextCategoryId);
    if (!res.ok) return null;
    const rows = (await listTransactions()).filter((r) => r.id !== txn.id);
    return { rule: res.rule, created: res.created, count: similarUnconfirmed(res.rule, rows).length, onUndo: res.onUndo };
}

/** Apply the learned rule to past unconfirmed rows. Returns { count, undo } (undo puts the rows back). */
export function applyLearnedRule(rule) {
    return applyRuleToStoredUndoable(rule);
}
