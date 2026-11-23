// Test cases for the "fi" group (registered in src/test-registry.js).
// F3.1 to F3.9 (plan section 12). Shape: { name, fn(assert) }, assert(label, actual, expected).
// The dagger figures were each recomputed independently (docs/phase1-changelog/F3.md).

import {
    runPlan, projectNetWorth, yearsToFI, fiNumber, fiNumberFrom, goingTowardsPerYear, savingsRatePlanned, fiAge, fiSummary,
} from './fi.js';
import { explainFi } from './fi-explain.js';
import { calculateYearsToFI, calculateTotals } from './calculations.js';
import { buildSampleHousehold } from '../state/sample-data.js';
import { migrateAssetDebtDetail } from '../state/asset-debt-migration.js';
import { getBuckets } from '../state/saving-model.js';
import { FI_SCOPE_TEST_CASES } from '../state/asset-types.test-cases.js';
import { LOAN_LINK_TEST_CASES } from '../state/loan-link.test-cases.js';

const TODAY = '2026-11-21';
const near = (a, b, eps) => Math.abs(a - b) < eps;
const r2 = (x) => Math.round(x * 100) / 100;

/** A constant per-year input for the plain engine. */
const flat = (o) => () => ({ dateIso: TODAY, inflationPct: 0, expectedReturnPct: 7, fiNumber: 0, fireYear: 0, superYear: 0, ...o });
const sample = () => {
    const d = buildSampleHousehold(TODAY).data;
    migrateAssetDebtDetail(d);
    return d;
};
const withCar = (d) => {
    const c = structuredClone(d);
    c.assets.push({ id: 'a-car', name: 'Car', balance: 20000, kind: 'depreciating', kindSuggested: false,
        depreciation: { method: 'declining', ratePct: 25 } });
    return c;
};

export const FI_TEST_CASES = [
    ...FI_SCOPE_TEST_CASES, // DB10: FT-R-125 scope, bridge, one net worth, multiple
    ...LOAN_LINK_TEST_CASES, // DB11: FT-R-128 held-out count, loan links, couples
    {
        name: 'F3.1 regression: one invested pool and flows equal calculateYearsToFI to 1e-9',
        fn(assert) {
            const cases = [
                { A: 10000, P: 0, T: 100000, r: 7, label: '10,000 a year, 0 assets, 100,000, 7%' },
                { A: 10000, P: 0, T: 100000, r: 0, label: 'zero return' },
                { A: 12000, P: 30000, T: 400000, r: 4.5, label: 'opening pool' },
                { A: 5000, P: 80000, T: 90000, r: 7, label: 'inside the first year' },
            ];
            for (const c of cases) {
                const run = runPlan({ openInvested: c.P }, flat({ expectedReturnPct: c.r, fiNumber: c.T, fireYear: c.A }), { years: 0 });
                const old = calculateYearsToFI(c.A, c.P, c.T, c.r);
                assert(`${c.label}: engine equals the old formula`, near(run.yearsToFI, old, 1e-9), true);
            }
            assert('7.84273 for the existing case', Math.round(calculateYearsToFI(10000, 0, 100000, 7) * 100000) / 100000, 7.84273);
            const reached = runPlan({ openInvested: 100000 }, flat({ fiNumber: 100000, fireYear: 10000 }), { years: 0 });
            assert('reached gives 0', reached.yearsToFI, 0);
            const none = runPlan({ openInvested: 50000 }, flat({ fiNumber: 100000, fireYear: 0 }), { years: 0 });
            assert('no savings gives Infinity', none.yearsToFI, Infinity);
        },
    },
    {
        name: 'F3.2 mock path: 106,650 and 27,720 a year at 4.5% real (dagger figures)',
        fn(assert) {
            // Independent arithmetic: 106,650 x 1.045^n + 27,720 x (1.045^n - 1) / 0.045 = 506,253.35 / 1,126,825.14 / 2,090,554.15.
            const number = fiNumberFrom({ dailyPerPay: 2063.06, splurgePerPay: 343.84 });
            const run = runPlan({ openInvested: 106650 }, flat({ expectedReturnPct: 7, inflationPct: 2.5, fiNumber: number, fireYear: 27720 }), { years: 30 });
            assert('10 years', r2(run.path[10].fiNetWorth), 506253.35);
            assert('20 years', r2(run.path[20].fiNetWorth), 1126825.14);
            assert('30 years', r2(run.path[30].fiNetWorth), 2090554.15);
            assert('years to FI 25.09', r2(run.yearsToFI), 25.09);
            assert('the FI number the mock uses', number, 1564485);
        },
    },
    {
        name: 'F3.3 FI number is arithmetic from the pools; Smile does not move it',
        fn(assert) {
            assert('given pools: (2,063.06 + 343.84) x 26 x 25', fiNumberFrom({ dailyPerPay: 2063.06, splurgePerPay: 343.84, cyclesPerYear: 26, multiple: 25 }), 1564485);
            const d = sample();
            const b = getBuckets(d, TODAY).filter((x) => !x.parentId);
            const pp = (role) => b.find((x) => x.role === role).perPayCents;
            assert('sample Daily and Splurge per pay (E1 T1 amounts)', [pp('daily'), pp('splurge')], [207337, 36791]);
            assert('sample number (2,073.37 + 367.91) x 26 x 25', fiNumber(d, { today: TODAY }), 1586832);
            const base = projectNetWorth(d, { today: TODAY, years: 10 });
            // Smile and Fire swap 3 points: the number is unchanged (Smile not counted).
            const moved = structuredClone(d);
            moved.allocation.find((r) => r.role === 'smile').percentage += 3;
            moved.allocation.find((r) => r.role === 'fire').percentage -= 3;
            assert('Smile and Fire swap: the number is unchanged', fiNumber(moved, { today: TODAY }), base.fiNumber);
            // Smile taken from Daily and given back to Daily-equivalent: Smile vs Mojo (both not spending, Mojo adds no flow).
            const sm2 = structuredClone(d);
            const mojo = sm2.allocation.find((r) => r.role === 'mojo');
            const smile = sm2.allocation.find((r) => r.role === 'smile');
            mojo.percentage += 1; smile.percentage -= 1;
            const p2 = projectNetWorth(sm2, { today: TODAY, years: 10 });
            assert('a changed Smile share leaves the path unchanged', p2.path.map((p) => r2(p.fiNetWorth)), base.path.map((p) => r2(p.fiNetWorth)));
            assert('and the number', p2.fiNumber, base.fiNumber);
            const sp = structuredClone(d);
            sp.allocation.find((r) => r.role === 'splurge').percentage += 2;
            sp.allocation.find((r) => r.role === 'fire').percentage -= 2;
            assert('a changed Splurge changes the number', fiNumber(sp, { today: TODAY }) > fiNumber(d, { today: TODAY }), true);
        },
    },
    {
        name: 'F3.4 depreciating assets count in net worth and not in the FI total (FT-R-90)',
        fn(assert) {
            const d = sample();
            const a = projectNetWorth(d, { today: TODAY, years: 3 });
            const b = projectNetWorth(withCar(d), { today: TODAY, years: 3 });
            assert('net worth moves by +20,000', r2(b.path[0].netWorth - a.path[0].netWorth), 20000);
            assert('fiNetWorth moves by 0', r2(b.path[0].fiNetWorth - a.path[0].fiNetWorth), 0);
            assert('later years: fiNetWorth still equal', r2(b.path[3].fiNetWorth - a.path[3].fiNetWorth), 0);
            assert('the car loses value (25% a year)', r2(b.path[1].depreciating), 15000);
            assert('listed as things that lose value', fiSummary(withCar(d), { today: TODAY }).notes.includes('losesValue'), true);
            assert('years to FI are the same with the car', yearsToFI(withCar(d), { today: TODAY }), yearsToFI(d, { today: TODAY }));
        },
    },
    {
        name: 'F3.5 debt first: Fire clears the debt, the rest of the year goes to the invested pool',
        fn(assert) {
            const debt = { id: 'l-x', name: 'Card', balance: 1000, interestRate: 12, compounding: 'monthly', repaymentFrequency: 'monthly', minRepayment: null };
            const run = runPlan({ debts: [debt], sinks: [{ type: 'debt', id: 'l-x' }] }, flat({ fireYear: 10000, fiNumber: 1e9 }), { years: 1, untilFI: false });
            const y1 = run.path[1];
            const owed = 1126.84; // F2 schedule: interest rounded to the cent each month. The closed form 1000 x 1.01^12 is 1,126.825 (a cent-level rounding difference, as in F2's 4,927.00 vs 4,927.01).
            assert('schedule within 1.5 cents of the closed form', near(owed, 1000 * Math.pow(1.01, 12), 0.015), true);
            assert('the debt is 0 by the end of year 1', y1.debts, 0);
            assert('the invested pool holds the rest of the year', r2(y1.invested), r2(10000 - owed));
            assert('fiNetWorth is Fire money less the interest cost', r2(y1.fiNetWorth), r2(10000 - owed));
            const none = runPlan({ debts: [debt], sinks: [] }, flat({ fireYear: 0, fiNumber: 1e9 }), { years: 1, untilFI: false });
            assert('without Fire the debt grows by its interest', r2(none.path[1].debts), r2(owed));
            const withMin = runPlan({ debts: [{ ...debt, balance: 10000, minRepayment: 500 }], sinks: [] }, flat({ fireYear: 0, fiNumber: 1e9 }), { years: 1, untilFI: false });
            assert('a minimum repayment moves it (F2: 4,927 on 10,000 at 500 a month)', Math.round(withMin.path[1].debts), 4927);
        },
    },
    {
        name: 'F3.6 not reachable: flows at or below 0 with net worth under the number give Infinity',
        fn(assert) {
            const none = runPlan({ openInvested: 10000 }, flat({ fiNumber: 500000, fireYear: 0, superYear: 0 }), { years: 5 });
            assert('zero flows', none.yearsToFI, Infinity);
            const neg = runPlan({ openInvested: 10000 }, flat({ fiNumber: 500000, fireYear: -100 }), { years: 5 });
            assert('negative flows', neg.yearsToFI, Infinity);
            const slow = runPlan({ openInvested: 0 }, flat({ fiNumber: 1e12, fireYear: 10, expectedReturnPct: 0 }), { years: 5 });
            assert('too slow to ever arrive (past 100 years)', slow.yearsToFI, Infinity);
            const d = sample();
            d.allocation.find((r) => r.role === 'fire').percentage = 0;
            d.incomeSources.forEach((s) => { s.superPct = 0; });
            assert('the sample with no Fire and no super', yearsToFI(d, { today: TODAY }), Infinity);
        },
    },
    {
        name: 'F3.7 scenario overlay on a resolver fixture: a dated income change counts only through its years',
        fn(assert) {
            const d = sample();
            // Fixture resolver: a change {from, until, gross} sets Alex's gross on the dates it is active.
            const resolve = (data, changes, date) => {
                const out = structuredClone(data);
                for (const c of changes) {
                    if ((!c.from || c.from <= date) && (!c.until || date < c.until)) out.incomeSources[0].grossAnnual = c.gross;
                }
                return out;
            };
            const base = projectNetWorth(d, { today: TODAY, years: 40 });
            const forever = projectNetWorth(d, { today: TODAY, years: 40, resolve, changes: [{ from: TODAY, gross: 140000 }] });
            const three = projectNetWorth(d, { today: TODAY, years: 40, resolve, changes: [{ from: TODAY, until: '2029-11-21', gross: 140000 }] });
            const late = projectNetWorth(d, { today: TODAY, years: 40, resolve, changes: [{ from: '2090-01-01', gross: 140000 }] });
            assert('a rise for ever reaches FI sooner', forever.yearsToFI < base.yearsToFI, true);
            assert('a rise for three years sits between the two', three.yearsToFI < base.yearsToFI && three.yearsToFI > forever.yearsToFI, true);
            assert('a change that starts after the crossing changes nothing', late.yearsToFI, base.yearsToFI);
            assert('the first three years follow the rise', [1, 2, 3].map((k) => r2(three.path[k].fiNetWorth)), [1, 2, 3].map((k) => r2(forever.path[k].fiNetWorth)));
            assert('after the end the Fire flow is the base household\'s', r2(three.path[5].fire), r2(base.path[5].fire));
            assert('while active the Fire flow is higher', forever.path[5].fire > base.path[5].fire, true);
            assert('no changes: the resolver is not needed', yearsToFI(d, { today: TODAY }), base.yearsToFI);
        },
    },
    {
        name: 'F3.8 HELP is a debt in the Future figures, with its own line, and not in the Fire list',
        fn(assert) {
            const d = sample();
            const totals = calculateTotals(structuredClone(d), { today: new Date(2026, 10, 21) });
            const assetsLess = d.assets.reduce((s, a) => s + a.balance, 0) - d.liabilities.reduce((s, a) => s + a.balance, 0);
            assert('assets less liabilities 106,650; calculateTotals now also takes HELP off: 82,050 (FT-R-125)', [r2(assetsLess), r2(totals.netWorth)], [106650, 82050]);
            const p = projectNetWorth(d, { today: TODAY, years: 1 });
            assert('net worth 82,050 (106,650 less HELP)', r2(p.path[0].netWorth), 82050);
            // DB11, FT-R-128 1: the sample's three assets have only suggested kinds, so none counts toward FI until confirmed (was 82,050).
            assert('fiNetWorth: the suggested assets are held out, the debts and HELP still count (FT-R-128 1)', r2(p.path[0].fiNetWorth), -37650);
            assert('the sample holds out its three assets', p.path[0].heldOut.count, 3);
            const confirmedSample = structuredClone(d);
            confirmedSample.assets.forEach((a) => { a.kindSuggested = false; });
            assert('confirmed, the same assets give the old 82,050 (no depreciating asset)', r2(projectNetWorth(confirmedSample, { today: TODAY, years: 1 }).path[0].fiNetWorth), 82050);
            assert('HELP is 24,600', p.path[0].help, 24600);
            const sum = fiSummary(d, { today: TODAY });
            assert('includes HELP note', sum.notes.includes('includesHelp'), true);
            const lines = explainFi(d, { today: TODAY, summary: sum });
            assert('the "Includes HELP" line is present', lines.some((l) => l.id === 'help' && /Includes HELP/.test(l.text) && /24,600/.test(l.text)), true);
            assert('E2 Fire target list has no HELP row', d.savingModel.fire.targets.some((x) => /help/i.test(`${x.id} ${x.label} ${x.type}`)), false);
            const noHelp = structuredClone(d);
            noHelp.taxSettings.helpBalance = 0;
            assert('without HELP the lines do not mention it', explainFi(noHelp, { today: TODAY }).some((l) => l.id === 'help'), false);
        },
    },
    {
        name: 'F3.9 super counts toward FI; the preservation note shows under 60 only',
        fn(assert) {
            const d = sample();
            const going = goingTowardsPerYear(d, { today: TODAY });
            assert('super a year is 12% of 85,000', going.super, 10200);
            assert('Fire a year is the bucket x 26', going.fire, r2(getBuckets(d, TODAY).find((b) => b.role === 'fire').perPayCents * 26 / 100));
            assert('total is the two', going.total, r2(going.fire + going.super));
            const noSuper = structuredClone(d);
            noSuper.incomeSources.forEach((s) => { s.superPct = null; });
            assert('a null superPct adds 0', goingTowardsPerYear(noSuper, { today: TODAY }).super, 0);
            assert('super speeds the path', yearsToFI(d, { today: TODAY }) < yearsToFI(noSuper, { today: TODAY }), true);
            const p = projectNetWorth(d, { today: TODAY, years: 1 });
            assert('year 1 carries the super flow', p.path[1].super, 10200);
            assert('no birth year, no FI age', fiAge(d, 20, { today: TODAY }), null);
            const young = { people: [{ name: 'Alex', birthYear: 1990 }] };
            const a = fiAge(young, 20.3, { today: TODAY });
            assert('age at FI: 2026 - 1990 + 21 = 57', a.ages, [{ name: 'Alex', age: 57 }]);
            assert('under 60 gives the note', a.superNote, true);
            assert('60 or over: no note', fiAge(young, 23.5, { today: TODAY }).superNote, false);
            assert('never reached: no age', fiAge(young, Infinity, { today: TODAY }), null);
        },
    },
    {
        name: 'F3.10 sample household: figures, no mutation, tolerant of empty data',
        fn(assert) {
            const d = sample();
            const snap = JSON.stringify(d);
            const s = fiSummary(d, { today: TODAY });
            assert('input data is not mutated', JSON.stringify(d), snap);
            assert('FI number', s.fiNumber, 1586832);
            assert('years to FI is a finite number', Number.isFinite(s.yearsToFI) && s.yearsToFI > 0, true);
            assert('savings rate planned is a percent', s.savingsRate > 0 && s.savingsRate < 100, true);
            assert('path is non-decreasing in fiNetWorth', s.path.every((p, i) => i === 0 || p.fiNetWorth >= s.path[i - 1].fiNetWorth), true);
            assert('explain lines have real text', explainFi(d, { today: TODAY, summary: s }).every((l) => l.text && !/^f\./.test(l.text)), true);
            assert('savingsRatePlanned equals the summary', savingsRatePlanned(d, { today: TODAY }), s.savingsRate);
            const empty = projectNetWorth({}, { today: TODAY, years: 3 });
            assert('empty data does not throw', Number.isFinite(empty.path[0].netWorth), true);
        },
    },
];
