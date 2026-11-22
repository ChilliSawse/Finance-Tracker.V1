// Plan money lists (A9a): the model, the HTML and the sheet specs for Pay, Essentials,
// Non-essentials, Bills and the spending-cap rows. Pure: no DOM, no storage, no toasts.
// plan.js owns the shell and the events and calls these.
//
// Essentials and Non-essentials are plan items without a due date, grouped by their
// category's essential flag. Bills are plan items with an anchorDue (FT-R-88). Every figure
// comes from planTotals-style maths (calc/plan.js) or the plan item itself; none is typed in.

import '../i18n/en-lazy-plan-lists.js'; // plan-lists strings (en-lazy)
import { t } from '../i18n/strings.js';
import { esc, escNum } from './html.js';
import { formatCurrency, getPayCyclesPerYear } from '../utils.js';
import { calculateTotals } from '../calc/calculations.js';
import { perCycle, perMonth, netPerPayCents } from '../calc/plan.js';
import { billOccurrences } from '../calc/pay-cycle.js';
import { addPlanItem, updatePlanItem, removePlanItem, convertToBill } from '../state/plan.js';
import { weeklyAmountRule } from './sheet.js';
import { categoryIcon } from '../state/categories.js';
import { relinkCategory } from '../state/saving-model.js';
import {
    assetSheetSpec, debtSheetSpec, newAsset, newDebt, newIncomeSourceRow as newIncomeRow, applyAssetValues, applyDebtValues,
    assetChipsHtml, debtChipsHtml, ASSET_KINDS,
} from './plan-assets-debts.js';
import { categoryBucketField, bucketIdFromField } from './bucket-sheets.js';
import { iconSvgHtml, CATEGORY_ICON_NAMES } from './icon-paths.js';

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
            // The last payslip check (C6) and the "switch to Salary?" flag (C4), for the status on the row.
            check: s.taxCheck && typeof s.taxCheck.matched === 'boolean' && ISO.test(String(s.taxCheck.date || ''))
                ? { matched: s.taxCheck.matched, date: s.taxCheck.date } : null,
            offer: s.migrationPrompt === 'payslip-job',
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

/** The payslip-check line under a Pay row: matched or differs with the payslip's date, and "Check this" on a flagged source. */
function payStatusHtml(r) {
    let html = '';
    if (r.check) {
        const status = t(r.check.matched ? 'c.income.row.matches' : 'c.income.row.differs');
        const text = t('c.income.row.checkedOn', { status, date: shortDate(r.check.date) });
        html += `<span class="d p-check ${r.check.matched ? 'is-ok' : 'is-warn'}">${r.check.matched ? '\u2713 ' : ''}${esc(text)}</span>`;
    }
    if (r.offer) html += `<span class="d p-check is-warn">${esc(t('c.income.row.checkThis'))}</span>`;
    return html;
}

export function payBodyHtml(pay) {
    const rows = pay.rows.map((r) => {
        const fig = r.perPay == null ? `<span class="money">${esc(t('a.plan.varies'))}</span>` : moneyHtml(r.perPay);
        const primary = r.primary ? ` <span class="pill ok">${esc(t('a.plan.primary'))}</span>` : '';
        return `<li><button type="button" class="p-row" data-income-open="${escNum(r.index)}">`
            + `<span class="p-main"><span class="n">${esc(r.name)}${primary}</span><span class="d">${esc(r.type)}</span>${payStatusHtml(r)}</span>`
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
export function newIncomeSource(list = []) {
    return newIncomeRow(list); // F5: the factory carries the id
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

// ====================================================================================
// A9b: Debts, Assets and Categories
// ====================================================================================

const clone = (v) => JSON.parse(JSON.stringify(v));
const failed = (code) => ({ ok: false, code, message: '', onUndo() {}, onExpire: undefined });

/** Put `list` back to `before` in place (the array keeps its identity, so other holders still see it). */
function restoreList(list, before) {
    list.splice(0, list.length, ...clone(before));
}

// ---------- Debts and Assets (rows live in data.liabilities / data.assets; sheets from plan-assets-debts.js) ----------

export const LIST_KEYS = { debt: 'liabilities', asset: 'assets' };

function listRows(data, kind) {
    const list = Array.isArray(data[LIST_KEYS[kind]]) ? data[LIST_KEYS[kind]] : [];
    return list.map((r, index) => ({ r, index })).filter((x) => x.r);
}

/** Debts or Assets rows for the list, the total and the count. */
export function debtAssetModel(data, kind) {
    const rows = listRows(data || {}, kind).map(({ r, index }) => ({
        index, id: r.id || '', name: r.name || '', balance: Number(r.balance) || 0, rate: kind === 'debt' ? Number(r.interestRate) || 0 : null,
        chips: kind === 'debt' ? debtChipsHtml(r) : assetChipsHtml(r),
    }));
    return { kind, rows, count: rows.length, total: rows.reduce((s, r) => s + r.balance, 0) };
}

export function debtAssetBodyHtml(model) {
    const k = model.kind;
    const rows = model.rows.map((r) => {
        const sub = k === 'debt' ? t('a.plan.debt.rate', { rate: String(r.rate) }) : t('a.plan.asset.sub');
        return `<li><button type="button" class="p-row" data-${k}-open="${escNum(r.index)}">`
            + `<span class="p-main"><span class="n">${esc(r.name || t('a.plan.list.unnamed'))}${r.chips || ''}</span><span class="d">${esc(sub)}</span></span>`
            + `<span class="often"></span>${moneyHtml(r.balance)}<span class="chev" aria-hidden="true"></span></button></li>`;
    }).join('');
    return (rows ? `<ul class="p-list">${rows}</ul>` : `<p class="muted p-empty">${esc(t(`a.plan.${k}.empty`))}</p>`)
        + `<div class="p-total"><span class="muted">${esc(t(`a.plan.${k}.total`))}</span>${moneyHtml(model.total)}</div>`
        + `<button type="button" class="btn ghost p-add" data-${k}-add="1">${esc(t(`a.plan.${k}.add`))}</button>`;
}

export function debtAssetCount(kind, n) {
    return n === 1 ? t(`a.plan.${kind}.count1`) : t(`a.plan.${kind}.count`, { count: n });
}

/**
 * The openSheet spec for a debt or an asset (F5 fields from plan-assets-debts.js). `opts`: today (ISO, for the
 * depreciation offer), kind (override) and carry (values entered so far) when the sheet reopens after a kind change.
 * If a spec ever came back with no fields the three plain fields below would carry the sheet.
 */
export function debtAssetSheetSpec(kind, row = null, opts = {}) {
    const spec = kind === 'debt' ? debtSheetSpec(row, opts) : assetSheetSpec(row, opts);
    const plain = !(spec.fields && spec.fields.length);
    const fields = plain ? [
        { key: 'name', label: t('a.plan.list.name'), type: 'text', required: true },
        { key: 'balance', label: t(`a.plan.${kind}.balance`), type: 'money', required: true },
        ...(kind === 'debt' ? [{ key: 'interestRate', label: t('a.plan.debt.interest'), type: 'percent', hint: t('a.plan.debt.interestHint') }] : []),
    ] : spec.fields;
    const title = spec.title || (row ? t('a.plan.list.edit', { name: row.name || t('a.plan.list.unnamed') }) : t(`a.plan.${kind}.addTitle`));
    const values = plain ? { ...(spec.values || {}), ...(row || { name: '', balance: null }) } : spec.values;
    return {
        title, fields, values, plausibility: spec.plausibility, reopenOn: spec.reopenOn || [],
        validate(v) {
            if (!plain && spec.validate) return spec.validate(v);
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('a.plan.err.name');
            if (v.balance == null || !(Number(v.balance) >= 0)) errors.balance = t('a.plan.err.amount');
            if (kind === 'debt' && v.interestRate != null && !(Number(v.interestRate) >= 0)) errors.interestRate = t('a.plan.err.rate');
            return errors;
        },
    };
}

/** Add (index null) or edit one debt or asset. Undo restores the whole list. The caller renders and saves. */
export function saveDebtAsset(data, kind, index, values) {
    const key = LIST_KEYS[kind];
    if (!Array.isArray(data[key])) data[key] = [];
    const list = data[key];
    const before = clone(list);
    const name = String(values.name || '').trim();
    const balance = Number(values.balance) || 0;
    if (index == null) {
        // F5: the factories give the new row its id and every detail field; the sheet values then go on top.
        const row = kind === 'debt'
            ? applyDebtValues(newDebt(list, { name, balance }), values)
            : applyAssetValues(newAsset(list, { name, balance, ...(ASSET_KINDS.includes(values.kind) ? { kind: values.kind } : {}) }), values);
        list.push(row);
        return { ok: true, item: row, message: t('a.plan.list.added', { name }), onUndo() { restoreList(list, before); }, onExpire: undefined };
    }
    const row = list[index];
    if (!row) return failed('missing');
    if (kind === 'debt') applyDebtValues(row, { ...values, name, balance }); else applyAssetValues(row, { ...values, name, balance });
    return { ok: true, item: row, message: t('a.plan.list.changed', { name }), onUndo() { restoreList(list, before); }, onExpire: undefined };
}

export function deleteDebtAsset(data, kind, index) {
    const list = data[LIST_KEYS[kind]];
    if (!Array.isArray(list) || !list[index]) return failed('missing');
    const before = clone(list);
    const [row] = list.splice(index, 1);
    return { ok: true, item: row, message: t('a.plan.list.removed', { name: row.name || t('a.plan.list.unnamed') }), onUndo() { restoreList(list, before); }, onExpire: undefined };
}

// ---------- Categories ----------

const PROTECTED = new Set(['other', 'income', 'other-essential']);
const isProtected = (c) => !!c && (PROTECTED.has(c.id) || c.kind === 'transfer');

/** Where a category is used outside the transaction store: plan lines, learned rules, legacy bills. */
export function categoryUse(data, id, txns = 0) {
    const d = data || {};
    const plan = (d.plan || []).filter((p) => p && p.categoryId === id).length;
    const rules = (d.rules || []).filter((r) => r && r.categoryId === id).length;
    const bills = (d.bills || []).filter((b) => b && b.categoryId === id).length;
    const tx = Number(txns) || 0;
    return { plan, rules, bills, txns: tx, total: plan + rules + bills + tx };
}

/** Category rows for the Plan list. `buckets` is getBuckets() output (names only). */
export function categoriesModel(data, { buckets = [] } = {}) {
    const names = new Map((buckets || []).filter(Boolean).map((b) => [String(b.id), b.name || '']));
    const rows = (data.categories || []).filter((c) => c && c.id).map((c) => {
        const link = c.bucketId != null && names.has(String(c.bucketId)) ? names.get(String(c.bucketId)) : '';
        return {
            id: c.id, name: c.name || c.id, icon: categoryIcon(c), essential: !!c.essential,
            cap: parseFloat(c.monthlyBudget) || 0, keywords: Array.isArray(c.keywords) ? c.keywords.length : 0,
            bucket: link, isProtected: isProtected(c), use: categoryUse(data, c.id),
        };
    });
    return { rows, count: rows.length };
}

export function categoriesBodyHtml(model) {
    const rows = model.rows.map((r) => {
        const bits = [r.essential ? t('a.plan.cat.essential') : t('a.plan.cat.non')];
        if (r.keywords) bits.push(t(r.keywords === 1 ? 'a.plan.cat.keyword1' : 'a.plan.cat.keywords', { count: r.keywords }));
        const link = r.bucket ? t('a.plan.cat.draws', { bucket: r.bucket }) : t('a.plan.cat.follows');
        const cap = r.cap > 0 ? t('a.plan.cat.cap', { amount: formatCurrency(cents(r.cap)) }) : t('a.plan.cat.noCap');
        return `<li><button type="button" class="p-row p-cat" data-cat-open="${esc(r.id)}">`
            + `<span class="p-main"><span class="n"><span class="p-cat-ico">${iconSvgHtml(r.icon)}</span>${esc(r.name)}</span><span class="d">${esc(bits.join(' · '))}</span></span>`
            + `<span class="often">${esc(link)}</span><span class="money">${esc(cap)}</span><span class="chev" aria-hidden="true"></span></button></li>`;
    }).join('');
    return (rows ? `<ul class="p-list">${rows}</ul>` : `<p class="muted p-empty">${esc(t('a.plan.cat.empty'))}</p>`)
        + `<button type="button" class="btn ghost p-add" data-cat-add="1">${esc(t('a.plan.cat.add'))}</button>`;
}

export function categoryCount(n) {
    return n === 1 ? t('a.plan.cat.count1') : t('a.plan.cat.count', { count: n });
}

export const parseKeywords = (text) => [...new Set(String(text || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean))];

/** The category sheet: name, icon, essential tick, envelope cap, keywords and E7's bucket field (FT-R-70). */
export function categorySheetSpec(data, { category = null, buckets = [] } = {}) {
    const editing = !!category;
    const cat = category || { name: '', icon: 'tag', essential: false, monthlyBudget: 0, keywords: [], bucketId: null };
    const { value: bucketValue, ...bucketSpec } = categoryBucketField(cat, buckets);
    const fields = [
        { key: 'name', label: t('a.plan.cat.name'), type: 'text', required: true },
        { key: 'icon', label: t('a.plan.cat.icon'), type: 'select', hint: t('a.plan.cat.iconHint'),
            options: CATEGORY_ICON_NAMES.map((n) => ({ value: n, label: t(`a.plan.cat.icons.${n}`) })) },
        { key: 'essential', label: t('a.plan.cat.essentialTick'), type: 'toggle', hint: t('a.plan.cat.essentialHint') },
        { key: 'monthlyBudget', label: t('a.plan.cat.capLabel'), type: 'money', hint: t('a.plan.cat.capHint') },
        { key: 'keywords', label: t('a.plan.cat.keywordsLabel'), type: 'text', hint: t('a.plan.cat.keywordsHint') },
        bucketSpec,
    ];
    const values = {
        name: cat.name || '', icon: categoryIcon(cat), essential: !!cat.essential,
        monthlyBudget: parseFloat(cat.monthlyBudget) || 0, keywords: (Array.isArray(cat.keywords) ? cat.keywords : []).join(', '), bucketId: bucketValue,
    };
    return {
        title: editing ? t('a.plan.cat.edit', { name: cat.name || cat.id }) : t('a.plan.cat.addTitle'),
        fields, values,
        validate(v) {
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('a.plan.err.name');
            if (v.monthlyBudget != null && !(Number(v.monthlyBudget) >= 0)) errors.monthlyBudget = t('a.plan.err.amount');
            return errors;
        },
    };
}

/**
 * Save the category sheet: a new category (category null) or an edit. The bucket link goes through E5's
 * relinkCategory (FT-R-70), so a link to a gone bucket is refused with nothing written. One undo restores the list.
 */
export function saveCategory(data, category, values, { id } = {}) {
    if (!Array.isArray(data.categories)) data.categories = [];
    const list = data.categories;
    const before = clone(list);
    const name = String(values.name || '').trim();
    const link = bucketIdFromField(values.bucketId);
    const fields = {
        name, icon: CATEGORY_ICON_NAMES.includes(values.icon) ? values.icon : 'tag', essential: !!values.essential,
        monthlyBudget: Number(values.monthlyBudget) || 0, keywords: parseKeywords(values.keywords),
    };
    let target = category;
    if (!target) {
        const rand = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
        target = { id: id || `cat-${rand.slice(0, 8)}`, ...fields, bucketId: null };
        const other = list.findIndex((c) => c && c.id === 'other'); // keywords match in order, so new ones go before the catch-all
        if (other >= 0) list.splice(other, 0, target); else list.push(target);
    }
    if ((target.bucketId == null ? null : String(target.bucketId)) !== link) {
        const r = relinkCategory(data, target.id, link);
        if (!r.ok) { restoreList(list, before); return failed(r.code || 'bucket'); }
    }
    Object.assign(target, fields);
    return {
        ok: true, item: target, message: t(category ? 'a.plan.cat.changed' : 'a.plan.cat.added', { name }),
        onUndo() { restoreList(list, before); }, onExpire: undefined,
    };
}

/** Categories a row can move to when this one is deleted: every other category except income and transfers. */
export function moveTargets(data, fromId) {
    return (data.categories || []).filter((c) => c && c.id && c.id !== fromId && c.id !== 'income' && c.kind !== 'transfer')
        .map((c) => ({ value: c.id, label: c.name || c.id }));
}

/**
 * Delete a category. Refused for the structural ones and, with no `moveTo`, while anything still uses it
 * (`code:'used'` and `use`). With `moveTo` the plan lines, learned rules and legacy bills move first; the
 * caller moves the stored transactions (async) and passes their count in `txns`. One undo restores it all.
 */
export function deleteCategory(data, id, { moveTo = null, txns = 0 } = {}) {
    const list = data.categories || [];
    const index = list.findIndex((c) => c && c.id === id);
    if (index < 0) return failed('missing');
    if (isProtected(list[index])) return failed('protected');
    const use = categoryUse(data, id, txns);
    if (use.total > 0 && !moveTo) return { ...failed('used'), use };
    if (moveTo && !list.some((c) => c && c.id === moveTo && c.id !== id)) return failed('target');
    const keys = ['categories', 'plan', 'rules', 'bills'];
    const before = Object.fromEntries(keys.map((k) => [k, clone(data[k] || [])]));
    if (moveTo) {
        for (const k of ['plan', 'rules', 'bills']) for (const r of data[k] || []) if (r && r.categoryId === id) r.categoryId = moveTo;
    }
    const [row] = list.splice(index, 1);
    return {
        ok: true, item: row, use, message: t('a.plan.cat.removed', { name: row.name || id }),
        onUndo() { for (const k of keys) if (Array.isArray(data[k])) restoreList(data[k], before[k]); }, onExpire: undefined,
    };
}
