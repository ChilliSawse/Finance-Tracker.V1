// Test cases for the "income-migration" group (C4.1 to C4.4 plus the new calculations outputs).
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixtures are unnamed and synthetic.

import { calculateTotals } from '../calc/calculations.js';
import { runMigrationChain } from './migration-chain.js';
import {
    needsIncomeMigration, migrateIncomeFields, acceptPayslipJob,
} from './income-migration.js';

const OLD_KEYS = [
    'totalGrossAnnualIncome', 'totalAnnualTax', 'totalNetAnnualIncome', 'essentialWeeklyTotal',
    'nonEssentialWeeklyTotal', 'totalWeeklyExpenses', 'weeklySavings', 'annualSavings',
    'currentAssets', 'currentLiabilities', 'netWorth', 'savingsRate',
];
const oldOutputs = (d) => {
    const t = calculateTotals(d);
    const o = {};
    for (const k of OLD_KEYS) o[k] = t[k];
    o.perSource = d.incomeSources.map(s => [s._calculatedGrossAnnual, s._calculatedNetAnnual, s._calculatedAnnualTax]);
    return o;
};

const BRACKETS = [{ min: 0, max: 18200, rate: 0 }, { min: 18200, max: Infinity, rate: 0.16 }];

function selfEmployedSave() {
    return {
        dataVersion: 2, savingModel: { version: 1 }, plan: [], rules: [],
        taxBrackets: BRACKETS.map(b => ({ ...b })),
        taxSettings: { financialYear: '2025-26', includeMedicareLevy: false, helpBalance: 0, includeHelpInEstimate: true },
        primaryIncomeIndex: 0,
        incomeSources: [{ name: 'Job', incomeType: 'selfEmployed', paySchedule: 'fortnightly', grossAnnual: 0, hoursPerCycle: 0, taxRemoved: 698, invoicedPayPostTax: 2359.69 }],
        allocation: [{ name: 'Daily', percentage: 100 }],
        essentialExpenses: [], nonEssentialExpenses: [], assets: [], liabilities: [],
    };
}

function runAll(d) { return runMigrationChain(d, { storage: null }); }

export const INCOME_MIGRATION_TEST_CASES = [
    {
        name: 'C4.1 a self-employed payslip job is flagged and totals do not change',
        fn(assert) {
            const d = selfEmployedSave();
            const before = oldOutputs(d);
            assert('before: tax is 698 x 26', before.totalAnnualTax, 18148);
            runAll(d);
            const s = d.incomeSources[0];
            assert('flagged payslip-job', s.migrationPrompt, 'payslip-job');
            assert('still self-employed', s.incomeType, 'selfEmployed');
            assert('pay figures kept', [s.taxRemoved, s.invoicedPayPostTax, s.grossAnnual], [698, 2359.69, 0]);
            assert('every existing output identical', oldOutputs(d), before);
            assert('withheld tax is still 698 x 26', calculateTotals(d).totalAnnualTax, 18148);
        },
    },
    {
        name: 'C4.1b new fields land with safe defaults, brackets kept as legacy',
        fn(assert) {
            const d = selfEmployedSave();
            runAll(d);
            const s = d.incomeSources[0];
            assert('income fields', [s.hourlyRate, s.hoursPerWeek, s.superPct, s.basis, s.taxCheck],
                [null, null, null, 'selfEmployed', null]);
            assert('withholding defaults', s.withholding,
                { claimsTaxFree: true, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0 });
            assert('no next pay date field (X-9)', 'nextPayDate' in s, false);
            assert('legacy brackets copied', d.legacyTaxBrackets.length, 2);
            assert('legacy top band keeps Infinity', d.legacyTaxBrackets[1].max, Infinity);
            assert('old brackets and stored year left in place', [d.taxBrackets.length, d.taxSettings.financialYear], [2, '2025-26']);
            assert('no yearMode stored', 'yearMode' in d.taxSettings, false);
        },
    },
    {
        name: 'C4.2 accepting the prompt makes it salaried with the grossed-up pay',
        fn(assert) {
            const d = selfEmployedSave();
            runAll(d);
            const s = d.incomeSources[0];
            assert('accepted', acceptPayslipJob(s), true);
            assert('salaried', s.incomeType, 'salaried');
            assert('gross = (2359.69 + 698) x 26', Math.round(s.grossAnnual * 100) / 100, 79499.94);
            assert('actual pay kept', [s.taxRemoved, s.invoicedPayPostTax], [698, 2359.69]);
            assert('declaration defaults', [s.withholding.claimsTaxFree, s.withholding.hasStudyDebt], [true, null]);
            assert('prompt cleared', 'migrationPrompt' in s, false);
            assert('annual tax still 698 x 26', calculateTotals(d).totalAnnualTax, 18148);
            assert('a second accept is a no-op', acceptPayslipJob(s), false);
        },
    },
    {
        name: 'C4.3 variable and no-tax sources are never flagged',
        fn(assert) {
            const d = selfEmployedSave();
            d.incomeSources = [
                { name: 'Gigs', incomeType: 'variable', paySchedule: 'fortnightly', taxRemoved: 100, invoicedPayPostTax: 900,
                  incomeEvents: [{ id: 'e1', date: '2026-07-10', label: 'a', netAmount: 500, taxWithheld: 50 }] },
                { name: 'Own', incomeType: 'selfEmployed', paySchedule: 'fortnightly', taxRemoved: null, invoicedPayPostTax: 2000 },
                { name: 'Zero', incomeType: 'selfEmployed', paySchedule: 'fortnightly', taxRemoved: 0, invoicedPayPostTax: 2000 },
                { name: 'Salary', incomeType: 'salaried', paySchedule: 'fortnightly', grossAnnual: 80000, taxRemoved: 600, invoicedPayPostTax: 2400 },
                { name: 'NoCycle', incomeType: 'selfEmployed', paySchedule: '', taxRemoved: 500, invoicedPayPostTax: 2000 },
            ];
            runAll(d);
            assert('none flagged', d.incomeSources.map(s => 'migrationPrompt' in s), [false, false, false, false, false]);
            assert('variable basis', d.incomeSources[0].basis, 'variable');
        },
    },
    {
        name: 'C4.4 every migration twice leaves the object identical',
        fn(assert) {
            const d = selfEmployedSave();
            const first = runAll(d);
            assert('first run changed it', first.changed, true);
            const snap = JSON.stringify(d);
            const second = runAll(d);
            assert('second run reports no change', second.changed, false);
            assert('object identical', JSON.stringify(d), snap);
            assert('needs is false afterwards', needsIncomeMigration(d), false);
            assert('migrate returns false', migrateIncomeFields(d), false);
            assert('identical after direct re-run', JSON.stringify(d), snap);
        },
    },
    {
        name: 'C4.5 an empty save and a default-shaped save are safe',
        fn(assert) {
            assert('empty data: nothing to do', migrateIncomeFields({}), false);
            const d = { incomeSources: [{ name: 'New', incomeType: 'salaried', grossAnnual: 0, paySchedule: 'fortnightly' }] };
            assert('needs', needsIncomeMigration(d), true);
            assert('migrates', migrateIncomeFields(d), true);
            assert('salary basis', d.incomeSources[0].basis, 'salary');
            assert('then settled', needsIncomeMigration(d), false);
        },
    },
    {
        name: 'C4.6 new totals outputs; existing outputs stay identical',
        fn(assert) {
            const d = selfEmployedSave();
            d.incomeSources = [{ name: 'Job', incomeType: 'salaried', paySchedule: 'fortnightly', grossAnnual: 79499.94, hoursPerCycle: 0, taxRemoved: null, invoicedPayPostTax: null }];
            const before = oldOutputs(d);
            runAll(d);
            assert('outputs identical after migration', oldOutputs(d), before);
            d.incomeSources[0].withholding.hasStudyDebt = true;
            const t = calculateTotals(d, { today: '2025-10-01' });
            const s = d.incomeSources[0];
            assert('withheld per pay 626 + 72', s._withheldPerCycle, 698);
            assert('net per pay', Math.round(s._netPerCycleWithheld * 100) / 100, 2359.69);
            assert('annual owed (A1)', t._annualTaxOwed, 18102.97);
            assert('refund 45.03 (A1)', [t._refundOrBill.kind, t._refundOrBill.amount], ['refund', 45.03]);
            assert('existing outputs unchanged by the new fields', oldOutputs(d), before);
        },
    },
    {
        name: 'C4.7 actual payslip tax wins for a self-employed source; variable has none',
        fn(assert) {
            const d = selfEmployedSave();
            runAll(d);
            const t = calculateTotals(d, { today: '2025-10-01' });
            assert('withheld = actual 698', d.incomeSources[0]._withheldPerCycle, 698);
            assert('net = actual 2359.69', d.incomeSources[0]._netPerCycleWithheld, 2359.69);
            assert('totals output present', typeof t._annualTaxOwed, 'number');
            d.incomeSources[0].incomeType = 'variable';
            calculateTotals(d, { today: '2025-10-01' });
            assert('variable: no withheld estimate', d.incomeSources[0]._withheldPerCycle, null);
        },
    },
    {
        name: 'C4.8 a saved bracket copy is never read for the new outputs (FT-R-97)',
        fn(assert) {
            const a = selfEmployedSave();
            a.incomeSources = [{ name: 'J', incomeType: 'salaried', paySchedule: 'fortnightly', grossAnnual: 79499.94 }];
            runAll(a);
            const b = JSON.parse(JSON.stringify(a));
            b.legacyTaxBrackets = [{ min: 0, max: null, rate: 0.9 }];
            const ta = calculateTotals(a, { today: '2025-10-01' });
            const tb = calculateTotals(b, { today: '2025-10-01' });
            assert('same owed', tb._annualTaxOwed, ta._annualTaxOwed);
        },
    },
];
