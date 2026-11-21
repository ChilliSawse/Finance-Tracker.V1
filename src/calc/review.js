// Monthly review maths (E3, plan section 2.13, FT-R-84). Pure: no DOM, no storage. The screen is built elsewhere
// from existing components; this is only the figures. Money is integer cents; months are 'YYYY-MM'.

import { getCycle, payDatesBetween } from './pay-cycle.js';
import { netPerPayCents, planTotals } from './plan.js';
import { allocateCents, bucketByRole } from './saving-model.js';
import { fireStatus, mojoSteps, mojoLivingCosts } from './fire.js';
import { smilePlan, transfersToUpdate } from './smile.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const pad = (n) => String(n).padStart(2, '0');
const monthOf = (iso) => String(iso).slice(0, 7);

/** The month before 'YYYY-MM'. */
export function previousMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** First and last day of a month, from the calendar. */
export function monthRange(month) {
    const [y, m] = month.split('-').map(Number);
    return { from: `${month}-01`, to: `${month}-${pad(new Date(y, m, 0).getDate())}` };
}

/**
 * The same bound transactions.js uses (from month-01 to month-31, compared as strings): true when a date falls in the month.
 * A 30-day month's last day is inside it (U28); the 1st of the next month is not.
 */
export function inMonth(dateIso, month) {
    const d = String(dateIso);
    return d >= `${month}-01` && d <= `${month}-31`;
}

/**
 * The month to review, or null. It is the previous complete calendar month, so on the 31st (or any day before the 1st)
 * the month just ending is not due yet. Null once review.lastOpenedMonth is that month or later, and null when the month
 * has no data: opts.hasTransactions (a Set of months, an array or a function) or movements dated in it.
 */
export function reviewDue(data, today, opts = {}) {
    const month = previousMonth(monthOf(today));
    const last = data && data.review && data.review.lastOpenedMonth;
    if (last && last >= month) return null;
    const moves = (data && data.savingModel && data.savingModel.movements) || [];
    if (moves.some((m) => m && inMonth(m.date, month))) return month;
    const t = opts.hasTransactions;
    const has = typeof t === 'function' ? t(month) : t instanceof Set ? t.has(month) : Array.isArray(t) ? t.includes(month) : false;
    return has ? month : null;
}

function spendingBlock(data, spend) {
    const cats = new Map(((data && data.categories) || []).map((c) => [c.id, c]));
    let essential = 0;
    let non = 0;
    const map = spend instanceof Map ? spend : new Map(Object.entries(spend || {}));
    map.forEach((cents, id) => {
        const c = cats.get(id);
        if (c && c.essential) essential += num(cents); else non += num(cents);
    });
    const totals = planTotals(data);
    const net = netPerPayCents(data);
    const takeHomeMonthCents = Math.round((net * totals.cyclesPerYear) / 12);
    const pct = (x) => (takeHomeMonthCents > 0 ? Math.round((x / takeHomeMonthCents) * 1000) / 10 : null);
    const planE = Math.round(totals.essentialPerMonth * 100);
    const planN = Math.round(totals.nonEssentialPerMonth * 100);
    return { essentialCents: essential, nonEssentialCents: non, totalCents: essential + non,
        plannedEssentialCents: planE, plannedNonEssentialCents: planN,
        essentialDiffCents: essential - planE, nonEssentialDiffCents: non - planN,
        takeHomeMonthCents, essentialPct: pct(essential), nonEssentialPct: pct(non) };
}

function movementsBlock(data, month, today) {
    const sm = (data && data.savingModel) || {};
    const rows = Array.isArray(data && data.allocation) ? data.allocation : [];
    const moves = Array.isArray(sm.movements) ? sm.movements : [];
    const on = !!(sm.autoCredit && sm.autoCredit.on);
    const goals = Array.isArray(data && data.bucketGoals) ? data.bucketGoals : [];
    const balanceNow = (id) => {
        const r = rows.find((x) => String(x.id) === String(id));
        if (r) return Math.round(num(r.currentBalance) * 100);
        const g = goals.find((x) => String(x.id) === String(id));
        return g ? Math.round(num(g.saved) * 100) : 0;
    };
    const nameOf = (id) => {
        const r = rows.find((x) => String(x.id) === String(id)) || goals.find((x) => String(x.id) === String(id));
        return (r && r.name) || String(id);
    };
    if (on) {
        const by = new Map();
        moves.forEach((m) => { if (m && inMonth(m.date, month)) by.set(String(m.bucketId), (by.get(String(m.bucketId)) || 0) + num(m.cents)); });
        const lines = [...by].map(([id, creditedCents]) => {
            const after = moves.filter((m) => m && String(m.bucketId) === id && m.date > monthRange(month).to)
                .reduce((s, m) => s + num(m.cents), 0);
            const endCents = balanceNow(id) - after;
            return { bucketId: id, name: nameOf(id), creditedCents, startCents: endCents - creditedCents, endCents };
        });
        return { planned: false, lines };
    }
    const sources = (data && data.incomeSources) || [];
    const src = sources[(data && data.primaryIncomeIndex) || 0] || sources[0] || null;
    const { from, to } = monthRange(month);
    const pays = src ? payDatesBetween(src, from, to).length : 0;
    const split = allocateCents(netPerPayCents(data), rows.map((r) => num(r.percentage)));
    const lines = rows.map((r, i) => ({ bucketId: String(r.id), name: r.name || '', creditedCents: split[i] * pays,
        startCents: null, endCents: null })).filter((l) => l.creditedCents > 0);
    return { planned: true, pays, lines };
}

function targetsBlock(data, today, payDates) {
    const sm = (data && data.savingModel) || {};
    const rows = Array.isArray(data && data.allocation) ? data.allocation : [];
    const mojoRow = bucketByRole(data, 'mojo');
    const mojoBal = mojoRow ? Math.round(num(mojoRow.currentBalance) * 100) : 0;
    const living = mojoLivingCosts({ essentialPerPayCents: Math.round(num(planTotals(data).essentialPerCycle) * 100),
        cyclesPerYear: planTotals(data).cyclesPerYear, basis: (sm.mojo && sm.mojo.basis) || 'auto' });
    const ladder = mojoSteps(sm.mojo || {}, living, mojoBal);
    const fire = fireStatus((sm.fire && sm.fire.targets) || [], (data && data.liabilities) || [],
        { balanceCents: mojoBal, targetCents: ladder.targetCents });
    const active = fire.targets.find((t) => t.id === fire.activeId) || null;
    const smileRow = rows.find((r) => r.role === 'smile');
    const net = netPerPayCents(data);
    const split = allocateCents(net, rows.map((r) => num(r.percentage)));
    const smileCents = smileRow ? split[rows.indexOf(smileRow)] : 0;
    const goals = (Array.isArray(data && data.bucketGoals) ? data.bucketGoals : [])
        .filter((g) => smileRow && String(g.parentId) === String(smileRow.id))
        .map((g) => {
            const p = smilePlan({ costCents: Math.round(num(g.target) * 100), savedCents: Math.round(num(g.saved) * 100), due: g.due || g.dueDate || null,
                smilePerPayCents: smileCents, sharePct: num(g.share), payDates, today });
            return { id: String(g.id), name: g.name || '', status: p.status, readyOn: p.readyOn, lateDays: p.lateDays };
        });
    return { fire: { activeId: fire.activeId, progress: active ? active.progress : null, free: fire.free }, mojo: ladder, smile: goals };
}

/**
 * The four blocks of the monthly review: spending, movements (planned when auto credit is off), targets, transfers.
 * args: {data, month, spendByCategory (Map categoryId to cents, outgoing only), today}.
 */
export function buildMonthlyReview({ data, month, spendByCategory, today } = {}) {
    const sources = (data && data.incomeSources) || [];
    const src = sources[(data && data.primaryIncomeIndex) || 0] || sources[0] || null;
    const cycle = getCycle(src, today);
    const payDates = cycle.mode === 'cycle' ? payDatesBetween(src, today, `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`) : [];
    return {
        month,
        spending: spendingBlock(data, spendByCategory),
        movements: movementsBlock(data, month, today),
        targets: targetsBlock(data, today, payDates),
        transfers: transfersToUpdate({ allocation: data && data.allocation, netCents: netPerPayCents(data),
            bankSetTo: data && data.savingModel && data.savingModel.bankSetTo }),
    };
}
