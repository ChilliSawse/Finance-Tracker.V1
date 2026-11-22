// Re-key learned rules with the stronger merchantKey (DB2, D5 4.2). Owner: the sorting lists.
//
// financeData.rules = [{ key, categoryId, bucketId? }]. Keys made by the old merchantKey are run through the new one.
// - A key whose new form is empty (old rail-text keys such as 'visa debit' or 'direct debit') is kept as it is: the rule
//   stays visible in Settings for the person to delete, and nothing is dropped silently.
// - When two rules end up on one key the later one in the list wins (rules are appended as they are learned, so later = newer),
//   with its own category and bucket. It takes the later one's place in the list.
// - Idempotent: merchantKey(key) === key for every key it makes, so a second run finds nothing to do.
// No version flag is stored; the data itself says whether the step is pending.

import { merchantKey } from './categories.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function newKey(rule) {
    if (!isObj(rule) || typeof rule.key !== 'string') return null;
    const k = merchantKey(rule.key);
    return k || rule.key;
}

/** True when some rule's key changes under the new merchantKey. */
export function needsRulesMigration(data) {
    if (!isObj(data) || !Array.isArray(data.rules)) return false;
    return data.rules.some((r) => { const k = newKey(r); return k !== null && k !== r.key; });
}

/** Runs the step in place. Returns true when it changed the data. */
export function migrateRuleKeys(data) {
    if (!needsRulesMigration(data)) return false;
    const DROPPED = Symbol('dropped');
    const out = [];
    const at = new Map();
    for (const r of data.rules) {
        const k = newKey(r);
        const next = k === null ? r : { ...r, key: k };
        if (k !== null && at.has(k)) out[at.get(k)] = DROPPED;   // an older rule on the same key is dropped
        if (k !== null) at.set(k, out.length);
        out.push(next);
    }
    data.rules = out.filter((r) => r !== DROPPED);
    return true;
}

/** Hook run after a JSON import only. Nothing to do. */
export function afterImport(data) {
    return false;
}
