// Render coordination — the replacement for the old 'dataChanged' CustomEvent
// that re-rendered all six tabs on every keystroke.
//
// Model: data mutations call updateDataAndUI() (same name as before, so call
// sites read identically). It debounce-saves via autoSave, marks every
// data-driven tab dirty, and re-renders ONLY the tab on screen. A dirty tab
// re-renders when it's next shown (ui/tabs.js calls renderActiveTab on switch).

import { store } from '../state/store.js';
import { calculateTotals } from '../calc/calculations.js';
import { setText, formatCurrency, fitAllAmounts } from '../utils.js';
import {
    updateDashboardUI, updateIncomeTabUI, updateExpensesTabUI,
    updateSavingsTabUI, updateLiabilitiesTabUI,
} from './render-tabs.js';
import { renderHomeFeed } from './feed.js';
import { recordDailySnapshot } from '../state/snapshots.js';
import { checkMilestones } from '../state/milestones.js';

const TAB_RENDERERS = {
    // Home is async (event log is IndexedDB); fire-and-forget — it renders
    // greeting/pulse synchronously enough and fills the feed when ready.
    home: () => { renderHomeFeed(); },
    dashboard: updateDashboardUI,
    income: updateIncomeTabUI,
    expenses: updateExpensesTabUI,
    savings: updateSavingsTabUI,
    liabilities: updateLiabilitiesTabUI,
    // whatIf renders on demand (Calculate Scenario) — not data-driven.
};

const dirty = new Set();

function renderTab(tabName, totals) {
    const renderer = TAB_RENDERERS[tabName];
    if (!renderer) return; // whatIf etc.
    renderer(totals || calculateTotals(store.financeData));
    fitAllAmounts();
    dirty.delete(tabName);
}

// Full render — initial load, resets, imports.
export function updateAllUI() {
    const totals = calculateTotals(store.financeData);
    recordDailySnapshot(totals);
    checkMilestones(totals);
    Object.keys(TAB_RENDERERS).forEach(tab => renderTab(tab, totals));
    // The liabilities-modal total readout rides along with any full render.
    setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
    dirty.clear();
}

// Data changed — autosave + scoped re-render. Same call-site name as before.
export function updateDataAndUI(callback) {
    if (callback) callback(); // legacy signature: execute the data-modifying function

    if (store.autoSave) store.autoSave.onDataChange();

    // Trend + celebration bookkeeping ride along with every data change.
    const totals = calculateTotals(store.financeData);
    recordDailySnapshot(totals);
    checkMilestones(totals);

    Object.keys(TAB_RENDERERS).forEach(tab => dirty.add(tab));
    renderActiveTab();
}

// Re-render the visible tab if it has pending changes (called on data change and
// by showTab when a dirty tab is revealed).
export function renderActiveTab() {
    const tab = store.activeTab;
    if (!dirty.has(tab)) return;
    const totals = calculateTotals(store.financeData);
    renderTab(tab, totals);
    // Keep the liabilities-modal total fresh — it can be open while its list is edited.
    setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
}

// Display-only refresh of one tab (e.g. the expense search filter).
export function refreshTab(tabName) {
    renderTab(tabName);
}
