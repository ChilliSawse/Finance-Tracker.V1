// Asset and debt sheets (owner: F5, M-14). Pure: no DOM, no storage. Fills M0's stub.
//
// - newAsset / newDebt: the one place a new row is built, with an id and every F2 detail field, so a
//   row added after the migration ran is not left bare (the assetDebtVersion guard would never fill it).
//   newIncomeSource is built beside them for the same reason (income source ids).
// - assetSheetSpec / debtSheetSpec: field specs for openSheet. The fields depend on the kind (assets) or
//   the interest type (debts), so the opener reopens the sheet when `reopenOn` fields change.
// - applyAssetValues / applyDebtValues: write the sheet values back. A suggested kind or label stays
//   flagged (kindSuggested / labelSuggested) until the user picks one or confirms it on the "Check these N"
//   card (FT-R-53 pattern). The entered balance is never changed here except by what the user typed.
// - checkItems / checkCardHtml / confirmSuggestion: the "Check these N" card.
// - rateBand: the High / Moderate / Low badge beside the good or bad label.
// Maths come from calc/assets-debts.js (F2), ids from state/asset-debt-migration.js and bucket-migration.js.

import { t } from '../i18n/strings.js';
import { esc, escNum } from './html.js';
import { formatCurrency } from '../utils.js';
import { newLiabilityId } from '../state/bucket-migration.js';
import { newAssetId, newIncomeSourceId } from '../state/asset-debt-migration.js';
import { suggestKind, suggestLabel, depreciatedValue, depreciationDiffers, VEHICLE_DEPRECIATION } from '../calc/assets-debts.js';

export const ASSET_KINDS = ['cash', 'invested', 'appreciating', 'depreciating'];
export const DEBT_LABELS = ['good', 'bad'];
export const DEFAULT_ASSET_NAME = 'New Asset';
export const DEFAULT_DEBT_NAME = 'New Liability';
export const DEFAULT_INCOME_NAME = 'New Income';

const INTEREST_FREQS = ['daily', 'monthly', 'quarterly', 'yearly'];
const DIVIDEND_FREQS = ['monthly', 'quarterly', 'yearly'];
const REPAY_FREQS = ['weekly', 'fortnightly', 'monthly'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const blank = (x) => x === undefined || x === null || x === '';
const numOrNull = (x) => (blank(x) || !Number.isFinite(Number(x)) ? null : Number(x));
const freqOptions = (list) => list.map((f) => ({ value: f, label: t(`f.ad.freq.${f}`) }));
const isDefaultName = (name, dflt) => !String(name || '').trim() || String(name).trim() === dflt;

// ---------- factories ----------

/** A vehicle-shaped depreciation record (ATO effective-life defaults), purchase detail empty. */
export function newDepreciation(over = {}) {
    return {
        method: 'declining', ratePct: VEHICLE_DEPRECIATION.decliningRatePct, lifeYears: VEHICLE_DEPRECIATION.lifeYears,
        residual: 0, purchasePrice: null, purchaseDate: null, ...over,
    };
}

/**
 * A new asset row with an id and every detail field. `list` is the array it will join (ids stay unique);
 * `fields` overlays name, balance, kind and so on. With a name and no kind the kind is suggested from the
 * name and flagged (kindSuggested) so the "Check these N" card shows it; a blank or default name is plain cash.
 */
export function newAsset(list = [], fields = {}) {
    const name = fields.name == null ? DEFAULT_ASSET_NAME : String(fields.name);
    const row = {
        id: newAssetId(list, name), name, balance: 0,
        kind: 'cash', kindSuggested: false, isSuper: false,
        interestFrequency: 'monthly', expectedReturn: null, dividendYield: null, dividendFrequency: 'quarterly',
        reinvestDividends: true, growthRate: null, depreciation: null,
    };
    Object.assign(row, fields, { name, id: fields.id || row.id });
    if (!ASSET_KINDS.includes(fields.kind)) {
        if (!isDefaultName(name, DEFAULT_ASSET_NAME)) {
            const s = suggestKind(name);
            row.kind = s.kind; row.isSuper = s.isSuper; row.kindSuggested = true;
        } else { row.kind = 'cash'; row.kindSuggested = false; }
    }
    if (row.kind === 'depreciating' && !row.depreciation) row.depreciation = newDepreciation();
    return row;
}

/** A new debt row with an id (E4's shape) and every detail field. Label suggested from the name and flagged. */
export function newDebt(list = [], fields = {}) {
    const name = fields.name == null ? DEFAULT_DEBT_NAME : String(fields.name);
    const row = {
        id: newLiabilityId(list, name), name, balance: 0, interestRate: 0,
        interestType: 'variable', fixedUntil: null, rateAfterFixed: null, compounding: 'monthly',
        repaymentFrequency: 'monthly', minRepayment: null, label: null, labelSuggested: false,
    };
    Object.assign(row, fields, { name, id: fields.id || row.id });
    if (!('label' in fields) && !isDefaultName(name, DEFAULT_DEBT_NAME)) {
        const s = suggestLabel(name);
        row.label = s; row.labelSuggested = s !== null;
    }
    return row;
}

/** A new income source with an id (`inc-<slug>`). The pay detail is C6's sheet; this is the legacy shape plus the id. */
export function newIncomeSourceRow(list = [], fields = {}) {
    const name = fields.name == null ? DEFAULT_INCOME_NAME : String(fields.name);
    return {
        id: newIncomeSourceId(list, name), name, incomeType: 'salaried', grossAnnual: 0, paySchedule: 'fortnightly',
        hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null, payAnchor: null, ...fields,
    };
}

/** Give an existing row any detail field it lacks (never touches what is there). Used when an old row is edited. */
export function ensureAssetDetail(row) {
    const base = newAsset([], { name: row.name, kind: ASSET_KINDS.includes(row.kind) ? row.kind : undefined });
    for (const k of Object.keys(base)) {
        if (k === 'interestRate' || k === 'id' || k === 'kindSuggested') continue;
        if (row[k] === undefined) row[k] = base[k];
    }
    if (row.kindSuggested === undefined) row.kindSuggested = false;
    return row;
}

export function ensureDebtDetail(row) {
    const base = newDebt([], { name: row.name, label: row.label === undefined ? null : row.label });
    for (const k of Object.keys(base)) {
        if (k === 'id' || k === 'labelSuggested') continue;
        if (row[k] === undefined) row[k] = base[k];
    }
    if (row.labelSuggested === undefined) row.labelSuggested = false;
    return row;
}

// ---------- the High / Moderate / Low badge ----------

/** The rate band beside the good or bad chip: >10 high, 5 to 10 moderate, else low (the same cut-offs as the old Liabilities card). */
export function rateBand(rate) {
    const r = Number(rate) || 0;
    return r > 10 ? 'high' : r >= 5 ? 'moderate' : 'low';
}

// ---------- chips for the Plan rows ----------

const chip = (cls, text) => `<span class="pill${cls ? ` ${cls}` : ''}">${esc(text)}</span>`;

/** Kind chip for an asset row (and "suggested" when it is still a guess). */
export function assetChipsHtml(a) {
    const kind = ASSET_KINDS.includes(a.kind) ? a.kind : null;
    if (!kind) return '';
    const text = kind === 'invested' && a.isSuper ? t('f.ad.kind.super') : t(`f.ad.kind.short.${kind}`);
    const sug = a.kindSuggested ? `${text} (${t('f.ad.suggested')})` : text;
    return chip(a.kindSuggested ? 'review' : '', sug);
}

/** Good or bad chip plus the rate-band badge for a debt row. */
export function debtChipsHtml(l) {
    const band = rateBand(l.interestRate);
    const bandCls = band === 'high' ? 'due' : band === 'low' ? 'ok' : '';
    let out = '';
    if (DEBT_LABELS.includes(l.label)) {
        const text = t(`f.ad.debt.label.${l.label}`);
        out += chip(l.labelSuggested ? 'review' : (l.label === 'good' ? 'ok' : 'due'), l.labelSuggested ? `${text} (${t('f.ad.suggested')})` : text);
    }
    return out + chip(bandCls, t(`f.ad.rate.${band}`));
}

// ---------- sheet specs ----------

const dollars = (n) => formatCurrency(Math.round((Number(n) || 0) * 100) / 100);

/** The flat sheet keys for a depreciation record. */
function depKeys(dep) {
    const d = dep || {};
    return {
        depPurchasePrice: numOrNull(d.purchasePrice), depPurchaseDate: d.purchaseDate || null, depMethod: d.method || 'declining',
        depRatePct: numOrNull(d.ratePct), depLifeYears: numOrNull(d.lifeYears), depResidual: numOrNull(d.residual) || 0,
    };
}

/** A depreciation record from the flat sheet values. */
export function depreciationFromValues(v) {
    const method = v.depMethod === 'straight' ? 'straight' : 'declining';
    const dflt = method === 'straight' ? VEHICLE_DEPRECIATION.straightRatePct : VEHICLE_DEPRECIATION.decliningRatePct;
    return {
        method,
        ratePct: numOrNull(v.depRatePct) == null ? dflt : numOrNull(v.depRatePct),
        lifeYears: numOrNull(v.depLifeYears) == null ? VEHICLE_DEPRECIATION.lifeYears : numOrNull(v.depLifeYears),
        residual: numOrNull(v.depResidual) || 0,
        purchasePrice: numOrNull(v.depPurchasePrice),
        purchaseDate: ISO.test(String(v.depPurchaseDate || '')) ? v.depPurchaseDate : null,
    };
}

function kindOf(asset, carry, opts) {
    const k = opts.kind != null ? opts.kind : (carry && carry.kind != null ? carry.kind : (asset ? asset.kind : ''));
    return ASSET_KINDS.includes(k) ? k : '';
}

/**
 * Field spec for the asset sheet. `asset` null = adding. opts: `today` (ISO, for the depreciation offer),
 * `kind` (override, used when the sheet reopens after a kind change), `carry` (values entered so far).
 * Returns { title, fields, values, validate, plausibility, reopenOn }.
 */
export function assetSheetSpec(asset, opts = {}) {
    const carry = opts.carry || null;
    const kind = kindOf(asset, carry, opts);
    const editing = !!asset;
    const suggested = !!(asset && asset.kindSuggested && (!carry || carry.kind === asset.kind) && !opts.kind);
    const kindOptions = ASSET_KINDS.map((k) => ({ value: k, label: t(`f.ad.kind.${k}`) }));
    if (!kind) kindOptions.unshift({ value: '', label: t('f.ad.kind.blank') });

    const fields = [
        { key: 'name', label: t('f.ad.name'), type: 'text', required: true },
        { key: 'kind', label: t('f.ad.kind'), type: 'select', options: kindOptions, hint: suggested ? t('f.ad.suggestedNote') : (kind ? undefined : t('f.ad.kind.hint')) },
        { key: 'balance', label: t('f.ad.balance.asset'), type: 'money', required: true },
    ];
    if (kind === 'cash') {
        fields.push(
            { key: 'interestRate', label: t('f.ad.interestRate'), type: 'percent', hint: t('f.ad.interestRate.hint') },
            { key: 'interestFrequency', label: t('f.ad.interestFrequency'), type: 'select', options: freqOptions(INTEREST_FREQS) },
        );
    } else if (kind === 'invested') {
        fields.push(
            { key: 'isSuper', label: t('f.ad.isSuper'), type: 'toggle' },
            { key: 'expectedReturn', label: t('f.ad.expectedReturn'), type: 'percent', hint: t('f.ad.expectedReturn.hint') },
            { key: 'dividendYield', label: t('f.ad.dividendYield'), type: 'percent', hint: t('f.ad.dividendYield.hint') },
            { key: 'dividendFrequency', label: t('f.ad.dividendFrequency'), type: 'select', options: freqOptions(DIVIDEND_FREQS) },
            { key: 'reinvestDividends', label: t('f.ad.reinvest'), type: 'toggle' },
        );
    } else if (kind === 'appreciating') {
        fields.push({ key: 'growthRate', label: t('f.ad.growthRate'), type: 'percent', hint: t('f.ad.growthRate.hint') });
    } else if (kind === 'depreciating') {
        fields.push(
            { key: 'depPurchasePrice', label: t('f.ad.dep.price'), type: 'money' },
            { key: 'depPurchaseDate', label: t('f.ad.dep.date'), type: 'date' },
            { key: 'depMethod', label: t('f.ad.dep.method'), type: 'select', options: [
                { value: 'declining', label: t('f.ad.dep.method.declining') }, { value: 'straight', label: t('f.ad.dep.method.straight') }] },
            { key: 'depRatePct', label: t('f.ad.dep.rate'), type: 'percent', hint: t('f.ad.dep.rate.hint') },
            { key: 'depLifeYears', label: t('f.ad.dep.life'), type: 'number' },
            { key: 'depResidual', label: t('f.ad.dep.residual'), type: 'money' },
        );
    }

    const base = asset
        ? { ...asset, ...depKeys(asset.depreciation) }
        : { name: '', balance: null, kind: '', isSuper: false, interestFrequency: 'monthly', dividendFrequency: 'quarterly', reinvestDividends: true, ...depKeys(null) };
    if (kind === 'depreciating' && !(asset && asset.depreciation)) {
        Object.assign(base, depKeys(newDepreciation()), { depPurchasePrice: null, depPurchaseDate: null });
    }
    const values = { ...base, ...(carry || {}), kind };
    if (kind === 'depreciating' && !(asset && asset.depreciation)) {
        // a new vehicle-shaped asset starts on the ATO defaults unless the user has typed something else
        const dflt = newDepreciation();
        if (values.depRatePct == null) values.depRatePct = values.depMethod === 'straight' ? VEHICLE_DEPRECIATION.straightRatePct : dflt.ratePct;
        if (values.depLifeYears == null) values.depLifeYears = dflt.lifeYears;
    }
    if (!editing && values.balance === 0) values.balance = null;

    const title = editing ? t('f.ad.asset.title.edit', { name: asset.name || t('a.plan.list.unnamed') }) : t('f.ad.asset.title.add');
    return {
        title, fields, values, reopenOn: ['kind'],
        validate(v) {
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('a.plan.err.name');
            if (v.balance == null || !(Number(v.balance) >= 0)) errors.balance = t('f.ad.err.amount');
            for (const k of ['interestRate', 'expectedReturn', 'dividendYield', 'depRatePct', 'depLifeYears', 'depPurchasePrice', 'depResidual']) {
                if (v[k] != null && fields.some((f) => f.key === k) && !(Number(v[k]) >= 0)) errors[k] = t('f.ad.err.rate');
            }
            if (v.depPurchaseDate && !ISO.test(String(v.depPurchaseDate))) errors.depPurchaseDate = t('f.ad.err.date');
            return errors;
        },
        plausibility(v) {
            if (v.kind !== 'depreciating') return [];
            const probe = { balance: Number(v.balance) || 0, depreciation: depreciationFromValues(v) };
            if (!opts.today || !depreciationDiffers(probe, opts.today)) return [];
            const worked = depreciatedValue(probe, opts.today);
            return [{
                field: 'balance',
                message: t('f.ad.dep.offer', { worked: dollars(worked), entered: dollars(probe.balance) }),
                fix: { label: t('f.ad.dep.use', { worked: dollars(worked) }), apply: () => ({ balance: worked }) },
            }];
        },
    };
}

/** Field spec for the debt sheet. `debt` null = adding. opts: `carry` (values entered so far). */
export function debtSheetSpec(debt, opts = {}) {
    const carry = opts.carry || null;
    const row = debt || null;
    const interestType = (carry && carry.interestType) || (row && row.interestType) || 'variable';
    const suggested = !!(row && row.labelSuggested && (!carry || (carry.label || null) === (row.label || null)));
    const fields = [
        { key: 'name', label: t('f.ad.name'), type: 'text', required: true },
        { key: 'balance', label: t('f.ad.balance.debt'), type: 'money', required: true },
        { key: 'interestRate', label: t('f.ad.debt.rate'), type: 'percent', hint: t('f.ad.debt.rate.hint') },
        { key: 'interestType', label: t('f.ad.debt.type'), type: 'select', options: [
            { value: 'variable', label: t('f.ad.debt.type.variable') }, { value: 'fixed', label: t('f.ad.debt.type.fixed') }] },
    ];
    if (interestType === 'fixed') {
        fields.push(
            { key: 'fixedUntil', label: t('f.ad.debt.fixedUntil'), type: 'date' },
            { key: 'rateAfterFixed', label: t('f.ad.debt.rateAfter'), type: 'percent', hint: t('f.ad.debt.rateAfter.hint') },
        );
    }
    fields.push(
        { key: 'compounding', label: t('f.ad.debt.compounding'), type: 'select', options: freqOptions(INTEREST_FREQS) },
        { key: 'repaymentFrequency', label: t('f.ad.debt.repayFreq'), type: 'select', options: freqOptions(REPAY_FREQS) },
        { key: 'minRepayment', label: t('f.ad.debt.min'), type: 'money', hint: t('f.ad.debt.min.hint') },
        { key: 'label', label: t('f.ad.debt.label'), type: 'select', hint: suggested ? t('f.ad.debt.suggestedNote') : t('f.ad.debt.label.hint'), options: [
            { value: '', label: t('f.ad.debt.label.none') }, { value: 'good', label: t('f.ad.debt.label.good') }, { value: 'bad', label: t('f.ad.debt.label.bad') }] },
    );
    const base = row
        ? { ...row, label: row.label || '', minRepayment: row.minRepayment == null ? null : row.minRepayment }
        : { name: '', balance: null, interestRate: null, interestType: 'variable', fixedUntil: null, rateAfterFixed: null, compounding: 'monthly', repaymentFrequency: 'monthly', minRepayment: null, label: '' };
    const values = { ...base, ...(carry || {}), interestType };
    const title = row ? t('f.ad.debt.title.edit', { name: row.name || t('a.plan.list.unnamed') }) : t('f.ad.debt.title.add');
    return {
        title, fields, values, reopenOn: ['interestType'],
        validate(v) {
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('a.plan.err.name');
            if (v.balance == null || !(Number(v.balance) >= 0)) errors.balance = t('f.ad.err.amount');
            if (v.interestRate != null && !(Number(v.interestRate) >= 0)) errors.interestRate = t('f.ad.err.rate');
            if (v.rateAfterFixed != null && !(Number(v.rateAfterFixed) >= 0)) errors.rateAfterFixed = t('f.ad.err.rate');
            if (v.minRepayment != null && !(Number(v.minRepayment) >= 0)) errors.minRepayment = t('f.ad.err.amount');
            if (v.fixedUntil && !ISO.test(String(v.fixedUntil))) errors.fixedUntil = t('f.ad.err.date');
            return errors;
        },
    };
}

// ---------- writing the sheet values back ----------

/** Write sheet values onto an asset row (new or existing). Returns the row. A kind picked by the user confirms it. */
export function applyAssetValues(row, v) {
    const name = String(v.name || '').trim();
    const prevKind = ASSET_KINDS.includes(row.kind) ? row.kind : null;
    row.name = name;
    row.balance = Number(v.balance) || 0;
    const picked = ASSET_KINDS.includes(v.kind) ? v.kind : null;
    if (picked) {
        if (picked !== prevKind) { row.kind = picked; row.kindSuggested = false; }
        else if (row.kindSuggested === undefined) row.kindSuggested = false;
    } else if (!prevKind) {
        const s = suggestKind(name);
        row.kind = s.kind; row.isSuper = s.isSuper; row.kindSuggested = true;
    }
    if (row.kind === 'invested') { if (picked) row.isSuper = !!v.isSuper; } else if (picked) row.isSuper = false;
    if (!blank(v.interestRate) && isNum(Number(v.interestRate))) row.interestRate = Number(v.interestRate);
    else if (row.kind === 'cash') delete row.interestRate; // unset stays absent, never null (S1.8)
    for (const k of ['expectedReturn', 'dividendYield', 'growthRate']) if (v[k] !== undefined) row[k] = numOrNull(v[k]);
    if (INTEREST_FREQS.includes(v.interestFrequency)) row.interestFrequency = v.interestFrequency;
    if (DIVIDEND_FREQS.includes(v.dividendFrequency)) row.dividendFrequency = v.dividendFrequency;
    if (v.reinvestDividends !== undefined) row.reinvestDividends = !!v.reinvestDividends;
    if (row.kind === 'depreciating' && 'depMethod' in v) row.depreciation = depreciationFromValues(v);
    ensureAssetDetail(row);
    if (row.kind === 'depreciating' && !row.depreciation) row.depreciation = newDepreciation();
    return row;
}

/** Write sheet values onto a debt row. Changing the label confirms it; leaving it keeps a suggestion flagged. */
export function applyDebtValues(row, v) {
    row.name = String(v.name || '').trim();
    row.balance = Number(v.balance) || 0;
    row.interestRate = Number(v.interestRate) || 0;
    if (v.interestType === 'fixed' || v.interestType === 'variable') row.interestType = v.interestType;
    if ('fixedUntil' in v) row.fixedUntil = ISO.test(String(v.fixedUntil || '')) ? v.fixedUntil : null;
    if ('rateAfterFixed' in v) row.rateAfterFixed = numOrNull(v.rateAfterFixed);
    if (INTEREST_FREQS.includes(v.compounding)) row.compounding = v.compounding;
    if (REPAY_FREQS.includes(v.repaymentFrequency)) row.repaymentFrequency = v.repaymentFrequency;
    if ('minRepayment' in v) row.minRepayment = numOrNull(v.minRepayment);
    const prev = DEBT_LABELS.includes(row.label) ? row.label : null;
    const next = DEBT_LABELS.includes(v.label) ? v.label : null;
    if (next !== prev) { row.label = next; row.labelSuggested = false; }
    else if (!prev && row.label === undefined) {
        const s = suggestLabel(row.name);
        row.label = s; row.labelSuggested = s !== null;
    }
    ensureDebtDetail(row);
    return row;
}

// ---------- the "Check these N" card ----------

/** Rows whose kind or label is still a guess: [{type, index, id, name, kind|label}]. */
export function checkItems(data) {
    const out = [];
    (data.assets || []).forEach((a, index) => {
        if (a && a.kindSuggested === true) out.push({ type: 'asset', index, id: a.id || '', name: a.name || '', value: a.kind, isSuper: !!a.isSuper });
    });
    (data.liabilities || []).forEach((l, index) => {
        if (l && l.labelSuggested === true && DEBT_LABELS.includes(l.label)) out.push({ type: 'debt', index, id: l.id || '', name: l.name || '', value: l.label });
    });
    return out;
}

/** The card, or '' when nothing is flagged. Every name is escaped. */
export function checkCardHtml(items) {
    if (!items.length) return '';
    const title = items.length === 1 ? t('f.ad.check.title1') : t('f.ad.check.title', { count: items.length });
    const rows = items.map((it) => {
        const what = it.type === 'asset'
            ? t('f.ad.check.asset', { name: it.name || t('a.plan.list.unnamed'), kind: it.isSuper ? t('f.ad.kind.super') : t(`f.ad.kind.short.${it.value}`) })
            : t('f.ad.check.debt', { name: it.name || t('a.plan.list.unnamed'), label: t(`f.ad.debt.label.${it.value}`) });
        const key = `${it.type}:${escNum(it.index)}`;
        return `<li><span class="p-check-text">${esc(what)}</span>`
            + `<button type="button" class="btn ghost" data-check-confirm="${key}">${esc(t('f.ad.check.confirm'))}</button>`
            + `<button type="button" class="link" data-check-open="${key}">${esc(t('f.ad.check.change'))}</button></li>`;
    }).join('');
    return `<section class="card p-review p-check" aria-labelledby="p-check-h"><h2 id="p-check-h">${esc(title)}</h2>`
        + `<p class="muted">${esc(t('f.ad.check.body'))}</p><ul class="p-review-list p-check-list">${rows}</ul>`
        + (items.length > 1 ? `<button type="button" class="btn" data-check-all="1">${esc(t('f.ad.check.all'))}</button>` : '') + '</section>';
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Confirm one suggested kind or label (`which` = 'asset:3' / 'debt:0') or all of them (`which` = 'all').
 * Only the flag clears; the kind, label and every figure stay as they were. Returns an undo payload.
 */
export function confirmSuggestion(data, which) {
    const before = { assets: clone(data.assets || []), liabilities: clone(data.liabilities || []) };
    const items = checkItems(data);
    const chosen = which === 'all' ? items : items.filter((it) => `${it.type}:${it.index}` === which);
    if (!chosen.length) return { ok: false, code: 'missing', message: '', onUndo() {}, onExpire: undefined };
    for (const it of chosen) {
        if (it.type === 'asset') data.assets[it.index].kindSuggested = false; else data.liabilities[it.index].labelSuggested = false;
    }
    const message = chosen.length === 1 ? t('f.ad.check.confirmed', { name: chosen[0].name || t('a.plan.list.unnamed') }) : t('f.ad.check.confirmedAll', { count: chosen.length });
    return {
        ok: true, count: chosen.length, message, onExpire: undefined,
        onUndo() {
            data.assets.splice(0, data.assets.length, ...before.assets);
            data.liabilities.splice(0, data.liabilities.length, ...before.liabilities);
        },
    };
}
