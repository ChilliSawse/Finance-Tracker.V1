// The 31 registered test groups (Phase 1 plan section 12). Imported once by
// tests.html and by tools/run-cases.mjs. env 'browser' groups need a DOM or
// IndexedDB and are skipped by the Node runner.

import { CHAIN_TEST_CASES } from './state/chain.test-cases.js';
import { PALETTES_TEST_CASES } from './theme/palettes.test-cases.js';
import { THEME_TEST_CASES } from './theme/theme.test-cases.js';
import { PLAN_TEST_CASES } from './calc/plan.test-cases.js';
import { PAY_CYCLE_TEST_CASES } from './calc/pay-cycle.test-cases.js';
import { PLAN_MIGRATION_TEST_CASES } from './state/plan-migration.test-cases.js';
import { TRANSACTIONS_TEST_CASES } from './state/transactions.test-cases.js';
import { TODAY_MODEL_TEST_CASES } from './state/today-model.test-cases.js';
import { RULES_TEST_CASES } from './state/rules.test-cases.js';
import { SORTING_TEST_CASES } from './state/sorting.test-cases.js'; // DB2
import { BILL_MATCH_TEST_CASES } from './state/bill-match.test-cases.js';
import { SAMPLE_HOUSEHOLD_TEST_CASES } from './state/sample-household.test-cases.js';
import { TAX_TABLES_TEST_CASES } from './calc/tax-tables.test-cases.js';
import { WITHHOLDING_TEST_CASES } from './calc/withholding.test-cases.js';
import { TAX_OWED_TEST_CASES } from './calc/tax-owed.test-cases.js';
import { INCOME_MIGRATION_TEST_CASES } from './state/income-migration.test-cases.js';
import { PAYSLIP_CHECK_TEST_CASES } from './calc/payslip-check.test-cases.js';
import { SHEET_TEST_CASES } from './ui/sheet.test-cases.js';
import { XLSX_TEST_CASES } from './import/xlsx.test-cases.js';
import { SAVING_MODEL_TEST_CASES } from './state/saving-model.test-cases.js';
import { FIRE_TEST_CASES } from './calc/fire.test-cases.js';
import { SMILE_REVIEW_TEST_CASES } from './calc/smile-review.test-cases.js';
import { BUCKET_MIGRATION_TEST_CASES } from './state/bucket-migration.test-cases.js';
import { SHELL_TEST_CASES } from './ui/shell.test-cases.js';
import { RENDER_LAZY_TEST_CASES } from './ui/render.test-cases.js';
import { STATE_API_TEST_CASES } from './state/state-api.test-cases.js';
import { SETUP_TEST_CASES } from './ui/setup.test-cases.js';
import { QUICK_ADD_TEST_CASES } from './ui/quick-add.test-cases.js';
import { SCENARIO_TEST_CASES } from './calc/scenario.test-cases.js';
import { ASSETS_DEBTS_TEST_CASES } from './state/assets-debts.test-cases.js';
import { FI_TEST_CASES } from './calc/fi.test-cases.js';
import { GOAL_PLANNER_TEST_CASES } from './calc/goal-planner.test-cases.js';
import { SCENARIO_UI_TEST_CASES } from './ui/scenario-ui.test-cases.js';
import { SCENARIO_RESULTS_TEST_CASES } from './ui/scenario-results.test-cases.js';
import { SCENARIO_EQUIVALENCE_TEST_CASES } from './ui/scenario-equivalence.test-cases.js'; // H6
import { SCENARIO_ANSWER_TOP_TEST_CASES } from './ui/scenario/answer-top.test-cases.js';
import { SAFETY_DB_TEST_CASES } from './state/safety-db.test-cases.js';
import { SCENARIO_MAKE_REAL_SAFETY_TEST_CASES } from './ui/scenario/make-real-safety.test-cases.js';
import { SANITIZE_TEST_CASES } from './state/sanitize.test-cases.js';
import { HTML_TEST_CASES } from './ui/html.test-cases.js';
import { ACTIVITY_TEST_CASES } from './ui/activity.test-cases.js';
import { DB_TEST_CASES } from './state/db.test-cases.js';
import { TODAY_TEST_CASES } from './ui/today.test-cases.js';
import { INCOME_LAYOUT_TEST_CASES } from './ui/income-layout.test-cases.js';
import { TAX_CARD_TEST_CASES } from './ui/tax-card.test-cases.js';
import { FUTURE_TEST_CASES } from './ui/future/future.test-cases.js';
import { SETTINGS_TEST_CASES } from './ui/settings.test-cases.js';
import { PLAN_LISTS_TEST_CASES } from './ui/plan-lists.test-cases.js';
import { ASSET_DEBT_SHEETS_TEST_CASES } from './ui/plan-assets-debts.test-cases.js';
import { BUCKET_SHEETS_TEST_CASES } from './ui/bucket-sheets.test-cases.js';
import { PLAN_BUCKETS_TEST_CASES } from './ui/plan-buckets.test-cases.js';
import { REVIEW_TEST_CASES } from './ui/review.test-cases.js';
import { PWA_TEST_CASES } from './pwa.test-cases.js';
import { LAZY_SETUP_TEST_CASES, LAZY_SETUP_BROWSER_TEST_CASES } from './lazy-setup.test-cases.js';
import { IMPORT_ROUTE_TEST_CASES, IMPORT_ROUTE_BROWSER_TEST_CASES } from './import/route.test-cases.js';
import { ACCEPT_TEST_CASES, ACCEPT_XLSX_TEST_CASES } from './import/accept.test-cases.js';
import { REF_BUILD_TEST_CASES } from './ref-build.test-cases.js'; // FT-0032 DB1
import { BUCKET_METHOD_TEST_CASES } from './ui/bucket-method.test-cases.js';
import { INCOME_OTHER_TEST_CASES } from './ui/income-other.test-cases.js';
import { TRANSFERS_TEST_CASES } from './calc/transfers.test-cases.js'; // H9
import { RECOVERY_UNDO_TEST_CASES, RECOVERY_UNDO_BROWSER_TEST_CASES } from './state/recovery-undo.test-cases.js'; // U3
import { REFERENCE_TEST_CASES } from './state/reference.test-cases.js'; // R4
import { REF_OVERRIDES_TEST_CASES } from './state/ref-overrides.test-cases.js'; // DB7

export const TEST_GROUPS = [
    { name: 'chain', env: 'pure', cases: CHAIN_TEST_CASES },
    { name: 'palettes', env: 'pure', cases: PALETTES_TEST_CASES },
    { name: 'theme', env: 'pure', cases: THEME_TEST_CASES },
    { name: 'plan', env: 'pure', cases: PLAN_TEST_CASES },
    { name: 'pay-cycle', env: 'pure', cases: PAY_CYCLE_TEST_CASES },
    { name: 'plan-migration', env: 'pure', cases: PLAN_MIGRATION_TEST_CASES },
    { name: 'transactions', env: 'browser', cases: TRANSACTIONS_TEST_CASES },
    { name: 'today-model', env: 'pure', cases: TODAY_MODEL_TEST_CASES },
    { name: 'rules', env: 'pure', cases: RULES_TEST_CASES },
    { name: 'sorting', env: 'pure', cases: SORTING_TEST_CASES }, // DB2
    { name: 'bill-match', env: 'pure', cases: BILL_MATCH_TEST_CASES },
    { name: 'sample-household', env: 'pure', cases: SAMPLE_HOUSEHOLD_TEST_CASES },
    { name: 'tax-tables', env: 'pure', cases: TAX_TABLES_TEST_CASES },
    { name: 'withholding', env: 'pure', cases: WITHHOLDING_TEST_CASES },
    { name: 'tax-owed', env: 'pure', cases: TAX_OWED_TEST_CASES },
    { name: 'income-migration', env: 'pure', cases: INCOME_MIGRATION_TEST_CASES },
    { name: 'payslip-check', env: 'pure', cases: PAYSLIP_CHECK_TEST_CASES },
    { name: 'sheet', env: 'pure', cases: SHEET_TEST_CASES },
    { name: 'bucket-sheets', env: 'pure', cases: BUCKET_SHEETS_TEST_CASES },
    { name: 'xlsx', env: 'browser', cases: XLSX_TEST_CASES },
    { name: 'saving-model', env: 'pure', cases: SAVING_MODEL_TEST_CASES },
    { name: 'fire', env: 'pure', cases: FIRE_TEST_CASES },
    { name: 'smile-review', env: 'pure', cases: SMILE_REVIEW_TEST_CASES },
    { name: 'bucket-migration', env: 'pure', cases: BUCKET_MIGRATION_TEST_CASES },
    { name: 'shell', env: 'pure', cases: SHELL_TEST_CASES },
    { name: 'render-lazy', env: 'browser', cases: RENDER_LAZY_TEST_CASES }, // P3a
    { name: 'state-api', env: 'pure', cases: STATE_API_TEST_CASES },
    { name: 'setup', env: 'pure', cases: SETUP_TEST_CASES },
    { name: 'quick-add', env: 'pure', cases: QUICK_ADD_TEST_CASES },
    { name: 'scenario', env: 'pure', cases: SCENARIO_TEST_CASES },
    { name: 'assets-debts', env: 'pure', cases: ASSETS_DEBTS_TEST_CASES },
    { name: 'fi', env: 'pure', cases: FI_TEST_CASES },
    { name: 'goal-planner', env: 'pure', cases: GOAL_PLANNER_TEST_CASES },
    { name: 'scenario-ui', env: 'pure', cases: SCENARIO_UI_TEST_CASES },
    { name: 'scenario-results', env: 'pure', cases: SCENARIO_RESULTS_TEST_CASES },
    { name: 'scenario-equivalence', env: 'pure', cases: SCENARIO_EQUIVALENCE_TEST_CASES }, // H6
    { name: 'scenario-answer-top', env: 'pure', cases: SCENARIO_ANSWER_TOP_TEST_CASES }, // F8a
    { name: 'safety-db', env: 'browser', cases: SAFETY_DB_TEST_CASES }, // S9
    { name: 'scenario-make-real-safety', env: 'pure', cases: SCENARIO_MAKE_REAL_SAFETY_TEST_CASES }, // S10
    { name: 'sanitize', env: 'pure', cases: SANITIZE_TEST_CASES },
    { name: 'html', env: 'pure', cases: HTML_TEST_CASES },
    { name: 'activity', env: 'pure', cases: ACTIVITY_TEST_CASES },
    { name: 'db', env: 'pure', cases: DB_TEST_CASES },
    { name: 'today', env: 'pure', cases: TODAY_TEST_CASES },
    { name: 'income-layout', env: 'pure', cases: INCOME_LAYOUT_TEST_CASES },
    { name: 'tax-card', env: 'pure', cases: TAX_CARD_TEST_CASES },
    { name: 'future', env: 'pure', cases: FUTURE_TEST_CASES },
    { name: 'settings', env: 'pure', cases: SETTINGS_TEST_CASES },
    { name: 'plan-lists', env: 'pure', cases: PLAN_LISTS_TEST_CASES },
    { name: 'asset-debt-sheets', env: 'pure', cases: ASSET_DEBT_SHEETS_TEST_CASES },
    { name: 'plan-buckets', env: 'pure', cases: PLAN_BUCKETS_TEST_CASES },
    { name: 'review', env: 'pure', cases: REVIEW_TEST_CASES },
    { name: 'pwa', env: 'pure', cases: PWA_TEST_CASES },
    { name: 'import-route', env: 'pure', cases: IMPORT_ROUTE_TEST_CASES },
    { name: 'import-route-browser', env: 'browser', cases: IMPORT_ROUTE_BROWSER_TEST_CASES },
    { name: 'accept', env: 'pure', cases: ACCEPT_TEST_CASES },
    { name: 'accept-xlsx', env: 'browser', cases: ACCEPT_XLSX_TEST_CASES },
    { name: 'ref-build', env: 'pure', cases: REF_BUILD_TEST_CASES }, // FT-0032 DB1 (node only; passes at once in tests.html)
    { name: 'bucket-method', env: 'pure', cases: BUCKET_METHOD_TEST_CASES },
    { name: 'income-other', env: 'pure', cases: INCOME_OTHER_TEST_CASES },
    { name: 'lazy-setup', env: 'pure', cases: LAZY_SETUP_TEST_CASES }, // P3b
    { name: 'lazy-setup-browser', env: 'browser', cases: LAZY_SETUP_BROWSER_TEST_CASES }, // P3b
    { name: 'transfers', env: 'pure', cases: TRANSFERS_TEST_CASES }, // H9
    { name: 'recovery-undo', env: 'pure', cases: RECOVERY_UNDO_TEST_CASES }, // U3
    { name: 'recovery-undo-browser', env: 'browser', cases: RECOVERY_UNDO_BROWSER_TEST_CASES }, // U3
    { name: 'reference', env: 'pure', cases: REFERENCE_TEST_CASES }, // R4
    { name: 'ref-overrides', env: 'pure', cases: REF_OVERRIDES_TEST_CASES }, // DB7
];
