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

// C.1 — collapsible info sections. Per-tab collapsed state persists in localStorage.
const INFO_STATE_KEY = 'ft-info-collapsed';

function readInfoState() {
    try { return JSON.parse(localStorage.getItem(INFO_STATE_KEY) || '{}') || {}; }
    catch (_) { return {}; }
}

function applyInfoCollapsed(section, toggle, checkbox, collapsed) {
    section.classList.toggle('collapsed', collapsed);
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Expand this guide' : 'Collapse this guide');
    }
    if (checkbox) checkbox.checked = collapsed;
}

export function setupInfoSections() {
    const sections = document.querySelectorAll('.info-section[data-info-key]');
    const state = readInfoState();

    sections.forEach(section => {
        const key = section.dataset.infoKey;
        const toggle = section.querySelector('.info-toggle');
        const checkbox = section.querySelector('.info-dismiss-check');

        applyInfoCollapsed(section, toggle, checkbox, state[key] === true);

        const setCollapsed = (next) => {
            const s = readInfoState();
            s[key] = next;
            try { localStorage.setItem(INFO_STATE_KEY, JSON.stringify(s)); } catch (_) {}
            applyInfoCollapsed(section, toggle, checkbox, next);
        };

        // The "Don't show again" checkbox lives in the body (hidden once collapsed); the
        // always-visible chevron is the way back to expanded.
        if (toggle) toggle.addEventListener('click', () => setCollapsed(!section.classList.contains('collapsed')));
        if (checkbox) checkbox.addEventListener('change', () => setCollapsed(checkbox.checked));
    });
}
