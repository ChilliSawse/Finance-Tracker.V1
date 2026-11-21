// Help (A11, FT-R-42): one "?" button per screen (Today, Activity, Plan, Future, Settings, Setup).
// Each opens a single read-only sheet: what the screen is for, then how to do its main jobs.
// Replaces the old info-guide panels. All words live in en-a.js (a.help.*); the sheet is built with
// textContent, so nothing here needs escaping. Pure parts (helpModel) have no DOM.

import { t } from '../i18n/strings.js';
import { openSheet } from './sheet.js';

/** How many "how to" lines each screen has (a.help.<screen>.job1 ... jobN). */
export const HELP_JOBS = { today: 4, activity: 4, plan: 5, future: 2, settings: 4, setup: 3 };
export const HELP_SCREENS = Object.keys(HELP_JOBS);

/** The words for one screen: {title, what, jobs[]}. Unknown screen -> null. */
export function helpModel(screenId) {
    const n = HELP_JOBS[screenId];
    if (!n) return null;
    const jobs = [];
    for (let i = 1; i <= n; i++) jobs.push(t(`a.help.${screenId}.job${i}`));
    return { title: t(`a.help.${screenId}.title`), what: t(`a.help.${screenId}.what`), jobs };
}

function textEl(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    n.textContent = text;
    return n;
}

/** Open the help sheet for a screen. */
export function openHelp(screenId) {
    const m = helpModel(screenId);
    if (!m) return null;
    const list = document.createElement('ul');
    list.className = 'help-list';
    for (const j of m.jobs) list.appendChild(textEl('li', '', j));
    return openSheet({
        title: m.title,
        readOnly: true,
        content: [
            textEl('h3', 'help-h', t('a.help.whatFor')),
            textEl('p', 'help-p', m.what),
            textEl('h3', 'help-h', t('a.help.howTo')),
            list,
        ],
    });
}

/**
 * Put the "?" button for a screen into `el` (the screen's title row, or its actions block).
 * Safe to call again: a screen never gets a second button. Returns the button.
 * C7's setup screen calls this with its own header element: mountHelpButton('setup', headerEl).
 */
export function mountHelpButton(screenId, el) {
    if (!el || !HELP_JOBS[screenId]) return null;
    const have = el.querySelector(`[data-help="${screenId}"]`);
    if (have) return have;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'help-btn';
    b.dataset.help = screenId;
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-label', t('a.help.btnLabel', { screen: t(`a.help.${screenId}.title`) }));
    b.textContent = '?';
    b.addEventListener('click', () => openHelp(screenId));
    el.appendChild(b);
    return b;
}

/** The static screens in index.html. Settings and Setup mount their own button when they build. */
export function mountHelpButtons() {
    for (const id of ['today', 'activity', 'plan', 'future']) {
        const row = document.querySelector(`#${id} .title-row`);
        if (!row) continue;
        mountHelpButton(id, row.querySelector('.title-actions') || row);
    }
}
