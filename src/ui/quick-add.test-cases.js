// Test cases for the "quick-add" group (registered in src/test-registry.js).
// A8.1: the Repeat option builds the plan item addPlanItem receives; a plain save builds none.
// A8.2: category guess, chip order, wording, bucket choice, the saved row. Pure, no DOM.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    parseAmountCents, guessCategory, orderCategoryChips, categoryLine, resolveBucket, bucketLine,
    afterThisCents, buildTransactionFields, buildRepeatPlanItem, wentToChoices,
} from './quick-add-model.js';
import { DEFAULT_CATEGORIES } from '../state/categories.js';
import { makeTransaction } from '../state/transactions.js';
import { addPlanItem } from '../state/plan.js';

const cats = DEFAULT_CATEGORIES;
const byId = (id) => cats.find((c) => c.id === id);
const alloc = [
    { id: 'a-daily', role: 'daily', percentage: 50 },
    { id: 'a-splurge', role: 'splurge', percentage: 20 },
    { id: 'a-smile', role: 'smile', percentage: 20 },
    { id: 'a-fire', role: 'fire', percentage: 10 },
];

export const QUICK_ADD_TEST_CASES = [
    {
        name: 'A8.1 Repeat builds the plan item addPlanItem receives, a plain save builds none',
        fn(assert) {
            const fields = buildRepeatPlanItem({
                note: 'Gym membership', category: byId('fitness'), amountCents: 1850, frequency: 'fortnightly', date: '2026-11-14',
            });
            assert('fields', fields, { name: 'Gym membership', amount: 18.5, frequency: 'fortnightly', anchorDue: '2026-11-14', categoryId: 'fitness' });
            const data = { plan: [] };
            const res = addPlanItem(data, fields);
            assert('the plan item has the entry date as anchorDue', [res.ok, data.plan.length, data.plan[0].anchorDue, data.plan[0].amount, data.plan[0].frequency], [true, 1, '2026-11-14', 18.5, 'fortnightly']);
            assert('it counts in totals', data.plan[0].inTotals, true);
            res.onUndo();
            assert('undo removes it', data.plan.length, 0);
            assert('a blank note falls back to the category name', buildRepeatPlanItem({ note: '  ', category: byId('dining'), amountCents: 500, frequency: 'weekly', date: '2026-11-14' }).name, 'Dining & Takeaway');
            assert('an unknown frequency becomes monthly', buildRepeatPlanItem({ note: 'x', category: null, amountCents: 100, frequency: 'daily', date: '2026-11-14' }).frequency, 'monthly');
            assert('a changed bucket rides along', buildRepeatPlanItem({ note: 'x', category: byId('dining'), amountCents: 100, frequency: 'weekly', date: '2026-11-14', store: 'a-smile' }).bucketId, 'a-smile');
            const plain = buildTransactionFields({ kind: 'spending', amountCents: 1250, category: byId('dining'), note: 'Brunch', date: '2026-11-14' });
            assert('a plain save carries no plan fields', ['frequency', 'anchorDue', 'amount'].map((k) => k in plain), [false, false, false]);
        },
    },
    {
        name: 'A8.2 category guess from the note, and no match',
        fn(assert) {
            assert('coffee is Dining', guessCategory('Coffee at the cafe', cats), { categoryId: 'dining', guessed: true });
            assert('Woolworths is Groceries', guessCategory('Woolworths metro', cats).categoryId, 'groceries');
            assert('nothing matches', guessCategory('Flowers for Mum', cats), { categoryId: null, guessed: false });
            assert('empty note', guessCategory('', cats), { categoryId: null, guessed: false });
        },
    },
    {
        name: 'A8.2 chip order: chosen first, then most used, then saved order; top six plus More',
        fn(assert) {
            const plain = orderCategoryChips(cats, {});
            assert('saved order, six on top', plain.top, ['groceries', 'housing', 'utilities', 'phone-internet', 'transport', 'health']);
            assert('Income is never offered for spending', [...plain.top, ...plain.more].includes('income'), false);
            assert('the rest sit under More', plain.more.length, cats.length - 1 - 6);
            const used = orderCategoryChips(cats, { counts: { dining: 5, entertainment: 2 } });
            assert('most used first', used.top.slice(0, 2), ['dining', 'entertainment']);
            const sel = orderCategoryChips(cats, { selectedId: 'travel', counts: { dining: 5 } });
            assert('chosen beats used', sel.top.slice(0, 2), ['travel', 'dining']);
            assert('income kind', orderCategoryChips(cats, { kind: 'income' }).top, ['income', 'other']);
            assert('counts as a Map', orderCategoryChips(cats, { counts: new Map([['shopping', 3]]) }).top[0], 'shopping');
        },
    },
    {
        name: 'A8.2 wording: category line and bucket line (FT-R-46)',
        fn(assert) {
            assert('guessed', categoryLine(byId('dining'), true), 'Dining & Takeaway · guessed from your note');
            assert('picked, non-essential', categoryLine(byId('dining'), false), 'Dining & Takeaway · Non-essential');
            assert('picked, essential', categoryLine(byId('groceries'), false), 'Groceries · Essential');
            const line = (o) => bucketLine({ category: byId('dining'), ...o });
            assert('unchanged', line({ changed: false, usualName: 'Splurge' }), 'from Dining & Takeaway');
            assert('changed', line({ changed: true, usualName: 'Splurge' }), 'changed for this purchase; usually Splurge');
            assert('no category, nothing chosen', bucketLine({ category: null }), 'No category to take it from, so choose where it comes out of.');
            assert('no category, chosen', bucketLine({ category: null, chosenName: 'Smile' }), 'Chosen by you.');
        },
    },
    {
        name: 'A8.2 the default bucket follows the essential flag; bucketId is stored only when it differs',
        fn(assert) {
            const dining = resolveBucket({ category: byId('dining'), choiceId: null, allocation: alloc });
            assert('Dining goes to Splurge (FT-R-47)', [dining.usualId, dining.bucketId, dining.changed, dining.store], ['a-splurge', 'a-splurge', false, undefined]);
            const groc = resolveBucket({ category: byId('groceries'), choiceId: null, allocation: alloc });
            assert('Groceries goes to Daily', groc.bucketId, 'a-daily');
            const same = resolveBucket({ category: byId('dining'), choiceId: 'a-splurge', allocation: alloc });
            assert('choosing the usual bucket stores nothing', [same.changed, same.store], [false, undefined]);
            const changed = resolveBucket({ category: byId('dining'), choiceId: 'a-smile', allocation: alloc });
            assert('a different bucket is stored', [changed.changed, changed.store, changed.usualId], [true, 'a-smile', 'a-splurge']);
            const custom = resolveBucket({ category: { ...byId('dining'), bucketId: 'a-fire' }, choiceId: null, allocation: alloc });
            assert('a category bucket link wins (FT-R-70)', custom.bucketId, 'a-fire');
            const none = resolveBucket({ category: null, choiceId: 'a-daily', allocation: alloc });
            assert('no category: a choice is always stored', [none.usualId, none.store], [null, 'a-daily']);
            assert('no category, no choice', resolveBucket({ category: null, choiceId: null, allocation: alloc }).store, undefined);
            assert('a stale choice is ignored', resolveBucket({ category: byId('dining'), choiceId: 'gone', allocation: alloc }).store, undefined);
        },
    },
    {
        name: 'A8.2 amount parsing, after-this figure and the saved row',
        fn(assert) {
            assert('12.50', parseAmountCents('12.50'), 1250);
            assert('A$1,200', parseAmountCents('A$1,200'), 120000);
            assert('.5', parseAmountCents('.5'), 50);
            assert('zero', parseAmountCents('0'), null);
            assert('text', parseAmountCents('abc'), null);
            assert('three decimals', parseAmountCents('1.234'), null);
            assert('negative', parseAmountCents('-5'), null);
            assert('after this', afterThisCents(42222, 1250), 40972);
            assert('over', afterThisCents(1000, 1250), -250);
            const spend = buildTransactionFields({ kind: 'spending', amountCents: 1250, category: byId('dining'), note: ' Brunch ', date: '2026-11-04', store: 'a-smile' });
            assert('spending row', spend, { date: '2026-11-04', description: 'Brunch', amountCents: -1250, categoryId: 'dining', source: 'manual', note: 'Brunch', bucketId: 'a-smile' });
            const inc = buildTransactionFields({ kind: 'income', amountCents: 5000, category: byId('income'), note: '', date: '2026-11-04' });
            assert('income row is positive, no bucketId, named for the category', [inc.amountCents, inc.description, 'bucketId' in inc], [5000, 'Income', false]);
            assert('no category falls to other', buildTransactionFields({ kind: 'spending', amountCents: 100, category: null, note: 'x', date: '2026-11-04' }).categoryId, 'other');
        },
    },
    {
        name: 'A8.2 two identical coffees both save (manual rows hash on their own id)',
        fn(assert) {
            const f = buildTransactionFields({ kind: 'spending', amountCents: 450, category: byId('dining'), note: 'Coffee', date: '2026-11-04' });
            const a = makeTransaction(f), b = makeTransaction(f);
            assert('different ids', a.id !== b.id, true);
            assert('different hashes', a.hash !== b.hash, true);
            assert('hash is manual|id', a.hash, 'manual|' + a.id);
        },
    },
    {
        name: 'H9.1 a transfer is saved as category transfer, money out, with where it went',
        fn(assert) {
            const f = buildTransactionFields({ kind: 'transfer', amountCents: 25000, category: null, note: 'To Fire', date: '2026-11-14', store: 'a-fire' });
            assert('fields', f, { date: '2026-11-14', description: 'To Fire', amountCents: -25000, categoryId: 'transfer', source: 'manual', note: 'To Fire', bucketId: 'a-fire' });
            const none = buildTransactionFields({ kind: 'transfer', amountCents: 100, category: null, note: '', date: '2026-11-14' });
            assert('Somewhere else stores no bucket, and a blank note is named Transfer', ['bucketId' in none, none.description], [false, 'Transfer']);
            const inc = buildTransactionFields({ kind: 'transfer', amountCents: 100, category: null, note: 'x', date: '2026-11-14', store: 'a-fire', incoming: true });
            assert('an existing money-in transfer stays money in and takes no bucket', [inc.amountCents, 'bucketId' in inc], [100, false]);
            assert('a transfer is never given a suggested flag', 'bucketSuggested' in f, false);
            const row = makeTransaction(f);
            assert('it makes a manual row', [row.categoryId, row.bucketId, row.source], ['transfer', 'a-fire', 'manual']);
        },
    },
    {
        name: 'H9.2 the Went to choices: every top-level bucket, then goals under a saving bucket',
        fn(assert) {
            const b = [
                { id: 'd', name: 'Daily', kind: 'spend', parentId: null }, { id: 'f', name: 'Fire', kind: 'save', parentId: null },
                { id: 's', name: 'Smile', kind: 'save', parentId: null }, { id: 'g1', name: 'Trip', kind: 'goal', parentId: 's' },
                { id: 'g2', name: 'Lunch', kind: 'goal', parentId: 'd' }, { id: 'g3', name: 'Orphan', kind: 'goal', parentId: 'zz' },
            ];
            assert('choices', wentToChoices(b), [
                { id: 'd', name: 'Daily', kind: 'spend', parentName: null }, { id: 'f', name: 'Fire', kind: 'save', parentName: null },
                { id: 's', name: 'Smile', kind: 'save', parentName: null }, { id: 'g1', name: 'Trip', kind: 'goal', parentName: 'Smile' },
            ]);
            assert('empty', wentToChoices(null), []);
        },
    },
];
