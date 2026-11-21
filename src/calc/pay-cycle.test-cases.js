// Test cases for the "pay-cycle" group (B1.1 to B1.8, B1.10; registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { getWeeklyAmount, getPayCyclesPerYear } from '../utils.js';
import { getCycle, payDatesBetween, nextPayDates, inferPayAnchor, billOccurrences, billStatus, leftThisPay } from './pay-cycle.js';
import { effectiveBucket, defaultBucketRole, SPENDABLE_POOL } from './plan.js';

const fort = { incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: '2026-10-31' };

export const PAY_CYCLE_TEST_CASES = [
    {
        name: 'B1.1 weekly maths',
        fn(assert) {
            assert('quarterly weekly', getWeeklyAmount(130, 'quarterly'), 10);
            assert('quarterly cycles', getPayCyclesPerYear('quarterly'), 4);
            assert('monthly unchanged', getWeeklyAmount(52, 'monthly'), 12);
        },
    },
    {
        name: 'B1.2 cycle',
        fn(assert) {
            const c = getCycle(fort, '2026-11-04');
            assert('start', c.start, '2026-10-31');
            assert('next pay', c.nextPay, '2026-11-14');
            assert('end is next pay', c.end, '2026-11-14');
            assert('days left', c.daysLeft, 10);
            assert('mode', c.mode, 'cycle');
            assert('cycles', c.cyclesPerYear, 26);
        },
    },
    {
        name: 'B1.3 pay day',
        fn(assert) {
            const c = getCycle(fort, '2026-11-14');
            assert('start today', c.start, '2026-11-14');
            assert('days left', c.daysLeft, 14);
            assert('anchor day itself', getCycle(fort, '2026-10-31').start, '2026-10-31');
            assert('before anchor', getCycle(fort, '2026-10-20').start, '2026-10-17');
        },
    },
    {
        name: 'B1.4 weekly and monthly',
        fn(assert) {
            const w = getCycle({ paySchedule: 'weekly', payAnchor: '2026-10-30' }, '2026-11-05');
            assert('weekly steps of 7', [w.start, w.nextPay], ['2026-10-30', '2026-11-06']);
            const m = { paySchedule: 'monthly', payAnchor: '2026-01-31' };
            const c = getCycle(m, '2026-11-15');
            assert('31st clamps in 30-day month start', c.start, '2026-10-31');
            assert('31st clamps next', c.nextPay, '2026-11-30');
            assert('day after clamp', getCycle(m, '2026-12-01').start, '2026-11-30');
            assert('feb clamp', getCycle(m, '2027-02-28').start, '2027-02-28');
        },
    },
    {
        name: 'B1.5 month mode',
        fn(assert) {
            const none = getCycle({ paySchedule: 'fortnightly', payAnchor: null }, '2026-11-04');
            assert('no anchor', [none.mode, none.start, none.end, none.nextPay, none.daysLeft], ['month', '2026-11-01', '2026-12-01', null, 27]);
            assert('variable', getCycle({ incomeType: 'variable', paySchedule: 'fortnightly', payAnchor: '2026-10-31' }, '2026-11-04').mode, 'month');
            assert('no source', getCycle(null, '2026-11-04').mode, 'month');
        },
    },
    {
        name: 'B1.6 occurrences',
        fn(assert) {
            assert('monthly no drift', billOccurrences({ anchorDue: '2026-01-31', frequency: 'monthly' }, '2026-02-01', '2026-03-31'), ['2026-02-28', '2026-03-31']);
            assert('quarterly', billOccurrences({ anchorDue: '2026-01-15', frequency: 'quarterly' }, '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
            assert('quarterly from 30th', billOccurrences({ anchorDue: '2026-11-30', frequency: 'quarterly' }, '2026-11-01', '2027-06-30'), ['2026-11-30', '2027-02-28', '2027-05-30']);
            assert('leap-day yearly', billOccurrences({ anchorDue: '2024-02-29', frequency: 'yearly' }, '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
            assert('before anchor none', billOccurrences({ anchorDue: '2026-06-01', frequency: 'monthly' }, '2026-01-01', '2026-05-31'), []);
            assert('no anchor none', billOccurrences({ frequency: 'monthly' }, '2026-01-01', '2026-05-31'), []);
        },
    },
    {
        name: 'B1.7 status',
        fn(assert) {
            const item = { id: 'p1', anchorDue: '2026-11-07', frequency: 'monthly' };
            assert('upcoming', billStatus(item, '2026-11-10', [], '2026-11-04'), 'Upcoming');
            assert('due', billStatus(item, '2026-11-04', [], '2026-11-04'), 'Due');
            assert('missed', billStatus(item, '2026-11-01', [], '2026-11-04'), 'Missed');
            assert('paid', billStatus(item, '2026-11-01', [{ billMatch: { planId: 'p1', dueDate: '2026-11-01' } }], '2026-11-04'), 'Paid');
            assert('other bill match ignored', billStatus(item, '2026-11-01', [{ billMatch: { planId: 'p2', dueDate: '2026-11-01' } }], '2026-11-04'), 'Missed');
            // 2026-11-07 is a Saturday: the date stays put.
            assert('weekend stays', billOccurrences(item, '2026-11-01', '2026-11-30'), ['2026-11-07']);
        },
    },
    {
        name: 'B1.8 every-N-days',
        fn(assert) {
            assert('14 days across month end', billOccurrences({ anchorDue: '2026-10-20', everyDays: 14 }, '2026-10-01', '2026-12-31'), ['2026-10-20', '2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15', '2026-12-29']);
            assert('window start mid', billOccurrences({ anchorDue: '2026-10-20', everyDays: 10 }, '2026-11-01', '2026-11-30'), ['2026-11-09', '2026-11-19', '2026-11-29']);
            assert('fortnightly', billOccurrences({ anchorDue: '2026-10-31', frequency: 'fortnightly' }, '2026-11-01', '2026-11-30'), ['2026-11-14', '2026-11-28']);
        },
    },
    {
        name: 'B1.10 pay anchor',
        fn(assert) {
            const rows = [
                { date: '2026-10-31', categoryId: 'income', amountCents: 250000 },
                { date: '2026-10-17', categoryId: 'income', amountCents: 250000 },
                { date: '2026-11-01', categoryId: 'groceries', amountCents: -5000 },
            ];
            const src = { paySchedule: 'fortnightly', incomeType: 'salaried' };
            const inferred = inferPayAnchor(rows, src, '2026-11-04');
            assert('latest within two cycles', inferred, { anchor: '2026-10-31', mode: 'cycle', nudge: false });
            assert('stale gives none and nudge', inferPayAnchor([{ date: '2026-09-30', categoryId: 'income', amountCents: 1 }], src, '2026-11-04'), { anchor: null, mode: 'month', nudge: true });
            assert('no rows nudge', inferPayAnchor([], src, '2026-11-04').nudge, true);
            assert('variable never infers', inferPayAnchor(rows, { paySchedule: 'fortnightly', incomeType: 'variable' }, '2026-11-04'), { anchor: null, mode: 'month', nudge: false });
            assert('debit ignored', inferPayAnchor([{ date: '2026-11-01', categoryId: 'income', amountCents: -100 }], src, '2026-11-04').anchor, null);
            assert('feeds getCycle', getCycle({ ...src, payAnchor: inferred.anchor }, '2026-11-04').nextPay, '2026-11-14');
        },
    },
    {
        name: 'B1.9a pay dates match getCycle steps',
        fn(assert) {
            const dates = payDatesBetween(fort, '2026-10-31', '2027-01-09');
            assert('fortnightly dates', dates, ['2026-10-31', '2026-11-14', '2026-11-28', '2026-12-12', '2026-12-26', '2027-01-09']);
            const steps = [];
            let c = getCycle(fort, '2026-10-31');
            while (c.start <= '2027-01-09') { steps.push(c.start); c = getCycle(fort, c.nextPay); }
            assert('same as steps', dates, steps);
            assert('next three', nextPayDates(fort, '2026-11-14', 3), ['2026-11-28', '2026-12-12', '2026-12-26']);
            const m = { paySchedule: 'monthly', payAnchor: '2026-01-31' };
            assert('monthly dates', payDatesBetween(m, '2026-10-01', '2027-02-28'), ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
            assert('month mode empty', payDatesBetween({ paySchedule: 'fortnightly' }, '2026-10-01', '2026-12-01'), []);
        },
    },
    ...bucketCases(),
];

// ---- B3b: effectiveBucket and per-bucket leftThisPay (mock fixture; the pool is given as an input) ----

const ALLOC = [
    { id: 'daily', role: 'daily', percentage: 60 }, { id: 'splurge', role: 'splurge', percentage: 10 },
    { id: 'smile', role: 'smile', percentage: 10 }, { id: 'fire', role: 'fire', percentage: 20 },
];
const CATS = [
    { id: 'groceries', essential: true }, { id: 'rent', essential: true }, { id: 'transport', essential: true },
    { id: 'health', essential: true }, { id: 'phone', essential: true }, { id: 'insurance', essential: true },
    { id: 'dining', essential: false }, { id: 'entertainment', essential: false },
    { id: 'subscriptions', essential: false }, { id: 'other', essential: false }, { id: 'income', essential: false },
];
const row = (date, categoryId, dollars, extra = {}) => ({ id: `${date}-${categoryId}-${dollars}`, date, categoryId, amountCents: Math.round(-dollars * 100), ...extra });
const PLAN = [
    { id: 'ph', categoryId: 'phone', name: 'Phone', amount: 65, frequency: 'monthly', anchorDue: '2026-10-10', inTotals: false },
    { id: 'car', categoryId: 'insurance', name: 'Car insurance', amount: 128.4, frequency: 'monthly', anchorDue: '2026-10-12', inTotals: false },
    { id: 'nfx', categoryId: 'subscriptions', name: 'Netflix', amount: 16.99, frequency: 'monthly', anchorDue: '2026-10-11', inTotals: false },
];
function mockData(over = {}) {
    return {
        incomeSources: [{ incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: '2026-10-31' }],
        primaryIncomeIndex: 0, allocation: ALLOC, categories: CATS, plan: PLAN, ...over,
    };
}
const MOCK_ROWS = [
    row('2026-11-01', 'groceries', 142.3), row('2026-11-01', 'transport', 68.2), row('2026-11-02', 'rent', 1120),
    row('2026-11-02', 'health', 20), row('2026-11-03', 'groceries', 23.95),
    row('2026-11-02', 'entertainment', 24), row('2026-11-03', 'dining', 18.5), row('2026-11-03', 'dining', 5.5),
    row('2026-11-04', 'other', 32, { status: 'review' }),
    row('2026-10-30', 'groceries', 500), // previous cycle
    { id: 'pay', date: '2026-10-31', categoryId: 'income', amountCents: 343843 },
];
const run = (rows = MOCK_ROWS, data = mockData(), today = '2026-11-04') =>
    leftThisPay({ data, totals: { netCents: 343843 }, txns: rows, today });

function bucketCases() {
    return [
        {
            name: 'B3b.1 resolver',
            fn(assert) {
                const cat = (id) => CATS.find((c) => c.id === id);
                assert('dining to splurge', effectiveBucket(row('2026-11-01', 'dining', 10), cat('dining'), null, ALLOC), 'splurge');
                assert('groceries to daily', effectiveBucket(row('2026-11-01', 'groceries', 10), cat('groceries'), null, ALLOC), 'daily');
                assert('income to none', effectiveBucket({ amountCents: 5000, categoryId: 'income' }, cat('income'), null, ALLOC), null);
                assert('transfer to none', effectiveBucket(row('2026-11-01', 'transfer', 10), { id: 'transfer' }, null, ALLOC), null);
                assert('relinked category follows bucketId', effectiveBucket(row('2026-11-01', 'insurance', 10), { ...cat('insurance'), bucketId: 'fire' }, null, ALLOC), 'fire');
                assert('deleted bucket falls back to derived', effectiveBucket(row('2026-11-01', 'insurance', 10), { ...cat('insurance'), bucketId: 'gone' }, null, ALLOC), 'daily');
                assert('default role', [defaultBucketRole({ essential: true }), defaultBucketRole({ essential: false }), defaultBucketRole(null)], ['daily', 'splurge', 'splurge']);
            },
        },
        {
            name: 'B3b.2 order',
            fn(assert) {
                const c = { ...CATS.find((x) => x.id === 'groceries'), bucketId: 'smile' };
                const item = { bucketId: 'fire' };
                assert('transaction wins', effectiveBucket({ amountCents: -1, bucketId: 'splurge' }, c, item, ALLOC), 'splurge');
                assert('plan item next', effectiveBucket({ amountCents: -1 }, c, item, ALLOC), 'fire');
                assert('category next', effectiveBucket({ amountCents: -1 }, c, {}, ALLOC), 'smile');
                assert('derived last', effectiveBucket({ amountCents: -1 }, CATS[0], null, ALLOC), 'daily');
                const noDaily = ALLOC.filter((a) => a.role !== 'daily');
                assert('no daily: essential to pool', effectiveBucket({ amountCents: -1 }, CATS[0], null, noDaily), SPENDABLE_POOL);
                assert('no splurge: falls to daily', effectiveBucket({ amountCents: -1 }, CATS.find((x) => x.id === 'dining'), null, ALLOC.filter((a) => a.role !== 'splurge')), 'daily');
                assert('unconfigured: pool', effectiveBucket({ amountCents: -1 }, CATS[0], null, []), SPENDABLE_POOL);
            },
        },
        {
            name: 'B3b.3 Daily left (mock fixture)',
            fn(assert) {
                const r = run();
                assert('pool', r.poolCents, 206306);
                assert('spent', r.spentCents, 137445);
                assert('bills', r.billsDueCents, 19340);
                assert('left', r.leftCents, 49521);
                assert('per day (10 days)', r.perDayCents, 4952);
                assert('cycle', [r.cycle.start, r.cycle.end, r.cycle.daysLeft, r.mode], ['2026-10-31', '2026-11-14', 10, 'cycle']);
                assert('essential and non-essential so far', [r.essentialSoFarCents, r.nonEssentialSoFarCents], [137445, 8000]);
                assert('unsorted and review', [r.unsortedCents, r.toReview], [3200, 1]);
            },
        },
        {
            name: 'B3b.4 Splurge left (mock fixture)',
            fn(assert) {
                const s = run().buckets.find((b) => b.id === 'splurge');
                assert('pool', s.poolCents, 34384);
                assert('spent', s.spentCents, 8000);
                assert('bills (Netflix)', s.billsDueCents, 1699);
                assert('left', s.leftCents, 24685);
                assert('pools sum to net', run().buckets.reduce((a, b) => a + b.poolCents, 0), 343843);
            },
        },
        {
            name: 'B3b.5 no double count, missed counts',
            fn(assert) {
                const paid = [...MOCK_ROWS, row('2026-11-03', 'phone', 65, { billMatch: { planId: 'ph', dueDate: '2026-11-10', by: 'user' } })];
                const r = run(paid);
                assert('spent once', r.spentCents, 137445 + 6500);
                assert('bill gone', r.billsDueCents, 12840);
                assert('left unchanged', r.leftCents, 49521);
                // A past, unmatched occurrence inside the cycle (due 2026-11-02) still counts (FT-R-54).
                const missed = mockData({ plan: [...PLAN, { id: 'gym', categoryId: 'health', name: 'Gym', amount: 10, frequency: 'monthly', anchorDue: '2026-10-02' }] });
                assert('missed bill counted', run(MOCK_ROWS, missed).billsDueCents, 19340 + 1000);
                assert('status is Missed', billStatus(missed.plan[3], '2026-11-02', MOCK_ROWS, '2026-11-04'), 'Missed');
            },
        },
        {
            name: 'B3b.6 override',
            fn(assert) {
                const r = run([...MOCK_ROWS, row('2026-11-04', 'entertainment', 24, { bucketId: 'splurge' }), row('2026-11-04', 'dining', 30, { bucketId: 'daily' })]);
                assert('splurge-covered row not in Daily', r.spentCents, 137445 + 3000);
                assert('is in Splurge', r.buckets.find((b) => b.id === 'splurge').spentCents, 8000 + 2400);
            },
        },
        {
            name: 'B3b.7 boundary',
            fn(assert) {
                const edge = row('2026-11-14', 'groceries', 50);
                assert('on cycle.end not counted', run([...MOCK_ROWS, edge], mockData(), '2026-11-04').spentCents, 137445);
                const next = run([...MOCK_ROWS, edge], mockData(), '2026-11-14');
                assert('falls in next cycle', [next.cycle.start, next.spentCents], ['2026-11-14', 5000]);
                assert('on cycle.start counted', run([row('2026-10-31', 'groceries', 5)], mockData(), '2026-11-04').spentCents, 500);
            },
        },
        {
            name: 'B3b.8 month mode',
            fn(assert) {
                const data = mockData({ incomeSources: [{ incomeType: 'variable', paySchedule: 'fortnightly', payAnchor: null }] });
                const rows = [
                    { id: 'a', date: '2026-11-02', categoryId: 'income', amountCents: 300000 },
                    { id: 'b', date: '2026-11-03', categoryId: 'income', amountCents: 50000 },
                    { id: 'c', date: '2026-10-30', categoryId: 'income', amountCents: 900000 },
                    row('2026-11-03', 'groceries', 100),
                ];
                const r = leftThisPay({ data, totals: { netCents: 999999 }, txns: rows, today: '2026-11-04' });
                assert('month mode', [r.mode, r.cycle.start, r.cycle.end], ['month', '2026-11-01', '2026-12-01']);
                assert('net is received so far', r.netCents, 350000);
                assert('daily pool', r.poolCents, 210000);
                assert('left', r.leftCents, 210000 - 10000 - r.billsDueCents);
                // No anchor on a salaried source: month mode unless a recent income row infers one.
                const noAnchor = mockData({ incomeSources: [{ incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: null }] });
                const none = leftThisPay({ data: noAnchor, totals: { netCents: 343843 }, txns: [], today: '2026-11-04' });
                assert('no anchor, nothing to infer', [none.mode, none.netCents], ['month', 0]);
                const inf = leftThisPay({ data: noAnchor, totals: { netCents: 343843 }, txns: [{ id: 'p', date: '2026-10-31', categoryId: 'income', amountCents: 343843 }], today: '2026-11-04' });
                assert('inferred anchor gives a cycle', [inf.mode, inf.cycle.end], ['cycle', '2026-11-14']);
                // Unconfigured allocation: the whole net is spendable.
                const raw = leftThisPay({ data: mockData({ allocation: [{ id: 'a1', name: 'New Allocation', percentage: 100 }] }), totals: { netCents: 343843 }, txns: [], today: '2026-11-04' });
                assert('unconfigured pool is whole net', raw.poolCents, 343843);
                // No Daily role: the unallocated remainder is the spendable pool.
                const nod = leftThisPay({ data: mockData({ allocation: ALLOC.filter((a) => a.role !== 'daily') }), totals: { netCents: 343843 }, txns: [], today: '2026-11-04' });
                assert('no daily: remainder pool', nod.poolCents, 206306);
            },
        },
    ];
}
