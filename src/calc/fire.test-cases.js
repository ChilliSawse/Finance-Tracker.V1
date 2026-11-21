// Test cases for the "fire" group (registered in src/test-registry.js).
// E2: pure maths in src/calc/fire.js and src/calc/pay-roll.js (plan section 12, T10 to T14 and T18).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    defaultFireTargets, fireStatus, payoffPays, applyPay, rebaseTargets,
    mojoSteps, mojoLivingCosts, MOJO_STARTER_CENTS,
} from './fire.js';
import { runPayRoll } from './pay-roll.js';

const LIABS = () => [
    { id: 'L-car', name: 'Car loan', balance: 11200, interestRate: 7.9 },
    { id: 'L-card', name: 'Credit card', balance: 1850, interestRate: 20.99 },
];
const PAY = 66362; // Fire share of the sample net, cents
const ids = (ts) => ts.map((t) => t.id);
const NO_MOJO_CAP = { balanceCents: 0, targetCents: null };
// Round half up, the same rule the engine uses for interest.
const interest = (rem, ratePct, pays) => Math.floor((2 * rem * Math.round(ratePct * 100) + 10000 * pays) / (2 * 10000 * pays));

// Sample essentials: 2,072 a fortnight, 26 pays a year.
const LIVING = () => mojoLivingCosts({ essentialPerPayCents: 207200, cyclesPerYear: 26 });

export const FIRE_TEST_CASES = [
    { name: 'T10 debt payoff', fn(assert) {
        assert('card clears in 3 pays', payoffPays(185000, 20.99, PAY, 26), 3);
        assert('continuous 2.83', Math.round(payoffPays(185000, 20.99, PAY, 26, { continuous: true }) * 100) / 100, 2.83);
        assert('payment equal to interest', payoffPays(185000, 20.99, 1493, 26), Infinity);
        assert('payment below interest', payoffPays(185000, 20.99, 500, 26), Infinity);
        assert('0% rate is ceil(balance / pay)', payoffPays(185000, 0, PAY, 26), 3);
        assert('nothing owing', payoffPays(0, 20.99, PAY, 26), 0);
        assert('no payment', payoffPays(185000, 0, 0, 26), Infinity);
    } },
    { name: 'T11 fire progression per pay', fn(assert) {
        let targets = defaultFireTargets(LIABS());
        const liabs = LIABS();
        assert('order', ids(targets), ['debt:L-card', 'debt:L-car', 'mojo', 'home', 'super']);
        assert('active at start', fireStatus(targets, liabs, NO_MOJO_CAP).activeId, 'debt:L-card');
        const rem = (id) => targets.find((t) => t.id === id).remainingCents;
        const seen = [];
        const active = [];
        let firstInterest = null;
        for (let i = 0; i < 4; i++) {
            const r = applyPay({ targets, liabilities: liabs, mojo: NO_MOJO_CAP, paysPerYear: 26, cents: PAY, date: '2026-11-20' });
            if (i === 0) firstInterest = r.interestCents;
            targets = r.targets;
            Object.entries(r.liabilityBalances).forEach(([id, c]) => { liabs.find((l) => l.id === id).balance = c / 100; });
            seen.push([rem('debt:L-card'), rem('debt:L-car')]);
            active.push(fireStatus(targets, liabs, NO_MOJO_CAP).activeId);
        }
        assert('card after pays 1 to 4', seen.map((s) => s[0]), [120132, 54740, 0, 0]);
        assert('car after pays 3 and 4', [seen[2][1], seen[3][1]], [1108820, 1045827]);
        assert('target moves on pay 3 with no input', active, ['debt:L-card', 'debt:L-card', 'debt:L-car', 'debt:L-car']);
        assert('pay 1 interest', firstInterest, 1494);
        assert('interest rule is round(rem x r) per pay', interest(185000, 20.99, 26), 1494);
    } },
    { name: 'T11 carry and done date', fn(assert) {
        const t0 = defaultFireTargets(LIABS());
        const liabs = LIABS();
        const p = (ts, d) => {
            const r = applyPay({ targets: ts, liabilities: liabs, mojo: NO_MOJO_CAP, paysPerYear: 26, cents: PAY, date: d });
            Object.entries(r.liabilityBalances).forEach(([id, c]) => { liabs.find((l) => l.id === id).balance = c / 100; });
            return r;
        };
        const r3 = p(p(p(t0, '1').targets, '2').targets, '2026-12-04');
        assert('carry applied to the car loan', r3.applications.map((a) => [a.targetId, a.cents]), [['debt:L-card', 55182], ['debt:L-car', 11180]]);
        assert('card done on that date', r3.targets[0].doneOn, '2026-12-04');
        assert('inputs untouched', [t0[0].remainingCents, t0[0].doneOn], [185000, undefined]);
    } },
    { name: 'T12 skip and reorder', fn(assert) {
        const mojoOpen = { balanceCents: 0, targetCents: 1346800 };
        const none = defaultFireTargets([]);
        assert('no debts: Mojo active', fireStatus(none, [], mojoOpen).activeId, 'mojo');
        const full = { balanceCents: 1346800, targetCents: 1346800 };
        const st = fireStatus(none, [], full);
        assert('Mojo done, Home skipped (no deposit goal), Super active', [st.targets[0].state, st.targets[1].state, st.activeId], ['done', 'skipped', 'super']);
        const allSkip = none.map((t) => ({ ...t, skip: true }));
        const free = fireStatus(allSkip, [], mojoOpen);
        assert('everything skipped is free', [free.free, free.activeId], [true, null]);
        const debts = defaultFireTargets(LIABS());
        const reordered = [debts[2], debts[0], debts[1], debts[3], debts[4]];
        const rs = fireStatus(reordered, LIABS(), mojoOpen);
        assert('Mojo above debts is active', rs.activeId, 'mojo');
        assert('debt remaining unchanged', reordered.slice(1, 3).map((t) => t.remainingCents), [185000, 1120000]);
        const gone = fireStatus(debts, [LIABS()[0]], mojoOpen);
        assert('deleted liability auto-skipped', [gone.targets[0].state, gone.activeId], ['skipped', 'debt:L-car']);
        const clear = defaultFireTargets([{ id: 'x', name: 'Paid', balance: 0, interestRate: 5 }]);
        assert('zero balance debt not listed', ids(clear), ['mojo', 'home', 'super']);
        const withGoal = none.map((t) => (t.type === 'home' ? { ...t, goalCents: 5000000 } : t));
        assert('home with a goal is active after Mojo', fireStatus(withGoal, [], full).activeId, 'home');
    } },
    { name: 'T12 Mojo under A$2,000 note (FT-R-82)', fn(assert) {
        const ts = defaultFireTargets([]);
        const note = (bal) => fireStatus(ts, [], { balanceCents: bal, targetCents: 1346800 }).note;
        assert('under starter', note(150000), 'mojo-under-starter');
        assert('starter exactly', note(MOJO_STARTER_CENTS), null);
        const skipped = ts.map((t) => ({ ...t, skip: t.type === 'mojo' }));
        assert('skipped Mojo gives no note', fireStatus(skipped, [], { balanceCents: 0, targetCents: 1346800 }).note, null);
        assert('debts come before Mojo', ids(defaultFireTargets(LIABS())).indexOf('mojo'), 2);
        assert('tie on balance: higher rate first', ids(defaultFireTargets([
            { id: 'a', balance: 500, interestRate: 5 }, { id: 'b', balance: 500, interestRate: 20 }])).slice(0, 2), ['debt:b', 'debt:a']);
        assert('no HELP row (FT-R-91)', ids(defaultFireTargets(LIABS())).some((i) => /help/i.test(i)), false);
    } },
    { name: 'T13 re-base on balance edit', fn(assert) {
        const ts = defaultFireTargets(LIABS());
        const edited = LIABS(); edited[1].balance = 900;
        const r = rebaseTargets(ts, edited);
        assert('remaining 90,000', r[0].remainingCents, 90000);
        assert('start unchanged when lower', r[0].startCents, 185000);
        assert('seen updated', r[0].balanceSeenCents, 90000);
        const up = LIABS(); up[1].balance = 2500;
        const r2 = rebaseTargets(ts, up);
        assert('start raised when higher', [r2[0].remainingCents, r2[0].startCents], [250000, 250000]);
        assert('no edit changes nothing', rebaseTargets(ts, LIABS()), ts);
        const paid = applyPay({ targets: ts, liabilities: edited, mojo: NO_MOJO_CAP, paysPerYear: 26, cents: PAY, date: 'd' });
        assert('a roll starts from the edited balance', paid.targets[0].remainingCents, 90000 + interest(90000, 20.99, 26) - PAY);
    } },
    { name: 'T14 Mojo ladder', fn(assert) {
        const living = LIVING();
        assert('planned monthly', [living.basis, living.monthlyCents], ['planned', 448933]);
        const mojo = { starter: 200000, months: 3, steps: [{ id: 'c1', kind: 'custom', amount: 500000 }] };
        const m0 = mojoSteps(mojo, living, 0);
        assert('steps', m0.steps.map((s) => [s.kind, s.amountCents]), [['starter', 200000], ['custom', 500000], ['months', 1346800]]);
        assert('top step is the target', m0.targetCents, 1346800);
        const m1 = mojoSteps(mojo, living, 240000);
        assert('balance 2,400: step 5,000 at 48%', [m1.active.amountCents, m1.progressPct, m1.complete], [500000, 48, false]);
        const m2 = mojoSteps(mojo, living, 1346800);
        assert('13,468 complete', [m2.complete, m2.active, m2.progressPct], [true, null, 100]);
        assert('months 4', mojoSteps({ ...mojo, months: 4 }, living, 0).targetCents, 1795733);
        const fall = mojoLivingCosts({ essentialPerPayCents: 207200, cyclesPerYear: 26, actualMonthlyCents: [400000], basis: 'actual' });
        assert('actual with under 2 months falls back', [fall.basis, fall.monthlyCents, fall.fellBack], ['planned', 448933, true]);
        const act = mojoLivingCosts({ essentialPerPayCents: 207200, cyclesPerYear: 26, actualMonthlyCents: [400000, 420000, 440000], basis: 'actual' });
        assert('actual 4,000 / 4,200 / 4,400', [act.basis, act.monthlyCents, mojoSteps(mojo, act, 0).targetCents], ['actual', 420000, 1260000]);
        const auto = mojoLivingCosts({ essentialPerPayCents: 207200, cyclesPerYear: 26, actualMonthlyCents: [1, 400000, 420000, 440000, 460000], basis: 'auto' });
        assert('auto uses the last 3 months', [auto.basis, auto.monthlyCents], ['actual', 440000]);
        const planned = mojoLivingCosts({ essentialPerPayCents: 207200, cyclesPerYear: 26, actualMonthlyCents: [400000, 420000], basis: 'planned' });
        assert('planned basis ignores actuals', planned.basis, 'planned');
        // Fire 663.62 a pay from 0 reaches the starter in 4 pays.
        let ts = defaultFireTargets([]);
        let bal = 0, n = 0;
        while (bal < 200000 && n < 20) {
            const r = applyPay({ targets: ts, liabilities: [], mojo: { balanceCents: bal, targetCents: 1346800 }, paysPerYear: 26, cents: PAY, date: 'd' });
            bal += r.mojoCreditCents; ts = r.targets; n++;
        }
        assert('starter in 4 pays', n, 4);
    } },
    { name: 'T14 Mojo is capped at its top step and overflow carries', fn(assert) {
        const ts = defaultFireTargets([]).map((t) => (t.type === 'home' ? { ...t, goalCents: 100000 } : t));
        const r = applyPay({ targets: ts, liabilities: [], mojo: { balanceCents: 1346000, targetCents: 1346800 }, paysPerYear: 26, cents: PAY, date: 'd' });
        assert('Mojo takes only its room', r.mojoCreditCents, 800);
        assert('rest goes to Home', r.applications.map((a) => [a.targetId, a.cents]), [['mojo', 800], ['home', PAY - 800]]);
        assert('home saved', r.targets.find((t) => t.id === 'home').savedCents, PAY - 800);
    } },
    { name: 'T18 pay roll', fn(assert) {
        const base = () => ({
            incomeSources: [{ paySchedule: 'fortnightly', payAnchor: '2026-11-06' }], primaryIncomeIndex: 0,
            allocation: [
                { id: 'daily', role: 'daily', percentage: 60, currentBalance: 0 },
                { id: 'splurge', role: 'splurge', percentage: 10, currentBalance: 0 },
                { id: 'smile', role: 'smile', percentage: 10, currentBalance: 1200 },
                { id: 'fire', role: 'fire', percentage: 20, currentBalance: 8000 },
                { id: 'mojo', role: 'mojo', percentage: 0, currentBalance: 0 },
            ],
            bucketGoals: [],
            liabilities: LIABS(),
            savingModel: { id: 'bucket-method', mojo: { starter: 200000, months: 3 },
                fire: { targets: defaultFireTargets(LIABS()) }, movements: [],
                autoCredit: { on: true, rolledThrough: '2026-11-06' } },
        });
        const opts = { netCents: 343843 };
        const lib = (d, id) => d.liabilities.find((l) => l.id === id).balance;
        const d0 = base();
        const snap = JSON.stringify(d0);
        const r = runPayRoll(d0, '2026-12-18', opts);
        assert('three credits', r.paysApplied, 3);
        assert('marker moves to the last pay date', r.data.savingModel.autoCredit.rolledThrough, '2026-12-18');
        assert('input not mutated', JSON.stringify(d0), snap);
        assert('smile credited 3 x 343.84 (10% of 3,438.43)', r.data.allocation.find((a) => a.id === 'smile').currentBalance, (120000 + 3 * 34384) / 100);
        assert('card cleared', lib(r.data, 'L-card'), 0);
        assert('car loan received the carry (Fire is 20% = 687.69 a pay here)', lib(r.data, 'L-car'), 11015.4);
        assert('movements recorded', r.data.savingModel.movements.length >= 6, true);
        const again = runPayRoll(r.data, '2026-12-18', opts);
        assert('second run same day changes nothing', [again.changed, again.data === r.data], [false, true]);
        assert('later in the same cycle also nothing', runPayRoll(r.data, '2026-12-30', opts).changed, false);
        const off = base(); off.savingModel.autoCredit.on = false;
        const ro = runPayRoll(off, '2026-12-18', opts);
        assert('off changes nothing', [ro.changed, ro.data.savingModel.autoCredit.rolledThrough], [false, '2026-11-06']);
        const first = base(); first.savingModel.autoCredit.rolledThrough = null;
        const rf = runPayRoll(first, '2026-12-10', opts);
        assert('first enable sets the marker, no retro credit', [rf.data.savingModel.autoCredit.rolledThrough, rf.paysApplied, rf.data.allocation[2].currentBalance, rf.changed], ['2026-12-04', 0, 1200, true]);
        const old = base(); old.savingModel.autoCredit.rolledThrough = '2024-01-05';
        const r60 = runPayRoll(old, '2026-12-18', opts);
        assert('long catch-up capped at 52', [r60.paysApplied, r60.skipped > 0], [52, true]);
        assert('marker still reaches the latest pay', r60.data.savingModel.autoCredit.rolledThrough, '2026-12-18');
        const mv = runPayRoll(base(), '2026-12-18', { ...opts, maxMovements: 4 });
        assert('movements capped', mv.data.savingModel.movements.length, 4);
        // A balance edit between two runs survives.
        const step1 = runPayRoll(base(), '2026-11-20', opts).data;
        step1.liabilities.find((l) => l.id === 'L-card').balance = 900;
        const step2 = runPayRoll(step1, '2026-12-04', opts).data;
        assert('edited balance was the start of the next pay', lib(step2, 'L-card'), (90000 + interest(90000, 20.99, 26) - 68769) / 100);
        assert('no schedule means nothing to roll', runPayRoll({ ...base(), incomeSources: [] }, '2026-12-18', opts).changed, false);
        assert('no model means nothing to roll', runPayRoll({ allocation: [] }, '2026-12-18', opts).changed, false);
    } },
];
