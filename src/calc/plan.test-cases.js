// Test cases for the "plan" group (B1.9; registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { cloneDefaultFinanceData } from '../state/defaults.js';
import { calculateTotals } from './calculations.js';
import { addPlanItem, updatePlanItem, removePlanItem, convertToBill } from '../state/plan.js';
import { perCycle, perMonth, planTotals, netPerPayCents } from './plan.js';

// Mirrors the sample household (sample-data.js) without touching IndexedDB.
function sampleLike() {
    const d = cloneDefaultFinanceData();
    delete d.dataVersion; // B3: this fixture is the legacy shape (defaults are now dataVersion 2)
    d.primaryIncomeIndex = 0;
    d.incomeSources = [
        { name: 'A', incomeType: 'salaried', grossAnnual: 85000, paySchedule: 'fortnightly', hoursPerCycle: 76, taxRemoved: null, invoicedPayPostTax: null },
        { name: 'B', incomeType: 'selfEmployed', grossAnnual: 0, paySchedule: 'fortnightly', hoursPerCycle: 20, taxRemoved: 120, invoicedPayPostTax: 940 },
    ];
    d.taxSettings = { financialYear: d.taxSettings && d.taxSettings.financialYear, includeMedicareLevy: true, helpBalance: 24600, includeHelpInEstimate: true };
    d.essentialExpenses = [
        { name: 'Rent', amount: 560, frequency: 'weekly' }, { name: 'Groceries', amount: 290, frequency: 'weekly' },
        { name: 'Utilities', amount: 75, frequency: 'weekly' }, { name: 'Transport', amount: 65, frequency: 'weekly' },
        { name: 'Health', amount: 46, frequency: 'weekly' },
    ];
    d.nonEssentialExpenses = [
        { name: 'Dining', amount: 110, frequency: 'weekly' }, { name: 'Streaming', amount: 55, frequency: 'monthly' },
        { name: 'Gym', amount: 26, frequency: 'weekly' }, { name: 'Hobbies', amount: 150, frequency: 'monthly' },
    ];
    return d;
}

const r2 = (n) => Math.round(n * 100) / 100;


// B4 fixture: a v2 plan with one essential and one non-essential line.
function b4Data() {
    const d = sampleLike();
    d.dataVersion = 2;
    d.plan = [
        { id: 'a', categoryId: 'housing', name: 'Rent', amount: 560, frequency: 'weekly', anchorDue: null, matchRule: null, bucketId: null, inTotals: true, legacy: null },
        { id: 'b', categoryId: 'dining', name: 'Dining', amount: 110, frequency: 'weekly', anchorDue: null, matchRule: null, bucketId: null, inTotals: true, legacy: null },
    ];
    return d;
}

export const PLAN_TEST_CASES = [
    {
        name: 'B1.9 sample totals',
        fn(assert) {
            const d = sampleLike();
            const t = planTotals(d);
            assert('essential a fortnight', r2(t.essentialPerCycle), 2072);
            assert('non-essential a fortnight', r2(t.nonEssentialPerCycle), 366.62);
            assert('agrees with calculateTotals', r2(t.essentialWeekly), r2(calculateTotals(sampleLike()).essentialWeeklyTotal));
            assert('cycles', t.cyclesPerYear, 26);
            const before = JSON.stringify(d);
            assert('net per pay cents', netPerPayCents(d), 343843);
            assert('input not mutated', JSON.stringify(d), before);
        },
    },
    {
        name: 'B1.9b perCycle, perMonth and v2 plan',
        fn(assert) {
            assert('quarterly per fortnight', perCycle({ amount: 130, frequency: 'quarterly' }, 26), 20);
            assert('weekly per month', r2(perMonth({ amount: 100, frequency: 'weekly' })), 433.33);
            const d = sampleLike();
            d.dataVersion = 2;
            d.plan = [
                { id: 'a', categoryId: 'housing', name: 'Rent', amount: 560, frequency: 'weekly', inTotals: true },
                { id: 'b', categoryId: 'dining', name: 'Dining', amount: 110, frequency: 'weekly', inTotals: true },
                { id: 'c', categoryId: 'utilities', name: 'Rego', amount: 214, frequency: 'quarterly', inTotals: false },
            ];
            const t = planTotals(d);
            assert('v2 essential', r2(t.essentialPerCycle), 1120);
            assert('v2 non-essential, bill excluded', r2(t.nonEssentialPerCycle), 220);
            d.dataVersion = 1;
            assert('unmigrated ignores plan', r2(planTotals(d).essentialPerCycle), 2072);
        },
    },
    // ── B4 plan state API (appended; B6 adds its bill groups above or below separately) ──
    {
        name: 'B4.1 add, edit, remove each undo to a deep-equal state',
        fn(assert) {
            const d = b4Data();
            const start = JSON.stringify(d);
            const add = addPlanItem(d, { categoryId: 'dining', name: 'Cafe', amount: 20, frequency: 'weekly' });
            assert('add ok', add.ok, true);
            assert('add counts', add.item.inTotals, true);
            assert('add grows plan', d.plan.length, 3);
            add.onUndo();
            assert('add undo deep-equal', JSON.stringify(d), start);

            const upd = updatePlanItem(d, 'a', { amount: 600, name: 'Rent 2' });
            assert('edit applied', d.plan[0].amount, 600);
            upd.onUndo();
            assert('edit undo deep-equal', JSON.stringify(d), start);

            const rm = removePlanItem(d, 'a');
            assert('remove', d.plan.length, 1);
            rm.onUndo(); rm.onUndo();
            assert('remove undo deep-equal, once only', JSON.stringify(d), start);
            assert('unknown id', removePlanItem(d, 'zzz').ok, false);
            assert('unknown id update', updatePlanItem(d, 'zzz', {}).ok, false);
        },
    },
    {
        name: 'B4.2 totals follow each change and each undo',
        fn(assert) {
            const d = b4Data();
            const ess = () => r2(planTotals(d).essentialPerCycle);
            const non = () => r2(planTotals(d).nonEssentialPerCycle);
            assert('base essential', ess(), 1120);
            assert('base non-essential', non(), 220);
            const add = addPlanItem(d, { categoryId: 'housing', name: 'Water', amount: 10, frequency: 'weekly' });
            assert('add raises essential', ess(), 1140);
            add.onUndo();
            assert('undo restores', ess(), 1120);
            const upd = updatePlanItem(d, 'b', { amount: 55 });
            assert('edit lowers non-essential', non(), 110);
            upd.onUndo();
            assert('edit undo', non(), 220);
            const rm = removePlanItem(d, 'a');
            assert('remove drops essential', ess(), 0);
            rm.onUndo();
            assert('remove undo', ess(), 1120);
        },
    },
    {
        name: 'B4.3 convertToBill sets anchorDue; a new bill counts; payload fits showUndoToast',
        fn(assert) {
            const d = b4Data();
            const start = JSON.stringify(d);
            assert('needs a date', convertToBill(d, 'b', {}).ok, false);
            const res = convertToBill(d, 'b', { anchorDue: '2026-12-01', frequency: 'monthly' });
            assert('anchorDue set', d.plan[1].anchorDue, '2026-12-01');
            assert('frequency set', d.plan[1].frequency, 'monthly');
            assert('still counts', d.plan[1].inTotals, true);
            res.onUndo();
            assert('convert undo deep-equal', JSON.stringify(d), start);
            const bill = addPlanItem(d, { categoryId: 'housing', name: 'Rego', amount: 214, frequency: 'quarterly', anchorDue: '2027-01-10' });
            assert('new bill counts', bill.item.inTotals, true);
            assert('unique ids', addPlanItem(d, { name: 'Rego' }).item.id !== bill.item.id, true);
            assert('toast shape', typeof bill.message === 'string' && typeof bill.onUndo === 'function', true);
        },
    },
];
