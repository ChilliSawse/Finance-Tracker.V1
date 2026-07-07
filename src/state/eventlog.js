// Activity event log — the data source for the activity feed.
//
// Events are facts, not rendered strings: { id, ts, type, data }. The feed
// turns type+data into copy at render time (keeps the log i18n-ready and lets
// copy improve without rewriting history).
//
// Event types (grow as features land):
//   'import'        data: { batchId, count, source }         — CSV import completed
//   'milestone'     data: { kind: 'net-worth', value, threshold }
//   'savings-rate'  data: { rate, period }
//   'bill-due'      data: { billId, name, amount, dueDate }
//   'income-added'  data: { name, amount, schedule }
//   'note'          data: { text }                            — manual note

import { openDb, withStore } from './db.js';

const MAX_EVENTS = 500; // feed history cap — prune beyond this

// Monotonic ordering key: ISO timestamps collide within a millisecond (an import
// logs several events back-to-back), so events carry a numeric seq that a
// same-session counter keeps strictly increasing.
let _counter = 0;
function nextSeq() {
    return Date.now() * 1000 + (_counter = (_counter + 1) % 1000);
}

export function makeEvent(type, data = {}) {
    return {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        seq: nextSeq(),
        type,
        data,
    };
}

export async function logEvent(type, data = {}) {
    const event = makeEvent(type, data);
    await withStore('events', 'readwrite', (store) => store.add(event));
    return event;
}

/** Newest-first event list. */
export async function listRecentEvents(limit = 50) {
    const rows = await withStore('events', 'readonly', (store) => store.index('seq').getAll());
    rows.sort((a, b) => b.seq - a.seq);
    return rows.slice(0, limit);
}

export async function countEvents() {
    return withStore('events', 'readonly', (store) => store.count());
}

export async function deleteEvent(id) {
    return withStore('events', 'readwrite', (store) => store.delete(id));
}

/** Trim the log to the newest MAX_EVENTS entries. Returns how many were pruned. */
export async function pruneEvents(keep = MAX_EVENTS) {
    const total = await countEvents();
    if (total <= keep) return 0;
    const excess = total - keep;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('events', 'readwrite');
        const index = tx.objectStore('events').index('seq');
        let removed = 0;
        // seq index ascending = oldest first; delete the first `excess`.
        const cursorReq = index.openCursor();
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && removed < excess) { cursor.delete(); removed++; cursor.continue(); }
        };
        tx.oncomplete = () => resolve(removed);
        tx.onerror = () => reject(tx.error);
    });
}
