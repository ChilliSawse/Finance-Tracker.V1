// Asset and debt maths (owner: F2). Pure: no store, no DOM, no clock.
// Contract: docs/PHASE1-CONTRACT.md. Used by F3 (FI engine), F5 (sheets), F6 (Future), A9b.
//
// Units: balances on assets and liabilities are dollars (legacy). Anything that accumulates
// over time (a debt schedule) runs in integer cents, one rounded interest figure a period.
// Rates are percent a year, nominal, as typed ("4.8" = 4.8%). The entered balance is always
// the truth; nothing here writes back to the data.

import { parseIso, addDays, addMonthsClamped, daysBetween } from './pay-cycle.js';
import { curveFraction, beyondCurve } from './value-curve.js';

/** Periods in a year for each interest or repayment frequency. */
export const PERIODS_PER_YEAR = { daily: 365, weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };

/**
 * Vehicle depreciation defaults, the ATO effective-life shape for a car: 8 years, so
 * diminishing value 200% / 8 = 25% a year and prime cost 100% / 8 = 12.5% a year.
 * Source (U35, FT-0001): ATO "Effective life of an asset" and "Uniform capital allowance
 * system: calculate decline in value" (the 200% rate applies to assets held after 10 May 2006):
 * https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/depreciation-and-capital-expenses-and-allowances/in-detail/depreciating-assets/uniform-capital-allowance-system-calculate-decline-in-value
 * https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/depreciation-and-capital-expenses-and-allowances/general-depreciation-rules-capital-allowances/effective-life-of-an-asset
 * The car-limit cap on cost is a tax rule and is not applied here.
 */
export const VEHICLE_DEPRECIATION = Object.freeze({ lifeYears: 8, decliningRatePct: 25, straightRatePct: 12.5 });

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x) => (isNum(x) ? x : 0);
const round2 = (x) => Math.round(x * 100) / 100;
const periodsIn = (freq, fallback) => PERIODS_PER_YEAR[freq] || fallback;

// ---------- rates ----------

/** Effective annual rate as a fraction: `(1 + r/n)^n - 1`. r in percent, n from the frequency (default monthly). */
export function effectiveAnnualRate(ratePct, frequency) {
    if (!isNum(ratePct)) return 0;
    const n = periodsIn(frequency, 12);
    return Math.pow(1 + ratePct / 100 / n, n) - 1;
}

/** Interest earned on a dollar balance over `years`, in dollars to the cent (compounding at the stated frequency). */
export function interestEarned(balance, ratePct, frequency, years) {
    const b = num(balance);
    return round2(b * (Math.pow(1 + effectiveAnnualRate(ratePct, frequency), num(years)) - 1));
}

/** Dividends on an invested balance: `{annual, perPeriod}` in dollars to the cent (yield % of balance). */
export function dividendsFor(balance, yieldPct, frequency) {
    const annual = num(balance) * num(yieldPct) / 100;
    const n = periodsIn(frequency, 4);
    return { annual: round2(annual), perPeriod: round2(annual / n) };
}

/** A nominal annual rate (fraction) to a real one (today's dollars): (1+g)/(1+i) - 1, as a fraction. */
export function realRate(nominalFraction, inflationPct) {
    return (1 + nominalFraction) / (1 + num(inflationPct) / 100) - 1;
}

// ---------- depreciation ----------

/** Whole and part years from one ISO date to another: whole anniversaries plus the remaining days over 365. */
function yearsBetween(fromIso, toIso) {
    if (daysBetween(fromIso, toIso) <= 0) return 0;
    const a = parseIso(fromIso), b = parseIso(toIso);
    let whole = b.getFullYear() - a.getFullYear();
    if (addMonthsClamped(fromIso, whole * 12) > toIso) whole -= 1;
    const anchor = addMonthsClamped(fromIso, whole * 12);
    return whole + daysBetween(anchor, toIso) / 365;
}

function lifeOf(dep) {
    if (isNum(dep.lifeYears) && dep.lifeYears > 0) return dep.lifeYears;
    if (isNum(dep.ratePct) && dep.ratePct > 0) return 100 / dep.ratePct;
    return null;
}

/** Value of `start` dollars after `years` under a depreciation record. `start` is the purchase price or the entered balance. */
function decay(start, dep, years) {
    const residual = Math.min(num(dep.residual), start);
    if (dep.method === 'straight') {
        const life = lifeOf(dep);
        if (!life) return start;
        return Math.max(residual, start - ((start - residual) / life) * Math.min(years, life));
    }
    const rate = isNum(dep.ratePct) && dep.ratePct > 0 ? dep.ratePct / 100 : null;
    if (rate === null) return start;
    return Math.max(residual, start * Math.pow(1 - rate, years));
}

/** Years of age at `asOf` from the purchase date, or null when there is no date. */
function ageYears(asset, asOf) {
    const dep = asset && asset.depreciation;
    return dep && dep.purchaseDate && asOf ? yearsBetween(dep.purchaseDate, asOf) : null;
}

/**
 * Worked-out value of a depreciating asset on `asOf` (ISO date), from purchase price and date.
 * Returns dollars to the cent, or null when the detail is missing. The entered `balance`
 * stays the truth: this is only offered beside it ("use A$X"). With a value curve (DB10) the price is
 * run down the curve (and the powertrain factor); without one, the depreciation rate does it.
 * It reads a suggested rule too: an offer beside the balance is not the maths.
 */
export function depreciatedValue(asset, asOf) {
    const dep = asset && asset.depreciation;
    if (!dep || !isNum(dep.purchasePrice) || dep.purchasePrice <= 0 || !dep.purchaseDate || !asOf) return null;
    const years = yearsBetween(dep.purchaseDate, asOf);
    const frac = asset.valueStable ? 1 : curveFraction(asset.valueCurve, years);
    if (frac !== null) return round2(dep.purchasePrice * frac);
    return round2(decay(dep.purchasePrice, dep, years));
}

/** True when the worked-out value differs from the entered balance by more than `tolerance` (default 5%). */
export function depreciationDiffers(asset, asOf, tolerance = 0.05) {
    const v = depreciatedValue(asset, asOf);
    const b = num(asset && asset.balance);
    if (v === null || b <= 0) return false;
    return Math.abs(v - b) / b > tolerance;
}

// ---------- asset value over time ----------

/**
 * What a type-filled asset still has of its own: the fields a reference type filled stay suggested
 * (`typeSuggested`, FT-R-117) until confirmed, and a suggested rate or curve never feeds the maths
 * (the same rule as `kindSuggested`). `typeFilled` lists the fields the type wrote. Returns the asset
 * without them while they are only suggested; the entered balance and anything the person typed stay.
 */
export function effectiveAsset(asset) {
    if (!asset || !asset.typeSuggested) return asset;
    const out = { ...asset };
    for (const f of Array.isArray(asset.typeFilled) ? asset.typeFilled : []) {
        if (f === 'interestRate') delete out.interestRate;
        else if (f in out) out[f] = null;
    }
    return out;
}

/**
 * An asset's value `years` from now, with where it came from: {value, source, fallback}.
 * source: 'entered' (now, or no rule), 'suggested' (kind or type only suggested: flat), 'noReliableRate' (crypto:
 * flat, no default return), 'curve', 'rate' (the depreciation rate), 'appDefault' (a typed asset with neither
 * curve nor rate: the app's 25% a year), 'stable' (flat by design), or the growth kinds 'interest', 'return', 'growth'.
 * `fallback` is true when a depreciating value came from a rate instead of a curve, so a screen can say so.
 * opts: inflationPct, asOf (ISO date; with depreciation.purchaseDate it places a balance on its curve).
 * A curve moves the entered balance by the curve's own ratio (balance x curve(age + years) / curve(age)); with no
 * purchase date there is no age, and the rate does it (marked as the fallback).
 */
export function valueDetail(assetIn, years, opts = {}) {
    const bal = num(assetIn && assetIn.balance);
    const y = Math.max(0, num(years));
    const infl = num(opts.inflationPct);
    const out = (value, source, fallback = false) => ({ value: round2(value), source, fallback });
    if (!assetIn) return out(bal, 'entered');
    if (assetIn.kindSuggested) return out(bal, y === 0 ? 'entered' : 'suggested');
    if (y === 0) return out(bal, 'entered');
    if (assetIn.typeSuggested && assetIn.kind === 'depreciating') return out(bal, 'suggested');
    const asset = effectiveAsset(assetIn);
    if (asset.rateMode === 'noReliableRate') return out(bal, 'noReliableRate');
    const grow = (fraction, source) => out(bal * Math.pow(1 + realRate(fraction, infl), y), source);
    switch (asset.kind) {
        case 'cash':
            return isNum(asset.interestRate) ? grow(effectiveAnnualRate(asset.interestRate, asset.interestFrequency), 'interest') : out(bal, 'entered');
        case 'invested':
            return isNum(asset.expectedReturn) ? grow(asset.expectedReturn / 100, 'return') : out(bal, 'entered');
        case 'appreciating':
            return isNum(asset.growthRate) ? grow(asset.growthRate / 100, 'growth') : out(bal, 'entered');
        case 'depreciating': {
            if (asset.valueStable) return out(bal, 'stable');
            const age = ageYears(asset, opts.asOf);
            if (asset.valueCurve && age !== null) {
                const now = curveFraction(asset.valueCurve, age);
                const then = curveFraction(asset.valueCurve, age + y);
                if (now !== null && now > 0 && then !== null) return { ...out(bal * (then / now), 'curve'), beyond: beyondCurve(asset.valueCurve, age + y) };
            }
            if (asset.depreciation) return out(decay(bal, asset.depreciation, y), 'rate', true);
            if (asset.assetType) return out(decay(bal, { method: 'diminishing', ratePct: VEHICLE_DEPRECIATION.decliningRatePct, residual: 0 }, y), 'appDefault', true);
            return out(bal, 'entered');
        }
        default:
            return out(bal, 'entered');
    }
}

/**
 * An asset's value `years` from now, from its entered balance, in dollars to the cent.
 * Rates are nominal; pass `inflationPct` for today's dollars (the FI path), leave it 0 for
 * the rate as given. An asset whose kind is only suggested, or whose rate is unset,
 * is flat (0% real) so a wrong guess cannot skew the path silently. The same holds for a rate or curve a
 * reference type filled and the person has not confirmed (`typeSuggested`).
 * cash: effective interest rate; invested: total expected return (dividends are part of it,
 * reinvested or not, so the total is the same); appreciating: growthRate (blank = flat real);
 * depreciating: the value curve, else the depreciation rule, applied to the entered balance (see `valueDetail`).
 */
export function assetValueAt(asset, years, opts = {}) {
    return valueDetail(asset, years, opts).value;
}

/**
 * How an asset counts (FT-R-125). Net worth counts every asset at its value; this says whether it counts toward FI:
 * fi 'yes' | 'no' | 'fromAge' (super, from the preservation age), with the reason.
 * Things that lose value (and stable ones) never count. A home counts only when the person has said it is an
 * investment (a suggested or missing answer is "I live here"). Super counts from 60. A kind only suggested stays
 * out when it is suggested to lose value, and is otherwise cash (the existing rule).
 */
export function assetScope(asset) {
    if (!asset || typeof asset !== 'object') return { fi: 'no', reason: 'none' };
    if (asset.kind === 'depreciating') return { fi: 'no', reason: asset.kindSuggested ? 'suggested' : (asset.valueStable ? 'stable' : 'losesValue') };
    if (asset.isSuper) return { fi: 'fromAge', reason: 'super' };
    if (asset.kind === 'appreciating') {
        const investment = asset.use === 'investment' && !asset.useSuggested && !asset.kindSuggested;
        return investment ? { fi: 'yes', reason: 'investment' } : { fi: 'no', reason: asset.use === 'investment' ? 'suggested' : 'liveIn' };
    }
    return { fi: 'yes', reason: asset.kindSuggested ? 'suggestedCash' : 'counts' };
}

// ---------- debts ----------

const toCents = (dollars) => Math.round(num(dollars) * 100);

/** The rate in force for a repayment: the fixed rate until `fixedUntil`, then `rateAfterFixed`. */
export function debtRateAt(debt, dateIso) {
    const base = num(debt && debt.interestRate);
    if (debt && debt.interestType === 'fixed' && debt.fixedUntil && isNum(debt.rateAfterFixed) && dateIso && dateIso > debt.fixedUntil) {
        return debt.rateAfterFixed;
    }
    return base;
}

/**
 * One repayment period. Interest for the period is the debt's own compounding converted to the
 * repayment period, `(1 + r/n)^(n/m) - 1` (n compounding periods and m repayments a year), on
 * the opening balance, rounded to the cent. The payment is capped at balance plus interest.
 * Everything in integer cents. Returns {balanceCents, interestCents, paidCents}.
 */
export function debtStep({ balanceCents, ratePct, compounding, repaymentFrequency, paymentCents }) {
    const bal = Math.max(0, Math.round(num(balanceCents)));
    const n = periodsIn(compounding, 12);
    const m = periodsIn(repaymentFrequency, 12);
    const periodRate = Math.pow(1 + num(ratePct) / 100 / n, n / m) - 1;
    const interestCents = Math.round(bal * periodRate);
    const owed = bal + interestCents;
    const paidCents = Math.min(owed, Math.max(0, Math.round(num(paymentCents))));
    return { balanceCents: owed - paidCents, interestCents, paidCents };
}

/**
 * A debt's repayment schedule, in integer cents.
 * opts: paymentCents (default the debt's minRepayment), startDate (ISO, enables the fixed rate
 * ending), maxPeriods (default 600; stops there if it never clears).
 * Returns {rows:[{n, date, balanceCents, interestCents, paidCents}], periodsToClear (Infinity when it
 * does not clear), cleared, totalInterestCents, totalPaidCents, balanceAfter(n)}.
 */
export function debtSchedule(debt, opts = {}) {
    const freq = (debt && debt.repaymentFrequency) || 'monthly';
    const compounding = (debt && debt.compounding) || 'monthly';
    const paymentCents = opts.paymentCents != null ? opts.paymentCents : toCents(debt && debt.minRepayment);
    const maxPeriods = opts.maxPeriods > 0 ? opts.maxPeriods : 600;
    const dateOf = (n) => {
        if (!opts.startDate) return null;
        if (freq === 'weekly') return addDays(opts.startDate, 7 * n);
        if (freq === 'fortnightly') return addDays(opts.startDate, 14 * n);
        return addMonthsClamped(opts.startDate, n);
    };
    const start = toCents(debt && debt.balance);
    let bal = start;
    const rows = [];
    let totalInterest = 0, totalPaid = 0;
    for (let n = 1; bal > 0 && n <= maxPeriods; n++) {
        const date = dateOf(n);
        const step = debtStep({ balanceCents: bal, ratePct: debtRateAt(debt, date), compounding, repaymentFrequency: freq, paymentCents });
        bal = step.balanceCents;
        totalInterest += step.interestCents;
        totalPaid += step.paidCents;
        rows.push({ n, date, balanceCents: bal, interestCents: step.interestCents, paidCents: step.paidCents });
    }
    const cleared = bal === 0;
    return {
        rows,
        periodsToClear: cleared ? rows.length : Infinity,
        cleared,
        totalInterestCents: totalInterest,
        totalPaidCents: totalPaid,
        balanceAfter(n) {
            if (n <= 0) return start;
            if (!rows.length) return 0;
            return n >= rows.length ? rows[rows.length - 1].balanceCents : rows[n - 1].balanceCents;
        },
    };
}

// ---------- suggestions (by name, shown on the "Check these N" card; never silent) ----------

/** Suggested asset kind from its name: {kind, isSuper}. Unmatched is cash. */
export function suggestKind(name) {
    const s = String(name == null ? '' : name).toLowerCase();
    if (/\bsuper(annuation)?\b/.test(s)) return { kind: 'invested', isSuper: true };
    if (/\b(etfs?|shares?|funds?|stocks?|portfolio|crypto\w*|bitcoin)\b/.test(s)) return { kind: 'invested', isSuper: false };
    if (/\b(savings?|offset|cash|everyday|transaction|account)\b/.test(s)) return { kind: 'cash', isSuper: false };
    if (/\b(car|vehicle|ute|motorbike|motorcycle|boat|caravan)\b/.test(s)) return { kind: 'depreciating', isSuper: false };
    if (/\b(house|home|property|unit|apartment|land|flat)\b/.test(s)) return { kind: 'appreciating', isSuper: false };
    return { kind: 'cash', isSuper: false };
}

/** Suggested debt label from its name: 'good', 'bad' or null. Display and wording only. */
export function suggestLabel(name) {
    const s = String(name == null ? '' : name).toLowerCase();
    if (/\b(mortgage|home loan|investment|invest\w*|study|student|help|hecs)\b/.test(s)) return 'good';
    if (/\b(cards?|car|vehicle|personal|bnpl|afterpay|zip|klarna|humm|buy now)\b/.test(s)) return 'bad';
    return null;
}
