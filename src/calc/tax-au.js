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

export const AU_TAX_YEARS = {
    '2026-27': {
        label: '2026–27',
        brackets: [
            { min: 0, max: 18200, rate: 0 },
            { min: 18200, max: 45000, rate: 0.15 },
            { min: 45000, max: 135000, rate: 0.30 },
            { min: 135000, max: 190000, rate: 0.37 },
            { min: 190000, max: Infinity, rate: 0.45 },
        ],
        medicare: { rate: 0.02, singleLowerThreshold: 28011, taperRate: 0.10 },
        help: {
            minThreshold: 69528,
            bands: [
                { min: 69528, max: 129717, rate: 0.15 },
                { min: 129717, max: Infinity, rate: 0.17 },
            ],
            capRate: 0.10, // repayment never exceeds 10% of repayment income
            indexationPercentDefault: 2.8, // 1 June 2026 rate; user-adjustable in projections
        },
    },
    '2025-26': {
        label: '2025–26',
        brackets: [
            { min: 0, max: 18200, rate: 0 },
            { min: 18200, max: 45000, rate: 0.16 },
            { min: 45000, max: 135000, rate: 0.30 },
            { min: 135000, max: 190000, rate: 0.37 },
            { min: 190000, max: Infinity, rate: 0.45 },
        ],
        medicare: { rate: 0.02, singleLowerThreshold: 28011, taperRate: 0.10 },
        help: {
            minThreshold: 67000,
            bands: [
                { min: 67000, max: 125000, rate: 0.15 },
                { min: 125000, max: Infinity, rate: 0.17 },
            ],
            capRate: 0.10,
            indexationPercentDefault: 2.8,
        },
    },
};

export const CURRENT_TAX_YEAR = '2026-27';

// The pre-rebuild default brackets (stale pre-2024 rates, no 45% band). Kept so
// migrations can recognise an untouched legacy default set and upgrade it.
export const LEGACY_DEFAULT_BRACKETS = [
    { min: 0, max: 18200, rate: 0 },
    { min: 18200, max: 45000, rate: 0.19 },
    { min: 45000, max: 120000, rate: 0.325 },
    { min: 120000, max: Infinity, rate: 0.37 },
];

export function getTaxYear(fy) {
    return AU_TAX_YEARS[fy] || AU_TAX_YEARS[CURRENT_TAX_YEAR];
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
