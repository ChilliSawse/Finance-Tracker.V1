// Future screen (F6). The screen itself lives in src/ui/future/ (model.js, view.js, index.js, future.css);
// this file keeps C8's "Income pattern" card (the variable-income volatility card, FT-R-73 C11 / M-7), shown
// only while a Variable source exists, and hands the rest to mountFuture. The Debts, HELP payoff and
// tax-provision cards of the deleted Savings and Liabilities panels render from future/view.js.

import '../i18n/en-lazy-future.js'; // future strings (en-lazy)
import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { hasVariableSources } from '../calc/income-events.js';
import { renderIncomeVolatility } from './income-insights.js';
import { mountFuture } from './future/index.js';

/** Pure: does the Income pattern card show for this data? */
export function showIncomePattern(data) {
    return hasVariableSources(data);
}

function patternSlot() {
    const title = document.querySelector('#future .title-row');
    if (!title) return null;
    let el = document.getElementById('future-income-pattern');
    if (!el) {
        el = document.createElement('div');
        el.id = 'future-income-pattern';
        el.className = 'future-pattern';
        title.insertAdjacentElement('afterend', el);
    }
    return el;
}

export function renderFuture(totals) {
    const sub = document.getElementById('future-sub');
    if (sub) sub.textContent = t('a.future.sub');
    const slot = patternSlot();
    if (slot) {
        if (showIncomePattern(store.financeData)) renderIncomeVolatility(totals, slot, t('c.pattern.title'));
        else slot.innerHTML = '';
    }
    mountFuture(totals);
}
