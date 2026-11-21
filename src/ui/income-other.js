// A12b: the sheets that replace the deleted Income settings modal for what C6's Salary and
// Set-hours sheets do not cover: Self-employed and Variable sources (their pay figures and, for
// Variable, the income events), "Delete this source" with the last-source guard (kept as sheet
// validation, not an alert), and the tax estimate settings (Medicare levy, HELP balance).
// Custom tax brackets and the financial-year picker are gone (FT-R-97): tax always comes from the
// official tables for the date.
//
// The pure parts (canRemoveIncomeSource, removeIncomeSource, otherIncomeFields, applyOtherIncome,
// eventFields, applyEvent, removeEvent, taxDetailsFields, applyTaxDetails) have no DOM.

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { openSheet } from './sheet.js';
import { showToast, showUndoToast } from './toast.js';
import { makeIncomeEvent, sumEvents, fyRange, activeFyKey } from '../calc/income-events.js';
import { AU_TAX_YEARS } from '../calc/tax-au.js';
import { formatCurrency } from '../utils.js';
import { acceptPayslipJob } from '../state/income-migration.js';

const CYCLES = ['weekly', 'fortnightly', 'monthly', 'quarterly'];

/** The guard: the last income source cannot be deleted. Returns a message, or '' when it can go. */
export function canRemoveIncomeSource(data, index) {
    const list = data && data.incomeSources;
    if (!Array.isArray(list) || !list[index]) return t('a12b.income.gone');
    if (list.length <= 1) return t('a12b.income.last');
    return '';
}

/** Removes a source and keeps `primaryIncomeIndex` pointing at the same one. Undo puts it back. */
export function removeIncomeSource(data, index) {
    const message = canRemoveIncomeSource(data, index);
    if (message) return { ok: false, message, onUndo() {}, onExpire: undefined };
    const primary = data.primaryIncomeIndex || 0;
    const [row] = data.incomeSources.splice(index, 1);
    if (primary === index) data.primaryIncomeIndex = 0;
    else if (primary > index) data.primaryIncomeIndex = primary - 1;
    return {
        ok: true,
        message: t('a12b.income.removed', { name: row.name || t('a12b.income.unnamed') }),
        onUndo() { data.incomeSources.splice(index, 0, row); data.primaryIncomeIndex = primary; },
        onExpire: undefined,
    };
}

/** True while a source carries the C4 flag that asks whether to switch it to the Salary layout. */
export function hasPayslipJobOffer(source) {
    return !!source && source.migrationPrompt === 'payslip-job';
}

/** "Not now" / "Keep as is": the flag goes for good, so the question is never asked again. */
export function declinePayslipJobOffer(source) {
    if (!hasPayslipJobOffer(source)) return false;
    delete source.migrationPrompt;
    return true;
}

/**
 * Accepts the offer (the Salary layout, via C4's acceptPayslipJob). Returns an Undo that puts the source back exactly
 * as it was, flag included, or null when there was nothing to accept.
 */
export function acceptPayslipJobWithUndo(source) {
    if (!hasPayslipJobOffer(source)) return null;
    const before = structuredClone(source);
    if (!acceptPayslipJob(source)) return null;
    return () => {
        for (const k of Object.keys(source)) delete source[k];
        Object.assign(source, before);
    };
}

export function otherIncomeFields(source) {
    const variable = source.incomeType === 'variable';
    const fields = [
        { key: 'name', label: t('a12b.income.name'), type: 'text', required: true },
        { key: 'incomeType', label: t('a12b.income.type'), type: 'select', options: [
            { value: 'selfEmployed', label: t('a.plan.typeSelf') }, { value: 'variable', label: t('a.plan.typeVariable') }] },
    ];
    if (!variable) {
        fields.push(
            { key: 'paySchedule', label: t('a12b.income.often'), type: 'select', options: CYCLES.map((c) => ({ value: c, label: t(`a.plan.freqOpt.${c}`) || c })) },
            { key: 'invoicedPayPostTax', label: t('a12b.income.net'), type: 'money', hint: t('a12b.income.netHint') },
            { key: 'taxRemoved', label: t('a12b.income.tax'), type: 'money' },
            { key: 'hoursPerCycle', label: t('a12b.income.hours'), type: 'number' },
        );
    } else {
        fields.push({ key: 'baseHourlyRate', label: t('varInc.baseRate'), type: 'money', hint: t('varInc.baseRateHint') });
    }
    fields.push({ key: 'primary', label: t('a12b.income.primary'), type: 'toggle' });
    return fields;
}

export function otherIncomeValues(data, index) {
    const s = data.incomeSources[index];
    return {
        name: s.name || '', incomeType: s.incomeType === 'variable' ? 'variable' : 'selfEmployed',
        paySchedule: s.paySchedule || 'fortnightly', invoicedPayPostTax: s.invoicedPayPostTax,
        taxRemoved: s.taxRemoved, hoursPerCycle: s.hoursPerCycle, baseHourlyRate: s.baseHourlyRate,
        primary: (data.primaryIncomeIndex || 0) === index,
    };
}

export function applyOtherIncome(data, index, v) {
    const s = data.incomeSources[index];
    s.name = String(v.name || '').trim();
    s.incomeType = v.incomeType === 'variable' ? 'variable' : 'selfEmployed';
    s.basis = s.incomeType;
    if (s.incomeType === 'variable') {
        if (!Array.isArray(s.incomeEvents)) s.incomeEvents = [];
        s.baseHourlyRate = v.baseHourlyRate == null ? s.baseHourlyRate ?? null : Number(v.baseHourlyRate);
    } else {
        if (CYCLES.includes(v.paySchedule)) s.paySchedule = v.paySchedule;
        s.invoicedPayPostTax = v.invoicedPayPostTax == null ? null : Number(v.invoicedPayPostTax);
        s.taxRemoved = v.taxRemoved == null ? null : Number(v.taxRemoved);
        s.hoursPerCycle = v.hoursPerCycle == null ? null : Number(v.hoursPerCycle);
    }
    if (v.primary) data.primaryIncomeIndex = index;
}

export function eventFields() {
    return [
        { key: 'date', label: t('a12b.event.date'), type: 'date', required: true },
        { key: 'label', label: t('a12b.event.label'), type: 'text', hint: t('varInc.labelPh') },
        { key: 'netAmount', label: t('a12b.event.net'), type: 'money', required: true },
        { key: 'taxWithheld', label: t('a12b.event.tax'), type: 'money' },
        { key: 'hours', label: t('a12b.event.hours'), type: 'number' },
        { key: 'cashReceived', label: t('a12b.event.cash'), type: 'money' },
        { key: 'gstInclusive', label: t('varInc.gstTitle'), type: 'toggle' },
        { key: 'penaltyRates', label: t('varInc.penaltyTitle'), type: 'toggle' },
    ];
}

export function eventValidate(v) {
    const errors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) errors.date = t('d.sheet.required');
    if (v.netAmount != null && v.netAmount < 0) errors.netAmount = t('a12b.event.negative');
    return errors;
}

/** Saves one event onto a Variable source (new when `eventIndex` is null). */
export function applyEvent(source, eventIndex, v) {
    if (!Array.isArray(source.incomeEvents)) source.incomeEvents = [];
    const base = eventIndex == null ? makeIncomeEvent() : source.incomeEvents[eventIndex];
    const num = (x) => (x == null ? null : Number(x));
    const next = {
        ...base, date: v.date, label: String(v.label || ''), netAmount: Number(v.netAmount) || 0,
        taxWithheld: num(v.taxWithheld), hours: num(v.hours), cashReceived: num(v.cashReceived),
        gstInclusive: !!v.gstInclusive, penaltyRates: !!v.penaltyRates,
    };
    if (eventIndex == null) source.incomeEvents.unshift(next); else source.incomeEvents[eventIndex] = next;
    return next;
}

export function removeEvent(source, eventIndex) {
    const list = source.incomeEvents;
    if (!Array.isArray(list) || !list[eventIndex]) return { ok: false, message: '', onUndo() {} };
    const [row] = list.splice(eventIndex, 1);
    return { ok: true, message: t('a12b.event.removed'), onUndo() { list.splice(eventIndex, 0, row); } };
}

export function taxDetailsFields() {
    return [
        { key: 'includeMedicareLevy', label: t('a12b.tax.medicare'), type: 'toggle' },
        { key: 'includeHelpInEstimate', label: t('a12b.tax.helpInclude'), type: 'toggle' },
        { key: 'helpBalance', label: t('a12b.tax.helpBalance'), type: 'money', hint: t('a12b.tax.helpHint') },
    ];
}

export function applyTaxDetails(data, v) {
    if (!data.taxSettings) data.taxSettings = {};
    data.taxSettings.includeMedicareLevy = !!v.includeMedicareLevy;
    data.taxSettings.includeHelpInEstimate = !!v.includeHelpInEstimate;
    data.taxSettings.helpBalance = Math.max(0, Number(v.helpBalance) || 0);
}

// ── DOM ─────────────────────────────────────────────────────────────────────

async function persist() {
    const { updateDataAndUI } = await import('./render.js');
    updateDataAndUI();
}

function undo(res) {
    showUndoToast({ message: res.message, onUndo: async () => { res.onUndo(); await persist(); }, onExpire: res.onExpire });
}

/** The delete handler for a source's sheet: refuses the last source with a toast, else removes with Undo. */
export async function deleteIncomeSourceFlow(index) {
    const res = removeIncomeSource(store.financeData, index);
    if (!res.ok) { showToast(res.message, 'error'); return false; }
    await persist();
    undo(res);
    return true;
}

function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

function eventsBlock(source, onOpen) {
    const wrap = node('section', 'ils-card');
    wrap.appendChild(node('h3', 'ils-card-title', t('varInc.eventsTitle', { name: source.name || '' })));
    const events = Array.isArray(source.incomeEvents) ? source.incomeEvents : [];
    const fyKey = activeFyKey(store.financeData.taxSettings);
    const { from, to } = fyRange(fyKey);
    const totals = sumEvents(events, from, to);
    wrap.appendChild(node('p', 'ils-muted', t('varInc.fyTotal', {
        fy: AU_TAX_YEARS[fyKey] ? AU_TAX_YEARS[fyKey].label : fyKey, net: formatCurrency(totals.net), count: totals.count,
        eventWord: t(totals.count === 1 ? 'varInc.eventOne' : 'varInc.eventMany'),
    })));
    if (!events.length) wrap.appendChild(node('p', 'ils-muted', t('varInc.noEvents')));
    events.slice(0, 8).forEach((e, i) => {
        const b = node('button', 'btn ghost', `${e.date || ''}  ${e.label || ''}  ${formatCurrency(Number(e.netAmount) || 0)}`);
        b.type = 'button';
        b.addEventListener('click', () => onOpen(i));
        wrap.appendChild(b);
    });
    const add = node('button', 'btn ghost', t('varInc.addEvent'));
    add.type = 'button';
    add.addEventListener('click', () => onOpen(null));
    wrap.appendChild(add);
    return wrap;
}

/** One income event: add (index null) or edit, with delete + Undo. Reopens the source sheet after. */
export function openIncomeEventSheet(sourceIndex, eventIndex, then) {
    const data = store.financeData;
    const source = data.incomeSources[sourceIndex];
    if (!source) return;
    const existing = eventIndex == null ? null : (source.incomeEvents || [])[eventIndex];
    openSheet({
        title: t(existing ? 'a12b.event.edit' : 'a12b.event.add'), fields: eventFields(),
        values: existing ? { ...existing } : makeIncomeEvent(), validate: eventValidate,
        onSave: async (vals) => { applyEvent(source, eventIndex, vals); await persist(); if (then) then(); },
        onDelete: existing ? async () => {
            const res = removeEvent(source, eventIndex);
            await persist();
            undo(res);
            if (then) then();
        } : undefined,
    });
}

/** The card at the top of a flagged Self-employed sheet: switch to the Salary layout, or leave it as it is. */
function offerBlock(index, close) {
    const wrap = node('section', 'ils-card');
    wrap.dataset.offer = 'payslip-job';
    wrap.appendChild(node('h3', 'ils-card-title', t('c.income.offer.title')));
    wrap.appendChild(node('p', 'ils-muted', t('c.income.offer.body')));
    const acts = node('div', 'ils-acts');
    const accept = node('button', 'btn', t('c.income.offer.accept'));
    accept.type = 'button';
    accept.dataset.offerAction = 'accept';
    accept.addEventListener('click', async () => {
        const source = store.financeData.incomeSources[index];
        const revert = acceptPayslipJobWithUndo(source);
        if (!revert) return;
        close();
        await persist();
        showUndoToast({
            message: t('c.income.offer.done', { name: source.name || t('a12b.income.unnamed') }),
            onUndo: async () => { revert(); await persist(); },
        });
        const { openIncomeSheet } = await import('./income-layout.js');
        openIncomeSheet(index);
    });
    const keep = node('button', 'btn ghost', t('c.income.offer.dismiss'));
    keep.type = 'button';
    keep.dataset.offerAction = 'dismiss';
    keep.title = t('c.income.offer.keep');
    keep.addEventListener('click', async () => {
        if (declinePayslipJobOffer(store.financeData.incomeSources[index])) await persist();
        wrap.remove();
    });
    acts.append(accept, keep);
    wrap.appendChild(acts);
    return wrap;
}

/** The editor for a Self-employed or Variable source (C6's sheets only cover Salary and Set-hours). */
export function openOtherIncomeSheet(index) {
    const data = store.financeData;
    const source = data && data.incomeSources && data.incomeSources[index];
    if (!source || typeof document === 'undefined') return false;
    const reopen = () => setTimeout(() => openOtherIncomeSheet(index), 0);
    const content = [];
    let sheet = null;
    if (hasPayslipJobOffer(source)) content.push(offerBlock(index, () => { if (sheet) sheet.close(); }));
    if (source.incomeType === 'variable') content.push(eventsBlock(source, (i) => openIncomeEventSheet(index, i, reopen)));
    const stmt = node('button', 'btn ghost', t('a12b.income.statement'));
    stmt.type = 'button';
    stmt.addEventListener('click', async () => {
        const { openIncomeStatement } = await import('./income-statement.js');
        openIncomeStatement('6');
    });
    content.push(stmt);
    sheet = openSheet({
        title: t('a12b.income.title', { name: source.name || '' }),
        fields: otherIncomeFields(source), values: otherIncomeValues(data, index), content,
        validate: (v) => (String(v.name || '').trim() ? {} : { name: t('d.sheet.required') }),
        onSave: async (v) => { applyOtherIncome(data, index, v); await persist(); },
        onDelete: () => { deleteIncomeSourceFlow(index); },
    });
    return true;
}

/** Medicare levy, HELP in the estimate and the HELP balance (the old "Tax details" block). */
export function openTaxDetailsSheet() {
    const data = store.financeData;
    const ts = data.taxSettings || {};
    openSheet({
        title: t('a12b.tax.title'), fields: taxDetailsFields(),
        values: { includeMedicareLevy: !!ts.includeMedicareLevy, includeHelpInEstimate: ts.includeHelpInEstimate !== false, helpBalance: Number(ts.helpBalance) || 0 },
        validate: (v) => (v.helpBalance != null && v.helpBalance < 0 ? { helpBalance: t('a12b.event.negative') } : {}),
        onSave: async (v) => { applyTaxDetails(data, v); await persist(); },
    });
}
