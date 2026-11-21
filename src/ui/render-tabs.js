// What is left of the old per-tab renderers (A12a deleted the Dashboard, Income, Expenses, Savings and
// Liabilities panel renderers; Today, Activity, Plan and Future render themselves). Only the expense-search
// setter stays, because tabs.js (A12b) still imports it and the search box no longer exists.
let expenseSearchQuery = '';
export function setExpenseSearchQuery(q) { expenseSearchQuery = q; }
