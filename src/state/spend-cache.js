// Spending aggregates cache — bridges the async transaction store (IndexedDB)
// to the synchronous tab renderers. Refreshed at boot and after any import /
// undo; renderers read whatever is current (empty until the first refresh).
// All amounts here are integer CENTS (transaction-store convention).
//
// B7: also holds the CURRENT PAY CYCLE (cycle, cycleRows, cycleByCategory,
// cycleByBucket, toReview) and the loaded rows, so Today and Activity selectors
// (today-model.js) read synchronously. `ready` is false until the first load.

import { listTransactions } from './transactions.js';
import { store } from './store.js';
import { leftThisPay } from '../calc/pay-cycle.js';

function emptyCache() {
    return {
        ready: false,
        year: null,          // 'YYYY'
        month: null,         // 'YYYY-MM'
        count: 0,            // transactions this year
        monthByCategory: new Map(), // categoryId → spent cents (outgoing only)
        monthTotalCents: 0,
        yearByCategory: new Map(),
        yearTotalCents: 0,   // outgoing
        yearIncomeCents: 0,  // incoming
        // B7: current pay cycle
        today: null,         // ISO date the cycle was resolved for
        cycle: null,         // { start, end, mode, ... } (end exclusive)
        rows: [],            // every loaded row (this year, or back far enough to cover the cycle)
        cycleRows: [],       // rows with start <= date < end
        cycleByCategory: new Map(), // categoryId → spent cents this cycle
        cycleByBucket: new Map(),   // bucket id → spent cents this cycle
        toReview: 0,         // cycle rows with status 'review' (uncategorised only, FT-R-55)
    };
}

let cache = emptyCache();

export function getSpendCache() {
    return cache;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Earliest date a refresh must load: Jan 1, or 62 days back when that is earlier (covers a cycle spanning New Year). */
export function spendCacheFrom(todayIso) {
    const [y, m, d] = todayIso.split('-').map(Number);
    const back = iso(new Date(y, m - 1, d - 62));
    const jan = `${y}-01-01`;
    return back < jan ? back : jan;
}

/**
 * Build the cache from rows already in hand (pure apart from replacing the module cache).
 * Used by refreshSpendCache and by tests. `data` is financeData (cycle and bucket resolution).
 */
export function loadSpendCache(rows, { data, today } = {}) {
    const todayIso = today || iso(new Date());
    const year = todayIso.slice(0, 4);
    const month = todayIso.slice(0, 7);
    const fresh = emptyCache();
    Object.assign(fresh, { ready: true, year, month, today: todayIso });
    const all = Array.isArray(rows) ? rows : [];
    fresh.rows = all;
    for (const r of all) {
        if (!r.date.startsWith(`${year}-`)) continue;
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
    try {
        const left = leftThisPay({ data: data || {}, txns: all, today: todayIso });
        const { start, end } = left.cycle;
        fresh.cycle = left.cycle;
        fresh.cycleRows = all.filter((r) => r.date >= start && r.date < end); // end is exclusive: a row on it is next cycle
        for (const r of fresh.cycleRows) {
            if (r.amountCents < 0) fresh.cycleByCategory.set(r.categoryId, (fresh.cycleByCategory.get(r.categoryId) || 0) - r.amountCents);
        }
        for (const b of left.buckets) fresh.cycleByBucket.set(b.id, b.spentCents);
        fresh.toReview = left.toReview;
    } catch (_) {
        // Malformed data: leave the cycle aggregates empty; the year and month figures still stand.
    }
    cache = fresh;
    return cache;
}

/** Re-aggregate from IndexedDB (one indexed range read). */
export async function refreshSpendCache({ data = store.financeData, today } = {}) {
    const todayIso = today || iso(new Date());
    let rows = [];
    try {
        rows = await listTransactions({ from: spendCacheFrom(todayIso) });
    } catch (_) {
        // IndexedDB unavailable — leave the empty aggregates; consumers hide.
    }
    return loadSpendCache(rows, { data, today: todayIso });
}
