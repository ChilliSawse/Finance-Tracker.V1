// S9 (G6W15-2, G6W15-6): the on-device safety copy of the IndexedDB rows taken before a restore.
// A SEPARATE small database (its own version 1) so ledger-db keeps its schema version and other
// open tabs are not asked to upgrade. localStorage (about 5 MB, shared with the main save) cannot
// hold a large household's rows; IndexedDB can. One record, overwritten:
//   { id, timestamp, parts: { transactions: [...], events: [...], scenarios: [...] } }
// The settings copy (ft-pre-restore-backup) carries the same id, so an undo can refuse a pair
// that was not taken at the same moment.

const DEFAULT_DB_NAME = 'ledger-safety-db';
const DB_VERSION = 1;
const STORE = 'copy';
const KEY = 'last';

let dbName = DEFAULT_DB_NAME;
let dbPromise = null;

// Test hook: a scratch name (same idea as configureDb in db.js).
export function configureSafetyDb(name) {
    dbName = name || DEFAULT_DB_NAME;
    dbPromise = null;
}

function openSafetyDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available in this browser.')); return; }
        const req = indexedDB.open(dbName, DB_VERSION);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => { dbPromise = null; reject(req.error); };
        req.onblocked = () => { dbPromise = null; reject(new Error('The safety database is blocked by another tab.')); };
    });
    return dbPromise;
}

async function run(mode, fn) {
    const db = await openSafetyDb();
    return new Promise((resolve, reject) => {
        let result;
        const tx = db.transaction(STORE, mode);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('The safety copy transaction was aborted.'));
        const req = fn(tx.objectStore(STORE));
        if (req) req.onsuccess = () => { result = req.result; };
    });
}

/** Store the copy ({id, timestamp, parts}); resolves once it is durable. Rejects when it cannot be stored. */
export const putSafetyCopy = (record) => run('readwrite', (s) => s.put(record, KEY));
/** The stored copy, or undefined. */
export const getSafetyCopy = () => run('readonly', (s) => s.get(KEY));
/** Remove the copy. */
export const clearSafetyCopy = () => run('readwrite', (s) => s.delete(KEY));

export const IDB_SAFETY = { put: putSafetyCopy, get: getSafetyCopy, remove: clearSafetyCopy };
