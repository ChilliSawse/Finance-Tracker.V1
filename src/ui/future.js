// Future screen. A5 stub: embeds the legacy Savings and Liabilities panels only. The old What If
// panel is deliberately not embedded (B3's cutover would leave it editing ignored arrays); F6
// replaces this embed.

import { t } from '../i18n/strings.js';
import { updateSavingsTabUI, updateLiabilitiesTabUI } from './render-tabs.js';

export function renderFuture(totals) {
    const sub = document.getElementById('future-sub');
    if (sub) sub.textContent = t('a.future.sub');
    updateSavingsTabUI(totals);
    updateLiabilitiesTabUI(totals);
}
