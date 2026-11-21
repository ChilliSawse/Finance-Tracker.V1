// Activity screen. A5 stub: the title row (with Import CSV and Import PDF, FT-R-62) lives in
// index.html; A7 builds the list into #activity-body.

import { t } from '../i18n/strings.js';

export function renderActivity() {
    const sub = document.getElementById('activity-sub');
    if (sub) sub.textContent = t('a.activity.sub');
    const body = document.getElementById('activity-body');
    if (body && !body.dataset.ready) {
        body.dataset.ready = '1';
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = t('a.activity.stub');
        body.appendChild(p);
    }
}
