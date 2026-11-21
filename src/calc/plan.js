// Plan maths (Phase 1 step B1). Pure: no DOM, no storage.
// Frequencies convert through a weekly figure (52 weeks a year), exactly as
// getWeeklyAmount does, so these agree with calculateTotals.

import { getPayCyclesPerYear, getWeeklyAmount } from '../utils.js';
import { calculateTotals } from './calculations.js';

/** The item's amount per pay cycle. */
export function perCycle(item, cyclesPerYear) {
    return (getWeeklyAmount(item.amount, item.frequency) * 52) / (cyclesPerYear || 26);
}

/** The item's amount per calendar month (52/12 weeks). */
export function perMonth(item) {
    return (getWeeklyAmount(item.amount, item.frequency) * 52) / 12;
}

function primaryCycles(data) {
    const sources = (data && data.incomeSources) || [];
    const s = sources[(data && data.primaryIncomeIndex) || 0] || sources[0] || null;
    return getPayCyclesPerYear(s ? s.paySchedule : undefined);
}

/** Essential and non-essential items. dataVersion >= 2 reads plan[]; otherwise the legacy lists. */
function splitItems(data) {
    if (data && data.dataVersion >= 2 && Array.isArray(data.plan)) {
        const cats = new Map((data.categories || []).map((c) => [c.id, c]));
        const essential = [], nonEssential = [];
        for (const it of data.plan) {
            if (it.inTotals === false) continue;
            const cat = cats.get(it.categoryId);
            ((cat ? cat.essential : it.essential) ? essential : nonEssential).push(it);
        }
        return { essential, nonEssential };
    }
    return {
        essential: (data && data.essentialExpenses) || [],
        nonEssential: (data && data.nonEssentialExpenses) || [],
    };
}

/**
 * Essential and non-essential totals per week, per primary pay cycle and per month (dollars).
 */
export function planTotals(data) {
    const cyclesPerYear = primaryCycles(data);
    const { essential, nonEssential } = splitItems(data);
    const sum = (items, fn) => items.reduce((s, it) => s + fn(it), 0);
    const w = (it) => getWeeklyAmount(it.amount, it.frequency);
    return {
        cyclesPerYear,
        essentialWeekly: sum(essential, w),
        nonEssentialWeekly: sum(nonEssential, w),
        essentialPerCycle: sum(essential, (it) => perCycle(it, cyclesPerYear)),
        nonEssentialPerCycle: sum(nonEssential, (it) => perCycle(it, cyclesPerYear)),
        essentialPerMonth: sum(essential, perMonth),
        nonEssentialPerMonth: sum(nonEssential, perMonth),
    };
}

/**
 * Net pay per primary pay cycle in integer cents, rounded once (X1). Total net across
 * all sources divided by the primary source's cycles a year. Works on a clone, so a
 * resolved scenario copy is fine and the caller's data is never touched.
 */
export function netPerPayCents(data) {
    const totals = calculateTotals(JSON.parse(JSON.stringify(data)));
    return Math.round((totals.totalNetAnnualIncome / primaryCycles(data)) * 100);
}
