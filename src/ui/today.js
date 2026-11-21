// Today screen. A5 stub: the mount point, the three slots (#today-setup-slot, #today-tax-slot,
// #today-review-slot, owned by C7, C8 and E9) and the legacy Home feed and Dashboard, which stay
// until A6 builds the real screen and A13 deletes the Dashboard.

import { t } from '../i18n/strings.js';
import { renderHomeFeed } from './feed.js';
import { updateDashboardUI } from './render-tabs.js';

export function renderToday(totals) {
    const body = document.getElementById('today-body');
    if (body && !body.firstChild) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = t('a.today.stub');
        body.appendChild(p);
    }
    renderHomeFeed(); // async (event log); fire-and-forget
    updateDashboardUI(totals);
}
