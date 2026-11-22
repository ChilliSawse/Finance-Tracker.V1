// Quick-add, the pure parts (A8): category guess, chip order, bucket line wording, what a save
// and a Repeat build. No DOM, no storage, so the Node runner covers it.
//
// Money is integer cents until it reaches a plan item (plan amounts are dollars).

import { t } from '../i18n/strings.js';
import { categorise } from '../state/rules.js';
import { effectiveBucket } from '../calc/plan.js';
import { TRANSFER_CATEGORY } from '../calc/transfers.js';

export const TOP_CHIPS = 6;
export const REPEAT_FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

/** Typed amount text -> integer cents, or null when it is not a positive amount. */
export function parseAmountCents(text) {
    const s = String(text == null ? '' : text).replace(/A\$|[,\s$]/g, '');
    if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(s)) return null;
    const cents = Math.round(Number(s) * 100);
    return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/**
 * Category guessed from the note. No note, or only the 'other' fallback, is no match (categoryId null):
 * the sheet then asks for a bucket instead of pretending to know.
 * @returns {{categoryId: string|null, guessed: boolean}}
 */
export function guessCategory(note, categories, rules = []) {
    const text = String(note == null ? '' : note).trim();
    if (!text) return { categoryId: null, guessed: false };
    const id = categorise(text, categories || [], rules);
    const known = (categories || []).some((c) => c && c.id === id);
    if (!id || id === 'other' || !known) return { categoryId: null, guessed: false };
    return { categoryId: id, guessed: true };
}

/**
 * Category chip ids in display order, split into the visible top six and the More list.
 * Order: the chosen (or guessed) category first, then the most used this pay, then the saved order.
 * Spending never offers Income; Income offers Income and Other only.
 * @param {Array} categories
 * @param {{kind?: 'spending'|'income', selectedId?: string|null, counts?: Map|Object}} opts
 */
export function orderCategoryChips(categories, { kind = 'spending', selectedId = null, counts = {} } = {}) {
    const list = (categories || []).filter((c) => c && c.id);
    const eligible = kind === 'income'
        ? list.filter((c) => c.id === 'income' || c.id === 'other')
        : list.filter((c) => c.id !== 'income');
    const used = (id) => (counts instanceof Map ? counts.get(id) : counts[id]) || 0;
    const ranked = eligible.map((c, i) => ({ id: c.id, i }))
        .sort((a, b) => (b.id === selectedId) - (a.id === selectedId) || used(b.id) - used(a.id) || a.i - b.i)
        .map((x) => x.id);
    return { top: ranked.slice(0, TOP_CHIPS), more: ranked.slice(TOP_CHIPS) };
}

/** "<category> · guessed from your note" when guessed (FT-R-46); otherwise the category and its kind. */
export function categoryLine(category, guessed) {
    if (!category) return '';
    if (guessed) return t('a.quickAdd.catGuessed', { category: category.name });
    return t(category.essential ? 'a.quickAdd.catEssential' : 'a.quickAdd.catNonEssential', { category: category.name });
}

/**
 * Which bucket the purchase draws on. `usualId` is where the category sends it (FT-R-47, FT-R-70, via
 * effectiveBucket with no transaction bucket); `choiceId` is what the person picked for this purchase.
 * With no category there is no usual bucket, so a choice is always stored.
 * @returns {{usualId: string|null, bucketId: string|null, changed: boolean, store: string|undefined}}
 */
export function resolveBucket({ category, choiceId, allocation }) {
    const rows = Array.isArray(allocation) ? allocation : [];
    const valid = choiceId && rows.some((a) => a && a.id === choiceId) ? choiceId : null;
    if (!category) return { usualId: null, bucketId: valid, changed: false, store: valid || undefined };
    const usualId = effectiveBucket({ amountCents: -1 }, category, null, rows);
    const bucketId = valid || usualId;
    const changed = !!valid && valid !== usualId;
    return { usualId, bucketId, changed, store: changed ? valid : undefined };
}

/**
 * The line under the Bucket row. Changed: "changed for this purchase; usually <usual bucket>" (FT-R-46).
 * Same as usual: "from <category>". No category: asks for a choice, or confirms it.
 */
export function bucketLine({ category, chosenName, usualName, changed }) {
    if (!category) return chosenName ? t('a.quickAdd.bucketChosen') : t('a.quickAdd.bucketNeeded');
    if (changed) return t('a.quickAdd.bucketChanged', { usual: usualName || '' });
    return t('a.quickAdd.bucketFrom', { category: category.name });
}

/** Cents left in the bucket after this spend. Negative means over. */
export function afterThisCents(leftCents, amountCents) {
    return (Number(leftCents) || 0) - (Number(amountCents) || 0);
}

/**
 * Fields for makeTransaction. bucketId is present only when it differs from the usual one.
 * A transfer (H9, FT-R-119) is category 'transfer', money out unless `incoming` (an existing money-in transfer being
 * edited), and its `store` is the bucket it WENT TO. Setting it by hand never leaves a suggested flag behind.
 */
export function buildTransactionFields({ kind, amountCents, category, note, date, store, incoming = false }) {
    const text = String(note == null ? '' : note).trim();
    if (kind === 'transfer') {
        const fields = {
            date,
            description: text || t('a.quickAdd.transferWord'),
            amountCents: incoming ? Math.abs(amountCents) : -Math.abs(amountCents),
            categoryId: TRANSFER_CATEGORY,
            source: 'manual',
            note: text,
        };
        if (store && !incoming) fields.bucketId = store;
        return fields;
    }
    const fields = {
        date,
        description: text || (category ? category.name : ''),
        amountCents: kind === 'income' ? Math.abs(amountCents) : -Math.abs(amountCents),
        categoryId: category ? category.id : 'other',
        source: 'manual',
        note: text,
    };
    if (store) fields.bucketId = store;
    return fields;
}

/**
 * The "Went to" choices for a transfer: every top-level bucket, then the goals under a SAVING bucket (those are
 * the destinations Today's actual savings figure counts, H8). `buckets` is getBuckets() output.
 * @returns {Array<{id:string, name:string, kind:string, parentName:string|null}>}
 */
export function wentToChoices(buckets) {
    const list = Array.isArray(buckets) ? buckets : [];
    const top = list.filter((b) => b && !b.parentId && b.kind !== 'goal');
    const byId = new Map(top.map((b) => [b.id, b]));
    const goals = list.filter((b) => b && b.kind === 'goal' && b.parentId && byId.has(b.parentId) && byId.get(b.parentId).kind === 'save');
    return [
        ...top.map((b) => ({ id: b.id, name: b.name, kind: b.kind, parentName: null })),
        ...goals.map((g) => ({ id: g.id, name: g.name, kind: 'goal', parentName: byId.get(g.parentId).name })),
    ];
}

/** Fields for addPlanItem when Repeat is on: name, amount (dollars), frequency, and the entry's date as anchorDue. */
export function buildRepeatPlanItem({ note, category, amountCents, frequency, date, store }) {
    const text = String(note == null ? '' : note).trim();
    const item = {
        name: text || (category ? category.name : ''),
        amount: Math.abs(amountCents) / 100,
        frequency: REPEAT_FREQUENCIES.includes(frequency) ? frequency : 'monthly',
        anchorDue: date,
        categoryId: category ? category.id : null,
    };
    if (store) item.bucketId = store;
    return item;
}
