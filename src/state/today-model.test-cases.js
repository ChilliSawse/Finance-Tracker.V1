// Test cases for the "today-model" group (B7.1 to B7.3, registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixture: the Today mock's rows (fake data).

import { loadSpendCache, getSpendCache } from './spend-cache.js';
import { buildTodayModel, buildActivityFeed, todayModel, activityFeed } from './today-model.js';

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
const PLAN = [
    { id: 'ph', categoryId: 'phone', name: 'Phone', amount: 65, frequency: 'monthly', anchorDue: '2026-10-10', inTotals: false },
    { id: 'car', categoryId: 'insurance', name: 'Car insurance', amount: 128.4, frequency: 'monthly', anchorDue: '2026-10-12', inTotals: false },
    { id: 'nfx', categoryId: 'subscriptions', name: 'Netflix', amount: 16.99, frequency: 'monthly', anchorDue: '2026-10-11', inTotals: false },
];
const DATA = {
    dataVersion: 2,
    incomeSources: [{ incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: '2026-10-31' }],
    primaryIncomeIndex: 0, allocation: ALLOC, categories: CATS, plan: PLAN,
};
const row = (date, categoryId, dollars, extra = {}) => ({ id: `${date}-${categoryId}-${dollars}`, date, categoryId, amountCents: Math.round(-dollars * 100), ...extra });
// The mock's two review rows: Chemist Warehouse (health, 20) and the SQ *MELB FARMERS MKT row (other, 32).
const ROWS = [
    row('2026-11-01', 'groceries', 142.3), row('2026-11-01', 'transport', 68.2), row('2026-11-02', 'rent', 1120),
    row('2026-11-02', 'health', 20, { status: 'review' }), row('2026-11-03', 'groceries', 23.95),
    row('2026-11-02', 'entertainment', 24), row('2026-11-03', 'dining', 18.5), row('2026-11-03', 'dining', 5.5),
    row('2026-11-04', 'other', 32, { status: 'review' }),
    row('2026-10-30', 'groceries', 500), // previous cycle
    { id: 'pay', date: '2026-10-31', categoryId: 'income', amountCents: 343843 },
];
const TODAY = '2026-11-04';
const model = (rows = ROWS, today = TODAY) => buildTodayModel({ data: DATA, rows, today });

export const TODAY_MODEL_TEST_CASES = [
    {
        name: 'B7.1 ready false until the cache loads',
        fn(assert) {
            assert('today not ready', todayModel(), { ready: false });
            assert('activity not ready', activityFeed(), { ready: false });
            assert('cache starts not ready', getSpendCache().ready, false);
            loadSpendCache(ROWS, { data: DATA, today: TODAY });
            const c = getSpendCache();
            assert('cache ready', c.ready, true);
            assert('cycle in cache', [c.cycle.start, c.cycle.end], ['2026-10-31', '2026-11-14']);
            assert('cache cycle rows exclude the previous cycle', c.cycleRows.length, 10);
            assert('cache by bucket', [c.cycleByBucket.get('daily'), c.cycleByBucket.get('splurge')], [137445, 8000]);
            assert('cache by category', c.cycleByCategory.get('groceries'), 16625);
            assert('cache to review', c.toReview, 2);
            assert('today ready after load', todayModel().ready, true);
            assert('activity ready after load', activityFeed().ready, true);
        },
    },
    {
        name: 'B7.2 fixture figures',
        fn(assert) {
            const m = model();
            assert('essential so far', m.essentialSoFarCents, 137445);
            assert('non-essential so far', m.nonEssentialSoFarCents, 8000);
            assert('unsorted', m.unsortedCents, 3200);
            assert('to review', m.toReview, 2);
            assert('daily spent, bills, left', [m.spentCents, m.billsDueCents, m.leftCents], [137445, 19340, m.poolCents - 137445 - 19340]);
            assert('top category', [m.byCategory[0].categoryId, m.byCategory[0].spentCents], ['rent', 112000]);
            assert('day series sums to spend', m.spendByDay.reduce((a, d) => a + d.spentCents, 0), 145445);
            assert('due before pay day, soonest first', m.dueBeforePay.map((b) => [b.bill.id, b.dueDate, b.status]),
                [['ph', '2026-11-10', 'Upcoming'], ['nfx', '2026-11-11', 'Upcoming'], ['car', '2026-11-12', 'Upcoming']]);
            // Only rows still flagged 'review' count: a confirmed row does not.
            const confirmed = ROWS.map((r) => (r.categoryId === 'other' ? { ...r, status: 'ok' } : r));
            assert('confirmed row leaves the count', model(confirmed).toReview, 1);
            assert('review rows outside the cycle ignored', model([...ROWS, row('2026-10-20', 'other', 9, { status: 'review' })]).toReview, 2);
        },
    },
    {
        name: 'B7.3 boundary and matched bill',
        fn(assert) {
            const edge = row('2026-11-14', 'groceries', 50);
            assert('row on cycle.end not in this cycle', model([...ROWS, edge]).spentCents, 137445);
            const next = model([...ROWS, edge], '2026-11-14');
            assert('falls in the next cycle', [next.cycle.start, next.spentCents], ['2026-11-14', 5000]);
            const feedCur = buildActivityFeed({ data: DATA, rows: [...ROWS, edge], today: TODAY });
            assert('feed omits it from this cycle', feedCur.days.some((d) => d.date === '2026-11-14'), false);
            const paid = [...ROWS, row('2026-11-03', 'phone', 65, { billMatch: { planId: 'ph', dueDate: '2026-11-10', by: 'user' } })];
            const m = model(paid);
            assert('matched bill counted once as spend', [m.spentCents, m.billsDueCents], [137445 + 6500, 12840]);
            assert('matched bill leaves due list', m.dueBeforePay.map((b) => b.bill.id), ['nfx', 'car']);
            const feed = buildActivityFeed({ data: DATA, rows: paid, today: TODAY });
            const phoneItems = feed.days.flatMap((d) => d.items).filter((i) => (i.row && i.row.categoryId === 'phone') || i.planId === 'ph');
            assert('one item for the paid bill', phoneItems.length, 1);
            assert('shown as covered txn', [phoneItems[0].type, phoneItems[0].covered], ['txn', true]);
            assert('coming up has the other two', feed.comingUp.map((b) => [b.planId, b.status]), [['nfx', 'Upcoming'], ['car', 'Upcoming']]);
            assert('feed to review', feed.toReviewCount, 2);
            assert('feed spend is cycle spend', feed.spentCents, 137445 + 8000 + 6500);
            const missedData = { ...DATA, plan: [...PLAN, { id: 'gym', categoryId: 'health', name: 'Gym', amount: 10, frequency: 'monthly', anchorDue: '2026-10-02', inTotals: false }] };
            const mf = buildActivityFeed({ data: missedData, rows: ROWS, today: TODAY });
            const gym = mf.days.flatMap((d) => d.items).find((i) => i.planId === 'gym');
            assert('missed occurrence', [gym.dueDate, gym.status], ['2026-11-02', 'Missed']);
        },
    },
];
