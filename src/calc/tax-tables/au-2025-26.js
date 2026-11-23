// AU tax tables for the 2025-26 income year (1 July 2025 to 30 June 2026).
// Plain data, no logic. Withholding rows are the post 24 Sep 2025 set (Schedule 8
// marginal HELP formulas); Schedule 1 is unchanged from the 2024 text.
//
// Withholding rows: { lt, a, b }. Weekly earnings x is in a band when x < lt
// (strictly less); the last band has lt Infinity. Withheld = a * x - b.
// Scale 2 already includes the Medicare shade-in and LITO: do not add them again.
//
// Sources (confirmed P0.5):
//   F2025L01016 Instrument (No. 2) 2025, Schedules 1 and 8 (24 Sep 2025 to 30 Jun 2026)
//   ATO resident rates, HELP thresholds, Medicare levy reduction and LITO pages.

export const AU_2025_26 = {
    fy: '2025-26',
    label: '2025–26',
    effective: { from: '2025-07-01', to: '2026-06-30' },
    withholdingScheduleFrom: '2025-09-24',
    sources: [
        'https://www.legislation.gov.au/F2025L01016/asmade/2025-09-01/text/original/word',
        'https://www.ato.gov.au/tax-rates-and-codes/schedule-8-tax-table-24-sept-2025-to-30-june-2026',
        'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents',
        'https://www.ato.gov.au/tax-rates-and-codes/study-and-training-loan-minimum-repayment-income-and-rates',
        'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners',
        'https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset',
    ],
    updated: '2026-07-01',
    // Scale 2: tax-free threshold claimed.
    scale2: [
        { lt: 361, a: 0, b: 0 },
        { lt: 500, a: 0.16, b: 57.8462 },
        { lt: 625, a: 0.26, b: 107.8462 },
        { lt: 721, a: 0.18, b: 57.8462 },
        { lt: 865, a: 0.189, b: 64.3365 },
        { lt: 1282, a: 0.3227, b: 180.0385 },
        { lt: 2596, a: 0.32, b: 176.5769 },
        { lt: 3653, a: 0.39, b: 358.3077 },
        { lt: Infinity, a: 0.47, b: 650.6154 },
    ],
    // Scale 1: tax-free threshold not claimed.
    scale1: [
        { lt: 150, a: 0.16, b: 0.16 },
        { lt: 371, a: 0.2117, b: 7.755 },
        { lt: 515, a: 0.189, b: -0.6702 },
        { lt: 932, a: 0.3227, b: 68.2367 },
        { lt: 2246, a: 0.32, b: 65.7202 },
        { lt: 3303, a: 0.39, b: 222.951 },
        { lt: Infinity, a: 0.47, b: 487.2587 },
    ],
    // Study and training support loan component (Schedule 8).
    stsl: {
        tftClaimed: [
            { lt: 1288, a: 0, b: 0 },
            { lt: 2403, a: 0.15, b: 193.2692 },
            { lt: 3447, a: 0.17, b: 241.3462 },
            { lt: Infinity, a: 0.10, b: 0 },
        ],
        notClaimed: [
            { lt: 938, a: 0, b: 0 },
            { lt: 2053, a: 0.15, b: 140.7692 },
            { lt: 2597, a: 0.17, b: 181.8462 },
            { lt: Infinity, a: 0.10, b: 0 },
        ],
    },
    // Annual resident brackets.
    brackets: [
        { min: 0, max: 18200, rate: 0 },
        { min: 18200, max: 45000, rate: 0.16 },
        { min: 45000, max: 135000, rate: 0.30 },
        { min: 135000, max: 190000, rate: 0.37 },
        { min: 190000, max: Infinity, rate: 0.45 },
    ],
    // Annual assessment thresholds (the withholding schedule's A$26,000 is already inside scale2).
    medicare: { rate: 0.02, singleLowerThreshold: 28011, singleUpperThreshold: 35013, taperRate: 0.10 },
    help: {
        minThreshold: 67000,
        bands: [
            { min: 67000, max: 125000, rate: 0.15 },
            { min: 125000, max: Infinity, rate: 0.17 },
        ],
        capRate: 0.10, // 10% of total repayment income from A$179,286
        indexationPercentDefault: 2.8,
    },
    // Medicare levy surcharge, singles (FT-R-131). Family thresholds are ruled "later".
    mls: { singleTiers: [
        { min: 0, max: 101000, rate: 0 },
        { min: 101001, max: 118000, rate: 0.01 },
        { min: 118001, max: 158000, rate: 0.0125 },
        { min: 158001, max: Infinity, rate: 0.015 },
    ] },
    // Low income tax offset (annual).
    lito: { maxOffset: 700, fullUntil: 37500, rate1: 0.05, step1Until: 45000, base2: 325, rate2: 0.015, endsAt: 66667 },
    concessionalCap: 30000, // super concessional contributions cap (tax.json super.concessionalCap, legislated)
    superGuarantee: { rate: 0.12, maxBase: 250000 }, // SG rate; maximum contribution base 62,500 a quarter x 4 (tax.json super.maxContributionBaseQuarterly)
};
