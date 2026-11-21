// G6W15-7: what the database does when another tab changes it. Pure: a fake IndexedDB factory stands in
// (connectDb takes the factory, so nothing global is replaced and the real database is never opened).

import { connectDb } from './db.js';

// A factory whose open() hands back a request the test drives by hand.
function fakeFactory() {
    const f = { req: null, db: { closed: 0, close() { this.closed += 1; }, objectStoreNames: { contains: () => true } } };
    f.open = () => { f.req = { result: f.db }; return f.req; };
    return f;
}

export const DB_TEST_CASES = [
    {
        name: 'S11.1 another tab upgrading the schema closes this handle and asks for a reload',
        async fn(assert) {
            const f = fakeFactory(); const seen = [];
            const p = connectDb(f, 'fake-a', (k) => seen.push(k));
            f.req.onsuccess();
            const db = await p;
            assert('the handle is open and nothing was announced yet', [db.closed, seen], [0, []]);
            db.onversionchange({ newVersion: 3 });
            assert('the handle was closed and the reload notice raised once', [db.closed, seen], [1, ['reload']]);
        },
    },
    {
        name: 'S11.2 a delete of the database closes the handle without a reload notice',
        async fn(assert) {
            const f = fakeFactory(); const seen = [];
            const p = connectDb(f, 'fake-b', (k) => seen.push(k));
            f.req.onsuccess();
            const db = await p;
            db.onversionchange({ newVersion: null });
            assert('closed, no notice', [db.closed, seen], [1, []]);
        },
    },
    {
        name: 'S11.3 an upgrade held up by another tab raises the blocked notice, and carries on once released',
        async fn(assert) {
            const f = fakeFactory(); const seen = [];
            const p = connectDb(f, 'fake-c', (k) => seen.push(k));
            f.req.onblocked();
            assert('blocked notice raised', seen, ['blocked']);
            f.req.onsuccess();
            const db = await p;
            assert('the open still completes afterwards', db === f.db, true);
        },
    },
    {
        name: 'S11.4 an open that fails rejects, and a missing IndexedDB rejects with a plain message',
        async fn(assert) {
            const f = fakeFactory();
            const p = connectDb(f, 'fake-d', () => {});
            f.req.error = new Error('VersionError');
            f.req.onerror();
            let msg = '';
            await p.catch((e) => { msg = e.message; });
            assert('the open error is passed on', msg, 'VersionError');
            let none = '';
            await connectDb(undefined, 'fake-e', () => {}).catch((e) => { none = e.message; });
            assert('no IndexedDB gives the plain message', none, 'IndexedDB is not available in this browser.');
        },
    },
    {
        name: 'S11.5 no notify callback is fine (handlers stay silent)',
        async fn(assert) {
            const f = fakeFactory();
            const p = connectDb(f, 'fake-f');
            f.req.onblocked();
            f.req.onsuccess();
            const db = await p;
            db.onversionchange({ newVersion: 9 });
            assert('closed without throwing', db.closed, 1);
        },
    },
];
