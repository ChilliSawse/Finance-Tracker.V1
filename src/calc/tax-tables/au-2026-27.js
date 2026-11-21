// AU tax tables for the 2026-27 income year (1 July 2026 to 30 June 2027).
// Plain data, no logic. See au-2025-26.js for the row conventions.
//
// Sources (confirmed P0.5):
//   F2026L00716 Instrument 2026, Schedules 1 and 8 (from 1 Jul 2026)
//   NAT 1004 (Schedule 1) and NAT 3539 (Schedule 8), published 17 Jun 2026
//   HELP gazette C2026G00249 (minimum repayment income A$69,528)

export const AU_2026_27 = {
    fy: '2026-27',
    label: '2026–27',
    effective: { from: '2026-07-01', to: '2027-06-30' },
    withholdingScheduleFrom: '2026-07-01',
    sources: [
        'https://www.legislation.gov.au/F2026L00716/asmade/2026-06-12/text/original/word',
        'https://www.ato.gov.au/tax-rates-and-codes/payg-withholding-schedule-1-statement-of-formulas-for-calculating-amounts-to-be-withheld/about-this-schedule',
        'https://www.ato.gov.au/tax-rates-and-codes/schedule-8-statement-of-formulas-for-calculating-study-and-training-support-loans-components',
        'https://www.legislation.gov.au/C2026G00249/asmade/2026-03-09/text/original/pdf',
        'https://www.ato.gov.au/tax-rates-and-codes/study-and-training-loan-minimum-repayment-income-and-rates',
        'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents',
        'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners',
        'https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset',
    ],
    updated: '2026-07-01',
    scale2: [
        { lt: 362, a: 0, b: 0 },
        { lt: 538, a: 0.15, b: 54.3462 },
        { lt: 673, a: 0.25, b: 108.2135 },
        { lt: 721, a: 0.17, b: 54.3473 },
        { lt: 865, a: 0.179, b: 60.8377 },
        { lt: 1282, a: 0.3227, b: 185.1935 },
        { lt: 2596, a: 0.32, b: 181.7319 },
        { lt: 3653, a: 0.39, b: 363.4627 },
        { lt: Infinity, a: 0.47, b: 655.7704 },
    ],
    scale1: [
        { lt: 188, a: 0.15, b: 0.15 },
        { lt: 371, a: 0.2084, b: 11.0185 },
        { lt: 515, a: 0.179, b: 0.1066 },
        { lt: 932, a: 0.3227, b: 74.1674 },
        { lt: 2246, a: 0.32, b: 71.6508 },
        { lt: 3303, a: 0.39, b: 228.8816 },
        { lt: Infinity, a: 0.47, b: 493.1893 },
    ],
    stsl: {
        tftClaimed: [
            { lt: 1337, a: 0, b: 0 },
            { lt: 2494, a: 0.15, b: 200.5615 },
            { lt: 3577, a: 0.17, b: 250.4527 },
            { lt: Infinity, a: 0.10, b: 0 },
        ],
        notClaimed: [
            { lt: 987, a: 0, b: 0 },
            { lt: 2144, a: 0.15, b: 148.0615 },
            { lt: 2727, a: 0.17, b: 190.9527 },
            { lt: Infinity, a: 0.10, b: 0 },
        ],
    },
    brackets: [
        { min: 0, max: 18200, rate: 0 },
        { min: 18200, max: 45000, rate: 0.15 },
        { min: 45000, max: 135000, rate: 0.30 },
        { min: 135000, max: 190000, rate: 0.37 },
        { min: 190000, max: Infinity, rate: 0.45 },
    ],
    medicare: { rate: 0.02, singleLowerThreshold: 28011, singleUpperThreshold: 35013, taperRate: 0.10 },
    help: {
        minThreshold: 69528,
        bands: [
            { min: 69528, max: 129717, rate: 0.15 },
            { min: 129717, max: Infinity, rate: 0.17 },
        ],
        capRate: 0.10, // 10% of total repayment income from A$186,051
        indexationPercentDefault: 2.8, // 1 June 2026 rate; user-adjustable in projections
    },
    lito: { maxOffset: 700, fullUntil: 37500, rate1: 0.05, step1Until: 45000, base2: 325, rate2: 0.015, endsAt: 66667 },
};
