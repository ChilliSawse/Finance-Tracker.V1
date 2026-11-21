// Top-level event wiring (from events.js setupEventListeners).

import { store } from '../state/store.js';
import { getElement } from '../utils.js';
import { showTab } from '../ui/tabs.js';
import { updateDataAndUI } from '../ui/render.js';
import { handleSettingsClickEvents, handleSettingsChangeEvents } from './settings-events.js';
import { openQuickAdd } from '../ui/quick-add.js';
import { handleWhatIfClickEvents, handleWhatIfChangeEvents } from '../ui/whatif.js';
import { handleGuiSettingsClickEvents, commitTextSize } from '../theme/appearance-form.js';
import { actionExportDataJSON, actionExportTransactionsCSV, handleJSONImport } from './import-export.js';

export function setupEventListeners() {
    // Tab navigation. iOS Safari silently drops the synthetic `click` when a
    // tap wobbles a few pixels (reclassified as a scroll) or lands mid
    // double-tap heuristics — on the bottom bar that read as "tabs randomly
    // need two taps". So touch/pen taps activate on pointerup with a small
    // movement/time guard; `click` stays as the mouse/keyboard path and is
    // deduped by timestamp (showTab is idempotent, so a rare double-fire is
    // harmless anyway).
    const tabsContainer = document.querySelector('[role="tablist"]');
    if (tabsContainer) {
        let downX = 0, downY = 0, downTime = 0, pointerTapAt = 0;
        tabsContainer.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            downX = e.clientX; downY = e.clientY; downTime = e.timeStamp;
        });
        tabsContainer.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'mouse') return;
            const tab = e.target.closest('[role="tab"]');
            if (!tab || !tab.dataset.tabTarget) return;
            // Real taps barely move and don't linger; anything else is a
            // scroll/press — leave those to their native behaviour.
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
            if (e.timeStamp - downTime > 700) return;
            pointerTapAt = performance.now();
            showTab(tab.dataset.tabTarget);
        });
        tabsContainer.addEventListener('click', (event) => {
            const tab = event.target.closest('[role="tab"]');
            if (tab) {
                if (performance.now() - pointerTapAt < 400) return; // pointerup already handled this tap
                const tabName = tab.dataset.tabTarget;
                if (tabName) showTab(tabName);
            }
        });
    }

    // Quick add (sidebar Add, phone +) and the phone Settings gear: delegated, so the single nav and
    // the topbar carry no per-element listeners. Settings reuses the one #open-gui-settings opener.
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-quick-add]')) { event.preventDefault(); openQuickAdd(); return; }
        if (event.target.closest('[data-open-settings]')) { const b = getElement('open-gui-settings'); if (b) b.click(); }
    });

    // Dashboard view period change
    const dashboardViewPeriodSelect = getElement('dashboard-view-period');
    if (dashboardViewPeriodSelect) {
        dashboardViewPeriodSelect.addEventListener('change', (event) => {
            store.financeData.dashboardViewPeriod = event.target.value;
            updateDataAndUI();
        });
    }

    // General settings: currency
    const currencySelect = getElement('currency-select');
    if (currencySelect) {
        currencySelect.addEventListener('change', (event) => {
            store.financeData.currency = event.target.value;
            updateDataAndUI();
        });
    }

    // Settings dynamic lists (Income, Tax Brackets, Assets, Liabilities, Allocation, Expenses).
    // Phase D — delegated at the document level because these sections live in per-page
    // settings modals (body-level). Both handlers are fully guarded — they only act on
    // elements carrying the settings add-button ids, a `.delete-btn` with a settings
    // `data-type`, or a `data-field` + whitelisted `data-collection` — so What If / GUI
    // inputs are never matched.
    document.addEventListener('click', handleSettingsClickEvents);
    document.addEventListener('change', handleSettingsChangeEvents);

    // What If Tab Events
    const whatIfContent = getElement('whatIf');
    if (whatIfContent) {
        whatIfContent.addEventListener('click', handleWhatIfClickEvents);
        whatIfContent.addEventListener('change', handleWhatIfChangeEvents);
    }

    // GUI Settings modal (appearance actions)
    const guiSettingsContent = getElement('guiSettings');
    if (guiSettingsContent) {
        guiSettingsContent.addEventListener('click', handleGuiSettingsClickEvents);
        // Data export/import live in the same modal but aren't appearance concerns.
        guiSettingsContent.addEventListener('click', (event) => {
            if (event.target.id === 'export-json-gui') actionExportDataJSON();
            else if (event.target.id === 'import-json-gui-btn') getElement('json-import-gui').click();
            else if (event.target.id === 'export-csv-transactions') actionExportTransactionsCSV();
        });
    }
    // A4: Text size is the one typography control left. 'input' previews, 'change' persists.
    const textSize = getElement('gui-base-font-size');
    if (textSize) {
        textSize.addEventListener('input',  () => commitTextSize(false));
        textSize.addEventListener('change', () => commitTextSize(true));
    }

    // JSON backup import (appearance modal's #json-import-gui file input).
    const jsonImportGuiInput = getElement('json-import-gui');
    if (jsonImportGuiInput) {
        jsonImportGuiInput.addEventListener('change', handleJSONImport);
    }
}
