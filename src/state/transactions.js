// Transaction store — the data backbone for CSV import, the activity feed,
// spending analytics, budget envelopes, and trend tracking.
//
// Shape: {
//   id:            string (crypto.randomUUID)
//   date:          'YYYY-MM-DD'
//   description:   string (as imported/entered)
//   amountCents:   integer — NEGATIVE = money out, POSITIVE = money in
//   categoryId:    string (financeData.categories id; 'other' fallback)
//   source:        'csv' | 'pdf' | 'manual' | 'sample'
//   importBatchId: string | null (groups one CSV import; enables undo)
//   hash:          dedupe key (date|normalised description|amountCents);
//                  manual rows use 'manual|' + id so identical entries both store.
//                  Kept on edit (it is the bank row's identity, not its text).
//   createdAt:     ISO datetime
// Optional (absent on legacy rows; readers default them via normaliseTransaction):
//   status:     'review' | 'ok'  (default 'ok')
//   bucketId:   explicit bucket for this purchase
//   billMatch:  { planId, dueDate, by: 'auto' | 'user' } | null
//   note:       string (default '')
//   updatedAt:  ISO datetime (default = createdAt)
//   reconciled: true on a manual row merged with a bank row (FT-R-56)
// }

import { openDb, withStore } from './db.js';

// Normalised dedupe key: the same bank row re-imported must hash identically.
export function transactionHash(date, description, amountCents) {
    const desc = (description || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return `${date}|${desc}|${amountCents}`;
}

export function makeTransaction({ date, description, amountCents, categoryId = 'other', source = 'manual', importBatchId = null,
    status, bucketId, billMatch, note }) {
    const cents = Math.round(amountCents || 0);
    const id = crypto.randomUUID();
    const row = {
        id,
        date,
        description: description || '',
        amountCents: cents,
        categoryId,
        source,
        importBatchId,
        hash: source === 'manual' ? 'manual|' + id : transactionHash(date, description, cents),
        createdAt: new Date().toISOString(),
    };
    if (status !== undefined) row.status = status;
    if (bucketId !== undefined) row.bucketId = bucketId;
    if (billMatch !== undefined) row.billMatch = billMatch;
    if (note !== undefined) row.note = note;
    return row;
}

export function transactionStatus(row) {
    return row && row.status === 'review' ? 'review' : 'ok';
}

// Defaults for the optional fields, without mutating the stored row.
export function normaliseTransaction(row) {
    return { ...row, status: transactionStatus(row), note: row.note || '', updatedAt: row.updatedAt || row.createdAt };
}

/** True for a real calendar date 'YYYY-MM-DD' (checked by a Date.UTC round trip, not by parsing). */
export function isValidIsoDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === 'string' ? iso : '');
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (y < 1000) return false;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// iso +- days as 'YYYY-MM-DD', or null for an invalid date. Built from Date.UTC
// components, never from Date.parse, so Safari's stricter parsing cannot throw.
function shiftDate(iso, days) {
    if (!isValidIsoDate(iso)) return null;
    const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days);
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/**
 * Bulk-insert with count-based dedupe (L8). Imported rows (csv/pdf) with the same
 * date, description and amount are numbered in file order: the 1st keeps the
 * plain hash, the 2nd gets "#2", and so on. A row is skipped only when that
 * numbered hash is already stored, so two genuine identical coffees in one
 * statement both import, a re-import adds nothing, and an overlapping later
 * statement adds only the rows it has beyond what is stored.
 * Rows with an impossible date are skipped and counted in `invalid` (only present when > 0).
 * @param {Array} txns - transactions from makeTransaction().
 * Imported (csv/pdf) rows that match an unreconciled manual row are merged into it, not added.
 * @returns {Promise<{added:number, duplicates:number, merged:number, invalid?:number}>}
 */
export async function addTransactions(input) {
    if (!input.length) return { added: 0, duplicates: 0, merged: 0 };
    let invalid = 0;
    const occurrence = new Map();
    const txns = [];
    for (const t of input) {
        if (!isValidIsoDate(t.date)) { invalid++; continue; }
        if (t.source === 'manual' || t.source === 'sample') { txns.push(t); continue; }
        const n = (occurrence.get(t.hash) || 0) + 1;
        occurrence.set(t.hash, n);
        txns.push(n === 1 ? t : { ...t, hash: `${t.hash}#${n}` });
    }
    if (!txns.length) return { added: 0, duplicates: 0, merged: 0, ...(invalid ? { invalid } : {}) };
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const hashIndex = store.index('hash');
        const dateIndex = store.index('date');
        const seen = new Set();
        const claimed = new Set(); // manual row ids already merged in this batch
        let added = 0, duplicates = 0, merged = 0;

        // Per-row existence check via the hash index. O(n) requests, but they all
        // ride one transaction — fine for CSV-sized batches (hundreds–thousands)
        // and keeps memory flat.
        txns.forEach(t => {
            if (seen.has(t.hash)) { duplicates++; return; }
            seen.add(t.hash);
            const check = hashIndex.getKey(t.hash);
            check.onsuccess = () => {
                if (check.result !== undefined) { duplicates++; return; }
                if (t.source === 'manual' || t.source === 'sample') { store.add(t); added++; return; }
                // Imported row: merge into a same-amount manual row within +-3 days (FT-R-56).
                const from = shiftDate(t.date, -3), to = shiftDate(t.date, 3);
                if (!from || !to) { store.add(t); added++; return; }
                const near = dateIndex.getAll(IDBKeyRange.bound(from, to));
                near.onsuccess = () => {
                    const m = (near.result || []).find(r => r.source === 'manual' && !r.reconciled
                        && r.amountCents === t.amountCents && !claimed.has(r.id));
                    if (m) {
                        claimed.add(m.id);
                        store.put({ ...m, hash: t.hash, reconciled: true, updatedAt: new Date().toISOString() });
                        merged++;
                    } else { store.add(t); added++; }
                };
            };
        });

        tx.oncomplete = () => resolve({ added, duplicates, merged, ...(invalid ? { invalid } : {}) });
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('addTransactions aborted'));
    });
}

/**
 * List transactions, optionally within an inclusive date range and/or category,
 * newest first.
 * @param {{from?:string, to?:string, categoryId?:string, limit?:number}} [opts]
 */
export async function listTransactions(opts = {}) {
    const { from, to, categoryId, limit } = opts;
    const range = from && to ? IDBKeyRange.bound(from, to)
        : from ? IDBKeyRange.lowerBound(from)
        : to ? IDBKeyRange.upperBound(to)
        : null;
    const rows = await withStore('transactions', 'readonly',
        (store) => range ? store.index('date').getAll(range) : store.index('date').getAll());
    let result = rows;
    if (categoryId) result = result.filter(r => r.categoryId === categoryId);
    result.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    result = result.map(normaliseTransaction);
    return limit ? result.slice(0, limit) : result;
}

export async function countTransactions() {
    return withStore('transactions', 'readonly', (store) => store.count());
}

// Edit keeps the stored hash (the bank row's identity) and stamps updatedAt.
export async function updateTransaction(txn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const get = store.get(txn.id);
        get.onsuccess = () => {
            const prev = get.result;
            const next = { ...txn, updatedAt: new Date().toISOString() };
            if (prev) next.hash = prev.hash;
            store.put(next);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('updateTransaction aborted'));
    });
}

export async function deleteTransaction(id) {
    return withStore('transactions', 'readwrite', (store) => store.delete(id));
}

// Undo an entire CSV import batch.
export async function deleteImportBatch(importBatchId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        const index = tx.objectStore('transactions').index('importBatchId');
        let removed = 0;
        const cursorReq = index.openCursor(IDBKeyRange.only(importBatchId));
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) { cursor.delete(); removed++; cursor.continue(); }
        };
        tx.oncomplete = () => resolve(removed);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Spend per category for a month ('YYYY-MM'), outgoing only, in cents
 * (positive numbers). The consumer joins on financeData.categories.
 * @returns {Promise<Map<string, number>>} categoryId → spent cents.
 */
export async function monthlySpendByCategory(month) {
    const rows = await listTransactions({ from: `${month}-01`, to: `${month}-31` });
    const spend = new Map();
    for (const r of rows) {
        if (r.amountCents >= 0) continue; // income/refunds aren't spend
        spend.set(r.categoryId, (spend.get(r.categoryId) || 0) + (-r.amountCents));
    }
    return spend;
}

// Backup helpers (slice D's full backup calls these). Raw rows, no defaults added.
export async function exportAllTransactions() {
    return withStore('transactions', 'readonly', (store) => store.getAll());
}

// Restore: upserts by id, keeps each row's hash as given, no dedupe.
export async function importTransactions(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { imported: 0 };
    await withStore('transactions', 'readwrite', (store) => { list.forEach(r => store.put(r)); });
    return { imported: list.length };
}
