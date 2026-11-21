// Make this real (owner: F8b, FT-R-95). The bar under the Answer, the button in the Compare step bar, and the apply
// flow over F1's `makeRealPlan` and `applyMakeReal`. Changes active today apply together; each future-dated change is
// applied on its own, with an Apply button. Pay and loan changes open the normal sheet pre-filled. Every direct apply
// returns F1's one combined undo payload and shows an Undo toast. There is no clock and no timer: nothing is scheduled.

import { t, plural } from '../../i18n/strings.js';
import { store } from '../../state/store.js';
import { makeRealPlan, applyOp } from '../../calc/scenario.js';
import { applyMakeReal, stepProblem, problemText, isStepMadeReal, withMadeReal, pickRealFields } from '../../state/scenarios.js';
import { newIncomeSourceRow } from '../plan-assets-debts.js';
import { describeChange } from './change-list.js';

export const SHEET_ROUTES = ['income', 'debt', 'asset'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** True when the step was already made real (the marks live on the scenario, so they survive a reload). */
export const isDone = (ctx, step) => isStepMadeReal(ctx.scenario, step);

/** Record (stamp) or clear (stamp null) the made-real marks of steps, on the scenario and in storage. */
async function setMarks(ctx, steps, stamp) {
    const ids = steps.flatMap((s) => s.changes.map((c) => c.id));
    const { updateOpenScenario } = await import('./index.js');
    const next = await updateOpenScenario((sc) => withMadeReal(sc, ids, stamp));
    ctx.scenario = next || withMadeReal(ctx.scenario, ids, stamp);
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
        // a draft built from the allowed keys only, with a fresh id; it is not in the data until its sheet is saved
        const row = newIncomeSourceRow(list, pickRealFields('incomeAdd', c.value));
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

async function undoToast(message, steps, ctx, undo) {
    const { showUndoToast } = await import('../toast.js');
    showUndoToast({
        message,
        onUndo() {
            undo();
            setMarks(ctx, steps, null).then(() => afterChange());   // an undone change is not "made real" any more
        },
    });
}

async function refused(code) {
    const { showToast } = await import('../toast.js');
    showToast(t('f.res.mr.cantApply', { reason: problemText(code) }), 'error');
}

async function applyDirect(ctx, steps) {
    const { showToast } = await import('../toast.js');
    const res = applyMakeReal(ctx.data, steps);
    const done = steps.filter((s) => res.applied.includes(s.id));
    if (res.failed.length === 1) await refused(res.failed[0].code);
    else if (res.failed.length) showToast(plural(res.failed.length, 'f.res.mr.failed.one', 'f.res.mr.failed'), 'error');
    if (done.length) {
        await setMarks(ctx, done, new Date().toISOString());
        await afterChange();
        await undoToast(res.message, done, ctx, res.onUndo);
    }
    return res;
}

async function openIncomeStep(ctx, step) {
    const { openIncomeSheet } = await import('../income-layout.js');
    const { showToast } = await import('../toast.js');
    const data = ctx.data;
    const bad = stepProblem(data, step);
    if (bad) { await refused(bad); return false; }
    const plan = incomeStepPlan(data, step);
    if (plan.index < 0) { showToast(t('f.res.mr.failed.one', { count: 1 }), 'error'); return false; }
    const before = JSON.parse(JSON.stringify(data.incomeSources || []));
    let opened = false;
    try {
        // a new source is a draft in memory: it joins the real data only when its sheet is saved
        opened = openIncomeSheet(plan.index, {
            prefill: plan.prefill,
            draft: plan.add || undefined,
            async onSaved() {
                await setMarks(ctx, [step], new Date().toISOString());
                afterChange();
                undoToast(t('f.res.mr.done'), [step], ctx, () => { data.incomeSources.splice(0, data.incomeSources.length, ...before); });
            },
        }) !== false;
    } catch (err) {
        console.error('income sheet failed', err);
    }
    if (!opened) showToast(t('f.res.mr.failed.one', { count: 1 }), 'error');
    return opened;
}

async function openDebtStep(ctx, step, carry = null) {
    const bad = stepProblem(ctx.data, step);
    if (bad) { await refused(bad); return; }
    const [{ openSheet }, { debtAssetSheetSpec, saveDebtAsset }] = await Promise.all([import('../sheet.js'), import('../plan-lists.js')]);
    const row = pickRealFields('debtAdd', step.changes[0].value);
    const spec = debtAssetSheetSpec('debt', null, { today: ctx.today, carry });
    const values = carry ? spec.values : debtStepValues(spec, row);
    const handle = openSheet({
        title: spec.title, fields: spec.fields, values, validate: spec.validate, plausibility: spec.plausibility,
        onSave(v) {
            const res = saveDebtAsset(ctx.data, 'debt', null, v);
            if (!res.ok) return false;
            setMarks(ctx, [step], new Date().toISOString()).then(() => afterChange());
            undoToast(res.message, [step], ctx, res.onUndo);
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

/** Apply one step: pay and loan changes open the normal sheet pre-filled; the rest go through the owners' APIs. A step already made real asks first (G6W15-5). */
export async function applyStep(ctx, step) {
    if (isDone(ctx, step)) {
        const { confirmDialog } = await import('../confirm.js');
        const again = await confirmDialog({ title: t('f.res.mr.again.title'), body: t('f.res.mr.again.body'), confirmLabel: t('f.res.mr.again.confirm'), danger: true });
        if (!again) return null;
    }
    if (step.route === 'income') return openIncomeStep(ctx, step);
    if (step.route === 'debt') return openDebtStep(ctx, step);
    return applyDirect(ctx, [step]);
}

/** Apply every step active today that goes straight through an owner; sheet steps stay listed, and steps already made real are left alone. */
export async function applyAllNow(ctx, steps) {
    return applyDirect(ctx, steps.filter((s) => !isSheetStep(s) && !isDone(ctx, s)));
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

function stepRow(ctx, step) {
    const li = el('li', 'mr-step');
    const d = describeChange(ctx.data, step.changes[0]);
    const bad = stepProblem(ctx.data, step);
    const done = isDone(ctx, step);
    const what = el('span', 'mr-what');
    what.append(el('b', '', d.kindLabel));
    if (bad) what.append(el('span', 'mr-refused', t('f.res.mr.cantApply', { reason: problemText(bad) })));
    else what.append(el('span', '', stepText(ctx.data, step)), el('span', 'muted', t('f.res.mr.from', { date: d.from })));
    if (done && !bad) what.append(el('span', 'muted mr-done', t('f.res.mr.applied')));
    const b = el('button', 'btn sm', done ? t('f.res.mr.applyAgain') : t(isSheetStep(step) ? 'f.res.mr.review' : 'f.res.mr.apply'));
    b.type = 'button';
    b.dataset.mrStep = step.id;
    b.disabled = !!bad;
    li.append(what, b);
    return li;
}

function panelEl(ctx, plan) {
    const panel = el('div', 'mr-panel');
    const steps = actionableSteps(plan);
    const byId = new Map([...steps.now, ...steps.later].map((s) => [s.id, s]));
    const paint = () => {
        panel.textContent = '';
        const notes = [];
        if (plan.droppedUntil.length) notes.push(t('f.res.mr.until'));
        if (plan.missing.length) notes.push(plural(plan.missing.length, 'f.res.mr.missing.one', 'f.res.mr.missing'));
        if (plan.conflicts.length) notes.push(plural(plan.conflicts.length, 'f.res.mr.conflicts.one', 'f.res.mr.conflicts'));
        const virtual = plan.now.length + plan.later.length - steps.now.length - steps.later.length;
        if (virtual) notes.push(plural(virtual, 'f.res.mr.virtual.one', 'f.res.mr.virtual'));
        if (steps.now.length) {
            const head = el('div', 'mr-head');
            head.append(el('h3', '', t('f.res.mr.nowTitle')));
            const open = steps.now.filter((s) => !isSheetStep(s) && !isDone(ctx, s) && !stepProblem(ctx.data, s));
            if (open.length) {
                const all = el('button', 'btn btn-primary sm', t('f.res.mr.applyAll', { count: open.length }));
                all.type = 'button';
                all.dataset.mrAll = '1';
                head.appendChild(all);
            }
            const ul = el('ul', 'mr-list');
            for (const s of steps.now) ul.appendChild(stepRow(ctx, s));
            panel.append(head, ul);
        }
        if (steps.later.length) {
            panel.append(el('h3', '', t('f.res.mr.laterTitle')), el('p', 'muted', t('f.res.mr.laterNote')));
            const ul = el('ul', 'mr-list');
            for (const s of steps.later) ul.appendChild(stepRow(ctx, s));
            panel.appendChild(ul);
        }
        for (const n of notes) panel.appendChild(el('p', 'fine', n));
    };
    paint();
    panel.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b || !panel.contains(b)) return;
        if (b.dataset.mrAll) {
            await applyAllNow(ctx, steps.now.filter((s) => !stepProblem(ctx.data, s)));
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
