// Top-level event wiring (from events.js setupEventListeners).

import { store } from '../state/store.js';
import { getElement } from '../utils.js';
import { showTab } from '../ui/tabs.js';
import { updateDataAndUI } from '../ui/render.js';
import { handleSettingsClickEvents, handleSettingsChangeEvents } from './settings-events.js';
import { handleWhatIfClickEvents, handleWhatIfChangeEvents } from '../ui/whatif.js';
import {
    GUI_COLOR_FIELDS, handleGuiSettingsClickEvents, commitGuiColor, commitGuiText,
    commitGuiEffect, commitGuiEffectColor, updateHarmonyPreview,
    handleCustomFontUpload, handleThemeImport,
} from '../theme/appearance.js';
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
            const tab = e.target.closest('.tab');
            if (!tab || !tab.dataset.tabTarget) return;
            // Real taps barely move and don't linger; anything else is a
            // scroll/press — leave those to their native behaviour.
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
            if (e.timeStamp - downTime > 700) return;
            pointerTapAt = performance.now();
            showTab(tab.dataset.tabTarget);
        });
        tabsContainer.addEventListener('click', (event) => {
            const tab = event.target.closest('.tab');
            if (tab) {
                if (performance.now() - pointerTapAt < 400) return; // pointerup already handled this tap
                const tabName = tab.dataset.tabTarget;
                if (tabName) showTab(tabName);
            }
        });
    }

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
    // J2 — appearance inputs. Each colour picker (GUI_COLOR_FIELDS) writes ONLY its own
    // guiSettings field, so override colours stay un-pinned until actually edited.
    // 'input' previews live while dragging/typing; 'change' persists.
    GUI_COLOR_FIELDS.forEach(field => {
        const el = getElement(field.id);
        if (!el) return;
        el.addEventListener('input',  () => commitGuiColor(field, false));
        el.addEventListener('change', () => commitGuiColor(field, true));
    });
    ['gui-font-family', 'gui-base-font-size'].forEach(id => {
        const el = getElement(id);
        if (!el) return;
        el.addEventListener('input',  () => commitGuiText(false));
        el.addEventListener('change', () => commitGuiText(true));
    });
    // J4 — background effect selector (persists + applies immediately).
    const bgEffectSel = getElement('gui-bg-effect');
    if (bgEffectSel) bgEffectSel.addEventListener('change', () => commitGuiEffect(true));
    // J4 — effect tint: the "Match accent" checkbox + the colour picker (live preview on input).
    const bgEffectAccent = getElement('gui-bg-effect-accent');
    if (bgEffectAccent) bgEffectAccent.addEventListener('change', () => commitGuiEffectColor(true));
    const bgEffectColor = getElement('gui-bg-effect-color');
    if (bgEffectColor) {
        bgEffectColor.addEventListener('input',  () => commitGuiEffectColor(false));
        bgEffectColor.addEventListener('change', () => commitGuiEffectColor(true));
    }
    // J3 — Colour Harmony: changing any control re-renders the live preview (no apply
    // until the button). Bound once here; idempotent because setupEventListeners runs once.
    ['harmony-accent', 'harmony-type', 'harmony-mode'].forEach(id => {
        const el = getElement(id);
        if (!el) return;
        el.addEventListener('input',  updateHarmonyPreview);
        el.addEventListener('change', updateHarmonyPreview);
    });

    // JSON backup import (appearance modal's #json-import-gui file input).
    const jsonImportGuiInput = getElement('json-import-gui');
    if (jsonImportGuiInput) {
        jsonImportGuiInput.addEventListener('change', handleJSONImport);
    }
    // J3 — theme JSON import (separate from the full-data backup import above).
    const themeImportInput = getElement('theme-import-file');
    if (themeImportInput) themeImportInput.addEventListener('change', handleThemeImport);
    // J3 — custom font upload (FontFace + localStorage).
    const fontFileInput = getElement('gui-font-file');
    if (fontFileInput) fontFileInput.addEventListener('change', handleCustomFontUpload);
}
