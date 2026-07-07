// Daily net-worth / savings-rate snapshots — the data behind trend sparklines.
//
// localStorage (not IndexedDB): tiny (≤ ~730 rows), and the dashboard renderers
// are synchronous. One snapshot per calendar day, taken on the first data change
// (or app load) of the day; same-day changes overwrite so the day ends at its
// latest values.

const SNAPSHOTS_KEY = 'ft-snapshots';
const MAX_SNAPSHOTS = 730; // ~2 years of daily points

function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function listSnapshots() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY)) || []; }
    catch (_) { return []; }
}

/**
 * Record (or refresh) today's snapshot from calculated totals.
 * @param {{netWorth:number, savingsRate:number, totalWeeklyExpenses:number}} totals
 */
export function recordDailySnapshot(totals) {
    const snaps = listSnapshots();
    const date = todayIso();
    const entry = {
        date,
        netWorth: Math.round(totals.netWorth * 100) / 100,
        savingsRate: Math.round(totals.savingsRate * 10) / 10,
    };
    const last = snaps[snaps.length - 1];
    if (last && last.date === date) snaps[snaps.length - 1] = entry;
    else snaps.push(entry);
    while (snaps.length > MAX_SNAPSHOTS) snaps.shift();
    try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snaps)); } catch (_) {}
}

/**
 * The most recent snapshot at or before `daysAgo` days in the past (for
 * "up X% this month" comparisons). Null when history doesn't reach that far.
 */
export function snapshotBefore(daysAgo) {
    const snaps = listSnapshots();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysAgo);
    const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    for (let i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].date <= cutoffIso) return snaps[i];
    }
    return null;
}
