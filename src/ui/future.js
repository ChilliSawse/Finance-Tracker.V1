// Future screen. A5 stub: embeds the legacy Savings and Liabilities panels only. The old What If
// panel is deliberately not embedded (B3's cutover would leave it editing ignored arrays); F6
// replaces this embed. C8 adds the "Income pattern" card (the variable-income volatility card,
// FT-R-73 C11 / M-7), shown only while a Variable source exists.

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { hasVariableSources } from '../calc/income-events.js';
import { updateSavingsTabUI, updateLiabilitiesTabUI } from './render-tabs.js';
import { renderIncomeVolatility } from './income-insights.js';

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
    updateSavingsTabUI(totals);
    updateLiabilitiesTabUI(totals);
}
