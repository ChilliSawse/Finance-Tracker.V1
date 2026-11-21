// Default `model`, `split` and `transfers` steps, plus the closing `first` step (Phase 1 step C7).
// E8 registers its own `model`, `split` and `transfers` under the same ids and replaces these
// (registry: a normal registration always beats {defaultOnly}). These defaults are complete enough
// to run setup end to end: the model step names the one template, the split step shows the
// suggested split in dollars from the engine, the transfers step ticks bank transfers off.

import { t } from '../../i18n/strings.js';
import { esc } from '../html.js';
import { formatCurrency } from '../../utils.js';
import { planTotals, netPerPayCents } from '../../calc/plan.js';
import { transfersToUpdate } from '../../calc/smile.js';
import { getBuckets, applySuggestedSplit, tickTransfer } from '../../state/saving-model.js';
import { registerSetupStep, STEP_ORDER } from './registry.js';

const money = (cents) => formatCurrency(cents / 100);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- model ----------

export const modelStep = {
    id: 'model', order: STEP_ORDER.model, title: t('c.setup.model.title'), skippable: false, nextLabel: t('c.setup.model.next'),
    render() {
        const parts = [['daily', 60], ['splurge', 10], ['smile', 10], ['fire', 20]]
            .map(([role, pct]) => `<i class="b-${role}" style="flex:${pct}">${esc(pct)}</i>`).join('');
        return `<p class="su-lead">${esc(t('c.setup.model.lead'))}</p>
            <label class="su-opt on"><input type="radio" name="su-model" value="bucket" checked>
            <span class="o-body"><b>${esc(t('c.setup.model.name'))}</b><span class="o-src">${esc(t('c.setup.model.source'))}</span>
            <span class="su-mini" aria-hidden="true">${parts}</span>
            <span class="o-why">${esc(t('c.setup.model.why'))}</span></span></label>
            <div class="su-soon"><b>${esc(t('c.setup.model.soon'))}</b><span class="su-fine">${esc(t('c.setup.model.soonList'))}</span></div>
            <p class="su-fine">${esc(t('c.setup.model.disclaimer'))}</p>`;
    },
};

// ---------- split ----------

const TEMPLATE = { daily: 60, splurge: 10, smile: 10, fire: 20 };

/** True while the four core buckets still sit on the book's 60 / 10 / 10 / 20. */
export function onTemplateSplit(data) {
    const rows = Array.isArray(data.allocation) ? data.allocation : [];
    return Object.entries(TEMPLATE).every(([role, pct]) => {
        const r = rows.find((x) => x && x.role === role);
        return r && Number(r.percentage) === pct;
    });
}

/**
 * What the split step shows, from the engine. While the split is still the template, the suggested
 * split (from essentials and non-essentials) is previewed on a copy; the saved split is untouched until Next.
 */
export function splitModel(data, today) {
    const pt = planTotals(data);
    const netCents = Math.max(0, netPerPayCents(data));
    const essentialCents = Math.round(pt.essentialPerCycle * 100);
    const nonEssentialCents = Math.round(pt.nonEssentialPerCycle * 100);
    let view = data;
    let suggested = false;
    if (netCents > 0 && onTemplateSplit(data)) {
        const copy = clone(data);
        if (applySuggestedSplit(copy).ok) { view = copy; suggested = true; }
    }
    const rows = getBuckets(view, today).filter((b) => !b.parentId && b.kind !== 'goal' && b.role !== 'mojo' && b.role !== 'grow')
        .map((b) => ({ id: b.id, role: b.role, name: b.name, pct: b.pct, perPayCents: b.perPayCents }));
    const placed = rows.reduce((s, r) => s + r.perPayCents, 0);
    return { netCents, essentialCents, nonEssentialCents, rows, leftCents: netCents - placed, suggested };
}

export const splitStep = {
    id: 'split', order: STEP_ORDER.split, title: t('c.setup.split.title'), nextLabel: t('c.setup.split.next'),
    render(ctx) {
        const m = splitModel(ctx.data, ctx.today);
        if (m.netCents <= 0) return `<p class="su-lead">${esc(t('c.setup.split.noPay'))}</p>`;
        const rows = m.rows.map((r) => `<li class="b-${esc(r.role || 'x')}"><span class="su-li-main"><b>${esc(r.name)}</b></span>
            <span class="su-li-r"><b class="su-money">${esc(money(r.perPayCents))}</b><span class="su-li-sub">${esc(Math.round(r.pct * 10) / 10)}%</span></span></li>`).join('');
        return `<p class="su-lead">${esc(t('c.setup.split.lead', { pay: money(m.netCents) }))}</p>
            <dl class="su-kv"><div><dt>${esc(t('c.setup.split.essentials'))}</dt><dd class="su-money">${esc(money(m.essentialCents))}</dd></div>
            <div><dt>${esc(t('c.setup.split.non'))}</dt><dd class="su-money">${esc(money(m.nonEssentialCents))}</dd></div></dl>
            <ul class="su-list su-buckets">${rows}</ul>
            <div class="su-total"><span>${esc(t('c.setup.split.left'))}</span><b class="su-money">${esc(money(m.leftCents))}</b></div>
            <p class="su-fine">${esc(t(m.suggested ? 'c.setup.split.noteSuggested' : 'c.setup.split.noteSaved'))}</p>`;
    },
    onNext(ctx) {
        // Only an untouched template takes the suggestion; a split the person changed is kept as it is.
        if (onTemplateSplit(ctx.data) && netPerPayCents(ctx.data) > 0) {
            const res = applySuggestedSplit(ctx.data);
            if (res.ok) ctx.save();
        }
        return true;
    },
};

// ---------- transfers ----------

/** Buckets that need a bank transfer, each with ticked true once the bank amount matches. */
export function transfersModel(data) {
    const net = Math.max(0, netPerPayCents(data));
    const sm = data.savingModel || {};
    const pending = new Set(transfersToUpdate({ allocation: data.allocation, netCents: net, bankSetTo: sm.transfers && sm.transfers.bankSetTo })
        .map((r) => r.bucketId));
    const rows = getBuckets(data, '').filter((b) => !b.parentId && b.kind !== 'goal' && b.role !== 'mojo' && b.role !== 'grow');
    return {
        transfers: rows.filter((b) => b.role !== 'daily' && b.perPayCents > 0).map((b) => ({ id: b.id, name: b.name, perPayCents: b.perPayCents, ticked: !pending.has(b.id) })),
        stay: rows.filter((b) => b.role === 'daily').map((b) => ({ name: b.name, perPayCents: b.perPayCents }))[0] || null,
    };
}

export const transfersStep = {
    id: 'transfers', order: STEP_ORDER.transfers, title: t('c.setup.transfers.title'), nextLabel: t('c.setup.transfers.next'),
    render(ctx) {
        const m = transfersModel(ctx.data);
        if (!m.transfers.length) return `<p class="su-lead">${esc(t('c.setup.transfers.none'))}</p>`;
        const items = m.transfers.map((r) => `<li><label class="su-check"><input type="checkbox" data-su-change="tick" data-id="${esc(r.id)}"${r.ticked ? ' checked disabled' : ''}>
            <span class="su-li-main"><b>${esc(r.name)}</b></span><b class="su-money">${esc(money(r.perPayCents))}</b></label></li>`).join('');
        const done = m.transfers.filter((r) => r.ticked).length;
        return `<p class="su-lead">${esc(t('c.setup.transfers.lead'))}</p>
            <ul class="su-list">${items}</ul>
            ${m.stay ? `<p class="su-fine">${esc(t('c.setup.transfers.stay', { name: m.stay.name, amount: money(m.stay.perPayCents) }))}</p>` : ''}
            <p class="su-fine" aria-live="polite">${esc(t('c.setup.transfers.count', { done, total: m.transfers.length }))}</p>`;
    },
    actions: {
        tick(ctx, el) {
            const res = tickTransfer(ctx.data, el.dataset.id);
            if (res.ok) ctx.save();
            ctx.refresh();
        },
    },
};

// ---------- the closing step ----------

export const firstStep = {
    id: 'first', order: STEP_ORDER.first, title: t('c.setup.first.title'), nextLabel: t('c.setup.first.done'), skippable: false,
    render() {
        return `<p class="su-lead">${esc(t('c.setup.first.lead'))}</p>
            <div class="su-choices">
            <button type="button" class="su-btn" data-su-act="logExpense" data-su-focus="first-log">${esc(t('c.setup.first.log'))}</button>
            <button type="button" class="su-btn su-btn-ghost" data-su-act="importStatement" data-su-focus="first-import">${esc(t('c.setup.first.import'))}</button></div>
            <p class="su-fine">${esc(t('c.setup.first.later'))}</p>`;
    },
    actions: {
        logExpense(ctx) { ctx.finish({ then: 'quick-add' }); },
        importStatement(ctx) { ctx.finish({ then: 'import' }); },
    },
    onNext(ctx) { ctx.finish({ then: 'today' }); return false; },
};

export function registerBasicSteps() {
    registerSetupStep(modelStep, { defaultOnly: true });
    registerSetupStep(splitStep, { defaultOnly: true });
    registerSetupStep(transfersStep, { defaultOnly: true });
    registerSetupStep(firstStep);
}
