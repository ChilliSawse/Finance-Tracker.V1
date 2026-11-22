// Learn on correct (FT-R-54, FT-R-56; step DB9), and the home of learnRule and the apply-to-similar helpers.
// Loaded by dynamic import() at save time from Quick-add edit, so none of this is in the cold-load core.
//
// Correcting an existing spending row's category stores a merchant rule (key only) that runs ahead of the
// keywords, then offers to apply it to past rows still waiting for review. Manual and sample rows, transfers,
// income, and empty, bank-wording or payment-processor keys never learn. A correction back to 'other' takes the
// old rule for that merchant away.

import { merchantKey, categoriseDescription } from './categories.js';
import { listTransactions } from './transactions.js';
import { withStore } from './db.js';
import { isTransferRow } from '../calc/transfers.js';

// Bank and payment-rail wording: a key made of nothing else names no merchant, and a key that starts with it is
// taken again from the text after it.
const RAIL_WORDS = new Set(('internet online mobile phone bank banking transfer tfr payment payments pay bpay osko npp direct credit debit ' +
    'deposit withdrawal atm card visa mastercard eftpos purchase cash cheque funds account acct ref received sent to from ' +
    'netbank fast anyone repayment member authorisation').split(' '));
// Payment processors, BNPL names and company filler: one key for all of them would catch every merchant behind them.
const PROCESSOR_WORDS = new Set('paypal afterpay zip zippay klarna humm openpay latitude laybuy square stripe au australia pty ltd'.split(' '));

/** True when `key` can name a merchant: not empty and not made only of bank, processor or filler words. */
export function isLearnableKey(key) {
    if (!key || typeof key !== 'string') return false;
    return key.split(/\s+/).some((w) => w && !RAIL_WORDS.has(w) && !PROCESSOR_WORDS.has(w));
}

/** The merchant key to learn for a description, or '' when it names no single merchant. */
export function ruleKeyFor(description) {
    let key = merchantKey(description);
    if (key && RAIL_WORDS.has(key.split(' ')[0])) {
        const words = String(description || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        let i = 0;
        while (i < words.length && RAIL_WORDS.has(words[i])) i++;
        key = merchantKey(words.slice(i).join(' '));
    }
    return isLearnableKey(key) ? key : '';
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

// Same matching as categoriseDescription (lookup-time key fallback), asked of a one-category list so only this rule can answer.
const sameMerchant = (rule, description) => categoriseDescription(description, [{ id: rule.categoryId, keywords: [] }], [rule]) === rule.categoryId;

/**
 * Past rows a rule may re-categorise: money out, still unconfirmed (status 'review', not flagged confirmed), the same
 * merchant, and not a transfer (by id or by its category, FT-R-126), a suggested transfer or bucket, or a split.
 * A row the user confirmed (status 'ok', or `confirmed`) is never listed.
 */
export function similarUnconfirmed(rule, rows, categories) {
    if (!rule || !rule.key) return [];
    const cats = Array.isArray(categories) ? categories : [];
    return (rows || []).filter((r) => r && r.status === 'review' && !r.confirmed && r.amountCents < 0
        && !r.transferSuggested && !r.bucketSuggested && !r.split && !r.splits
        && !isTransferRow(r, cats.find((c) => c && c.id === r.categoryId)) && sameMerchant(rule, r.description));
}

/**
 * Apply a rule to similar past unconfirmed rows. Pure: returns new row objects (category from the
 * rule, status 'ok', the rule's bucket when it has one; a reference suggestion is dropped) for the caller to store.
 * Never touches a confirmed row; running it again on the result finds nothing.
 */
export function applyRuleToSimilar(rule, rows, categories) {
    return similarUnconfirmed(rule, rows, categories).map((r) => {
        const next = { ...r, categoryId: rule.categoryId, status: 'ok' };
        delete next.referenceSuggested; delete next.refConfidence; delete next.refId;
        if (rule.bucketId) next.bucketId = rule.bucketId;
        return next;
    });
}

/**
 * Stored version of applyRuleToSimilar: all rows in ONE transaction (a failure changes none), skipping a row that
 * changed since it was listed. Returns { count, undo }; undo is one transaction too and skips any row edited since
 * the apply. Rejects when the transaction fails.
 */
export async function applyRuleToStoredUndoable(rule, categories) {
    const all = await listTransactions();
    const before = new Map(all.map((r) => [r.id, r]));
    const changed = applyRuleToSimilar(rule, all, categories);
    const stamp = new Date().toISOString();
    const written = [];
    await withStore('transactions', 'readwrite', (store) => {
        for (const r of changed) {
            store.get(r.id).onsuccess = (e) => {
                const cur = e.target.result;
                if (!cur || (cur.updatedAt || cur.createdAt) !== before.get(r.id).updatedAt || cur.status !== 'review') return;
                store.put({ ...r, hash: cur.hash, updatedAt: stamp });
                written.push(r.id);
            };
        }
    });
    const undo = async () => {
        await withStore('transactions', 'readwrite', (store) => {
            for (const id of written) {
                store.get(id).onsuccess = (e) => { const cur = e.target.result; if (cur && cur.updatedAt === stamp) store.put(before.get(id)); };
            }
        });
    };
    return { count: written.length, undo };
}

/** Stored version of applyRuleToSimilar; returns how many rows changed. */
export async function applyRuleToStored(rule, categories) {
    return (await applyRuleToStoredUndoable(rule, categories)).count;
}

// The key an edit would act on ('' for none), before the direction of the correction is looked at.
function editKey(txn, nextCategoryId, categories) {
    if (!txn || !nextCategoryId || nextCategoryId === txn.categoryId) return '';
    if (txn.source === 'manual' || txn.source === 'sample') return '';
    if (!(txn.amountCents < 0)) return '';
    const target = (Array.isArray(categories) ? categories : []).find((c) => c && c.id === nextCategoryId);
    if (nextCategoryId !== 'other') {
        if (!target || target.kind === 'income' || nextCategoryId === 'income' || isTransferRow(txn, target)) return '';
    } else if (isTransferRow(txn, null)) return '';
    return ruleKeyFor(txn.description);
}

/**
 * Should this edit learn a rule? Returns the rule key, or '' when it should not (a move to 'other' learns nothing).
 * `txn` is the row before the edit, `nextCategoryId` the category it was saved with.
 */
export function learnKeyFor(txn, nextCategoryId, categories) {
    return nextCategoryId === 'other' ? '' : editKey(txn, nextCategoryId, categories);
}

/**
 * Learn from a saved correction. `data` is financeData. Returns null when nothing changed, else
 * { rule, created, count, onUndo } where count is how many past unconfirmed rows the rule could sort.
 * A move back to 'other' removes the rule with that exact key (rule undefined, count 0, onUndo puts it back).
 */
export async function learnFromCorrection(data, txn, nextCategoryId) {
    const cats = data && data.categories;
    if (nextCategoryId === 'other') {
        const key = editKey(txn, nextCategoryId, cats);
        const i = key && Array.isArray(data.rules) ? data.rules.findIndex((r) => r && r.key === key) : -1;
        if (i < 0) return null;
        const [gone] = data.rules.splice(i, 1);
        return { removed: gone, count: 0, onUndo: () => { if (!data.rules.some((r) => r === gone || (r && r.key === gone.key))) data.rules.splice(Math.min(i, data.rules.length), 0, gone); } };
    }
    const key = learnKeyFor(txn, nextCategoryId, cats);
    if (!key) return null;
    const res = learnRule(data, key, nextCategoryId);
    if (!res.ok) return null;
    const rows = (await listTransactions()).filter((r) => r.id !== txn.id);
    return { rule: res.rule, created: res.created, count: similarUnconfirmed(res.rule, rows, cats).length, onUndo: res.onUndo };
}

/** Apply the learned rule to past unconfirmed rows. Returns { count, undo } (undo puts the rows back). */
export function applyLearnedRule(rule, categories) {
    return applyRuleToStoredUndoable(rule, categories);
}
