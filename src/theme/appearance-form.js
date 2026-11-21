// The stripped appearance modal (A4): four palette swatches, Auto/Light/Dark, Text size, plus the
// non-appearance controls (currency, backup, restore, reset) that stay until D2 moves them.
// Colours, fonts, harmony, saved themes and background effects are gone (FT-R-22, FT-R-31, FT-R-73).

import { store } from '../state/store.js';
import { getElement, setValue, getValue } from '../utils.js';
import { cloneDefaultGuiSettings } from '../state/defaults.js';
import { MODES } from './palettes.js';
import { inlineConfirm, showCustomModal } from '../ui/confirm.js';
import {
    readAppearance, applyStoredAppearance, applyAppearance, applyTextSize, renderPaletteSwatches,
} from './theme.js';

function save() { if (store.autoSave) store.autoSave.onDataChange(); }

function renderModeButtons(mode) {
    document.querySelectorAll('#mode-switcher [data-mode]').forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

// Populate the modal from guiSettingsData and apply it. Called on open, reset, factory reset and import.
export function initializeGuiSettingsForm() {
    const a = applyStoredAppearance();
    renderPaletteSwatches(getElement('theme-switcher-container'), a);
    renderModeButtons(a.mode);
    setValue('gui-base-font-size', store.guiSettingsData.baseFontSize || '16');
}

function choose(change) {
    const g = store.guiSettingsData;
    const a = applyAppearance({ ...readAppearance(g), ...change });
    g.theme = a.palette;
    g.colorMode = a.mode;
    renderPaletteSwatches(getElement('theme-switcher-container'), a);
    renderModeButtons(a.mode);
    save();
}

export function commitTextSize(persist) {
    store.guiSettingsData.baseFontSize = getValue('gui-base-font-size');
    applyTextSize(store.guiSettingsData);
    if (persist) save();
}

function actionResetGuiToDefaults() {
    store.guiSettingsData = cloneDefaultGuiSettings();
    initializeGuiSettingsForm();
    save();
    showCustomModal('Appearance reset.');
}

export function handleGuiSettingsClickEvents(event) {
    const target = event.target;
    if (target.id === 'reset-gui-settings') {
        inlineConfirm(target, 'Reset appearance to application defaults?', actionResetGuiToDefaults);
        return;
    }
    const swatch = target.closest('.theme-swatch');
    if (swatch) { choose({ palette: swatch.dataset.palette }); return; }
    const mode = target.closest('#mode-switcher button');
    if (mode && MODES.includes(mode.dataset.mode)) choose({ mode: mode.dataset.mode });
}
