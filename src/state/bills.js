// Recurring bills / upcoming payments.
//
// Bills are REMINDERS — they never change expense totals (a regular bill is
// usually already in the Expenses lists; counting it here too would
// double-count). Shape on financeData.bills:
//   { id, name, amount, frequency: 'weekly'|'fortnightly'|'monthly'|'quarterly'|'yearly',
//     nextDue: 'YYYY-MM-DD' }

import { logEvent } from './eventlog.js';
import { t } from '../i18n/strings.js';

const NOTIFIED_KEY = 'ft-bill-notified'; // billId → the nextDue date already announced
const DAY_MS = 24 * 60 * 60 * 1000;

export const BILL_FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

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
    for (const bill of data.bills) {
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
 * Bills due within `days`, soonest first.
 * @returns {Array<{bill:object, dueInDays:number, dueLabel:string}>}
 */
export function upcomingBills(data, days = 14) {
    if (!data || !Array.isArray(data.bills)) return [];
    const start = todayStart().getTime();
    const out = [];
    for (const bill of data.bills) {
        if (!bill.nextDue) continue;
        const [y, m, d] = bill.nextDue.split('-').map(Number);
        const dueInDays = Math.round((new Date(y, m - 1, d).getTime() - start) / DAY_MS);
        if (dueInDays >= 0 && dueInDays <= days) {
            out.push({ bill, dueInDays, dueLabel: dueLabel(dueInDays) });
        }
    }
    out.sort((a, b) => a.dueInDays - b.dueInDays);
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
    for (const { bill, dueLabel: label } of soon) {
        if (!bill.id || notified[bill.id] === bill.nextDue) continue;
        notified[bill.id] = bill.nextDue;
        changed = true;
        logEvent('bill-due', { billId: bill.id, name: bill.name, amount: bill.amount, dueDate: bill.nextDue, dueLabel: label }).catch(() => {});
    }
    if (changed) {
        try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified)); } catch (_) {}
    }
}
