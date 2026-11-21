# A9a Plan screen shell and money lists

- `src/ui/plan.js` rewritten: eight collapsible `<details>` sections built once (open state survives redraws), in FT-R-88 order: Pay, Essentials, Non-essentials, Bills, Debts, Assets, Saving model and buckets, Categories. Back to top button, one name search (display only, footers stay full). `#plan-buckets` is moved inside its section and `mountBuckets` is called on each render.
- Slots for A9b: `#plan-debts`, `#plan-assets`, `#plan-categories` hold placeholder text; A9b replaces their content (plan.js never redraws them).
- New `src/ui/plan-lists.js` (pure: model, HTML, sheet specs, actions through B4's `addPlanItem`, `updatePlanItem`, `removePlanItem`, `convertToBill`). Essentials and Non-essentials are plan items without a due date grouped by the category flag; Bills are items with `anchorDue`. Per-pay figures come from `calc/plan.js`; none is typed in.
- Rows open `openSheet`; "Make this a bill" is a toggle plus a due date (converts through `convertToBill`, one undo). New bills count in totals; migrated bills show "reminder only" and can be switched to count. Delete and every save raise an undo toast. Weekly-amount plausibility note from D1.
- Pay lists income sources and calls `openIncomeSheet(index)`; while it returns false (C6 not merged) the old income editor opens instead. "Add income" pushes a legacy-shape source then opens the sheet. Source delete and the primary choice belong to C6's sheet.
- "We moved your lists. Check these N" card from `planMigration.reviewBills` (FT-R-53); saving a listed bill drops it, "All checked" clears the list.
- Spending caps card (FT-R-52): each capped category shows "A$x left against the cap" (or over).
- Legacy Income and Expenses panels are hidden by `plan.css` (markup deleted in A12a); `renderPlan` no longer calls `updateIncomeTabUI` or `updateExpensesTabUI`. The old settings "add bill" write to `data.bills` is no longer reachable from Plan; its handler is retired in A12b.
- Strings `a.plan.*` in `en-a.js`. `plan.css` imported from `main.js`. Test group `plan-lists` (A9a.1, 35 assertions). Node runner 1350 passed; `tests.html` 1695.
