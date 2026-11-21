// Test cases for the "pay-cycle" group (B1.1 to B1.8, B1.10; registered in src/test-registry.js).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { getWeeklyAmount, getPayCyclesPerYear } from '../utils.js';
import { getCycle, payDatesBetween, nextPayDates, inferPayAnchor, billOccurrences, billStatus } from './pay-cycle.js';

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
];
