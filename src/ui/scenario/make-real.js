// Make this real (owner: F8b, FT-R-95). The bar under the Answer, the button in the Compare step bar, and the apply
// flow over F1's `makeRealPlan` and `applyMakeReal`. Changes active today apply together; each future-dated change is
// applied on its own, with an Apply button. Pay and loan changes open the normal sheet pre-filled. Every direct apply
// returns F1's one combined undo payload and shows an Undo toast. There is no clock and no timer: nothing is scheduled.

import { t } from '../../i18n/strings.js';
import { store } from '../../state/store.js';
import { makeRealPlan, applyOp } from '../../calc/scenario.js';
import { applyMakeReal } from '../../state/scenarios.js';
import { newIncomeSourceId } from '../../state/asset-debt-migration.js';
import { describeChange } from './change-list.js';

export const SHEET_ROUTES = ['income', 'debt', 'asset'];
const applied = new Map(); // scenario id -> Set of step ids made real in this visit (so a scaled change is never applied twice)

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function appliedFor(scenarioId) {
    if (!applied.has(scenarioId)) applied.set(scenarioId, new Set());
    return applied.get(scenarioId);
}

/** Steps that can be applied (a one-off or a ticked balance has no real equivalent and is left out). */
export function actionableSteps(plan) {
    return { now: plan.now.filter((s) => s.route !== 'virtual'), later: plan.later.filter((s) => s.route !== 'virtual') };
}

export const isSheetStep = (step) => SHEET_ROUTES.includes(step.route);

/** For a pay change: which source, and the sheet values to open it with. A new source comes back as `add`. */
export function incomeStepPlan(data, step) {
    const c = step.changes[0];
    const list = Array.isArray(data.incomeSources) ? data.incomeSources : [];
    if (c.kind === 'incomeAdd' && isObj(c.value)) {
        const row = JSON.parse(JSON.stringify(c.value));
        if (!row.id || list.some((s) => s && s.id === row.id)) row.id = newIncomeSourceId(list, row.name);
        return { index: list.length, prefill: {}, add: row };
    }
    const index = list.findIndex((s) => s && c.target && s.id === c.target.id);
    const prefill = {};
    if (index >= 0 && c.field === 'grossAnnual') {
        const next = applyOp(list[index].grossAnnual, c);
        const src = list[index];
        const hourly = Number(src.hourlyRate) > 0 && Number(src.hoursPerWeek) > 0; // the sheet then asks for a rate, not a year
        if (typeof next === 'number' && Number.isFinite(next)) {
            if (hourly) prefill.hourlyRate = round2(next / (Number(src.hoursPerWeek) * 52));
            else prefill.amount = round2(next);
        }
    }
    return { index, prefill, add: null };
}

/** Values for the loan sheet from a `debtAdd` change's row: only the keys the sheet asks for. */
export function debtStepValues(spec, row) {
    const values = { ...spec.values };
    if (isObj(row)) for (const f of spec.fields) if (row[f.key] !== undefined && row[f.key] !== null) values[f.key] = row[f.key];
    return values;
}

// ---------- the flow (needs a document) ----------

async function rerender() {
    const m = await import('./index.js');
    const { renderMakeRealButton } = await import('./make-real.js');
    m.registerScenarioView('make-real', renderMakeRealButton); // already registered: replaced, so it only repaints
}

async function afterChange() {
    const { updateDataAndUI } = await import('../render.js');
    updateDataAndUI();
    await rerender();
}

async function undoToast(message, ids, ctx, undo) {
    const { showUndoToast } = await import('../toast.js');
    showUndoToast({
        message,
        onUndo() {
            undo();
            for (const id of ids) appliedFor(ctx.scenario.id).delete(id);
            afterChange();
        },
    });
}

async function applyDirect(ctx, steps) {
    const { showToast } = await import('../toast.js');
    const res = applyMakeReal(ctx.data, steps);
    const ids = res.applied;
    for (const id of ids) appliedFor(ctx.scenario.id).add(id);
    if (res.failed.length) showToast(t('f.res.mr.failed', { count: res.failed.length }), 'error');
    if (ids.length) {
        await afterChange();
        await undoToast(res.message, ids, ctx, res.onUndo);
    }
    return res;
}

async function openIncomeStep(ctx, step) {
    const { openIncomeSheet } = await import('../income-layout.js');
    const { showToast } = await import('../toast.js');
    const data = ctx.data;
    const plan = incomeStepPlan(data, step);
    if (plan.index < 0) { showToast(t('f.res.mr.failed', { count: 1 }), 'error'); return false; }
    const before = JSON.parse(JSON.stringify(data.incomeSources || []));
    if (plan.add) data.incomeSources.push(plan.add);
    let saved = false;
    const opened = openIncomeSheet(plan.index, {
        prefill: plan.prefill,
        onSaved() {
            saved = true;
            appliedFor(ctx.scenario.id).add(step.id);
            afterChange();
            undoToast(t('f.res.mr.done'), [step.id], ctx, () => { data.incomeSources.splice(0, data.incomeSources.length, ...before); });
        },
    });
    if (opened === false) {
        if (plan.add) data.incomeSources.pop();
        showToast(t('f.res.mr.failed', { count: 1 }), 'error');
        return false;
    }
    if (plan.add) { // a cancelled new source must not stay in the plan
        const watch = new MutationObserver(() => {
            if (document.body.classList.contains('has-sheet')) return;
            watch.disconnect();
            if (!saved) { const i = data.incomeSources.indexOf(plan.add); if (i >= 0) data.incomeSources.splice(i, 1); }
        });
        watch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    return true;
}

async function openDebtStep(ctx, step, carry = null) {
    const [{ openSheet }, { debtAssetSheetSpec, saveDebtAsset }] = await Promise.all([import('../sheet.js'), import('../plan-lists.js')]);
    const row = step.changes[0].value;
    const spec = debtAssetSheetSpec('debt', null, { today: ctx.today, carry });
    const values = carry ? spec.values : debtStepValues(spec, row);
    const handle = openSheet({
        title: spec.title, fields: spec.fields, values, validate: spec.validate, plausibility: spec.plausibility,
        onSave(v) {
            const res = saveDebtAsset(ctx.data, 'debt', null, v);
            if (!res.ok) return false;
            appliedFor(ctx.scenario.id).add(step.id);
            afterChange();
            undoToast(res.message, [step.id], ctx, res.onUndo);
            return undefined;
        },
    });
    if (spec.reopenOn && spec.reopenOn.length) {
        handle.layer.addEventListener('change', (e) => {
            const k = e.target && e.target.dataset ? e.target.dataset.key : null;
            if (k && spec.reopenOn.includes(k)) openDebtStep(ctx, step, handle.getValues());
        });
    }
}

/** Apply one step: pay and loan changes open the normal sheet pre-filled; the rest go through the owners' APIs. */
export async function applyStep(ctx, step) {
    if (step.route === 'income') return openIncomeStep(ctx, step);
    if (step.route === 'debt') return openDebtStep(ctx, step);
    return applyDirect(ctx, [step]);
}

/** Apply every step active today that goes straight through an owner; sheet steps stay listed. */
export async function applyAllNow(ctx, steps) {
    return applyDirect(ctx, steps.filter((s) => !isSheetStep(s)));
}

// ---------- the dialog ----------

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

function stepText(data, step) {
    return step.changes.map((c) => describeChange(data, c).what).join('; ');
}

function stepRow(ctx, step, done) {
    const li = el('li', 'mr-step');
    const d = describeChange(ctx.data, step.changes[0]);
    const what = el('span', 'mr-what');
    what.append(el('b', '', d.kindLabel), el('span', '', stepText(ctx.data, step)), el('span', 'muted', t('f.res.mr.from', { date: d.from })));
    const b = el('button', 'btn sm', done ? t('f.res.mr.applied') : t(isSheetStep(step) ? 'f.res.mr.review' : 'f.res.mr.apply'));
    b.type = 'button';
    b.dataset.mrStep = step.id;
    b.disabled = !!done;
    li.append(what, b);
    return li;
}

function panelEl(ctx, plan) {
    const panel = el('div', 'mr-panel');
    const steps = actionableSteps(plan);
    const doneSet = appliedFor(ctx.scenario.id);
    const byId = new Map([...steps.now, ...steps.later].map((s) => [s.id, s]));
    const paint = () => {
        panel.textContent = '';
        const notes = [];
        if (plan.droppedUntil.length) notes.push(t('f.res.mr.until'));
        if (plan.missing.length) notes.push(t('f.res.mr.missing', { count: plan.missing.length }));
        if (plan.conflicts.length) notes.push(t('f.res.mr.conflicts', { count: plan.conflicts.length }));
        const virtual = plan.now.length + plan.later.length - steps.now.length - steps.later.length;
        if (virtual) notes.push(t('f.res.mr.virtual', { count: virtual }));
        if (steps.now.length) {
            const head = el('div', 'mr-head');
            head.append(el('h3', '', t('f.res.mr.nowTitle')));
            const open = steps.now.filter((s) => !isSheetStep(s) && !doneSet.has(s.id));
            if (open.length) {
                const all = el('button', 'btn btn-primary sm', t('f.res.mr.applyAll', { count: open.length }));
                all.type = 'button';
                all.dataset.mrAll = '1';
                head.appendChild(all);
            }
            const ul = el('ul', 'mr-list');
            for (const s of steps.now) ul.appendChild(stepRow(ctx, s, doneSet.has(s.id)));
            panel.append(head, ul);
        }
        if (steps.later.length) {
            panel.append(el('h3', '', t('f.res.mr.laterTitle')), el('p', 'muted', t('f.res.mr.laterNote')));
            const ul = el('ul', 'mr-list');
            for (const s of steps.later) ul.appendChild(stepRow(ctx, s, doneSet.has(s.id)));
            panel.appendChild(ul);
        }
        for (const n of notes) panel.appendChild(el('p', 'fine', n));
    };
    paint();
    panel.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b || !panel.contains(b)) return;
        if (b.dataset.mrAll) {
            await applyAllNow(ctx, steps.now.filter((s) => !doneSet.has(s.id)));
            paint();
        } else if (b.dataset.mrStep && byId.has(b.dataset.mrStep)) {
            await applyStep(ctx, byId.get(b.dataset.mrStep));
            paint();
        }
    });
    return panel;
}

/** The Make this real button: one actionable change goes straight to its step; more open the list. */
export async function startMakeReal(ctx) {
    const [{ showToast }, { openSheet }] = await Promise.all([import('../toast.js'), import('../sheet.js')]);
    const plan = makeRealPlan(ctx.data, ctx.scenario.changes, ctx.today);
    const steps = actionableSteps(plan);
    const all = [...steps.now, ...steps.later];
    if (!all.length) { showToast(t('f.res.mr.nothing'), 'info'); return; }
    if (all.length === 1) { await applyStep(ctx, all[0]); return; }
    openSheet({ title: t('f.res.mr.title'), readOnly: true, content: [panelEl(ctx, plan)] });
}

// ---------- the bar and the button ----------

function startButton(ctx, cls) {
    const b = el('button', cls, t('f.res.mr.button'));
    b.type = 'button';
    b.dataset.makeReal = '1';
    b.addEventListener('click', () => { startMakeReal({ ...ctx, data: store.financeData }); });
    return b;
}

/** "Happy with this?" under the Answer, with Change something (back to Adjust) and Make this real. */
export function renderMakeRealBar(container, ctx) {
    if (!ctx.scenario || !ctx.scenario.changes.length) return;
    const bar = el('div', 'make-real');
    const text = el('div');
    text.append(el('b', '', t('f.res.mr.happy')), el('span', 'muted', t('f.res.mr.bar')));
    const acts = el('div', 'mr-acts');
    const change = el('button', 'btn', t('f.wi.nav.change'));
    change.type = 'button';
    change.dataset.act = 'back-adjust'; // index.js handles this one
    acts.append(change, startButton(ctx, 'btn btn-primary'));
    bar.append(text, acts);
    container.appendChild(bar);
}

/** The button in the Compare step bar. */
export function renderMakeRealButton(slot, ctx) {
    slot.textContent = '';
    if (!ctx.scenario || !ctx.scenario.changes.length) return;
    slot.appendChild(startButton(ctx, 'btn btn-primary'));
}
