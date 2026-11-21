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
import { STATE_API_TEST_CASES } from './state/state-api.test-cases.js';
import { SETUP_TEST_CASES } from './ui/setup.test-cases.js';
import { QUICK_ADD_TEST_CASES } from './ui/quick-add.test-cases.js';
import { SCENARIO_TEST_CASES } from './calc/scenario.test-cases.js';
import { ASSETS_DEBTS_TEST_CASES } from './state/assets-debts.test-cases.js';
import { FI_TEST_CASES } from './calc/fi.test-cases.js';
import { GOAL_PLANNER_TEST_CASES } from './calc/goal-planner.test-cases.js';
import { SCENARIO_UI_TEST_CASES } from './ui/scenario-ui.test-cases.js';
import { SANITIZE_TEST_CASES } from './state/sanitize.test-cases.js';
import { HTML_TEST_CASES } from './ui/html.test-cases.js';
import { ACTIVITY_TEST_CASES } from './ui/activity.test-cases.js';
import { TODAY_TEST_CASES } from './ui/today.test-cases.js';
import { PLAN_BUCKETS_TEST_CASES } from './ui/plan-buckets.test-cases.js';

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
    { name: 'bill-match', env: 'pure', cases: BILL_MATCH_TEST_CASES },
    { name: 'sample-household', env: 'pure', cases: SAMPLE_HOUSEHOLD_TEST_CASES },
    { name: 'tax-tables', env: 'pure', cases: TAX_TABLES_TEST_CASES },
    { name: 'withholding', env: 'pure', cases: WITHHOLDING_TEST_CASES },
    { name: 'tax-owed', env: 'pure', cases: TAX_OWED_TEST_CASES },
    { name: 'income-migration', env: 'pure', cases: INCOME_MIGRATION_TEST_CASES },
    { name: 'payslip-check', env: 'pure', cases: PAYSLIP_CHECK_TEST_CASES },
    { name: 'sheet', env: 'pure', cases: SHEET_TEST_CASES },
    { name: 'xlsx', env: 'browser', cases: XLSX_TEST_CASES },
    { name: 'saving-model', env: 'pure', cases: SAVING_MODEL_TEST_CASES },
    { name: 'fire', env: 'pure', cases: FIRE_TEST_CASES },
    { name: 'smile-review', env: 'pure', cases: SMILE_REVIEW_TEST_CASES },
    { name: 'bucket-migration', env: 'pure', cases: BUCKET_MIGRATION_TEST_CASES },
    { name: 'shell', env: 'pure', cases: SHELL_TEST_CASES },
    { name: 'state-api', env: 'pure', cases: STATE_API_TEST_CASES },
    { name: 'setup', env: 'browser', cases: SETUP_TEST_CASES },
    { name: 'quick-add', env: 'pure', cases: QUICK_ADD_TEST_CASES },
    { name: 'scenario', env: 'pure', cases: SCENARIO_TEST_CASES },
    { name: 'assets-debts', env: 'pure', cases: ASSETS_DEBTS_TEST_CASES },
    { name: 'fi', env: 'pure', cases: FI_TEST_CASES },
    { name: 'goal-planner', env: 'pure', cases: GOAL_PLANNER_TEST_CASES },
    { name: 'scenario-ui', env: 'browser', cases: SCENARIO_UI_TEST_CASES },
    { name: 'sanitize', env: 'pure', cases: SANITIZE_TEST_CASES },
    { name: 'html', env: 'pure', cases: HTML_TEST_CASES },
    { name: 'activity', env: 'pure', cases: ACTIVITY_TEST_CASES },
    { name: 'today', env: 'pure', cases: TODAY_TEST_CASES },
    { name: 'plan-buckets', env: 'pure', cases: PLAN_BUCKETS_TEST_CASES },
];
