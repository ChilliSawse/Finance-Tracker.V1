# Phase 1 cross-slice contract

Written by M0. Each row is an interface one step owns and others consume. Where a
stub exists it has the final signature and a safe default; the owner replaces the
body and keeps the signature. Plan: FT-0001 Phase 1 Build Plan, section 9.1.

Rules for every step: never rename `financeTrackerData_v2` or any `ft-*` key; calc
modules stay pure (no DOM, no storage); delegated events only; strings go in the
catalogue (`src/i18n/en-a.js` to `en-f.js`, own slice only); tokens, not hex colours;
search `src/` before writing new code; never skip, weaken or delete a test.

## Interfaces

| # | Interface | Owner | Consumers | M0 stub | File |
|---|---|---|---|---|---|
| 1 | `getBuckets(data, today)` returns `[{id, slot, shade, name, role, kind, parentId, pct, perPayCents, balanceCents, goal?, target?, left?}]` | E5 | A6, A7, A8, B3b, B7, E6, F3, F4 | yes: maps `allocation[]` with no roles | `src/state/saving-model.js` |
| 2 | `effectiveBucket(txn, category, planItem, allocation)` returns a bucket id or `null` (income and transfers) | B3b | A7, A8, B7, E5 | no (use fixtures until B3b) | n/a |
| 3 | `bucketByRole(data, role)`; `detectRole(name)`; `allocateCents(netCents, pcts)`; `suggestSplit(...)` | E1 | B3, B3b, E4, E5, C7 | no (E1 in wave 2) | n/a |
| 4 | `getCycle(source, today)`, `payDatesBetween`, `nextPayDates`, `inferPayAnchor(rows, source, today)`, `billOccurrences`, `billStatus`, `netPerPayCents(data)`, `planTotals`, `perCycle`, `perMonth` | B1 | A6, B3b, B7, E2, E3, F3, F4 | no (wave 2) | n/a |
| 5 | `leftThisPay({data, totals, txns, today})` returns `{poolCents, spentCents, billsDueCents, leftCents, perDayCents, cycle, essentialSoFarCents, nonEssentialSoFarCents, unsortedCents, toReview}` per bucket | B3b | A6, A7 | no | n/a |
| 6 | `todayModel()` and `activityFeed(range)` (transactions plus bill occurrences: Upcoming, Due, Missed, Paid); `ready:false` until the spend cache loads | B7 | A6, A7 | no (wave 7 before the screens) | n/a |
| 7 | `plan[]` PlanItem `{id, categoryId, name, amount, frequency, anchorDue, matchRule, bucketId, inTotals, legacy}`; state API `addPlanItem`, `updatePlanItem`, `removePlanItem`, `convertToBill`, each returning an undo payload | B3 (shape), B4 (API) | A9a, A9b, C6, C7, F1 | no | n/a |
| 8 | `categorise(description, categories, rules=[])`, `learnRule`, `applyRuleToSimilar`, `merchantKey`, `matchBills` (DB9: `learnRule` and the apply helpers live in `src/state/rule-learn.js`, loaded on demand) | B8 (body) | A8, import flows | yes: `categorise` delegates to `categoriseDescription` | `src/state/rules.js` |
| 9 | `exportAllTransactions()`, `importTransactions(rows)` | B2 | D2 | no | n/a |
| 10 | `savingModel`, `allocation[i]` fields (`id, role, slot, kind, bankLabel, autoCreated`), `bucketGoals[]`, `liabilities[i].id`, `liabilities[i].minRepayment` (name fixed here; F2 adds the other debt fields) | E4 (shape, migration), E5 (API) | A6, B3b, C7, E6 to E9 | no | n/a |
| 11 | `newBucket()` factory, `runPayRoll`, `setAutoCredit`, `relinkCategory`, `canReturnToBase`, `forkOwnTemplate` | E5 | E6, E7, E8 | no | n/a |
| 12 | `mountBuckets(root)` into `#plan-buckets`; `openBucketSheet(kind, id)`; `categoryBucketField(category, buckets)` | E6, E7, E7 | A9a (mount), A9b (field) | yes for `mountBuckets` (renders nothing) and `openBucketSheet` (returns false) | `src/ui/plan-buckets.js`, `src/ui/bucket-sheets.js` |
| 13 | `openSheet({title, fields, values, onSave, onDelete, validate, plausibility, saveLabel})`; `showUndoToast({message, onUndo, onExpire, duration})`; `confirmDialog({title, body, confirmLabel, danger})` | D1 | A7, A8, A9a, A9b, C6, D2, E5 to E8, F5 to F8b | no (D1 in wave 2) | n/a |
| 14 | `openIncomeSheet(index)` | C6 | A9a | yes: returns false | `src/ui/income-layout.js` |
| 15 | Setup step registry `registerSetupStep({id, order, title, render, validate, onNext})` | C7 | E8 (`model`, `split`, `transfers`) | no (C7 before E8) | n/a |
| 16 | `taxTablesStatus(now, data)` returns `{activeFy, stale, checkDue}`; `taxYearKeyForDate`; `getTablesForDate` | C1 | C8, D2 | no | n/a |
| 17 | `withholdingForPay`, `weeklyEquivalent`, `expectedPay`; annual tax owed helpers; `checkPayslip` | C2, C3, C5 | C6, C7, C8 | no | n/a |
| 18 | `applyAppearance({palette, mode})` sets `data-palette` and `data-mode`; `palettes.js`; generated token file; tokens `--surface`, `--ink`, `--accent`, `--b1` to `--b10` | A1 (generated), A4 (runtime) | D1, D2, every screen | no | n/a |
| 19 | Mount points `#today`, `#activity`, `#plan`, `#plan-buckets`, `#future`, `#sheet-root`, `#setup-root`, `#settings-root`; Today slots `#today-setup-slot`, `#today-tax-slot`, `#today-review-slot` | A5 (created), A6 (slots) | C7, C8, E9 | no | n/a |
| 20 | `runMigrationChain(data, {raw, source, storage})` with the four modules' `needsX`, `migrateX`, `afterImport` (F2's included) | M0 | autosave, import, dry-run script | yes: all four steps wired, modules are stubs until their owners land | `src/state/migration-chain.js`, `plan-migration.js`, `bucket-migration.js`, `income-migration.js`, `asset-debt-migration.js` |
| 21 | `resolveAt(data, changes, date)`, `segments(changes, from, to)`, `scenarioHeadline`, `makeRealPlan`; store API `listScenarios`, `saveScenario`, `duplicateScenario` | F1 (body) | F3, F4, F6, F7, F8a, F8b | yes (M-14): `resolveAt` returns a deep clone, `segments` returns `[]` | `src/calc/scenario.js` |
| 22 | `assetValueAt`, `debtSchedule`, `suggestKind`, `suggestLabel`; `newAsset`, `newDebt`, `assetSheetSpec`, `debtSheetSpec` | F2 (maths), F5 (sheets) | A9b, F3, F6 | yes (M-14): legacy shape | `src/ui/plan-assets-debts.js` |
| 23 | `fiNumber`, `yearsToFI`, `projectNetWorth`, `goingTowardsPerYear`, `savingsRatePlanned`, `explainFi`, `fiAge` | F3 | F6, F8b | no | n/a |
| 24 | `planGoals`, `requiredPerPay`, `earningsThreeWays`, `explainRequired` | F4 | F8a, F8b | no | n/a |
| 25 | `openScenario(id)` | F7 | F6 | yes (M-14): returns false | `src/ui/scenario/index.js` |

## The migration chain (row 20)

`runMigrationChain(data, opts)` returns `{changed, aborted, backedUp, errors}`.
Options: `raw` (the raw saved string), `source` (`'load'` or `'import'`), `storage`
(`{getItem, setItem}`, defaults to `localStorage`), `forceSave` (callback), `trace`
and `modules` (tests only).

Order (plan section 9.3):

1. The four legacy migrations, unchanged.
2. If any of `needsPlanMigration`, `needsBucketMigration` or `needsAssetDebtMigration`
   is true: write `raw` to `ft-backup-pre-plan` byte for byte, only if the key is
   absent. A failed write returns `{aborted: true}` and no new step runs.
3. `migratePlanModel` (B3), 4. `migrateBucketModel` (E4), 5. `migrateIncomeFields` (C4),
   5b. `migrateAssetDebtDetail` (F2). Each is idempotent behind its own version guard
   and returns true when it changed the data.
6. `forceSave()` once, only if a step from 3 to 5b changed the data. The legacy four do
   not trigger it (unchanged behaviour).
7. Import only: each module's `afterImport(data)`.

Atomic and stop rule: each owner step runs on a clone of the data and is committed only
if it returns without throwing; the first throw (in a step or its `needsX`) stops the chain
with `{aborted: true}`: no later owner step, no `forceSave`, no `afterImport`, and the data
holds exactly the steps committed before it.

Call sites: `loadData` in `src/state/autosave.js` (raw = the saved string) and
`handleJSONImport` in `src/events/import-export.js` (raw = the imported file text).

Owner modules export `needsX(data)` (boolean), `migrateX(data)` (true when changed) and
`afterImport(data)`. Names: `needsPlanMigration`/`migratePlanModel`,
`needsBucketMigration`/`migrateBucketModel`, `needsIncomeMigration`/`migrateIncomeFields`,
`needsAssetDebtMigration`/`migrateAssetDebtDetail`. Owners edit only their module; no
step edits `migration-chain.js` again.

## Test and gate scaffolding

- 30 registered groups in `src/test-registry.js`, each `src/**/<name>.test-cases.js`
  exporting `<NAME>_TEST_CASES` as `{name, fn(assert)}` with `assert(label, actual, expected)`
  (JSON comparison). A step edits only its own file.
- `node tools/run-cases.mjs [group ...]` runs the groups with `env: 'pure'`;
  `tests.html` runs every non-empty group. A group that needs a DOM or IndexedDB gets
  `env: 'browser'` in the registry (the only registry edit a step may make).
- `node tools/phase1-gate.mjs [--after-d2] [--hex]` runs the mechanical gate checks.
