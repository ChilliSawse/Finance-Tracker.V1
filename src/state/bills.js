// Recurring bills / upcoming payments.
//
// Bills are REMINDERS — they never change expense totals (a regular bill is
// usually already in the Expenses lists; counting it here too would
// double-count). Shape on financeData.bills:
//   { id, name, amount, frequency: 'weekly'|'fortnightly'|'monthly'|'quarterly'|'yearly',
//     nextDue: 'YYYY-MM-DD' }

import { logEvent } from './eventlog.js';
import { t } from '../i18n/strings.js';
import { billOccurrences, billStatus } from '../calc/pay-cycle.js';
import { isBillItem } from '../calc/bill-match.js';

const NOTIFIED_KEY = 'ft-bill-notified'; // billId → the nextDue date already announced
const DAY_MS = 24 * 60 * 60 * 1000;

export const BILL_FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

// B6 — on migrated data (dataVersion >= 2) bills are plan items (inTotals:false) carrying
// anchorDue; due dates are computed from the anchor (billOccurrences), never rolled.
const isPlanData = (data) => !!data && data.dataVersion >= 2 && Array.isArray(data.plan);
// A dated bill = any plan item with a valid due date (isBillItem from bill-match.js, the one test shared with
// Today, Activity, matching and Plan). inTotals only says whether it counts in Planned; it never hides a bill.
function planBills(data) { return isPlanData(data) ? data.plan.filter(isBillItem) : []; }
// Legacy rows added after migration (not mirrored in the plan) keep the old nextDue behaviour.
function strayLegacyBills(data) {
    if (!data || !Array.isArray(data.bills)) return [];
    if (!isPlanData(data)) return data.bills;
    const ids = new Set(data.plan.map((p) => p && p.id));
    return data.bills.filter((b) => b && !ids.has(b.id));
}
const addDaysIso = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return toIso(new Date(y, m - 1, d + n)); };
const daysFrom = (aIso, bIso) => {
    const [y, m, d] = aIso.split('-').map(Number);
    const [y2, m2, d2] = bIso.split('-').map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y, m - 1, d)) / DAY_MS);
};

function todayStart() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One recurrence step forward from an ISO date. */
export function advanceDate(dateIso, frequency) {
    const [y, m, day] = dateIso.split('-').map(Number);
    const d = new Date(y, m - 1, day);
    switch (frequency) {
        case 'weekly': d.setDate(d.getDate() + 7); break;
        case 'fortnightly': d.setDate(d.getDate() + 14); break;
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'quarterly': d.setMonth(d.getMonth() + 3); break;
        case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
        default: d.setMonth(d.getMonth() + 1);
    }
    return toIso(d);
}

/**
 * Advance any past-due bills to their next occurrence (called at boot).
 * Mutates data.bills in place; returns true when anything moved.
 */
export function rollForwardBills(data) {
    if (!data || !Array.isArray(data.bills)) return false;
    const today = toIso(todayStart());
    let moved = false;
    // Plan items are never rolled (B6); only un-migrated rows, or rows the plan does not mirror.
    for (const bill of strayLegacyBills(data)) {
        if (!bill.nextDue) continue;
        let guard = 0;
        while (bill.nextDue < today && guard++ < 400) {
            bill.nextDue = advanceDate(bill.nextDue, bill.frequency);
            moved = true;
        }
    }
    return moved;
}

/** Human "due" label. */
export function dueLabel(days) {
    if (days <= 0) return t('bills.dueToday');
    if (days === 1) return t('bills.dueTomorrow');
    return t('bills.dueInDays', { days });
}

/**
 * Bills due within `days`, soonest first. Plan items read their dates from anchorDue
 * (paid occurrences are left out). `opts` = { today: 'YYYY-MM-DD', txns: [] } for tests/callers.
 * @returns {Array<{bill:object, dueDate:string, status:string, dueInDays:number, dueLabel:string}>}
 */
export function upcomingBills(data, days = 14, opts = {}) {
    if (!data) return [];
    const todayIso = opts.today || toIso(todayStart());
    const out = [];
    for (const item of planBills(data)) {
        for (const dueDate of billOccurrences(item, todayIso, addDaysIso(todayIso, days))) {
            const status = billStatus(item, dueDate, opts.txns, todayIso);
            if (status === 'Paid') continue;
            const dueInDays = daysFrom(todayIso, dueDate);
            out.push({ bill: item, dueDate, status, dueInDays, dueLabel: dueLabel(dueInDays) });
        }
    }
    for (const bill of strayLegacyBills(data)) {
        if (!bill.nextDue) continue;
        const dueInDays = daysFrom(todayIso, bill.nextDue);
        if (dueInDays >= 0 && dueInDays <= days) {
            out.push({ bill, dueDate: bill.nextDue, status: dueInDays === 0 ? 'Due' : 'Upcoming', dueInDays, dueLabel: dueLabel(dueInDays) });
        }
    }
    out.sort((a, b) => a.dueInDays - b.dueInDays);
    return out;
}

/**
 * Unpaid occurrences of bill plan items in the last `lookbackDays` (default 60), reported
 * as Missed, never rolled forward. Un-migrated bills have no anchor history, so none.
 */
export function missedBills(data, opts = {}) {
    const todayIso = opts.today || toIso(todayStart());
    const back = opts.lookbackDays || 60;
    const out = [];
    for (const item of planBills(data)) {
        for (const dueDate of billOccurrences(item, addDaysIso(todayIso, -back), addDaysIso(todayIso, -1))) {
            if (billStatus(item, dueDate, opts.txns, todayIso) !== 'Missed') continue;
            out.push({ bill: item, dueDate, status: 'Missed', daysOverdue: daysFrom(dueDate, todayIso) });
        }
    }
    out.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return out;
}

/**
 * Log a 'bill-due' feed event for bills due within 7 days — once per
 * bill-and-dueDate (so the feed says it one time, not every load).
 */
export function generateBillDueEvents(data) {
    const soon = upcomingBills(data, 7);
    if (!soon.length) return;
    let notified;
    try { notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {}; }
    catch (_) { notified = {}; }
    let changed = false;
    for (const { bill, dueDate, dueLabel: label } of soon) {
        if (!bill.id || notified[bill.id] === dueDate) continue;
        notified[bill.id] = dueDate;
        changed = true;
        logEvent('bill-due', { billId: bill.id, name: bill.name, amount: bill.amount, dueDate, dueLabel: label }).catch(() => {});
    }
    if (changed) {
        try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified)); } catch (_) { /* storage full or blocked: skip, deliberate */ }
    }
}
