// Today and Activity selectors (Phase 1 step B7). Pure builders plus two thin readers
// over the spend cache and the store. Both readers return { ready:false } until the
// cache has loaded, so a screen shows a skeleton and never a figure from empty spend.
// Amounts are integer cents. A cycle's `end` is exclusive: a row on it is the next cycle's.

import { getSpendCache } from './spend-cache.js';
import { store } from './store.js';
import { leftThisPay, billOccurrences, billStatus, addDays } from '../calc/pay-cycle.js';
import { upcomingBills, missedBills } from './bills.js';
import { isBillItem } from '../calc/bill-match.js';
import { isTransferRow } from '../calc/transfers.js';

const NOT_READY = Object.freeze({ ready: false });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cents = (dollars) => Math.round((Number(dollars) || 0) * 100);
const isOut = (r) => r.amountCents < 0 && !isTransferRow(r); // H9: spending only; a transfer between your own accounts is not

function spendByCategory(rows) {
    const m = new Map();
    for (const r of rows) if (isOut(r)) m.set(r.categoryId, (m.get(r.categoryId) || 0) + -r.amountCents);
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    return [...m].map(([categoryId, spentCents]) => ({ categoryId, spentCents, share: total ? spentCents / total : 0 }))
        .sort((a, b) => b.spentCents - a.spentCents || a.categoryId.localeCompare(b.categoryId));
}

/**
 * Today's figures from rows in hand. Left, buckets and the so-far splits come from
 * leftThisPay (a matched bill counts once, as spend; unmatched Upcoming, Due and Missed
 * bills count once, as bills). `toReview` counts rows still flagged 'review' (FT-R-55).
 */
export function buildTodayModel({ data, rows, today }) {
    const d = data || {};
    const all = Array.isArray(rows) ? rows : [];
    const left = leftThisPay({ data: d, txns: all, today });
    const { start, end } = left.cycle;
    const cycleRows = all.filter((r) => r.date >= start && r.date < end);
    const byDay = new Map();
    for (const r of cycleRows) if (isOut(r)) byDay.set(r.date, (byDay.get(r.date) || 0) + -r.amountCents);
    const dueBeforePay = upcomingBills(d, Math.max(0, left.cycle.daysLeft), { today, txns: all })
        .filter((b) => b.dueDate < end);
    const missed = missedBills(d, { today, txns: all });
    // Sum of exactly the rows the Due-before-pay-day card lists (every dated bill, any bucket; Missed ones from this cycle).
    const dueListCents = dueBeforePay.reduce((s, b) => s + cents(b.bill.amount), 0)
        + missed.filter((m) => m.dueDate >= start).reduce((s, m) => s + cents(m.bill.amount), 0);
    return {
        ready: true,
        today,
        mode: left.mode,
        cycle: left.cycle,
        netCents: left.netCents,
        poolCents: left.poolCents,
        spentCents: left.spentCents,
        billsDueCents: left.billsDueCents,
        leftCents: left.leftCents,
        perDayCents: left.perDayCents,
        buckets: left.buckets,
        essentialSoFarCents: left.essentialSoFarCents,
        nonEssentialSoFarCents: left.nonEssentialSoFarCents,
        unsortedCents: left.unsortedCents,
        toReview: left.toReview,
        byCategory: spendByCategory(cycleRows),
        spendByDay: [...byDay].map(([date, spentCents]) => ({ date, spentCents })).sort((a, b) => a.date.localeCompare(b.date)),
        dueBeforePay,
        dueListCents,
        missed,
    };
}

function resolveRange(range, cycle, today) {
    if (range && range.from && range.to) return { from: range.from, to: range.to };
    if (range && Number(range.days) > 0) return { from: addDays(today, 1 - Number(range.days)), to: today };
    return { from: cycle.start, to: addDays(cycle.end, -1) }; // current cycle, inclusive
}

/**
 * Activity for an inclusive date range { from, to } (or { days }; default the current cycle).
 * Days newest first. Each day lists its transactions and the bill occurrences due that day
 * (status Upcoming, Due, Missed or Paid). A Paid occurrence is shown by its matched
 * transaction (`row.billMatch`), never as a second item, so a matched bill is counted once.
 * `comingUp` is the unpaid occurrences from today onward in the range.
 */
export function buildActivityFeed({ data, rows, today, range }) {
    const d = data || {};
    const all = Array.isArray(rows) ? rows : [];
    const cycle = leftThisPay({ data: d, txns: all, today }).cycle;
    const { from, to } = resolveRange(range, cycle, today);
    const inRange = all.filter((r) => r.date >= from && r.date <= to);
    const days = new Map();
    const dayOf = (date) => { if (!days.has(date)) days.set(date, { date, totalCents: 0, items: [] }); return days.get(date); };
    for (const r of inRange) {
        const day = dayOf(r.date);
        day.items.push({ type: 'txn', row: r, covered: !!r.billMatch });
        if (isOut(r)) day.totalCents += -r.amountCents;
    }
    const comingUp = [];
    const plan = Array.isArray(d.plan) ? d.plan : [];
    for (const item of plan) {
        if (!isBillItem(item)) continue;
        for (const dueDate of billOccurrences(item, from, to)) {
            const status = billStatus(item, dueDate, all, today);
            if (status === 'Paid') continue;
            const occ = { type: 'bill', planId: item.id, name: item.name, amountCents: cents(item.amount), dueDate, status };
            dayOf(dueDate).items.push(occ);
            if (dueDate >= today) comingUp.push(occ);
        }
    }
    comingUp.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const dayList = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
    const toReview = inRange.filter((r) => r.status === 'review');
    return {
        ready: true,
        range: { from, to },
        days: dayList,
        comingUp,
        toReview,
        toReviewCount: toReview.length,
        covered: inRange.filter((r) => r.billMatch),
        whereItWent: spendByCategory(inRange),
        spentCents: inRange.filter(isOut).reduce((a, r) => a - r.amountCents, 0),
    };
}

const todayIso = () => iso(new Date());

/** Today screen model from the live cache. `{ ready:false }` until the cache has loaded. */
export function todayModel() {
    const c = getSpendCache();
    if (!c.ready) return NOT_READY;
    return buildTodayModel({ data: store.financeData, rows: c.rows, today: todayIso() });
}

/** Activity feed from the live cache. `{ ready:false }` until the cache has loaded. */
export function activityFeed(range) {
    const c = getSpendCache();
    if (!c.ready) return NOT_READY;
    return buildActivityFeed({ data: store.financeData, rows: c.rows, today: todayIso(), range });
}
