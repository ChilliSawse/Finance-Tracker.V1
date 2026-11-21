// Income-fields migration (owner: C4). Independent of the plan and bucket migrations.
//
// Adds the new per-source fields, keeps the old bracket copy as `legacyTaxBrackets` (never
// read: FT-R-97), stores no tax year (FT-R-86), and flags a self-employed source that looks
// like a payslip job with `migrationPrompt: 'payslip-job'`, changing nothing else.
// Idempotent: each source is touched only while its `withholding` object is missing, so a
// dismissed prompt never comes back and a second run changes nothing. Non-destructive:
// no existing field is edited or removed.

import { getPayCyclesPerYear } from '../utils.js';

const KNOWN_CYCLES = ['weekly', 'fortnightly', 'monthly', 'quarterly'];

function sourceNeedsFields(s) {
    return !!s && typeof s === 'object' && !s.withholding;
}

/** True when the income-fields migration still has to run on this data. */
export function needsIncomeMigration(data) {
    if (!data || typeof data !== 'object') return false;
    if (Array.isArray(data.incomeSources) && data.incomeSources.some(sourceNeedsFields)) return true;
    return Array.isArray(data.taxBrackets) && data.legacyTaxBrackets === undefined;
}

function basisFor(s) {
    return s.incomeType === 'variable' ? 'variable' : s.incomeType === 'selfEmployed' ? 'selfEmployed' : 'salary';
}

function looksLikePayslipJob(s) {
    if (s.incomeType !== 'selfEmployed') return false;
    const tax = parseFloat(s.taxRemoved);
    const net = parseFloat(s.invoicedPayPostTax);
    if (!(tax > 0) || isNaN(net) || s.invoicedPayPostTax === '' || s.invoicedPayPostTax === null) return false;
    return KNOWN_CYCLES.includes(s.paySchedule);
}

/** Runs the migration in place. Returns true when it changed the data. */
export function migrateIncomeFields(data) {
    if (!needsIncomeMigration(data)) return false;
    if (Array.isArray(data.taxBrackets) && data.legacyTaxBrackets === undefined) {
        data.legacyTaxBrackets = structuredClone(data.taxBrackets);
    }
    for (const s of data.incomeSources || []) {
        if (!sourceNeedsFields(s)) continue;
        if (s.hourlyRate === undefined) s.hourlyRate = null;
        if (s.hoursPerWeek === undefined) s.hoursPerWeek = null;
        if (s.superPct === undefined) s.superPct = null;
        if (s.basis === undefined) s.basis = basisFor(s);
        if (s.taxCheck === undefined) s.taxCheck = null;
        s.withholding = { claimsTaxFree: true, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0 };
        if (s.migrationPrompt === undefined && looksLikePayslipJob(s)) s.migrationPrompt = 'payslip-job';
    }
    return true;
}

/**
 * Accepting the payslip-job prompt (used by C8): makes the source salaried with
 * gross = (pay + tax) x cycles, keeping the actual payslip pay. Returns true when changed.
 */
export function acceptPayslipJob(source) {
    if (!source || source.migrationPrompt !== 'payslip-job') return false;
    const cycles = getPayCyclesPerYear(source.paySchedule);
    const gross = (parseFloat(source.invoicedPayPostTax) + parseFloat(source.taxRemoved)) * cycles;
    source.incomeType = 'salaried';
    source.basis = 'salary';
    source.grossAnnual = Math.round(gross * 100) / 100;
    source.withholding = { claimsTaxFree: true, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0, ...(source.withholding || {}) };
    delete source.migrationPrompt;
    return true;
}

/** Hook run after a JSON import only. */
export function afterImport(data) {
    return false;
}
