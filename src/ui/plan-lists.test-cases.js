// Test cases for the "plan-lists" group (A9a.1, registered in src/test-registry.js).
// A9a.1: the money lists group plan items by the category flag and the due date, their
// figures come from B1/B4 (no literal), edits go through B4 with working undo, data is escaped.
// Shape: { name, fn(assert) }, assert(label, actual, expected). Fixture: fake household.

import {
    planListsModel, listBodyHtml, payBodyHtml, capsHtml, reviewCardHtml, planItemSheetSpec, savePlanItem,
    deletePlanItem, clearReview, markReviewed, nextDue,
    categoriesModel, categoriesBodyHtml, categorySheetSpec, saveCategory, deleteCategory, categoryUse, moveTargets,
    debtAssetModel, debtAssetBodyHtml, debtAssetSheetSpec, saveDebtAsset, deleteDebtAsset,
} from './plan-lists.js';
import { getBuckets } from '../state/saving-model.js';
import { resolveBucket } from './quick-add-model.js';
import { CATEGORY_ICON_NAMES } from './icon-paths.js';
import { freshSavingModel, templateAllocation } from '../state/bucket-migration.js';
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

// A9b: a household with the Bucket template, categories with icons and keywords, and two debts.
const mkLinked = () => ({
    ...mk(),
    allocation: templateAllocation(), savingModel: freshSavingModel(), bucketGoals: [],
    categories: [
        { id: 'dining', icon: 'utensils', name: 'Dining', essential: false, monthlyBudget: 250, keywords: ['cafe', 'coffee'], bucketId: null },
        { id: 'groceries', icon: 'cart', name: 'Groceries', essential: true, monthlyBudget: 0, keywords: [], bucketId: null },
        { id: 'travel', icon: 'plane', name: 'Travel', essential: false, monthlyBudget: 0, keywords: [], bucketId: null },
        { id: 'other', icon: 'dots', name: 'Other', essential: false, monthlyBudget: 0, keywords: [] },
        { id: 'income', icon: 'wallet', name: 'Income', essential: false, monthlyBudget: 0, keywords: [] },
    ],
    plan: [], rules: [], bills: [],
    liabilities: [{ id: 'L-car', name: 'Car loan', balance: 11200, interestRate: 7.9 }, { id: 'L-card', name: 'Credit card', balance: 1850, interestRate: 20.99 }],
    assets: [{ name: 'Cash', balance: 800 }],
});

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
    {
        name: 'A9b.1 T19 relinking Dining to Smile changes where a new Dining purchase resolves',
        fn(assert) {
            const d = mkLinked();
            const dining = () => d.categories.find((c) => c.id === 'dining');
            const where = () => resolveBucket({ category: dining(), choiceId: null, allocation: d.allocation }).bucketId;
            assert('Dining starts in Splurge', where(), 'b-splurge');
            const spec = categorySheetSpec(d, { category: dining(), buckets: getBuckets(d, TODAY) });
            const field = spec.fields.find((f) => f.key === 'bucketId');
            assert('sheet carries E7 select, tick first', [field.type, field.options[0].value, spec.values.bucketId], ['select', '', '']);
            assert('sheet fields', spec.fields.map((f) => f.key), ['name', 'icon', 'essential', 'monthlyBudget', 'keywords', 'bucketId']);
            const res = saveCategory(d, dining(), { ...spec.values, bucketId: 'b-smile' });
            assert('saved', res.ok, true);
            assert('a new Dining purchase now resolves to Smile', where(), 'b-smile');
            res.onUndo();
            assert('undo puts it back to Splurge', where(), 'b-splurge');
            const bad = saveCategory(d, dining(), { ...spec.values, name: 'Changed', bucketId: 'mojo' });
            assert('a bad bucket writes nothing', [bad.ok, dining().name, where()], [false, 'Dining', 'b-splurge']);
        },
    },
    {
        name: 'A9b.2 category sheet fields round-trip, icon from data, new category goes before Other',
        fn(assert) {
            const d = mkLinked();
            const spec = categorySheetSpec(d, { category: d.categories[0], buckets: getBuckets(d, TODAY) });
            assert('icon from data', spec.values.icon, 'utensils');
            assert('icon select offers the icon set', spec.fields.find((f) => f.key === 'icon').options.length, CATEGORY_ICON_NAMES.length);
            assert('keywords as text', spec.values.keywords, 'cafe, coffee');
            assert('cap as money', spec.values.monthlyBudget, 250);
            assert('name required', Object.keys(spec.validate({ ...spec.values, name: ' ' })), ['name']);
            const add = saveCategory(d, null, { name: 'Pets', icon: 'heart', essential: true, monthlyBudget: 40, keywords: 'Vet, PETBARN, vet', bucketId: '' }, { id: 'cat-pets' });
            const ids = d.categories.map((c) => c.id);
            assert('inserted before other', ids.indexOf('cat-pets') < ids.indexOf('other'), true);
            const pets = d.categories.find((c) => c.id === 'cat-pets');
            assert('fields saved, keywords tidy', [pets.icon, pets.essential, pets.monthlyBudget, pets.keywords, pets.bucketId], ['heart', true, 40, ['vet', 'petbarn'], null]);
            add.onUndo();
            assert('add undone', d.categories.some((c) => c.id === 'cat-pets'), false);
            const html = categoriesBodyHtml(categoriesModel(d, { buckets: getBuckets(d, TODAY) }));
            assert('row shows the icon svg and the name', html.includes('<svg class="i"') && html.includes('Dining'), true);
            assert('hostile name escaped', categoriesBodyHtml(categoriesModel({ categories: [{ id: 'x', name: HOSTILE, icon: 'tag' }] })).includes('<img'), false);
        },
    },
    {
        name: 'A9b.3 delete guard blocks a category rows still use and offers a move',
        fn(assert) {
            const d = mkLinked();
            d.plan.push({ id: 'p1', categoryId: 'dining', name: 'Takeaway', amount: 20, frequency: 'weekly' });
            d.rules = [{ key: 'dominos', categoryId: 'dining' }];
            const use = categoryUse(d, 'dining', 3);
            assert('use counts', [use.plan, use.rules, use.txns, use.total], [1, 1, 3, 5]);
            const blocked = deleteCategory(d, 'dining', { txns: 3 });
            assert('blocked, nothing changed', [blocked.ok, blocked.code, blocked.use.total, d.categories.some((c) => c.id === 'dining')], [false, 'used', 5, true]);
            assert('stored transactions alone block it', deleteCategory(mkLinked(), 'dining', { txns: 2 }).code, 'used');
            assert('move targets exclude itself and income', moveTargets(d, 'dining').some((o) => o.value === 'dining' || o.value === 'income'), false);
            const before = JSON.stringify(d);
            const moved = deleteCategory(d, 'dining', { moveTo: 'other', txns: 3 });
            assert('moved then deleted', [moved.ok, d.categories.some((c) => c.id === 'dining'), d.plan[0].categoryId, d.rules[0].categoryId], [true, false, 'other', 'other']);
            moved.onUndo();
            assert('one undo restores everything', JSON.stringify(d), before);
            assert('a bad target is refused', deleteCategory(d, 'dining', { moveTo: 'dining' }).code, 'target');
            const free = deleteCategory(d, 'travel');
            assert('an unused category deletes with undo', [free.ok, d.categories.some((c) => c.id === 'travel')], [true, false]);
            free.onUndo();
            assert('undo returns it in place', JSON.stringify(d), before);
            assert('Other and Income are structural', [deleteCategory(d, 'other').code, deleteCategory(d, 'income').code], ['protected', 'protected']);
        },
    },
    {
        name: 'A9b.4 debts and assets: list, sheet fallback, add, edit, delete and undo',
        fn(assert) {
            const d = mkLinked();
            const dm = debtAssetModel(d, 'debt');
            assert('debt rows and total', [dm.count, dm.total], [2, 13050]);
            const spec = debtAssetSheetSpec('debt', d.liabilities[0]);
            assert('stub falls back to plain fields', spec.fields.map((f) => f.key), ['name', 'balance', 'interestRate']);
            assert('validate', Object.keys(debtAssetSheetSpec('asset').validate({ name: '', balance: null })).sort(), ['balance', 'name']);
            const before = JSON.stringify(d);
            const add = saveDebtAsset(d, 'debt', null, { name: 'Store card', balance: 300, interestRate: 18 });
            assert('new debt has an id and the legacy shape', [d.liabilities[2].id, d.liabilities[2].interestRate, d.liabilities[2].balance], ['l-store-card', 18, 300]);
            add.onUndo();
            assert('add undone', JSON.stringify(d), before);
            const edit = saveDebtAsset(d, 'debt', 0, { name: 'Car', balance: 10000, interestRate: 7 });
            assert('edit keeps the id', [d.liabilities[0].id, d.liabilities[0].name, d.liabilities[0].balance], ['L-car', 'Car', 10000]);
            edit.onUndo();
            const del = deleteDebtAsset(d, 'debt', 1);
            assert('deleted', d.liabilities.length, 1);
            del.onUndo();
            assert('delete undone in place', JSON.stringify(d), before);
            const a = saveDebtAsset(d, 'asset', null, { name: 'Savings', balance: 5000 });
            assert('asset added', [d.assets[1].name, d.assets[1].balance, debtAssetModel(d, 'asset').total], ['Savings', 5000, 5800]);
            a.onUndo();
            const html = debtAssetBodyHtml(debtAssetModel({ liabilities: [{ id: 'x', name: HOSTILE, balance: 5, interestRate: 1 }] }, 'debt'));
            assert('hostile name escaped', [html.includes('<img'), html.includes('&lt;img')], [false, true]);
        },
    },
];
