// Plan screen. A5 stub: embeds the legacy Income and Expenses panels (A9a replaces them) and
// keeps the #plan-buckets mount point for E6.

import { t } from '../i18n/strings.js';
import { updateIncomeTabUI, updateExpensesTabUI } from './render-tabs.js';

export function renderPlan(totals) {
    const sub = document.getElementById('plan-sub');
    if (sub) sub.textContent = t('a.plan.sub');
    updateIncomeTabUI(totals);
    updateExpensesTabUI(totals);
}
