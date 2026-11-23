// Australian tax reference data + estimate components.
//
// Pure data + functions (no store/DOM) — tests.html imports this directly.
// Sources (verified 2026-07-07):
//   Brackets:  ATO "Tax rates – Australian resident" (2026–27 cut: 16% → 15%).
//   Medicare:  ATO Medicare levy reduction for low-income earners
//              (2025–26 single lower threshold $28,011, retro from 1 July 2025;
//              10c-per-dollar shade-in above it until the full 2% is reached).
//   HELP:      From 2025–26 compulsory HELP repayments moved to a MARGINAL system
//              (15% / 17% above an indexed threshold, capped at 10% of repayment
//              income). 2026–27: threshold $69,528, second band from $129,717.
//              Indexation 1 June 2026: 2.8% (lower of CPI / WPI).
//
// Scope notes (documented limitations, unchanged from the bracket engine):
//   - Estimates are per income source, single resident, no LITO, no offsets,
//     no MLS, no family/seniors Medicare thresholds. Payslip net/tax overrides
//     remain the source of truth; these components only improve the *estimate*
//     path when net/tax are left blank.

// One copy of the figures: rebuilt from the dated files in ./tax-tables/ (C1).
// The tables also carry withholding scales, STSL, LITO, effective dates and sources.
import { TAX_TABLES, resolveTablesForDate, tablesForFy } from './tax-tables/index.js';
export { taxYearKeyForDate, getTablesForDate, taxTablesStatus } from './tax-tables/index.js';

export const AU_TAX_YEARS = TAX_TABLES;

// Kept for back-compat (defaults, migrations); the live year is always picked by date.
export const CURRENT_TAX_YEAR = '2026-27';

// The pre-rebuild default brackets (stale pre-2024 rates, no 45% band). Kept so
// migrations can recognise an untouched legacy default set and upgrade it.
export const LEGACY_DEFAULT_BRACKETS = [
    { min: 0, max: 18200, rate: 0 },
    { min: 18200, max: 45000, rate: 0.19 },
    { min: 45000, max: 120000, rate: 0.325 },
    { min: 120000, max: Infinity, rate: 0.37 },
];

// A known key returns that year. An unknown or absent key falls back by DATE (today's
// table, or the latest shipped when today is past them), no longer to a fixed constant.
export function getTaxYear(fy) {
    return tablesForFy(fy) || resolveTablesForDate(new Date()).tables;
}

/**
 * Medicare levy for a single resident: 2% of taxable income, with the
 * low-income shade-in — nil at or below the lower threshold, then 10 cents
 * per dollar above it until that meets the full 2%.
 * @param {number} taxableIncome - annual taxable income.
 * @param {{rate:number, singleLowerThreshold:number, taperRate:number}} [medicare]
 * @returns {number} Annual levy (0 if no income / below threshold).
 */
export function calculateMedicareLevy(taxableIncome, medicare = getTaxYear().medicare) {
    const income = parseFloat(taxableIncome) || 0;
    if (income <= medicare.singleLowerThreshold) return 0;
    const full = income * medicare.rate;
    const tapered = (income - medicare.singleLowerThreshold) * medicare.taperRate;
    return Math.min(full, tapered);
}

/**
 * Medicare levy surcharge rate for a single person (FT-R-131): the tier the income for MLS purposes falls in.
 * Tier rows are [min, max, rate] with whole-dollar edges (0 to 101,000 is nil, 101,001 to 118,000 is the next rate).
 * @param {number} income - income for MLS purposes (taxable income here).
 * @param {{singleTiers:Array<{min:number,max:number,rate:number}>}} [mls] - none means no surcharge figures.
 * @returns {number} Rate 0 to 1, or 0 when the table has no MLS figures.
 */
export function mlsRate(income, mls) {
    const tiers = mls && Array.isArray(mls.singleTiers) ? mls.singleTiers : null;
    const inc = parseFloat(income) || 0;
    if (!tiers || !tiers.length || inc <= 0) return 0;
    const row = tiers.find((r) => inc <= (r.max == null ? Infinity : r.max));
    return row ? row.rate : 0;
}

/** Medicare levy surcharge: the tier rate on the whole income. Nil with no figures. */
export function calculateMedicareSurcharge(income, mls) {
    return (parseFloat(income) || 0) * mlsRate(income, mls);
}

/**
 * The one place the year-end deduction is worked out (FT-R-131). From 2026-27 the year's table carries a standard
 * deduction: the lesser of it and LABOUR income (employee sources, never self-employed or business), unless the
 * person's own work deductions are higher, which then replace it. Year-end figures only; take-home and withholding
 * never use it.
 * @param {number} gross - total income for the year.
 * @param {{standardDeduction?:number}} tables
 * @param {{labourIncome?:number, workDeductions?:number}} [o] - labourIncome defaults to all of `gross`.
 * @returns {{deduction:number, income:number, kind:'standard'|'work'|'none'}} income = gross less the deduction.
 */
export function incomeAfterDeduction(gross, tables, { labourIncome, workDeductions = 0 } = {}) {
    const g = Math.max(0, parseFloat(gross) || 0);
    const labour = labourIncome == null ? g : Math.min(g, Math.max(0, parseFloat(labourIncome) || 0));
    const sd = tables && tables.standardDeduction > 0 ? tables.standardDeduction : 0;
    const std = Math.min(sd, labour);
    const work = Math.max(0, parseFloat(workDeductions) || 0);
    const deduction = Math.round(Math.min(g, Math.max(std, work)) * 100) / 100;
    return { deduction, income: Math.round((g - deduction) * 100) / 100, kind: deduction <= 0 ? 'none' : (std >= work ? 'standard' : 'work') };
}

/**
 * The year-end levies on income that is already after the deduction: Medicare levy, the surcharge (only after an
 * explicit No to private cover, one cliff on total income, never withheld from pay) and the HELP repayment.
 * @param {number} income
 * @param {{medicare:object, mls?:object, help:object}} tables
 * @param {{medicare?:boolean, privateCover?:boolean, help?:boolean, helpIncome?:number}} [o]
 */
export function yearEndLevies(income, tables, { medicare = true, privateCover, help = false, helpIncome } = {}) {
    return {
        medicare: medicare ? calculateMedicareLevy(income, tables.medicare) : 0,
        mls: privateCover === false ? calculateMedicareSurcharge(income, tables.mls) : 0,
        help: help ? calculateHelpRepayment(helpIncome != null ? helpIncome : income, tables.help) : 0,
    };
}

/** The year's HELP repayment on a gross income, after the same deduction as annualOwed (Future, What If, payoff card). */
export function helpRepaymentForYear(gross, tables, { labourIncome, workDeductions } = {}) {
    return calculateHelpRepayment(incomeAfterDeduction(gross, tables, { labourIncome, workDeductions }).income, tables.help);
}

/** True only when the person has answered "No" to private hospital cover. Unanswered counts as covered. */
export function lacksPrivateCover(taxSettings) {
    return !!taxSettings && taxSettings.hasPrivateHospitalCover === false;
}

/**
 * Compulsory HELP/HECS repayment under the marginal system (2025–26 onward):
 * nil below the minimum threshold, then the band rates on income above it,
 * capped at capRate × repayment income.
 * @param {number} repaymentIncome - annual HELP repayment income (≈ taxable income).
 * @param {{minThreshold:number, bands:Array, capRate:number}} [help]
 * @returns {number} Annual compulsory repayment.
 */
export function calculateHelpRepayment(repaymentIncome, help = getTaxYear().help) {
    const income = parseFloat(repaymentIncome) || 0;
    if (income <= help.minThreshold) return 0;
    let repayment = 0;
    for (const band of help.bands) {
        const max = (band.max === Infinity || band.max == null) ? Infinity : band.max;
        const inBand = Math.min(income, max) - band.min;
        if (inBand > 0) repayment += inBand * band.rate;
    }
    return Math.min(repayment, income * help.capRate);
}

/**
 * Year-by-year HELP payoff projection. Models the real-world ordering:
 * indexation is applied to the balance on 1 June, compulsory repayments are
 * credited after assessment — so each modelled year is
 * `closing = opening × (1 + indexation) − repayment`, floored at 0.
 *
 * @param {number} balance - current HELP balance.
 * @param {number} repaymentIncome - annual repayment income (assumed flat).
 * @param {object} [options]
 * @param {number} [options.indexationPercent] - annual indexation %, defaults to the FY's latest rate.
 * @param {object} [options.help] - HELP config (threshold/bands/cap), defaults to the current FY.
 * @param {number} [options.maxYears=100]
 * @returns {{years:number|Infinity, totalRepaid:number, totalIndexation:number,
 *            schedule:Array<{year:number, opening:number, indexation:number, repayment:number, closing:number}>}}
 *   years is Infinity when the repayment never outpaces indexation.
 */
export function projectHelpPayoff(balance, repaymentIncome, options = {}) {
    const help = options.help || getTaxYear().help;
    const idx = (options.indexationPercent != null ? options.indexationPercent : help.indexationPercentDefault) / 100;
    const maxYears = options.maxYears || 100;

    let owing = Math.max(0, parseFloat(balance) || 0);
    const annualRepayment = calculateHelpRepayment(repaymentIncome, help);
    const schedule = [];
    let totalRepaid = 0;
    let totalIndexation = 0;

    if (owing === 0) return { years: 0, totalRepaid: 0, totalIndexation: 0, schedule };
    if (annualRepayment <= 0) return { years: Infinity, totalRepaid: 0, totalIndexation: 0, schedule };

    for (let year = 1; year <= maxYears; year++) {
        const opening = owing;
        const indexation = opening * idx;
        // The final year's repayment is only what's left owing.
        const repayment = Math.min(annualRepayment, opening + indexation);
        const closing = Math.max(0, opening + indexation - repayment);
        schedule.push({ year, opening, indexation, repayment, closing });
        totalRepaid += repayment;
        totalIndexation += indexation;
        owing = closing;
        if (owing <= 0.005) return { years: year, totalRepaid, totalIndexation, schedule };
        // Diverging (indexation ≥ repayment): never repaid at this income.
        if (closing >= opening) return { years: Infinity, totalRepaid, totalIndexation, schedule };
    }
    return { years: Infinity, totalRepaid, totalIndexation, schedule };
}
