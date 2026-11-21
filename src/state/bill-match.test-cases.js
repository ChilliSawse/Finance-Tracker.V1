// Test cases for the "bill-match" group (B8.4, B8.5 and the Actual 26.11.0 edge cases).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { matchBills, markNotThisBill, setUserMatch, learnBillKey } from '../calc/bill-match.js';

const bill = (o) => ({ id: 'rent', name: 'Rent', amount: 1000, frequency: 'monthly', anchorDue: '2026-11-05', matchRule: null, ...o });
const tx = (o) => ({ id: 't', date: '2026-11-05', description: 'DIRECT DEBIT', amountCents: -100000, source: 'csv', ...o });
const match = (rows, plan, opts) => matchBills(rows, plan, opts).rows;

export const BILL_MATCH_TEST_CASES = [
    {
        name: 'B8.4 tolerances',
        fn(assert) {
            const plan = [bill()];
            assert('exact', match([tx()], plan)[0].billMatch, { planId: 'rent', dueDate: '2026-11-05', by: 'auto' });
            assert('plus 2 days in', !!match([tx({ date: '2026-11-07' })], plan)[0].billMatch, true);
            assert('minus 2 days in', !!match([tx({ date: '2026-11-03' })], plan)[0].billMatch, true);
            assert('3 days out', !!match([tx({ date: '2026-11-08' })], plan)[0].billMatch, false);
            assert('7.5% in', !!match([tx({ amountCents: -107500 })], plan)[0].billMatch, true);
            assert('7.6% out', !!match([tx({ amountCents: -107600 })], plan)[0].billMatch, false);
            assert('money in is never a bill', !!match([tx({ amountCents: 100000 })], plan)[0].billMatch, false);
            const keyed = [bill({ matchRule: { keys: ['acme realty'] } })];
            assert('key widens to 5 days', !!match([tx({ date: '2026-11-10', description: 'ACME REALTY PAYMENT' })], keyed)[0].billMatch, true);
            assert('without the key, 5 days is out', !!match([tx({ date: '2026-11-10' })], keyed)[0].billMatch, false);
            assert('key does not waive the amount', !!match([tx({ date: '2026-11-10', description: 'ACME REALTY', amountCents: -150000 })], keyed)[0].billMatch, false);
            assert('per-bill tolerance', !!match([tx({ date: '2026-11-08' })], [bill({ matchRule: { dayTol: 3 } })])[0].billMatch, true);
        },
    },
    {
        name: 'B8.5 one-to-one, ties, user fixed, Not this bill, idempotent',
        fn(assert) {
            const plan = [bill()];
            const a = tx({ id: 'a', date: '2026-11-05' }), b = tx({ id: 'b', date: '2026-11-06' });
            const r = match([b, a], plan);
            assert('closest date wins the only occurrence', [!!r[0].billMatch, !!r[1].billMatch], [false, true]);
            const tie1 = match([tx({ id: 'z', date: '2026-11-04' }), tx({ id: 'y', date: '2026-11-06' })], plan);
            assert('tie on distance: earlier date', [!!tie1[0].billMatch, !!tie1[1].billMatch], [true, false]);
            const tie2 = match([tx({ id: 'z', date: '2026-11-05' }), tx({ id: 'y', date: '2026-11-05' })], plan);
            assert('tie on date: lower id', [!!tie2[0].billMatch, !!tie2[1].billMatch], [false, true]);

            const fixed = setUserMatch(tx({ id: 'u', date: '2026-11-20' }), 'rent', '2026-11-05');
            const withUser = match([fixed, tx({ id: 'a' })], plan);
            assert('user match untouched', withUser[0].billMatch, { planId: 'rent', dueDate: '2026-11-05', by: 'user' });
            assert('and holds its occurrence', !!withUser[1].billMatch, false);

            const not = markNotThisBill(matchBills([tx()], plan).rows[0]);
            assert('Not this bill clears', not.billMatch, null);
            assert('and is not re-matched', !!match([not], plan)[0].billMatch, false);
            const notOne = markNotThisBill(tx(), 'rent');
            assert('per-bill block', !!match([notOne], plan)[0].billMatch, false);
            assert('per-bill block leaves other bills', !!match([notOne], [...plan, bill({ id: 'rent2' })])[0].billMatch, true);

            const first = matchBills([a, b], plan);
            const second = matchBills(first.rows, plan);
            assert('idempotent: second run changes nothing', second.changed.length, 0);
            assert('inputs not mutated', a.billMatch, undefined);
            const moved = matchBills([{ ...a, billMatch: { planId: 'rent', dueDate: '2026-11-05', by: 'auto' }, amountCents: -5000 }], plan);
            assert('a stale auto match is cleared', moved.rows[0].billMatch, null);
        },
    },
    {
        name: 'B8.5 Actual 26.11.0 edge cases: unlinked bank rows, weekends, every N days',
        fn(assert) {
            const plan = [bill()];
            const manual = tx({ id: 'a', source: 'manual', date: '2026-11-05' });
            const bank = tx({ id: 'b', source: 'csv', date: '2026-11-05' });
            const r = match([manual, bank], plan);
            assert('bank row preferred over a manual twin', [!!r[0].billMatch, !!r[1].billMatch], [false, true]);

            const taken = setUserMatch(tx({ id: 'l', date: '2026-11-05' }), 'other-bill', '2026-11-05');
            const free = tx({ id: 'f', date: '2026-11-05' });
            const r2 = match([taken, free], plan);
            assert('a row already linked elsewhere is left; the unlinked row matches', [r2[0].billMatch.planId, r2[1].billMatch.planId], ['other-bill', 'rent']);

            // 2026-11-07 is a Saturday; a Monday posting is 2 days later and still in.
            const sat = [bill({ anchorDue: '2026-11-07' })];
            assert('weekend due, Monday posting', !!match([tx({ date: '2026-11-09' })], sat)[0].billMatch, true);
            assert('weekend due, Tuesday posting is out', !!match([tx({ date: '2026-11-10' })], sat)[0].billMatch, false);

            const every = [bill({ frequency: 'weekly', everyDays: 10, anchorDue: '2026-11-01' })];
            const rows = [tx({ id: '1', date: '2026-11-11' }), tx({ id: '2', date: '2026-11-21' })];
            const out = match(rows, every);
            assert('every 10 days: both occurrences matched', out.map((x) => x.billMatch && x.billMatch.dueDate), ['2026-11-11', '2026-11-21']);
            assert('learnBillKey adds once', [learnBillKey(plan[0], 'acme'), learnBillKey(plan[0], 'acme'), plan[0].matchRule.keys], [true, false, ['acme']]);
        },
    },
];
