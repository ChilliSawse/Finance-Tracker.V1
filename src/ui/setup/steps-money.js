// Setup money steps (Phase 1 step C7, M-15): essentials (bills included), non-essentials and debts.
// Plan items are written through B4's addPlanItem (via A9a's savePlanItem), the category's
// essential flag decides which list a line is in. Debts are liabilities with ids (E4's
// newLiabilityId) taking balance, rate and minRepayment. Every step can be skipped and a skip
// writes nothing. F5's newDebt later replaces makeDebt below (one place to repoint).

import { t } from '../../i18n/strings.js';
import { esc } from '../html.js';
import { formatCurrency } from '../../utils.js';
import { planTotals, netPerPayCents } from '../../calc/plan.js';
import { newLiabilityId } from '../../state/bucket-migration.js';
import { removePlanItem } from '../../state/plan.js';
import { planItemSheetSpec, savePlanItem, nextDue, shortDate, FREQUENCIES } from '../plan-lists.js';
import { openSheet } from '../sheet.js';
import { showUndoToast } from '../toast.js';
import { registerSetupStep, STEP_ORDER } from './registry.js';

const money = (n) => formatCurrency(n);
const PLACEHOLDER_DEBT_ID = 'l-new-liability';

// ---------- pure ----------

const catMap = (data) => new Map((data.categories || []).filter(Boolean).map((c) => [c.id, c]));

/** Plan lines in the essential (kind 'essential') or non-essential (kind 'non') list, by the category flag. */
export function moneyRows(data, kind) {
    const cats = catMap(data);
    const wantEssential = kind === 'essential';
    return (data.plan || []).filter((p) => {
        if (!p || p.inTotals === false) return false;
        const c = cats.get(p.categoryId);
        return !!(c ? c.essential : p.essential) === wantEssential;
    });
}

/** The A9a sheet spec with the category choices cut to this list's side of the flag. */
export function moneySheetSpec(data, kind, item = null, preset = null) {
    const spec = planItemSheetSpec(data, { kind, item });
    const wantEssential = kind === 'essential';
    const cats = (data.categories || []).filter((c) => c && c.id && c.id !== 'income' && c.id !== 'transfer' && !!c.essential === wantEssential);
    if (cats.length) {
        const f = spec.fields.find((x) => x.key === 'categoryId');
        if (f) f.options = cats.map((c) => ({ value: c.id, label: c.name || c.id }));
        if (!cats.some((c) => c.id === spec.values.categoryId)) spec.values.categoryId = cats[0].id;
    }
    if (preset) {
        if (preset.name) spec.values.name = preset.name;
        if (preset.categoryId && cats.some((c) => c.id === preset.categoryId)) spec.values.categoryId = preset.categoryId;
    }
    return spec;
}

/** Totals for the readout, from the engine: per pay, and the share of take-home. */
export function moneyTotals(data, kind) {
  const pt = planTotals(data);
  const per = kind === 'essential' ? pt.essentialPerCycle : pt.nonEssentialPerCycle;
  let net = 0;
  try { net = netPerPayCents(data) / 100; } catch (e) { net = 0; }
  return { perCycle: per, cycles: pt.cyclesPerYear, share: net > 0 ? Math.round((per / net) * 100) : null };
}

/** Real debts (the untouched placeholder row is not one). */
export function debtRows(data) {
  return (data.liabilities || []).filter((l) => l && !(l.id === PLACEHOLDER_DEBT_ID && l.name === 'New Liability' && !Number(l.balance) && !Number(l.interestRate)));
}

/** Add a debt: id from E4's factory, balance (A$), rate (% a year), minRepayment (A$ a month). */
export function makeDebt(data, fields = {}) {
    if (!Array.isArray(data.liabilities)) data.liabilities = [];
    const name = String(fields.name || '').trim();
    const placeholder = data.liabilities.findIndex((l) => l && l.id === PLACEHOLDER_DEBT_ID && l.name === 'New Liability' && !Number(l.balance) && !Number(l.interestRate));
    if (placeholder >= 0) data.liabilities.splice(placeholder, 1);
    const debt = {
        id: newLiabilityId(data.liabilities, name),
        name, balance: Number(fields.balance) || 0, interestRate: Number(fields.interestRate) || 0, minRepayment: Number(fields.minRepayment) || 0,
    };
    data.liabilities.push(debt);
    return debt;
}

export function setupDebtSheetSpec(debt = null) {
    return {
        title: t(debt ? 'c.setup.debts.edit' : 'c.setup.debts.add'),
        fields: [
            { key: 'name', label: t('c.setup.debts.name'), type: 'text', required: true },
            { key: 'balance', label: t('c.setup.debts.balance'), type: 'money', required: true },
            { key: 'interestRate', label: t('c.setup.debts.rate'), type: 'percent', hint: t('c.setup.debts.rateHint') },
            { key: 'minRepayment', label: t('c.setup.debts.min'), type: 'money', hint: t('c.setup.debts.minHint') },
        ],
        values: debt ? { name: debt.name, balance: debt.balance, interestRate: debt.interestRate, minRepayment: debt.minRepayment || 0 }
            : { name: '', balance: null, interestRate: null, minRepayment: null },
        validate(v) {
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('c.setup.debts.errName');
            if (v.balance == null || !(Number(v.balance) >= 0)) errors.balance = t('c.setup.debts.errBalance');
            return errors;
        },
    };
}

// ---------- rendering ----------

function freqText(f) {
    return FREQUENCIES.includes(f) ? t(`a.plan.freq.${f}`) : '';
}

function itemRowHtml(item, today) {
    const due = item.anchorDue ? nextDue(item, today) : null;
    const sub = due ? t('c.setup.money.due', { date: shortDate(due) }) : t('c.setup.money.noDue');
    return `<li><span class="su-li-main"><b>${esc(item.name)}</b><span class="su-li-sub">${esc(sub)}</span></span>
        <span class="su-li-r"><b class="su-money">${esc(money(Number(item.amount) || 0))}</b><span class="su-li-sub">${esc(freqText(item.frequency))}</span></span>
        <span class="su-li-acts"><button type="button" class="su-link" data-su-act="editItem" data-id="${esc(item.id)}" data-su-focus="e-${esc(item.id)}">${esc(t('c.setup.money.edit'))}</button>
        <button type="button" class="su-link" data-su-act="removeItem" data-id="${esc(item.id)}">${esc(t('c.setup.money.remove'))}</button></span></li>`;
}

export function renderMoney(ctx, kind) {
    const rows = moneyRows(ctx.data, kind);
    const tot = moneyTotals(ctx.data, kind);
    const chipKeys = kind === 'essential' ? ['rent', 'groceries', 'power', 'phone', 'insurance', 'transport'] : ['dining', 'streaming', 'fitness', 'shopping'];
    const chips = chipKeys.map((k) => `<button type="button" class="su-chip" data-su-act="chip" data-kind="${esc(kind)}" data-chip="${esc(k)}">${esc(t(`c.setup.chip.${k}`))}</button>`).join('');
    return `<p class="su-lead">${esc(t(`c.setup.${kind}.lead`))}</p>
        <div class="su-total"><span>${esc(t('c.setup.money.perPay'))}</span><b class="su-money">${esc(money(tot.perCycle))}</b>${tot.share != null ? `<span class="su-fine">${esc(t('c.setup.money.share', { pct: tot.share }))}</span>` : ''}</div>
        ${rows.length ? `<ul class="su-list">${rows.map((r) => itemRowHtml(r, ctx.today)).join('')}</ul>` : `<p class="su-empty">${esc(t(`c.setup.${kind}.empty`))}</p>`}
        <div class="su-chips" role="group" aria-label="${esc(t('c.setup.money.quick'))}">${chips}</div>
        <button type="button" class="su-btn su-btn-ghost" data-su-act="addItem" data-kind="${esc(kind)}" data-su-focus="add-${esc(kind)}">${esc(t(`c.setup.${kind}.add`))}</button>`;
}

const CHIP_CATEGORY = {
    rent: ['housing', 'c.setup.chip.rent'], groceries: ['groceries', 'c.setup.chip.groceries'], power: ['utilities', 'c.setup.chip.power'],
    phone: ['phone-internet', 'c.setup.chip.phone'], insurance: ['insurance', 'c.setup.chip.insurance'], transport: ['transport', 'c.setup.chip.transport'],
    dining: ['dining', 'c.setup.chip.dining'], streaming: ['entertainment', 'c.setup.chip.streaming'], fitness: ['fitness', 'c.setup.chip.fitness'],
    shopping: ['shopping', 'c.setup.chip.shopping'],
};

function openMoneySheet(ctx, kind, item, preset) {
    const spec = moneySheetSpec(ctx.data, kind, item, preset);
    openSheet({
        title: spec.title, fields: spec.fields, values: spec.values, validate: spec.validate, plausibility: spec.plausibility,
        onSave(values) {
            const res = savePlanItem(ctx.data, item, values, { kind });
            if (!res.ok) return false;
            ctx.save();
            ctx.refresh();
            showUndoToast({ message: res.message, onUndo: () => { res.onUndo(); ctx.save(); ctx.refresh(); }, onExpire: res.onExpire });
            return undefined;
        },
    });
}

function moneyActions(kindOf) {
    return {
        addItem(ctx, el) { openMoneySheet(ctx, el.dataset.kind, null, null); },
        chip(ctx, el) {
            const hit = CHIP_CATEGORY[el.dataset.chip];
            if (hit) openMoneySheet(ctx, el.dataset.kind, null, { name: t(hit[1]), categoryId: hit[0] });
        },
        editItem(ctx, el) {
            const item = (ctx.data.plan || []).find((p) => p && p.id === el.dataset.id);
            if (item) openMoneySheet(ctx, kindOf, item, null);
        },
        removeItem(ctx, el) {
            const res = removePlanItem(ctx.data, el.dataset.id);
            if (!res.ok) return;
            ctx.save();
            ctx.refresh();
            showUndoToast({ message: res.message, onUndo: () => { res.onUndo(); ctx.save(); ctx.refresh(); }, onExpire: res.onExpire });
        },
    };
}

export const essentialsStep = {
    id: 'essentials', order: STEP_ORDER.essentials, title: t('c.setup.essential.title'),
    render: (ctx) => renderMoney(ctx, 'essential'), actions: moneyActions('essential'), nextLabel: t('c.setup.essential.next'),
};

export const nonEssentialsStep = {
    id: 'nonEssentials', order: STEP_ORDER.nonEssentials, title: t('c.setup.non.title'),
    render: (ctx) => renderMoney(ctx, 'non'), actions: moneyActions('non'), nextLabel: t('c.setup.non.next'),
};

// ---------- debts ----------

function debtRowHtml(d) {
    const sub = [d.interestRate ? t('c.setup.debts.rateShort', { rate: d.interestRate }) : '', d.minRepayment ? t('c.setup.debts.minShort', { amount: money(d.minRepayment) }) : '']
        .filter(Boolean).join(' · ');
    return `<li><span class="su-li-main"><b>${esc(d.name)}</b><span class="su-li-sub">${esc(sub)}</span></span>
        <span class="su-li-r"><b class="su-money">${esc(money(Number(d.balance) || 0))}</b></span>
        <span class="su-li-acts"><button type="button" class="su-link" data-su-act="editDebt" data-id="${esc(d.id)}">${esc(t('c.setup.money.edit'))}</button>
        <button type="button" class="su-link" data-su-act="removeDebt" data-id="${esc(d.id)}">${esc(t('c.setup.money.remove'))}</button></span></li>`;
}

const hasStudyDebt = (data) => (data.incomeSources || []).some((s) => s && s.withholding && s.withholding.hasStudyDebt === true);

export function renderDebts(ctx) {
    const rows = debtRows(ctx.data);
    const help = hasStudyDebt(ctx.data);
    const helpBal = Number(ctx.data.taxSettings && ctx.data.taxSettings.helpBalance) || 0;
    return `<p class="su-lead">${esc(t('c.setup.debts.lead'))}</p>
        ${help ? `<div class="su-note" role="note">${esc(t(helpBal > 0 ? 'c.setup.debts.helpSet' : 'c.setup.debts.help', { amount: money(helpBal) }))}
            <button type="button" class="su-link" data-su-act="helpBalance" data-su-focus="help">${esc(t('c.setup.debts.helpBtn'))}</button></div>` : ''}
        ${rows.length ? `<ul class="su-list">${rows.map(debtRowHtml).join('')}</ul>` : `<p class="su-empty">${esc(t('c.setup.debts.empty'))}</p>`}
        <button type="button" class="su-btn su-btn-ghost" data-su-act="addDebt" data-su-focus="add-debt">${esc(t('c.setup.debts.addBtn'))}</button>
        <p class="su-fine">${esc(t('c.setup.debts.skipNote'))}</p>`;
}

export const debtsStep = {
    id: 'debts', order: STEP_ORDER.debts, title: t('c.setup.debts.title'), render: renderDebts, nextLabel: t('c.setup.debts.next'),
    actions: {
        addDebt(ctx) {
            const spec = setupDebtSheetSpec(null);
            openSheet({ ...spec, onSave(v) { makeDebt(ctx.data, v); ctx.save(); ctx.refresh(); return undefined; } });
        },
        editDebt(ctx, el) {
            const debt = (ctx.data.liabilities || []).find((l) => l && l.id === el.dataset.id);
            if (!debt) return;
            const spec = setupDebtSheetSpec(debt);
            openSheet({
                ...spec,
                onSave(v) {
                    debt.name = String(v.name).trim(); debt.balance = Number(v.balance) || 0;
                    debt.interestRate = Number(v.interestRate) || 0; debt.minRepayment = Number(v.minRepayment) || 0;
                    ctx.save(); ctx.refresh(); return undefined;
                },
            });
        },
        removeDebt(ctx, el) {
            const list = ctx.data.liabilities || [];
            const i = list.findIndex((l) => l && l.id === el.dataset.id);
            if (i < 0) return;
            const [gone] = list.splice(i, 1);
            ctx.save(); ctx.refresh();
            showUndoToast({ message: t('c.setup.debts.removed', { name: gone.name }), onUndo: () => { list.splice(Math.min(i, list.length), 0, gone); ctx.save(); ctx.refresh(); } });
        },
        helpBalance(ctx) {
            if (!ctx.data.taxSettings) ctx.data.taxSettings = {};
            openSheet({
                title: t('c.setup.debts.helpTitle'),
                fields: [{ key: 'helpBalance', label: t('c.setup.debts.helpField'), type: 'money', hint: t('c.setup.debts.helpHint') }],
                values: { helpBalance: Number(ctx.data.taxSettings.helpBalance) || null },
                onSave(v) { ctx.data.taxSettings.helpBalance = Number(v.helpBalance) || 0; ctx.save(); ctx.refresh(); return undefined; },
            });
        },
    },
};

export function registerMoneySteps() {
    registerSetupStep(essentialsStep);
    registerSetupStep(nonEssentialsStep);
    registerSetupStep(debtsStep);
}
