// Minimal IndexedDB wrapper for the transaction + activity-event stores.
//
// Why IndexedDB (not localStorage): imported bank history runs to thousands of
// rows and localStorage is ~5 MB shared with custom fonts and themes. financeData
// itself stays in localStorage under its existing key — this store is only for
// the new high-volume data (transactions, activity events).
//
// Amounts in these stores are integer CENTS (precision-critical sums);
// financeData keeps its existing plain-dollar convention. Don't mix them up.

const DEFAULT_DB_NAME = 'ledger-db';
// Version 2 (F1): adds the scenarios store. Each store is guarded by objectStoreNames.contains, so an upgrade only adds what is missing.
const DB_VERSION = 2;

let dbName = DEFAULT_DB_NAME;
let dbPromise = null;

// Test hook: point the module at a throwaway database (tests.html uses this so a
// test run can never touch real data). Must be called before first use.
export function configureDb(name) {
    dbName = name || DEFAULT_DB_NAME;
    dbPromise = null;
}

// G6W15-7: the app tells the user about two database situations through one document event,
// 'ledger:db-notice' (detail.kind 'reload' or 'blocked'); pwa.js shows it in the update banner.
export const DB_NOTICE_EVENT = 'ledger:db-notice';
function announce(kind) {
    if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
    document.dispatchEvent(new CustomEvent(DB_NOTICE_EVENT, { detail: { kind } }));
}

export function openDb() {
    if (dbPromise) return dbPromise;
    const idb = typeof indexedDB === 'undefined' ? undefined : indexedDB;
    const attempt = connectDb(idb, dbName, announce);
    dbPromise = attempt;
    // A failed open is not kept: the next call tries again (an old tab that hit a VersionError used to stay broken until reload).
    attempt.catch(() => { if (dbPromise === attempt) dbPromise = null; });
    return attempt;
}

// One open of the database against the given IndexedDB factory. `notify(kind)` is called with 'reload' when another tab
// changes the schema under this one (the handle is closed first so that tab can proceed) and 'blocked' when this open's
// upgrade is held up by another tab. Exported so the handlers can be tested with a fake factory.
export function connectDb(idb, name, notify) {
    return new Promise((resolve, reject) => {
        if (!idb) {
            reject(new Error('IndexedDB is not available in this browser.'));
            return;
        }
        const req = idb.open(name, DB_VERSION);
        // An upgrade waits while another tab still holds the old version open.
        req.onblocked = () => { if (notify) notify('blocked'); };
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('transactions')) {
                const s = db.createObjectStore('transactions', { keyPath: 'id' });
                s.createIndex('date', 'date');
                s.createIndex('categoryId', 'categoryId');
                s.createIndex('hash', 'hash');
                s.createIndex('importBatchId', 'importBatchId');
            }
            if (!db.objectStoreNames.contains('events')) {
                const s = db.createObjectStore('events', { keyPath: 'id' });
                // seq (not ts): ISO timestamps collide within a millisecond, which made
                // ordering nondeterministic when one action logs several events.
                s.createIndex('seq', 'seq');
            }
            if (!db.objectStoreNames.contains('scenarios')) {
                const s = db.createObjectStore('scenarios', { keyPath: 'id' });
                s.createIndex('pinned', 'pinned');
                s.createIndex('updatedAt', 'updatedAt');
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            // If another tab upgrades the schema, release our handle so it can proceed, and ask for a reload:
            // this tab's code is the old one. A delete (newVersion null) only releases the handle.
            db.onversionchange = (e) => {
                db.close();
                if (dbPromise && name === dbName) dbPromise = null;
                if (notify && e && e.newVersion !== null) notify('reload');
            };
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    });
}

// Run `fn(store)` inside a transaction on one store; resolves with fn's result
// once the transaction completes (so writes are durable when it resolves).
export async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try {
            result = fn(store);
        } catch (err) {
            reject(err);
            return;
        }
        tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
}

// Promisify a single IDBRequest (for reads inside withStore callbacks).
export function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Delete the whole database (test cleanup / factory reset).
export function deleteDb() {
    dbPromise = null;
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(); // another tab holds it open; deletion completes later
    });
}
