// Employer super cap warning (FT-R-131 (E)). A warning only: no tax maths, no figure changes.
// Counts what the app knows: employer super per salaried source = min(gross, maximum contribution base) x the SG
// rate, plus gross x any super % above the SG rate (that extra is not capped, a simplification). A blank super %
// counts as 0, the same rule as the sheet readout. Not counted: salary sacrifice (stored only as yes/no, no amount),
// personal deductible contributions (not recorded), Variable and Self-employed sources, and part-year jobs (gross is
// treated as a full year). Carry-forward of unused caps is not modelled (the text says so).
import { resolveTablesForDate } from './tax-tables/index.js';

const pctOf = (s) => Number(s.superPct) || 0;

/** Employer super for one year across salaried sources. sg = { rate, maxBase }. */
export function employerSuperAnnual(sources, sg) {
    let sum = 0;
    for (const s of sources || []) {
        if (!s || s.incomeType === 'selfEmployed' || s.incomeType === 'variable') continue;
        const g = Number(s.grossAnnual);
        if (!(g > 0)) continue;
        sum += Math.min(g, sg.maxBase) * sg.rate + g * Math.max(0, pctOf(s) / 100 - sg.rate);
    }
    return sum;
}

/**
 * @param {object[]} sources income sources (gross + super %)
 * @param {Date|string} today picks the income year, so that year's cap is used
 * @returns {{over:boolean, amount:number, cap:number|null, label:string|null}} no warning for a stale year or a missing figure
 */
export function concessionalCapCheck(sources, today) {
    const { tables, stale } = resolveTablesForDate(today);
    const cap = tables && Number(tables.concessionalCap) > 0 ? Number(tables.concessionalCap) : null;
    const sg = tables && tables.superGuarantee;
    if (stale || cap === null || !sg || !(sg.rate > 0) || !(sg.maxBase > 0)) return { over: false, amount: 0, cap, label: tables ? tables.label : null };
    const amount = employerSuperAnnual(sources, sg);
    return { over: amount > cap, amount, cap, label: tables.label };
}
