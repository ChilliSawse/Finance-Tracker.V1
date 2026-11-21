// Bill matching (pure, B8). Pairs outgoing transactions with bill occurrences and stores the
// result on the transaction as `billMatch: { planId, dueDate, by }`, so Paid / Missed is derived
// (billStatus) and nothing rolls forward.
//
// A candidate pair needs |txn date - due date| <= dayTol (default 2) and the amount within
// amtTolPct (default 7.5%). When the bill's matchRule.keys has a key the description contains,
// the window widens to 5 days (the amount tolerance still applies). Assignment is one-to-one,
// greedy by amount closeness, then date distance, then bank rows before manual ones, then
// earlier date, then id. `by:'user'` matches are fixed and keep their occurrence. A row with
// noMatch (true, or a list of planIds) is skipped. Automatic matches are recomputed on every run,
// so the result is deterministic and a second run changes nothing.

import { billOccurrences } from './pay-cycle.js';

const DEFAULT_DAY_TOL = 2;
const KEY_DAY_TOL = 5;
const DEFAULT_AMT_TOL_PCT = 7.5;

const DAY_MS = 86400000;
const isoToDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
const dayToIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const validIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const sameMatch = (a, b) => (!a && !b) || (!!a && !!b && a.planId === b.planId && a.dueDate === b.dueDate && a.by === b.by);

export function isBillItem(item) { return !!item && validIso(item.anchorDue); }

function blockedFor(row, planId) {
    return row.noMatch === true || (Array.isArray(row.noMatch) && row.noMatch.includes(planId));
}

function keyHit(row, item) {
    const keys = item.matchRule && Array.isArray(item.matchRule.keys) ? item.matchRule.keys : [];
    const d = String(row.description || '').toLowerCase();
    return keys.some((k) => k && d.includes(String(k).toLowerCase()));
}

/**
 * @param {Array} rows - transactions (not mutated).
 * @param {Array} plan - financeData.plan; items with an anchorDue are bills.
 * @param {{dayTol?:number, amtTolPct?:number}} [opts] - defaults; a bill's matchRule.dayTol / amtTolPct override.
 * @returns {{rows:Array, changed:string[]}} rows in input order (changed ones are new objects) and the changed ids.
 */
export function matchBills(rows, plan, opts = {}) {
    const defDay = Number.isFinite(opts.dayTol) ? opts.dayTol : DEFAULT_DAY_TOL;
    const defPct = Number.isFinite(opts.amtTolPct) ? opts.amtTolPct : DEFAULT_AMT_TOL_PCT;
    const bills = (plan || []).filter(isBillItem);
    const list = (rows || []).filter((r) => r && validIso(r.date));
    if (!bills.length || !list.length) return { rows: rows || [], changed: [] };

    const lo = Math.min(...list.map((r) => isoToDay(r.date))) - KEY_DAY_TOL;
    const hi = Math.max(...list.map((r) => isoToDay(r.date))) + KEY_DAY_TOL;
    const occs = [];
    for (const item of bills) {
        const expected = Math.round(Math.abs(Number(item.amount) || 0) * 100);
        if (!expected) continue;
        for (const dueDate of billOccurrences(item, dayToIso(lo), dayToIso(hi))) occs.push({ item, dueDate, due: isoToDay(dueDate), expected });
    }

    // User matches are fixed and hold their occurrence.
    const taken = new Set();
    for (const r of list) if (r.billMatch && r.billMatch.by === 'user') taken.add(`${r.billMatch.planId}|${r.billMatch.dueDate}`);

    const pairs = [];
    for (const r of list) {
        if ((r.billMatch && r.billMatch.by === 'user') || r.amountCents >= 0) continue;
        const amt = -r.amountCents, day = isoToDay(r.date);
        for (const o of occs) {
            if (taken.has(`${o.item.id}|${o.dueDate}`) || blockedFor(r, o.item.id)) continue;
            const rule = o.item.matchRule || {};
            const base = Number.isFinite(rule.dayTol) ? rule.dayTol : defDay;
            const tol = keyHit(r, o.item) ? Math.max(KEY_DAY_TOL, base) : base;
            const pct = Number.isFinite(rule.amtTolPct) ? rule.amtTolPct : defPct;
            const dist = Math.abs(day - o.due);
            const diff = Math.abs(amt - o.expected);
            if (dist > tol || diff * 100 > o.expected * pct) continue;
            pairs.push({ r, o, diff, dist, bank: r.source === 'csv' || r.source === 'pdf' ? 0 : 1 });
        }
    }
    pairs.sort((a, b) => a.diff - b.diff || a.dist - b.dist || a.bank - b.bank
        || cmp(a.r.date, b.r.date) || cmp(a.r.id, b.r.id)
        || cmp(a.o.dueDate, b.o.dueDate) || cmp(a.o.item.id, b.o.item.id));

    const assigned = new Map(); // row id -> occurrence
    for (const p of pairs) {
        const key = `${p.o.item.id}|${p.o.dueDate}`;
        if (assigned.has(p.r.id) || taken.has(key)) continue;
        assigned.set(p.r.id, p.o);
        taken.add(key);
    }

    const changed = [];
    const out = (rows || []).map((r) => {
        if (!r || (r.billMatch && r.billMatch.by === 'user')) return r;
        const o = assigned.get(r.id);
        const next = o ? { planId: o.item.id, dueDate: o.dueDate, by: 'auto' } : null;
        if (sameMatch(r.billMatch || null, next)) return r;
        changed.push(r.id);
        return { ...r, billMatch: next };
    });
    return { rows: out, changed };
}

/** "Not this bill": clear the match and stop it coming back (for one bill, or all when no planId). Returns a new row. */
export function markNotThisBill(row, planId) {
    let noMatch = true;
    if (planId) {
        const prev = Array.isArray(row.noMatch) ? row.noMatch : [];
        noMatch = row.noMatch === true ? true : (prev.includes(planId) ? prev : [...prev, planId]);
    }
    return { ...row, billMatch: null, noMatch };
}

/** The user pairs a row with an occurrence by hand: fixed, and it clears any noMatch for that bill. */
export function setUserMatch(row, planId, dueDate) {
    const next = { ...row, billMatch: { planId, dueDate, by: 'user' } };
    if (Array.isArray(row.noMatch)) next.noMatch = row.noMatch.filter((id) => id !== planId);
    else if (row.noMatch === true) delete next.noMatch;
    return next;
}

/**
 * The second half of learning: a hand-matched bill remembers the merchant, so next time it
 * matches inside the wider window. Mutates the plan item; returns true when a key was added.
 */
export function learnBillKey(item, key) {
    if (!item || !key) return false;
    const rule = item.matchRule && typeof item.matchRule === 'object' ? item.matchRule : (item.matchRule = {});
    if (!Array.isArray(rule.keys)) rule.keys = [];
    if (rule.keys.includes(key)) return false;
    rule.keys.push(key);
    return true;
}
