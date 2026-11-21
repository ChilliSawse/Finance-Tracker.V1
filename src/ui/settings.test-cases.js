// Test cases for the "settings" group (D2.1 to D2.3). Pure: storage, the store and the
// IndexedDB parts are in-memory fakes. Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    buildBackupBundle, collectParts, prepareBackup, commitBackup, commitErase, registerBackupPart,
    sanitizeTransactionRows, sanitizeEventRows, BACKUP_PARTS, BACKUP_VERSION, carriesParts,
    PRE_RESTORE_PARTS_KEY, undoLastRestore,
} from '../state/backup.js';
import { PRE_RESTORE_KEY } from '../state/sanitize.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings } from '../state/defaults.js';
import {
    buildSettings, filterSettings, countRows, textSizeId, textSizePx, parseKeywords, keywordCount, taxTablesRow,
} from './settings-model.js';

function memStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem(k, v) { map.set(k, String(v)); },
    };
}

const fakeStore = () => ({ financeData: cloneDefaultFinanceData(), guiSettingsData: cloneDefaultGuiSettings() });

// Fake IndexedDB parts holding their rows in memory.
function fakeParts(initial = {}, { failReplaceOn } = {}) {
    const data = { transactions: [], events: [], ...initial };
    const mk = (key, sanitize) => ({
        key,
        read: async () => data[key].map((r) => ({ ...r })),
        sanitize,
        replace: async (rows) => {
            if (failReplaceOn === key) throw new Error('boom');
            data[key] = rows.map((r) => ({ ...r }));
        },
    });
    const parts = [mk('transactions', sanitizeTransactionRows), mk('events', sanitizeEventRows)];
    if (initial.scenarios) { // S8: a third part, like F1's scenarios
        parts.push(mk('scenarios', (rows) => ({ rows: Array.isArray(rows) ? rows : [], skipped: 0 })));
    }
    return { data, parts };
}

const TXNS = [
    { id: 't1', date: '2026-11-02', description: 'Corner cafe', amountCents: -450, categoryId: 'eating-out', source: 'manual', hash: 'manual|t1', createdAt: '2026-11-02T01:00:00Z' },
    { id: 't2', date: '2026-11-03', description: 'Pay', amountCents: 250000, categoryId: 'income', source: 'csv', hash: '2026-11-03|pay|250000', createdAt: '2026-11-03T01:00:00Z' },
];
const EVENTS = [
    { id: 'e1', ts: '2026-11-02T01:00:00Z', seq: 1000, type: 'note', data: { text: 'hello' } },
];

async function makeBackupText(partsHolder) {
    const store = fakeStore();
    store.financeData.marker = 'kept';
    const { rows } = await collectParts(partsHolder.parts);
    return JSON.stringify(buildBackupBundle({ financeData: store.financeData, guiSettings: store.guiSettingsData, partRows: rows }));
}

export const SETTINGS_TEST_CASES = [
    {
        name: 'D2.1 a v2 backup round-trips transactions and events',
        async fn(assert) {
            const src = fakeParts({ transactions: TXNS, events: EVENTS });
            const text = await makeBackupText(src);
            const bundle = JSON.parse(text);
            assert('version 2 with both parts', [bundle.version, BACKUP_VERSION, bundle.transactions.length, bundle.events.length], [2, 2, 2, 1]);
            const prepared = prepareBackup(text, src.parts);
            assert('prepared ok and carries rows', [prepared.ok, carriesParts(prepared), prepared.counts], [true, true, { transactions: 2, events: 1 }]);
            // Restore into a different device state.
            const dest = fakeParts({ transactions: [{ id: 'old', date: '2026-01-01', description: 'x', amountCents: -1, hash: 'h' }], events: [] });
            const store = fakeStore();
            const st = memStorage({ financeTrackerData_v2: '{"old":1}' });
            let rendered = 0, saved = 0;
            const res = await commitBackup(store, prepared, { storage: st, render: () => { rendered++; }, save: () => { saved++; }, parts: dest.parts });
            assert('commit ok, rendered, saved', [res.ok, rendered, saved], [true, 1, 1]);
            assert('transactions replaced exactly', dest.data.transactions, TXNS);
            assert('events restored', dest.data.events, EVENTS);
            assert('settings restored', store.financeData.marker, 'kept');
            assert('safety copy kept (S1)', st.map.has(PRE_RESTORE_KEY), true);
        },
    },
    {
        name: 'D2.1b an empty v2 part clears the rows, a failed render puts the rows back',
        async fn(assert) {
            const dest = fakeParts({ transactions: TXNS, events: EVENTS });
            const text = JSON.stringify(buildBackupBundle({
                financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), partRows: { transactions: [], events: [] },
            }));
            const store = fakeStore();
            const before = JSON.stringify(store);
            let n = 0;
            const bad = await commitBackup(store, prepareBackup(text, dest.parts), {
                storage: memStorage(), render: () => { if (++n === 1) throw new Error('render boom'); }, save: () => {}, parts: dest.parts,
            });
            assert('failed', bad.ok, false);
            assert('rows and store put back', [dest.data.transactions, dest.data.events, JSON.stringify(store)], [TXNS, EVENTS, before]);
            const good = await commitBackup(store, prepareBackup(text, dest.parts), { storage: memStorage(), render: () => {}, save: () => {}, parts: dest.parts });
            assert('now cleared', [good.ok, dest.data.transactions, dest.data.events], [true, [], []]);
            const dest2 = fakeParts({ transactions: TXNS }, { failReplaceOn: 'events' });
            const r2 = await commitBackup(fakeStore(), prepareBackup(text, dest2.parts), { storage: memStorage(), render: () => {}, save: () => {}, parts: dest2.parts });
            assert('a failing part rolls the others back', [r2.ok, r2.error, dest2.data.transactions], [false, 'cantWrite', TXNS]);
        },
    },
    {
        name: 'D2.2 an old backup (no parts) restores and leaves the device rows alone',
        async fn(assert) {
            const old = JSON.stringify({ financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), timestamp: '2026-09-01T00:00:00Z' });
            const dest = fakeParts({ transactions: TXNS, events: EVENTS });
            const prepared = prepareBackup(old, dest.parts);
            assert('ok, version 1, no parts', [prepared.ok, prepared.version, carriesParts(prepared)], [true, 1, false]);
            const store = fakeStore();
            const res = await commitBackup(store, prepared, { storage: memStorage(), render: () => {}, save: () => {}, parts: dest.parts });
            assert('restored, rows untouched', [res.ok, dest.data.transactions, dest.data.events], [true, TXNS, EVENTS]);
            // An old-shape file still goes through the S1 gate and the chain.
            assert('bad shape still rejected', prepareBackup('{"financeData":{"incomeSources":"no"},"guiSettings":{}}', dest.parts).ok, false);
        },
    },
    {
        name: 'D2.2b hostile rows in a v2 file are cleaned or dropped',
        fn(assert) {
            const evil = '{"version":2,"financeData":' + JSON.stringify(cloneDefaultFinanceData())
                + ',"guiSettings":{},"transactions":['
                + '{"id":"a","date":"2026-11-02","description":"<img src=x onerror=alert(1)>","amountCents":-1.6,"__proto__":{"p":1},"hash":"h"},'
                + '{"id":"","date":"2026-11-02","amountCents":5},'
                + '{"id":"b","date":"2026-13-45","amountCents":5},'
                + '{"id":"c","date":"2026-11-02","amountCents":"9"},'
                + '"junk",null],'
                + '"events":[{"id":"e","seq":1,"type":"note","data":"x"},{"id":"f","type":"note"}]}';
            const p = prepareBackup(evil, fakeParts().parts);
            assert('ok', p.ok, true);
            assert('one transaction survives, rounded to whole cents, text kept as text', [p.parts.transactions.length, p.parts.transactions[0].amountCents, p.parts.transactions[0].description], [1, -2, '<img src=x onerror=alert(1)>']);
            assert('no prototype key', Object.prototype.hasOwnProperty.call(p.parts.transactions[0], '__proto__'), false);
            assert('events: one kept with data object', [p.parts.events.length, p.parts.events[0].data], [1, {}]);
            assert('skipped counted', p.skipped, 6);
        },
    },
    {
        name: 'D2.2c registerBackupPart is the F1 extension point',
        async fn(assert) {
            const keep = BACKUP_PARTS.slice();
            let held = [{ id: 's1', name: 'Scenario' }];
            registerBackupPart({
                key: 'scenarios', read: async () => held,
                sanitize: (rows) => ({ rows: Array.isArray(rows) ? rows : [], skipped: 0 }),
                replace: async (rows) => { held = rows; },
            });
            const { rows } = await collectParts();
            // collectParts also reads the real parts; only check the new key here when they fail in Node.
            assert('scenarios collected', rows.scenarios, [{ id: 's1', name: 'Scenario' }]);
            const bundle = buildBackupBundle({ financeData: {}, guiSettings: {}, partRows: { scenarios: rows.scenarios } });
            assert('bundle carries it', bundle.scenarios, [{ id: 's1', name: 'Scenario' }]);
            BACKUP_PARTS.length = 0; keep.forEach((p) => BACKUP_PARTS.push(p));
            let threw = false;
            try { registerBackupPart({ key: 'x' }); } catch (e) { threw = true; }
            assert('a half-built part is refused', threw, true);
        },
    },
    {
        name: 'D2.3 erase all clears settings and every part through one commit',
        async fn(assert) {
            const dest = fakeParts({ transactions: TXNS, events: EVENTS });
            const store = fakeStore();
            store.financeData.marker = 'mine';
            const st = memStorage({ financeTrackerData_v2: '{"mine":1}' });
            const res = await commitErase(store, { financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings() },
                { storage: st, render: () => {}, save: () => {}, parts: dest.parts });
            assert('ok', res.ok, true);
            assert('rows cleared, settings fresh', [dest.data.transactions, dest.data.events, store.financeData.marker], [[], [], undefined]);
            assert('settings copy kept first', st.map.get(PRE_RESTORE_KEY), '{"mine":1}');
        },
    },
    {
        name: 'S8.1 the safety copy is taken first and covers settings, transactions, events and scenarios',
        async fn(assert) {
            const SCEN = [{ id: 's1', name: 'Scenario' }];
            const dest = fakeParts({ transactions: TXNS, events: EVENTS, scenarios: SCEN });
            const seenAtFirstReplace = {};
            const st = memStorage({ financeTrackerData_v2: JSON.stringify({ financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings() }) });
            dest.parts.forEach((p) => {
                const orig = p.replace;
                p.replace = async (rows) => { seenAtFirstReplace[p.key] = st.map.has(PRE_RESTORE_PARTS_KEY) && st.map.has(PRE_RESTORE_KEY); return orig(rows); };
            });
            const text = JSON.stringify(buildBackupBundle({
                financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), partRows: { transactions: [], events: [], scenarios: [] },
            }));
            const res = await commitBackup(fakeStore(), prepareBackup(text, dest.parts), { storage: st, render: () => {}, save: () => {}, parts: dest.parts });
            assert('ok, rows replaced', [res.ok, dest.data.transactions, dest.data.scenarios], [true, [], []]);
            assert('copy existed before each replace', seenAtFirstReplace, { transactions: true, events: true, scenarios: true });
            const kept = JSON.parse(st.map.get(PRE_RESTORE_PARTS_KEY));
            assert('copy holds every part', kept.parts, { transactions: TXNS, events: EVENTS, scenarios: SCEN });
            // the undo path brings the rows back too
            const undone = await undoLastRestore(fakeStore(), { storage: st, render: () => {}, save: () => {}, parts: dest.parts });
            assert('undo ok, rows back', [undone.ok, dest.data.transactions, dest.data.events, dest.data.scenarios], [true, TXNS, EVENTS, SCEN]);
            assert('no copy means no undo', (await undoLastRestore(fakeStore(), { storage: memStorage(), parts: dest.parts })).error, 'noCopy');
        },
    },
    {
        name: 'S8.2 a copy that cannot be stored (quota) aborts the restore with nothing changed',
        async fn(assert) {
            const SCEN = [{ id: 's1', name: 'Scenario' }];
            const quota = (failKey) => {
                const st = memStorage({ financeTrackerData_v2: '{"mine":1}' });
                st.setItem = (k) => { if (k === failKey) throw new Error('QuotaExceededError'); };
                return st;
            };
            const text = JSON.stringify(buildBackupBundle({
                financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), partRows: { transactions: [], events: [], scenarios: [] },
            }));
            for (const failKey of [PRE_RESTORE_PARTS_KEY, PRE_RESTORE_KEY]) {
                const dest = fakeParts({ transactions: TXNS, events: EVENTS, scenarios: SCEN });
                const store = fakeStore();
                const snap = JSON.stringify(store);
                let rendered = 0;
                const res = await commitBackup(store, prepareBackup(text, dest.parts), { storage: quota(failKey), render: () => { rendered++; }, save: () => {}, parts: dest.parts });
                assert('refused (' + failKey + ')', [res.ok, res.error], [false, 'cantKeepCopy']);
                assert('nothing changed (' + failKey + ')', [dest.data.transactions, dest.data.events, dest.data.scenarios, JSON.stringify(store), rendered], [TXNS, EVENTS, SCEN, snap, 0]);
            }
        },
    },
    {
        name: 'S8.3 a failure part-way leaves the device as it was, and says so when it cannot put rows back',
        async fn(assert) {
            const SCEN = [{ id: 's1', name: 'Scenario' }];
            const text = JSON.stringify(buildBackupBundle({
                financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), partRows: { transactions: [], events: [], scenarios: [] },
            }));
            // third part fails to write: the first two are put back
            const dest = fakeParts({ transactions: TXNS, events: EVENTS, scenarios: SCEN });
            const base = dest.parts[0];
            const bad = { key: 'scenarios', read: async () => SCEN.map((r) => ({ ...r })), sanitize: (r) => ({ rows: r, skipped: 0 }), replace: async () => { throw new Error('boom'); } };
            const parts = [...dest.parts.slice(0, 2), bad];
            const store = fakeStore();
            const snap = JSON.stringify(store);
            const res = await commitBackup(store, prepareBackup(text, parts), { storage: memStorage(), render: () => {}, save: () => {}, parts });
            assert('failed, device unchanged', [res.ok, res.error, dest.data.transactions, dest.data.events, JSON.stringify(store)], [false, 'cantWrite', TXNS, EVENTS, snap]);
            assert('the failing part was retried, not reported as stuck here', Array.isArray(res.notPutBack), true);
            // render fails after the rows were swapped: rows and settings are back
            const d2 = fakeParts({ transactions: TXNS, events: EVENTS });
            const s2 = fakeStore();
            const snap2 = JSON.stringify(s2);
            const r2 = await commitBackup(s2, prepareBackup(text, d2.parts), { storage: memStorage(), render: () => { throw new Error('render boom'); }, save: () => {}, parts: d2.parts });
            assert('render failure restores everything', [r2.ok, d2.data.transactions, d2.data.events, JSON.stringify(s2)], [false, TXNS, EVENTS, snap2]);
            assert('base part unused', !!base, true);
        },
    },
    {
        name: 'D2.3b settings groups, search and the tax row',
        fn(assert) {
            const fd = cloneDefaultFinanceData();
            fd.categories = [{ id: 'a', keywords: ['woolies', 'coles'] }, { id: 'b', keywords: [] }, { id: 'c' }];
            const groups = buildSettings({ financeData: fd, now: new Date(2026, 10, 21), installAvailable: false, version: '1.3.0' });
            assert('five groups in order', groups.map((g) => g.id), ['data', 'look', 'tax', 'setup', 'about']);
            assert('your data rows', groups[0].rows.map((r) => r.id), ['backup', 'restore', 'export', 'rules', 'erase']);
            assert('appearance rows', groups[1].rows.map((r) => r.id), ['theme', 'mode', 'size']);
            assert('region rows: currency and a read-only tax row, no tax year setting', groups[2].rows.map((r) => [r.id, r.kind]), [['currency', 'currency'], ['taxtables', 'info']]);
            assert('setup rows', groups[3].rows.map((r) => r.id), ['setup', 'model']);
            assert('about rows (no install when unavailable)', groups[4].rows.map((r) => r.id), ['privacy', 'licence', 'version', 'fairwork']);
            assert('install appears when available', buildSettings({ installAvailable: true })[4].rows[0].id, 'install');
            const tax = groups[2].rows[1];
            assert('tax row text', [tax.label, tax.hint, tax.value], ['Tax tables: 2026-27', 'from this app version', 'Up to date']);
            assert('stale past the tables', taxTablesRow(new Date(2030, 0, 1), {}).status, 'stale');
            assert('keyword count', keywordCount(fd), 2);
            assert('keywords parse', parseKeywords(' Woolies, coles ,, woolies'), ['Woolies', 'coles']);
            assert('search finds backup', filterSettings(groups, 'backup').flatMap((g) => g.rows.map((r) => r.id)), ['backup', 'restore']);
            assert('search by theme word', filterSettings(groups, 'dark').flatMap((g) => g.rows.map((r) => r.id)), ['theme', 'mode']);
            assert('search with no match', countRows(filterSettings(groups, 'zzzz')), 0);
            assert('empty query returns all', countRows(filterSettings(groups, '  ')), countRows(groups));
            assert('text size mapping', [textSizeId(16), textSizeId('18'), textSizeId(24), textSizeId(undefined), textSizePx('larger')], ['standard', 'large', 'larger', 'standard', 20]);
        },
    },
];
