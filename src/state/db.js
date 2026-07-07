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
const DB_VERSION = 1;

let dbName = DEFAULT_DB_NAME;
let dbPromise = null;

// Test hook: point the module at a throwaway database (tests.html uses this so a
// test run can never touch real data). Must be called before first use.
export function configureDb(name) {
    dbName = name || DEFAULT_DB_NAME;
    dbPromise = null;
}

export function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not available in this browser.'));
            return;
        }
        const req = indexedDB.open(dbName, DB_VERSION);
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
        };
        req.onsuccess = () => {
            const db = req.result;
            // If another tab upgrades the schema, release our handle so it can proceed.
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
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
