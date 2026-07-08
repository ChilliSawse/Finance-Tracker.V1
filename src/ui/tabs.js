// Tab navigation, sidebar, and per-tab page furniture (from main.js).

import { store } from '../state/store.js';
import { getElement, fitAllAmounts } from '../utils.js';
import { renderActiveTab, refreshTab } from './render.js';
import { initializeWhatIfTab } from './whatif.js';
import { setExpenseSearchQuery } from './render-tabs.js';

// 'settings' removed (Phase D.6) — it's a modal now, not a tab. Legacy saved value falls back to home.
const VALID_TABS = ['home', 'dashboard', 'income', 'expenses', 'savings', 'liabilities', 'whatIf'];

export function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('[role="tablist"] .tab').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
    });

    const activeContent = getElement(tabName);
    if (activeContent) activeContent.classList.add('active');

    const activeTabButton = document.querySelector(`[role="tablist"] .tab[data-tab-target="${tabName}"]`);
    if (activeTabButton) {
        activeTabButton.classList.add('active');
        activeTabButton.setAttribute('aria-selected', 'true');
        activeTabButton.setAttribute('tabindex', '0');
    }

    store.activeTab = tabName;

    if (tabName === 'whatIf') {
        // Phase 0.4: only seed the What If tab from live data on the FIRST visit (or after an
        // explicit "Reset to current" click); a no-op once whatIfInitialized is true.
        initializeWhatIfTab();
    }

    // Scoped rendering: a tab that changed while hidden re-renders now that it's visible.
    renderActiveTab();

    // A.3 — remember the active section across reloads.
    try { localStorage.setItem('ft-active-tab', tabName); } catch (_) {}

    // Figures in a just-revealed tab couldn't be measured while hidden — fit now.
    fitAllAmounts();
}

// A.3 — restore the last-viewed section, falling back to the Home feed.
export function restoreActiveTab() {
    let tab = 'home';
    try {
        const saved = localStorage.getItem('ft-active-tab');
        if (saved && VALID_TABS.includes(saved)) tab = saved;
    } catch (_) {}
    showTab(tab);
}

// A.3 — sidebar collapse toggle + persisted state.
function setSidebarCollapsed(shell, toggle, collapsed) {
    shell.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
}

export function setupSidebar() {
    const shell = getElement('app-shell');
    const toggle = getElement('sidebar-toggle');
    if (!shell || !toggle) return;

    const storedCollapsed = () => {
        try { return localStorage.getItem('ft-sidebar-collapsed') === '1'; } catch (_) { return false; }
    };

    // ≤768px the expanded 240px sidebar squeezes content into overlap, so
    // narrow widths START collapsed regardless of the desktop preference —
    // shrinking the window transitions to the compact layout (issue #7,
    // pass 2). The hamburger still expands it on demand; only that explicit
    // choice is persisted. Crossing the boundary re-applies the width default.
    const narrow = window.matchMedia('(max-width: 768px)');
    const applyForWidth = () => setSidebarCollapsed(shell, toggle, narrow.matches || storedCollapsed());
    applyForWidth();
    narrow.addEventListener('change', applyForWidth);

    toggle.addEventListener('click', () => {
        const now = !shell.classList.contains('is-collapsed');
        setSidebarCollapsed(shell, toggle, now);
        try { localStorage.setItem('ft-sidebar-collapsed', now ? '1' : '0'); } catch (_) {}
    });
}

// Mobile bottom bar — the "More" sheet. At ≤640px the last five nav items
// (.nav-overflow) render as a panel above the bar, toggled here. Desktop/tablet
// never show the button (CSS display:none), so the listeners are inert there.
export function setupMobileNavOverflow() {
    const nav = getElement('sidebar');
    const moreBtn = getElement('nav-more-btn');
    const overflow = getElement('nav-overflow');
    if (!nav || !moreBtn || !overflow) return;

    const setOpen = (open) => {
        nav.classList.toggle('more-open', open);
        moreBtn.setAttribute('aria-expanded', String(open));
    };

    moreBtn.addEventListener('click', () => setOpen(!nav.classList.contains('more-open')));
    // Choosing anything in the sheet (tab switch or modal opener) closes it; the
    // tablist click delegation still runs — nothing is stopped or duplicated.
    overflow.addEventListener('click', (e) => {
        if (e.target.closest('.tab, .sidebar-settings')) setOpen(false);
    });
    // A tap anywhere outside the nav dismisses the sheet, like a menu.
    document.addEventListener('click', (e) => {
        if (!nav.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setOpen(false);
    });
}

export function setupTabKeyboardNav() {
    const tabList = document.querySelector('[role="tablist"]');
    if (!tabList) return;
    tabList.addEventListener('keydown', (e) => {
        const tabs = Array.from(tabList.querySelectorAll('.tab'));
        const current = tabs.indexOf(document.activeElement);
        if (current === -1) return;

        let next = -1;
        // Vertical sidebar (Phase A) uses Up/Down; the mobile bottom bar is horizontal,
        // so Left/Right are accepted as aliases. Home/End jump to the ends either way.
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (current + 1) % tabs.length;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;

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
        refreshTab('expenses');
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
