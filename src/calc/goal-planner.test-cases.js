// Test cases for the "goal-planner" group (registered in src/test-registry.js).
// F4.1 to F4.6 and U38 (plan section 12). Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    planGoals, requiredPerPay, mixCutCents, tickSplurgeItems, grossForExtraNet, earningsThreeWays,
    explainRequired, planGoalsFromData, goalFundTicks, LOCKED_ROLES, ADJUSTMENT_KINDS, audCents,
} from './goal-planner.js';
import { netPerPayCents } from './plan.js';
import { resolveAt } from './scenario.js';
import { addDays } from './pay-cycle.js';
import { buildSampleHousehold } from '../state/sample-data.js';

const TODAY = '2026-11-13';
// Pay dates every 14 days from 2026-11-14 (the mock's cadence).
const PAYS = Array.from({ length: 40 }, (_, i) => addDays('2026-11-14', i * 14));
// The mock's fixture, worked back from its figures: funds counted A$1,543.84 (the mock's Smile balance);
// Concert 1,000 (13 Dec), bike 2,500 (1 Mar), Japan 7,500 (29 May).
//   Japan: (1000 + 2500 + 7500) - 1543.84 = 9,456.16 over 15 pays = 630.4107, rounded up 630.42
//   Bike:  (1000 + 2500) - 1543.84 = 1,956.16 over 8 pays = 244.52 exactly
//   Concert: 1000 - 1543.84 < 0, so 0
//   Gap = 630.42 - Smile 343.84 = 286.58
const GOALS = () => [
    { id: 'japan', name: 'Japan', costCents: 750000, due: '2027-05-29' },
    { id: 'concert', name: 'Concert', costCents: 100000, due: '2026-12-13' },
    { id: 'bike', name: 'New bike', costCents: 250000, due: '2027-03-01' },
];
const MOCK = (extra = {}) => ({
    goals: GOALS(), fundsCountedCents: 154384, payDates: PAYS, today: TODAY,
    smilePerPayCents: 34384, splurgePerPayCents: 34384, unallocatedPerPayCents: 0, ...extra,
});

const sample = () => buildSampleHousehold(TODAY).data;
const OPTION_IDS = ['cut', 'mix', 'earn'];

export const GOAL_PLANNER_TEST_CASES = [
    {
        name: 'F4.1 mock goals reproduce on the fixture inputs',
        fn(assert) {
            const r = requiredPerPay(MOCK());
            const by = Object.fromEntries(r.perGoal.map((g) => [g.id, g]));
            assert('pays to 13 Dec = 3', by.concert.pays, 3);
            assert('pays to 1 Mar = 8', by.bike.pays, 8);
            assert('pays to 29 May = 15', by.japan.pays, 15);
            assert('Japan still needed 9,456.16', by.japan.needCents, 945616);
            assert('required 630.42 (Japan binds)', r.requiredPerPayCents, 63042);
            assert('binding goal is Japan', r.bindingGoalId, 'japan');
            assert('bike 244.52', by.bike.perPayCents, 24452);
            assert('concert 0', by.concert.perPayCents, 0);
            assert('goals come back in due-date order', r.perGoal.map((g) => g.id), ['concert', 'bike', 'japan']);

            const p = planGoals(MOCK());
            assert('gap 286.58', p.gapCents, 28658);
            assert('Cut: Splurge left 57.26', p.options.cut.splurgeLeftCents, 5726);
            // Plan says 83.4%; 286.58 / 343.84 = 0.83347, which is 83.3% to one place (plan figure is wrong, reported).
            assert('Cut: 83.3% cut (plan said 83.4)', p.options.cut.cutPct, 83.3);
            assert('Cut: nothing earned', p.options.cut.earnedCents, 0);
            assert('Mix: cut 120.00', p.options.mix.cutCents, 12000);
            assert('Mix: earned 166.58', p.options.mix.earnedCents, 16658);
            assert('Earn it: earned 286.58', p.options.earn.earnedCents, 28658);
            assert('Earn it: Splurge untouched', p.options.earn.splurgeLeftCents, 34384);
            assert('mix cut of 280 is 100', mixCutCents(28000), 10000);
            assert('mix cut of 343.84 is 120', mixCutCents(34384), 12000);
            assert('rounds up to the cent (not down)', requiredPerPay({ goals: [{ id: 'g', costCents: 1000, due: '2026-12-13' }], payDates: PAYS, today: TODAY }).requiredPerPayCents, 334);
            assert('no pay before the deadline is impossible, not infinite', requiredPerPay({ goals: [{ id: 'g', costCents: 1000, due: '2026-11-13' }], payDates: PAYS, today: TODAY }).impossible, ['g']);
            assert('a goal with no due date has no deadline', requiredPerPay({ goals: [{ id: 'u', costCents: 5000, due: null }], payDates: PAYS, today: TODAY }).undated, ['u']);
        },
    },
    {
        name: 'F4.2 order and locks',
        fn(assert) {
            const p = planGoals(MOCK({ unallocatedPerPayCents: 10000 }));
            assert('unallocated closes the gap first', p.unallocatedUsedCents, 10000);
            assert('the gap left is 186.58', p.gapAfterUnallocatedCents, 18658);
            assert('Cut: Splurge cut only the rest', p.options.cut.cutCents, 18658);
            assert('Cut: Splurge left 343.84 - 186.58', p.options.cut.splurgeLeftCents, 34384 - 18658);
            assert('Mix with unallocated: earned is gap less cut', p.options.mix.earnedCents, 18658 - 12000);
            const big = planGoals(MOCK({ smilePerPayCents: 0, splurgePerPayCents: 10000 }));
            assert('a Splurge cut never exceeds Splurge', big.options.cut.cutCents, 10000);
            assert('the rest of the gap is earned', big.options.cut.earnedCents, 63042 - 10000);
            assert('Splurge left is 0', big.options.cut.splurgeLeftCents, 0);
            const covered = planGoals(MOCK({ unallocatedPerPayCents: 99999 }));
            assert('unallocated money covering the gap leaves Splurge alone', [covered.options.cut.cutCents, covered.options.mix.cutCents, covered.options.earn.earnedCents], [0, 0, 0]);
            assert('unallocated used is capped at the gap', covered.unallocatedUsedCents, 28658);
            const none = planGoals(MOCK({ smilePerPayCents: 99999 }));
            assert('Smile already enough: no gap and on track', [none.gapCents, none.onTrack], [0, true]);

            // FT-R-35: across all three options and many inputs no adjustment targets Daily or Fire extinguisher.
            let bad = 0; let seen = 0;
            for (const smile of [0, 20000, 34384, 70000]) {
                for (const splurge of [0, 10000, 34384, 90000]) {
                    for (const un of [0, 5000, 100000]) {
                        const q = planGoals(MOCK({ smilePerPayCents: smile, splurgePerPayCents: splurge, unallocatedPerPayCents: un }));
                        for (const id of OPTION_IDS) {
                            const o = q.options[id];
                            seen += 1;
                            for (const a of o.adjustments) if (!ADJUSTMENT_KINDS.includes(a.kind) || LOCKED_ROLES.includes(a.kind)) bad += 1;
                            const total = o.adjustments.reduce((s, a) => s + a.cents, 0);
                            if (total !== q.gapCents) bad += 1; // the options close the whole gap, nothing else moves
                            if (o.cutCents > splurge || o.splurgeLeftCents < 0) bad += 1;
                        }
                    }
                }
            }
            assert('no adjustment targets Daily or Fire (all three options, 48 inputs)', [bad, seen], [0, 144]);
            assert('the locked roles are Daily and Fire extinguisher', LOCKED_ROLES, ['daily', 'fire']);

            // The data wrapper never changes the data it reads, so Daily and Fire stay where they were.
            const d = sample();
            const before = JSON.stringify(d.allocation);
            planGoalsFromData(d, { today: TODAY });
            assert('planning leaves the split alone', JSON.stringify(d.allocation), before);

            const t = tickSplurgeItems([{ id: 'a', perPayCents: 3000 }, { id: 'b', perPayCents: 9000 }, { id: 'c', perPayCents: 5000 }], 11000);
            assert('items tick biggest first until covered', t.items.map((i) => [i.id, i.ticked]), [['b', true], ['c', true], ['a', false]]);
            assert('ticked total and over', [t.tickedCents, t.overCents, t.shortCents], [14000, 3000, 0]);
            assert('a cut bigger than all items leaves a shortfall', tickSplurgeItems([{ id: 'a', perPayCents: 3000 }], 5000).shortCents, 2000);
        },
    },
    {
        name: 'F4.3 three ways, bisection through the engine (U38)',
        fn(assert) {
            const d = sample();
            const base = netPerPayCents(d);
            // U38: a resolved clone gives the same net per pay and reflects HELP.
            assert('netPerPayCents on a resolved clone equals the data', netPerPayCents(resolveAt(d, [], TODAY)), base);
            let prev = -Infinity; let monotone = true; let maxJump = 0; let last = null;
            for (let g = 30000; g <= 220000; g += 250) {
                const c = JSON.parse(JSON.stringify(d));
                c.incomeSources[0].grossAnnual = g;
                const n = netPerPayCents(c);
                if (n < prev) monotone = false;
                if (last !== null) maxJump = Math.max(maxJump, n - last);
                prev = n; last = n;
            }
            assert('net per pay never falls as gross rises (HELP is a kink, not a drop)', monotone, true);
            assert('and has no jump (an A$250 raise adds under A$250 a fortnight)', maxJump < 25000, true);

            let ok = true; let near = true; let lastGross = 0; let increasing = true;
            for (const extra of [2500, 5000, 10000, 20000, 40000]) {
                const g = grossForExtraNet(d, extra);
                const c = JSON.parse(JSON.stringify(d));
                c.incomeSources[0].grossAnnual += g.extraGrossAnnualCents / 100;
                const got = netPerPayCents(c) - base;
                if (Math.abs(got - extra) > 1) near = false;
                if (got < extra) ok = false;
                const less = JSON.parse(JSON.stringify(d));
                less.incomeSources[0].grossAnnual += (g.extraGrossAnnualCents - 1) / 100;
                if (netPerPayCents(less) - base >= extra) ok = false; // smallest gross that reaches it
                if (g.extraGrossAnnualCents <= lastGross) increasing = false;
                lastGross = g.extraGrossAnnualCents;
            }
            assert('netPerPay(gross) = take-home to the cent, and it is the smallest gross', [near, ok], [true, true]);
            assert('more take-home needs more gross (monotone)', increasing, true);

            const t = earningsThreeWays(d, 10000);
            assert('take-home per pay is the input', t.takeHomePerPayCents, 10000);
            assert('before tax per pay is above take-home (tax, Medicare and HELP bite)', t.beforeTaxPerPayCents > 10000, true);
            assert('before tax per pay is not the mock\'s flat 0.68 (it is above 1 / 0.68)', t.beforeTaxPerPayCents > Math.round(10000 / 0.68), true);
            assert('per year is per pay times 26 to within rounding', Math.abs(t.beforeTaxPerYearCents - t.beforeTaxPerPayCents * 26) <= 13, true);
            const rate = d.incomeSources[0].hourlyRate || (85000 / (76 * 26));
            assert('hours = before tax per pay / rate', t.hoursPerPay, Math.round((t.beforeTaxPerPayCents / 100 / rate) * 10) / 10);
            assert('a zero gap gives zeros', earningsThreeWays(d, 0).beforeTaxPerPayCents, 0);
            assert('a non-positive figure has no bisection answer', grossForExtraNet(d, 0), null);
            assert('the data is not changed', netPerPayCents(d), base);
            const flat = JSON.parse(JSON.stringify(d));
            flat.incomeSources[0].invoicedPayPostTax = 2000; flat.incomeSources[0].taxRemoved = 500;
            assert('a payslip override pins the net: not reachable, no throw', grossForExtraNet(flat, 5000), null);
        },
    },
    {
        name: 'F4.4 big-cut note',
        fn(assert) {
            const at50 = planGoals(MOCK({ smilePerPayCents: 63042 - 20000, splurgePerPayCents: 40000 }));
            assert('a cut of exactly 50% of Splurge shows no note', [at50.options.cut.cutCents, at50.options.cut.bigCut], [20000, false]);
            const over = planGoals(MOCK({ smilePerPayCents: 63042 - 20001, splurgePerPayCents: 40000 }));
            assert('a cut above 50% shows the note', [over.options.cut.cutCents, over.options.cut.bigCut], [20001, true]);
            assert('Earn it never shows it', over.options.earn.bigCut, false);
            assert('the mock gap (83.3%) shows it', planGoals(MOCK()).options.cut.bigCut, true);
        },
    },
    {
        name: 'F4.5 explain',
        fn(assert) {
            const p = planGoals(MOCK());
            const e = explainRequired(p);
            assert('the lines carry the same cents as the result', e.lines, ['A$9,456.16 still needed', '15 pays', 'A$630.42 a pay']);
            assert('and the figures behind them', [e.needCents, e.pays, e.perPayCents], [945616, 15, p.requiredPerPayCents]);
            assert('the goal explained is the binding one', e.goalName, 'Japan');
            assert('nothing required gives no lines', explainRequired(planGoals(MOCK({ fundsCountedCents: 99999999 }))).lines, []);
            assert('money format', audCents(63042), 'A$630.42');
        },
    },
    {
        name: 'F4.6 counting towards goals (FT-R-93)',
        fn(assert) {
            const d = sample();
            const smile = d.allocation.find((r) => r.role === 'smile');
            const mojo = d.allocation.find((r) => r.role === 'mojo');
            for (const g of d.bucketGoals) if (g.name === 'Flights') g.due = addDays(TODAY, 120);
            const none = planGoalsFromData(d, { today: TODAY });
            const smileOnly = none.counted.map((c) => c.id);
            assert('the Smile balance always counts', smileOnly, [smile.id]);
            assert('Mojo does not count unless ticked', none.counted.some((c) => c.id === mojo.id), false);
            const tick = [{ id: 'c1', kind: 'goalFund', target: { collection: 'allocation', id: mojo.id }, field: null, op: 'set', value: true, from: null, until: null }];
            const withMojo = planGoalsFromData(d, { today: TODAY, changes: tick });
            assert('a goalFund tick counts Mojo', withMojo.counted.map((c) => c.id).sort(), [mojo.id, smile.id].sort());
            assert('funds rise by the Mojo balance (A$1,400)', withMojo.fundsCountedCents - none.fundsCountedCents, 140000);
            const dated = [{ ...tick[0], from: '2027-01-01' }];
            assert('a tick not yet active does not count', goalFundTicks(dated, TODAY), []);
            assert('a tick active on the date does', goalFundTicks(dated, '2027-02-01').length, 1);
            assert('a ticked-off change (value false) does not count', goalFundTicks([{ ...tick[0], value: false }], TODAY), []);
            const asset = [{ id: 'c2', kind: 'goalFund', target: { collection: 'assets', id: 'a-savings-account' }, op: 'set', value: true }];
            d.assets[0].id = 'a-savings-account';
            const withAsset = planGoalsFromData(d, { today: TODAY, changes: asset });
            assert('a ticked asset counts its balance (A$16,500)', withAsset.fundsCountedCents - none.fundsCountedCents, 1650000);
            assert('the leaf goals are the planner\'s goals (Flights, Accommodation)', none.perGoal.length + none.undated.length, 2);
            assert('the planner reads the Smile per pay from the buckets', none.smilePerPayCents > 0, true);
            assert('Splurge items are listed biggest first', none.splurgeItems.every((x, i, a) => i === 0 || a[i - 1].perPayCents >= x.perPayCents), true);
        },
    },
    {
        name: 'F4.7 scenario overrides go through the injected resolver',
        fn(assert) {
            const d = sample();
            for (const g of d.bucketGoals) if (g.name === 'Flights') g.due = addDays(TODAY, 120);
            let call = null;
            const resolve = (data, changes, date) => {
                call = { changes, date };
                const c = JSON.parse(JSON.stringify(data));
                c.bucketGoals.find((g) => g.name === 'Flights').cost = 5000;
                return c;
            };
            const base = planGoalsFromData(d, { today: TODAY });
            const over = planGoalsFromData(d, { today: TODAY, changes: [{ id: 'x', kind: 'goal' }], resolve });
            assert('the resolver gets the changes and the date', call, { changes: [{ id: 'x', kind: 'goal' }], date: TODAY });
            const need = (r) => r.perGoal.find((g) => g.name === 'Flights').cumulativeCostCents;
            assert('the scenario cost is used (A$5,000, not A$1,800)', [need(base), need(over)], [180000, 500000]);
            assert('the input data is not changed', d.bucketGoals.find((g) => g.name === 'Flights').cost, 1800);
        },
    },
];
