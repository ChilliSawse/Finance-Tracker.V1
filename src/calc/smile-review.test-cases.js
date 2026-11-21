// Test cases for the "smile-review" group (registered in src/test-registry.js).
// E3: pure maths in src/calc/smile.js and src/calc/review.js (plan section 12, T15 to T17 and T22).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { smilePlan, suggestGoalShares, housingCheck, transfersToUpdate, markTransfersDone } from './smile.js';
import { reviewDue, buildMonthlyReview, inMonth } from './review.js';
import { cloneDefaultFinanceData } from '../state/defaults.js';
import { netPerPayCents } from './plan.js';
import { allocateCents } from './saving-model.js';

const NET = 343843; // the sample take-home a fortnight, cents
const SMILE = 33353; // engine Smile share (9.7%), cents
const DATES = ['2025-11-28', '2025-12-12', '2025-12-26', '2026-01-09'];

const ALLOC = () => [
    { id: 'daily', role: 'daily', name: 'Daily expenses', percentage: 60.3, currentBalance: 0 },
    { id: 'splurge', role: 'splurge', name: 'Splurge', percentage: 10.7, bankLabel: 'Up saver "Splurge"', currentBalance: 0 },
    { id: 'smile', role: 'smile', name: 'Smile', percentage: 9.7, bankLabel: 'Up saver "Smile"', currentBalance: 1200 },
    { id: 'fire', role: 'fire', name: 'Fire extinguisher', percentage: 19.3, bankLabel: 'To the credit card', currentBalance: 0 },
    { id: 'mojo', role: 'mojo', name: 'Mojo', percentage: 0, currentBalance: 0 },
];
const GUIDE_BANK = { daily: 206306, splurge: 34384, smile: 34384, fire: 68769, mojo: 0 };

// The mock's Smile goals (plan.html), on fixed dates: pays every second Friday from 2025-11-14, today 2025-11-13.
const MOCK_PAYS = (() => {
    const out = [];
    let t = Date.UTC(2025, 10, 14);
    for (let i = 0; i < 40; i++) { out.push(new Date(t).toISOString().slice(0, 10)); t += 14 * 86400000; }
    return out;
})();
const MOCK_GOALS = () => [
    { id: 'concert', name: 'Concert', costCents: 50000, savedCents: 38000, due: '2025-12-13', share: 15 },
    { id: 'bike', name: 'New bike', costCents: 100000, savedCents: 42000, due: '2026-03-28', share: 15 },
    { id: 'japan', name: 'Japan', costCents: 250000, savedCents: 74384, due: '2026-06-30', share: 70 },
];

function reviewData() {
    const d = cloneDefaultFinanceData();
    d.primaryIncomeIndex = 0;
    d.incomeSources = [{ name: 'A', incomeType: 'salaried', grossAnnual: 85000, paySchedule: 'fortnightly', payAnchor: '2025-11-14', hoursPerCycle: 76 }];
    d.categories = [{ id: 'groceries', name: 'Groceries', essential: true }, { id: 'dining', name: 'Dining', essential: false }];
    d.essentialExpenses = [{ name: 'Rent', amount: 560, frequency: 'weekly' }];
    d.nonEssentialExpenses = [{ name: 'Dining', amount: 110, frequency: 'weekly' }];
    d.allocation = ALLOC();
    d.bucketGoals = [];
    d.liabilities = [];
    d.savingModel = { autoCredit: { on: false }, movements: [], fire: { targets: [] }, mojo: {}, bankSetTo: { ...GUIDE_BANK } };
    return d;
}

export const SMILE_REVIEW_TEST_CASES = [
    { name: 'T15 smile calculator', fn(assert) {
        const p = smilePlan({ costCents: 100000, savedCents: 40000, due: '2025-12-18', smilePerPayCents: SMILE, sharePct: 100, payDates: DATES });
        assert('pays left', p.paysLeft, 2);
        assert('needs 300.00 a pay', p.perPayNeededCents, 30000);
        assert('89.95% of Smile', p.sharePctNeeded, 89.95);
        assert('on track', p.status, 'on-track');
        const imp = smilePlan({ costCents: 100000, savedCents: 40000, due: '2025-11-20', smilePerPayCents: SMILE, payDates: DATES });
        assert('due before the next pay', imp.status, 'impossible');
        const nd = smilePlan({ costCents: 100000, savedCents: 40000, smilePerPayCents: SMILE, sharePct: 100, payDates: DATES });
        assert('no date: ready in 2 pays', [nd.readyIn, nd.readyOn, nd.status], [2, '2025-12-12', 'no-date']);
        const half = smilePlan({ costCents: 100000, savedCents: 40000, due: '2025-12-18', smilePerPayCents: SMILE, sharePct: 50, payDates: DATES });
        assert('50% is 166.77 a pay', half.perPayCents, 16677);
        assert('4 pays, 22 days late', [half.readyIn, half.readyOn, half.lateDays, half.status], [4, '2026-01-09', 22, 'late']);
        assert('done', smilePlan({ costCents: 1000, savedCents: 1000, smilePerPayCents: SMILE, payDates: DATES }).status, 'done');
        assert('today skips a pay already past', smilePlan({ costCents: 100000, savedCents: 40000, due: '2025-12-18',
            smilePerPayCents: SMILE, payDates: DATES, today: '2025-11-28' }).paysLeft, 1);
    } },
    { name: 'T15b suggestGoalShares on the mock (U27)', fn(assert) {
        const args = { goals: MOCK_GOALS(), smilePerPayCents: 34384, payDates: MOCK_PAYS, today: '2025-11-13', netCents: NET };
        const mockLines = suggestGoalShares({ ...args, goals: MOCK_GOALS().map((g) => g) });
        assert('move 5% from Japan to the bike', mockLines, { kind: 'move', moves: [{ fromId: 'japan', toId: 'bike', pct: 5 }],
            shares: { concert: 15, bike: 20, japan: 65 } });
        // The mock's own "ready" dates reproduce on these dates.
        const ready = (g) => smilePlan({ costCents: g.costCents, savedCents: g.savedCents, due: g.due, smilePerPayCents: 34384,
            sharePct: g.share, payDates: MOCK_PAYS, today: '2025-11-13' });
        const [c, b, j] = MOCK_GOALS().map(ready);
        assert('concert ready Fri 12 Dec', [c.readyOn, c.status], ['2025-12-12', 'on-track']);
        assert('bike ready Fri 17 Apr, 20 days late', [b.readyOn, b.lateDays, b.status], ['2026-04-17', 20, 'late']);
        assert('Japan ready Fri 20 Feb', [j.readyOn, j.status], ['2026-02-20', 'on-track']);
        const after = suggestGoalShares({ ...args, goals: MOCK_GOALS().map((g) => ({ ...g, share: mockLines.shares[g.id] })) });
        assert('after the move nobody is late', after, null);
        assert('nobody late gives null', suggestGoalShares({ ...args, goals: [MOCK_GOALS()[2]] }), null);
        const tight = suggestGoalShares({ goals: [{ id: 'a', costCents: 900000, savedCents: 0, due: '2026-01-09', share: 50 },
            { id: 'b', costCents: 10000, savedCents: 0, due: '2026-06-30', share: 50 }], smilePerPayCents: 34384, payDates: MOCK_PAYS, today: '2025-11-13', netCents: NET });
        assert('not enough slack offers raising Smile', tight.kind, 'raise');
    } },
    { name: 'T16 housing check', fn(assert) {
        const plan = [{ name: 'Rent', amount: 560, frequency: 'weekly', categoryId: 'housing' }, { name: 'Food', amount: 300, frequency: 'weekly', categoryId: 'groceries' }];
        assert('32.6% neutral over', housingCheck({ plan, netPerPayCents: NET, cyclesPerYear: 26 }),
            { perPayCents: 112000, pctOfTakeHome: 32.6, guide: 30, over: true, tone: 'neutral', itemsUsed: 1 });
        assert('no housing item is null', housingCheck({ plan: [plan[1]], netPerPayCents: NET }), null);
        const m = housingCheck({ plan: [{ amount: 2400, frequency: 'monthly', categoryId: 'housing' }], netPerPayCents: NET, cyclesPerYear: 26 });
        assert('monthly 2,400 is 1,107.69 a fortnight', m.perPayCents, 110769);
        assert('under 30 is not over', housingCheck({ plan: [{ amount: 500, frequency: 'weekly', categoryId: 'housing' }], netPerPayCents: NET }).over, false);
    } },
    { name: 'T17 transfers to update', fn(assert) {
        const rows = transfersToUpdate({ allocation: ALLOC(), netCents: NET, bankSetTo: GUIDE_BANK });
        assert('engine amounts', rows.map((r) => [r.bucketId, r.wasCents, r.nowCents, r.informational]), [
            ['daily', 206306, 207337, true], ['splurge', 34384, 36791, false], ['smile', 34384, 33353, false], ['fire', 68769, 66362, false]]);
        assert('labels carried', rows[1].bankLabel, 'Up saver "Splurge"');
        const near = { ...GUIDE_BANK, splurge: 36791 - 99, smile: 33353 + 99 };
        assert('99 cents is ignored', transfersToUpdate({ allocation: ALLOC(), netCents: NET, bankSetTo: near }).map((r) => r.bucketId), ['daily', 'fire']);
        const done = markTransfersDone(GUIDE_BANK, rows);
        assert('ticking writes bankSetTo', [done.splurge, done.smile, done.fire, done.daily, done.mojo], [36791, 33353, 66362, 207337, 0]);
        assert('all ticked is empty', transfersToUpdate({ allocation: ALLOC(), netCents: NET, bankSetTo: done }), []);
        assert('input untouched', GUIDE_BANK.splurge, 34384);
        assert('unseeded card is empty', transfersToUpdate({ allocation: ALLOC(), netCents: NET }), []);
    } },
    { name: 'T22 review', fn(assert) {
        const d = reviewData();
        d.review = { lastOpenedMonth: '2025-09' };
        const has = (m) => m === '2025-10';
        assert('null before the 1st (31 Oct)', reviewDue(d, '2025-10-31', { hasTransactions: has }), null);
        assert('previous month on the 1st', reviewDue(d, '2025-11-01', { hasTransactions: has }), '2025-10');
        d.review.lastOpenedMonth = '2025-10';
        assert('null once opened', reviewDue(d, '2025-11-01', { hasTransactions: has }), null);
        // U28: a 30-day month. On 30 Nov the November review is not due; on 1 Dec it is.
        d.review.lastOpenedMonth = '2025-10';
        assert('30-day month, last day not due', reviewDue(d, '2025-11-30', { hasTransactions: () => true }), null);
        assert('30-day month, 1 Dec due', reviewDue(d, '2025-12-01', { hasTransactions: () => true }), '2025-11');
        assert('no data, not due', reviewDue(d, '2025-12-01'), null);
        d.savingModel.movements = [{ date: '2025-11-28', bucketId: 'smile', cents: 100, kind: 'pay' }];
        assert('movements alone make it due', reviewDue(d, '2025-12-01'), '2025-11');
        assert('the 30th is inside the month (U28)', [inMonth('2025-11-30', '2025-11'), inMonth('2025-12-01', '2025-11'), inMonth('2025-11-01', '2025-11')], [true, false, true]);
        d.savingModel.movements = [];

        const net = netPerPayCents(d);
        const nowSplit = allocateCents(net, d.allocation.map((a) => a.percentage));
        d.savingModel.bankSetTo = Object.fromEntries(d.allocation.map((a, i) => [a.id, nowSplit[i]]));
        const spend = new Map([['groceries', 430000], ['dining', 90000]]);
        const r = buildMonthlyReview({ data: d, month: '2025-10', spendByCategory: spend, today: '2025-11-01' });
        assert('four blocks', Object.keys(r).filter((k) => ['spending', 'movements', 'targets', 'transfers'].includes(k)), ['spending', 'movements', 'targets', 'transfers']);
        assert('essential 4,300 and non-essential 900', [r.spending.essentialCents, r.spending.nonEssentialCents, r.spending.totalCents], [430000, 90000, 520000]);
        assert('auto credit off is planned', [r.movements.planned, r.movements.pays], [true, 3]);
        assert('planned Smile is 3 pays', r.movements.lines.find((l) => l.bucketId === 'smile').creditedCents, 3 * nowSplit[2]);
        assert('transfers block is the same list', r.transfers.length, 0);

        d.savingModel.autoCredit.on = true;
        d.savingModel.movements = [{ date: '2025-10-17', bucketId: 'smile', cents: 33353, kind: 'pay' },
            { date: '2025-11-14', bucketId: 'smile', cents: 33353, kind: 'pay' }];
        d.allocation.find((x) => x.id === 'smile').currentBalance = 1200;
        const on = buildMonthlyReview({ data: d, month: '2025-10', spendByCategory: spend, today: '2025-11-20' });
        const line = on.movements.lines[0];
        assert('credited and balances', [on.movements.planned, line.creditedCents, line.endCents, line.startCents], [false, 33353, 120000 - 33353, 120000 - 66706]);
    } },
];
