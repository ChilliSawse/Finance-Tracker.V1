// Test cases for the "tax-owed" group (registered in src/test-registry.js).
// Owner step writes these first. Shape: { name, fn(assert) }, assert(label, actual, expected).
// Fixture: an unnamed fortnightly pay of A$3,057.69 (gross 79,499.94 a year), no real data.

import { annualOwed, litoFor, refundOrBill, annualEstimateForSources } from './tax-owed.js';
import { LEGACY_DEFAULT_BRACKETS } from './tax-au.js';

const GROSS = 79499.94;
// The stale bracket copy a saved file might carry (the A$627 trap input).
const STALE = { taxBrackets: LEGACY_DEFAULT_BRACKETS, taxSettings: { financialYear: '2024-25' } };

export const TAX_OWED_TEST_CASES = [
    {
        name: 'C3.1 owed 2025-26, HELP in, refund 45.03',
        fn(assert) {
            const o = annualOwed({ taxableIncome: GROSS, date: '2025-11-01', hasStudyDebt: true });
            assert('tax', o.tax, 14637.98);
            assert('medicare', o.medicare, 1590);
            assert('help', o.help, 1874.99);
            assert('total', o.total, 18102.97);
            assert('lito 0 above A$66,667', o.lito, 0);
            const r = refundOrBill({ withheldPerPay: 698, cycles: 26, owed: o.total });
            assert('withheld', r.withheld, 18148);
            assert('refund 45.03', r.amount, 45.03);
            assert('kind', r.kind, 'refund');
            assert('estimate flag', r.estimate, true);
        },
    },
    {
        name: 'C3.2 owed 2026-27, HELP in, refund 68.23',
        fn(assert) {
            const o = annualOwed({ taxableIncome: GROSS, date: '2026-11-01', hasStudyDebt: true });
            assert('tax', o.tax, 14369.98);
            assert('medicare', o.medicare, 1590);
            assert('help', o.help, 1495.79);
            assert('total', o.total, 17455.77);
            const r = refundOrBill({ withheldPerPay: 674, cycles: 26, owed: o.total });
            assert('withheld', r.withheld, 17524);
            assert('refund 68.23', r.amount, 68.23);
        },
    },
    {
        name: 'C3.3 no HELP 2025-26, refund 48.02, bill when under-withheld',
        fn(assert) {
            const o = annualOwed({ taxableIncome: GROSS, date: '2025-11-01', hasStudyDebt: false });
            assert('help 0', o.help, 0);
            assert('total', o.total, 16227.98);
            const r = refundOrBill({ withheldPerPay: 626, cycles: 26, owed: o.total });
            assert('refund 48.02', r.amount, 48.02);
            const b = refundOrBill({ withheldPerPay: 600, cycles: 26, owed: o.total });
            assert('bill kind', b.kind, 'bill');
            assert('bill amount positive', b.amount, 627.98);
            assert('even kind', refundOrBill({ withheld: 100, owed: 100 }).kind, 'even');
        },
    },
    {
        name: 'C3.4 stale saved brackets never reach the result (no A$627)',
        fn(assert) {
            const clean = annualOwed({ taxableIncome: GROSS, date: '2025-11-01', hasStudyDebt: true });
            const dirty = annualOwed({ taxableIncome: GROSS, date: '2025-11-01', hasStudyDebt: true, ...STALE });
            assert('same total with stale brackets in input', dirty.total, clean.total);
            assert('same tax', dirty.tax, clean.tax);
            assert('table year by date, no stored year', dirty.fy, '2025-26');
            const src = [{ paySchedule: 'fortnightly', grossAnnual: GROSS, hasStudyDebt: true, claimsTaxFree: true }];
            const est = annualEstimateForSources(src, '2025-11-01', STALE);
            const est0 = annualEstimateForSources(src, '2025-11-01');
            assert('data-level result ignores saved brackets', est.owed.total, est0.owed.total);
            assert('owed total is the table figure', est.owed.total, 18102.97);
            assert('estimate label', est.estimate, true);
        },
    },
    {
        name: 'C3 LITO dated table data: bands and Medicare shade-in',
        fn(assert) {
            assert('full A$700 at 30,000', litoFor(30000, '2025-11-01'), 700);
            assert('A$325 at 45,000', litoFor(45000, '2025-11-01'), 325);
            assert('mid second band 55,000', litoFor(55000, '2025-11-01'), 175);
            assert('nil from 66,667', litoFor(66667, '2025-11-01'), 0);
            const o = annualOwed({ taxableIncome: 40000, date: '2025-11-01' });
            assert('tax at 40,000 = 3,488 less LITO 575', o.tax, 2913);
            assert('Medicare shade-in at 30,000', annualOwed({ taxableIncome: 30000, date: '2025-11-01' }).medicare, 198.9);
            assert('tax never negative', annualOwed({ taxableIncome: 20000, date: '2025-11-01' }).tax, 0);
        },
    },
    {
        name: 'C3 sources: HELP on total repayment income, per-source debt flag',
        fn(assert) {
            const a = { paySchedule: 'fortnightly', grossAnnual: 52000, hasStudyDebt: true };
            const b = { paySchedule: 'weekly', grossAnnual: 26000, hasStudyDebt: false };
            const e = annualEstimateForSources([a, b], '2025-11-01');
            assert('income summed', e.taxableIncome, 78000);
            assert('HELP on 78,000 total', e.owed.help, 1650);
            assert('no debt anywhere, no HELP', annualEstimateForSources([b], '2025-11-01').owed.help, 0);
        },
    },
];
