// Test cases for the "scenario-make-real-safety" group (registered in src/test-registry.js), owner S10.
// G6W15-3 (what a scenario may write into real data), G6W15-4 (a new income source is a draft until saved),
// G6W15-5 (made-real marks persist). S10.1 to S10.5 are pure; S10.6 to S10.8 need a document or IndexedDB and are
// no-ops in the Node runner. Shape: { name, fn(assert) }, assert(label, actual, expected).

import { makeRealPlan } from '../../calc/scenario.js';
import {
    applyMakeReal, sanitizeScenarioRows, sanitizeChange, saveScenario, getScenario, duplicateScenario, newScenario,
    stepProblem, isStepMadeReal, withMadeReal, REAL_FIELDS, realValueProblem,
} from '../../state/scenarios.js';
import { describeChange } from './change-list.js';
import { incomeStepPlan, actionableSteps } from './make-real.js';
import { buildSampleHousehold } from '../../state/sample-data.js';
import { migrateAssetDebtDetail } from '../../state/asset-debt-migration.js';
import { configureDb, deleteDb } from '../../state/db.js';

const TODAY = '2026-11-21';
const hasDom = typeof document !== 'undefined';
const hasIdb = typeof indexedDB !== 'undefined';
const base = () => { const d = buildSampleHousehold(TODAY).data; migrateAssetDebtDetail(d); return d; };
const ch = (o) => ({ id: 'c1', kind: 'expense', target: null, field: null, op: 'set', value: null, baseValue: null, from: null, until: null, note: '', ...o });
const fi = (o) => ch({ kind: 'assumption', target: { collection: 'fiSettings', id: null }, ...o });
const planCh = (d, o) => ch({ kind: 'expense', target: { collection: 'plan', id: d.plan[0].id }, ...o });
const goalCh = (id, o) => ch({ kind: 'goal', target: { collection: 'bucketGoals', id }, ...o });

/** Changes as they could arrive in a crafted file: shape-valid (F1's checks) but with values no sheet would accept. */
function hostile(d) {
    const g = d.bucketGoals && d.bucketGoals[0];
    return [
        fi({ id: 'h1', field: 'toString', value: 5 }),
        fi({ id: 'h2', field: 'multiple', value: -3 }),
        fi({ id: 'h3', field: 'multiple', op: 'scale', value: -3 }),
        fi({ id: 'h4', field: 'birthYears', value: 7 }),
        planCh(d, { id: 'h5', field: 'amount', value: -99999 }),
        planCh(d, { id: 'h6', field: 'frequency', value: { evil: 1 } }),
        planCh(d, { id: 'h7', field: 'frequency', value: 'sometimes' }),
        goalCh(g ? g.id : 'g', { id: 'h8', field: 'saved', value: 1e9 }),
        goalCh(g ? g.id : 'g', { id: 'h9', field: 'due', value: 'not a date' }),
    ];
}

export const SCENARIO_MAKE_REAL_SAFETY_TEST_CASES = [
    {
        name: 'S10.1 a crafted restored scenario cannot carry bad fields or values',
        fn(assert) {
            const d = base();
            const raw = { id: 'sx', name: 'crafted', changes: hostile(d) };
            const { rows } = sanitizeScenarioRows([raw]);
            assert('every bad change is dropped on restore, except an object value (refused when applied, see S10.2)', rows[0].changes.map((c) => c.id), ['h6']);
            assert('a good one next to them is kept', sanitizeChange(planCh(d, { id: 'ok', field: 'amount', value: 610 })) !== null, true);
            assert('an unknown field is not kept', sanitizeChange(planCh(d, { id: 'f', field: 'legacy', value: 1 })), null);
            assert('the table covers the kinds that are applied', Object.keys(REAL_FIELDS).sort(), ['assumption', 'debtAdd', 'expense', 'goal', 'income', 'incomeAdd', 'split']);
            assert('the F6 bounds come from the Assumptions sheet', [realValueProblem('assumption', 'multiple', 101), realValueProblem('assumption', 'multiple', 30), realValueProblem('assumption', 'inflation', 21)], ['range', null, 'range']);
        },
    },
    {
        name: 'S10.2 Make this real refuses each bad change, with a reason, and writes nothing',
        fn(assert) {
            const d = base();
            d.fiSettings = d.fiSettings || {};
            const before = JSON.stringify(d);
            const plan = makeRealPlan(d, hostile(d), TODAY);
            const steps = [...plan.now, ...plan.later];
            assert('they all reach the plan (shape is fine)', steps.length >= 8, true);
            const res = applyMakeReal(d, steps);
            assert('none applied', res.applied, []);
            assert('every one refused with a reason', res.failed.length === steps.length && res.failed.every((f) => typeof f.reason === 'string' && f.reason.length > 3 && !f.reason.includes('[object')), true);
            assert('reasons are plain words, not codes', res.failed.map((f) => f.reason).every((r) => /\s/.test(r)), true);
            assert('the data is byte for byte unchanged', JSON.stringify(d), before);
            assert('fiSettings still prints', String(d.fiSettings), '[object Object]');
            assert('stepProblem names the first problem', stepProblem(d, steps.find((s) => s.changes[0].id === 'h5')), 'range');
            const ok = applyMakeReal(d, makeRealPlan(d, [planCh(d, { id: 'fine', field: 'amount', value: 1234 })], TODAY).now);
            assert('a good change still applies', [ok.applied.length, ok.failed.length, d.plan[0].amount], [1, 0, 1234]);
        },
    },
    {
        name: 'S10.3 a new plan row copies only the allowed keys; the list shows words, never "[object"',
        fn(assert) {
            const d = base();
            const add = ch({ id: 'np', kind: 'expense', target: { collection: 'plan', id: null }, op: 'add', value: { name: 'Gym', amount: 40, frequency: 'weekly', evil: 'x', legacy: { a: 1 }, id: 'p-rent' } });
            const res = applyMakeReal(d, makeRealPlan(d, [add], TODAY).now);
            const row = d.plan[d.plan.length - 1];
            assert('applied as a new row with its own id', [res.applied.length, row.name, row.id !== 'p-rent'], [1, 'Gym', true]);
            assert('no key from the file beyond the table', ['evil' in row, row.legacy], [false, null]);
            const bad = ch({ id: 'np2', kind: 'expense', target: { collection: 'plan', id: null }, op: 'add', value: { name: 'X', amount: -5 } });
            assert('a new row with a bad amount is refused', applyMakeReal(d, makeRealPlan(d, [bad], TODAY).now).failed.length, 1);
            for (const c of hostile(d)) {
                const line = describeChange(d, c).what;
                assert(`no object text in the line for ${c.id}`, line.includes('[object'), false);
            }
        },
    },
    {
        name: 'S10.4 a new income source is a draft that is not in the data, with allowed keys only',
        fn(assert) {
            const d = base();
            const n = d.incomeSources.length;
            const before = JSON.stringify(d);
            const c = ch({ id: 'ia', kind: 'incomeAdd', target: { collection: 'incomeSources', id: null }, op: 'add', value: { name: 'Market', grossAnnual: 6000, paySchedule: 'monthly', evil: 'x', withholding: { hasStudyDebt: 'x' }, id: d.incomeSources[0].id } });
            const step = makeRealPlan(d, [c], TODAY).now[0];
            const plan = incomeStepPlan(d, step);
            assert('the row is built but nothing is in the data', [d.incomeSources.length, JSON.stringify(d)], [n, before]);
            assert('only allowed keys came from the file', [plan.add.name, plan.add.grossAnnual, plan.add.paySchedule, 'evil' in plan.add, plan.add.withholding], ['Market', 6000, 'monthly', false, undefined]);
            assert('a fresh id, never the real one', plan.add.id !== d.incomeSources[0].id, true);
            const bad = ch({ id: 'ib', kind: 'incomeAdd', target: { collection: 'incomeSources', id: null }, op: 'add', value: { name: 'M', grossAnnual: -1 } });
            assert('a bad figure in the draft is refused with a reason', stepProblem(d, makeRealPlan(d, [bad], TODAY).now[0]), 'range');
            assert('a simulated reload still has no extra source', JSON.parse(JSON.stringify(d)).incomeSources.length, n);
            assert('it counts as a sheet step', actionableSteps(makeRealPlan(d, [c], TODAY)).now.length, 1);
        },
    },
    {
        name: 'S10.5 made-real marks live on the scenario, survive the sanitizer, and are cleared by undo',
        fn(assert) {
            const d = base();
            const c = planCh(d, { id: 'sc1', field: 'amount', op: 'scale', value: 1.1 });
            const step = makeRealPlan(d, [c], TODAY).now[0];
            const sc = { id: 's1', name: 'Pay rise', changes: [c], madeReal: {} };
            assert('not made real yet', isStepMadeReal(sc, step), false);
            const marked = withMadeReal(sc, ['sc1'], '2026-11-21T01:00:00.000Z');
            assert('marked', [isStepMadeReal(marked, step), sc.madeReal], [true, {}]);
            const reloaded = sanitizeScenarioRows(JSON.parse(JSON.stringify([marked]))).rows[0];
            assert('the mark survives a reload', [isStepMadeReal(reloaded, step), reloaded.madeReal.sc1], [true, '2026-11-21T01:00:00.000Z']);
            const hostileMarks = sanitizeScenarioRows([{ ...marked, madeReal: { sc1: '2026-11-21T01:00:00.000Z', gone: '2026-11-21T01:00:00.000Z', __proto__x: 5, sc2: 'not a date' } }]).rows[0];
            assert('marks for unknown changes or bad stamps are dropped', Object.keys(hostileMarks.madeReal), ['sc1']);
            const cleared = withMadeReal(reloaded, ['sc1'], null);
            assert('undo clears the mark', [isStepMadeReal(cleared, step), Object.keys(cleared.madeReal)], [false, []]);
            assert('a new scenario starts with none', newScenario({ name: 'n' }).madeReal, {});
        },
    },
    {
        name: 'S10.6 marks persist in storage; a copy has none (browser only)',
        async fn(assert) {
            if (!hasIdb) return;
            configureDb('ledger-test-db');
            await deleteDb();
            const d = base();
            const c = planCh(d, { id: 'sc1', field: 'amount', op: 'scale', value: 1.1 });
            const step = makeRealPlan(d, [c], TODAY).now[0];
            const saved = await saveScenario(withMadeReal({ ...newScenario({ name: 'Raise' }), changes: [c] }, ['sc1'], '2026-11-21T01:00:00.000Z'));
            const back = await getScenario(saved.scenario.id);
            assert('after a reload the change reads as made real', isStepMadeReal(back, step), true);
            const copy = await duplicateScenario(saved.scenario.id);
            assert('a duplicate has not been made real', isStepMadeReal(await getScenario(copy.scenario.id), { changes: [{ id: copy.scenario.changes[0].id }] }), false);
            await saveScenario(withMadeReal(back, ['sc1'], null));
            assert('undo (cleared and saved) removes it', isStepMadeReal(await getScenario(saved.scenario.id), step), false);
            await deleteDb();
        },
    },
    {
        name: 'S10.7 applying a made-real step again asks first, and cancelling changes nothing (browser only)',
        async fn(assert) {
            if (!hasDom || typeof HTMLDialogElement === 'undefined') return;
            const { applyStep } = await import('./make-real.js');
            const d = base();
            const c = planCh(d, { id: 'sc1', field: 'amount', op: 'scale', value: 1.1 });
            const step = makeRealPlan(d, [c], TODAY).now[0];
            const was = d.plan[0].amount;
            const ctx = { scenario: withMadeReal({ id: 's1', name: 'x', changes: [c] }, ['sc1'], '2026-11-21T01:00:00.000Z'), data: d, today: TODAY };
            const run = applyStep(ctx, step);
            for (let i = 0; i < 20 && !document.querySelector('dialog.ledger-dialog'); i++) await new Promise((r) => setTimeout(r, 10));
            const dlg = document.querySelector('dialog.ledger-dialog');
            assert('a danger dialog asks first', [!!dlg, dlg && dlg.classList.contains('is-danger')], [true, true]);
            if (dlg) dlg.querySelector('[data-dialog-cancel]').click();
            await run;
            assert('cancel applies nothing', d.plan[0].amount, was);
        },
    },
    {
        name: 'S10.8 cancelling the new-income sheet leaves the data alone (browser only)',
        async fn(assert) {
            if (!hasDom) return;
            const [{ openIncomeSheet }, { store }] = await Promise.all([import('../income-layout.js'), import('../../state/store.js')]);
            const saved = store.financeData;
            const d = base();
            store.financeData = d;
            const n = d.incomeSources.length;
            const c = ch({ id: 'ia', kind: 'incomeAdd', target: { collection: 'incomeSources', id: null }, op: 'add', value: { name: 'Market', grossAnnual: 6000, paySchedule: 'monthly' } });
            const plan = incomeStepPlan(d, makeRealPlan(d, [c], TODAY).now[0]);
            try {
                assert('the sheet opens on the draft', openIncomeSheet(plan.index, { draft: plan.add, prefill: plan.prefill }), true);
                assert('while it is open the data has no new source', d.incomeSources.length, n);
                assert('a draft has no Delete button', document.querySelector('.sheet-layer [data-sheet-action="delete"]'), null);
                document.querySelector('.sheet-layer [data-sheet-action="close"]').click();
                assert('after cancel, still none, even after a simulated reload', [d.incomeSources.length, JSON.parse(JSON.stringify(d)).incomeSources.length], [n, n]);
            } finally {
                const open = document.querySelector('.sheet-layer');
                if (open) open.remove();
                document.body.classList.remove('has-sheet');
                store.financeData = saved;
            }
        },
    },
];
