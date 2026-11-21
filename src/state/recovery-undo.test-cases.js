// U3: the boot recovery panel covers transactions and events too, and a restore can be undone.
// Pure groups use in-memory stand-ins for localStorage, the IndexedDB parts and the safety database;
// the browser group clicks the real Undo toast. Synthetic data only.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    BACKUP_PARTS, buildBackupBundle, prepareBackup, commitBackup, commitErase, undoLastRestore,
    sanitizeTransactionRows, sanitizeEventRows, collectRecoveryBundle, restoreFromRecovery,
    restoreCopyInfo, restoreUndoToast,
} from './backup.js';
import { PRE_RESTORE_KEY, SAVE_KEY, CORRUPT_PREFIX } from './sanitize.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings } from './defaults.js';
import { createToastQueue, showUndoToast } from '../ui/toast.js';
import { addUndoRestoreRow } from '../ui/restore-copy-row.js';

const TXNS = [
    { id: 't1', date: '2026-11-02', description: 'Corner cafe', amountCents: -450, categoryId: 'eating-out', source: 'manual', hash: 'manual|t1', createdAt: '2026-11-02T01:00:00Z' },
    { id: 't2', date: '2026-11-03', description: 'Pay', amountCents: 250000, categoryId: 'income', source: 'csv', hash: '2026-11-03|pay|250000', createdAt: '2026-11-03T01:00:00Z' },
];
const EVENTS = [{ id: 'e1', ts: '2026-11-02T01:00:00Z', seq: 1000, type: 'note', data: { text: 'hello' } }];
const OLD_TXNS = [{ id: 'old1', date: '2026-01-05', description: 'Earlier shop', amountCents: -999, categoryId: 'groceries', source: 'manual', hash: 'manual|old1', createdAt: '2026-01-05T01:00:00Z' }];
const OLD_EVENTS = [{ id: 'oe1', ts: '2026-01-05T01:00:00Z', seq: 5, type: 'note', data: { text: 'earlier' } }];

function memStorage(initial = {}, { failSetKey } = {}) {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem(k, v) { if (k === failSetKey) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
    };
}

function memSafety() {
    const box = { rec: undefined };
    return {
        box,
        put: async (r) => { box.rec = JSON.parse(JSON.stringify(r)); },
        get: async () => (box.rec === undefined ? undefined : JSON.parse(JSON.stringify(box.rec))),
        remove: async () => { box.rec = undefined; },
    };
}

function fakeParts(initial = {}, { failRead, failReplace, hangRead } = {}) {
    const data = { transactions: [], events: [], ...initial };
    const mk = (key, sanitize) => ({
        key,
        read: async () => {
            if (failRead === key) throw new Error('the database is damaged');
            if (hangRead === key) return new Promise(() => {});
            return data[key].map((r) => ({ ...r }));
        },
        sanitize,
        replace: async (rows) => { if (failReplace === key) throw new Error('boom'); data[key] = rows.map((r) => ({ ...r })); },
    });
    return { data, parts: [mk('transactions', sanitizeTransactionRows), mk('events', sanitizeEventRows)] };
}

const savedText = (marker) => JSON.stringify({
    financeData: { ...cloneDefaultFinanceData(), marker }, guiSettings: cloneDefaultGuiSettings(), timestamp: '2026-11-20T00:00:00Z',
});
const fakeStore = (marker = 'device') => ({ financeData: { ...cloneDefaultFinanceData(), marker }, guiSettingsData: cloneDefaultGuiSettings() });
const bundleText = (marker, rows) => JSON.stringify(buildBackupBundle({
    financeData: { ...cloneDefaultFinanceData(), marker }, guiSettings: cloneDefaultGuiSettings(), partRows: rows,
}));

export const RECOVERY_UNDO_TEST_CASES = [
    {
        name: 'U3.1 the recovery export is a full bundle: settings plus transactions and events, and it restores through the normal path',
        async fn(assert) {
            const dev = fakeParts({ transactions: TXNS, events: EVENTS });
            const st = memStorage({ [SAVE_KEY]: savedText('mine') });
            const out = await collectRecoveryBundle({ storage: st, parts: dev.parts, now: new Date('2026-11-22T00:00:00Z') });
            assert('nothing unreadable', out.unreadable, []);
            assert('bundle v2 with every part', [out.bundle.version, out.bundle.app, out.bundle.transactions, out.bundle.events], [2, 'ledger', TXNS, EVENTS]);
            assert('settings carried', out.bundle.financeData.marker, 'mine');
            const prepared = prepareBackup(JSON.stringify(out.bundle), dev.parts);
            assert('the normal restore accepts it', [prepared.ok, prepared.counts], [true, { transactions: 2, events: 1 }]);
        },
    },
    {
        name: 'U3.2 partial read: events unreadable, saved settings corrupt, a part that hangs; the export still happens and names what failed',
        async fn(assert) {
            const a = fakeParts({ transactions: TXNS, events: EVENTS }, { failRead: 'events' });
            const o1 = await collectRecoveryBundle({ storage: memStorage({ [SAVE_KEY]: savedText('m') }), parts: a.parts });
            assert('transactions kept, events named', [o1.bundle.transactions, 'events' in o1.bundle, o1.unreadable, o1.anything], [TXNS, false, ['events'], true]);
            assert('settings still in', o1.bundle.financeData.marker, 'm');

            const b = fakeParts({ transactions: TXNS, events: EVENTS });
            const o2 = await collectRecoveryBundle({ storage: memStorage({ [SAVE_KEY]: '{"financeData": {oops' }), parts: b.parts });
            assert('corrupt settings named, rows kept, raw text carried', [o2.unreadable, o2.bundle.transactions, o2.bundle.unreadableSettingsText, 'financeData' in o2.bundle], [['settings'], TXNS, '{"financeData": {oops', false]);

            const c = fakeParts({ transactions: TXNS, events: EVENTS }, { hangRead: 'transactions' });
            const o3 = await collectRecoveryBundle({ storage: memStorage({ [SAVE_KEY]: savedText('m') }), parts: c.parts, timeoutMs: 30 });
            assert('a hanging part gives up and is named', [o3.unreadable, o3.bundle.events], [['transactions'], EVENTS]);

            const d = fakeParts({}, { failRead: 'events' });
            d.parts[0].read = async () => { throw new Error('nope'); };
            const o4 = await collectRecoveryBundle({ storage: memStorage(), parts: d.parts });
            assert('nothing readable and nothing saved: nothing to export', [o4.anything, o4.unreadable], [false, ['transactions', 'events']]);

            const o5 = await collectRecoveryBundle({ storage: memStorage({}), parts: fakeParts({ transactions: TXNS }).parts, fallbackRaw: savedText('from-set-aside') });
            assert('a set-aside save is used when the main one is gone', o5.bundle.financeData.marker, 'from-set-aside');
        },
    },
    {
        name: 'U3.3 recovery import restores settings, transactions and events, with the same safety copy as a normal restore',
        async fn(assert) {
            const dev = fakeParts({ transactions: OLD_TXNS, events: OLD_EVENTS });
            const safety = memSafety();
            const st = memStorage({ [SAVE_KEY]: '{"financeData": {broken' });
            const store = fakeStore();
            const res = await restoreFromRecovery(bundleText('from-file', { transactions: TXNS, events: EVENTS }), { store, storage: st, parts: dev.parts, safety });
            assert('ok with counts', [res.ok, res.counts], [true, { transactions: 2, events: 1 }]);
            assert('rows replaced', [dev.data.transactions, dev.data.events], [TXNS, EVENTS]);
            const saved = JSON.parse(st.map.get(SAVE_KEY));
            assert('settings saved for the next start', saved.financeData.marker, 'from-file');
            assert('the unreadable save was set aside', [...st.map.keys()].some((k) => k.startsWith(CORRUPT_PREFIX)), true);
            assert('rows copy kept in the safety database', safety.box.rec.parts, { transactions: OLD_TXNS, events: OLD_EVENTS });
            assert('settings copy paired with it', JSON.parse(st.map.get(PRE_RESTORE_KEY)).copyId, safety.box.rec.id);
            const bad = await restoreFromRecovery('not json', { store, storage: st, parts: dev.parts, safety });
            assert('a bad file changes nothing', [bad.ok, dev.data.transactions], [false, TXNS]);
        },
    },
    {
        name: 'U3.4 recovery import rolls back: a failed save or a failed part put everything back',
        async fn(assert) {
            const raw = savedText('original');
            const file = bundleText('from-file', { transactions: TXNS, events: EVENTS });
            // the main save fails: rows and the saved settings are as they were
            const dev = fakeParts({ transactions: OLD_TXNS, events: OLD_EVENTS });
            const st = memStorage({ [SAVE_KEY]: raw }, { failSetKey: SAVE_KEY });
            const store = fakeStore();
            const r1 = await restoreFromRecovery(file, { store, storage: st, parts: dev.parts, safety: memSafety() });
            assert('save failure: refused', r1.ok, false);
            assert('rows put back, saved settings untouched', [dev.data.transactions, dev.data.events, st.map.get(SAVE_KEY)], [OLD_TXNS, OLD_EVENTS, raw]);
            assert('the in-memory settings are back too', store.financeData.marker, 'device');
            // the second part fails to write: the first is put back
            const dev2 = fakeParts({ transactions: OLD_TXNS, events: OLD_EVENTS }, { failReplace: 'events' });
            const st2 = memStorage({ [SAVE_KEY]: raw });
            const r2 = await restoreFromRecovery(file, { store: fakeStore(), storage: st2, parts: dev2.parts, safety: memSafety() });
            assert('part failure: refused, rows back, saved settings untouched', [r2.ok, dev2.data.transactions, st2.map.get(SAVE_KEY)], [false, OLD_TXNS, raw]);
            // an unreadable saved text is put back when the restore fails
            const bad = '{"financeData": {broken';
            const dev3 = fakeParts({ transactions: OLD_TXNS, events: OLD_EVENTS }, { failReplace: 'transactions' });
            const st3 = memStorage({ [SAVE_KEY]: bad });
            const r3 = await restoreFromRecovery(file, { store: fakeStore(), storage: st3, parts: dev3.parts, safety: memSafety() });
            assert('unreadable text is put back, a copy was set aside', [r3.ok, st3.map.get(SAVE_KEY), [...st3.map.keys()].some((k) => k.startsWith(CORRUPT_PREFIX))], [false, bad, true]);
            // the current rows cannot be read, so no copy can be made: refused, nothing changed
            const dev4 = fakeParts({ transactions: OLD_TXNS }, { failRead: 'events' });
            const r4 = await restoreFromRecovery(file, { store: fakeStore(), storage: memStorage({ [SAVE_KEY]: raw }), parts: dev4.parts, safety: memSafety() });
            assert('unreadable current rows: refused with the existing reason', [r4.ok, r4.error, dev4.data.transactions], [false, 'cantReadCurrent', OLD_TXNS]);
        },
    },
    {
        name: 'U3.5 undo after a restore puts back the earlier settings, transactions and events, then the copy is spent',
        async fn(assert) {
            const dev = fakeParts({ transactions: OLD_TXNS, events: OLD_EVENTS });
            const safety = memSafety();
            const st = memStorage({ [SAVE_KEY]: savedText('before') });
            const store = fakeStore('before');
            const args = { storage: st, render: () => {}, save: () => true, parts: dev.parts, safety };
            const res = await commitBackup(store, prepareBackup(bundleText('after', { transactions: TXNS, events: EVENTS }), dev.parts), args);
            assert('restore ok', [res.ok, store.financeData.marker, dev.data.transactions], [true, 'after', TXNS]);
            const back = await undoLastRestore(store, args);
            assert('undo ok', back.ok, true);
            assert('every part is back', [dev.data.transactions, dev.data.events], [OLD_TXNS, OLD_EVENTS]);
            assert('settings are back', store.financeData.marker, 'before');
            assert('the copy is spent: no settings copy, no rows copy', [st.map.has(PRE_RESTORE_KEY), safety.box.rec], [false, undefined]);
            const again = await undoLastRestore(store, args);
            assert('a second undo has nothing to use', [again.ok, again.error], [false, 'noCopy']);
        },
    },
    {
        name: 'U3.6 the copy lasts until the next restore or an erase; a failed undo keeps it; the info is only there while a matching copy exists',
        async fn(assert) {
            const dev = fakeParts({ transactions: OLD_TXNS, events: OLD_EVENTS });
            const safety = memSafety();
            const st = memStorage({ [SAVE_KEY]: savedText('before') });
            const store = fakeStore('before');
            const args = { storage: st, render: () => {}, save: () => true, parts: dev.parts, safety };
            assert('no restore yet: no copy', await restoreCopyInfo({ storage: st, safety }), null);
            await commitBackup(store, prepareBackup(bundleText('one', { transactions: TXNS, events: EVENTS }), dev.parts), args);
            const info = await restoreCopyInfo({ storage: st, safety });
            assert('after a restore: a copy with its time', [typeof info.timestamp, info.id === safety.box.rec.id], ['string', true]);
            // a second restore replaces the copy (the first one can no longer be undone)
            await commitBackup(store, prepareBackup(bundleText('two', { transactions: [], events: [] }), dev.parts), args);
            const info2 = await restoreCopyInfo({ storage: st, safety });
            assert('the next restore replaced the copy', [info2.id !== info.id, safety.box.rec.parts.transactions], [true, TXNS]);
            // a failed undo (save fails) keeps the copy
            const failing = await undoLastRestore(store, { ...args, save: () => false });
            assert('failed undo: refused, copy kept', [failing.ok, (await restoreCopyInfo({ storage: st, safety })) !== null], [false, true]);
            // erase: no rows copy, so there is nothing to put back and no row
            await commitErase(store, { financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings() }, args);
            assert('after an erase: no copy shown', await restoreCopyInfo({ storage: st, safety }), null);
            // a mismatched pair is not shown
            await commitBackup(store, prepareBackup(bundleText('three', { transactions: TXNS, events: [] }), dev.parts), args);
            st.map.set(PRE_RESTORE_KEY, JSON.stringify({ ...JSON.parse(st.map.get(PRE_RESTORE_KEY)), copyId: 'another' }));
            assert('mismatched pair: no copy shown', await restoreCopyInfo({ storage: st, safety }), null);
            assert('storage that throws: no copy shown, no throw', await restoreCopyInfo({ storage: { getItem() { throw new Error('denied'); } }, safety }), null);
        },
    },
    {
        name: 'U3.7 the Settings row is added only while a copy exists, carries the date, and sits just after Restore',
        fn(assert) {
            const mk = () => [{ id: 'data', rows: [{ id: 'backup' }, { id: 'restore' }, { id: 'export' }] }, { id: 'look', rows: [{ id: 'theme' }] }];
            assert('no copy: groups unchanged', addUndoRestoreRow(mk(), null).map((g) => g.rows.map((r) => r.id)), [['backup', 'restore', 'export'], ['theme']]);
            const withRow = addUndoRestoreRow(mk(), { timestamp: '2026-11-21T03:42:00Z' });
            assert('row sits after restore', withRow[0].rows.map((r) => r.id), ['backup', 'restore', 'undorestore', 'export']);
            const row = withRow[0].rows[2];
            assert('it is an action that names the date', [row.kind, row.label.startsWith('Put back what was here before the restore (from '), /2026|21|22|Nov/.test(row.label)], ['action', true, true]);
            assert('no data group: nothing added, no throw', addUndoRestoreRow([{ id: 'look', rows: [] }], { timestamp: '2026-11-21T03:42:00Z' })[0].rows, []);
            assert('a bad date still gives a plain row', addUndoRestoreRow(mk(), { timestamp: 'nonsense' })[0].rows[2].label.includes('NaN'), false);
        },
    },
    {
        name: 'U3.8 the Undo toast: Undo runs the undo and Undo is the toast action; letting it expire does not undo',
        async fn(assert) {
            const dev = fakeParts({ transactions: OLD_TXNS, events: OLD_EVENTS });
            const safety = memSafety();
            const st = memStorage({ [SAVE_KEY]: savedText('before') });
            const store = fakeStore('before');
            const args = { storage: st, render: () => {}, save: () => true, parts: dev.parts, safety };
            await commitBackup(store, prepareBackup(bundleText('after', { transactions: TXNS, events: EVENTS }), dev.parts), args);
            const timers = [];
            const shown = [];
            const queue = createToastQueue({ view: { show: (e) => shown.push(e), hide() {} }, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer() {} });
            let undone = null;
            const spec = restoreUndoToast({ message: 'Backup restored.', undo: () => { undone = undoLastRestore(store, args); return undone; } });
            // the same mapping showUndoToast uses
            queue.show({ message: spec.message, kind: 'info', duration: spec.duration, onExpire: spec.onExpire, action: { label: 'Undo', onAction: spec.onUndo } });
            assert('toast says what happened and offers Undo', [shown[0].message, shown[0].action.label], ['Backup restored.', 'Undo']);
            queue.act();
            await new Promise((r) => setTimeout(r, 0)); // onUndo starts the undo on the next tick
            await undone;
            assert('Undo put everything back', [dev.data.transactions, dev.data.events, store.financeData.marker], [OLD_TXNS, OLD_EVENTS, 'before']);
            // expiry leaves the restore alone
            const dev2 = fakeParts({ transactions: OLD_TXNS });
            const st2 = memStorage({ [SAVE_KEY]: savedText('before') });
            const store2 = fakeStore('before');
            const args2 = { storage: st2, render: () => {}, save: () => true, parts: dev2.parts, safety: memSafety() };
            await commitBackup(store2, prepareBackup(bundleText('after', { transactions: TXNS }), dev2.parts), args2);
            let called = 0;
            const s2 = restoreUndoToast({ message: 'x', undo: () => { called++; } });
            queue.show({ message: s2.message, kind: 'info', duration: s2.duration, onExpire: s2.onExpire, action: { label: 'Undo', onAction: s2.onUndo } });
            timers[timers.length - 1]();
            assert('expiry: no undo, the restore stands', [called, dev2.data.transactions], [0, TXNS]);
        },
    },
];

// Browser: the real toast element and its Undo button.
export const RECOVERY_UNDO_BROWSER_TEST_CASES = [
    {
        name: 'U3.9 the real Undo toast shows the message and its Undo button runs the undo once',
        async fn(assert) {
            let calls = 0;
            const spec = restoreUndoToast({ message: 'Backup restored: 2 transactions and 1 events.', undo: () => { calls++; } });
            showUndoToast(spec);
            const toast = document.getElementById('ledger-toast');
            assert('message shown', toast.querySelector('.toast-msg').textContent, 'Backup restored: 2 transactions and 1 events.');
            const btn = toast.querySelector('.toast-action');
            assert('Undo button present', btn.textContent, 'Undo');
            btn.click();
            btn.click();
            await new Promise((r) => setTimeout(r, 0)); // the undo starts on the next tick
            assert('undo ran once', calls, 1);
        },
    },
];
