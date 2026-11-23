// Test cases for the "sample-household" group (registered in src/test-registry.js).
// B5.1 to B5.4: the sample's figures come from the engine, at a fixed date.

import { buildSampleHousehold, legacySampleFinanceData } from './sample-data.js';
import { calculateTotals } from '../calc/calculations.js';
import { planTotals, netPerPayCents } from '../calc/plan.js';
import { leftThisPay } from '../calc/pay-cycle.js';
import { getBuckets } from './saving-model.js';

const TODAY = '2026-11-21';
const build = () => buildSampleHousehold(TODAY);
const r2 = (x) => Math.round(x * 100) / 100;

export const SAMPLE_HOUSEHOLD_TEST_CASES = [
    {
        name: 'B5.1 sample engine figures match the mocks (dagger values)',
        fn(assert) {
            const { data } = build();
            const totals = calculateTotals(structuredClone(data), { today: new Date(2026, 10, 21) });
            const pt = planTotals(data);
            assert('net per fortnight', r2(totals.totalNetAnnualIncome / 26), 3438.43);
            assert('net per pay cents', netPerPayCents(data), 343843);
            assert('essentials per fortnight', r2(pt.essentialPerCycle), 2072);
            assert('non-essentials per fortnight', r2(pt.nonEssentialPerCycle), 366.62);
            const assets = data.assets.reduce((s, a) => s + a.balance, 0);
            const debts = data.liabilities.reduce((s, a) => s + a.balance, 0);
            assert('net worth equals listed assets less debts less HELP 24,600 (FT-R-125)', [totals.netWorth, assets - debts - 24600], [82050, 82050]);
            assert('hourly rate from gross over hours', data.incomeSources[0].hourlyRate, 43.02);
        },
    },
    {
        name: 'B5.2 pay rows equal the engine net and the split is the engine split',
        fn(assert) {
            const { data, rows } = build();
            const alexPay = rows.filter((r) => r.description.startsWith('SALARY')).map((r) => r.amountCents);
            assert('five Alex pays at the engine net', alexPay, [249843, 249843, 249843, 249843, 249843]);
            assert('split is expenses-first, Daily about 60.3', data.allocation.find((a) => a.role === 'daily').percentage, 60.3);
            assert('split totals 100', Math.round(data.allocation.reduce((s, a) => s + a.percentage, 0) * 10) / 10, 100);
        },
    },
    {
        name: 'B5.3 left this pay is the engine figure at a fixed date; bills, review, manual, override',
        fn(assert) {
            const { data, rows } = build();
            const l = leftThisPay({ data, txns: rows, today: TODAY });
            assert('Daily pool', l.poolCents, 207337);
            assert('Daily spent (rent plus three shops)', l.spentCents, 137445);
            assert('Daily bills due (phone and car insurance)', l.billsDueCents, 19340);
            assert('left this pay about 505.52', l.leftCents, 50552);
            const matched = new Set(rows.filter((r) => r.billMatch).map((r) => r.billMatch.planId));
            assert('rent, phone, insurance and Netflix match history', [...matched].sort(), ['p-car-insurance', 'p-netflix', 'p-phone', 'p-rent']);
            const thisRent = rows.find((r) => r.billMatch && r.billMatch.planId === 'p-rent' && r.date === '2026-11-17');
            assert('this pay rent matched', !!thisRent, true);
            assert('Netflix due today is unmatched', rows.some((r) => r.billMatch && r.billMatch.planId === 'p-netflix' && r.billMatch.dueDate === TODAY), false);
            assert('review rows are uncategorised merchants', rows.filter((r) => r.status === 'review').every((r) => r.categoryId === 'other'), true);
            assert('three review rows', rows.filter((r) => r.status === 'review').length, 3);
            assert('one manual row', rows.filter((r) => r.source === 'manual').length, 1);
            assert('one bucket override', rows.filter((r) => r.bucketId).map((r) => r.bucketId), ['b-daily']);
        },
    },
    {
        name: 'B5.4 Smile goal with two sub-buckets, Fire list card first, Mojo balance, relative dates',
        fn(assert) {
            const { data, rows } = build();
            const b = getBuckets(data, TODAY);
            const kids = b.filter((x) => x.parentId === 'g-bali-trip').map((x) => x.name);
            assert('two sub-buckets', kids, ['Flights', 'Accommodation']);
            assert('Smile balance', b.find((x) => x.role === 'smile').balanceCents, 120000);
            assert('Fire list order', data.savingModel.fire.targets.map((x) => x.id), ['debt:l-credit-card', 'debt:l-car-loan', 'mojo', 'home', 'super']);
            assert('Fire active target is the card', b.find((x) => x.role === 'fire').target.label, 'Credit card');
            assert('Mojo balance', b.find((x) => x.role === 'mojo').balanceCents, 140000);
            assert('pay anchor is four days back', data.incomeSources[0].payAnchor, '2026-11-17');
            const later = buildSampleHousehold('2027-02-03');
            assert('dates move with today', later.data.incomeSources[0].payAnchor, '2027-01-30');
            assert('newest row is within the last week', rows[0].date >= '2026-11-14', true);
            assert('legacy fixture still exported', legacySampleFinanceData().essentialExpenses.length, 5);
        },
    },
];
