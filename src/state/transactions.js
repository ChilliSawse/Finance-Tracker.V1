// Transaction store — the data backbone for CSV import, the activity feed,
// spending analytics, budget envelopes, and trend tracking.
//
// Shape: {
//   id:            string (crypto.randomUUID)
//   date:          'YYYY-MM-DD'
//   description:   string (as imported/entered)
//   amountCents:   integer — NEGATIVE = money out, POSITIVE = money in
//   categoryId:    string (financeData.categories id; 'other' fallback)
//   source:        'csv' | 'manual'
//   importBatchId: string | null (groups one CSV import; enables undo)
//   hash:          dedupe key (date|normalised description|amountCents)
//   createdAt:     ISO datetime
// }

import { openDb, withStore } from './db.js';

// Normalised dedupe key: the same bank row re-imported must hash identically.
export function transactionHash(date, description, amountCents) {
    const desc = (description || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return `${date}|${desc}|${amountCents}`;
}

export function makeTransaction({ date, description, amountCents, categoryId = 'other', source = 'manual', importBatchId = null }) {
    return {
        id: crypto.randomUUID(),
        date,
        description: description || '',
        amountCents: Math.round(amountCents || 0),
        categoryId,
        source,
        importBatchId,
        hash: transactionHash(date, description, Math.round(amountCents || 0)),
        createdAt: new Date().toISOString(),
    };
}

/**
 * Bulk-insert with dedupe: rows whose hash already exists in the store (or is
 * repeated within the batch) are skipped, so re-importing an overlapping CSV
 * export is safe.
 * @param {Array} txns - transactions from makeTransaction().
 * @returns {Promise<{added:number, duplicates:number}>}
 */
export async function addTransactions(txns) {
    if (!txns.length) return { added: 0, duplicates: 0 };
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const hashIndex = store.index('hash');
        const seen = new Set();
        let added = 0, duplicates = 0;

        // Per-row existence check via the hash index. O(n) requests, but they all
        // ride one transaction — fine for CSV-sized batches (hundreds–thousands)
        // and keeps memory flat.
        txns.forEach(t => {
            if (seen.has(t.hash)) { duplicates++; return; }
            seen.add(t.hash);
            const check = hashIndex.getKey(t.hash);
            check.onsuccess = () => {
                if (check.result !== undefined) duplicates++;
                else { store.add(t); added++; }
            };
        });

        tx.oncomplete = () => resolve({ added, duplicates });
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
    return limit ? result.slice(0, limit) : result;
}

export async function countTransactions() {
    return withStore('transactions', 'readonly', (store) => store.count());
}

export async function updateTransaction(txn) {
    return withStore('transactions', 'readwrite', (store) => store.put(txn));
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
