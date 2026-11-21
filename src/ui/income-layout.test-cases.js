// Test cases for the "income-layout" group (C6, registered in src/test-registry.js).
// Pure parts only: the sheet DOM is checked by eye. Fixtures are synthetic (an unnamed employee).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    layoutFor, sheetValuesFor, draftSource, applyIncomeValues, readoutFor, describeCheck,
    patchForFix, payAnchorFromNext, grossAnnualFrom, recordPayslipCheck, openIncomeSheet,
} from './income-layout.js';
import { store } from '../state/store.js';
import { acceptPayslipJob } from '../state/income-migration.js';

const TODAY = '2026-03-10';
const emp = (over = {}) => ({
    name: 'Job', incomeType: 'salaried', basis: 'salary', paySchedule: 'fortnightly', grossAnnual: 79500,
    hourlyRate: null, hoursPerWeek: null, superPct: null, payAnchor: '2026-03-06',
    withholding: { claimsTaxFree: true, hasStudyDebt: true, medicareExemption: false, extraPerPay: 0 }, ...over,
});
const vals = (over = {}) => ({ ...sheetValuesFor(emp(), 'salary', TODAY), ...over });

export const INCOME_LAYOUT_TEST_CASES = [
    {
        name: 'C6.1 layout routing',
        fn(assert) {
            assert('employee is Salary', layoutFor(emp()), 'salary');
            assert('rate and hours is Set hours', layoutFor(emp({ hourlyRate: 40, hoursPerWeek: 30 })), 'hours');
            assert('self-employed keeps its editor', layoutFor(emp({ incomeType: 'selfEmployed' })), null);
            assert('variable keeps its editor', layoutFor(emp({ incomeType: 'variable' })), null);
            assert('missing source', layoutFor(null), null);
        },
    },
    {
        name: 'C6.2 diagnosed payslip: match, then HELP off with a one-tap fix',
        fn(assert) {
            const v = vals();
            const on = describeCheck({ tax: 698, gross: 3057.69, date: TODAY }, draftSource(v, 'salary'), TODAY);
            assert('match state', on.state, 'match');
            assert('expected line', on.lines[0], 'Expected: A$626 tax + A$72 HELP = A$698');
            assert('payslip line', on.lines[1], 'Your payslip: A$698');

            const off = vals({ hasStudyDebt: 'no' });
            const d = describeCheck({ tax: 698, gross: 3057.69, date: TODAY }, draftSource(off, 'salary'), TODAY);
            assert('cause state', d.state, 'cause');
            assert('HELP copy', d.message, 'The A$72 difference is about what HELP takes on your pay.');
            assert('fix label', d.fixes[0].label, 'I have a HELP debt');
            const patch = patchForFix(d.fixes[0].fix);
            assert('patch turns HELP on', patch, { hasStudyDebt: 'yes' });
            const again = describeCheck({ tax: 698, gross: 3057.69, date: TODAY }, draftSource({ ...off, ...patch }, 'salary'), TODAY);
            assert('matches after the fix', again.state, 'match');
        },
    },
    {
        name: 'C6.3 pay date stored as payAnchor (X-9)',
        fn(assert) {
            assert('weekly', payAnchorFromNext('2026-03-20', 'weekly'), '2026-03-13');
            assert('fortnightly', payAnchorFromNext('2026-03-20', 'fortnightly'), '2026-03-06');
            assert('monthly keeps the day', payAnchorFromNext('2026-03-31', 'monthly'), '2026-01-31');
            assert('quarterly has none', payAnchorFromNext('2026-03-20', 'quarterly'), null);

            const s = emp({ payAnchor: null });
            const initial = { grossAnnual: s.grossAnnual, paySchedule: 'fortnightly', nextPay: '' };
            applyIncomeValues(s, vals({ nextPay: '2026-03-20' }), 'salary', initial);
            assert('anchor is the pay before', s.payAnchor, '2026-03-06');
            assert('no second field', 'nextPayDate' in s, false);

            const kept = emp();
            const init2 = { grossAnnual: kept.grossAnnual, paySchedule: 'fortnightly', nextPay: sheetValuesFor(kept, 'salary', TODAY).nextPay };
            applyIncomeValues(kept, { ...sheetValuesFor(kept, 'salary', TODAY), name: 'Renamed' }, 'salary', init2);
            assert('unchanged date keeps the anchor', kept.payAnchor, '2026-03-06');
        },
    },
    {
        name: 'C6.4 save writes the fields, per-payslip entry does not drift the gross',
        fn(assert) {
            const s = emp();
            const initial = { grossAnnual: s.grossAnnual, paySchedule: 'fortnightly', nextPay: '' };
            applyIncomeValues(s, vals({ enterAs: 'pay', amount: 3057.69, superPct: 11, hasStudyDebt: 'unsure', salarySacrifice: 'yes', medicareExemption: 'yes', extraPerPay: 20 }), 'salary', initial);
            assert('gross kept (rounding only)', s.grossAnnual, 79500);
            assert('super', s.superPct, 11);
            assert('HELP not sure is null', s.withholding.hasStudyDebt, null);
            assert('medicare stored', s.withholding.medicareExemption, true);
            assert('extra stored', s.withholding.extraPerPay, 20);
            assert('sacrifice stored', s.salarySacrifice, true);

            const h = emp();
            applyIncomeValues(h, { ...vals(), hourlyRate: 40, hoursPerWeek: 30 }, 'hours', initial);
            assert('hours gross', h.grossAnnual, 62400);
            assert('hours fields', [h.hourlyRate, h.hoursPerWeek, h.hoursPerCycle], [40, 30, 60]);
            assert('per payslip changed amount', grossAnnualFrom({ ...vals(), enterAs: 'pay', amount: 2000 }, 'salary', initial), 52000);
        },
    },
    {
        name: 'C6.5 what we work out',
        fn(assert) {
            const r = readoutFor(vals(), 'salary', { taxBrackets: [] }, TODAY);
            assert('gross a pay', r.gross, 3057.69);
            assert('parts', r.parts, 'A$626 tax + A$72 HELP');
            assert('total', r.total, 698);
            assert('net', Math.round(r.net * 100), Math.round((3057.69 - 698) * 100));
            assert('estimate kinds', ['refund', 'bill', 'even'].includes(r.refund.kind), true);
            assert('tables year', r.fy, '2025-26');
            const noHelp = readoutFor(vals({ hasStudyDebt: 'unsure' }), 'salary', { taxBrackets: [] }, TODAY);
            assert('before HELP when unsure', [noHelp.parts, noHelp.helpUnsure], ['A$626 tax', true]);
            assert('super on gross', readoutFor(vals({ superPct: 10 }), 'salary', {}, TODAY).superAnnual, 7950);
        },
    },
    {
        name: 'K2.5 a payslip check is stored on the source as {date, matched}',
        fn(assert) {
            const s = emp();
            assert('stored', recordPayslipCheck(s, true, '2026-03-06', TODAY), true);
            assert('shape', s.taxCheck, { date: '2026-03-06', matched: true });
            assert('same result stores nothing new', recordPayslipCheck(s, true, '2026-03-06', TODAY), false);
            assert('a differing result replaces it', recordPayslipCheck(s, false, '2026-03-20', TODAY), true);
            assert('replaced', s.taxCheck, { date: '2026-03-20', matched: false });
            assert('bad date falls back to today', recordPayslipCheck(s, true, 'x', TODAY) && s.taxCheck.date, TODAY);
            assert('non-boolean ignored', recordPayslipCheck(s, 'yes', '2026-03-06', TODAY), false);
            assert('no source', recordPayslipCheck(null, true, '2026-03-06', TODAY), false);
        },
    },
    {
        name: 'K2.7 running the payslip check in the sheet stores {date, matched} on the source',
        fn(assert) {
            if (typeof document === 'undefined') return;
            const saved = store.financeData;
            const src = emp({ incomeType: 'salaried', grossAnnual: 65000 });
            store.financeData = { primaryIncomeIndex: 0, incomeSources: [src], taxSettings: {} };
            try {
                assert('opened', openIncomeSheet(0), true);
                const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
                set('ils-slip-date', '2026-03-06');
                set('ils-slip-tax', '1');
                assert('a result is stored', !!src.taxCheck && typeof src.taxCheck.matched === 'boolean', true);
                assert('with the payslip date', src.taxCheck && src.taxCheck.date, '2026-03-06');
                document.querySelector('[data-sheet-action="close"]').click();
            } finally { store.financeData = saved; }
        },
    },
    {
        name: 'C6.6 payslip-job offer uses acceptPayslipJob',
        fn(assert) {
            const s = { incomeType: 'selfEmployed', paySchedule: 'fortnightly', invoicedPayPostTax: 2000, taxRemoved: 500, migrationPrompt: 'payslip-job', withholding: { claimsTaxFree: true } };
            assert('self-employed has no sheet yet', layoutFor(s), null);
            assert('accepted', acceptPayslipJob(s), true);
            assert('now salary', [s.incomeType, s.grossAnnual, s.migrationPrompt], ['salaried', 65000, undefined]);
            assert('and opens the Salary layout', layoutFor(s), 'salary');
        },
    },
];
