// Spending aggregates cache — bridges the async transaction store (IndexedDB)
// to the synchronous tab renderers. Refreshed at boot and after any import /
// undo; renderers read whatever is current (empty until the first refresh).
// All amounts here are integer CENTS (transaction-store convention).

import { listTransactions } from './transactions.js';

let cache = {
    ready: false,
    year: null,          // 'YYYY'
    month: null,         // 'YYYY-MM'
    count: 0,            // transactions this year
    monthByCategory: new Map(), // categoryId → spent cents (outgoing only)
    monthTotalCents: 0,
    yearByCategory: new Map(),
    yearTotalCents: 0,   // outgoing
    yearIncomeCents: 0,  // incoming
};

export function getSpendCache() {
    return cache;
}

/** Re-aggregate the current year's transactions (one indexed range read). */
export async function refreshSpendCache() {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const fresh = {
        ready: true, year, month, count: 0,
        monthByCategory: new Map(), monthTotalCents: 0,
        yearByCategory: new Map(), yearTotalCents: 0, yearIncomeCents: 0,
    };
    try {
        const rows = await listTransactions({ from: `${year}-01-01` });
        for (const r of rows) {
            fresh.count++;
            if (r.amountCents >= 0) {
                fresh.yearIncomeCents += r.amountCents;
                continue;
            }
            const spent = -r.amountCents;
            fresh.yearTotalCents += spent;
            fresh.yearByCategory.set(r.categoryId, (fresh.yearByCategory.get(r.categoryId) || 0) + spent);
            if (r.date.startsWith(month)) {
                fresh.monthTotalCents += spent;
                fresh.monthByCategory.set(r.categoryId, (fresh.monthByCategory.get(r.categoryId) || 0) + spent);
            }
        }
    } catch (_) {
        // IndexedDB unavailable — leave the empty aggregates; consumers hide.
    }
    cache = fresh;
    return cache;
}
