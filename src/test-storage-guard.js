// S5 (G6W12-1): keep the browser test page away from the app's real data.
// tests.html ships on the same origin as the app, so every real store is reachable from it.
// This module must be the FIRST import of tests.html. It
//   1. takes a snapshot of the real localStorage, sessionStorage and IndexedDB first,
//   2. swaps window.localStorage / sessionStorage for in-memory stand-ins,
//   3. sends any IndexedDB open or delete of the real database name to a scratch name,
//   4. offers verifyRealStoresUntouched() for the verdict (the tripwire).
// Not imported by tools/run-cases.mjs (Node has no real stores).

const REAL_DB = 'ledger-db';
const SCRATCH_DB = 'ledger-test-scratch-db';
// S9: the restore safety copy has its own small database; a test that uses its default name goes to a scratch name too.
const REAL_SAFETY_DB = 'ledger-safety-db';
const SCRATCH_SAFETY_DB = 'ledger-test-scratch-safety-db';

function readStorage(store) {
    const out = {};
    try {
        for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            out[k] = store.getItem(k);
        }
    } catch (err) {
        out.__unreadable__ = String(err && err.name);
    }
    return out;
}

function makeMemoryStorage() {
    const map = new Map();
    return {
        get length() { return map.size; },
        key: (i) => (i >= 0 && i < map.size ? Array.from(map.keys())[i] : null),
        getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
        setItem: (k, v) => { map.set(String(k), String(v)); },
        removeItem: (k) => { map.delete(String(k)); },
        clear: () => { map.clear(); },
    };
}

const realOpen = IDBFactory.prototype.open;
const realDelete = IDBFactory.prototype.deleteDatabase;
const realLocal = window.localStorage;
const realSession = window.sessionStorage;

async function listDatabases() {
    if (!indexedDB.databases) return null;
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name).filter((n) => n !== SCRATCH_DB && n !== SCRATCH_SAFETY_DB).sort();
}

// Row counts of the real database, only when it already exists (opening it would create it).
async function realDbCounts(names) {
    if (!names || !names.includes(REAL_DB)) return null;
    const db = await new Promise((ok, no) => {
        const r = realOpen.call(indexedDB, REAL_DB);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
    });
    const counts = {};
    for (const sn of Array.from(db.objectStoreNames)) {
        counts[sn] = await new Promise((ok) => {
            const q = db.transaction(sn).objectStore(sn).count();
            q.onsuccess = () => ok(q.result);
            q.onerror = () => ok(-1);
        });
    }
    db.close();
    return counts;
}

const before = {
    local: readStorage(realLocal),
    session: readStorage(realSession),
};
const beforeDbsPromise = listDatabases().then(async (names) => ({ names, counts: await realDbCounts(names) }));

function swap(name, value) {
    Object.defineProperty(window, name, { value, writable: true, configurable: true, enumerable: true });
}
swap('localStorage', makeMemoryStorage());
swap('sessionStorage', makeMemoryStorage());

const redirect = (name) => (name === REAL_DB ? SCRATCH_DB : name === REAL_SAFETY_DB ? SCRATCH_SAFETY_DB : name);
IDBFactory.prototype.open = function (name, ...rest) { return realOpen.call(this, redirect(name), ...rest); };
IDBFactory.prototype.deleteDatabase = function (name, ...rest) { return realDelete.call(this, redirect(name), ...rest); };

function diffStorage(label, a, b, problems) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[k] === b[k]) continue;
        problems.push(label + ' key "' + k + '" ' + (a[k] === undefined ? 'was added' : b[k] === undefined ? 'was removed' : 'was changed'));
    }
}

// Resolves to a list of problems; empty means the real stores are exactly as they were.
export async function verifyRealStoresUntouched() {
    const problems = [];
    const start = await beforeDbsPromise;
    diffStorage('localStorage', before.local, readStorage(realLocal), problems);
    diffStorage('sessionStorage', before.session, readStorage(realSession), problems);
    const names = await listDatabases();
    if (JSON.stringify(start.names) !== JSON.stringify(names)) {
        problems.push('IndexedDB list changed: ' + JSON.stringify(start.names) + ' to ' + JSON.stringify(names));
    }
    const counts = await realDbCounts(names);
    if (JSON.stringify(start.counts) !== JSON.stringify(counts)) {
        problems.push('ledger-db row counts changed: ' + JSON.stringify(start.counts) + ' to ' + JSON.stringify(counts));
    }
    return problems;
}

// Remove the scratch database left by tests that used the app's default database name.
export async function dropScratchDb() {
    for (const name of [SCRATCH_DB, SCRATCH_SAFETY_DB]) {
        await new Promise((ok) => {
            const r = realDelete.call(indexedDB, name);
            r.onsuccess = r.onerror = r.onblocked = () => ok();
        });
    }
}
