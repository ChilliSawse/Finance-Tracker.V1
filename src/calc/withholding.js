// PAYG withholding the employer's way (ATO Schedule 1 + Schedule 8), pure and DOM-free.
// y = a x - b, where y is the WEEKLY withholding and x is whole dollars of weekly
// earnings plus 99 cents. Everything is done in integers so x.50 boundaries round up
// exactly: a and b are scaled by 10^4, x is in cents, y comes out in 10^-6 dollars.
// Tables come from tax-tables/ by income year (picked by date elsewhere; FT-R-66).

import { TAX_TABLES, resolveTablesForDate } from './tax-tables/index.js';

const COEF = 10000; // coefficient scale
const MICRO = 1000000; // y unit: 10^-6 dollars (a x 10^4 times x in cents)

/** Round half up for a plain number (x.50 goes up). */
export function roundHalfUp(raw) {
    return Math.floor(raw + 0.5);
}

/** Integer divide rounding half up: n / d for integer n and positive integer d. */
function divRoundHalfUp(n, d) {
    const num = 2 * n + d;
    const den = 2 * d;
    return (num - (((num % den) + den) % den)) / den;
}

const toCents = (dollars) => Math.round((Number(dollars) || 0) * 100);

/** Tables for an income-year key ('2025-26') or an ISO date; never undefined. */
function tablesFor(fy) {
    if (typeof fy === 'string' && TAX_TABLES[fy]) return TAX_TABLES[fy];
    return resolveTablesForDate(fy || new Date()).tables;
}

// Pay periods: weeks per pay for the weekly figure to pay-period figure step.
const CYCLES = {
    weekly: { mult: [1, 1] },
    fortnightly: { mult: [2, 1] },
    monthly: { mult: [13, 3] },
    quarterly: { mult: [13, 1] },
};
const cycleOf = (cycle) => CYCLES[cycle] ? cycle : 'fortnightly';

/** Weekly earnings x in whole cents plus 99c (an integer number of cents). */
function weeklyCents(gross, cycle) {
    let c = toCents(gross);
    switch (cycleOf(cycle)) {
        case 'weekly': return Math.floor(c / 100) * 100 + 99;
        case 'fortnightly': return Math.floor(c / 200) * 100 + 99;
        case 'monthly':
            if (c % 100 === 33) c += 1; // ATO: a monthly amount ending in 33c gets 1c first
            return Math.floor((c * 3) / 1300) * 100 + 99;
        default: return Math.floor(c / 1300) * 100 + 99; // quarterly
    }
}

/** Weekly equivalent x (dollars + .99) for a gross pay in a cycle. */
export function weeklyEquivalent(gross, cycle) {
    return weeklyCents(gross, cycle) / 100;
}

function bandOf(rows, xc) {
    const xd = xc / 100;
    for (const r of rows) if (xd < r.lt) return r;
    return rows[rows.length - 1];
}

const scaled = (r) => ({ a: Math.round(r.a * COEF), b: Math.round(r.b * COEF) });

/** Weekly y in 10^-6 dollars, unrounded integer, for one band. */
function microOf(r, xc) {
    const { a, b } = scaled(r);
    return Math.max(0, a * xc - b * 100);
}

/** Weekly whole-dollar amount for a table (array of bands) at xc cents. Exported for tests. */
export function weeklyFromRows(rows, xc) {
    return divRoundHalfUp(microOf(bandOf(rows, xc), xc), MICRO);
}

/** True when the unrounded weekly figure lies exactly on a .50 boundary (tests only). */
export function isExactHalf(rows, xc) {
    return microOf(bandOf(rows, xc), xc) % MICRO === MICRO / 2;
}

/** Combined (Schedule 1 + Schedule 8) weekly whole dollars: coefficients added, rounded once. */
function weeklyCombined(rowsA, rowsB, xc) {
    const ra = scaled(bandOf(rowsA, xc));
    const rb = scaled(bandOf(rowsB, xc));
    const micro = Math.max(0, (ra.a + rb.a) * xc - (ra.b + rb.b) * 100);
    return divRoundHalfUp(micro, MICRO);
}

/** Weekly whole dollars to whole dollars per pay. */
function perPay(weekly, cycle) {
    const [n, d] = CYCLES[cycleOf(cycle)].mult;
    return d === 1 ? weekly * n : divRoundHalfUp(weekly * n, d);
}

/**
 * Withholding for one pay, whole dollars. Tax and the study-loan component are separate
 * (a payslip prints them separately); totalCombined is the ATO's combined-scale figure.
 * @param {{gross:number, cycle:string, fy:string, claimsTaxFree?:boolean, hasStudyDebt?:boolean, extraPerPay?:number}} p
 * @returns {{x:number, tax:number, help:number, total:number, totalCombined:number, scale:1|2}}
 */
export function withholdingForPay({ gross, cycle, fy, claimsTaxFree = true, hasStudyDebt = false, extraPerPay = 0 }) {
    const t = tablesFor(fy);
    const xc = weeklyCents(gross, cycle);
    const scaleRows = claimsTaxFree ? t.scale2 : t.scale1;
    const stslRows = claimsTaxFree ? t.stsl.tftClaimed : t.stsl.notClaimed;
    const taxWeekly = weeklyFromRows(scaleRows, xc);
    const helpWeekly = hasStudyDebt ? weeklyFromRows(stslRows, xc) : 0;
    const combinedWeekly = hasStudyDebt ? weeklyCombined(scaleRows, stslRows, xc) : taxWeekly;
    const extra = Math.max(0, Math.round(Number(extraPerPay) || 0));
    const tax = perPay(taxWeekly, cycle);
    const help = perPay(helpWeekly, cycle);
    return {
        x: xc / 100,
        tax,
        help,
        total: tax + help + extra,
        totalCombined: perPay(combinedWeekly, cycle) + extra,
        scale: claimsTaxFree ? 2 : 1,
    };
}

const CYCLES_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 };

/**
 * Expected pay for an income source: gross per pay (salary / pays, or hourly rate x hours
 * per pay) and its withholding. Source fields: paySchedule, grossAnnual, hourlyRate (or
 * baseHourlyRate), hoursPerCycle, claimsTaxFree, hasStudyDebt, extraPerPay.
 */
export function expectedPay(source, fy) {
    const s = source || {};
    const cycle = cycleOf(s.paySchedule);
    const rate = Number(s.hourlyRate ?? s.baseHourlyRate) || 0;
    const hours = Number(s.hoursPerCycle) || 0;
    const grossAnnual = Number(s.grossAnnual) || 0;
    const gross = grossAnnual > 0
        ? Math.round((grossAnnual / CYCLES_PER_YEAR[cycle]) * 100) / 100
        : Math.round(rate * hours * 100) / 100;
    const w = withholdingForPay({
        gross, cycle, fy,
        claimsTaxFree: s.claimsTaxFree !== false,
        hasStudyDebt: !!s.hasStudyDebt,
        extraPerPay: s.extraPerPay,
    });
    return { gross, cycle, ...w };
}
