// Pay-cycle and bill-occurrence maths (Phase 1 step B1). Pure: no DOM, no storage.
// All dates are local 'YYYY-MM-DD' strings built with new Date(y, m, d) (no UTC
// parsing), matching bills.js. Weekend dates are never shifted (Actual 26.11.0).
//
// A cycle's `end` is EXCLUSIVE and equals `nextPay`, so a row dated exactly on
// `end` belongs to the next cycle. On pay day the new cycle starts today.

import { getPayCyclesPerYear } from '../utils.js';

const DAY_MS = 86400000;
const STEP_DAYS = { weekly: 7, fortnightly: 14 };

export function parseIso(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function toIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, n) {
    const d = parseIso(iso);
    return toIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Whole days from a to b (b - a), DST-safe. */
export function daysBetween(a, b) {
    const x = parseIso(a), y = parseIso(b);
    return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / DAY_MS);
}

function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }

/** Month step taken from the ANCHOR (never the running date), day clamped to month end. */
export function addMonthsClamped(anchorIso, months) {
    const a = parseIso(anchorIso);
    const total = a.getFullYear() * 12 + a.getMonth() + months;
    const y = Math.floor(total / 12), m0 = ((total % 12) + 12) % 12;
    return toIso(new Date(y, m0, Math.min(a.getDate(), daysInMonth(y, m0))));
}

function validIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function isMonthMode(source) {
    if (!source) return true;
    if (source.incomeType === 'variable') return true;
    if (source.paySchedule === 'yearly') return true;
    return !validIso(source.payAnchor);
}

function monthModeCycle(todayIso) {
    const t = parseIso(todayIso);
    const start = toIso(new Date(t.getFullYear(), t.getMonth(), 1));
    const end = toIso(new Date(t.getFullYear(), t.getMonth() + 1, 1));
    return { start, end, nextPay: null, daysLeft: daysBetween(todayIso, end), mode: 'month', cyclesPerYear: 12 };
}

/**
 * The pay cycle containing `today`.
 * @returns {{start:string, end:string, nextPay:string|null, daysLeft:number, mode:'cycle'|'month', cyclesPerYear:number}}
 *   Month mode (no anchor, variable income or yearly pay): the calendar month, nextPay null.
 */
export function getCycle(source, today) {
    const todayIso = toIso(parseIso(today));
    if (isMonthMode(source)) return monthModeCycle(todayIso);
    const anchor = source.payAnchor;
    const sched = source.paySchedule;
    const cyclesPerYear = getPayCyclesPerYear(sched);
    let start, nextPay;
    if (STEP_DAYS[sched]) {
        const step = STEP_DAYS[sched];
        const k = Math.floor(daysBetween(anchor, todayIso) / step);
        start = addDays(anchor, k * step);
        nextPay = addDays(start, step);
    } else if (sched === 'monthly') {
        const a = parseIso(anchor);
        const t = parseIso(todayIso);
        let k = (t.getFullYear() - a.getFullYear()) * 12 + (t.getMonth() - a.getMonth());
        if (addMonthsClamped(anchor, k) > todayIso) k -= 1;
        start = addMonthsClamped(anchor, k);
        nextPay = addMonthsClamped(anchor, k + 1);
    } else {
        return monthModeCycle(todayIso);
    }
    return { start, end: nextPay, nextPay, daysLeft: daysBetween(todayIso, nextPay), mode: 'cycle', cyclesPerYear };
}

/** Pay dates from `from` to `to` inclusive (same anchor and clamp rules as getCycle). Month mode: []. */
export function payDatesBetween(source, from, to) {
    if (isMonthMode(source)) return [];
    const fromIso = toIso(parseIso(from)), toI = toIso(parseIso(to));
    const out = [];
    const sched = source.paySchedule, anchor = source.payAnchor;
    if (STEP_DAYS[sched]) {
        const step = STEP_DAYS[sched];
        let k = Math.ceil(daysBetween(anchor, fromIso) / step);
        for (let d = addDays(anchor, k * step); d <= toI; d = addDays(anchor, ++k * step)) out.push(d);
    } else if (sched === 'monthly') {
        const a = parseIso(anchor), f = parseIso(fromIso);
        let k = (f.getFullYear() - a.getFullYear()) * 12 + (f.getMonth() - a.getMonth()) - 1;
        for (let d = addMonthsClamped(anchor, k); d <= toI; d = addMonthsClamped(anchor, ++k)) {
            if (d >= fromIso) out.push(d);
        }
    }
    return out;
}

/** The next `count` pay dates strictly after today (so on pay day the first is one step ahead, like getCycle.nextPay). */
export function nextPayDates(source, today, count = 1) {
    if (isMonthMode(source) || count < 1) return [];
    const out = [];
    let cur = getCycle(source, today).nextPay;
    const sched = source.paySchedule;
    while (out.length < count) {
        out.push(cur);
        if (STEP_DAYS[sched]) cur = addDays(cur, STEP_DAYS[sched]);
        else cur = getCycle(source, cur).nextPay;
    }
    return out;
}

/**
 * Infer a pay anchor from past income (FT-R-58). Takes the latest Income-category
 * credit dated within two cycles up to today. None found: no anchor, month mode, and
 * (for non-variable sources) the "Set your pay day" nudge. A variable source never infers one.
 * @returns {{anchor:string|null, mode:'cycle'|'month', nudge:boolean}}
 */
export function inferPayAnchor(rows, source, today) {
    const none = (nudge) => ({ anchor: null, mode: 'month', nudge });
    if (!source || source.incomeType === 'variable' || source.paySchedule === 'yearly') return none(false);
    const todayIso = toIso(parseIso(today));
    const sched = source.paySchedule;
    let cutoff;
    if (STEP_DAYS[sched]) cutoff = addDays(todayIso, -2 * STEP_DAYS[sched]);
    else if (sched === 'monthly') {
        const t = parseIso(todayIso);
        const y = new Date(t.getFullYear(), t.getMonth() - 2, 1);
        cutoff = toIso(new Date(y.getFullYear(), y.getMonth(), Math.min(t.getDate(), daysInMonth(y.getFullYear(), y.getMonth()))));
    } else return none(false);
    let latest = null;
    for (const r of rows || []) {
        if (!r || r.categoryId !== 'income' || !(r.amountCents > 0) || !validIso(r.date)) continue;
        if (r.date > todayIso || r.date < cutoff) continue;
        if (!latest || r.date > latest) latest = r.date;
    }
    return latest ? { anchor: latest, mode: 'cycle', nudge: false } : none(true);
}

/**
 * Due dates of a bill from `from` to `to` inclusive, computed from anchorDue
 * (never rolled forward). Month steps come from the anchor with the day clamped
 * to month end (no drift); weekend dates stay as they are. `everyDays` (a positive
 * integer on the item) gives an every-N-days repeat and wins over `frequency`.
 */
export function billOccurrences(item, from, to) {
    if (!item || !validIso(item.anchorDue)) return [];
    const fromIso = toIso(parseIso(from)), toI = toIso(parseIso(to));
    const anchor = item.anchorDue;
    const out = [];
    const n = Number(item.everyDays);
    const stepDays = Number.isInteger(n) && n > 0 ? n : STEP_DAYS[item.frequency];
    if (stepDays) {
        let k = Math.max(0, Math.ceil(daysBetween(anchor, fromIso) / stepDays));
        for (let d = addDays(anchor, k * stepDays); d <= toI; d = addDays(anchor, ++k * stepDays)) out.push(d);
        return out;
    }
    const monthsStep = { monthly: 1, quarterly: 3, yearly: 12 }[item.frequency];
    if (!monthsStep) return anchor >= fromIso && anchor <= toI ? [anchor] : [];
    const a = parseIso(anchor), f = parseIso(fromIso);
    const monthsGap = (f.getFullYear() - a.getFullYear()) * 12 + (f.getMonth() - a.getMonth());
    let k = Math.max(0, Math.floor(monthsGap / monthsStep) - 1);
    for (let d = addMonthsClamped(anchor, k * monthsStep); d <= toI; d = addMonthsClamped(anchor, ++k * monthsStep)) {
        if (d >= fromIso) out.push(d);
    }
    return out;
}

/**
 * Status of one occurrence: 'Paid' when a transaction carries billMatch {planId, dueDate}
 * for it, else 'Upcoming' (after today), 'Due' (today), 'Missed' (past, unmatched).
 */
export function billStatus(item, dueDate, txns, today) {
    const paid = (txns || []).some((t) => t && t.billMatch && t.billMatch.planId === item.id && t.billMatch.dueDate === dueDate);
    if (paid) return 'Paid';
    const todayIso = toIso(parseIso(today));
    if (dueDate > todayIso) return 'Upcoming';
    if (dueDate === todayIso) return 'Due';
    return 'Missed';
}
