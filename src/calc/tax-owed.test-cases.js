// Test cases for the "tax-owed" group (registered in src/test-registry.js).
// Owner step writes these first. Shape: { name, fn(assert) }, assert(label, actual, expected).
// Fixture: an unnamed fortnightly pay of A$3,057.69 (gross 79,499.94 a year), no real data.

import { annualOwed, litoFor, refundOrBill, annualEstimateForSources, watoFor } from './tax-owed.js';
import { LEGACY_DEFAULT_BRACKETS, mlsRate, lacksPrivateCover, getTaxYear, helpRepaymentForYear, calculateHelpRepayment } from './tax-au.js';
import { estimateAnnualTax } from './income-events.js';
import { setReferenceTaxTables } from './tax-tables/index.js';
import { applyReferenceTax } from '../state/reference-tax.js';
import { tablesFromReference } from './tax-tables/reference-tables.js';
import taxFile from '../../reference/src/tax.json' with { type: 'json' };
import { calculateTotals } from './calculations.js';
import { yearInputs } from './fi.js';
import { helpPayoffModel } from '../ui/future/model.js';
import { buildSampleHousehold } from '../state/sample-data.js';

const TODAY = '2026-11-23';
/** The sample household with the given salaried sources and the cover answer; the year is picked by date. */
function household(grosses, cover) {
    const d = buildSampleHousehold(TODAY).data;
    const alex = d.incomeSources[0];
    d.incomeSources = grosses.map((g, i) => ({ ...JSON.parse(JSON.stringify(alex)), name: `Job ${i + 1}`, grossAnnual: g, hasStudyDebt: false, withholding: { ...alex.withholding, hasStudyDebt: false } }));
    d.primaryIncomeIndex = 0;
    d.taxSettings = { financialYear: null, includeMedicareLevy: true, includeHelpInEstimate: false, helpBalance: 0 };
    if (cover !== undefined) d.taxSettings.hasPrivateHospitalCover = cover;
    return d;
}
const r2 = (n) => Math.round(n * 100) / 100;

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
        name: 'C3.2 owed 2026-27, HELP in, refund 538.23 (standard deduction)',
        fn(assert) {
            const o = annualOwed({ taxableIncome: GROSS, date: '2026-11-01', hasStudyDebt: true });
            // FT-R-131: 2026-27 takes off the A$1,000 standard deduction (no work deductions are entered), so every
            // figure is worked on 78,499.94.
            assert('deduction', o.deduction, 1000);
            assert('tax', o.tax, 14069.98);
            assert('medicare', o.medicare, 1570);
            assert('help', o.help, 1345.79);
            assert('total', o.total, 16985.77);
            const r = refundOrBill({ withheldPerPay: 674, cycles: 26, owed: o.total });
            assert('withheld', r.withheld, 17524);
            assert('refund 538.23', r.amount, 538.23);
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
    {
        name: 'DB17.1 private hospital cover: unanswered or Yes changes nothing',
        fn(assert) {
            for (const date of ['2025-11-01', '2026-11-23']) {
                const base = annualOwed({ taxableIncome: 150000, date, hasStudyDebt: true });
                assert(`${date} no surcharge by default`, base.mls, 0);
                assert(`${date} Yes is the same as not asked`, annualOwed({ taxableIncome: 150000, date, hasStudyDebt: true, privateCover: true }), base);
                assert(`${date} No adds only the surcharge`, annualOwed({ taxableIncome: 150000, date, hasStudyDebt: true, privateCover: false }).total > base.total, true);
            }
            const ts = { financialYear: '2025-26', includeMedicareLevy: true };
            const plain = estimateAnnualTax(150000, [], ts);
            assert('estimate path: Yes is the same as not asked', estimateAnnualTax(150000, [], { ...ts, hasPrivateHospitalCover: true }), plain);
            assert('estimate path: No adds 1.25% of 150,000', Math.round((estimateAnnualTax(150000, [], { ...ts, hasPrivateHospitalCover: false }) - plain) * 100) / 100, 1875);
            assert('only an explicit No counts', [lacksPrivateCover({}), lacksPrivateCover({ hasPrivateHospitalCover: null }), lacksPrivateCover({ hasPrivateHospitalCover: true }), lacksPrivateCover({ hasPrivateHospitalCover: false }), lacksPrivateCover(null)], [false, false, false, true, false]);
            const src = [{ paySchedule: 'fortnightly', grossAnnual: 150000 }];
            assert('sources: default has no surcharge', annualEstimateForSources(src, '2025-11-01').owed.mls, 0);
            assert('sources: No carries it through', annualEstimateForSources(src, '2025-11-01', null, { privateCover: false }).owed.mls, 1875);
        },
    },
    {
        name: 'DB17.2 surcharge tiers at the single boundaries, 2025-26',
        fn(assert) {
            const mls = (inc) => annualOwed({ taxableIncome: inc, date: '2025-11-01', privateCover: false }).mls;
            assert('101,000 or less: nil', mls(101000), 0);
            assert('101,001: 1%', mls(101001), 1010.01);
            assert('118,000: 1%', mls(118000), 1180);
            assert('118,001: 1.25%', mls(118001), 1475.01);
            assert('158,000: 1.25%', mls(158000), 1975);
            assert('158,002: 1.5%', mls(158002), 2370.03);
            assert('no income: nil', mls(0), 0);
        },
    },
    {
        name: 'DB17.3 surcharge tiers at the single boundaries, 2026-27 (income after the A$1,000 standard deduction)',
        fn(assert) {
            const mls = (inc) => annualOwed({ taxableIncome: inc, date: '2026-11-23', privateCover: false }).mls;
            assert('105,000 or less: nil', mls(106000), 0);
            assert('105,001: 1%', mls(106001), 1050.01);
            assert('123,000: 1%', mls(124000), 1230);
            assert('123,001: 1.25%', mls(124001), 1537.51);
            assert('164,000: 1.25%', mls(165000), 2050);
            assert('164,002: 1.5%', mls(165002), 2460.03);
            const t = tablesFromReference(taxFile.years).tables;
            assert('rate lookup straight from the table', [mlsRate(105000, t['2026-27'].mls), mlsRate(105001, t['2026-27'].mls), mlsRate(1e6, t['2026-27'].mls), mlsRate(500, undefined)], [0, 0.01, 0.015, 0]);
        },
    },
    {
        name: 'DB17.4 standard deduction from 2026-27, or the persons own work deductions when higher',
        fn(assert) {
            const d = (taxableIncome, date, workDeductions) => annualOwed({ taxableIncome, date, workDeductions });
            const a = d(50000, '2026-11-23');
            assert('A$1,000 off 50,000', [a.deduction, a.taxableIncome], [1000, 49000]);
            assert('smaller claim: the standard deduction stays', d(50000, '2026-11-23', 600).deduction, 1000);
            const b = d(50000, '2026-11-23', 1500);
            assert('bigger claim is used instead (not added)', [b.deduction, b.taxableIncome], [1500, 48500]);
            assert('lesser of A$1,000 and the income', [d(600, '2026-11-23').deduction, d(600, '2026-11-23').taxableIncome], [600, 0]);
            assert('nothing earned: nothing', d(0, '2026-11-23').deduction, 0);
            assert('before 2026-27 nothing changes', [d(50000, '2025-11-01').deduction, d(50000, '2025-11-01').taxableIncome], [0, 50000]);
            assert('the tax follows the lower income', a.tax < d(50000, '2025-11-01').tax, true);
        },
    },
    {
        name: 'DB17.5 Working Australians tax offset: off while 2027-28 is held, on when its figures are complete',
        fn(assert) {
            const clone = (v) => JSON.parse(JSON.stringify(v));
            try {
                const r = applyReferenceTax(taxFile);
                assert('2027-28 is held as incomplete', [r.used.includes('2027-28'), r.held['2027-28'].reason], [false, 'incomplete']);
                const held = annualOwed({ taxableIncome: 30000, date: '2027-10-01' });
                assert('held year: no offset, the latest built-in year is used', [held.wato, held.stale, held.fy], [0, true, '2026-27']);
                // A complete 2027-28: the 2026-27 figures retagged, plus the real offset figure. Every figure legislated.
                const y = clone(taxFile.years['2026-27']);
                y.incomeTax.workingAustraliansTaxOffset = clone(taxFile.years['2027-28'].incomeTax.workingAustraliansTaxOffset);
                const offset = y.incomeTax.workingAustraliansTaxOffset;
                for (const g of Object.values(y)) for (const f of Object.values(g)) { f.fy = '2027-28'; if (f !== offset && f.appliesFrom) f.appliesFrom = `${+f.appliesFrom.slice(0, 4) + 1}${f.appliesFrom.slice(4)}`; }
                const built = tablesFromReference({ '2027-28': y });
                assert('complete year is built with the offset', [Object.keys(built.tables), built.tables['2027-28'] && built.tables['2027-28'].wato], [['2027-28'], { max: 250 }]);
                setReferenceTaxTables(built.tables);
                const on = annualOwed({ taxableIncome: 30000, date: '2027-10-01' });
                // 29,000 taxable after the deduction: 15% over 18,200 = 1,620, less LITO 700 = 920, less the offset 250.
                assert('complete year: offset applies', [on.fy, on.stale, on.lito, on.wato, on.tax], ['2027-28', false, 700, 250, 670]);
                assert('the offset never goes below nil tax', annualOwed({ taxableIncome: 20000, date: '2027-10-01' }).tax, 0);
                assert('nothing earned: nothing', annualOwed({ taxableIncome: 0, date: '2027-10-01' }).wato, 0);
                // The same year with the offset figure only announced stays held.
                const soft = clone(y);
                soft.incomeTax.workingAustraliansTaxOffset.status = 'announced';
                assert('an announced offset holds the year', Object.keys(tablesFromReference({ '2027-28': soft }).tables), []);
                const gone = clone(y);
                delete gone.incomeTax.workingAustraliansTaxOffset;
                assert('a year without the offset figure is held, not used', tablesFromReference({ '2027-28': gone }).held['2027-28'].figures, ['incomeTax.workingAustraliansTaxOffset']);
            } finally { setReferenceTaxTables({}); }
            assert('back on the built-in tables afterwards', annualOwed({ taxableIncome: 30000, date: '2027-10-01' }).wato, 0);
            assert('the offset is the lesser of A$250 and the tax left', [watoFor(100, { wato: { max: 250 } }), watoFor(1000, { wato: { max: 250 } }), watoFor(1000, {}), watoFor(-5, { wato: { max: 250 } })], [100, 250, 0, 0]);
        },
    },
    {
        name: 'DB17.6 the surcharge is one cliff on total income: two jobs of A$70k and A$60k, answered No',
        fn(assert) {
            const no = household([70000, 60000], false);
            const unasked = household([70000, 60000]);
            const a = calculateTotals(JSON.parse(JSON.stringify(no)), { today: TODAY });
            const b = calculateTotals(JSON.parse(JSON.stringify(unasked)), { today: TODAY });
            // 130,000 less the A$1,000 deduction = 129,000, in the 1.25% tier (123,001 to 164,000): 1,612.50.
            const owed = annualOwed({ taxableIncome: 130000, date: TODAY, privateCover: false, labourIncome: 130000 });
            assert('year-end: total income after the deduction', [owed.taxableIncome, owed.mls], [129000, 1612.5]);
            assert('year-end tax for the year differs by exactly the surcharge', r2(a._annualTaxOwed - b._annualTaxOwed), 1612.5);
            assert('take-home is pure withholding: unchanged by the answer', [a.totalAnnualTax, a.totalNetAnnualIncome], [b.totalAnnualTax, b.totalNetAnnualIncome]);
            assert('no per-source surcharge on either job', a.totalAnnualTax, b.totalAnnualTax);
            const ts = { financialYear: null, includeMedicareLevy: false };
            const est = estimateAnnualTax(130000, [{ min: 0, max: Infinity, rate: 0 }], { ...ts, hasPrivateHospitalCover: false }) - estimateAnnualTax(130000, [{ min: 0, max: Infinity, rate: 0 }], ts);
            assert('the estimate helper shows the same surcharge', r2(est), 1612.5);
        },
    },
    {
        name: 'DB17.7 a single job of A$105,500 answered No: the deduction keeps it under the cliff everywhere',
        fn(assert) {
            const owed = annualOwed({ taxableIncome: 105500, date: TODAY, privateCover: false });
            assert('104,500 is at or under 105,000: no surcharge', [owed.taxableIncome, owed.mls], [104500, 0]);
            const a = calculateTotals(household([105500], false), { today: TODAY });
            const b = calculateTotals(household([105500]), { today: TODAY });
            assert('screens agree: same year-end tax with or without the answer', a._annualTaxOwed, b._annualTaxOwed);
            assert('take-home unchanged', [a.totalAnnualTax, a.totalNetAnnualIncome], [b.totalAnnualTax, b.totalNetAnnualIncome]);
            const brackets = [{ min: 0, max: Infinity, rate: 0 }];
            const ts = { financialYear: null, includeMedicareLevy: false };
            assert('estimate helper: none either', estimateAnnualTax(105500, brackets, { ...ts, hasPrivateHospitalCover: false }), estimateAnnualTax(105500, brackets, ts));
            assert('A$106,001 is over: 1%', annualOwed({ taxableIncome: 106001, date: TODAY, privateCover: false }).mls, 1050.01);
        },
    },
    {
        name: 'DB17.8 HELP for the year agrees across the readout, Future and What If under the deduction',
        fn(assert) {
            const d = buildSampleHousehold(TODAY).data;
            d.taxSettings = { financialYear: null, includeMedicareLevy: true, includeHelpInEstimate: true, helpBalance: 24600 };
            const totals = calculateTotals(JSON.parse(JSON.stringify(d)), { today: TODAY });
            const gross = d.incomeSources[0].grossAnnual; // 85,000, an employee
            const readout = annualOwed({ taxableIncome: gross, date: TODAY, hasStudyDebt: true, labourIncome: gross }).help;
            const future = helpPayoffModel(JSON.parse(JSON.stringify(d)), new Date(TODAY)).annualRepayment;
            const whatIf = yearInputs(JSON.parse(JSON.stringify(d)), TODAY).helpRepayment;
            // 84,000 after the deduction: 15% over the A$69,528 threshold.
            assert('readout HELP is worked on the income after the deduction', r2(readout), 2170.8);
            assert('Future and What If equal the readout', [r2(future), r2(whatIf)], [2170.8, 2170.8]);
            assert('the year-estimate uses the same figure', totals._annualTaxOwed > 0, true);
            // A self-employed primary gets no deduction (the helper that Future and What If share).
            const tb = getTaxYear();
            assert('self-employed income: no deduction in the shared HELP helper', helpRepaymentForYear(gross, tb, { labourIncome: 0 }), calculateHelpRepayment(gross, tb.help));
            assert('employee income: the deduction applies', helpRepaymentForYear(gross, tb, { labourIncome: gross }) < calculateHelpRepayment(gross, tb.help), true);
        },
    },
    {
        name: 'DB17.9 labour income only: no standard deduction for self-employed income, and the offset follows the labour tax',
        fn(assert) {
            const se = annualOwed({ taxableIncome: 50000, date: TODAY, labourIncome: 0 });
            assert('self-employed only: nothing taken off', [se.deduction, se.deductionKind, se.taxableIncome], [0, 'none', 50000]);
            const part = annualOwed({ taxableIncome: 50000, date: TODAY, labourIncome: 400 });
            assert('the lesser of A$1,000 and the labour income', [part.deduction, part.deductionKind], [400, 'standard']);
            const own = annualOwed({ taxableIncome: 50000, date: TODAY, labourIncome: 0, workDeductions: 1500 });
            assert('own work deductions still count against any income', [own.deduction, own.deductionKind], [1500, 'work']);
            const e = annualEstimateForSources([{ paySchedule: 'fortnightly', grossAnnual: 600, incomeType: 'selfEmployed' }, { paySchedule: 'fortnightly', grossAnnual: 400 }], TODAY);
            assert('sources: only the employee income counts for the deduction', [e.taxableIncome, e.owed.deduction], [999.96, 399.88]);
            try {
                const y = JSON.parse(JSON.stringify(taxFile.years['2026-27']));
                y.incomeTax.workingAustraliansTaxOffset = JSON.parse(JSON.stringify(taxFile.years['2027-28'].incomeTax.workingAustraliansTaxOffset));
                const offset = y.incomeTax.workingAustraliansTaxOffset;
                for (const g of Object.values(y)) for (const f of Object.values(g)) { f.fy = '2027-28'; if (f !== offset && f.appliesFrom) f.appliesFrom = `${+f.appliesFrom.slice(0, 4) + 1}${f.appliesFrom.slice(4)}`; }
                setReferenceTaxTables(tablesFromReference({ '2027-28': y }).tables);
                assert('offset: employee income gets it', annualOwed({ taxableIncome: 30000, date: '2027-10-01' }).wato, 250);
                assert('offset: self-employed income only gets none', annualOwed({ taxableIncome: 30000, date: '2027-10-01', labourIncome: 0 }).wato, 0);
            } finally { setReferenceTaxTables({}); }
        },
    },
    {
        name: 'DB17.10 surcharge tiers are optional: a complete 2027-28 with none is still built, with the offset',
        fn(assert) {
            const y = JSON.parse(JSON.stringify(taxFile.years['2026-27']));
            y.incomeTax.workingAustraliansTaxOffset = JSON.parse(JSON.stringify(taxFile.years['2027-28'].incomeTax.workingAustraliansTaxOffset));
            const offset = y.incomeTax.workingAustraliansTaxOffset;
            for (const g of Object.values(y)) for (const f of Object.values(g)) { f.fy = '2027-28'; if (f !== offset && f.appliesFrom) f.appliesFrom = `${+f.appliesFrom.slice(0, 4) + 1}${f.appliesFrom.slice(4)}`; }
            delete y.mls;
            const built = tablesFromReference({ '2027-28': y });
            assert('built without surcharge tiers', Object.keys(built.tables), ['2027-28']);
            assert('carries the offset and no surcharge', [built.tables['2027-28'].wato, 'mls' in built.tables['2027-28']], [{ max: 250 }, false]);
            const soft = JSON.parse(JSON.stringify(y));
            soft.mls = JSON.parse(JSON.stringify(taxFile.years['2026-27'].mls));
            for (const f of Object.values(soft.mls)) { f.fy = '2027-28'; f.appliesFrom = '2027-07-01'; f.status = 'announced'; }
            assert('announced tiers are left out, the year is still used', Object.keys(tablesFromReference({ '2027-28': soft }).tables), ['2027-28']);
            try {
                setReferenceTaxTables(built.tables);
                const o = annualOwed({ taxableIncome: 150000, date: '2027-10-01', privateCover: false });
                assert('no figures, no surcharge, offset year used', [o.fy, o.stale, o.mls], ['2027-28', false, 0]);
            } finally { setReferenceTaxTables({}); }
        },
    },
];
