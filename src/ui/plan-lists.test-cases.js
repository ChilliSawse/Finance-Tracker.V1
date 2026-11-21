// Test cases for the "plan-lists" group (A9a.1, registered in src/test-registry.js).
// A9a.1: the money lists group plan items by the category flag and the due date, their
// figures come from B1/B4 (no literal), edits go through B4 with working undo, data is escaped.
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixture: fake household.

import {
    planListsModel, listBodyHtml, payBodyHtml, capsHtml, reviewCardHtml, planItemSheetSpec, savePlanItem,
    deletePlanItem, clearReview, markReviewed, nextDue,
} from './plan-lists.js';
import { planTotals } from '../calc/plan.js';

const CATS = [
    { id: 'groceries', name: 'Groceries', essential: true, monthlyBudget: 600 },
    { id: 'insurance', name: 'Insurance', essential: true, monthlyBudget: 0 },
    { id: 'dining', name: 'Dining', essential: false, monthlyBudget: 0 },
    { id: 'other', name: 'Other', essential: false, monthlyBudget: 0 },
    { id: 'income', name: 'Income', essential: false, monthlyBudget: 0 },
];
const HOSTILE = '<img src=x onerror=1>';
const mk = () => ({
    dataVersion: 2, categories: CATS.map((c) => ({ ...c })), primaryIncomeIndex: 0,
    incomeSources: [{ name: 'Job <b>', incomeType: 'salaried', grossAnnual: 90000, paySchedule: 'fortnightly', payAnchor: '2026-10-31' }],
    allocation: [],
    plan: [
        { id: 'g', categoryId: 'groceries', name: 'Groceries', amount: 180, frequency: 'weekly', anchorDue: null, inTotals: true },
        { id: 'd', categoryId: 'dining', name: HOSTILE, amount: 60, frequency: 'weekly', anchorDue: null, inTotals: true },
        { id: 'c', categoryId: 'insurance', name: 'Car insurance', amount: 128.4, frequency: 'monthly', anchorDue: '2026-11-20', inTotals: false },
        { id: 'r', categoryId: 'other', name: 'Rego', amount: 880, frequency: 'yearly', anchorDue: '2027-02-03', inTotals: true },
    ],
    planMigration: { reviewBills: ['c', 'gone'] },
});
const TODAY = '2026-11-10';

export const PLAN_LISTS_TEST_CASES = [
    {
        name: 'A9a.1 lists group by category flag and due date; totals match planTotals',
        fn(assert) {
            const d = mk();
            const m = planListsModel(d, { today: TODAY });
            assert('essentials', m.essentials.rows.map((r) => r.id), ['g']);
            assert('non-essentials', m.nonEssentials.rows.map((r) => r.id), ['d']);
            assert('bills by due date', m.bills.rows.map((r) => r.id), ['c', 'r']);
            const pt = planTotals(d);
            assert('lists add up to planTotals (bills counted once)', Math.abs(m.essentials.perPay + m.nonEssentials.perPay + m.bills.perPay - pt.essentialPerCycle - pt.nonEssentialPerCycle) < 1e-9, true);
            assert('bills: reminder row kept, flagged', m.bills.rows[0].inTotals, false);
            assert('bills total counts the counted bill only', m.bills.perPay > 0, true);
            assert('review drops unknown ids', m.review.map((r) => r.id), ['c']);
            assert('next due rolls from the anchor', nextDue({ anchorDue: '2026-10-20', frequency: 'monthly' }, TODAY), '2026-11-20');
        },
    },
    {
        name: 'A9a.1 search filters rows only; footer totals stay full',
        fn(assert) {
            const m = planListsModel(mk(), { today: TODAY, query: 'groc' });
            assert('rows', m.essentials.rows.length, 1);
            assert('other list empty', m.nonEssentials.rows.length, 0);
            assert('non total kept', m.nonEssentials.perPay > 0, true);
            assert('no-match text', listBodyHtml('non', m.nonEssentials, 'groc').includes('matches'), true);
        },
    },
    {
        name: 'A9a.1 html escapes names; reminder, caps and review card',
        fn(assert) {
            const d = mk();
            const m = planListsModel(d, { today: TODAY, monthByCategory: new Map([['groceries', 45000]]) });
            const html = listBodyHtml('non', m.nonEssentials, '') + listBodyHtml('bills', m.bills, '') + payBodyHtml(m.pay);
            assert('no raw tag', html.includes('<img') || html.includes('<b>'), false);
            assert('escaped', html.includes('&lt;img'), true);
            assert('reminder tag', html.includes('reminder only'), true);
            const caps = capsHtml(m.caps, true);
            assert('left against the cap', caps.includes('left against the cap'), true);
            assert('cap left is cap minus spent', m.caps[0].left, 150);
            assert('review card count', reviewCardHtml(m.review).includes('Check this 1'), true);
            assert('no card when empty', reviewCardHtml([]), '');
        },
    },
    {
        name: 'A9a.1 add, edit, delete and undo go through the plan API',
        fn(assert) {
            const d = mk();
            const before = JSON.stringify(d.plan);
            const vals = { name: 'Gym', amount: 20, frequency: 'weekly', categoryId: 'dining', isBill: false, anchorDue: '', inTotals: true };
            const add = savePlanItem(d, null, vals, { kind: 'non' });
            assert('added', d.plan.length, 5);
            add.onUndo();
            assert('add undone', JSON.stringify(d.plan), before);
            const bill = savePlanItem(d, null, { ...vals, name: 'Water', isBill: true, anchorDue: '2026-12-01' }, { kind: 'bills' });
            assert('new bill counts', bill.item.inTotals === true && bill.item.anchorDue === '2026-12-01', true);
            bill.onUndo();
            const edit = savePlanItem(d, d.plan[0], { ...vals, name: 'Food', amount: 200, categoryId: 'groceries' }, { kind: 'essential' });
            assert('edited', d.plan[0].name + d.plan[0].amount, 'Food200');
            edit.onUndo();
            assert('edit undone', JSON.stringify(d.plan), before);
            const conv = savePlanItem(d, d.plan[0], { ...vals, name: 'Groceries', amount: 180, categoryId: 'groceries', isBill: true, anchorDue: '2026-12-05' }, { kind: 'essential' });
            assert('made a bill', d.plan[0].anchorDue, '2026-12-05');
            assert('toast has a message', conv.message.length > 0, true);
            conv.onUndo();
            assert('conversion undone', JSON.stringify(d.plan), before);
            const del = deletePlanItem(d, 'd');
            assert('deleted', d.plan.some((p) => p.id === 'd'), false);
            del.onUndo();
            assert('delete undone in place', JSON.stringify(d.plan), before);
        },
    },
    {
        name: 'A9a.1 sheet spec validates, and the review list clears',
        fn(assert) {
            const d = mk();
            const spec = planItemSheetSpec(d, { kind: 'bills' });
            assert('bill needs due', Object.keys(spec.validate({ name: 'x', amount: 5, isBill: true, anchorDue: '' })), ['anchorDue']);
            assert('name and amount', Object.keys(spec.validate({ name: ' ', amount: -1, anchorDue: '2026-12-01' })).sort(), ['amount', 'name']);
            const edit = planItemSheetSpec(d, { kind: 'essential', item: d.plan[0] });
            assert('plain line may skip the date', edit.validate(edit.values), {});
            assert('income not offered as category', spec.fields.find((f) => f.key === 'categoryId').options.some((o) => o.value === 'income'), false);
            markReviewed(d, 'c');
            assert('reviewed one', d.planMigration.reviewBills, ['gone']);
            clearReview(d);
            assert('cleared', d.planMigration.reviewBills, []);
        },
    },
];
