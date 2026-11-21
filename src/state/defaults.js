// Default data structures (moved from state.js).
// These are the factory shapes; the live copies sit in store.js.

import { AU_TAX_YEARS, CURRENT_TAX_YEAR } from '../calc/tax-au.js';
import { DEFAULT_CATEGORIES } from './categories.js';
import { templateAllocation, freshSavingModel } from './bucket-migration.js';

export const defaultFinanceData = {
    currency: "AUD",
    primaryIncomeIndex: 0,
    incomeSources: [
        { id: "inc-new-income-source", name: "New Income Source", incomeType: "salaried", grossAnnual: 0, paySchedule: "fortnightly", hoursPerCycle: 0, taxRemoved: null, invoicedPayPostTax: null,
            // C4: income fields. No tax year is stored (FT-R-86); the year comes from the date.
            hourlyRate: null, hoursPerWeek: null, superPct: null, basis: "salary", taxCheck: null,
            withholding: { claimsTaxFree: true, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0 } }
    ],
    // Half-open intervals [min, max): each band's min equals the previous band's max,
    // so no income value can fall between bands (fixes off-by-one cracks). The top band
    // uses max: Infinity so income above the cap keeps being taxed (fixes regressive cap).
    // Defaults are the current-FY ATO resident rates (see calc/tax-au.js); still fully
    // user-editable in the Income modal.
    taxBrackets: AU_TAX_YEARS[CURRENT_TAX_YEAR].brackets.map(b => ({ ...b })),
    // Estimate components beyond the brackets. Medicare levy defaults ON for fresh
    // installs (it's part of what actually comes out of a payslip); existing saves are
    // migrated with it OFF so their numbers don't shift silently (see migrations.js).
    // helpBalance > 0 turns on the HELP/HECS repayment estimate (primary source only)
    // and the payoff projection.
    taxSettings: {
        financialYear: CURRENT_TAX_YEAR,
        includeMedicareLevy: true,
        helpBalance: 0,
        includeHelpInEstimate: true,
    },
    // Spending categories (CSV import auto-categorisation + budget envelopes).
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    // Recurring bills / upcoming payments: { id, name, amount, frequency, nextDue (ISO date), categoryId }.
    bills: [],
    assets: [
        { id: "a-new-asset", name: "New Asset", balance: 0, kind: "cash", kindSuggested: false },
    ],
    liabilities: [
        { id: "l-new-liability", name: "New Liability", balance: 0, interestRate: 0 }
    ],
    // E4: a fresh allocation is the Bucket method template (60/10/10/20, Mojo at 0%) and new
    // setups get auto-credit on (FT-R-80; migrated data keeps it off).
    allocation: templateAllocation(),
    savingModel: freshSavingModel(),
    bucketGoals: [],
    // Phase 1: new data starts on the plan model (dataVersion 2). The legacy lists stay as
    // empty arrays (the JSON import validator and old backups expect them) and are ignored.
    dataVersion: 2,
    plan: [],
    rules: [],
    essentialExpenses: [],
    nonEssentialExpenses: [],
    fiSettings: {
        multiple: 25,
        expectedReturn: 7, // Default expected return
        inflation: 2.5 // F2: the real-terms deflator for the FI path
    },
    // F2: new data starts on the asset and debt detail model, so the step 5b migration has nothing to do.
    assetDebtVersion: 1,
    dashboardViewPeriod: "fortnightly" // Default view period
};

// Appearance (A4): `theme` is a palette id (sunrise|bucket|eucalypt|harbour; src/theme/palettes.js) and
// `colorMode` is auto|light|dark. Old saves keep their colour, font and effect fields, but nothing reads them.
export const defaultGuiSettings = {
    theme: 'sunrise',
    colorMode: 'auto',
    baseFontSize: "16"
};

// structuredClone (not JSON round-trip) so taxBrackets' Infinity top band survives.
// The old JSON.parse(JSON.stringify(...)) clone nulled Infinity on every fresh
// install — the source of the tax-bracket "null" input warning.
export function cloneDefaultFinanceData() {
    return structuredClone(defaultFinanceData);
}

export function cloneDefaultGuiSettings() {
    return structuredClone(defaultGuiSettings);
}
