// Test cases for the "plan" group (B1.9; registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { cloneDefaultFinanceData } from '../state/defaults.js';
import { calculateTotals } from './calculations.js';
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
];
