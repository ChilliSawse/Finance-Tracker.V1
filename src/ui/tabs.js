// Tab navigation and per-screen page furniture (from main.js).
// Four screens (Today, Activity, Plan, Future) behind one <nav role="tablist"> that is the desktop
// sidebar and, below 1024 px, the phone bottom bar. Old tab names resolve through LEGACY_TAB_MAP.

import { store } from '../state/store.js';
import { getElement, fitAllAmounts } from '../utils.js';
import { renderActiveTab, refreshTab } from './render.js';
import { resolveTab, scopeLine, nextTabIndex, DEFAULT_TAB } from './nav-model.js';

export { VALID_TABS, LEGACY_TAB_MAP, resolveTab } from './nav-model.js';

const TAB_SELECTOR = '[role="tablist"] [role="tab"]';

// Accepts a current or legacy tab name (e.g. dashboard cards still say 'income').
export function showTab(name) {
    const tabName = resolveTab(name);
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.toggle('active', screen.id === tabName);
    });
    document.querySelectorAll(TAB_SELECTOR).forEach(tab => {
        const on = tab.dataset.tabTarget === tabName;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', String(on));
        tab.setAttribute('tabindex', on ? '0' : '-1');
        if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });

    document.querySelectorAll('.side-settings').forEach((b) => { b.classList.remove('active'); b.removeAttribute('aria-current'); });

    store.activeTab = tabName;

    // Scoped rendering: a screen that changed while hidden re-renders now that it's visible.
    renderActiveTab();

    // A.3 — remember the active section across reloads (key unchanged, values are the new names).
    try { localStorage.setItem('ft-active-tab', tabName); } catch (_) { /* storage full or blocked: skip, deliberate */ }

    // Figures in a just-revealed screen couldn't be measured while hidden — fit now.
    fitAllAmounts();
}

// A.3 — restore the last-viewed section; any stored legacy name is mapped, unknown lands on Today.
export function restoreActiveTab() {
    let tab = DEFAULT_TAB;
    try {
        tab = resolveTab(localStorage.getItem('ft-active-tab'));
        // The sidebar no longer collapses (FT-R-62); drop the dead preference.
        localStorage.removeItem('ft-sidebar-collapsed');
    } catch (_) { /* storage unavailable: start on the default tab */ }
    showTab(tab);
}

// Sidebar scope line ("Paid fortnightly"), derived from the primary income source; hidden when unset.
export function renderScopeLine() {
    const el = getElement('scope-line');
    if (!el) return;
    const text = scopeLine(store.financeData);
    el.textContent = text;
    el.hidden = !text;
}

export function setupTabKeyboardNav() {
    const tabList = document.querySelector('[role="tablist"]');
    if (!tabList) return;
    tabList.addEventListener('keydown', (e) => {
        const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
        const next = nextTabIndex(e.key, tabs.indexOf(document.activeElement), tabs.length);
        if (next !== -1) {
            e.preventDefault();
            tabs[next].focus();
            showTab(tabs[next].dataset.tabTarget);
        }
    });
}
