// Test cases for the "withholding" group (registered in src/test-registry.js).
// C2: the withholding engine. Shape: { name, fn(assert) }, assert(label, actual, expected).
// The A$3,057.69 fortnightly pay is a fixture only. Expected figures were worked by hand
// from the Schedule 1 and 8 coefficients (P0.5), not by running the engine.

import { weeklyEquivalent, withholdingForPay, expectedPay, roundHalfUp, weeklyFromRows, isExactHalf } from './withholding.js';
import { TAX_TABLES } from './tax-tables/index.js';

const A = '2025-26';
const B = '2026-27';
const fixture = { gross: 3057.69, cycle: 'fortnightly' };
const pick = (r) => [r.tax, r.help, r.total];

export const WITHHOLDING_TEST_CASES = [
    { name: 'W1-W3 weekly equivalent', fn(assert) {
        assert('W1 fortnightly 3,057.69', weeklyEquivalent(3057.69, 'fortnightly'), 1528.99);
        assert('W2 monthly 6,000', weeklyEquivalent(6000, 'monthly'), 1384.99);
        assert('W3 fortnightly 2,310', weeklyEquivalent(2310, 'fortnightly'), 1155.99);
        assert('weekly drops the cents', weeklyEquivalent(1000.5, 'weekly'), 1000.99);
        assert('monthly ending 33c gets 1c first', weeklyEquivalent(1300.33, 'monthly'), 300.99);
        assert('quarterly divides by 13', weeklyEquivalent(13000, 'quarterly'), 1000.99);
    } },
    { name: 'W4 round half up', fn(assert) {
        assert('312.50 rounds up', roundHalfUp(312.50), 313);
        assert('312.4999 rounds down', roundHalfUp(312.4999), 312);
        const rows = [{ lt: Infinity, a: 0.5, b: 0 }];
        assert('integer engine: .51 goes up', weeklyFromRows([{ lt: Infinity, a: 1, b: 0.49 }], 100), 1);
        assert('integer engine: exactly .50 up', weeklyFromRows([{ lt: Infinity, a: 1, b: 0.50 }], 100), 1); // 1.00 - 0.50 = exactly .50
        assert('integer engine: just under .50 down', weeklyFromRows([{ lt: Infinity, a: 1, b: 0.5001 }], 100), 0);
        assert('exact half flag', [isExactHalf([{ lt: Infinity, a: 1, b: 0.5 }], 100), isExactHalf(rows, 99)], [true, false]);
    } },
    { name: 'D1-D6 diagnosed payslip 2025-26', fn(assert) {
        const r = withholdingForPay({ ...fixture, fy: A, hasStudyDebt: true });
        assert('D1 Scale 2 tax A$626 a fortnight', r.tax, 626);
        assert('D2 study-loan component A$72', r.help, 72);
        assert('D3 component sum A$698', r.total, 698);
        assert('D4 combined-scale check A$698', r.totalCombined, 698);
        assert('x and scale', [r.x, r.scale], [1528.99, 2]);
        const n = withholdingForPay({ ...fixture, fy: A });
        assert('D5 no HELP', pick(n), [626, 0, 626]);
        assert('D6 gap to the payslip is the HELP part', 698 - n.total, 72);
        assert('whole dollars', [r.tax, r.help, r.total, r.totalCombined].every(Number.isInteger), true);
    } },
    { name: 'Y1-Y5 the 2026-27 tables', fn(assert) {
        const r = withholdingForPay({ ...fixture, fy: B, hasStudyDebt: true });
        assert('Y1 Scale 2 A$616', r.tax, 616);
        assert('Y2 study-loan A$58', r.help, 58);
        assert('Y3 component sum A$674', r.total, 674);
        assert('Y4 combined A$672', r.totalCombined, 672);
        assert('Y5 the two differ by A$2, within the match tolerance', Math.abs(r.total - r.totalCombined) <= 2, true);
        assert('a date picks the year', withholdingForPay({ ...fixture, fy: '2026-08-14', hasStudyDebt: true }).total, 674);
    } },
    { name: 'O1-O2 weekly 1,000 and below the nil band', fn(assert) {
        const w = { gross: 1000, cycle: 'weekly' };
        assert('O1 Scale 1 2025-26', withholdingForPay({ ...w, fy: A, claimsTaxFree: false }).total, 255);
        assert('O1 Scale 1 2026-27', withholdingForPay({ ...w, fy: B, claimsTaxFree: false }).total, 249);
        assert('O2 Scale 2 2025-26', pick(withholdingForPay({ ...w, fy: A, hasStudyDebt: true })), [143, 0, 143]);
        assert('O2 Scale 2 2026-27', pick(withholdingForPay({ ...w, fy: B, hasStudyDebt: true })), [138, 0, 138]);
        assert('O4 weekly 300 is nil', withholdingForPay({ gross: 300, cycle: 'weekly', fy: A, hasStudyDebt: true }).total, 0);
    } },
    { name: 'O3 monthly 6,000', fn(assert) {
        const m = { gross: 6000, cycle: 'monthly', hasStudyDebt: true };
        assert('2025-26', pick(withholdingForPay({ ...m, fy: A })), [1157, 61, 1218]);
        assert('2026-27', pick(withholdingForPay({ ...m, fy: B })), [1131, 30, 1161]);
    } },
    { name: 'O5-O6 set hours and salary', fn(assert) {
        const hrs = { paySchedule: 'fortnightly', hourlyRate: 30, hoursPerCycle: 77 };
        const a = expectedPay(hrs, A);
        const b = expectedPay(hrs, B);
        assert('O5 gross 2,310', a.gross, 2310);
        assert('O5 2025-26', a.tax, 386);
        assert('O5 2026-27', b.tax, 376);
        const sal = { paySchedule: 'fortnightly', grossAnnual: 80000, hasStudyDebt: true };
        assert('O6 salary 80,000 2025-26', [expectedPay(sal, A).gross, expectedPay(sal, A).tax, expectedPay(sal, A).help], [3076.92, 632, 76]);
        assert('O6 salary 80,000 2026-27', [expectedPay(sal, B).tax, expectedPay(sal, B).help], [622, 60]);
    } },
    { name: 'O7 extra per pay added after rounding', fn(assert) {
        const r = withholdingForPay({ ...fixture, fy: A, hasStudyDebt: true, extraPerPay: 20 });
        assert('total and combined', [r.tax, r.help, r.total, r.totalCombined], [626, 72, 718, 718]);
    } },
    { name: 'O8 integer engine equals a float reference', fn(assert) {
        // Weekly x = 0.99 to 4000.99 (4,001 values), every table of both years. Exact .50
        // cases are left out of the comparison (W4 covers them) and counted.
        let checked = 0;
        let exact = 0;
        const diffs = [];
        for (const fy of [A, B]) {
            const t = TAX_TABLES[fy];
            const sets = { scale1: t.scale1, scale2: t.scale2, stslTft: t.stsl.tftClaimed, stslNo: t.stsl.notClaimed };
            for (const [name, rows] of Object.entries(sets)) {
                for (let whole = 0; whole <= 4000; whole++) {
                    const xc = whole * 100 + 99;
                    if (isExactHalf(rows, xc)) { exact++; continue; }
                    const x = xc / 100;
                    const r = rows.find((row) => x < row.lt);
                    const ref = Math.max(0, roundHalfUp(r.a * x - r.b));
                    checked++;
                    if (weeklyFromRows(rows, xc) !== ref) diffs.push(`${fy} ${name} ${x}`);
                }
            }
        }
        assert('no differences', diffs.slice(0, 5), []);
        assert('values checked', checked + exact, 4001 * 2 * 4);
        assert('most values compared', checked > 31000, true);
    } },
];
