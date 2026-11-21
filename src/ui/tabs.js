// Tab navigation and per-screen page furniture (from main.js).
// Four screens (Today, Activity, Plan, Future) behind one <nav role="tablist"> that is the desktop
// sidebar and, below 1024 px, the phone bottom bar. Old tab names resolve through LEGACY_TAB_MAP.

import { store } from '../state/store.js';
import { getElement, fitAllAmounts } from '../utils.js';
import { renderActiveTab, refreshTab } from './render.js';
import { setExpenseSearchQuery } from './render-tabs.js';
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

    store.activeTab = tabName;

    // Scoped rendering: a screen that changed while hidden re-renders now that it's visible.
    renderActiveTab();

    // A.3 — remember the active section across reloads (key unchanged, values are the new names).
    try { localStorage.setItem('ft-active-tab', tabName); } catch (_) {}

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
    } catch (_) {}
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

// F.2 — dashboard cards are links to their tab (whole card clickable + keyboard accessible).
export function setupCardLinks() {
    const dash = getElement('dashboard');
    if (!dash) return;
    const go = (card) => { const t = card.dataset.cardLink; if (t) showTab(t); };
    dash.addEventListener('click', (e) => {
        const card = e.target.closest('[data-card-link]');
        if (card) go(card);
    });
    dash.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('[data-card-link]');
        if (card && e.target === card) { e.preventDefault(); go(card); }
    });
}

// F.1 — dashboard empty-state action cards: jump to the relevant tab and open its settings modal.
export function setupDashboardEmptyActions() {
    const empty = getElement('dashboard-empty-state');
    if (!empty) return;
    const map = {
        income:   ['income',   'open-income-settings'],
        expenses: ['expenses', 'open-expenses-settings'],
        fi:       ['savings',  'open-savings-settings'],
    };
    empty.addEventListener('click', (e) => {
        const card = e.target.closest('[data-empty-action]');
        if (!card) return;
        const entry = map[card.dataset.emptyAction];
        if (!entry) return;
        showTab(entry[0]);
        const btn = getElement(entry[1]);
        if (btn) btn.click();
    });
}

// H.2 — expense name search: filter the Expenses lists live as you type.
// Display-only, so it refreshes just the Expenses tab (not a data change).
export function setupExpenseSearch() {
    const input = getElement('expense-search');
    if (!input) return;
    input.addEventListener('input', () => {
        setExpenseSearchQuery(input.value || '');
        refreshTab('plan');
    });
}
