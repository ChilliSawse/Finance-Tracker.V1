// Test cases for the "payslip-check" group (registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixtures are synthetic.
// P1 to P7 of FT-0001 C5; the 698 / 626 / 72 figures are the plan's reconciled values.

import { checkPayslip, toleranceFor } from './payslip-check.js';
import { withholdingForPay } from './withholding.js';
import { parsePayslipLines } from '../import/payslip.js';

const FY = '2025-26';
const slip = (tax, extra) => ({ tax, gross: 3057.69, date: '2026-03-10', ...extra });
const src = (w, extra) => ({
    paySchedule: 'fortnightly', grossAnnual: 79500,
    withholding: { claimsTaxFree: true, hasStudyDebt: true, medicareExemption: false, extraPerPay: 0, ...w },
    ...extra,
});

export const PAYSLIP_CHECK_TEST_CASES = [
    {
        name: 'P1 match: 626 + 72 = 698',
        fn(assert) {
            const r = checkPayslip(slip(698), src());
            assert('expected 626 + 72', r.expected, 698);
            assert('breakdown tax / help', [r.breakdown.tax, r.breakdown.help], [626, 72]);
            assert('matches', r.matches, true);
            assert('no cause needed', r.likelyCause, null);
        },
    },
    {
        name: 'P2 HELP missing in settings',
        fn(assert) {
            const r = checkPayslip(slip(698), src({ hasStudyDebt: false }));
            assert('does not match', r.matches, false);
            assert('diff 72', r.diff, 72);
            assert('cause help', r.likelyCause, 'help');
            assert('copy', r.message, 'The A$72 difference is about what HELP takes on your pay.');
            assert('one-tap fix turns HELP on', [r.fix.field, r.fix.value], ['hasStudyDebt', true]);
            assert('rerun with HELP on matches', checkPayslip(slip(698), src({ hasStudyDebt: true })).matches, true);
        },
    },
    {
        name: 'P3 HELP set but not withheld, and the ordering of causes',
        fn(assert) {
            const r = checkPayslip(slip(626), src());
            assert('diff -72', r.diff, -72);
            assert('cause no-help', r.likelyCause, 'no-help');
            assert('fix turns HELP off', [r.fix.field, r.fix.value], ['hasStudyDebt', false]);
            assert('help is tested before the threshold', checkPayslip(slip(698), src({ hasStudyDebt: false })).likelyCause, 'help');
        },
    },
    {
        name: 'P4 tax-free threshold: expected 848, diff -150',
        fn(assert) {
            const r = checkPayslip(slip(698), src({ claimsTaxFree: false, hasStudyDebt: false }));
            assert('expected 848', r.expected, 848);
            assert('diff -150', r.diff, -150);
            assert('cause tft-claimed', r.likelyCause, 'tft-claimed');
            assert('fix flips the threshold', [r.fix.field, r.fix.value], ['claimsTaxFree', true]);
            assert('and HELP on, since 626 alone is not 698', r.fix.also.map(f => [f.field, f.value]), [['hasStudyDebt', true]]);
        },
    },
    {
        name: 'P5 tolerance: one dollar per weekly step',
        fn(assert) {
            const e = withholdingForPay({ gross: 3057.69, cycle: 'fortnightly', fy: '2026-27', hasStudyDebt: true }).total;
            const s = (tax) => ({ tax, gross: 3057.69, date: '2026-11-10' });
            assert('2026-27 expected', e, 674);
            assert('672 vs 674 matches', checkPayslip(s(672), src()).matches, true);
            assert('676 vs 674 matches', checkPayslip(s(676), src()).matches, true);
            assert('670 vs 674 does not', checkPayslip(s(670), src()).matches, false);
            assert('tolerances', [toleranceFor('weekly'), toleranceFor('fortnightly'), toleranceFor('monthly')], [1, 2, 5]);
        },
    },
    {
        name: 'P5b monthly 2026-27: combined and component sum differ by A$5 and still match',
        fn(assert) {
            const w = withholdingForPay({ gross: 6101, cycle: 'monthly', fy: '2026-27', hasStudyDebt: true });
            assert('component vs combined differ by 5', w.total - w.totalCombined, 5);
            const s = src({}, { paySchedule: 'monthly', grossAnnual: 6101 * 12 });
            const r = checkPayslip({ tax: w.totalCombined, gross: 6101, date: '2026-11-10' }, s);
            assert('payslip at the combined figure matches the component sum', r.matches, true);
            assert('expected is the component sum', r.expected, w.total);
            assert('tolerance 5', r.tolerance, 5);
            assert('6 away does not', checkPayslip({ tax: w.total - 6, gross: 6101, date: '2026-11-10' }, s).matches, false);
        },
    },
    {
        name: 'P3b other causes: overtime, extra withholding, sacrifice, Medicare hint',
        fn(assert) {
            const ot = withholdingForPay({ gross: 3500, cycle: 'fortnightly', fy: FY, hasStudyDebt: true }).total;
            const r = checkPayslip({ tax: ot, gross: 3500, date: '2026-03-10' }, src());
            assert('overtime cause', r.likelyCause, 'overtime');
            assert('overtime fix proposes the payslip gross', [r.fix.action, r.fix.value], ['use-payslip-gross', 3500]);
            const x = checkPayslip(slip(698 + 25), src());
            assert('extra withholding cause', x.likelyCause, 'extra-withholding');
            assert('extra fix sets 25', x.fix.value, 25);
            assert('declared extra 20 matches 718', checkPayslip(slip(718), src({ extraPerPay: 20 })).matches, true);
            const ss = withholdingForPay({ gross: 3057.69 - 400, cycle: 'fortnightly', fy: FY, hasStudyDebt: true }).total;
            assert('salary sacrifice cause', checkPayslip(slip(ss), src()).likelyCause, 'salary-sacrifice');
            assert('Medicare hint', checkPayslip(slip(698 - 61), src()).likelyCause, 'medicare-exemption');
            assert('hint not offered once stored', checkPayslip(slip(698 - 61), src({ medicareExemption: true })).likelyCause !== 'medicare-exemption', true);
        },
    },
    {
        name: 'P6 fallback: nothing explains it',
        fn(assert) {
            const r = checkPayslip(slip(698 + 900), src());
            assert('no match', r.matches, false);
            assert('cause null', r.likelyCause, null);
            assert('use actuals', r.useActuals, true);
            assert('unexplained per pay', r.unexplainedPerPay, 900);
            const old = checkPayslip(slip(698, { date: '2025-09-23' }), src());
            assert('before 24 Sep 2025: payslip is the truth', [old.matches, old.payslipIsTruth, old.useActuals, old.likelyCause], [false, true, true, null]);
            assert('24 Sep is checked', checkPayslip(slip(698, { date: '2025-09-24' }), src()).payslipIsTruth, false);
            assert('year from the payslip date', checkPayslip(slip(698, { date: '2026-11-10' }), src()).expected, 674);
            const g = checkPayslip(slip(698, { gross: 3200 }), src());
            assert('different gross is proposed, never applied', [g.grossProposal.proposed, g.grossProposal.needsConfirm], [3200, true]);
            const bad = checkPayslip({ tax: NaN }, src());
            assert('unparsed tax claims nothing', [bad.matches, bad.grossProposal, bad.useActuals], [false, null, true]);
        },
    },
    {
        name: 'P7 parser reads a HELP / study loan row as help',
        fn(assert) {
            const base = ['Gross Earnings 3,057.69 36,692.28', 'PAYG Withholding 626.00 7,512.00', 'Net Pay 2,359.69 28,316.28'];
            const a = parsePayslipLines([...base, 'HELP 72.00 864.00']);
            assert('HELP row', a.help, 72);
            assert('other fields unchanged', [a.gross, a.tax, a.net], [3057.69, 626, 2359.69]);
            assert('study loan row', parsePayslipLines([...base, 'Study loan 72.00']).help, 72);
            assert('no row, no help', parsePayslipLines(base).help, null);
            assert('read gross is not flagged derived', a.grossDerived, false);
            assert('derived gross is flagged', parsePayslipLines(['Net Payment 1,000.00', 'Tax 250.00']).grossDerived, true);
        },
    },
];
