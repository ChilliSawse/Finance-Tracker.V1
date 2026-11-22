// Test cases for the "transactions" group (registered in src/test-registry.js).
// Browser only: runs on the throwaway IndexedDB `ledger-test-db`, never the app's DB.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { configureDb, deleteDb, openDb } from './db.js';
import {
    makeTransaction, addTransactions, listTransactions, updateTransaction, deleteImportBatch,
    exportAllTransactions, importTransactions, transactionStatus, countTransactions, isValidIsoDate,
} from './transactions.js';
import { commitImportRows } from './rules.js';
import { learnFromCorrection, applyLearnedRule } from './rule-learn.js';
import { DEFAULT_CATEGORIES, categoryIcon, withFallbackIcons } from './categories.js';

async function fresh() {
    configureDb('ledger-test-db');
    await deleteDb();
}

export const TRANSACTIONS_TEST_CASES = [
    {
        name: 'B2.1 manual rows',
        async fn(assert) {
            await fresh();
            const a = makeTransaction({ date: '2026-11-01', description: 'Coffee', amountCents: -450, source: 'manual' });
            const b = makeTransaction({ date: '2026-11-01', description: 'Coffee', amountCents: -450, source: 'manual' });
            assert('manual hash uses the id', a.hash, 'manual|' + a.id);
            const res = await addTransactions([a, b]);
            assert('both identical manual rows stored', [res.added, res.duplicates], [2, 0]);
            assert('two rows in the store', await countTransactions(), 2);
            const c1 = makeTransaction({ date: '2026-11-01', description: 'Coffee', amountCents: -450, source: 'csv' });
            const c2 = makeTransaction({ date: '2026-11-01', description: 'Coffee', amountCents: -450, source: 'csv' });
            assert('csv hash unchanged by the fix', c1.hash, '2026-11-01|coffee|-450');
            assert('identical csv rows still dedupe', c1.hash === c2.hash, true);
            await deleteDb();
        },
    },
    {
        name: 'B2.2 edit',
        async fn(assert) {
            await fresh();
            const t = makeTransaction({ date: '2026-11-02', description: 'Bank row', amountCents: -1000, source: 'csv', importBatchId: 'b' });
            await addTransactions([t]);
            await updateTransaction({ ...t, description: 'Renamed', hash: 'tampered', note: 'n' });
            const [row] = await listTransactions();
            assert('hash kept on edit', row.hash, t.hash);
            assert('edit applied', [row.description, row.note], ['Renamed', 'n']);
            assert('updatedAt set on edit', typeof row.updatedAt, 'string');
            // A legacy row (no status etc.) written straight to the store reads 'ok'.
            const legacy = { id: 'legacy-1', date: '2026-10-01', description: 'Old', amountCents: -100, categoryId: 'other',
                source: 'csv', importBatchId: null, hash: '2026-10-01|old|-100', createdAt: '2026-10-01T00:00:00.000Z' };
            await importTransactions([legacy]);
            const rows = await listTransactions();
            const l = rows.find(r => r.id === 'legacy-1');
            assert('legacy row reads status ok', l.status, 'ok');
            assert('legacy updatedAt = createdAt', l.updatedAt, legacy.createdAt);
            assert('transactionStatus helper', [transactionStatus(legacy), transactionStatus({ status: 'review' })], ['ok', 'review']);
            await deleteDb();
        },
    },
    {
        name: 'B2.3 reconcile',
        async fn(assert) {
            await fresh();
            const manual = makeTransaction({ date: '2026-11-10', description: 'Lunch', amountCents: -1850, source: 'manual' });
            const far = makeTransaction({ date: '2026-11-20', description: 'Far', amountCents: -1850, source: 'manual' });
            await addTransactions([manual, far]);
            const csv = makeTransaction({ date: '2026-11-13', description: 'CAFE 123 MELB', amountCents: -1850, source: 'csv', importBatchId: 'batch-x' });
            const res = (await commitImportRows([csv])).result;
            assert('merged, not added', [res.added, res.merged, res.duplicates], [0, 1, 0]);
            let rows = await listTransactions();
            assert('still two rows (far one untouched)', rows.length, 2);
            const m = rows.find(r => r.id === manual.id);
            assert('manual row took the bank hash', m.hash, csv.hash);
            assert('manual row flagged reconciled', m.reconciled, true);
            assert('out-of-window manual row not merged', rows.find(r => r.id === far.id).reconciled, undefined);
            const again = (await commitImportRows([csv])).result;
            assert('re-import of the merged row is a duplicate', [again.added, again.merged, again.duplicates], [0, 0, 1]);
            const removed = await deleteImportBatch('batch-x');
            assert('undo removes nothing from the manual row', removed, 0);
            rows = await listTransactions();
            assert('manual row survives the undo', rows.some(r => r.id === manual.id), true);
            // one manual row is claimed by only one imported row; 4 days apart does not merge
            const m2 = makeTransaction({ date: '2026-12-01', description: 'X', amountCents: -500, source: 'manual' });
            await addTransactions([m2]);
            const c3 = makeTransaction({ date: '2026-12-02', description: 'A', amountCents: -500, source: 'csv', importBatchId: 'b2' });
            const c4 = makeTransaction({ date: '2026-12-03', description: 'B', amountCents: -500, source: 'csv', importBatchId: 'b2' });
            const c5 = makeTransaction({ date: '2026-12-05', description: 'C', amountCents: -500, source: 'csv', importBatchId: 'b2' });
            const r2 = (await commitImportRows([c3, c4, c5])).result;
            assert('one-to-one; 4 days does not merge', [r2.added, r2.merged], [2, 1]);
            await deleteDb();
        },
    },
    {
        name: 'B2.4 export',
        async fn(assert) {
            await fresh();
            const rows = [
                makeTransaction({ date: '2026-11-01', description: 'A', amountCents: -100, source: 'manual' }),
                makeTransaction({ date: '2026-11-02', description: 'B', amountCents: 5000, source: 'csv', importBatchId: 'z' }),
            ];
            await addTransactions(rows);
            const out = await exportAllTransactions();
            await deleteDb();
            await fresh();
            const res = await importTransactions(out);
            assert('imported count', res.imported, 2);
            const back = await exportAllTransactions();
            const byId = (x, y) => x.id.localeCompare(y.id);
            assert('round trip deep-equal', back.sort(byId), out.slice().sort(byId));
            await deleteDb();
        },
    },
    {
        name: 'B2.5 categories',
        async fn(assert) {
            const phone = DEFAULT_CATEGORIES.find(c => c.id === 'phone-internet');
            const fit = DEFAULT_CATEGORIES.find(c => c.id === 'fitness');
            assert('phone-internet essential', phone && phone.essential, true);
            assert('fitness non-essential', fit && fit.essential, false);
            assert('fitness keywords', ['anytime fitness', 'gym', 'f45', 'snap fitness'].every(k => fit.keywords.includes(k)), true);
            assert('every default has an icon', DEFAULT_CATEGORIES.every(c => typeof c.icon === 'string' && c.icon), true);
            const saved = [
                { id: 'groceries', name: 'Groceries', essential: true, monthlyBudget: 50, keywords: ['x'] },
                { id: 'mine', name: 'My Thing', essential: false, monthlyBudget: 0, keywords: [], icon: 'star' },
                { id: 'weird', name: 'Zzz', essential: false, monthlyBudget: 0, keywords: [] },
            ];
            const snapshot = JSON.parse(JSON.stringify(saved));
            const out = withFallbackIcons(saved);
            assert('input not mutated', saved, snapshot);
            assert('same ids and order', out.map(c => c.id), ['groceries', 'mine', 'weird']);
            assert('missing icon filled', out.map(c => !!c.icon), [true, true, true]);
            assert('own icon kept', out[1].icon, 'star');
            const strip = (c) => { const { icon, ...rest } = c; return rest; };
            assert('only icon differs', out.map(strip), snapshot.map(strip));
            assert('categoryIcon uses the field', categoryIcon({ id: 'a', icon: 'star' }), 'star');
            assert('categoryIcon falls back by id', categoryIcon({ id: 'groceries' }), DEFAULT_CATEGORIES[0].icon);
            assert('categoryIcon generic fallback', typeof categoryIcon({ id: 'zzz', name: 'Zzz' }), 'string');
        },
    },
    {
        name: 'B2.6 no store bump',
        async fn(assert) {
            await fresh();
            const db = await openDb();
            // B2 added no store (it stayed at 1); F1 then added the scenarios store, so the version is now 2 and no more than that.
            assert('db version is 2 (F1 added scenarios, nothing else)', db.version, 2);
            await deleteDb();
        },
    },
    {
        name: 'S3.L8 identical rows in one statement both import; re-import adds nothing; overlap adds only new rows',
        async fn(assert) {
            await fresh();
            const row = (date, description, amountCents) => makeTransaction({ date, description, amountCents, source: 'csv', importBatchId: 'b' });
            const stmt1 = () => [
                row('2026-11-02', 'CAFE X', -450), row('2026-11-02', 'CAFE X', -450), row('2026-11-03', 'WOOLWORTHS', -2000),
            ];
            const r1 = await addTransactions(stmt1());
            assert('two identical coffees plus one other import', [r1.added, r1.duplicates], [3, 0]);
            assert('three rows stored', await countTransactions(), 3);
            const r2 = await addTransactions(stmt1());
            assert('re-import of the same statement adds nothing', [r2.added, r2.duplicates], [0, 3]);
            assert('still three rows', await countTransactions(), 3);
            // a later statement overlapping the first: same 2 coffees, a 3rd coffee, and a new row
            const r3 = await addTransactions([
                row('2026-11-02', 'CAFE X', -450), row('2026-11-02', 'CAFE X', -450), row('2026-11-02', 'cafe  x', -450),
                row('2026-11-03', 'WOOLWORTHS', -2000), row('2026-11-04', 'NEW SHOP', -999),
            ]);
            assert('only the genuinely new rows are added', [r3.added, r3.duplicates], [2, 3]);
            assert('five rows stored', await countTransactions(), 5);
            await deleteDb();
        },
    },
    {
        name: 'S3.L8b manual rows still merge with imports within 3 days',
        async fn(assert) {
            await fresh();
            const manual = makeTransaction({ date: '2026-11-01', description: 'Lunch', amountCents: -1500, source: 'manual' });
            await addTransactions([manual]);
            const res = (await commitImportRows([makeTransaction({ date: '2026-11-03', description: 'CAFE LUNCH', amountCents: -1500, source: 'csv', importBatchId: 'b' })])).result;
            assert('merged into the manual row', [res.added, res.merged], [0, 1]);
            assert('one row', await countTransactions(), 1);
            await deleteDb();
        },
    },
    {
        name: 'A12b.6 the manual/import merge runs once: addTransactions only adds, commitImportRows merges',
        async fn(assert) {
            await fresh();
            const manual = makeTransaction({ date: '2026-11-01', description: 'Lunch', amountCents: -1500, source: 'manual' });
            await addTransactions([manual]);
            const csv = makeTransaction({ date: '2026-11-02', description: 'CAFE', amountCents: -1500, source: 'csv', importBatchId: 'b' });
            const plain = await addTransactions([csv]);
            assert('addTransactions alone does not merge', [plain.added, plain.merged], [1, 0]);
            assert('two rows now', await countTransactions(), 2);
            await deleteDb();
            await fresh();
            await addTransactions([manual]);
            const both = await commitImportRows([csv]);
            assert('the import path merges exactly once', [both.result.added, both.result.merged, both.merges.length], [0, 1, 1]);
            assert('one row', await countTransactions(), 1);
            await deleteDb();
        },
    },
    {
        name: 'S3.L3 impossible dates are skipped and counted, never stored or thrown',
        async fn(assert) {
            await fresh();
            assert('valid', isValidIsoDate('2026-02-28'), true);
            assert('31 Feb', isValidIsoDate('2026-02-31'), false);
            assert('29 Feb non-leap', isValidIsoDate('2026-02-29'), false);
            assert('29 Feb leap', isValidIsoDate('2028-02-29'), true);
            assert('garbage', isValidIsoDate('2026-1-1'), false);
            const res = await addTransactions([
                makeTransaction({ date: '2026-02-31', description: 'BAD', amountCents: -100, source: 'pdf', importBatchId: 'b' }),
                makeTransaction({ date: '2026-02-27', description: 'GOOD', amountCents: -100, source: 'pdf', importBatchId: 'b' }),
            ]);
            assert('one added, one invalid', [res.added, res.invalid], [1, 1]);
            await deleteDb();
        },
    },
    {
        name: 'H9.1 the suggested transfer flag survives the store, a backup export and a restore',
        async fn(assert) {
            await fresh();
            const a = makeTransaction({ date: '2026-11-02', description: 'To Fire', amountCents: -30000, categoryId: 'transfer', source: 'csv', status: 'review', bucketId: 'fire', bucketSuggested: true, importBatchId: 'b' });
            const m = makeTransaction({ date: '2026-11-02', description: 'Coffee', amountCents: -450, source: 'manual' });
            await addTransactions([a, m]);
            const listed = (await listTransactions()).find((r) => r.id === a.id);
            assert('stored with the flag', [listed.bucketId, listed.bucketSuggested, listed.status, listed.categoryId], ['fire', true, 'review', 'transfer']);
            await updateTransaction({ ...listed, status: 'ok', bucketSuggested: undefined });
            const edited = (await listTransactions()).find((r) => r.id === a.id);
            assert('an edit that clears it clears it', [edited.status, edited.bucketId, edited.bucketSuggested], ['ok', 'fire', undefined]);
            await updateTransaction({ ...edited, bucketSuggested: true, status: 'review' });
            const exported = await exportAllTransactions();
            assert('export carries the flag and the bucket', exported.filter((r) => r.bucketSuggested).map((r) => r.bucketId), ['fire']);
            await deleteDb();
            await fresh();
            await importTransactions(JSON.parse(JSON.stringify(exported)));
            const back = (await listTransactions()).find((r) => r.id === a.id);
            assert('restored with the flag', [back.bucketId, back.bucketSuggested, back.categoryId], ['fire', true, 'transfer']);
            await deleteDb();
        },
    },
    {
        name: 'DB9.5 learn on correct: offer count, apply to stored rows, undo',
        async fn(assert) {
            await fresh();
            const mk = (description, o) => makeTransaction({ date: '2026-11-01', description, amountCents: -700, source: 'csv', categoryId: 'other', status: 'review', ...o });
            const edited = mk('ZEDCO 1 NEWTOWN');
            const rows = [mk('ZEDCO 2'), mk('ZEDCO 3', { status: 'ok' }), mk('QWERTY 4'), mk('ZEDCO 5', { categoryId: 'transfer' })];
            await addTransactions([edited, ...rows]);
            await updateTransaction({ ...edited, categoryId: 'dining', status: 'ok' }); // what Quick-add saves before it learns
            const data = { rules: [], categories: DEFAULT_CATEGORIES };
            const l = await learnFromCorrection(data, edited, 'dining');
            assert('rule learned, one unconfirmed same-key row offered', [data.rules, l.count], [[{ key: 'zedco', categoryId: 'dining' }], 1]);
            assert('nothing else changed until Apply (only the edited row is dining)', (await listTransactions()).filter((r) => r.categoryId === 'dining').length, 1);
            const res = await applyLearnedRule(l.rule);
            const after = await listTransactions();
            const get = (d) => after.find((r) => r.description === d);
            assert('applied count and the one row', [res.count, get('ZEDCO 2').categoryId, get('ZEDCO 2').status], [1, 'dining', 'ok']);
            assert('confirmed, other-merchant and transfer rows untouched', [get('ZEDCO 3').categoryId, get('QWERTY 4').status, get('ZEDCO 5').categoryId], ['other', 'review', 'transfer']);
            await res.undo();
            const back = (await listTransactions()).find((r) => r.description === 'ZEDCO 2');
            assert('undo puts the row back', [back.categoryId, back.status], ['other', 'review']);
            const none = await learnFromCorrection(data, mk('VISA DEBIT PURCHASE CARD 1234'), 'dining');
            assert('a rail-only description learns nothing', [none, data.rules.length], [null, 1]);
            await deleteDb();
        },
    },
];
