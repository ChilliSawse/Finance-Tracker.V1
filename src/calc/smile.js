// Smile goals, housing check and bank transfers (E3, plan section 2.9 to 2.11). Pure: no DOM, no storage.
// Money is integer cents. Dates are 'YYYY-MM-DD' strings.

import { perCycle } from './plan.js';
import { daysBetween } from './pay-cycle.js';
import { allocateCents } from './saving-model.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const sortedDates = (d) => (Array.isArray(d) ? [...d].sort() : []);
const roundShare = (smile, pct) => Math.floor((smile * pct) / 100 + 0.5);

/**
 * One Smile goal against the pay dates.
 * args: {costCents, savedCents, due (iso|null), smilePerPayCents, sharePct (default 100), payDates (upcoming, ascending), today (optional)}.
 * With a due date: paysLeft = pay dates after today (when given) up to and including due; perPayNeededCents =
 * remaining / paysLeft (rounded); sharePctNeeded = that against Smile's per-pay amount (2 dp).
 * readyOn = the pay date on which saved + k x (smilePerPay x share) reaches cost (null when the list runs out).
 * status: 'done' | 'impossible' (due, no pay left) | 'on-track' | 'late' (lateDays when readyOn is known) | 'no-date'.
 */
export function smilePlan({ costCents, savedCents, due = null, smilePerPayCents, sharePct = 100, payDates = [], today = null } = {}) {
    const cost = Math.max(0, Math.round(num(costCents)));
    const saved = Math.max(0, Math.round(num(savedCents)));
    const smile = Math.max(0, Math.round(num(smilePerPayCents)));
    const share = Math.max(0, num(sharePct));
    const dates = sortedDates(payDates).filter((d) => !today || d > today);
    const remaining = Math.max(0, cost - saved);
    const perPayCents = roundShare(smile, share);
    const out = { remainingCents: remaining, perPayCents, perPayNeededCents: null, sharePctNeeded: null,
        paysLeft: null, readyOn: null, readyIn: null, lateDays: null, status: 'no-date' };
    if (remaining === 0) {
        out.status = 'done'; out.readyIn = 0;
        out.paysLeft = due ? dates.filter((d) => d <= due).length : null;
        return out;
    }
    if (perPayCents > 0) {
        const k = Math.ceil(remaining / perPayCents);
        out.readyIn = k;
        out.readyOn = dates[k - 1] || null;
    }
    if (!due) return out;
    out.paysLeft = dates.filter((d) => d <= due).length;
    if (out.paysLeft === 0) { out.status = 'impossible'; return out; }
    out.perPayNeededCents = Math.floor(remaining / out.paysLeft + 0.5);
    out.sharePctNeeded = smile > 0 ? r2((out.perPayNeededCents / smile) * 100) : null;
    if (out.readyOn) {
        out.lateDays = Math.max(0, daysBetween(due, out.readyOn));
        out.status = out.readyOn <= due ? 'on-track' : 'late';
    } else {
        out.status = out.readyIn && out.readyIn <= out.paysLeft ? 'on-track' : 'late';
    }
    return out;
}

/** Smallest share (a multiple of step) that lands the goal on time, or null when it has no due date or no pay left. */
function neededShare(g, smile, dates, today, step) {
    const remaining = Math.max(0, Math.round(num(g.costCents)) - Math.round(num(g.savedCents)));
    if (remaining === 0) return 0;
    if (!g.due || smile <= 0) return null;
    const paysLeft = dates.filter((d) => d > (today || '') && d <= g.due).length;
    if (!paysLeft) return null;
    for (let i = 0; i * step <= 100 + 1e-9; i++) {
        if (roundShare(smile, i * step) * paysLeft >= remaining) return r1(i * step);
    }
    return null;
}

/**
 * Smallest share moves, in `step` percent (default 5), from on-time goals with slack to late goals that put
 * everyone on time. goals: [{id, name, costCents, savedCents, due, share}]. Goals without a due date keep their share.
 * Returns null when nobody is late. Otherwise {kind:'move', moves:[{fromId, toId, pct}], shares:{id: pct}}, or, when
 * the slack is not enough, {kind:'raise', neededPerPayCents, smilePct (of netCents, 0.1 up, or null)}.
 * Never applies anything: the caller shows the hint and writes on "Do that".
 */
export function suggestGoalShares({ goals, smilePerPayCents, payDates = [], today = null, netCents = 0, step = 5 } = {}) {
    const list = Array.isArray(goals) ? goals.filter((g) => g && typeof g === 'object') : [];
    const smile = Math.max(0, Math.round(num(smilePerPayCents)));
    const dates = sortedDates(payDates);
    const st = step > 0 ? step : 5;
    const plan = (g, share) => smilePlan({ costCents: g.costCents, savedCents: g.savedCents, due: g.due || null,
        smilePerPayCents: smile, sharePct: share, payDates: dates, today });
    const late = list.filter((g) => plan(g, num(g.share)).status === 'late');
    if (!late.length) return null;
    const shares = Object.fromEntries(list.map((g) => [String(g.id), num(g.share)]));
    const lateIds = new Set(late.map((g) => g.id));
    const needs = late.map((g) => ({ g, want: neededShare(g, smile, dates, today, st) }));
    const impossibleLate = needs.some((n) => n.want === null);
    const deficit = needs.reduce((s, n) => s + Math.max(0, (n.want == null ? 0 : n.want) - num(n.g.share)), 0);
    const donors = list.filter((g) => !lateIds.has(g.id) && g.due).map((g) => {
        const need = neededShare(g, smile, dates, today, st);
        const slack = need == null ? 0 : Math.max(0, Math.floor((num(g.share) - need) / st + 1e-9) * st);
        return { g, slack };
    }).filter((d) => d.slack > 0).sort((a, b) => b.slack - a.slack);
    const slackTotal = donors.reduce((s, d) => s + d.slack, 0);
    if (impossibleLate || deficit > slackTotal + 1e-9) {
        const need = list.reduce((s, g) => { const n = neededShare(g, smile, dates, today, 0.1); return s + (n == null ? num(g.share) : n); }, 0);
        const neededPerPayCents = Math.round((smile * need) / 100);
        const net = Math.round(num(netCents));
        return { kind: 'raise', neededPerPayCents, smilePct: net > 0 ? Math.ceil((neededPerPayCents / net) * 1000 - 1e-9) / 10 : null };
    }
    const moves = [];
    needs.forEach(({ g, want }) => {
        let rest = Math.max(0, want - num(g.share));
        for (const d of donors) {
            if (rest <= 0) break;
            const take = Math.min(d.slack, rest);
            if (take <= 0) continue;
            d.slack -= take; rest -= take;
            moves.push({ fromId: d.g.id, toId: g.id, pct: take });
            shares[String(d.g.id)] = r1(shares[String(d.g.id)] - take);
            shares[String(g.id)] = r1(shares[String(g.id)] + take);
        }
    });
    return { kind: 'move', moves, shares };
}

/**
 * Housing against take-home pay (a guide, not a rule). plan items whose categoryId is 'housing' (and in totals),
 * normalised to the pay cycle. Returns {perPayCents, pctOfTakeHome (1 dp), guide: 30, over, tone: 'neutral', itemsUsed}
 * or null when there is no housing item (or no take-home pay).
 */
export function housingCheck({ plan, netPerPayCents, cyclesPerYear = 26 } = {}) {
    const items = (Array.isArray(plan) ? plan : []).filter((it) => it && it.categoryId === 'housing' && it.inTotals !== false);
    const net = Math.round(num(netPerPayCents));
    if (!items.length || net <= 0) return null;
    const perPay = items.reduce((s, it) => s + perCycle(it, cyclesPerYear), 0);
    const perPayCents = Math.round(perPay * 100);
    const pct = Math.round((perPayCents / net) * 1000) / 10;
    return { perPayCents, pctOfTakeHome: pct, guide: 30, over: pct > 30, tone: 'neutral', itemsUsed: items.length };
}

/**
 * Bank transfers to update (state-derived). allocation: [{id, name, role, percentage, bankLabel}], bankSetTo: {id: cents}.
 * Mojo and Grow are left out. A row is listed when its current per-pay amount differs from bankSetTo by thresholdCents
 * or more (a bucket missing from bankSetTo is listed with wasCents null). A bankSetTo that is not an object means the
 * card has not been seeded, so the list is empty. Daily comes back with informational:true.
 */
export function transfersToUpdate({ allocation, netCents, bankSetTo, thresholdCents = 100 } = {}) {
    const rows = Array.isArray(allocation) ? allocation.filter((r) => r && typeof r === 'object') : [];
    if (!bankSetTo || typeof bankSetTo !== 'object') return [];
    const split = allocateCents(netCents, rows.map((r) => num(r.percentage)));
    const out = [];
    rows.forEach((r, i) => {
        if (r.role === 'mojo' || r.role === 'grow') return;
        const id = String(r.id);
        const was = Number.isFinite(bankSetTo[id]) ? bankSetTo[id] : null;
        const now = split[i];
        if (was !== null && Math.abs(now - was) < thresholdCents) return;
        out.push({ bucketId: id, name: r.name || '', bankLabel: r.bankLabel || '', nowCents: now, wasCents: was,
            informational: r.role === 'daily' });
    });
    return out;
}

/** Ticking writes bankSetTo[id] = now for each ticked row. Returns a new object. */
export function markTransfersDone(bankSetTo, rows) {
    const next = { ...(bankSetTo && typeof bankSetTo === 'object' ? bankSetTo : {}) };
    (Array.isArray(rows) ? rows : []).forEach((r) => { if (r && r.bucketId != null) next[String(r.bucketId)] = r.nowCents; });
    return next;
}
