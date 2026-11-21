// Test cases for the "scenario-ui" group (registered in src/test-registry.js), owner F7.
// F7.1 to F7.7 are pure (no DOM); F7.8 needs a document and is a no-op in the Node runner.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { t } from '../i18n/strings.js';
import { STARTERS, starterSpec } from './scenario/starters.js';
import { describeChange, resolveConflict, editSpecFor, groupOf, renderChangeList } from './scenario/change-list.js';
import { changeProblems, resolveAt, conflictFor } from '../calc/scenario.js';
import { buildSampleHousehold } from '../state/sample-data.js';
import { migrateAssetDebtDetail } from '../state/asset-debt-migration.js';

const TODAY = '2026-11-21';
const base = () => { const d = buildSampleHousehold(TODAY).data; migrateAssetDebtDetail(d); return d; };
const hasDom = typeof document !== 'undefined';
const bucket = (d, role) => d.allocation.find((r) => r.role === role);

/** Run a spec's own validation, then build. Returns {errors, changes}. */
function run(spec, patch) {
    const v = { ...spec.values, ...patch };
    const errors = spec.validate(v);
    return { errors, changes: Object.keys(errors).length ? [] : spec.build(v) };
}

export const SCENARIO_UI_TEST_CASES = [
    {
        name: 'F7.1 starters',
        fn(assert) {
            assert('eight starters in order', STARTERS.map((s) => t(s.titleKey)), [
                'My pay changes', 'A new job', 'Extra income', 'My expenses change',
                'A new goal or bucket', 'Several goals by dates', 'A loan', 'Change my split',
            ]);
            assert('ids are unique', new Set(STARTERS.map((s) => s.id)).size, 8);
            assert('one line says the others come later', t('f.wi.ask.later'), 'The other starters come later.');
            assert('every starter has a spec', STARTERS.every((s) => starterSpec(s.id, base(), { changes: [] }) !== null), true);
            assert('no Darwin break-even or Mojo runway string', !/break-even|runway/i.test(STARTERS.map((s) => t(s.hintKey)).join(' ')), true);
        },
    },
    {
        name: 'F7.2 each starter builds valid changes',
        fn(assert) {
            const d = base();
            const alex = d.incomeSources[0];
            const rent = d.plan.find((p) => p.id === 'p-rent');
            const smile = bucket(d, 'smile');
            const out = {};
            out.pay = run(starterSpec('pay', d, { changes: [] }), { sourceId: alex.id, newGross: 92000, pct: null, from: '2027-01-01' });
            out.job = run(starterSpec('job', d, { changes: [] }), { sourceId: alex.id, newGross: 99000, note: 'Agency job', from: '2027-02-01' });
            out.extra = run(starterSpec('extra', d, { changes: [] }), { name: 'Weekend market', gross: 6000, schedule: 'monthly' });
            out.expense = run(starterSpec('expense', d, { changes: [] }), { target: 'item:p-rent', newAmount: null, pct: 10 });
            out.goal = run(starterSpec('goal', d, { changes: [] }), { bucketId: smile.id, name: 'Japan', cost: 6000, due: '2027-06-01' });
            const gv = {};
            gv.bucketId = smile.id; gv.n1 = 'PC'; gv.c1 = 1200; gv.d1 = '2027-02-01'; gv.n2 = 'Bike'; gv.c2 = 9000; gv.d2 = '2027-12-01';
            out.goals = run(starterSpec('goals', d, { changes: [] }), gv);
            out.loan = run(starterSpec('loan', d, { changes: [] }), { name: 'Bike loan', balance: 8000, interestRate: 9, interestType: 'variable', compounding: 'monthly', repaymentFrequency: 'monthly', minRepayment: 250, label: '' });
            const sp = starterSpec('split', d, { changes: [] });
            const pv = {};
            const daily = bucket(d, 'daily'); const smileB = smile;
            for (const b of d.allocation) pv[`p_${b.id}`] = b.percentage;
            pv[`p_${daily.id}`] = daily.percentage - 5; pv[`p_${smileB.id}`] = smileB.percentage + 5;
            out.split = run(sp, pv);

            for (const [k, r] of Object.entries(out)) assert(`${k}: no errors`, r.errors, {});
            const counts = Object.fromEntries(Object.entries(out).map(([k, r]) => [k, r.changes.length]));
            assert('change counts', counts, { pay: 1, job: 1, extra: 1, expense: 1, goal: 1, goals: 2, loan: 1, split: 2 });
            for (const [k, r] of Object.entries(out)) assert(`${k}: changes pass F1's rules`, r.changes.map((c) => changeProblems(c)), r.changes.map(() => []));
            const ids = Object.values(out).flatMap((r) => r.changes.map((c) => c.id));
            assert('change ids are strings', ids.every((x) => typeof x === 'string' && x.length > 0), true);

            assert('pay is a set on grossAnnual with the real value as base', [out.pay.changes[0].op, out.pay.changes[0].value, out.pay.changes[0].baseValue, out.pay.changes[0].from],
                ['set', 92000, alex.grossAnnual, '2027-01-01']);
            assert('expense percentage is a factor', [out.expense.changes[0].op, out.expense.changes[0].value, out.expense.changes[0].target.id], ['scale', 1.1, 'p-rent']);
            assert('split records the live percentage', out.split.changes.map((c) => c.baseValue).sort(), [daily.percentage, smileB.percentage].sort());
            const after = resolveAt(d, out.pay.changes, '2027-03-01');
            assert('the change shows in resolveAt', after.incomeSources[0].grossAnnual, 92000);
            const r2 = resolveAt(d, out.expense.changes, TODAY);
            assert('rent scaled', Math.round(r2.plan.find((p) => p.id === 'p-rent').amount * 100), Math.round(rent.amount * 1.1 * 100));
            assert('goal value has a parent and a due date', [out.goal.changes[0].value.parentId, out.goal.changes[0].value.due], [smile.id, '2027-06-01']);
            const withExtra = resolveAt(d, out.extra.changes, TODAY);
            assert('extra income is appended', withExtra.incomeSources.length, d.incomeSources.length + 1);
            const withLoan = resolveAt(d, out.loan.changes, TODAY);
            assert('loan is appended with an id', [withLoan.liabilities.length, typeof withLoan.liabilities[withLoan.liabilities.length - 1].id], [d.liabilities.length + 1, 'string']);
        },
    },
    {
        name: 'F7.3 sheets refuse bad answers',
        fn(assert) {
            const d = base();
            const alex = d.incomeSources[0];
            const pay = starterSpec('pay', d, { changes: [] });
            assert('pay: nothing filled', Object.keys(run(pay, { sourceId: alex.id, newGross: null, pct: null }).errors), ['newGross']);
            assert('pay: both filled', Object.keys(run(pay, { sourceId: alex.id, newGross: 90000, pct: 5 }).errors), ['pct']);
            assert('pay: until before from', Object.keys(run(pay, { sourceId: alex.id, newGross: 90000, pct: null, from: '2027-05-01', until: '2027-04-01' }).errors), ['until']);
            assert('pay: unknown source', Object.keys(run(pay, { sourceId: 'nope', newGross: 90000, pct: null }).errors), ['sourceId']);
            const goals = starterSpec('goals', d, { changes: [] });
            assert('goals: one goal is not enough', Object.keys(run(goals, { n1: 'PC', c1: 1200, d1: '2027-02-01' }).errors), ['_form']);
            assert('goals: a half-filled row is named', Object.keys(run(goals, { n1: 'PC', c1: 1200, d1: '2027-02-01', n2: 'Bike' }).errors).sort(), ['c2', 'd2']);
            const split = starterSpec('split', d, { changes: [] });
            assert('split: unchanged', Object.keys(run(split, {}).errors), ['_form']);
            const smile = bucket(d, 'smile');
            assert('split: does not add up', Object.keys(run(split, { [`p_${smile.id}`]: smile.percentage + 3 }).errors), ['_form']);
            const job = starterSpec('job', d, { changes: [] });
            assert('job: note (the job name) is required by the sheet', job.fields.find((f) => f.key === 'note').required, true);
            const exp = starterSpec('expense', d, { changes: [] });
            assert('expense: a group takes a percentage only', Object.keys(run(exp, { target: exp.fields[0].options.find((o) => o.value.startsWith('cat:')).value, newAmount: 100, pct: null }).errors), ['newAmount']);
        },
    },
    {
        name: 'F7.4 a change whose target is gone',
        fn(assert) {
            const d = base();
            const spec = starterSpec('expense', d, { changes: [] });
            const c = run(spec, { target: 'item:p-rent', pct: 10, newAmount: null }).changes[0];
            const live = describeChange(d, c);
            assert('present: not missing', live.missing, false);
            const gone = { ...d, plan: d.plan.filter((p) => p.id !== 'p-rent') };
            const d2 = describeChange(gone, c);
            assert('gone: flagged', d2.missing, true);
            assert('gone: reads no longer in your plan', d2.what.includes('No longer in your plan'), true);
            assert('gone: no Edit button', editSpecFor(gone, c, [c]).replaces, [c.id]);
            assert('kind label', live.kindLabel, 'Expense');
            assert('dates default', [live.from, live.until], ['now', 'no end']);
            const dated = describeChange(d, { ...c, from: '2027-07-01', until: '2027-12-31' });
            assert('dates formatted', [dated.from, dated.until], ['1 Jul 2027', '31 Dec 2027']);
        },
    },
    {
        name: 'F7.5 conflict rows: Keep or Update',
        fn(assert) {
            const d = base();
            const spec = starterSpec('expense', d, { changes: [] });
            const c = run(spec, { target: 'item:p-rent', newAmount: 610, pct: null }).changes[0];
            assert('no conflict at first', describeChange(d, c).conflict, null);
            const moved = { ...d, plan: d.plan.map((p) => (p.id === 'p-rent' ? { ...p, amount: 520 } : p)) };
            const row = describeChange(moved, c);
            assert('conflict text', row.conflict && row.conflict.message, 'Real Rent is now A$520; this scenario says A$610'.replace('Rent', moved.plan.find((p) => p.id === 'p-rent').name));
            const kept = resolveConflict(moved, c, 'keep');
            assert('keep: scenario value stays', kept.value, 610);
            assert('keep: conflict clears', conflictFor(moved, kept).conflict, false);
            const updated = resolveConflict(moved, c, 'update');
            assert('update: takes the real value', [updated.value, updated.baseValue], [520, 520]);
            assert('update: conflict clears', conflictFor(moved, updated).conflict, false);
            assert('no conflict means no change', resolveConflict(d, c, 'keep'), c);
        },
    },
    {
        name: 'F7.6 editing re-opens the starter sheet',
        fn(assert) {
            const d = base();
            const alex = d.incomeSources[0];
            const pay = run(starterSpec('pay', d, { changes: [] }), { sourceId: alex.id, newGross: null, pct: 5, from: '2027-01-01' }).changes[0];
            const spec = editSpecFor(d, pay, [pay]);
            assert('pay edit: prefilled percentage and source', [spec.values.pct, spec.values.sourceId, spec.values.newGross], [5, alex.id, null]);
            const edited = spec.build({ ...spec.values, pct: 8 });
            assert('edit keeps the change id', edited[0].id, pay.id);
            assert('edit takes the new factor', edited[0].value, 1.08);

            const smile = bucket(d, 'smile');
            const daily = bucket(d, 'daily');
            const sp = starterSpec('split', d, { changes: [] });
            const pv = {};
            for (const b of d.allocation) pv[`p_${b.id}`] = b.percentage;
            pv[`p_${daily.id}`] = daily.percentage - 5; pv[`p_${smile.id}`] = smile.percentage + 5;
            const splits = run(sp, pv).changes;
            assert('split group found from one change', groupOf([...splits], splits[0]).length, 2);
            const se = editSpecFor(d, splits[0], splits);
            assert('split edit replaces the whole group', se.replaces.sort(), splits.map((c) => c.id).sort());
            assert('split edit prefilled', se.values[`p_${smile.id}`], smile.percentage + 5);

            const oneOff = { id: 'x1', kind: 'oneOff', target: null, field: null, op: 'add', value: 6000, baseValue: null, from: null, until: null, note: 'Move' };
            const ge = editSpecFor(d, oneOff, [oneOff]);
            assert('a change without a starter edits dates and note', ge.fields.map((f) => f.key), ['from', 'until', 'note']);
            assert('generic edit keeps the rest', ge.build({ from: '2027-01-01', until: null, note: 'Moving' })[0].value, 6000);
        },
    },
    {
        name: 'F7.7 ids stay unique as changes stack',
        fn(assert) {
            const d = base();
            const first = run(starterSpec('goals', d, { changes: [] }), {
                n1: 'A', c1: 100, d1: '2027-01-01', n2: 'B', c2: 200, d2: '2027-02-01', n3: 'C', c3: 300, d3: '2027-03-01',
            }).changes;
            const second = run(starterSpec('goals', d, { changes: first }), { n1: 'D', c1: 100, d1: '2027-01-01', n2: 'E', c2: 100, d2: '2027-01-01' }).changes;
            const all = [...first, ...second];
            assert('no duplicate change ids', new Set(all.map((c) => c.id)).size, all.length);
            assert('no duplicate goal ids', new Set(all.map((c) => c.value.id)).size, all.length);
            const loan1 = run(starterSpec('loan', d, { changes: [] }), { name: 'Car', balance: 5000, interestRate: 8, interestType: 'variable', compounding: 'monthly', repaymentFrequency: 'monthly' }).changes;
            const loan2 = run(starterSpec('loan', d, { changes: loan1 }), { name: 'Car', balance: 5000, interestRate: 8, interestType: 'variable', compounding: 'monthly', repaymentFrequency: 'monthly' }).changes;
            assert('two loans with one name get different ids', loan1[0].value.id !== loan2[0].value.id, true);
        },
    },
    {
        name: 'F7.8 the change list escapes names (browser only)',
        fn(assert) {
            if (!hasDom) return;
            const d = base();
            const evil = '<img src=x onerror=alert(1)><b>x</b>';
            d.plan = d.plan.map((p) => (p.id === 'p-rent' ? { ...p, name: evil } : p));
            const c = run(starterSpec('expense', d, { changes: [] }), { target: 'item:p-rent', pct: 10, newAmount: null }).changes[0];
            const note = { ...c, id: 'n', note: '<script>1</script>' };
            const gone = { id: 'g', kind: 'expense', target: { collection: 'plan', id: 'missing' }, field: 'amount', op: 'set', value: 5, baseValue: 6, from: null, until: null, note: '' };
            const ol = document.createElement('ol');
            const rows = renderChangeList(ol, d, [c, note, gone]);
            assert('three rows', rows, 3);
            assert('no markup was created from names or notes', [ol.querySelectorAll('img, script').length, ol.querySelectorAll('b').length], [0, 3]);
            assert('the name shows as text', ol.textContent.includes(evil), true);
            assert('gone row says so and has no Edit', [ol.querySelector('[data-id="g"]').textContent.includes('No longer in your plan'),
                !!ol.querySelector('[data-act="edit"][data-id="g"]'), !!ol.querySelector('[data-act="remove"][data-id="g"]')], [true, false, true]);
            const moved = { ...d, plan: d.plan.map((p) => (p.id === 'p-rent' ? { ...p, amount: 1 } : p)) };
            const withSet = { ...c, op: 'set', value: 610, baseValue: 1120 };
            const ol2 = document.createElement('ol');
            renderChangeList(ol2, moved, [withSet]);
            assert('conflict row offers Keep and Update', [...ol2.querySelectorAll('.wi-conflict button')].map((b) => b.dataset.act), ['keep', 'update']);
        },
    },
];
