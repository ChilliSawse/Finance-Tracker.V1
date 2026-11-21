// Plan state API (Phase 1 step B4). Mutates data.plan[] in place and returns an undo
// payload shaped for showUndoToast: { ok, message, onUndo, onExpire, item, index }.
// The caller renders and saves after each call (and again after onUndo), the same
// "mutate in place, then tell the renderer" model the rest of the app uses.
// No DOM, no storage, no toast.
//
// PlanItem: {id, categoryId, name, amount, frequency, anchorDue, matchRule, bucketId, inTotals, legacy}
// FT-R-53: items created here count in totals (inTotals true), including new bills;
// migrated bills stay reminders (inTotals false) until a person changes that.

import { t } from '../i18n/strings.js';

const FIELDS = ['categoryId', 'name', 'amount', 'frequency', 'anchorDue', 'matchRule', 'bucketId', 'inTotals'];

const clone = (v) => JSON.parse(JSON.stringify(v));
const failed = () => ({ ok: false, message: '', onUndo() {}, onExpire: undefined });

function ensurePlan(data) {
    if (!Array.isArray(data.plan)) data.plan = [];
    return data.plan;
}

function slug(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

/** A plan item id not used by any item in `plan`. */
export function newPlanItemId(plan, name) {
    const used = new Set((plan || []).map((p) => p && p.id));
    const base = `p-${slug(name) || 'item'}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    return id;
}

/** Add a plan item (counts in totals unless inTotals:false). Undo removes it again. */
export function addPlanItem(data, fields = {}) {
    const plan = ensurePlan(data);
    const item = {
        id: newPlanItemId(plan, fields.name),
        categoryId: fields.categoryId ?? null,
        name: fields.name ?? '',
        amount: fields.amount ?? 0,
        frequency: fields.frequency ?? 'monthly',
        anchorDue: fields.anchorDue ?? null,
        matchRule: fields.matchRule ?? null,
        bucketId: fields.bucketId ?? null,
        inTotals: fields.inTotals === undefined ? true : !!fields.inTotals,
        legacy: null,
    };
    plan.push(item);
    const id = item.id;
    return {
        ok: true, item, index: plan.length - 1, message: t('b.plan.added', { name: item.name || t('b.plan.itemFallback') }), onExpire: undefined,
        onUndo() {
            const i = plan.findIndex((p) => p && p.id === id);
            if (i >= 0) plan.splice(i, 1);
        },
    };
}

/** Change fields on an item (id and legacy never change). Undo puts the old values back. */
export function updatePlanItem(data, id, changes = {}) {
    const plan = ensurePlan(data);
    const index = plan.findIndex((p) => p && p.id === id);
    if (index < 0) return failed();
    const before = clone(plan[index]);
    for (const k of FIELDS) if (Object.prototype.hasOwnProperty.call(changes, k)) plan[index][k] = changes[k];
    return {
        ok: true, item: plan[index], index, message: t('b.plan.changed', { name: plan[index].name || t('b.plan.itemFallback') }), onExpire: undefined,
        onUndo() {
            const i = plan.findIndex((p) => p && p.id === id);
            if (i >= 0) plan[i] = clone(before);
        },
    };
}

/** Remove an item. Undo reinserts it at its old position (once). */
export function removePlanItem(data, id) {
    const plan = ensurePlan(data);
    const index = plan.findIndex((p) => p && p.id === id);
    if (index < 0) return failed();
    const [item] = plan.splice(index, 1);
    let restored = false;
    return {
        ok: true, item, index, message: t('b.plan.removed', { name: item.name || t('b.plan.itemFallback') }), onExpire: undefined,
        onUndo() {
            if (restored) return;
            restored = true;
            plan.splice(Math.min(index, plan.length), 0, item);
        },
    };
}

/**
 * "Make this a bill" on an existing line: gives it a due date (anchorDue, YYYY-MM-DD) and,
 * optionally, a frequency. inTotals is left alone, so a line that counts keeps counting
 * (no double count) and a migrated reminder stays a reminder.
 */
export function convertToBill(data, id, { anchorDue, frequency } = {}) {
    if (!anchorDue) return failed();
    const changes = { anchorDue };
    if (frequency) changes.frequency = frequency;
    const res = updatePlanItem(data, id, changes);
    if (res.ok) res.message = t('b.plan.nowBill', { name: res.item.name || t('b.plan.itemFallback') });
    return res;
}
