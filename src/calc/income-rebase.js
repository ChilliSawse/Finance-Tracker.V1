// A changed gross on a source that carries payslip figures (H5). calculateTotals treats a stored
// `taxRemoved` / `invoicedPayPostTax` (per pay) as the truth, so a new `grossAnnual` alone moves nothing
// that reads take-home: the pay, tax, per-pay amounts and savings stay on the old payslip. This moves the
// payslip figures by what the withholding engine says the gross change costs in tax, so the payslip's
// own calibration (Medicare, HELP, offsets it captured) is kept and the rise still shows up.
// Pure: no DOM, no storage.

import { expectedPay } from './withholding.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const CYCLES = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 };
const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(parseFloat(v));

/** True when the source is an employee source with a stored payslip tax or pay figure. */
export function hasPayslipFigures(source) {
    return !!source && typeof source === 'object' && source.incomeType !== 'selfEmployed' && source.incomeType !== 'variable'
        && (has(source.taxRemoved) || has(source.invoicedPayPostTax));
}

function taxPerPay(source, grossAnnual, fy) {
    const decl = source.withholding || null;
    return expectedPay({
        paySchedule: source.paySchedule, grossAnnual,
        claimsTaxFree: !decl || decl.claimsTaxFree !== false, hasStudyDebt: !!(decl && decl.hasStudyDebt === true),
        extraPerPay: decl ? decl.extraPerPay : 0,
    }, fy).total;
}

/**
 * Moves the payslip figures of `source` (already holding its new `grossAnnual`) from `oldGross` to the new
 * gross. Tax per pay moves by the engine's tax difference; pay per pay by the gross difference less that tax
 * difference. Returns true when it changed anything.
 */
export function rebasePayslipFigures(source, oldGross, fy) {
    if (!hasPayslipFigures(source) || !isNum(oldGross) || !(oldGross > 0)) return false;
    const newGross = Number(source.grossAnnual);
    const cycles = CYCLES[source.paySchedule];
    if (!isNum(newGross) || !cycles || Math.abs(newGross - oldGross) < 0.005) return false;
    const dTax = round2(taxPerPay(source, newGross, fy) - taxPerPay(source, oldGross, fy));
    const dGross = round2(newGross / cycles - oldGross / cycles);
    if (has(source.taxRemoved)) source.taxRemoved = Math.max(0, round2(parseFloat(source.taxRemoved) + dTax));
    if (has(source.invoicedPayPostTax)) source.invoicedPayPostTax = Math.max(0, round2(parseFloat(source.invoicedPayPostTax) + dGross - dTax));
    return true;
}

/** Rebases every row of `after` whose gross differs from the same-id row of `before`. `after` is changed in place. */
export function rebaseIncomeSources(before, after, fy) {
    if (!Array.isArray(before) || !Array.isArray(after)) return;
    for (const row of after) {
        if (!row || typeof row !== 'object' || !row.id) continue;
        const was = before.find((b) => b && b.id === row.id);
        if (was && isNum(Number(was.grossAnnual))) rebasePayslipFigures(row, Number(was.grossAnnual), fy);
    }
}

/** Legal minimum super, shown by the Salary sheet when nothing is stored yet (a rate, not a payslip figure). */
export const DEFAULT_SUPER_PCT = 12;

/**
 * A new salaried source (Extra income in What If) with the fields the Salary sheet writes on a first save, so every
 * figure that reads them (super in the long-range path, the withholding declaration, the tax owed estimate) matches a
 * source added in the app (H6). Only fills what is missing; never overwrites. Employee sources only.
 */
export function fillNewSalarySource(row) {
    if (!row || typeof row !== 'object' || row.incomeType === 'selfEmployed' || row.incomeType === 'variable') return row;
    if (row.incomeType === undefined) row.incomeType = 'salaried';
    if (row.basis === undefined) row.basis = 'salary';
    if (row.hourlyRate === undefined) row.hourlyRate = null;
    if (row.hoursPerWeek === undefined) row.hoursPerWeek = null;
    if (row.superPct === undefined || row.superPct === null) row.superPct = DEFAULT_SUPER_PCT;
    if (row.salarySacrifice === undefined) row.salarySacrifice = false;
    if (row.withholding === undefined || row.withholding === null) row.withholding = { claimsTaxFree: true, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0 };
    return row;
}
