// Pure navigation helpers (A5): tab names, the legacy-name map, the sidebar scope line and the
// roving-keyboard model. No DOM and no storage, so the node runner can test them.

import { t } from '../i18n/strings.js';

export const VALID_TABS = ['today', 'activity', 'plan', 'future'];
export const DEFAULT_TAB = 'today';

// Names stored in `ft-active-tab` (and used by old call sites) before the five-tab shell.
// What If maps to future: the panel is no longer embedded (A5), F6/F7 replace it.
export const LEGACY_TAB_MAP = {
    home: 'today', dashboard: 'today',
    income: 'plan', expenses: 'plan',
    savings: 'future', liabilities: 'future', whatIf: 'future',
};

/** Any stored or legacy tab name to one of VALID_TABS; unknown lands on today. */
export function resolveTab(name) {
    if (typeof name !== 'string') return DEFAULT_TAB;
    if (VALID_TABS.includes(name)) return name;
    if (Object.prototype.hasOwnProperty.call(LEGACY_TAB_MAP, name)) return LEGACY_TAB_MAP[name];
    return DEFAULT_TAB;
}

const SCHEDULES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

/**
 * The sidebar scope line ("Paid fortnightly"), derived from the primary income source.
 * Empty string (hide the line) when there is no usable primary source, no known schedule,
 * variable income, or no money entered yet (the fresh-install placeholder). M-10, FT-R-96.
 */
export function scopeLine(data) {
    const sources = data && Array.isArray(data.incomeSources) ? data.incomeSources : [];
    const idx = Number.isInteger(data && data.primaryIncomeIndex) ? data.primaryIncomeIndex : 0;
    const src = sources[idx];
    if (!src || src.incomeType === 'variable') return '';
    if (!SCHEDULES.includes(src.paySchedule)) return '';
    if (!(Number(src.grossAnnual) > 0) && !(Number(src.hoursPerCycle) > 0)) return '';
    return t('a.scope.' + src.paySchedule);
}

/** Next tab index for a key, or -1 when the key is not a navigation key or focus is off the tabs. */
export function nextTabIndex(key, current, count) {
    if (current < 0 || count < 1) return -1;
    if (key === 'ArrowDown' || key === 'ArrowRight') return (current + 1) % count;
    if (key === 'ArrowUp' || key === 'ArrowLeft') return (current - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return -1;
}
