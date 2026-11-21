// Goal planner (Phase 1 step F4; plan section 2.4, FT-R-34, FT-R-35, FT-R-93). Pure: no DOM, no storage.
// Money is integer cents. Dates are 'YYYY-MM-DD' strings.
//
// Two layers:
//  - planGoals(args): the pure core, every input passed in (cents, pay dates), so the mock's fixture
//    reproduces exactly.
//  - planGoalsFromData(data, opts): reads the (resolved) data, the bucket goals (E), the buckets (E5
//    getBuckets) and the pay dates (B1), and calls the core. `resolve` is injectable (F1's resolveAt by default).
//
// FT-R-35: the planner never adjusts Daily or Fire extinguisher. Every adjustment it returns has a kind
// in ADJUSTMENT_KINDS ('unallocated', 'splurge', 'earnings'); LOCKED_ROLES documents what is out of reach.

import { resolveAt } from './scenario.js';
import { netPerPayCents, effectiveBucket, perCycle } from './plan.js';
import { addDays, payDatesBetween } from './pay-cycle.js';
import { getBuckets } from '../state/saving-model.js';
import { getPayCyclesPerYear } from '../utils.js';

export const LOCKED_ROLES = ['daily', 'fire'];
export const ADJUSTMENT_KINDS = ['unallocated', 'splurge', 'earnings'];
/** The Mix option cuts this share of Splurge, rounded to the nearest A$10 (U-F11: a constant, Hand check 3). */
export const MIX_SHARE_PCT = 35;
export const MIX_ROUND_CENTS = 1000;
/** A cut above this share of Splurge shows the honest note (F4.4). */
export const BIG_CUT_SHARE = 0.5;

// Wording for explainRequired. Kept here so the lines and the figures cannot drift apart.
// UNVERIFIED with F8a: it may move these into the catalogue (src/i18n/en-f.js) when it renders them.
export const EXPLAIN_TEXT = {
    needed: (money) => `${money} still needed`,
    pays: (n) => `${n} ${n === 1 ? 'pay' : 'pays'}`,
    perPay: (money) => `${money} a pay`,
};

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const cents = (x) => Math.round(num(x));
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** 'A$9,456.16' from cents. */
export function audCents(c) {
    const v = cents(c);
    const body = (Math.abs(v) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${v < 0 ? '-' : ''}A$${body}`;
}

// ---------- required per pay ----------

/**
 * The highest over deadlines of (cumulative cost less funds counted) / pays on or before the deadline,
 * rounded UP to the cent. Goals are taken in due-date order; a goal with no due date has no deadline and
 * is left out (listed in `undated`). A goal with money still needed and no pay left is `impossible`.
 * args: {goals:[{id,name,costCents,due}], fundsCountedCents, payDates (upcoming), today (optional)}.
 * @returns {{requiredPerPayCents:number, bindingGoalId:string|null, perGoal:Array, impossible:string[], undated:string[]}}
 */
export function requiredPerPay({ goals, fundsCountedCents = 0, payDates = [], today = null } = {}) {
    const dates = (Array.isArray(payDates) ? [...payDates] : []).sort().filter((d) => !today || d > today);
    const funds = Math.max(0, cents(fundsCountedCents));
    const list = (Array.isArray(goals) ? goals : []).filter((g) => isObj(g));
    const dated = list.filter((g) => g.due).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const out = { requiredPerPayCents: 0, bindingGoalId: null, perGoal: [], impossible: [], undated: list.filter((g) => !g.due).map((g) => g.id) };
    let cum = 0;
    for (const g of dated) {
        cum += Math.max(0, cents(g.costCents));
        const needCents = Math.max(0, cum - funds);
        const pays = dates.filter((d) => d <= g.due).length;
        const row = { id: g.id, name: g.name, due: g.due, cumulativeCostCents: cum, needCents, pays, perPayCents: 0, impossible: false };
        if (needCents > 0 && pays === 0) { row.impossible = true; out.impossible.push(g.id); }
        else if (needCents > 0) row.perPayCents = Math.ceil(needCents / pays);
        if (row.perPayCents > out.requiredPerPayCents) { out.requiredPerPayCents = row.perPayCents; out.bindingGoalId = g.id; }
        out.perGoal.push(row);
    }
    return out;
}

// ---------- the options ----------

/** The Mix cut: 35% of Splurge rounded to the nearest A$10 (280 gives 100, 343.84 gives 120). */
export function mixCutCents(splurgePerPayCents) {
    const s = Math.max(0, cents(splurgePerPayCents));
    return Math.floor((s * MIX_SHARE_PCT + 50 * MIX_ROUND_CENTS) / (100 * MIX_ROUND_CENTS)) * MIX_ROUND_CENTS;
}

function buildOption(id, cutWanted, gapCents, splurgeCents, unallocatedUsed) {
    const cut = Math.max(0, Math.min(cutWanted, gapCents, splurgeCents)); // never above Splurge, never above the gap
    const earned = gapCents - cut;
    const adjustments = [];
    if (unallocatedUsed > 0) adjustments.push({ kind: 'unallocated', cents: unallocatedUsed });
    if (cut > 0) adjustments.push({ kind: 'splurge', cents: cut });
    if (earned > 0) adjustments.push({ kind: 'earnings', cents: earned });
    return {
        id, cutCents: cut, splurgeLeftCents: splurgeCents - cut, earnedCents: earned,
        cutPct: splurgeCents > 0 ? Math.round((cut / splurgeCents) * 1000) / 10 : 0,
        bigCut: cut > splurgeCents * BIG_CUT_SHARE,
        adjustments,
    };
}

/**
 * Plan the goals against the pay dates.
 * args: {goals, fundsCountedCents, payDates, today, smilePerPayCents, splurgePerPayCents, unallocatedPerPayCents}.
 * The gap (required less what Smile already gets each pay) is closed in order: unallocated money, then
 * Splurge, then the earnings gap. Daily and Fire extinguisher are not inputs, so they cannot be changed.
 * @returns {{requiredPerPayCents, bindingGoalId, perGoal, impossible, undated, fundsCountedCents, smilePerPayCents,
 *   splurgePerPayCents, gapCents, unallocatedUsedCents, gapAfterUnallocatedCents, options:{cut,mix,earn}, onTrack:boolean}}
 */
export function planGoals({
    goals = [], fundsCountedCents = 0, payDates = [], today = null,
    smilePerPayCents = 0, splurgePerPayCents = 0, unallocatedPerPayCents = 0,
} = {}) {
    const req = requiredPerPay({ goals, fundsCountedCents, payDates, today });
    const smile = Math.max(0, cents(smilePerPayCents));
    const splurge = Math.max(0, cents(splurgePerPayCents));
    const gap = Math.max(0, req.requiredPerPayCents - smile);
    const unallocatedUsed = Math.min(gap, Math.max(0, cents(unallocatedPerPayCents)));
    const rest = gap - unallocatedUsed;
    return {
        ...req,
        fundsCountedCents: Math.max(0, cents(fundsCountedCents)),
        smilePerPayCents: smile, splurgePerPayCents: splurge,
        gapCents: gap, unallocatedUsedCents: unallocatedUsed, gapAfterUnallocatedCents: rest,
        onTrack: gap === 0 && req.impossible.length === 0,
        options: {
            cut: buildOption('cut', rest, rest, splurge, unallocatedUsed),
            mix: buildOption('mix', mixCutCents(splurge), rest, splurge, unallocatedUsed),
            earn: buildOption('earn', 0, rest, splurge, unallocatedUsed),
        },
    };
}

/**
 * Tick Splurge plan items against a cut, biggest first, until the cut is covered.
 * items: [{id, name, perPayCents}]. Returns the items in order with `ticked`, the ticked total and
 * what is still missing (`shortCents`) or over (`overCents`).
 */
export function tickSplurgeItems(items, cutCents) {
    const want = Math.max(0, cents(cutCents));
    const sorted = (Array.isArray(items) ? items : []).filter((i) => isObj(i) && num(i.perPayCents) > 0)
        .map((i, n) => ({ ...i, perPayCents: cents(i.perPayCents), n }))
        .sort((a, b) => b.perPayCents - a.perPayCents || a.n - b.n);
    let sum = 0;
    const out = sorted.map(({ n, ...i }) => {
        const ticked = sum < want;
        if (ticked) sum += i.perPayCents;
        return { ...i, ticked };
    });
    return { items: out, tickedCents: sum, shortCents: Math.max(0, want - sum), overCents: Math.max(0, sum - want) };
}

// ---------- earnings three ways ----------

/** Extra annual gross needed on the primary source for `extraNetPerPayCents` more take-home a pay. */
const GROSS_SEARCH_CAP_CENTS = 1e9 * 100; // A$1 billion a year: beyond this, say "not reachable"

function primaryIndex(data) {
    const sources = (data && data.incomeSources) || [];
    const i = Number.isInteger(data && data.primaryIncomeIndex) ? data.primaryIncomeIndex : 0;
    return sources[i] ? i : 0;
}

/**
 * Bisection on the primary source's annual gross through the real engine (`netPerPayCents`, so tax, Medicare
 * and HELP count; the mock's flat 0.68 is not used). Finds the smallest extra gross, in cents a year, whose
 * take-home rise is at least `extraNetPerPayCents`. `data` may be a resolved scenario clone; it is never changed.
 * Returns null when the source is missing, the figure is not positive, or no gross reaches it (a payslip
 * override pins the net, so a source with one cannot be searched).
 * @returns {{extraGrossAnnualCents:number, extraGrossPerPayCents:number, netPerPayBeforeCents:number, netPerPayAfterCents:number}|null}
 */
export function grossForExtraNet(data, extraNetPerPayCents, opts = {}) {
    const target = cents(extraNetPerPayCents);
    if (!isObj(data) || !Array.isArray(data.incomeSources) || target <= 0) return null;
    const idx = Number.isInteger(opts.sourceIndex) ? opts.sourceIndex : primaryIndex(data);
    const source = data.incomeSources[idx];
    if (!source) return null;
    const work = clone(data);
    const base = netPerPayCents(work);
    const baseGross = num(source.grossAnnual);
    const netAt = (extraCents) => {
        work.incomeSources[idx].grossAnnual = baseGross + extraCents / 100;
        return netPerPayCents(work) - base;
    };
    let hi = 100 * 100;
    while (netAt(hi) < target) {
        hi *= 2;
        if (hi > GROSS_SEARCH_CAP_CENTS) return null;
    }
    let lo = 0; // netAt(lo) < target is guaranteed because target > 0
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (netAt(mid) >= target) hi = mid; else lo = mid;
    }
    const cycles = getPayCyclesPerYear(source.paySchedule) || 26;
    return {
        extraGrossAnnualCents: hi, extraGrossPerPayCents: Math.round(hi / cycles),
        netPerPayBeforeCents: base, netPerPayAfterCents: base + netAt(hi),
    };
}

/** The source's hourly rate in dollars: its own `hourlyRate`, else gross over (hours a cycle x cycles), else null. */
export function hourlyRateOf(source) {
    if (!isObj(source)) return null;
    if (num(source.hourlyRate) > 0) return num(source.hourlyRate);
    const cycles = getPayCyclesPerYear(source.paySchedule) || 26;
    const perCycleHours = num(source.hoursPerCycle) || (num(source.hoursPerWeek) * 52) / cycles;
    return num(source.grossAnnual) > 0 && perCycleHours > 0 ? num(source.grossAnnual) / (perCycleHours * cycles) : null;
}

/**
 * The earnings gap shown three ways, always together: take-home per pay; before tax per pay and per year;
 * extra hours (before tax per pay over the source's rate, 1 dp). The before-tax figure is the bisection above.
 * Null figures when no bisection answer exists. A zero gap gives zeros.
 */
export function earningsThreeWays(data, earnedPerPayCents, opts = {}) {
    const takeHome = Math.max(0, cents(earnedPerPayCents));
    const idx = isObj(data) && Array.isArray(data.incomeSources) ? (Number.isInteger(opts.sourceIndex) ? opts.sourceIndex : primaryIndex(data)) : 0;
    const source = isObj(data) && Array.isArray(data.incomeSources) ? data.incomeSources[idx] : null;
    const rate = hourlyRateOf(source);
    const out = { takeHomePerPayCents: takeHome, beforeTaxPerPayCents: 0, beforeTaxPerYearCents: 0, hoursPerPay: 0, hourlyRate: rate, reachable: true };
    if (takeHome === 0) return out;
    const g = grossForExtraNet(data, takeHome, { sourceIndex: idx });
    if (!g) return { ...out, beforeTaxPerPayCents: null, beforeTaxPerYearCents: null, hoursPerPay: null, reachable: false };
    out.beforeTaxPerPayCents = g.extraGrossPerPayCents;
    out.beforeTaxPerYearCents = g.extraGrossAnnualCents;
    out.hoursPerPay = rate ? Math.round((g.extraGrossPerPayCents / 100 / rate) * 10) / 10 : null;
    return out;
}

// ---------- explain ----------

/**
 * The lines behind the required figure, with the same cents as the result: "A$9,456.16 still needed",
 * "15 pays", "A$630.42 a pay". Explains the binding goal. Empty when nothing is required.
 */
export function explainRequired(plan) {
    if (!isObj(plan) || !plan.requiredPerPayCents || !plan.bindingGoalId) return { goalId: null, goalName: null, lines: [] };
    const row = (plan.perGoal || []).find((g) => g.id === plan.bindingGoalId);
    if (!row) return { goalId: null, goalName: null, lines: [] };
    return {
        goalId: row.id, goalName: row.name || null, due: row.due,
        needCents: row.needCents, pays: row.pays, perPayCents: row.perPayCents,
        lines: [EXPLAIN_TEXT.needed(audCents(row.needCents)), EXPLAIN_TEXT.pays(row.pays), EXPLAIN_TEXT.perPay(audCents(row.perPayCents))],
    };
}

// ---------- from data ----------

function activeOn(change, date) {
    if (!date) return true;
    return (!change.from || change.from <= date) && (!change.until || date < change.until);
}

/** Ids a scenario ticks as "count towards goals" on a date (FT-R-93): [{collection, id}]. */
export function goalFundTicks(changes, date) {
    const out = [];
    for (const c of Array.isArray(changes) ? changes : []) {
        if (!isObj(c) || c.kind !== 'goalFund' || !activeOn(c, date)) continue;
        if (c.op === 'remove' || c.value === false) continue;
        const tg = isObj(c.target) ? c.target : null;
        if (tg && tg.id != null) out.push({ collection: tg.collection || 'allocation', id: String(tg.id) });
    }
    return out;
}

/**
 * What counts towards goals: every Smile bucket's balance (always; it already holds the goals' saved),
 * plus a bucket (Mojo, Grow, any row) or an asset only when a `goalFund` change ticks it (FT-R-93).
 * @returns {{totalCents:number, items:Array<{id:string, label:string, kind:'smile'|'bucket'|'asset', cents:number}>}}
 */
export function fundsCounted(data, buckets, ticks = []) {
    const items = [];
    const seen = new Set();
    for (const b of buckets.filter((x) => !x.parentId)) {
        if (b.role === 'smile') { items.push({ id: b.id, label: b.name, kind: 'smile', cents: b.balanceCents }); seen.add(b.id); }
    }
    for (const t of ticks) {
        const key = `${t.collection}:${t.id}`;
        if (seen.has(key) || seen.has(t.id)) continue;
        if (t.collection === 'assets') {
            const a = (Array.isArray(data.assets) ? data.assets : []).find((x) => x && String(x.id) === t.id);
            if (a) { items.push({ id: t.id, label: a.name || t.id, kind: 'asset', cents: Math.max(0, Math.round(num(a.balance) * 100)) }); seen.add(key); }
        } else {
            const b = buckets.find((x) => !x.parentId && x.id === t.id);
            if (b) { items.push({ id: b.id, label: b.name, kind: 'bucket', cents: b.balanceCents }); seen.add(b.id); }
        }
    }
    return { totalCents: items.reduce((s, i) => s + i.cents, 0), items };
}

/** Plan items that draw on Splurge, per pay in cents, biggest first (the list the slider ticks). */
export function splurgePlanItems(data) {
    if (!isObj(data) || !Array.isArray(data.plan)) return [];
    const cats = new Map((data.categories || []).map((c) => [c.id, c]));
    const alloc = Array.isArray(data.allocation) ? data.allocation : [];
    const cycles = getPayCyclesPerYear((data.incomeSources && data.incomeSources[primaryIndex(data)] || {}).paySchedule) || 26;
    const out = [];
    for (const it of data.plan) {
        if (!isObj(it) || it.inTotals === false) continue;
        const cat = cats.get(it.categoryId) || null;
        if (cat && cat.essential) continue;
        const bid = effectiveBucket(null, cat, it, alloc);
        const row = alloc.find((a) => a && a.id === bid);
        if (!row || row.role !== 'splurge') continue;
        const c = Math.round(perCycle(it, cycles) * 100);
        if (c > 0) out.push({ id: it.id, name: it.name, perPayCents: c });
    }
    return out.sort((a, b) => b.perPayCents - a.perPayCents);
}

/**
 * The planner on a data object. `changes` (scenario overrides) are applied through `resolve` (F1's resolveAt,
 * injectable for tests) at `date` (default today). Goals are the leaf `bucketGoals` under Smile, not done.
 * opts: {today, date, changes, resolve, payDates, unallocatedPerPayCents}.
 * Month-mode pay (no anchor) has no pay dates, so every dated goal with money needed comes back `impossible`
 * unless `payDates` is given.
 */
export function planGoalsFromData(data, opts = {}) {
    const today = opts.today || null;
    const date = opts.date || today;
    const resolve = typeof opts.resolve === 'function' ? opts.resolve : resolveAt;
    const changes = Array.isArray(opts.changes) ? opts.changes : [];
    const resolved = resolve(data, changes, date);
    const buckets = getBuckets(resolved, today);
    const smileIds = new Set(buckets.filter((b) => !b.parentId && b.role === 'smile').map((b) => b.id));
    const rawGoals = Array.isArray(resolved.bucketGoals) ? resolved.bucketGoals : [];
    const hasChild = new Set(rawGoals.filter((g) => isObj(g) && g.parentId != null).map((g) => String(g.parentId)));
    const rootOf = (g) => { // follow parentId up to the allocation row
        let cur = g; let guard = 0;
        while (cur && guard++ < 10) {
            if (smileIds.has(String(cur.parentId))) return true;
            cur = rawGoals.find((x) => x && String(x.id) === String(cur.parentId));
        }
        return false;
    };
    const goals = rawGoals.filter((g) => isObj(g) && !g.done && !hasChild.has(String(g.id)) && rootOf(g))
        .map((g) => ({ id: String(g.id), name: g.name, costCents: Math.round(num(g.cost) * 100), due: g.due || null }));

    const funds = fundsCounted(resolved, buckets, goalFundTicks(changes, date));
    const idx = primaryIndex(resolved);
    const source = (resolved.incomeSources || [])[idx] || null;
    const lastDue = goals.reduce((m, g) => (g.due && g.due > m ? g.due : m), '');
    let payDates = Array.isArray(opts.payDates) ? opts.payDates : null;
    if (!payDates) payDates = source && today && lastDue ? payDatesBetween(source, addDays(today, 1), lastDue) : [];
    const topPerPay = (role) => buckets.filter((b) => !b.parentId && b.role === role).reduce((s, b) => s + b.perPayCents, 0);
    const plan = planGoals({
        goals, fundsCountedCents: funds.totalCents, payDates, today,
        smilePerPayCents: topPerPay('smile'), splurgePerPayCents: topPerPay('splurge'),
        unallocatedPerPayCents: opts.unallocatedPerPayCents || 0,
    });
    return { ...plan, counted: funds.items, splurgeItems: splurgePlanItems(resolved), resolved };
}
