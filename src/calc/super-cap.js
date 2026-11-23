// Concessional super contributions cap warning (FT-R-131 (E)). A warning only: no tax maths, no figure changes.
// Counts what the app knows: the employer super guarantee on each salaried source (gross x super %).
// Salary sacrifice is stored only as yes/no with no amount, and personal deductible contributions are not
// recorded, so neither is counted. Carry-forward of unused caps is not modelled (the text says so).
import { resolveTablesForDate } from './tax-tables/index.js';
import { DEFAULT_SUPER_PCT } from './income-rebase.js';

const pctOf = (s) => (s.superPct == null ? DEFAULT_SUPER_PCT : Number(s.superPct)) || 0;

/** Employer super for one year across salaried sources, from gross x super %. */
export function employerSuperAnnual(sources) {
    let sum = 0;
    for (const s of sources || []) {
        if (!s || s.incomeType === 'selfEmployed' || s.incomeType === 'variable') continue;
        const g = Number(s.grossAnnual);
        if (g > 0) sum += g * pctOf(s) / 100;
    }
    return sum;
}

/**
 * @param {object[]} sources income sources (gross + super %)
 * @param {Date|string} today picks the income year, so that year's cap is used
 * @returns {{over:boolean, amount:number, cap:number|null, label:string|null}}
 */
export function concessionalCapCheck(sources, today) {
    const { tables } = resolveTablesForDate(today);
    const cap = tables && Number(tables.concessionalCap) > 0 ? Number(tables.concessionalCap) : null;
    const amount = employerSuperAnnual(sources);
    return { over: cap !== null && amount > cap, amount, cap, label: tables ? tables.label : null };
}
