// Setup steps for the Bucket method (Phase 1 step E8, X5): `model`, `split` and `transfers`.
// They replace C7's placeholder steps under the same ids. Everything shown comes from the engine
// (netPerPayCents, planTotals, getBuckets, transfersToUpdate); writes go through E5's state API.
//
//   model      Bucket method only, with its source and a one-line why (FT-R-29).
//   split      expenses first, then the buckets in dollars with the book's guide beside each (FT-R-26),
//              and starting balances for Smile, Fire and Mojo, asked once and skippable.
//   transfers  a checklist writing bankSetTo (tickTransfer) and "add each pay's amounts for me"
//              (setAutoCredit, on for new setups, FT-R-80).

import { t } from '../../i18n/strings.js';
import '../../i18n/en-lazy-models.js'; // the DB15 picker strings (en-lazy)
import { esc, escNum } from '../html.js';
import { formatCurrency } from '../../utils.js';
import { planTotals, netPerPayCents } from '../../calc/plan.js';
import { transfersToUpdate } from '../../calc/smile.js';
import { getBuckets, applySuggestedSplit, tickTransfer, setAutoCredit } from '../../state/saving-model.js';
import { registerSetupStep, STEP_ORDER } from './registry.js';

const money = (cents) => formatCurrency(cents / 100);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** The book's guide split, shown beside each bucket. */
const GUIDE = { daily: 60, splurge: 10, smile: 10, fire: 20 };
const BALANCE_ROLES = ['smile', 'fire', 'mojo'];

// ---------- model ----------

// The catalogue beyond the Bucket method (DB15). Read once, lazily: with no extra entries (the launch catalogue holds the Bucket
// method alone) the step is exactly the single card below and nothing is imported.
let extras = null; // null: not read yet; [] or rows: {id, name, blurb, state, choosable, entry}

function extraRowHtml(r) {
    const note = r.state === 'needs-newer' ? t('m.pick.needsNewer') : r.state === 'replaces' ? t('m.pick.replaces') : '';
    return `<label class="su-opt"><input type="radio" name="su-model" value="${esc(r.id)}" data-su-change="pick"${r.choosable ? '' : ' disabled'}>
            <span class="o-body"><b>${esc(r.name)}</b>${r.blurb ? `<span class="o-why">${esc(r.blurb)}</span>` : ''}${note ? `<span class="su-fine">${esc(note)}</span>` : ''}</span></label>`;
}

export const modelStep = {
    id: 'model', order: STEP_ORDER.model, title: t('c.setup.model.title'), skippable: false, nextLabel: t('c.setup.model.next'),
    render(ctx) {
        if (extras === null && ctx && ctx.data) {
            extras = [];
            import('../model-picker.js').then(async (m) => {
                const { loadCatalogue } = await import('../../state/model-catalogue.js');
                extras = m.pickerRows(await loadCatalogue(), ctx.data).filter((r) => r.id !== 'bucket-method');
                if (extras.length && ctx.refresh) ctx.refresh();
            }).catch(() => { extras = []; });
        }
        const more = extras && extras.length ? extras : [];
        const parts = Object.entries(GUIDE)
            .map(([role, pct]) => `<i class="b-${role}" style="flex:${pct}">${esc(pct)}</i>`).join('');
        return `<p class="su-lead">${esc(t('c.setup.model.lead'))}</p>
            <label class="su-opt on"><input type="radio" name="su-model" value="bucket" checked${more.length ? ' data-su-change="pick"' : ''}>
            <span class="o-body"><b>${esc(t('c.setup.model.name'))}</b><span class="o-src">${esc(t('c.setup.model.source'))}</span>
            <span class="su-mini" aria-hidden="true">${parts}</span>
            <span class="o-why">${esc(t('c.setup.model.why'))}</span></span></label>
            ${more.map(extraRowHtml).join('')}
            <div class="su-soon"><b>${esc(t('c.setup.model.soon'))}</b><span class="su-fine">${esc(t('c.setup.model.soonList'))}</span></div>
            <p class="su-fine">${esc(t('c.setup.model.disclaimer'))}</p>`;
    },
    actions: {
        // A choice other than the Bucket method: read and check its file now, so Next can apply it without waiting.
        async pick(ctx, el) {
            if (!ctx.state) return;
            ctx.state.modelApply = null;
            const row = (extras || []).find((r) => r.id === el.value);
            if (!row || !row.choosable) return;
            const { loadEnvelope, useModel } = await import('../../state/model-catalogue.js');
            const res = await loadEnvelope(row.entry);
            // Setup: nothing typed yet, and the Bucket method is one tap back, so replacing the buckets is fine.
            if (res.ok) ctx.state.modelApply = (data) => useModel(data, res.envelope, { replaceBuckets: true });
        },
    },
    onNext(ctx) {
        const apply = ctx.state && ctx.state.modelApply;
        if (!apply) return true;
        ctx.state.modelApply = null;
        if (apply(ctx.data).ok) ctx.save();
        return true;
    },
};

// ---------- split ----------

/** True while the four core buckets still sit on the book's 60 / 10 / 10 / 20. */
export function onTemplateSplit(data) {
    const rows = Array.isArray(data.allocation) ? data.allocation : [];
    return Object.entries(GUIDE).every(([role, pct]) => {
        const r = rows.find((x) => x && x.role === role);
        return r && Number(r.percentage) === pct;
    });
}

/**
 * What the split step shows, from the engine. While the split is still the template, the suggested
 * split (from essentials and non-essentials) is previewed on a copy; the saved split is untouched until Next.
 * `leftAfterExpensesCents` is what is left of the pay once essentials and non-essentials are met.
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
        .map((b) => ({ id: b.id, role: b.role, name: b.name, pct: b.pct, perPayCents: b.perPayCents, guide: GUIDE[b.role] != null ? GUIDE[b.role] : null }));
    const placed = rows.reduce((s, r) => s + r.perPayCents, 0);
    return { netCents, essentialCents, nonEssentialCents, leftAfterExpensesCents: netCents - essentialCents - nonEssentialCents, rows, leftCents: netCents - placed, suggested };
}

/** The rows that can take a starting balance (Smile, Fire, Mojo), with what is saved now, in dollars. */
export function balanceRows(data) {
    const alloc = Array.isArray(data.allocation) ? data.allocation : [];
    return BALANCE_ROLES.map((role) => alloc.find((r) => r && r.role === role)).filter(Boolean)
        .map((r) => ({ id: String(r.id), role: r.role, name: r.name || '', saved: Number(r.currentBalance) > 0 ? Number(r.currentBalance) : 0 }));
}

/** Typed balances (dollars as typed) onto the rows. Blank, negative or not a number writes nothing. Returns the ids written. */
export function applyStartingBalances(data, typed) {
    const written = [];
    for (const row of balanceRows(data)) {
        const raw = typed && typed[row.id];
        if (raw == null || String(raw).trim() === '') continue;
        const n = Number(String(raw).replace(/[$,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0) continue;
        const target = data.allocation.find((r) => r && String(r.id) === row.id);
        if (target) { target.currentBalance = Math.round(n * 100) / 100; written.push(row.id); }
    }
    return written;
}

export const splitStep = {
    id: 'split', order: STEP_ORDER.split, title: t('c.setup.split.title'), nextLabel: t('c.setup.split.next'),
    render(ctx) {
        const m = splitModel(ctx.data, ctx.today);
        if (m.netCents <= 0) return `<p class="su-lead">${esc(t('c.setup.split.noPay'))}</p>`;
        const rows = m.rows.map((r) => `<li class="b-${esc(r.role || 'x')}"><span class="su-li-main"><b>${esc(r.name)}</b>${r.guide != null ? `<span class="su-li-sub">${esc(t('e.setup.guide', { pct: r.guide }))}</span>` : ''}</span>
            <span class="su-li-r"><b class="su-money">${esc(money(r.perPayCents))}</b><span class="su-li-sub">${esc(Math.round(r.pct * 10) / 10)}%</span></span></li>`).join('');
        const typed = (ctx.state && ctx.state.balances) || {};
        const bal = balanceRows(ctx.data).map((r) => {
            const v = typed[r.id] != null ? typed[r.id] : (r.saved > 0 ? String(r.saved) : '');
            return `<label class="su-bal"><span>${esc(r.name)}</span><input type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"
                value="${escNum(v)}" data-su-change="balance" data-id="${esc(r.id)}" data-su-focus="bal-${esc(r.id)}"></label>`;
        }).join('');
        return `<p class="su-lead">${esc(t('c.setup.split.lead', { pay: money(m.netCents) }))}</p>
            <dl class="su-kv"><div><dt>${esc(t('c.setup.split.essentials'))}</dt><dd class="su-money">${esc(money(m.essentialCents))}</dd></div>
            <div><dt>${esc(t('c.setup.split.non'))}</dt><dd class="su-money">${esc(money(m.nonEssentialCents))}</dd></div>
            <div><dt>${esc(t('e.setup.afterExpenses'))}</dt><dd class="su-money">${esc(money(m.leftAfterExpensesCents))}</dd></div></dl>
            <ul class="su-list su-buckets">${rows}</ul>
            <div class="su-total"><span>${esc(t('c.setup.split.left'))}</span><b class="su-money">${esc(money(m.leftCents))}</b></div>
            <p class="su-fine">${esc(t(m.suggested ? 'c.setup.split.noteSuggested' : 'c.setup.split.noteSaved'))}</p>
            ${bal ? `<h2 class="su-q">${esc(t('e.setup.balances.title'))}</h2><p class="su-fine">${esc(t('e.setup.balances.lead'))}</p><div class="su-bals">${bal}</div>` : ''}`;
    },
    actions: {
        balance(ctx, el) {
            if (!ctx.state) return;
            if (!ctx.state.balances) ctx.state.balances = {};
            ctx.state.balances[el.dataset.id] = el.value;
        },
    },
    onNext(ctx) {
        let changed = false;
        // Only an untouched template takes the suggestion; a split the person changed is kept as it is.
        if (onTemplateSplit(ctx.data) && netPerPayCents(ctx.data) > 0) {
            if (applySuggestedSplit(ctx.data).ok) changed = true;
        }
        if (applyStartingBalances(ctx.data, ctx.state && ctx.state.balances).length) changed = true;
        if (ctx.state) ctx.state.balances = {};
        if (changed) ctx.save();
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
        autoCredit: !!(sm.autoCredit && sm.autoCredit.on),
        hasModel: !!sm.autoCredit,
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
        const auto = m.hasModel ? `<label class="su-check su-auto"><input type="checkbox" data-su-change="auto" data-su-focus="auto"${m.autoCredit ? ' checked' : ''}>
            <span class="su-li-main"><b>${esc(t('e.setup.auto.label'))}</b><span class="su-li-sub">${esc(t('e.setup.auto.why'))}</span></span></label>` : '';
        return `<p class="su-lead">${esc(t('c.setup.transfers.lead'))}</p>
            <ul class="su-list">${items}</ul>
            ${m.stay ? `<p class="su-fine">${esc(t('c.setup.transfers.stay', { name: m.stay.name, amount: money(m.stay.perPayCents) }))}</p>` : ''}
            <p class="su-fine" aria-live="polite">${esc(t('c.setup.transfers.count', { done, total: m.transfers.length }))}</p>
            ${auto}`;
    },
    actions: {
        tick(ctx, el) {
            const res = tickTransfer(ctx.data, el.dataset.id);
            if (res.ok) ctx.save();
            ctx.refresh();
        },
        auto(ctx, el) {
            const res = setAutoCredit(ctx.data, !!el.checked);
            if (res.ok) ctx.save();
            ctx.refresh();
        },
    },
};

export function registerBucketSteps() {
    registerSetupStep(modelStep);
    registerSetupStep(splitStep);
    registerSetupStep(transfersStep);
}
