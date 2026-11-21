// Test cases for the "today" group (A6.1, registered in src/test-registry.js).
// A6.1: every figure on Today comes from todayModel() and the engine; none is typed in.
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixture: the Today mock's rows (fake data).

import { buildTodayModel } from '../state/today-model.js';
import { buildTodayHtml, skeletonHtml, needsPayDayNudge, savingsRateFigure, dayByDay } from './today.js';
import { formatCurrency } from '../utils.js';
import { getBuckets } from '../state/saving-model.js';
import { legacySampleFinanceData } from '../state/sample-data.js';
import { runMigrationChain } from '../state/migration-chain.js';

const ALLOC = [
    { id: 'daily', role: 'daily', name: 'Daily expenses', percentage: 60 }, { id: 'splurge', role: 'splurge', name: 'Splurge', percentage: 10 },
    { id: 'smile', role: 'smile', name: 'Smile', percentage: 10 }, { id: 'fire', role: 'fire', name: 'Fire extinguisher', percentage: 20 },
];
const CATS = [
    { id: 'groceries', essential: true }, { id: 'rent', essential: true }, { id: 'transport', essential: true },
    { id: 'health', essential: true }, { id: 'phone', essential: true }, { id: 'insurance', essential: true },
    { id: 'dining', essential: false }, { id: 'entertainment', essential: false },
    { id: 'subscriptions', essential: false }, { id: 'other', essential: false }, { id: 'income', essential: false },
];
const PLAN = [
    { id: 'ph', categoryId: 'phone', name: 'Phone', amount: 65, frequency: 'monthly', anchorDue: '2026-10-10', inTotals: false },
    { id: 'car', categoryId: 'insurance', name: 'Car insurance', amount: 128.4, frequency: 'monthly', anchorDue: '2026-10-12', inTotals: false },
];
const SOURCE = { incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: '2026-10-31', grossAnnual: 90000 };
const mkData = (over = {}) => ({
    dataVersion: 2, incomeSources: [SOURCE], primaryIncomeIndex: 0, allocation: ALLOC, categories: CATS, plan: PLAN, ...over,
});
const row = (date, categoryId, dollars, extra = {}) => ({ id: `${date}-${categoryId}-${dollars}`, date, categoryId, amountCents: Math.round(-dollars * 100), ...extra });
const PAY = { id: 'pay', date: '2026-10-31', categoryId: 'income', amountCents: 343843 };
const ROWS_A = [row('2026-11-01', 'groceries', 142.3), row('2026-11-02', 'rent', 1120), row('2026-11-03', 'dining', 18.5),
    row('2026-11-04', 'other', 32, { status: 'review' }), PAY];
const ROWS_B = [row('2026-11-02', 'groceries', 77.7), row('2026-11-03', 'entertainment', 9.1), PAY];
const TODAY = '2026-11-04';
const run = (data, rows, totals = { savingsRate: 12.4, netWorth: 50000 }) => {
    const model = buildTodayModel({ data, rows, today: TODAY });
    const ctx = { data, rows, cycleRows: rows.filter((r) => r.date >= model.cycle.start && r.date < model.cycle.end), totals };
    return { model, ctx, html: buildTodayHtml(model, ctx) };
};
const cur = (cents) => formatCurrency(cents / 100);
const MOCK_FIGURES = ['422', '2,063.06', '1,430.45', '210.39', '632.61', '106,650'];

export const TODAY_TEST_CASES = [
    {
        name: 'T2 Mojo tile reads the percent once (starter 1,400 of 2,000 is 70%, not 7000%)',
        fn(assert) {
            const mojoAlloc = [...ALLOC, { id: 'mojo', role: 'mojo', name: 'Mojo', percentage: 0, currentBalance: 1400 }];
            const data = mkData({ allocation: mojoAlloc, savingModel: { mojo: { starter: 200000, months: 0, steps: [] } } });
            const b = getBuckets(data).find((x) => x.role === 'mojo');
            assert('progress is a fraction', b.target.progress, 0.7);
            const { html } = run(data, ROWS_A);
            assert('tile says 70%', html.includes('starter · 70% paid'), true);
            assert('no 7000', html.includes('7000'), false);
            const over = mkData({ allocation: mojoAlloc.map((r) => (r.role === 'mojo' ? { ...r, currentBalance: 2500 } : r)), savingModel: { mojo: { starter: 200000, months: 0, steps: [] } } });
            const ho = run(over, ROWS_A).html;
            assert('over target never exceeds 100%', /\b(1\d\d|[2-9]\d\d)% paid/.test(ho), false);
        },
    },
    {
        name: 'A6.1 not ready shows a skeleton, never a figure',
        fn(assert) {
            const html = buildTodayHtml({ ready: false }, null);
            assert('skeleton markup', html === skeletonHtml(), true);
            assert('busy', html.includes('aria-busy="true"'), true);
            assert('no currency figure', /A\$\s?\d/.test(html), false);
        },
    },
    {
        name: 'A6.1 every figure is the model\'s',
        fn(assert) {
            const { model, html } = run(mkData(), ROWS_A);
            for (const [label, v] of [['spent', model.spentCents], ['bills', model.billsDueCents], ['left', model.leftCents],
                ['pool', model.poolCents], ['essential', model.essentialSoFarCents], ['non-essential', model.nonEssentialSoFarCents],
                ['per day', model.perDayCents]]) {
                assert(`${label} shown`, html.includes(cur(v)), true);
            }
            for (const lit of MOCK_FIGURES) assert(`mock figure ${lit} absent`, html.includes(lit), false);
            assert('no hand-drawn mock path', html.includes('M35.7,10.0'), false);
        },
    },
    {
        name: 'A6.1 a different model gives different figures',
        fn(assert) {
            const a = run(mkData(), ROWS_A);
            const b = run(mkData(), ROWS_B);
            assert('models differ', a.model.leftCents !== b.model.leftCents, true);
            assert('B shows its own spend', b.html.includes(cur(b.model.spentCents)), true);
            assert('A spend absent from B', b.html.includes(cur(a.model.spentCents)), false);
            assert('B has no review row', b.html.includes('to review'), false);
            assert('A has the review row', a.html.includes('1 imported transaction to review'), true);
        },
    },
    {
        name: 'T1 savings rate is planned until one complete cycle exists, then actual for the last completed cycle (FT-R-59)',
        fn(assert) {
            // Only the current cycle so far: planned, even with pay landed and spend (the old "92% actual").
            const young = run(mkData(), ROWS_A);
            assert('planned with only the current cycle', savingsRateFigure(young.model, young.ctx), { kind: 'planned', value: 12 });
            assert('planned label', young.html.includes('Savings rate (planned)'), true);
            assert('no actual label', young.html.includes('Savings rate (actual)'), false);
            // History starts mid previous cycle (not complete): still planned.
            const part = run(mkData(), [...ROWS_A, row('2026-10-20', 'dining', 10)]);
            assert('planned when history starts inside the previous cycle', savingsRateFigure(part.model, part.ctx).kind, 'planned');
            // A complete previous cycle 17 Oct to 30 Oct: income 3,000, spend 2,400, transfer 500 ignored.
            const prior = [{ id: 'p0', date: '2026-10-17', categoryId: 'income', amountCents: 300000 }, row('2026-10-18', 'rent', 1500),
                row('2026-10-25', 'groceries', 900), row('2026-10-26', 'transfer', 500)];
            const full = run(mkData(), [...prior, ...ROWS_A]);
            const f = savingsRateFigure(full.model, full.ctx);
            assert('actual for the last completed cycle', [f.kind, f.value, f.from, f.to], ['actual', 20, '2026-10-17', '2026-10-30']);
            assert('actual label', full.html.includes('Savings rate (actual)'), true);
            assert('caption carries the cycle dates', full.html.includes('last pay, 17 Oct to 30 Oct'), true);
            // The in-progress cycle's own pay and spend never move it.
            const more = run(mkData(), [...prior, ...ROWS_A, row('2026-11-04', 'dining', 900)]);
            assert('in-progress spend ignored', savingsRateFigure(more.model, more.ctx).value, 20);
            // Complete history but no income in the previous cycle: planned.
            const noInc = run(mkData(), [row('2026-10-18', 'rent', 100), ...ROWS_A]);
            assert('no income in the cycle gives planned', savingsRateFigure(noInc.model, noInc.ctx).kind, 'planned');
        },
    },
    {
        name: 'T1 month mode uses the last completed month',
        fn(assert) {
            const monthData = mkData({ incomeSources: [{ incomeType: 'variable', paySchedule: 'monthly', grossAnnual: 90000 }] });
            const rows = [{ id: 'i1', date: '2026-10-01', categoryId: 'income', amountCents: 400000 }, row('2026-10-10', 'rent', 1000),
                row('2026-10-20', 'groceries', 1000), { id: 'i2', date: '2026-11-02', categoryId: 'income', amountCents: 400000 }, row('2026-11-03', 'rent', 3500)];
            const r = run(monthData, rows);
            const f = savingsRateFigure(r.model, r.ctx);
            assert('mode is month', r.model.cycle.mode, 'month');
            assert('October, not November so far', [f.kind, f.value, f.from, f.to], ['actual', 50, '2026-10-01', '2026-10-31']);
            const early = run(monthData, rows.filter((x) => x.date >= '2026-10-02'));
            assert('history starting after 1 Oct gives planned', savingsRateFigure(early.model, early.ctx).kind, 'planned');
        },
    },
    {
        name: 'T1 sample household Fire and Smile tiles show the active target and goal progress',
        fn(assert) {
            const d = legacySampleFinanceData();
            const mem = new Map();
            const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
            const res = runMigrationChain(d, { raw: JSON.stringify(d), source: 'load', storage });
            assert('chain ran', res.aborted, false);
            const fire = getBuckets(d, '2026-11-21').find((b) => b.role === 'fire');
            assert('fire target carries saved and goal', [fire.target.savedCents, fire.target.goalCents], [800000, 1000000]);
            const { html } = run(d, ROWS_A);
            const tiles = html.split('class="tile ');
            const fireTile = tiles.find((x) => x.startsWith('b-fire'));
            const smileTile = tiles.find((x) => x.startsWith('b-smile'));
            assert('fire value 8,000', fireTile.includes(cur(800000)), true);
            assert('fire of goal 80%', fireTile.includes(`of ${formatCurrency(10000, undefined, 0)} · 80%`), true);
            assert('fire is not 0%', fireTile.includes('· 0%'), false);
            assert('smile value 1,200', smileTile.includes(cur(120000)), true);
            assert('smile of goal 30%', smileTile.includes(`of ${formatCurrency(4000, undefined, 0)} · 30%`), true);
        },
    },
    {
        name: 'A6.1 Fire now, Smile progress and after-this show only with data (FT-R-73 C2)',
        fn(assert) {
            const plain = run(mkData(), ROWS_A);
            assert('no Fire now', plain.html.includes('Now:'), false);
            assert('no after the next pay', plain.html.includes('after the next pay'), false);
            const withGoal = run(mkData({ allocation: ALLOC.map((a) => (a.id === 'smile' ? { ...a, savingsGoal: 4000, currentBalance: 1000 } : a)) }), ROWS_A);
            assert('smile progress', withGoal.html.includes('25%'), true);
            assert('after the next pay', withGoal.html.includes('after the next pay'), true);
        },
    },
    {
        name: 'A6.1 data is escaped',
        fn(assert) {
            const evil = [{ ...PLAN[0], name: '<img src=x onerror=alert(1)>' }, PLAN[1]];
            const { html } = run(mkData({ plan: evil }), ROWS_A);
            assert('no raw tag', html.includes('<img src=x'), false);
            assert('escaped text', html.includes('&lt;img src=x'), true);
        },
    },
    {
        name: 'A6.1 the Set your pay day nudge (FT-R-58)',
        fn(assert) {
            const src = { incomeType: 'salaried', paySchedule: 'fortnightly', grossAnnual: 90000 };
            assert('no anchor, no income row', needsPayDayNudge({ incomeSources: [src] }, [], TODAY), true);
            assert('anchor set', needsPayDayNudge({ incomeSources: [SOURCE] }, [], TODAY), false);
            assert('anchor inferable', needsPayDayNudge({ incomeSources: [src] }, [PAY], TODAY), false);
            assert('variable income', needsPayDayNudge({ incomeSources: [{ ...src, incomeType: 'variable' }] }, [], TODAY), false);
            assert('no source', needsPayDayNudge({ incomeSources: [] }, [], TODAY), false);
        },
    },
    {
        name: 'A6.1 day-by-day chart ends where the engine says',
        fn(assert) {
            const { model, ctx, html } = run(mkData(), ROWS_A);
            const s = dayByDay(model, ctx);
            assert('one point per day', s.days.length, 14);
            assert('first day', s.days[0], '2026-10-31');
            assert('today index', s.ti, 4);
            assert('line starts at the pool less day one', s.actual[0], s.pool - s.spent[0]);
            assert('projection end = left - pace x days after today', s.endValue, model.leftCents - s.pace * (model.cycle.daysLeft - 1));
            assert('accessible name', html.includes('aria-labelledby="h-trend t-desc"'), true);
            assert('data table', html.includes('<table class="today-sr">'), true);
            assert('table has a row per day', (html.match(/<th scope="row">/g) || []).length, 14);
        },
    },
];
