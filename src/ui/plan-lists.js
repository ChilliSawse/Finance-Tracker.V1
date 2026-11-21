// Plan money lists (A9a): the model, the HTML and the sheet specs for Pay, Essentials,
// Non-essentials, Bills and the spending-cap rows. Pure: no DOM, no storage, no toasts.
// plan.js owns the shell and the events and calls these.
//
// Essentials and Non-essentials are plan items without a due date, grouped by their
// category's essential flag. Bills are plan items with an anchorDue (FT-R-88). Every figure
// comes from planTotals-style maths (calc/plan.js) or the plan item itself; none is typed in.

import { t } from '../i18n/strings.js';
import { esc, escNum } from './html.js';
import { formatCurrency, getPayCyclesPerYear } from '../utils.js';
import { calculateTotals } from '../calc/calculations.js';
import { perCycle, perMonth, netPerPayCents } from '../calc/plan.js';
import { billOccurrences } from '../calc/pay-cycle.js';
import { addPlanItem, updatePlanItem, removePlanItem, convertToBill } from '../state/plan.js';
import { weeklyAmountRule } from './sheet.js';

export const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const freqLabel = (f) => (FREQUENCIES.includes(f) ? t(`a.plan.freq.${f}`) : '');

function addDaysIso(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const x = new Date(y, m - 1, d + n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** "Mon 17 Nov" from an ISO date. */
export function shortDate(iso) {
    if (!ISO.test(String(iso || ''))) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The next due date on or after `today` (ISO), or the anchor itself when none falls in a year. */
export function nextDue(item, today) {
    if (!item || !ISO.test(String(item.anchorDue || ''))) return null;
    if (!ISO.test(String(today || ''))) return item.anchorDue;
    const hit = billOccurrences(item, today, addDaysIso(today, 400))[0];
    return hit || item.anchorDue;
}

// ---------- the model ----------

function categoryMap(data) {
    return new Map((data.categories || []).filter(Boolean).map((c) => [c.id, c]));
}

function itemRow(item, cats, cycles, today, query) {
    const cat = cats.get(item.categoryId);
    const isBill = ISO.test(String(item.anchorDue || ''));
    const due = isBill ? nextDue(item, today) : null;
    return {
        id: item.id,
        name: item.name || '',
        categoryName: cat ? cat.name : t('a.plan.uncategorised'),
        essential: !!(cat ? cat.essential : item.essential),
        isBill,
        due,
        inTotals: item.inTotals !== false,
        amount: Number(item.amount) || 0,
        frequency: item.frequency,
        perPay: perCycle(item, cycles),
        perMonth: perMonth(item),
        match: !query || String(item.name || '').toLowerCase().includes(query),
    };
}

/** The spending-cap rows: categories with a monthlyBudget, spent this month (cents map). */
export function capRows(data, monthByCategory) {
    const spendMap = monthByCategory instanceof Map ? monthByCategory : new Map();
    return (data.categories || []).filter((c) => c && (parseFloat(c.monthlyBudget) || 0) > 0).map((c) => {
        const cap = parseFloat(c.monthlyBudget) || 0;
        const spent = (spendMap.get(c.id) || 0) / 100;
        const pct = cap > 0 ? (spent / cap) * 100 : 0;
        return { id: c.id, name: c.name, cap, spent, left: cap - spent, over: spent > cap, pct, state: pct > 100 ? 'is-over' : pct >= 75 ? 'is-warm' : 'is-ok' };
    });
}

function sourceRows(data) {
    const work = JSON.parse(JSON.stringify(data));
    try { calculateTotals(work); } catch (_) { /* a half-built source falls back to zero */ }
    const primary = work.primaryIncomeIndex || 0;
    return (work.incomeSources || []).map((s, index) => {
        const cycles = getPayCyclesPerYear(s.paySchedule);
        const net = Number(s._calculatedNetAnnual) || 0;
        const variable = s.incomeType === 'variable';
        return {
            index,
            name: s.name || '',
            type: variable ? t('a.plan.typeVariable') : s.incomeType === 'selfEmployed' ? t('a.plan.typeSelf') : t('a.plan.typeSalaried'),
            primary: index === primary,
            often: s.paySchedule === 'yearly' ? t('a.plan.freq.yearly') : freqLabel(s.paySchedule) || '',
            perPay: variable ? null : net / cycles,
        };
    });
}

/**
 * Everything the money lists show. `query` filters the Essentials, Non-essentials and Bills
 * rows by name (display only: the footer totals stay full, as the old filter did).
 */
export function planListsModel(data, { today, monthByCategory, query = '' } = {}) {
    const d = data || {};
    const q = String(query || '').trim().toLowerCase();
    const cats = categoryMap(d);
    const sources = Array.isArray(d.incomeSources) ? d.incomeSources : [];
    const primary = sources[d.primaryIncomeIndex || 0] || sources[0];
    const cycles = getPayCyclesPerYear(primary ? primary.paySchedule : undefined);
    const rows = (Array.isArray(d.plan) ? d.plan : []).filter(Boolean).map((it) => itemRow(it, cats, cycles, today, q));

    const sum = (list) => list.filter((r) => r.inTotals).reduce((s, r) => s + r.perPay, 0);
    const essentialsAll = rows.filter((r) => !r.isBill && r.essential);
    const nonAll = rows.filter((r) => !r.isBill && !r.essential);
    const billsAll = rows.filter((r) => r.isBill).sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const shown = (list) => list.filter((r) => r.match);

    const takeHome = netPerPayCents(d) / 100;
    const mig = d.planMigration || {};
    const review = Array.isArray(mig.reviewBills) ? mig.reviewBills.filter((id) => (d.plan || []).some((p) => p && p.id === id)) : [];
    return {
        query: q,
        cycles,
        pay: { rows: sourceRows(d), takeHome, perMonth: (takeHome * cycles) / 12 },
        essentials: { rows: shown(essentialsAll), count: essentialsAll.length, perPay: sum(essentialsAll) },
        nonEssentials: { rows: shown(nonAll), count: nonAll.length, perPay: sum(nonAll) },
        bills: { rows: shown(billsAll), count: billsAll.length, perPay: sum(billsAll) },
        caps: capRows(d, monthByCategory),
        review: review.map((id) => {
            const p = d.plan.find((x) => x && x.id === id);
            return { id, name: p.name || '' };
        }),
    };
}

// ---------- HTML (every data value goes through esc / escNum) ----------

function moneyHtml(n) { return `<span class="money">${esc(formatCurrency(cents(n)))}</span>`; }

function rowHtml(r) {
    const bits = [esc(r.categoryName)];
    if (r.isBill) bits.push(esc(t('a.plan.billNext', { date: shortDate(r.due) })));
    if (r.isBill && !r.inTotals) bits.push(esc(t('a.plan.reminder')));
    return `<li><button type="button" class="p-row" data-plan-open="${esc(r.id)}">`
        + `<span class="p-main"><span class="n">${esc(r.name || t('a.plan.sheet.editFallback'))}</span><span class="d">${bits.join(' · ')}</span></span>`
        + `<span class="often">${esc(formatCurrency(cents(r.amount)))} ${esc(freqLabel(r.frequency))}</span>`
        + `${moneyHtml(r.perPay)}<span class="chev" aria-hidden="true"></span></button></li>`;
}

/** The inside of an Essentials, Non-essentials or Bills section. */
export function listBodyHtml(kind, list, query) {
    const empty = { essential: 'a.plan.emptyEssential', non: 'a.plan.emptyNon', bills: 'a.plan.emptyBills' }[kind];
    const add = { essential: 'a.plan.addEssential', non: 'a.plan.addNon', bills: 'a.plan.addBill' }[kind];
    let html;
    if (list.rows.length) html = `<ul class="p-list">${list.rows.map(rowHtml).join('')}</ul>`;
    else if (query && list.count) html = `<p class="muted p-empty">${esc(t('a.plan.noMatch', { query }))}</p>`;
    else html = `<p class="muted p-empty">${esc(t(empty))}</p>`;
    const totalLabel = kind === 'bills' ? t('a.plan.billsCounted')
        : t('a.plan.perPayAll', { what: t(kind === 'essential' ? 'a.plan.whatEssentials' : 'a.plan.whatNon') });
    return html
        + `<div class="p-total"><span class="muted">${esc(totalLabel)}</span>${moneyHtml(list.perPay)}</div>`
        + `<button type="button" class="btn ghost p-add" data-plan-add="${esc(kind)}">${esc(t(add))}</button>`;
}

export function payBodyHtml(pay) {
    const rows = pay.rows.map((r) => {
        const fig = r.perPay == null ? `<span class="money">${esc(t('a.plan.varies'))}</span>` : moneyHtml(r.perPay);
        const primary = r.primary ? ` <span class="pill ok">${esc(t('a.plan.primary'))}</span>` : '';
        return `<li><button type="button" class="p-row" data-income-open="${escNum(r.index)}">`
            + `<span class="p-main"><span class="n">${esc(r.name)}${primary}</span><span class="d">${esc(r.type)}</span></span>`
            + `<span class="often">${esc(r.often)}</span>${fig}<span class="chev" aria-hidden="true"></span></button></li>`;
    }).join('');
    return (rows ? `<ul class="p-list">${rows}</ul>` : `<p class="muted p-empty">${esc(t('a.plan.emptyPay'))}</p>`)
        + `<div class="p-total"><span class="muted">${esc(t('a.plan.takeHome'))}</span>${moneyHtml(pay.takeHome)}</div>`
        + `<p class="muted p-sub">${esc(t('a.plan.takeHomeMonth', { amount: formatCurrency(cents(pay.perMonth)) }))}</p>`
        + `<button type="button" class="btn ghost p-add" data-income-add="1">${esc(t('a.plan.addIncome'))}</button>`;
}

/** Caps card: each row says what is left against the cap (FT-R-52). Empty string when no category has a cap. */
export function capsHtml(caps, hasSpend) {
    if (!caps.length) return '';
    const rows = caps.map((c) => {
        const label = c.over ? t('a.plan.caps.over', { amount: formatCurrency(cents(-c.left)) }) : t('a.plan.caps.left', { amount: formatCurrency(cents(c.left)) });
        const pct = Math.min(100, Math.max(0, c.pct));
        return `<li class="p-cap"><div class="p-cap-head"><span class="n">${esc(c.name)}</span>`
            + `<span class="muted">${esc(t('a.plan.caps.of', { spent: formatCurrency(cents(c.spent)), cap: formatCurrency(cents(c.cap)) }))}</span></div>`
            + `<div class="p-cap-bar ${c.state}" role="img" aria-label="${esc(t('a.plan.caps.barLabel', { name: c.name, pct: Math.round(c.pct) }))}"><span style="width:${escNum(pct.toFixed(1))}%"></span></div>`
            + `<div class="p-cap-left">${esc(label)}</div></li>`;
    }).join('');
    return `<div class="p-caps card"><div class="card-head"><h3>${esc(t('a.plan.caps.title'))}</h3></div>`
        + `<p class="muted p-sub">${esc(t('a.plan.caps.note'))}</p><ul class="p-caplist">${rows}</ul>`
        + (hasSpend ? '' : `<p class="muted p-sub">${esc(t('a.plan.caps.empty'))}</p>`) + '</div>';
}

/** The "We moved your lists. Check these N" card; empty string when nothing needs a look (FT-R-53). */
export function reviewCardHtml(review) {
    if (!review.length) return '';
    const title = review.length === 1 ? t('a.plan.review.title1') : t('a.plan.review.title', { count: review.length });
    const items = review.map((r) => `<li><button type="button" class="link" data-plan-open="${esc(r.id)}">${esc(r.name || t('a.plan.sheet.editFallback'))}</button></li>`).join('');
    return `<section class="card p-review" aria-labelledby="p-review-h"><h2 id="p-review-h">${esc(title)}</h2>`
        + `<p class="muted">${esc(t('a.plan.review.body'))}</p><ul class="p-review-list">${items}</ul>`
        + `<button type="button" class="btn" data-plan-review-done="1">${esc(t('a.plan.review.done'))}</button></section>`;
}

export function countText(kind, n) {
    const keys = { essential: ['a.plan.countEssentials', 'a.plan.countEssentials1'], non: ['a.plan.countNon', 'a.plan.countNon1'],
        bills: ['a.plan.countBills', 'a.plan.countBills1'], pay: ['a.plan.countIncome', 'a.plan.countIncome1'] }[kind];
    return n === 1 ? t(keys[1]) : t(keys[0], { count: n });
}

// ---------- sheets ----------

/** Categories a plan line can sit in (income and transfers never hold a spending line). */
export function categoryOptions(data) {
    const opts = (data.categories || []).filter((c) => c && c.id && c.id !== 'income' && c.id !== 'transfer' && c.kind !== 'transfer')
        .map((c) => ({ value: c.id, label: c.name || c.id }));
    return opts.length ? opts : [{ value: '', label: t('a.plan.uncategorised') }];
}

function defaultCategory(data, essential) {
    const cats = (data.categories || []).filter((c) => c && c.id && c.id !== 'income' && c.id !== 'transfer');
    const pick = (id) => cats.find((c) => c.id === id);
    const first = cats.find((c) => !!c.essential === essential);
    return (essential ? pick('other-essential') : pick('other')) || first || cats[0] || null;
}

/**
 * The openSheet spec for one plan line. kind: 'essential' | 'non' | 'bills' (new line) or
 * an existing item passed as `item`. Returns {title, fields, values, validate, plausibility, saveLabel}.
 */
export function planItemSheetSpec(data, { kind, item = null } = {}) {
    const editing = !!item;
    const billOnly = !editing && kind === 'bills';
    const fields = [
        { key: 'name', label: t('a.plan.sheet.name'), type: 'text', required: true },
        { key: 'amount', label: t('a.plan.sheet.amount'), type: 'money', required: true },
        { key: 'frequency', label: t('a.plan.sheet.often'), type: 'select', options: FREQUENCIES.map((f) => ({ value: f, label: t(`a.plan.freqOpt.${f}`) })) },
        { key: 'categoryId', label: t('a.plan.sheet.category'), type: 'select', options: categoryOptions(data), hint: t('a.plan.sheet.categoryHint') },
    ];
    if (!billOnly) fields.push({ key: 'isBill', label: t('a.plan.sheet.makeBill'), type: 'toggle', hint: t('a.plan.sheet.makeBillHint') });
    fields.push({ key: 'anchorDue', label: t('a.plan.sheet.due'), type: 'date' });
    fields.push({ key: 'inTotals', label: t('a.plan.sheet.inTotals'), type: 'toggle', hint: t('a.plan.sheet.inTotalsHint') });

    let values;
    if (editing) {
        values = { name: item.name || '', amount: Number(item.amount) || 0, frequency: FREQUENCIES.includes(item.frequency) ? item.frequency : 'monthly',
            categoryId: item.categoryId || '', isBill: ISO.test(String(item.anchorDue || '')), anchorDue: ISO.test(String(item.anchorDue || '')) ? item.anchorDue : '',
            inTotals: item.inTotals !== false };
    } else {
        const cat = defaultCategory(data, kind !== 'non');
        values = { name: '', amount: null, frequency: 'monthly', categoryId: cat ? cat.id : '', isBill: billOnly, anchorDue: '', inTotals: true };
    }
    const title = editing ? (item.name ? t('a.plan.sheet.edit', { name: item.name }) : t('a.plan.sheet.editFallback'))
        : t(kind === 'bills' ? 'a.plan.sheet.addBill' : kind === 'non' ? 'a.plan.sheet.addNon' : 'a.plan.sheet.addEssential');
    return {
        title, fields, values,
        validate(v) {
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('a.plan.err.name');
            if (!(Number(v.amount) >= 0) || v.amount == null) errors.amount = t('a.plan.err.amount');
            if ((billOnly || v.isBill) && !ISO.test(String(v.anchorDue || ''))) errors.anchorDue = t('a.plan.err.due');
            return errors;
        },
        plausibility: weeklyAmountRule({ field: 'amount', frequencyField: 'frequency' }),
    };
}

// ---------- actions through B4's API ----------

/**
 * Save the sheet's values: a new line (item null) or an edit. Returns B4's undo payload
 * {ok, message, onUndo, onExpire, item}. An edit that turns a line into a bill goes through
 * convertToBill (one undo for the whole save). The caller renders and saves.
 */
export function savePlanItem(data, item, values, { kind } = {}) {
    const wantsBill = kind === 'bills' || !!values.isBill;
    const due = wantsBill && ISO.test(String(values.anchorDue || '')) ? values.anchorDue : null;
    const common = {
        name: String(values.name || '').trim(), amount: values.amount == null ? 0 : values.amount, frequency: values.frequency,
        categoryId: values.categoryId || null, inTotals: !!values.inTotals,
    };
    if (!item) return addPlanItem(data, { ...common, anchorDue: due });

    const id = item.id;
    const becomesBill = !!due && !ISO.test(String(item.anchorDue || ''));
    const changes = { ...common };
    if (!becomesBill) changes.anchorDue = due; // a bill edited in place, or a bill turned back into a plain line
    const first = updatePlanItem(data, id, changes);
    if (!first.ok || !becomesBill) return first;
    const second = convertToBill(data, id, { anchorDue: due, frequency: values.frequency });
    if (!second.ok) return first;
    return {
        ok: true, item: second.item, index: second.index, message: second.message, onExpire: undefined,
        onUndo() { second.onUndo(); first.onUndo(); },
    };
}

/** Delete a line; the payload's onUndo reinserts it where it was. */
export function deletePlanItem(data, id) {
    return removePlanItem(data, id);
}

/** A source row for "Add income" in the legacy shape the engine reads. C6's sheet edits the rest. */
export function newIncomeSource() {
    return { name: 'New Income', incomeType: 'salaried', grossAnnual: 0, paySchedule: 'fortnightly', hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null, payAnchor: null };
}

/** Marks the migration review done for every listed bill (the card then hides). */
export function clearReview(data) {
    if (data.planMigration && Array.isArray(data.planMigration.reviewBills)) data.planMigration.reviewBills = [];
}

/** One saved line has been looked at: drop it from the review list. */
export function markReviewed(data, id) {
    const m = data.planMigration;
    if (m && Array.isArray(m.reviewBills)) m.reviewBills = m.reviewBills.filter((x) => x !== id);
}
