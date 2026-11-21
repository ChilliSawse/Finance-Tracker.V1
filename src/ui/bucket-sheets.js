// Bucket sheets (owner: E7, plan section 6 and FT-R-70, FT-R-78). Every sheet is a D1 openSheet.
// Pure builders (the *Spec, *Plan and goalReadout functions) hold the rules and are tested in Node;
// the DOM glue is openBucketSheet(kind, id). Writes go through the E5 state API and come back as an
// undo payload for showUndoToast. Sheets: split, template, bucket, bucket-new, bucket-delete, goal,
// goal-new, mojo, target-pot, target-debt. Names and labels are data: D1 sets them as text, never HTML.

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import {
    getBuckets, setSplit, renameBucket, addBucket, deleteBucketWithMove, addGoal, updateGoal, removeGoal,
    forkOwnTemplate, switchBackToBase, setMojo, addMojoStep, addTarget,
} from '../state/saving-model.js';
import { BUCKET_METHOD, suggestSplit, buildTree, bucketBalanceCents, canReturnToBase } from '../calc/saving-model.js';
import { smilePlan } from '../calc/smile.js';
import { planTotals, netPerPayCents } from '../calc/plan.js';
import { nextPayDates, toIso, parseIso } from '../calc/pay-cycle.js';
import { MOJO_STARTER_CENTS } from '../calc/fire.js';
import { formatCurrency } from '../utils.js';
import { openSheet } from './sheet.js';
import { showUndoToast, showToast } from './toast.js';
import { confirmDialog } from './confirm.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clone = (v) => JSON.parse(JSON.stringify(v));
const money = (cents) => formatCurrency(num(cents) / 100);
const aud = money;
const rowOf = (data, id) => (Array.isArray(data.allocation) ? data.allocation.find((r) => r && String(r.id) === String(id)) : null) || null;
const notLinkable = (r) => r.role === 'mojo' || r.role === 'grow';
const KINDS = ['spend', 'save'];

function dayLong(iso) {
    return parseIso(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

// ---------- the category bucket field (FT-R-70), mounted by A9b ----------

/**
 * The Bucket select for the category sheet. `buckets` is getBuckets() output. Options: "Follows essential tick"
 * (value '') then every top-level spend or save bucket; Mojo and Grow are never link targets.
 * Returns a D1 field plus `value` (the category's current link, '' when it follows the tick or points at
 * a bucket that is gone). Save with `bucketIdFromField(value)` into relinkCategory.
 */
export function categoryBucketField(category, buckets) {
    const list = (Array.isArray(buckets) ? buckets : []).filter((b) => b && !b.parentId && b.kind !== 'goal'
        && KINDS.includes(b.kind) && !notLinkable(b));
    const options = [{ value: '', label: t('e.sheet.catFollows') }, ...list.map((b) => ({ value: String(b.id), label: b.name || '' }))];
    const cur = category && category.bucketId != null ? String(category.bucketId) : '';
    return {
        key: 'bucketId', label: t('e.sheet.catBucket'), type: 'select', options, hint: t('e.sheet.catHint'),
        value: options.some((o) => o.value === cur) ? cur : '',
    };
}

/** The select's value -> what relinkCategory takes ('' follows the tick = null). */
export const bucketIdFromField = (v) => (v === '' || v == null ? null : String(v));

// ---------- split sheet ----------

/**
 * Fields for Edit split: one percent per bucket that can hold a share (not Mojo or Grow), each with the
 * engine's suggestion beside it. `fixedPct` is what the left-out rows already hold.
 */
export function bucketSplitSpec(data) {
    const rows = (Array.isArray(data.allocation) ? data.allocation : []).filter((r) => r && !notLinkable(r));
    let sug = null;
    try {
        const net = Math.max(0, netPerPayCents(data));
        const pt = planTotals(data);
        if (net > 0) {
            sug = suggestSplit({
                netCents: net, essentialCents: Math.round(num(pt.essentialPerCycle) * 100),
                nonEssentialCents: Math.round(num(pt.nonEssentialPerCycle) * 100), rules: data.savingModel && data.savingModel.rules,
            });
        }
    } catch (e) { sug = null; /* no pay yet: no suggestion */ }
    const fields = rows.map((r) => {
        const f = { key: String(r.id), label: r.name || '', type: 'percent' };
        if (sug && r.role && Number.isFinite(sug[r.role])) f.hint = t('e.sheet.splitSuggested', { pct: sug[r.role] });
        return f;
    });
    const values = {};
    rows.forEach((r) => { values[String(r.id)] = num(r.percentage); });
    const fixedPct = (Array.isArray(data.allocation) ? data.allocation : []).filter((r) => r && notLinkable(r)).reduce((s, r) => s + num(r.percentage), 0);
    const smile = rows.find((r) => r.role === 'smile') || rows[0] || null;
    return { fields, values, smileKey: smile ? String(smile.id) : null, fixedPct, suggestion: sug };
}

/** Total of a sheet's values plus the rows it does not edit. */
export const splitTotal = (spec, values) => round2(spec.fields.reduce((s, f) => s + (Number(values[f.key]) || 0), 0) + spec.fixedPct);
/** Save is allowed only at 100 with nothing below 0. */
export const splitSaveOk = (spec, values) => Math.abs(splitTotal(spec, values) - 100) < 0.05
    && spec.fields.every((f) => (Number(values[f.key]) || 0) >= 0);

export function splitValidate(spec) {
    return (v) => {
        const bad = spec.fields.find((f) => (Number(v[f.key]) || 0) < 0);
        if (bad) return { [bad.key]: t('e.sheet.splitNegative') };
        const total = splitTotal(spec, v);
        return Math.abs(total - 100) < 0.05 ? {} : { [spec.fields[0].key]: t('e.sheet.splitTotal', { total }) };
    };
}

export function splitPlausibility(spec) {
    return (v) => {
        const total = splitTotal(spec, v);
        if (Math.abs(total - 100) < 0.005 || !spec.smileKey) return [];
        const fixed = round2((Number(v[spec.smileKey]) || 0) + (100 - total));
        const note = { field: spec.smileKey, message: t('e.sheet.splitTotal', { total }) };
        if (fixed >= 0) note.fix = { label: t('d.plaus.fixSmile'), apply: () => ({ [spec.smileKey]: fixed }) };
        return [note];
    };
}

// ---------- goal sheet: the live calculator readout ----------

/**
 * One line for the goal sheet, from smilePlan. Input: {costCents, savedCents, due, perPayCents (the parent's
 * per-pay amount), sharePct, payDates, today}. Returns {status, text} or null when there is no cost yet.
 */
export function goalReadout({ costCents, savedCents, due = null, perPayCents, sharePct = 100, payDates = [], today = null } = {}) {
    if (!(num(costCents) > 0)) return null;
    const plan = smilePlan({ costCents, savedCents, due, smilePerPayCents: perPayCents, sharePct, payDates, today });
    const need = plan.perPayNeededCents == null ? '' : money(plan.perPayNeededCents);
    const dueText = due ? dayLong(due) : '';
    const dateText = plan.readyOn ? dayLong(plan.readyOn) : '';
    let key;
    let p = {};
    switch (plan.status) {
        case 'done': key = 'e.sheet.roDone'; break;
        case 'impossible': key = 'e.sheet.roImpossible'; p = { due: dueText }; break;
        case 'on-track':
            key = plan.readyOn ? 'e.sheet.roOnTrack' : 'e.sheet.roOnTrackNoDate'; p = { date: dateText, due: dueText, need }; break;
        case 'late':
            key = plan.readyOn ? 'e.sheet.roLate' : 'e.sheet.roLateNoDate';
            p = { date: dateText, due: dueText, need, days: plan.lateDays == null ? 0 : plan.lateDays, pct: plan.sharePctNeeded == null ? '' : plan.sharePctNeeded };
            break;
        default:
            if (plan.readyOn) { key = 'e.sheet.roReady'; p = { perPay: money(plan.perPayCents), date: dateText }; } else key = plan.perPayCents > 0 ? 'e.sheet.roAddDate' : 'e.sheet.roNoMoney';
    }
    return { status: plan.status, text: t(key, p), plan };
}

function payDatesFor(data, today) {
    const s = Array.isArray(data.incomeSources) ? data.incomeSources : [];
    const source = s[data.primaryIncomeIndex || 0] || s[0] || null;
    try { return source ? nextPayDates(source, today, 80) : []; } catch (e) { return []; /* month mode: no list */ }
}

/** What a goal sheet needs from the data: the parent's per-pay amount, pay dates, the default share. */
export function goalContext(data, today, goalId, parentId) {
    const all = getBuckets(data, today);
    const goal = goalId ? (data.bucketGoals || []).find((g) => g && String(g.id) === String(goalId)) : null;
    const pid = goal ? goal.parentId : parentId;
    const parent = all.find((b) => String(b.id) === String(pid)) || null;
    const sibs = (data.bucketGoals || []).filter((g) => g && String(g.parentId) === String(pid)).length;
    return {
        goal, parentId: pid == null ? null : String(pid), parentPerPayCents: parent ? parent.perPayCents : 0,
        payDates: payDatesFor(data, today), newShare: sibs ? Math.round((1000 / (sibs + 1))) / 10 : 100, hasShare: !!goal && sibs > 1,
    };
}

export function goalSheetSpec(data, today, goalId, parentId) {
    const ctx = goalContext(data, today, goalId, parentId);
    const g = ctx.goal;
    const fields = [
        { key: 'name', label: t('e.plan.goalName'), type: 'text', required: true },
        { key: 'cost', label: t('e.plan.goalCost'), type: 'money' },
        { key: 'saved', label: t('e.plan.goalSavedLabel'), type: 'money' },
        { key: 'due', label: t('e.plan.goalDue'), type: 'date' },
    ];
    if (g) fields.push({ key: 'share', label: t('e.sheet.goalShare'), type: 'percent' });
    const values = g ? { name: g.name, cost: g.cost, saved: g.saved, due: g.due || null, share: g.share } : { name: '', cost: null, saved: 0, due: null };
    const plausibility = (v) => {
        const share = g ? (typeof v.share === 'number' ? v.share : num(g.share)) : ctx.newShare;
        const r = goalReadout({
            costCents: Math.round(num(v.cost) * 100), savedCents: Math.round(num(v.saved) * 100), due: v.due || null,
            perPayCents: ctx.parentPerPayCents, sharePct: share, payDates: ctx.payDates, today,
        });
        return r ? [{ field: 'due', message: r.text }] : [];
    };
    return { fields, values, plausibility, ctx };
}

// ---------- bucket sheet: edit, tax pot, delete ----------

/**
 * Move the tax-pot tag to a bucket (or clear it). When another bucket already holds it this asks
 * ({ok:false, code:'holds', holder, holderId}) and writes nothing; pass {move:true} to move it.
 */
export function setTaxPot(data, id, on, opts = {}) {
    const row = rowOf(data, id);
    if (!row) return { ok: false, code: 'missing', message: '', onUndo() {} };
    const alloc = data.allocation;
    const holder = alloc.find((r) => r && r !== row && r.isTaxProvision);
    if (on && holder && !opts.move) return { ok: false, code: 'holds', holder: holder.name, holderId: holder.id, message: '', onUndo() {} };
    if (!!row.isTaxProvision === !!on && !(on && holder)) return { ok: true, noop: true, message: '', onUndo() {} };
    const before = clone(alloc);
    alloc.forEach((r) => { if (r) r.isTaxProvision = on ? r === row : (r === row ? false : !!r.isTaxProvision); });
    const message = !on ? t('e.sheet.taxCleared', { name: row.name })
        : holder ? t('e.sheet.taxMoved', { from: holder.name, to: row.name }) : t('e.sheet.taxSet', { name: row.name });
    let used = false;
    return {
        ok: true, message,
        onUndo() { if (used) return; used = true; alloc.length = 0; alloc.push(...clone(before)); },
    };
}

export function bucketSheetSpec(data, id) {
    const row = rowOf(data, id);
    if (!row) return null;
    const core = ['daily', 'splurge', 'smile', 'fire', 'mojo'].includes(row.role);
    const fields = [
        { key: 'name', label: t('e.sheet.bucketName'), type: 'text', required: true },
        { key: 'bankLabel', label: t('e.sheet.bucketBank'), type: 'text', hint: t('e.sheet.bucketBankHint') },
    ];
    if (!core) fields.push({ key: 'kind', label: t('e.sheet.bucketKind'), type: 'select', options: [{ value: 'spend', label: t('e.sheet.kindSpend') }, { value: 'save', label: t('e.sheet.kindSave') }] });
    fields.push({ key: 'tax', label: t('e.sheet.bucketTax'), type: 'toggle', hint: t('e.sheet.bucketTaxHint') });
    return {
        row, fields, canDelete: data.allocation.length > 1,
        values: { name: row.name || '', bankLabel: row.bankLabel || '', kind: row.kind === 'spend' ? 'spend' : 'save', tax: !!row.isTaxProvision },
    };
}

/**
 * Apply a bucket sheet's values: rename (E5), bank note, spend or save pot, tax-pot tag. If the tag is held
 * by another bucket and `move` is not set, nothing is written and {code:'holds'} comes back to ask.
 */
export function applyBucketEdit(data, id, v, opts = {}) {
    const row = rowOf(data, id);
    if (!row) return { ok: false, code: 'missing', message: '', onUndo() {} };
    const name = typeof v.name === 'string' ? v.name.trim() : row.name;
    if (!name) return { ok: false, code: 'name', message: '', onUndo() {} };
    const wantsTax = v.tax !== undefined ? !!v.tax : !!row.isTaxProvision;
    if (wantsTax && !row.isTaxProvision && !opts.move) {
        const ask = setTaxPot(data, id, true, {});
        if (ask.code === 'holds') return ask;
    }
    const before = clone(data.allocation);
    if (name !== row.name) {
        const r = renameBucket(data, id, name);
        if (!r.ok) return r;
    }
    if (typeof v.bankLabel === 'string') row.bankLabel = v.bankLabel.trim();
    if (v.kind !== undefined && KINDS.includes(v.kind) && !['daily', 'splurge', 'smile', 'fire', 'mojo'].includes(row.role)) row.kind = v.kind;
    let message = t('e.sheet.bucketSaved', { name });
    if (wantsTax !== !!row.isTaxProvision) {
        const r = setTaxPot(data, id, wantsTax, { move: true });
        if (r.ok && r.message) message = r.message;
    }
    let used = false;
    return {
        ok: true, message, item: row,
        onUndo() { if (used) return; used = true; data.allocation.length = 0; data.allocation.push(...clone(before)); },
    };
}

/** What deleting a bucket needs: where its money goes. `ask` is true when money, a share or the tax tag is on it. */
export function deletePlan(data, id) {
    const row = rowOf(data, id);
    if (!row) return null;
    const tree = buildTree(data.allocation, data.bucketGoals || [], (data.savingModel && data.savingModel.rules) || BUCKET_METHOD.rules);
    const moveCents = bucketBalanceCents(String(row.id), tree);
    const pct = num(row.percentage);
    const tagged = !!row.isTaxProvision;
    const options = data.allocation.filter((r) => r && r !== row && !notLinkable(r)).map((r) => ({ value: String(r.id), label: r.name || '' }));
    return { name: row.name || '', moveCents, pct, tagged, ask: moveCents > 0 || pct > 0 || tagged, options };
}

/** Delete with the money (and the tax tag) moved to `toId`; one undo puts everything back. */
export function deleteBucketMoving(data, id, toId, opts = {}) {
    const plan = deletePlan(data, id);
    if (!plan) return { ok: false, code: 'missing', message: '', onUndo() {} };
    const res = deleteBucketWithMove(data, id, plan.ask ? toId : null, opts);
    if (res.ok && plan.tagged && toId != null) {
        const dest = rowOf(data, toId);
        if (dest) dest.isTaxProvision = true; // undo restores the saved copy of every row, tag included
    }
    return res;
}

// ---------- the glue ----------

const todayIso = () => toIso(new Date());

function refresh() {
    import('./render.js').then((r) => { try { r.updateDataAndUI(); } catch (e) { /* the page keeps its own copy */ } }).catch(() => {});
    try { document.dispatchEvent(new CustomEvent('ledger:buckets-changed')); } catch (e) { /* no document in Node */ }
}

/** Show an E5 payload: undo toast on success, a quiet toast on failure. Returns false to keep a sheet open. */
function finish(res, failMessage) {
    if (!res) return false;
    if (res.ok) {
        if (res.message) showUndoToast({ message: res.message, onUndo: () => { res.onUndo(); refresh(); }, onExpire: res.onExpire });
        refresh();
        return true;
    }
    showToast(res.message || failMessage || t('e.sheet.failed'));
    return false;
}

/** Run a write; when it offers the fork ("Make this your own template?") ask, then run it again with fork. */
async function withFork(run) {
    let res = run({});
    if (res && res.needsFork) {
        const yes = await confirmDialog({ title: res.message, confirmLabel: t('e.sheet.tplSave') });
        if (!yes) return null;
        res = run({ fork: true });
    }
    return res;
}

/** Disable Save unless `ok(values)`; stays in step with typing and the one-tap fix. */
function gateSave(handle, ok) {
    const btn = handle.layer.querySelector('[data-sheet-action="save"]');
    if (!btn) return;
    const sync = () => { btn.disabled = !ok(handle.getValues()); };
    ['input', 'change', 'click'].forEach((ev) => handle.layer.addEventListener(ev, () => setTimeout(sync, 0)));
    sync();
}

function openSplit(d) {
    const spec = bucketSplitSpec(d);
    if (!spec.fields.length) return false;
    const h = openSheet({
        title: t('e.sheet.splitTitle'), fields: spec.fields, values: spec.values, saveLabel: t('e.sheet.splitSave'),
        validate: splitValidate(spec), plausibility: splitPlausibility(spec),
        onSave: (v) => finish(setSplit(d, Object.fromEntries(spec.fields.map((f) => [f.key, Number(v[f.key]) || 0]))), t('e.sheet.splitFailed')),
    });
    gateSave(h, (v) => splitSaveOk(spec, v));
    return true;
}

async function openTemplate(d) {
    const sm = d.savingModel;
    if (!sm) return;
    const custom = typeof sm.id === 'string' && sm.id.startsWith('custom-');
    const baseName = BUCKET_METHOD.name;
    if (custom) {
        if (!canReturnToBase(sm, d.allocation, d.bucketGoals)) { showToast(t('e.plan.tplStays', { name: baseName })); return; }
        if (await confirmDialog({ title: t('e.plan.tplBackAsk', { name: baseName }), confirmLabel: t('e.plan.switchBack') })) finish(switchBackToBase(d));
        return;
    }
    openSheet({
        title: t('e.sheet.tplTitle'), saveLabel: t('e.sheet.tplSave'),
        fields: [{ key: 'name', label: t('e.sheet.tplName'), type: 'text', required: true, hint: t('e.sheet.tplHint') }],
        values: { name: t('e.sheet.tplNameDefault') },
        onSave: (v) => finish(forkOwnTemplate(d, { name: v.name })),
    });
}

function openBucket(d, id) {
    const spec = bucketSheetSpec(d, id);
    if (!spec) return false;
    const save = async (v) => {
        let res = applyBucketEdit(d, id, v);
        if (res.code === 'holds') {
            const yes = await confirmDialog({ title: t('e.sheet.taxAsk', { from: res.holder, to: v.name || spec.row.name }), confirmLabel: t('e.sheet.taxMove') });
            if (!yes) return false;
            res = applyBucketEdit(d, id, v, { move: true });
        }
        return finish(res);
    };
    openSheet({
        title: t('e.sheet.bucketTitle'), fields: spec.fields, values: spec.values, onSave: save,
        onDelete: spec.canDelete ? () => openBucketSheet('bucket-delete', id) : undefined,
    });
    return true;
}

function openBucketNew(d) {
    openSheet({
        title: t('e.sheet.bucketNew'), saveLabel: t('e.plan.bucketSave'),
        fields: [
            { key: 'name', label: t('e.sheet.bucketName'), type: 'text', required: true },
            { key: 'kind', label: t('e.sheet.bucketKind'), type: 'select', options: [{ value: 'spend', label: t('e.sheet.kindSpend') }, { value: 'save', label: t('e.sheet.kindSave') }] },
            { key: 'bankLabel', label: t('e.sheet.bucketBank'), type: 'text', hint: t('e.sheet.bucketBankHint') },
        ],
        values: { name: '', kind: 'save', bankLabel: '' },
        onSave: async (v) => finish(await withFork((o) => addBucket(d, { name: v.name, kind: v.kind, bankLabel: v.bankLabel }, o))),
    });
    return true;
}

async function openDelete(d, id) {
    const plan = deletePlan(d, id);
    if (!plan) return;
    const today = todayIso();
    if (!plan.ask) {
        if (await confirmDialog({ title: t('e.sheet.deleteAsk', { name: plan.name }), confirmLabel: t('e.sheet.deleteConfirm'), danger: true })) {
            finish(await withFork((o) => deleteBucketMoving(d, id, null, { ...o, today })));
        }
        return;
    }
    openSheet({
        title: t('e.sheet.deleteTitle', { name: plan.name }), saveLabel: t('e.sheet.deleteMove'),
        fields: [{
            key: 'to', type: 'select', required: true, hint: plan.tagged ? t('e.sheet.deleteTagHint') : undefined,
            label: plan.moveCents > 0 ? t('e.bucket.moveNeeded', { amount: aud(plan.moveCents) }) : t('e.sheet.pick'),
            options: [{ value: '', label: t('e.sheet.pick') }, ...plan.options],
        }],
        values: { to: '' },
        onSave: async (v) => finish(await withFork((o) => deleteBucketMoving(d, id, v.to, { ...o, today }))),
    });
}

function openGoal(d, goalId, parentId) {
    const today = todayIso();
    const spec = goalSheetSpec(d, today, goalId, parentId);
    if (goalId && !spec.ctx.goal) return false;
    if (!goalId && spec.ctx.parentId == null) return false;
    const g = spec.ctx.goal;
    openSheet({
        title: g ? t('e.sheet.goalTitle') : t('e.sheet.goalNew'), fields: spec.fields, values: spec.values, plausibility: spec.plausibility,
        onSave: async (v) => {
            const f = { name: v.name, cost: v.cost || 0, saved: v.saved || 0, due: v.due || null };
            if (g) return finish(updateGoal(d, g.id, { ...f, ...(typeof v.share === 'number' ? { share: v.share } : {}) }));
            return finish(await withFork((o) => addGoal(d, spec.ctx.parentId, f, o)));
        },
        onDelete: g ? () => finish(removeGoal(d, g.id)) : undefined,
    });
    return true;
}

function openMojo(d) {
    const mj = (d.savingModel && d.savingModel.mojo) || {};
    openSheet({
        title: t('e.sheet.mojoTitle'),
        fields: [
            { key: 'starter', label: t('e.plan.mojoStarterLabel'), type: 'money', unit: 'cents' },
            { key: 'months', label: t('e.plan.mojoMonthsLabel'), type: 'number' },
            { key: 'basis', label: t('e.sheet.mojoBasis'), type: 'select', options: [
                { value: 'auto', label: t('e.sheet.basisAuto') }, { value: 'planned', label: t('e.sheet.basisPlanned') }, { value: 'actual', label: t('e.sheet.basisActual') }] },
            { key: 'step', label: t('e.sheet.mojoStep'), type: 'money', unit: 'cents' },
        ],
        values: { starter: mj.starter == null ? MOJO_STARTER_CENTS : mj.starter, months: mj.months == null ? 3 : mj.months, basis: mj.basis || 'auto', step: null },
        onSave: (v) => {
            const res = setMojo(d, { starter: v.starter == null ? 0 : v.starter, months: v.months == null ? 0 : v.months, basis: v.basis });
            if (!res.ok) return finish(res);
            if (v.step) {
                const st = addMojoStep(d, v.step);
                if (st.ok) { const first = res.onUndo; res.onUndo = () => { st.onUndo(); first(); }; }
            }
            return finish(res);
        },
    });
    return true;
}

function openTarget(d, kind) {
    if (kind === 'target-debt') {
        const used = new Set(((d.savingModel && d.savingModel.fire && d.savingModel.fire.targets) || []).filter((x) => x && x.type === 'debt').map((x) => String(x.liabilityId)));
        const opts = (Array.isArray(d.liabilities) ? d.liabilities : []).filter((l) => l && l.id != null && !used.has(String(l.id)) && num(l.balance) > 0)
            .map((l) => ({ value: String(l.id), label: l.name || '' }));
        if (!opts.length) return false;
        openSheet({
            title: t('e.plan.addDebtTitle'), fields: [{ key: 'liabilityId', label: t('e.plan.addDebtPick'), type: 'select', options: opts, required: true }],
            values: { liabilityId: opts[0].value }, onSave: (v) => finish(addTarget(d, { type: 'debt', liabilityId: v.liabilityId })),
        });
        return true;
    }
    openSheet({
        title: t('e.sheet.targetTitle'),
        fields: [{ key: 'label', label: t('e.plan.addTargetLabel'), type: 'text', required: true }, { key: 'goalCents', label: t('e.plan.addTargetGoal'), type: 'money', unit: 'cents' }],
        values: { label: '', goalCents: null },
        onSave: (v) => finish(addTarget(d, { type: 'saver', label: v.label, goalCents: v.goalCents || 0 })),
    });
    return true;
}

/**
 * Open a bucket sheet. kind: split | template | bucket (id) | bucket-new | bucket-delete (id) | goal (id)
 * | goal-new (id = the parent bucket or goal, Smile when null) | mojo | target-pot | target-debt.
 * @returns {boolean} true once a sheet (or its confirm) is on its way; false when the kind or id is not known.
 */
export function openBucketSheet(kind, id) {
    const d = store.financeData;
    if (!d || typeof document === 'undefined') return false;
    switch (kind) {
        case 'split': return openSplit(d);
        case 'template': openTemplate(d); return true;
        case 'bucket': return openBucket(d, id);
        case 'bucket-new': return openBucketNew(d);
        case 'bucket-delete': if (!rowOf(d, id)) return false; openDelete(d, id); return true;
        case 'goal': return id ? openGoal(d, id, null) : false;
        case 'goal-new': {
            const smile = (d.allocation || []).find((r) => r && r.role === 'smile');
            return openGoal(d, null, id || (smile && smile.id) || null);
        }
        case 'mojo': return openMojo(d);
        case 'target-pot': case 'target-debt': return openTarget(d, kind);
        default: return false;
    }
}
