// S9 (G6W15-1, G6W15-2): the restore safety copy in a real IndexedDB, at household size.
// Browser only: scratch database `ledger-test-db`; the safety database is the default name, which the S5 guard redirects to a scratch name.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { configureDb, deleteDb } from './db.js';
import { configureSafetyDb, getSafetyCopy, clearSafetyCopy } from './safety-db.js';
import { importTransactions, countTransactions } from './transactions.js';
import {
    BACKUP_PARTS, buildBackupBundle, prepareBackup, commitBackup, commitErase, undoLastRestore, PRE_RESTORE_PARTS_KEY,
} from './backup.js';
import { PRE_RESTORE_KEY } from './sanitize.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings } from './defaults.js';

function memStorage() {
    const map = new Map([['financeTrackerData_v2', JSON.stringify({ financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings() })]]);
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

const bigRows = (n) => Array.from({ length: n }, (_, i) => ({
    id: 'syn-' + i, date: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), description: 'Synthetic purchase number ' + i + ' at a made up shop',
    amountCents: -(100 + (i % 5000)), categoryId: 'groceries', source: 'csv', hash: 'syn|' + i, createdAt: '2026-10-01T00:00:00Z',
}));

async function fresh() {
    configureDb('ledger-test-db');
    configureSafetyDb(); // the default name: the S5 guard sends it to a scratch database that the page drops at the end
    await deleteDb();
    await clearSafetyCopy();
}

const fakeStore = () => ({ financeData: cloneDefaultFinanceData(), guiSettingsData: cloneDefaultGuiSettings() });
const parts = () => BACKUP_PARTS.filter((p) => p.key === 'transactions' || p.key === 'events');

export const SAFETY_DB_TEST_CASES = [
    {
        name: 'S9.5 a restore with 20,000 transactions keeps its copy in IndexedDB and can be undone; Erase all leaves no rows copy anywhere',
        async fn(assert) {
            await fresh();
            await importTransactions(bigRows(20000));
            const text = JSON.stringify(buildBackupBundle({
                financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(), partRows: { transactions: bigRows(3), events: [] },
            }));
            const st = memStorage();
            const opts = { storage: st, render: () => {}, save: () => {}, parts: parts() };
            const res = await commitBackup(fakeStore(), prepareBackup(text, parts()), opts);
            assert('restore ok at 20,000 rows', [res.ok, await countTransactions()], [true, 3]);
            const copy = await getSafetyCopy();
            assert('the copy holds all 20,000 rows, in IndexedDB', copy.parts.transactions.length, 20000);
            assert('localStorage holds no rows', [st.map.has(PRE_RESTORE_PARTS_KEY), [...st.map.values()].some((v) => v.includes('Synthetic purchase'))], [false, false]);
            assert('the settings copy shares the id', JSON.parse(st.map.get(PRE_RESTORE_KEY)).copyId, copy.id);
            const back = await undoLastRestore(fakeStore(), opts);
            assert('undo brings all rows back', [back.ok, await countTransactions()], [true, 20000]);
            // erase with the copy of the undo still in place: it is deleted and none is written
            const gone = await commitErase(fakeStore(), { financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings() }, opts);
            assert('erase ok at 20,000 rows', [gone.ok, await countTransactions()], [true, 0]);
            assert('no rows copy in the safety database', await getSafetyCopy(), undefined);
            assert('no rows copy in localStorage', [...st.map.values()].some((v) => v.includes('Synthetic purchase')), false);
            await deleteDb();
            await clearSafetyCopy();
        },
    },
];
