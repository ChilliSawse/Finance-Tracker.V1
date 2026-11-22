// Test cases for the "transfers" group (H9, owner ruling FT-R-119, registered in src/test-registry.js).
// Where a transfer went: the bank-label match, the import suggestion, transfers kept out of spending,
// the backup round trip. Synthetic data only. Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    isTransferRow, normaliseLabelText, matchBucketLabel, transferSuggestion, MIN_LABEL_LENGTH,
} from './transfers.js';
import { resolveImportRow, suggestedTransfersLine } from '../state/rules.js';
import { leftThisPay } from './pay-cycle.js';
import { buildTodayModel, buildActivityFeed } from '../state/today-model.js';
import { loadSpendCache, getSpendCache } from '../state/spend-cache.js';
import { makeTransaction } from '../state/transactions.js';
import { buildBackupBundle, sanitizeTransactionRows, collectRecoveryBundle, prepareBackup } from '../state/backup.js';
import { SAVE_KEY } from '../state/sanitize.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings } from '../state/defaults.js';
import { DEFAULT_CATEGORIES } from '../state/categories.js';

const ALLOC = [
    { id: 'daily', role: 'daily', name: 'Daily', percentage: 60, kind: 'spend', bankLabel: '' },
    { id: 'splurge', role: 'splurge', name: 'Splurge', percentage: 10, kind: 'spend', bankLabel: 'Fun money' },
    { id: 'smile', role: 'smile', name: 'Smile', percentage: 10, kind: 'save', bankLabel: 'Smile Saver' },
    { id: 'fire', role: 'fire', name: 'Fire', percentage: 20, kind: 'save', bankLabel: 'Fire' },
];

export const TRANSFERS_TEST_CASES = [
    {
        name: 'H9.1 isTransferRow: the transfer category, or a category of kind transfer',
        fn(assert) {
            assert('by category id', isTransferRow({ categoryId: 'transfer' }), true);
            assert('by category kind', isTransferRow({ categoryId: 'xfer' }, { id: 'xfer', kind: 'transfer' }), true);
            assert('an ordinary row', isTransferRow({ categoryId: 'groceries' }, { id: 'groceries' }), false);
            assert('no row', isTransferRow(null), false);
        },
    },
    {
        name: 'H9.2 bank label match: case, punctuation and spaces are ignored, whole words only',
        fn(assert) {
            const m = (d, a = ALLOC) => matchBucketLabel(d, a);
            assert('plain', m('Transfer to Fire'), { bucketId: 'fire', ambiguous: false });
            assert('upper case bank text', m('NETBANK TRANSFER TO FIRE 12345'), { bucketId: 'fire', ambiguous: false });
            assert('punctuation and extra spaces', m('osko  payment -- FIRE!'), { bucketId: 'fire', ambiguous: false });
            assert('a label with a space', m('Transfer to SMILE   saver'), { bucketId: 'smile', ambiguous: false });
            assert('a label typed with odd case and punctuation', m('transfer to fun-money', [{ id: 'x', bankLabel: ' FUN  Money. ' }]), { bucketId: 'x', ambiguous: false });
            assert('a longer word that only contains the label is not a match', m('FIRESTONE TYRES'), { bucketId: null, ambiguous: false });
            assert('a label inside another word is not a match', m('Bonfire night'), { bucketId: null, ambiguous: false });
            assert('accents are folded', m('Transfer to Café Fund', [{ id: 'c', bankLabel: 'Cafe Fund' }]), { bucketId: 'c', ambiguous: false });
            assert('no label, no match', m('Transfer to Daily'), { bucketId: null, ambiguous: false });
            assert('empty description', m(''), { bucketId: null, ambiguous: false });
            assert('normalise', normaliseLabelText('  Fire  Fund! '), 'fire fund');
        },
    },
    {
        name: 'H9.3 very short labels never match; the shortest allowed is three letters or digits',
        fn(assert) {
            assert('the floor', MIN_LABEL_LENGTH, 3);
            const one = [{ id: 'a', bankLabel: 'A' }, { id: 'b', bankLabel: 'ab' }, { id: 'c', bankLabel: ' - ' }];
            assert('one and two characters, and punctuation only, are ignored', matchBucketLabel('Payment to A and AB account', one), { bucketId: null, ambiguous: false });
            assert('three characters match as a whole word', matchBucketLabel('Transfer to ING Direct', [{ id: 'ing', bankLabel: 'ING' }]), { bucketId: 'ing', ambiguous: false });
            assert('three characters do not match inside a word', matchBucketLabel('Cooking supplies', [{ id: 'ing', bankLabel: 'ING' }]), { bucketId: null, ambiguous: false });
            assert('spaces do not pad a short label', matchBucketLabel('a b to c', [{ id: 'x', bankLabel: 'a b' }]), { bucketId: null, ambiguous: false });
            assert('a label that is not text', matchBucketLabel('Transfer to 123', [{ id: 'n', bankLabel: 123 }, null, { bankLabel: 'Fire' }]), { bucketId: null, ambiguous: false });
        },
    },
    {
        name: 'H9.4 two buckets match: the longer label wins, a tie gives none',
        fn(assert) {
            const two = [{ id: 'fire', bankLabel: 'Fire' }, { id: 'fund', bankLabel: 'Fire Fund' }];
            assert('the more specific label wins', matchBucketLabel('Transfer to Fire Fund', two), { bucketId: 'fund', ambiguous: false });
            assert('the shorter one when only it is named', matchBucketLabel('Transfer to Fire', two), { bucketId: 'fire', ambiguous: false });
            const tie = [{ id: 'a', bankLabel: 'Holiday' }, { id: 'b', bankLabel: 'Savings' }];
            assert('two different buckets tied: no guess', matchBucketLabel('Holiday Savings transfer', tie), { bucketId: null, ambiguous: true });
            const same = [{ id: 'a', bankLabel: 'Holiday' }, { id: 'a', bankLabel: 'holiday' }];
            assert('the same bucket twice is not a clash', matchBucketLabel('Holiday', same), { bucketId: 'a', ambiguous: false });
            assert('a tie does not hide a longer unique match', matchBucketLabel('Holiday Savings Trip', [...tie, { id: 'c', bankLabel: 'Savings Trip' }]), { bucketId: 'c', ambiguous: false });
        },
    },
    {
        name: 'H9.5 the import suggestion: outgoing only, never over a learned rule or a pick, and it is flagged for review',
        fn(assert) {
            const out = { description: 'Transfer to Fire', amountCents: -50000 };
            assert('a match is a suggested transfer left in To review', transferSuggestion(out, { allocation: ALLOC, categoryBy: 'none' }),
                { categoryId: 'transfer', bucketId: 'fire', bucketSuggested: true, status: 'review' });
            assert('a keyword category is overridden by the bank label', transferSuggestion(out, { allocation: ALLOC, categoryBy: 'keyword' }).bucketId, 'fire');
            assert('money in is not a transfer out', transferSuggestion({ ...out, amountCents: 50000 }, { allocation: ALLOC }), null);
            assert('a learned rule wins', transferSuggestion(out, { allocation: ALLOC, categoryBy: 'rule' }), null);
            assert('a category picked in the preview wins', transferSuggestion(out, { allocation: ALLOC, chosenCategoryId: 'groceries' }), null);
            assert('no label match', transferSuggestion({ description: 'Woolworths', amountCents: -1200 }, { allocation: ALLOC }), null);
            assert('ambiguous gives none', transferSuggestion({ description: 'Holiday and Savings', amountCents: -100 }, { allocation: [{ id: 'a', bankLabel: 'Holiday' }, { id: 'b', bankLabel: 'Savings' }] }), null);
        },
    },
    {
        name: 'H9.6 resolveImportRow: a match becomes a suggested transfer, everything else is stored as before',
        fn(assert) {
            const data = { categories: DEFAULT_CATEGORIES, allocation: ALLOC, rules: [] };
            assert('suggested transfer', resolveImportRow('NETBANK Transfer to Fire', -30000, undefined, data),
                { categoryId: 'transfer', bucketId: 'fire', bucketSuggested: true, status: 'review' });
            assert('unchanged: a keyword row', resolveImportRow('WOOLWORTHS 1234', -4500, undefined, data), { categoryId: 'groceries', status: 'ok' });
            assert('unchanged: an unknown row still needs review', resolveImportRow('Mystery payee', -900, undefined, data), { categoryId: 'other', status: 'review' });
            assert('unchanged: a preview pick', resolveImportRow('Transfer to Fire', -30000, 'shopping', data), { categoryId: 'shopping', status: 'ok' });
            const ruled = { ...data, rules: [{ key: 'transfer to', categoryId: 'shopping' }] };
            assert('a learned rule beats the bank label', resolveImportRow('Transfer to Fire', -30000, undefined, ruled).categoryId, 'shopping');
            assert('money in is not touched', resolveImportRow('Fire payout', 30000, undefined, data).categoryId !== 'transfer', true);
            assert('no data at all', resolveImportRow('Mystery payee', -1, undefined, null).categoryId, 'other');
            assert('own-account wording is a transfer even with no bucket data (DB2)', resolveImportRow('Transfer to Fire', -1, undefined, null).categoryId, 'transfer');
            const rows = [{ bucketSuggested: true }, { bucketSuggested: true }, {}];
            assert('summary line, many', suggestedTransfersLine(rows), '2 looked like transfers to your buckets. Check them in To review.');
            assert('summary line, one', suggestedTransfersLine([{ bucketSuggested: true }]), '1 looked like a transfer to one of your buckets. Check it in To review.');
            assert('summary line, none', suggestedTransfersLine([{}]), '');
        },
    },
    {
        name: 'H9.7 transfers stay out of spending: left this pay, Today, Activity totals and the spend cache',
        fn(assert) {
            const SOURCE = { incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: '2026-10-31', grossAnnual: 90000 };
            const data = {
                dataVersion: 2, incomeSources: [SOURCE], primaryIncomeIndex: 0, allocation: ALLOC,
                categories: [{ id: 'groceries', name: 'Groceries', essential: true }, { id: 'income', name: 'Income' }, { id: 'other', name: 'Other' }], plan: [],
            };
            const base = [
                { id: 'pay', date: '2026-10-31', categoryId: 'income', amountCents: 343843, description: 'Pay', source: 'csv', createdAt: 'x' },
                { id: 'g', date: '2026-11-02', categoryId: 'groceries', amountCents: -10000, description: 'Shop', source: 'csv', createdAt: 'x' },
            ];
            const xfer = { id: 'x', date: '2026-11-03', categoryId: 'transfer', amountCents: -60000, description: 'To Fire', bucketId: 'fire', source: 'manual', createdAt: 'x' };
            const xin = { id: 'xi', date: '2026-11-03', categoryId: 'transfer', amountCents: 20000, description: 'From Fire', source: 'manual', createdAt: 'x' };
            const today = '2026-11-04';
            const a = leftThisPay({ data, txns: base, today });
            const b = leftThisPay({ data, txns: [...base, xfer, xin], today });
            assert('left this pay is the same', [b.spentCents, b.leftCents, b.unsortedCents, b.essentialSoFarCents, b.nonEssentialSoFarCents],
                [a.spentCents, a.leftCents, a.unsortedCents, a.essentialSoFarCents, a.nonEssentialSoFarCents]);
            const m = buildTodayModel({ data, rows: [...base, xfer, xin], today });
            assert('Today by-category has no transfer', m.byCategory.map((c) => c.categoryId), ['groceries']);
            assert('Today spend by day has no transfer', m.spendByDay, [{ date: '2026-11-02', spentCents: 10000 }]);
            const feed = buildActivityFeed({ data, rows: [...base, xfer, xin], today });
            assert('Activity spent total and where-it-went have no transfer', [feed.spentCents, feed.whereItWent.map((w) => w.categoryId)], [10000, ['groceries']]);
            assert('the transfer rows are still listed', feed.days.flatMap((d) => d.items).filter((i) => i.type === 'txn' && i.row.categoryId === 'transfer').length, 2);
            assert('and no day total counts them', feed.days.map((d) => d.totalCents).sort(), [0, 0, 10000]);
            loadSpendCache([...base, xfer, xin], { data, today });
            const c = getSpendCache();
            assert('spend cache: month, year and cycle totals', [c.monthTotalCents, c.yearTotalCents, c.yearIncomeCents, [...c.cycleByCategory.keys()]],
                [10000, 10000, 343843, ['groceries']]);
            assert('the rows themselves stay in the cache for Today to read', c.rows.length, 4);
        },
    },
    {
        name: 'H9.8 the suggested flag is stored on the row and survives backup, restore and the boot recovery bundle',
        async fn(assert) {
            const row = makeTransaction({ date: '2026-11-03', description: 'To Fire', amountCents: -30000, categoryId: 'transfer', source: 'csv', status: 'review', bucketId: 'fire', bucketSuggested: true });
            assert('makeTransaction keeps the flag', [row.bucketId, row.bucketSuggested, row.status], ['fire', true, 'review']);
            const plain = makeTransaction({ date: '2026-11-03', description: 'x', amountCents: -1, bucketId: 'fire', bucketSuggested: false });
            assert('a false flag is not stored', 'bucketSuggested' in plain, false);
            const noBucket = makeTransaction({ date: '2026-11-03', description: 'x', amountCents: -1 });
            assert('absent when not given', ['bucketId' in noBucket, 'bucketSuggested' in noBucket], [false, false]);
            // backup file: build, serialise, read back through the sanitiser the restore uses
            const bundle = buildBackupBundle({ financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), partRows: { transactions: [row] } });
            const back = sanitizeTransactionRows(JSON.parse(JSON.stringify(bundle)).transactions);
            assert('backup file round trip', [back.skipped, back.rows[0].bucketId, back.rows[0].bucketSuggested, back.rows[0].categoryId], [0, 'fire', true, 'transfer']);
            // boot recovery bundle (U3): the same rows come out of the part reader and through prepareBackup
            const parts = [{ key: 'transactions', read: async () => [{ ...row }], sanitize: sanitizeTransactionRows, replace: async () => {} },
                { key: 'events', read: async () => [], sanitize: (r) => ({ rows: r, skipped: 0 }), replace: async () => {} }];
            const map = new Map([[SAVE_KEY, JSON.stringify({ financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), timestamp: '2026-11-20T00:00:00Z' })]]);
            const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null };
            const out = await collectRecoveryBundle({ storage, parts, now: new Date('2026-11-22T00:00:00Z') });
            assert('recovery bundle carries the flag', [out.bundle.transactions[0].bucketId, out.bundle.transactions[0].bucketSuggested], ['fire', true]);
            const prepared = prepareBackup(JSON.stringify(out.bundle), parts);
            assert('and the normal restore reads it back whole', [prepared.ok, prepared.counts.transactions], [true, 1]);
        },
    },
];
