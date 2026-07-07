// Default data structures (moved from state.js).
// These are the factory shapes; the live copies sit in store.js.

export const defaultFinanceData = {
    currency: "AUD",
    primaryIncomeIndex: 0,
    incomeSources: [
        { name: "New Income Source", incomeType: "salaried", grossAnnual: 0, paySchedule: "fortnightly", hoursPerCycle: 0, taxRemoved: null, invoicedPayPostTax: null }
    ],
    // Half-open intervals [min, max): each band's min equals the previous band's max,
    // so no income value can fall between bands (fixes off-by-one cracks). The top band
    // uses max: Infinity so income above the cap keeps being taxed (fixes regressive cap).
    taxBrackets: [
        { min: 0, max: 18200, rate: 0 },
        { min: 18200, max: 45000, rate: 0.19 },
        { min: 45000, max: 120000, rate: 0.325 },
        { min: 120000, max: Infinity, rate: 0.37 },
    ],
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

export function cloneDefaultFinanceData() {
    return JSON.parse(JSON.stringify(defaultFinanceData));
}

export function cloneDefaultGuiSettings() {
    return JSON.parse(JSON.stringify(defaultGuiSettings));
}
