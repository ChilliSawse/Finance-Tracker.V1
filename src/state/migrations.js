// Data-shape migrations applied on load and JSON import (moved from state.js).
// These must stay safe against real saves in the wild — the owner's phone PWA
// runs them when a deploy updates.

import { getPayCyclesPerYear } from '../utils.js';
import { AU_TAX_YEARS, CURRENT_TAX_YEAR, LEGACY_DEFAULT_BRACKETS } from '../calc/tax-au.js';
import { cloneDefaultCategories } from './categories.js';

// Bracket-set equality with Infinity/null equivalence (JSON round-trips null Infinity).
function bracketsEqual(a, b) {
    if (!Array.isArray(a) || a.length !== b.length) return false;
    const top = (v) => (v == null || v === Infinity) ? Infinity : v;
    return a.every((br, i) =>
        (br.min || 0) === (b[i].min || 0) && top(br.max) === top(b[i].max) && (br.rate || 0) === (b[i].rate || 0));
}

/**
 * Ledger-era fields, applied on load and JSON import. Idempotent.
 * - Normalises bracket max null → Infinity (localStorage JSON round-trip).
 * - Upgrades an UNTOUCHED legacy default bracket set (stale pre-2024 rates) to the
 *   current FY's ATO rates. User-customised brackets are never touched.
 * - Backfills taxSettings / categories / bills. Existing saves get Medicare levy
 *   OFF (their estimates don't shift silently); fresh defaults ship it ON.
 */
export function migrateLedgerFields(data) {
    if (!data) return;

    if (Array.isArray(data.taxBrackets)) {
        data.taxBrackets.forEach(b => { if (b.max == null) b.max = Infinity; });
        if (bracketsEqual(data.taxBrackets, LEGACY_DEFAULT_BRACKETS)) {
            data.taxBrackets = AU_TAX_YEARS[CURRENT_TAX_YEAR].brackets.map(b => ({ ...b }));
            if (!data.taxSettings) {
                data.taxSettings = { financialYear: CURRENT_TAX_YEAR, includeMedicareLevy: false, helpBalance: 0, includeHelpInEstimate: true };
            }
        }
    }
    if (!data.taxSettings || typeof data.taxSettings !== 'object') {
        // financialYear null = custom brackets; Medicare/HELP params still fall back
        // to the current FY's tables if the user enables them.
        data.taxSettings = { financialYear: null, includeMedicareLevy: false, helpBalance: 0, includeHelpInEstimate: true };
    }
    if (typeof data.taxSettings.helpBalance !== 'number') data.taxSettings.helpBalance = 0;
    if (typeof data.taxSettings.includeHelpInEstimate !== 'boolean') data.taxSettings.includeHelpInEstimate = true;
    if (typeof data.taxSettings.includeMedicareLevy !== 'boolean') data.taxSettings.includeMedicareLevy = false;

    if (!Array.isArray(data.categories) || data.categories.length === 0) {
        data.categories = cloneDefaultCategories();
    }
    if (!Array.isArray(data.bills)) data.bills = [];
}

/**
 * Backfills the `incomeType` field on income sources saved before the
 * salaried/self-employed split. Sources that had a manual net or tax entry
 * become 'selfEmployed' (with their net + tax per cycle reconstructed so the
 * numbers are preserved exactly); everything else becomes 'salaried' so the
 * tax brackets drive the estimate. Idempotent — skips already-tagged sources.
 */
export function migrateIncomeSourceTypes(data) {
    if (!data || !Array.isArray(data.incomeSources)) return;
    data.incomeSources.forEach(source => {
        if (source.incomeType === 'salaried' || source.incomeType === 'selfEmployed'
            || source.incomeType === 'variable') return;

        const cycles = getPayCyclesPerYear(source.paySchedule);
        const grossAnnual = parseFloat(source.grossAnnual) || 0;
        const netVal = parseFloat(source.invoicedPayPostTax);
        const taxVal = parseFloat(source.taxRemoved);
        // Include taxRemoved=0 as "explicitly set" — old default was 0, not null.
        // Excluding zero caused old-format sources to migrate to salaried, silently
        // applying brackets and dropping net income by 20–30%.
        const hasNet = source.invoicedPayPostTax !== null && source.invoicedPayPostTax !== '' && !isNaN(netVal);
        const hasTax = source.taxRemoved !== null && source.taxRemoved !== '' && !isNaN(taxVal);

        // All old-format sources become selfEmployed — the old engine never deducted
        // brackets, so net was always gross-derived. Users who want bracket-estimated
        // tax can explicitly switch a source to Salaried.
        source.incomeType = 'selfEmployed';

        if (hasNet) {
            const oldNetAnnual = netVal * cycles;
            const oldTaxAnnual = Math.max(0, grossAnnual - oldNetAnnual);
            source.invoicedPayPostTax = +(oldNetAnnual / cycles).toFixed(2);
            source.taxRemoved = +(oldTaxAnnual / cycles).toFixed(2);
        } else if (hasTax) {
            const oldTaxAnnual = taxVal * cycles;
            const oldNetAnnual = Math.max(0, grossAnnual - oldTaxAnnual);
            source.invoicedPayPostTax = +(oldNetAnnual / cycles).toFixed(2);
            source.taxRemoved = +(oldTaxAnnual / cycles).toFixed(2);
        } else {
            // No net or tax entry — old engine gave net = gross.
            source.invoicedPayPostTax = cycles > 0 ? +(grossAnnual / cycles).toFixed(2) : 0;
            source.taxRemoved = null;
        }
    });
}

// Stage 0 — backfill per-bucket savings goal + current funds on allocation categories
// saved before those fields existed.
export function migrateAllocationFields(data) {
    if (!data || !Array.isArray(data.allocation)) return;
    data.allocation.forEach(alloc => {
        if (typeof alloc.currentBalance !== 'number') alloc.currentBalance = 0;
        if (typeof alloc.savingsGoal !== 'number') alloc.savingsGoal = 0;
        // Variable-income era: a bucket can be tagged as the tax provision pot.
        if (typeof alloc.isTaxProvision !== 'boolean') alloc.isTaxProvision = false;
    });
}

/**
 * Variable-income fields (the third incomeType). Idempotent and additive:
 * - every source gets an incomeEvents array (kept even after switching a
 *   source back to salaried, so no data is lost) and a baseHourlyRate slot;
 * - event rows get their optional fields normalised so render/calc code can
 *   trust the shape after a JSON backup round-trip.
 */
export function migrateVariableIncomeFields(data) {
    if (!data || !Array.isArray(data.incomeSources)) return;
    data.incomeSources.forEach(source => {
        if (!Array.isArray(source.incomeEvents)) source.incomeEvents = [];
        if (source.baseHourlyRate !== undefined && typeof source.baseHourlyRate !== 'number') {
            const v = parseFloat(source.baseHourlyRate);
            source.baseHourlyRate = isNaN(v) ? null : v;
        }
        (source.incomeEvents || []).forEach(e => {
            if (!e.id) e.id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());
            if (typeof e.date !== 'string') e.date = '';
            if (typeof e.label !== 'string') e.label = '';
            if (typeof e.netAmount !== 'number') e.netAmount = parseFloat(e.netAmount) || 0;
            if (e.taxWithheld != null && typeof e.taxWithheld !== 'number') e.taxWithheld = parseFloat(e.taxWithheld) || null;
            if (e.hours != null && typeof e.hours !== 'number') e.hours = parseFloat(e.hours) || null;
            if (e.cashReceived != null && typeof e.cashReceived !== 'number') e.cashReceived = parseFloat(e.cashReceived) || null;
            e.gstInclusive = !!e.gstInclusive;
            e.penaltyRates = !!e.penaltyRates;
        });
    });
}
