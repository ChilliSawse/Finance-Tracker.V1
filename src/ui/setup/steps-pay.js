// Setup steps `layout` (the pay sheet for each job) and `pay` (what the engine works out from it).
// C6's openIncomeSheet is the editor for Salary and Set hours; Shifts & casual and Business use the
// existing income form with a "full layout coming" note (FT-R-68). Every figure in the readout comes
// from calculateTotals, netPerPayCents and nextPayDates: none is typed in (FT-R-75 D2).

import { t } from '../../i18n/strings.js';
import { esc } from '../html.js';
import { formatCurrency } from '../../utils.js';
import { calculateTotals } from '../../calc/calculations.js';
import { netPerPayCents } from '../../calc/plan.js';
import { nextPayDates, parseIso } from '../../calc/pay-cycle.js';
import { getPayCyclesPerYear } from '../../utils.js';
import { layoutFor, openIncomeSheet } from '../income-layout.js';
import { openOtherIncomeSheet } from '../income-other.js';
import { needsLaterLayout } from './quiz.js';
import { shortDate } from '../plan-lists.js';
import { registerSetupStep, STEP_ORDER } from './registry.js';

// ---------- pure ----------

/** The layout of job i: what the quiz chose, else what the saved source looks like. */
export function layoutOfJob(state, source, i) {
    const chosen = state && state.quiz && state.quiz.layouts && state.quiz.layouts[i];
    if (chosen) return chosen;
    if (!source) return 'salary';
    if (source.incomeType === 'selfEmployed') return 'business';
    if (source.incomeType === 'variable') return 'shifts';
    return layoutFor(source) || 'salary';
}

/** The pay readout, all from the engine. hasPay is false until a source has a salary. */
export function payReadout(data, today) {
    const sources = Array.isArray(data.incomeSources) ? data.incomeSources : [];
    const primary = sources[data.primaryIncomeIndex || 0] || sources[0] || null;
    const out = { hasPay: false, netCents: 0, gross: 0, cycle: primary ? primary.paySchedule : null, nextPay: null, refund: null, anchorSet: false };
    if (!primary) return out;
    const clone = JSON.parse(JSON.stringify(data));
    const totals = calculateTotals(clone, { today: parseIso(today) });
    const cycles = getPayCyclesPerYear(primary.paySchedule);
    out.gross = Math.round(((Number(primary.grossAnnual) || 0) / cycles) * 100) / 100;
    out.netCents = netPerPayCents(data);
    out.hasPay = out.gross > 0 || out.netCents > 0;
    out.anchorSet = !!primary.payAnchor && primary.incomeType !== 'variable';
    if (out.anchorSet) out.nextPay = nextPayDates(primary, today, 1)[0] || null;
    const rb = totals._refundOrBill;
    if (rb && (rb.kind === 'refund' || rb.kind === 'bill') && Number.isFinite(Number(rb.amount))) out.refund = { kind: rb.kind, amount: Math.abs(Number(rb.amount)) };
    return out;
}

// ---------- closing a sheet or the old editor refreshes the step ----------

function afterClose(ctx, kind) {
    if (typeof MutationObserver === 'undefined') return;
    const gone = () => !document.querySelector('.sheet-layer');
    const target = document.body;
    const obs = new MutationObserver(() => {
        if (!gone()) return;
        obs.disconnect();
        ctx.refresh();
    });
    obs.observe(target, { childList: true, subtree: true });
}

function openPay(ctx, i) {
    const source = ctx.data.incomeSources[i];
    if (!source) return;
    const layout = layoutOfJob(ctx.state, source, i);
    if (!needsLaterLayout(layout)) {
        let opened = false;
        try { opened = openIncomeSheet(i, { layout }) !== false; } catch (err) { console.error('income sheet failed', err); }
        if (opened) { afterClose(ctx, 'sheet'); return; }
    }
    if (openOtherIncomeSheet(i)) afterClose(ctx, 'sheet');
}

// ---------- layout step ----------

const cap = (s) => String(s || '').toLowerCase();

function jobCard(ctx, s, i) {
    const layout = layoutOfJob(ctx.state, s, i);
    const later = needsLaterLayout(layout);
    const saved = !later && Number(s.grossAnnual) > 0;
    const cycleWord = cap(t(`a.plan.freqOpt.${s.paySchedule}`) || s.paySchedule);
    const summary = saved
        ? (layout === 'hours' && Number(s.hourlyRate) > 0
            ? t('c.setup.layout.savedHours', { rate: formatCurrency(s.hourlyRate), hours: s.hoursPerWeek, cycle: cycleWord })
            : t('c.setup.layout.saved', { gross: formatCurrency(s.grossAnnual, undefined, 0), cycle: cycleWord }))
        : t('c.setup.layout.empty');
    return `<li class="su-card">
        <div class="su-card-h"><b>${esc(s.name || t('c.setup.job.n', { n: i + 1 }))}</b><span class="su-tag">${esc(t(`c.setup.layout.${layout}`))}</span></div>
        <p class="su-li-sub">${esc(summary)}</p>
        ${later ? `<p class="su-note" role="note">${esc(t('c.setup.layout.later'))}</p>` : ''}
        <button type="button" class="su-btn${saved ? ' su-btn-ghost' : ''}" data-su-act="openPay" data-index="${i}" data-su-focus="pay-${i}">${esc(t(later ? 'c.setup.layout.openOld' : saved ? 'c.setup.layout.change' : 'c.setup.layout.open'))}</button></li>`;
}

export const layoutStep = {
    id: 'layout', order: STEP_ORDER.layout, title: t('c.setup.layout.title'),
    render(ctx) {
        const list = ctx.data.incomeSources || [];
        return `<p class="su-lead">${esc(t('c.setup.layout.lead'))}</p><ul class="su-cards">${list.map((s, i) => jobCard(ctx, s, i)).join('')}</ul>`;
    },
    actions: { openPay(ctx, el) { openPay(ctx, Number(el.dataset.index) || 0); } },
};

// ---------- pay step ----------

export function renderPay(ctx) {
    const r = payReadout(ctx.data, ctx.today);
    if (!r.hasPay) return `<p class="su-lead">${esc(t('c.setup.pay.none'))}</p>`;
    const rows = [
        [t('c.setup.pay.gross'), formatCurrency(r.gross)],
        [t('c.setup.pay.take'), formatCurrency(r.netCents / 100)],
    ];
    if (r.nextPay) rows.push([t('c.setup.pay.next'), shortDate(r.nextPay)]);
    if (r.refund) rows.push([t(r.refund.kind === 'bill' ? 'c.setup.pay.bill' : 'c.setup.pay.refund'), formatCurrency(r.refund.amount, undefined, 0)]);
    const kv = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="su-money">${esc(v)}</dd></div>`).join('');
    return `<p class="su-lead">${esc(t('c.setup.pay.lead'))}</p>
        <dl class="su-kv">${kv}</dl>
        ${r.anchorSet || (ctx.data.incomeSources[ctx.data.primaryIncomeIndex || 0] || {}).incomeType === 'variable' ? '' : `<div class="su-note" role="note">${esc(t('c.setup.pay.noAnchor'))}
            <button type="button" class="su-link" data-su-act="openPay" data-index="${ctx.data.primaryIncomeIndex || 0}" data-su-focus="pay-day">${esc(t('c.setup.pay.setDay'))}</button></div>`}
        <p class="su-fine">${esc(t('c.setup.pay.check'))}
            <button type="button" class="su-link" data-su-act="openPay" data-index="${ctx.data.primaryIncomeIndex || 0}" data-su-focus="pay-check">${esc(t('c.setup.pay.checkBtn'))}</button></p>`;
}

export const payStep = {
    id: 'pay', order: STEP_ORDER.pay, title: t('c.setup.pay.title'), render: renderPay, nextLabel: t('c.setup.pay.next.btn'),
    actions: layoutStep.actions,
};

export function registerPaySteps() {
    registerSetupStep(layoutStep);
    registerSetupStep(payStep);
}
