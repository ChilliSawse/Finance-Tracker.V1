// FI engine (owner: F3). Pure: no DOM, no storage, inputs never mutated.
// Contract: docs/PHASE1-CONTRACT.md. Used by F6 (Future screen), F7 (What If), F8.
//
// Convention (settled, FT-R-89 and slice F 2.3): yearly steps, contributions at year end,
// growth on the opening pool, today's dollars, every rate real = nominal minus
// `fiSettings.inflation` by simple subtraction (the mock's 7% - 2.5% = 4.5%).
// Debts and HELP are run in nominal dollars for the year and deflated to today's dollars at the end.
//
// Money in `data` is dollars (legacy fields) and bucket amounts come from `getBuckets` in cents.
// Everything returned here is dollars, except where a name says Cents.
//
// Two layers: `runPlan(start, inputsFor, opts)` is the plain engine (the tests drive it with
// given pools and flows); `projectNetWorth`, `yearsToFI` and `fiSummary` read a data object and
// call it. With scenario `changes`, the data is resolved for each year through `resolve`
// (default F1's `resolveAt`), so flows and the FI number follow the plan as it stands that year.
// Opening balances (assets, debts, HELP) come from the data as it is today.

import { assetValueAt, valueDetail, assetScope, loanScope, heldOutAssets, pendingLoanLinks, effectiveAsset, effectiveAnnualRate, debtStep, debtRateAt, PERIODS_PER_YEAR } from './assets-debts.js';
import { resolveAt as defaultResolve } from './scenario.js';
import { planTotals } from './plan.js';
import { calculateTotals } from './calculations.js';
import { calculateHelpRepayment, getTaxYear } from './tax-au.js';
import { addMonthsClamped, parseIso, toIso } from './pay-cycle.js';
import { mojoLivingCosts, mojoSteps } from './fire.js';
import { getBuckets } from '../state/saving-model.js';

/** Past this many years from now a plan is "not at this pace". */
export const MAX_YEARS = 100;
/** Super is locked until the preservation age (FT-R-92). */
export const PRESERVATION_AGE = 60;

const DEFAULT_INFLATION = 2.5;
const DEFAULT_RETURN = 7;
const DEFAULT_MULTIPLE = 25;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x) => (isNum(x) ? x : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));
const round2 = (x) => Math.round(x * 100) / 100;
const todayIsoOf = (today) => toIso(parseIso(today == null ? new Date() : today));

// ---------- the plain engine ----------

/**
 * Real growth of one asset for one year, from its balance. Cash: its effective interest less
 * inflation; invested: its own expected return (or the plan's default) less inflation;
 * appreciating: its growth rate less inflation (blank = flat real). An asset whose kind is only
 * suggested is cash at 0% real (F2's rule). Depreciating assets are not stepped here.
 * Goes through F2's `assetValueAt` with the rate already made real, so the rounding is its own.
 */
function stepAsset(assetIn, kind, bal, inflationPct, defaultReturnPct) {
    if (assetIn.kindSuggested) return round2(bal);
    // FT-R-117/126: a rate a reference type filled stays out until confirmed. FT-R-125: a type with no reliable rate
    // (crypto) is flat and never takes the plan's default return.
    const asset = effectiveAsset(assetIn);
    if (asset.rateMode === 'noReliableRate') return round2(bal);
    if (kind === 'cash') {
        if (!isNum(asset.interestRate)) return round2(bal);
        const real = effectiveAnnualRate(asset.interestRate, asset.interestFrequency) * 100 - inflationPct;
        return assetValueAt({ kind: 'cash', balance: bal, interestRate: real, interestFrequency: 'yearly' }, 1);
    }
    if (kind === 'invested') {
        const nominal = isNum(asset.expectedReturn) ? asset.expectedReturn : defaultReturnPct;
        return assetValueAt({ kind: 'invested', balance: bal, expectedReturn: nominal - inflationPct }, 1);
    }
    if (kind === 'appreciating') {
        if (!isNum(asset.growthRate)) return round2(bal);
        return assetValueAt({ kind: 'appreciating', balance: bal, growthRate: asset.growthRate - inflationPct }, 1);
    }
    return round2(bal);
}

/** The kind an asset counts as: a suggested kind is cash until confirmed. */
function kindOf(asset) {
    if (!asset || asset.kindSuggested) return 'cash';
    return ['cash', 'invested', 'appreciating', 'depreciating'].includes(asset.kind) ? asset.kind : 'cash';
}

/**
 * Which pool an asset sits in for the FI count (FT-R-125, see assetScope): 'held' (its kind is only suggested: net worth
 * only until confirmed, FT-R-128 1), 'dep' (loses value or stable: net worth only), 'home' (counts only as an investment),
 * 'super' (from the preservation age) or 'plain'.
 */
function classOf(asset) {
    if (!asset) return 'plain';
    if (asset.kindSuggested) return 'held';
    if (asset.kind === 'depreciating') return 'dep';
    if (asset.isSuper) return 'super';
    if (asset.kind === 'appreciating') return 'home';
    return 'plain';
}

/**
 * The one source of birth years, for `fiAge` and the super unlock alike: `data.people[].birthYear` when any is given
 * (the Future screen's view fills it), else `fiSettings.birthYears[]`. Returns [{name, birthYear}].
 */
function peopleWithBirthYear(d) {
    const fromPeople = (d && Array.isArray(d.people) ? d.people : []).filter((p) => p && isNum(p.birthYear));
    if (fromPeople.length) return fromPeople.map((p) => ({ name: typeof p.name === 'string' ? p.name : '', birthYear: p.birthYear }));
    const list = d && d.fiSettings && Array.isArray(d.fiSettings.birthYears) ? d.fiSettings.birthYears : [];
    return list.filter((y) => isNum(y)).map((y) => ({ name: '', birthYear: y }));
}

/**
 * Age of the youngest person with a birth year at `dateIso`, or null when none is known. Assets have no owner, so the
 * youngest decides when super unlocks (FT-R-128 2: all super unlocks when the younger person turns 60, until super is tracked per person).
 */
function ageAt(d, dateIso) {
    const years = peopleWithBirthYear(d).map((p) => p.birthYear).filter((y) => y > 1850);
    if (!years.length) return null;
    return parseIso(dateIso).getFullYear() - Math.max(...years);
}

/** One year of a debt in nominal dollars (its own compounding, minimum and fixed-rate end); returns the year-end balance. */
function stepDebtYear(debt, balance, dateIso) {
    let cents = Math.max(0, Math.round(num(balance) * 100));
    if (cents === 0) return 0;
    const compounding = debt.compounding || 'monthly';
    const freq = debt.repaymentFrequency || 'monthly';
    const m = PERIODS_PER_YEAR[freq] || 12;
    const paymentCents = Math.max(0, Math.round(num(debt.minRepayment) * 100));
    const ratePct = debtRateAt(debt, dateIso);
    for (let i = 0; i < m && cents > 0; i++) {
        cents = debtStep({ balanceCents: cents, ratePct, compounding, repaymentFrequency: freq, paymentCents }).balanceCents;
    }
    return cents / 100;
}

/**
 * Solve inside the crossing year: opening pool P, real rate r, contribution A at year end as a
 * continuous annuity, to reach `target`. Exact for one pool (the old `calculateYearsToFI` formula);
 * returns a fraction in (0, 1].
 */
function fractionInYear(P, r, A, target) {
    const linear = A > 0 ? (target - P) / A : 1;
    let f;
    if (Math.abs(r) < 1e-12) f = linear;
    else {
        const num_ = target * r + A, den = P * r + A;
        f = den > 0 && num_ > 0 ? Math.log(num_ / den) / Math.log(1 + r) : linear;
    }
    if (!Number.isFinite(f)) f = linear;
    return Math.min(1, Math.max(0, f));
}

/**
 * Solve inside the crossing year when the need itself moves across the year (the bridge to 60 shrinks every year): the
 * net worth (opening P, real rate r, contribution A as a continuous annuity) against a need that runs in a straight line
 * from `need0` to `need1`. With a constant need this is exactly `fractionInYear`. Net worth starts below the need and ends at
 * or above it, so the first fraction where it is not below is found by bisection.
 */
function fractionAgainstMovingNeed(P, r, A, need0, need1) {
    if (Math.abs(need1 - need0) < 1e-9) return fractionInYear(P, r, A, need1);
    const nw = (f) => (Math.abs(r) < 1e-12 ? P + A * f : P * Math.pow(1 + r, f) + (A * (Math.pow(1 + r, f) - 1)) / r);
    const gap = (f) => nw(f) - (need0 + (need1 - need0) * f);
    if (gap(1) < 0) return 1;
    if (gap(0) >= 0) return 0;
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (gap(mid) >= 0) hi = mid; else lo = mid; }
    return hi;
}

/**
 * Run the plan year by year.
 *
 * start: { openInvested, openCash (pools that flows add to; default 0), assets: [raw asset],
 *   debts: [raw liability, with id], helpBalance, sinks: [ {type:'debt', id} | {type:'mojo'|'home'|'saver', capacity}
 *   | {type:'super'} ], }  Fire money goes down the sinks in order, the rest to the invested pool.
 * inputsFor(k) -> { dateIso, inflationPct, expectedReturnPct, fiNumber, fireYear, superYear, helpIncome, helpIndexationPct }
 *   for year k (k = 0 is now), used for the year k to k + 1 (and its FI number for the year-end of k + 1 in `path[k+1]`).
 * opts: { years (path length to produce, default 30), untilFI (keep going to MAX_YEARS until FI is found, default true) }
 *
 * @returns {{path:Array, yearsToFI:number}}
 */
export function runPlan(start, inputsFor, opts = {}) {
    const horizon = opts.years == null ? 30 : Math.max(0, Math.floor(opts.years));
    const untilFI = opts.untilFI !== false;
    // FT-R-117/126: read each asset without what a reference type filled and the person has not confirmed (kind, super, rate, curve).
    const assets = (start.assets || []).map((raw) => { const a = effectiveAsset(raw); return { a, kind: kindOf(a), cls: classOf(a), counts: assetScope(a).fi === 'yes', bal: num(a.balance) }; });
    // FT-R-128 3: a loan confirmed as for a home you live in leaves FI with the home (and stays in net worth); a suggested link or
    // no link leaves it in. The same call as the person's own Debts screen would make, from the opening assets.
    const debts = (start.debts || []).map((d) => ({ d, bal: Math.max(0, num(d.balance)), fi: loanScope(d, start.assets).fi === 'yes' }));
    const heldOut = heldOutAssets(start.assets);
    const sinks = (start.sinks || []).map((s) => ({ ...s, left: s.type === 'debt' ? null : Math.max(0, num(s.capacity)) }));
    let help = Math.max(0, num(start.helpBalance));
    let pool = { invested: num(start.openInvested), cash: num(start.openCash), super: num(start.openSuper) };

    const asOf = inputsFor(0).dateIso;
    const snapshot = (k, inp, extra) => {
        let cash = pool.cash, invested = pool.invested, appreciating = 0, depreciating = 0, liveIn = 0, superBal = pool.super, heldBal = 0;
        for (const x of assets) {
            if (x.cls === 'held') heldBal += x.bal;
            else if (x.cls === 'dep') depreciating += valueDetail(x.a, k, { asOf }).value;
            else if (x.cls === 'super') superBal += x.bal;
            else if (x.cls === 'home') { if (x.counts) appreciating += x.bal; else liveIn += x.bal; }
            else if (x.kind === 'cash') cash += x.bal;
            else if (x.kind === 'invested') invested += x.bal;
            else appreciating += x.bal;
        }
        const debtTotal = debts.reduce((s, x) => s + x.bal, 0);
        const debtFi = debts.reduce((s, x) => s + (x.fi ? x.bal : 0), 0);
        const debtOut = debtTotal - debtFi;
        // FT-R-125 (2): super counts from 60. Under 60 it is locked, and the money outside it must cover the years to 60
        // (the bridge). An unknown age counts super as before (the Future screen asks for a birth year).
        const age = isNum(inp.age) ? inp.age : null;
        const superCounted = age === null || age >= PRESERVATION_AGE;
        const superLocked = superCounted ? 0 : superBal;
        if (superCounted) invested += superBal;
        const fiNetWorth = cash + invested + appreciating - debtFi - help;
        let fiNeeded = num(inp.fiNumber);
        let bridge = 0;
        if (!superCounted) {
            const n = PRESERVATION_AGE - age;
            const r = ((isNum(inp.expectedReturnPct) ? inp.expectedReturnPct : DEFAULT_RETURN) - (isNum(inp.inflationPct) ? inp.inflationPct : DEFAULT_INFLATION)) / 100;
            // Each year's spending is taken at the START of the year (the cautious choice): an annuity due.
            const annuity = Math.abs(r) < 1e-12 ? n : ((1 - Math.pow(1 + r, -n)) / r) * (1 + r);
            bridge = num(inp.spendYear) * annuity;
            fiNeeded = Math.max(bridge, bridge + num(inp.fiNumber) / Math.pow(1 + r, n) - superLocked);
        }
        return {
            year: k, fiNetWorth, netWorth: fiNetWorth + superLocked + depreciating + liveIn + heldBal - debtOut, cash, invested, appreciating, depreciating,
            liveIn, superLocked, superCounted, superBal, bridge: round2(bridge), fiNeeded: round2(fiNeeded),
            debts: debtTotal, debtsFi: debtFi, debtsOutOfFi: debtOut, heldOutValue: heldBal, heldOut, help, fiNumber: inp.fiNumber, ...extra,
        };
    };

    const first = inputsFor(0);
    const path = [snapshot(0, first, { fire: 0, super: 0, growth: 0 })];
    const number0 = num(first.fiNumber);
    if (number0 <= 0 || path[0].fiNetWorth >= path[0].fiNeeded) return { path, yearsToFI: 0 };

    let anyFlow = false;
    let yearsToFI = Infinity;
    for (let y = 0; y < MAX_YEARS; y++) {
        if (y >= horizon && (!untilFI || Number.isFinite(yearsToFI))) break;
        const inp = inputsFor(y);
        const infl = isNum(inp.inflationPct) ? inp.inflationPct : DEFAULT_INFLATION;
        const retPct = isNum(inp.expectedReturnPct) ? inp.expectedReturnPct : DEFAULT_RETURN;
        const realInv = (retPct - infl) / 100;
        const deflate = 1 + infl / 100;
        const before = path[path.length - 1];

        // Growth on the opening pools and assets.
        pool = { invested: pool.invested * (1 + realInv), cash: pool.cash, super: pool.super * (1 + realInv) };
        for (const x of assets) if (x.kind !== 'depreciating') x.bal = stepAsset(x.a, x.kind, x.bal, infl, retPct);

        // Debts (their own schedule), then HELP (indexation less the repayment taken through tax).
        const debtEnd = debts.map((x) => stepDebtYear(x.d, x.bal, inp.dateIso));
        const idx = isNum(inp.helpIndexationPct) ? inp.helpIndexationPct / 100 : 0;
        help = Math.max(0, help * (1 + idx) - Math.max(0, num(inp.helpRepayment))) / deflate;

        // Year-end money: Fire down the sinks in order, super and the rest to the invested pool.
        let fireLeft = Math.max(0, num(inp.fireYear));
        let fireSuper = false;
        let fireToExcluded = 0; // Fire money that paid a loan which is out of FI: net worth moves, the FI figure does not
        const superYear = Math.max(0, num(inp.superYear));
        for (const s of sinks) {
            if (fireLeft <= 0) break;
            if (s.type === 'debt') {
                const i = debts.findIndex((x) => x.d.id === s.id);
                if (i < 0) continue;
                const pay = Math.min(fireLeft, debtEnd[i]);
                debtEnd[i] -= pay;
                fireLeft -= pay;
                if (!debts[i].fi) fireToExcluded += pay;
            } else if (s.type === 'mojo' || s.type === 'home' || s.type === 'saver') {
                const pay = Math.min(fireLeft, s.left);
                s.left -= pay;
                pool.cash += pay;
                fireLeft -= pay;
            } else if (s.type === 'super') {
                fireSuper = true; // open-ended: what is left goes to super (a top-up), locked until 60 like the rest of it
                break;
            }
        }
        debts.forEach((x, i) => { x.bal = debtEnd[i] / deflate; });
        const fireTotal = Math.max(0, num(inp.fireYear));
        const toSuper = fireSuper ? fireLeft : 0; // with no super target the rest goes to the invested pool
        pool.invested += fireLeft - toSuper;
        pool.super += superYear + toSuper;

        const contrib = fireTotal + superYear;
        if (contrib > 0) anyFlow = true;
        const next = snapshot(y + 1, inputsFor(y + 1), { fire: fireTotal, super: superYear, growth: 0 });
        // Super flows count only once super does; the jump when it unlocks is not growth.
        const counted = (next.superCounted ? fireTotal + superYear : fireTotal - toSuper) - fireToExcluded;
        const unlock = next.superCounted && !before.superCounted ? next.superBal : 0;
        next.growth = next.fiNetWorth - before.fiNetWorth - counted - unlock;
        path.push(next);

        if (!Number.isFinite(yearsToFI) && anyFlow && next.fiNetWorth >= next.fiNeeded && next.fiNumber > 0) {
            const P = before.fiNetWorth;
            const r = P > 1e-9 ? next.growth / P : realInv;
            const A = next.fiNetWorth - P * (1 + r);
            yearsToFI = y + fractionAgainstMovingNeed(P, r, A, before.fiNeeded, next.fiNeeded);
        }
    }
    return { path: path.slice(0, Math.max(horizon, 0) + 1), yearsToFI };
}

// ---------- reading a data object ----------

function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
}

function bucketPerPayCents(buckets, role) {
    return buckets.filter((b) => b.parentId == null && b.role === role).reduce((s, b) => s + num(b.perPayCents), 0);
}

/** Gross a year and super a year, per source, from the engine's own calculation. */
function incomeFigures(d, dateIso) {
    const probe = clone(d);
    safe(() => calculateTotals(probe, { today: parseIso(dateIso) }), null);
    const sources = Array.isArray(probe.incomeSources) ? probe.incomeSources : [];
    const rows = sources.map((s) => {
        const gross = num(s && s._calculatedGrossAnnual);
        const pct = isNum(s && s.superPct) ? s.superPct : 0;
        return { gross, superYear: round2(gross * pct / 100), superPct: s && s.superPct };
    });
    const primary = rows[num(d.primaryIncomeIndex)] || rows[0] || { gross: 0 };
    return { rows, superYear: rows.reduce((s, r) => s + r.superYear, 0), primaryGross: primary.gross };
}

/**
 * Everything one year needs, from a data object as it stands on `dateIso`.
 * fiNumber = multiple x a year of Daily plus Splurge (per pay amounts from getBuckets), the planned
 * essentials plus non-essentials when the model has neither role. Smile is not counted.
 */
function yearInputs(d, dateIso) {
    const fs = d && d.fiSettings ? d.fiSettings : {};
    const multiple = isNum(fs.multiple) && fs.multiple > 0 ? fs.multiple : DEFAULT_MULTIPLE;
    const pt = safe(() => planTotals(d), null) || { cyclesPerYear: 26, essentialPerCycle: 0, nonEssentialPerCycle: 0 };
    const cycles = pt.cyclesPerYear || 26;
    const buckets = safe(() => getBuckets(d, dateIso), []);
    const hasSpendRole = buckets.some((b) => b.parentId == null && (b.role === 'daily' || b.role === 'splurge'));
    const spendYear = hasSpendRole
        ? ((bucketPerPayCents(buckets, 'daily') + bucketPerPayCents(buckets, 'splurge')) * cycles) / 100
        : (num(pt.essentialPerCycle) + num(pt.nonEssentialPerCycle)) * cycles;
    const inc = incomeFigures(d, dateIso);
    const ts = d && d.taxSettings ? d.taxSettings : {};
    const helpOn = ts.includeHelpInEstimate !== false;
    const help = safe(() => getTaxYear().help, null);
    return {
        dateIso,
        age: ageAt(d, dateIso),
        inflationPct: isNum(fs.inflation) ? fs.inflation : DEFAULT_INFLATION,
        expectedReturnPct: isNum(fs.expectedReturn) ? fs.expectedReturn : DEFAULT_RETURN,
        multiple,
        spendYear,
        fiNumber: round2(spendYear * multiple),
        fireYear: (bucketPerPayCents(buckets, 'fire') * cycles) / 100,
        superYear: inc.superYear,
        helpRepayment: helpOn && help ? calculateHelpRepayment(inc.primaryGross, help) : 0,
        helpIndexationPct: help ? num(help.indexationPercentDefault) : 0,
        cycles,
        buckets,
    };
}

/** The Mojo target in dollars (the top ladder step), 0 when there is none. */
function mojoCapacity(d, buckets, pt) {
    const row = buckets.find((b) => b.parentId == null && b.role === 'mojo');
    if (!row) return 0;
    const mojo = (d.savingModel && d.savingModel.mojo) || {};
    const living = mojoLivingCosts({
        essentialPerPayCents: Math.round(num(pt.essentialPerCycle) * 100), cyclesPerYear: pt.cyclesPerYear || 26, basis: mojo.basis || 'auto',
    });
    const ladder = mojoSteps(mojo, living, num(row.balanceCents));
    return ladder.targetCents > 0 ? Math.max(0, ladder.targetCents - num(row.balanceCents)) / 100 : 0;
}

/** Fire sinks from E2's target list, in order. A skipped or unknown target is left out. */
function fireSinks(d, buckets) {
    const targets = d.savingModel && d.savingModel.fire && Array.isArray(d.savingModel.fire.targets) ? d.savingModel.fire.targets : [];
    const libs = Array.isArray(d.liabilities) ? d.liabilities : [];
    const pt = safe(() => planTotals(d), null) || { cyclesPerYear: 26, essentialPerCycle: 0 };
    const out = [];
    for (const tg of targets) {
        if (!tg || tg.skip) continue;
        if (tg.type === 'debt') {
            const l = libs.find((x) => x && String(x.id) === String(tg.liabilityId));
            if (l) out.push({ type: 'debt', id: l.id });
        } else if (tg.type === 'mojo') {
            out.push({ type: 'mojo', capacity: mojoCapacity(d, buckets, pt) });
        } else if (tg.type === 'home' || tg.type === 'saver') {
            const goal = num(tg.goalCents), saved = num(tg.savedCents);
            if (goal > 0) out.push({ type: tg.type, capacity: Math.max(0, goal - saved) / 100 });
        } else if (tg.type === 'super') {
            out.push({ type: 'super' });
        }
    }
    return out;
}

/** The opening state from a data object. */
function startFrom(d, base) {
    const libs = (Array.isArray(d.liabilities) ? d.liabilities : []).filter((l) => l && num(l.balance) > 0);
    const debts = libs.map((l, i) => ({ ...l, id: l.id != null ? l.id : `debt-${i}` }));
    const assets = (Array.isArray(d.assets) ? d.assets : []).filter((a) => a && typeof a === 'object');
    const sinks = fireSinks({ ...d, liabilities: debts }, base.buckets);
    return {
        assets, debts, sinks,
        helpBalance: Math.max(0, num(parseFloat(d.taxSettings && d.taxSettings.helpBalance))),
    };
}

/**
 * The data the plan opens from: with scenario changes, the data as it stands today once the changes active today apply
 * (H6). A new loan, an edited expense (the Mojo target reads the essentials) or a changed assumption then opens the plan
 * the way the same edit in the app would, instead of only changing the later years.
 */
function openingData(d, opts, todayIso) {
    const changes = Array.isArray(opts.changes) ? opts.changes : [];
    if (!changes.length) return d;
    const resolve = typeof opts.resolve === 'function' ? opts.resolve : defaultResolve;
    return resolve(d, changes, todayIso);
}

/** Does a dated change apply on `dateIso`? `from <= date < until`, an open end meaning no end. */
function activeOn(change, dateIso) {
    if (!change || typeof change !== 'object') return false;
    if (change.from && dateIso < change.from) return false;
    if (change.until && dateIso >= change.until) return false;
    return true;
}

/**
 * Build the per-year input function for a data object and optional scenario changes.
 * Without changes, the data is read once. With them, `resolve(data, changes, date)` runs once per
 * distinct set of active changes (not once per year), so a long path costs a few resolutions.
 */
function makeInputs(data, opts) {
    const todayIso = todayIsoOf(opts.today);
    const changes = Array.isArray(opts.changes) ? opts.changes : [];
    const resolve = typeof opts.resolve === 'function' ? opts.resolve : defaultResolve;
    const cache = new Map();
    const dateAt = (k) => (k === 0 ? todayIso : addMonthsClamped(todayIso, 12 * k));
    const inputsFor = (k) => {
        const dateIso = dateAt(k);
        if (!changes.length) {
            if (!cache.has('base')) cache.set('base', yearInputs(data, todayIso));
            return { ...cache.get('base'), dateIso, age: ageAt(data, dateIso) };
        }
        const key = changes.map((c, i) => (activeOn(c, dateIso) ? i : '')).join(',');
        if (!cache.has(key)) cache.set(key, yearInputs(resolve(data, changes, dateIso), dateIso));
        return { ...cache.get(key), dateIso, age: ageAt(data, dateIso) };
    };
    return { inputsFor, todayIso };
}

/**
 * The path of net worth and the FI-counted net worth, a year at a time.
 * opts: { years (30), today, changes, resolve }.
 * @returns {{path:Array<{year,fiNetWorth,netWorth,cash,invested,appreciating,depreciating,debts,help,fiNumber,fire,super,growth}>,
 *   yearsToFI:number, fiNumber:number, today:string}}
 */
export function projectNetWorth(data, opts = {}) {
    const d = data && typeof data === 'object' ? data : {};
    const { inputsFor, todayIso } = makeInputs(d, opts);
    const base = inputsFor(0);
    const run = runPlan(startFrom(openingData(d, opts, todayIso), base), inputsFor, { years: opts.years == null ? 30 : opts.years, untilFI: true });
    return { path: run.path, yearsToFI: run.yearsToFI, fiNumber: base.fiNumber, today: todayIso };
}

/** Years until the FI-counted net worth reaches the FI number: fractional, 0 when reached, Infinity when never. */
export function yearsToFI(data, opts = {}) {
    const d = data && typeof data === 'object' ? data : {};
    const { inputsFor, todayIso } = makeInputs(d, opts);
    const base = inputsFor(0);
    return runPlan(startFrom(openingData(d, opts, todayIso), base), inputsFor, { years: 0, untilFI: true }).yearsToFI;
}

/** The FI number in dollars: `fiSettings.multiple` x a year of Daily plus Splurge (see `yearInputs`). */
export function fiNumber(data, opts = {}) {
    const d = data && typeof data === 'object' ? data : {};
    return yearInputs(d, todayIsoOf(opts.today)).fiNumber;
}

/** The FI number from the amounts themselves: per pay dollars of Daily and Splurge, pays a year, multiple. */
export function fiNumberFrom({ dailyPerPay = 0, splurgePerPay = 0, cyclesPerYear = 26, multiple = DEFAULT_MULTIPLE } = {}) {
    return Math.round((Math.round(dailyPerPay * 100) + Math.round(splurgePerPay * 100)) * cyclesPerYear * multiple) / 100;
}

/** What goes toward FI each year: {fire, super, total} in dollars (Smile is not counted). */
export function goingTowardsPerYear(data, opts = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const inp = yearInputs(d, todayIsoOf(opts.today));
  return { fire: round2(inp.fireYear), super: round2(inp.superYear), total: round2(inp.fireYear + inp.superYear) };
}

/**
 * Savings, the one definition everywhere (FT-R-116): the pay that goes into saving buckets (kind `save`:
 * Smile, Fire and the rest), as a share of take-home pay and as money. Take-home minus spending is NOT
 * savings, because money left unspent can roll into the next pay's spending. Every screen that shows a
 * savings rate shows the amount beside it.
 * @returns {{ratePct:number, perPayCents:number, perYearCents:number}} percent to one decimal; all 0 with no pay
 */
export function savingsPlanned(data, opts = {}) {
    const d = data && typeof data === 'object' ? data : {};
    const buckets = safe(() => getBuckets(d, todayIsoOf(opts.today)), []).filter((b) => b.parentId == null);
    const net = buckets.reduce((s, b) => s + num(b.perPayCents), 0);
    if (net <= 0) return { ratePct: 0, perPayCents: 0, perYearCents: 0 };
    const save = buckets.filter((b) => b.kind === 'save').reduce((s, b) => s + num(b.perPayCents), 0);
    const cycles = (safe(() => planTotals(d), null) || {}).cyclesPerYear || 26;
    return { ratePct: Math.round((save / net) * 1000) / 10, perPayCents: Math.round(save), perYearCents: Math.round(save * cycles) };
}

/** Planned savings rate as a percent of net pay (see `savingsPlanned`). Thin wrapper kept for the existing callers. */
export function savingsRatePlanned(data, opts = {}) {
    return savingsPlanned(data, opts).ratePct;
}

/**
 * Ages at FI, only when birth years are given (`data.people[].birthYear`). Age = years from the
 * birth year to the year FI is reached (the crossing year, rounded up).
 * `superNote` is true when anyone is under 60 then (FT-R-92). Null when there is no birth year or no FI date.
 * @returns {null|{ages:Array<{name:string, age:number}>, superNote:boolean}}
 */
export function fiAge(data, years, opts = {}) {
    if (!Number.isFinite(years)) return null;
    const people = peopleWithBirthYear(data);
    if (!people.length) return null;
    const nowYear = parseIso(todayIsoOf(opts.today)).getFullYear();
    const ages = people.map((p) => ({ name: p.name, age: nowYear - p.birthYear + Math.ceil(years) }));
    return { ages, superNote: ages.some((a) => a.age < PRESERVATION_AGE) };
}

/**
 * Everything the Future screen shows, in one run.
 * @returns {{fiNumber, yearsToFI, path, today, now:{netWorth, fiNetWorth, help, depreciating, debts},
 *   going:{fire,super,total}, savingsRate:number, fiAge:?object, notes:string[], nudges:Array<{id,name}>}}
 */
export function fiSummary(data, opts = {}) {
    const d = data && typeof data === 'object' ? data : {};
    const proj = projectNetWorth(d, opts);
    const p0 = proj.path[0];
    const open = openingData(d, opts, proj.today); // H6: the summary's own lines read the data with the changes applied
    const base = yearInputs(open, proj.today);
    const notes = ['notModelled'];
    const age = fiAge(d, proj.yearsToFI, { today: proj.today });
    if (age && age.superNote) notes.push('superPreservation');
    if (p0.help > 0) notes.push('includesHelp');
    if (p0.depreciating > 0) notes.push('losesValue');
    const libs = (Array.isArray(d.liabilities) ? d.liabilities : []).filter((l) => l && num(l.balance) > 0);
    if (libs.length) notes.push('spendingBias');
    const nudges = libs.filter((l) => !isNum(l.minRepayment) && num(l.interestRate) > 0).map((l) => ({ id: 'minRepayment', name: l.name || '' }));
    // FT-R-125 / FT-R-128 3: a loan left out of FI with its home, and Fire money paying it (home equity is not part of FI).
    const st = startFrom(open, base);
    const outIds = st.debts.filter((l) => loanScope(l, st.assets).fi === 'no').map((l) => l.id);
    const fireToHomeLoan = outIds.length > 0 && num(base.fireYear) > 0 && st.sinks.some((x) => x.type === 'debt' && outIds.includes(x.id));
    // No birth year: all super counts now (the screen asks for one). Only said when there is super to count.
    const superNoBirth = peopleWithBirthYear(d).length === 0 && (num(p0.superBal) > 0 || num(base.superYear) > 0);
    return {
        fiNumber: proj.fiNumber, yearsToFI: proj.yearsToFI, path: proj.path, today: proj.today,
        now: { netWorth: p0.netWorth, fiNetWorth: p0.fiNetWorth, help: p0.help, depreciating: p0.depreciating, debts: p0.debts },
        // FT-R-128: what the FI figure leaves out until the person confirms, for "N items are not counted until you confirm".
        heldOut: p0.heldOut, heldOutValue: p0.heldOutValue, loanLinksPending: pendingLoanLinks(open.liabilities),
        loansOut: { count: outIds.length, balance: p0.debtsOutOfFi }, fireToHomeLoan, superNoBirth,
        going: { fire: round2(base.fireYear), super: round2(base.superYear), total: round2(base.fireYear + base.superYear) },
        savingsRate: savingsRatePlanned(d, { today: proj.today }),
        savings: savingsPlanned(d, { today: proj.today }),
        fiAge: age, notes, nudges, multiple: base.multiple, spendYear: round2(base.spendYear),
        realReturnPct: round2(base.expectedReturnPct - base.inflationPct), inflationPct: base.inflationPct,
    };
}
