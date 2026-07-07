// Data-shape migrations applied on load and JSON import (moved from state.js).
// These must stay safe against real saves in the wild — the owner's phone PWA
// runs them when a deploy updates.

import { getPayCyclesPerYear } from '../utils.js';

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
        if (source.incomeType === 'salaried' || source.incomeType === 'selfEmployed') return;

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
    });
}
