// Default data structures (moved from state.js).
// These are the factory shapes; the live copies sit in store.js.

import { AU_TAX_YEARS, CURRENT_TAX_YEAR } from '../calc/tax-au.js';
import { DEFAULT_CATEGORIES } from './categories.js';

export const defaultFinanceData = {
    currency: "AUD",
    primaryIncomeIndex: 0,
    incomeSources: [
        { name: "New Income Source", incomeType: "salaried", grossAnnual: 0, paySchedule: "fortnightly", hoursPerCycle: 0, taxRemoved: null, invoicedPayPostTax: null }
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
        { name: "New Asset", balance: 0 },
    ],
    liabilities: [
        { name: "New Liability", balance: 0, interestRate: 0 }
    ],
    allocation: [
        { name: "New Allocation", percentage: 100, currentBalance: 0, savingsGoal: 0 },
    ],
    essentialExpenses: [
        { name: "New Expense", amount: 0, frequency: "weekly" },
    ],
    nonEssentialExpenses: [
        { name: "New Expense", amount: 0, frequency: "monthly" },
    ],
    fiSettings: {
        multiple: 25,
        expectedReturn: 7 // Default expected return
    },
    dashboardViewPeriod: "fortnightly" // Default view period
};

// J1 — defaults mirror the DEFAULT_THEME (midnight) so a fresh load's
// customisable overlay matches its derived base (no split look on first paint).
// J2 step 2 — colours split into two kinds:
//   BASE (always set): feed deriveTokens — bg / text / surface / border / accent /
//     positive / negative / neutral. Everything else is *derived* from these.
//   OVERRIDE (empty unless the user pins one): heading / muted / topbar text /
//     essential / warning — overlaid on top of the derived set only when non-empty.
// primaryBgEnd / cardBgEnd are retained for back-compat but no longer drive anything.
export const defaultGuiSettings = {
    theme: 'midnight',
    // base
    primaryBgStart: "#0d1117",
    cardBgStart: "#161b22",
    textColor: "#c9d1d9",
    borderColor: "#30363d",
    accentColor: "#f85149",
    colorPositive: "#3fb950",
    colorNegative: "#f85149",
    colorNeutral: "#58a6ff",
    // override (empty = derive)
    headingColor: "",
    mutedColor: "",
    headerTextColor: "",
    colorEssential: "",
    colorWarning: "",
    // derived 2nd stops, kept for back-compat (unused)
    primaryBgEnd: "#161d27",
    cardBgEnd: "#1e252e",
    // typography
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    baseFontSize: "16",
    // J4 — decorative background effect, gated at runtime behind
    // prefers-reduced-motion + a mobile perf guard.
    bgEffect: "none",
    // J4 — optional custom tint for the effect (hex). Empty = follow the accent colour.
    bgEffectColor: "",
    mainHeading: "Personal Finance Dashboard",
    subHeading: "Track your income, expenses, and savings with style"
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
