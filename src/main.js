// Entry point — startup sequence (from js/main.js).
// Order matters: load data → apply theme (before first render) → build the
// settings forms → wire events → first full render → restore the active tab.

import { store } from './state/store.js';
import { FinanceAutoSave } from './state/autosave.js';
import { loadTheme, registerStoredCustomFonts, applyBackgroundEffect, applyBgEffectColor } from './theme/theme.js';
import { initializeSettingsUI } from './ui/settings-forms.js';
import { initializeGuiSettingsForm } from './theme/appearance.js';
import { setupEventListeners } from './events/setup.js';
import { updateAllUI } from './ui/render.js';
import {
    restoreActiveTab, setupSidebar, setupTabKeyboardNav, setupCardLinks,
    setupDashboardEmptyActions, setupExpenseSearch, setupInfoSections,
} from './ui/tabs.js';
import { setupGuiModal, setupDraggableModal, setupPageSettingsModals } from './ui/modals.js';
import { setupPwaUpdateListeners, setupPwaInstallListeners } from './pwa.js';
import { fitAllAmounts } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    setupPwaUpdateListeners();
    store.autoSave = new FinanceAutoSave();
    store.autoSave.loadData();
    loadTheme(); // apply full preset (tab colours, tints, etc.) before UI renders
    registerStoredCustomFonts(); // J3 — re-register uploaded fonts
    applyBgEffectColor(store.guiSettingsData.bgEffectColor); // J4 — restore effect tint (before the effect starts)
    applyBackgroundEffect(store.guiSettingsData.bgEffect); // J4 — restore saved effect

    initializeSettingsUI();
    initializeGuiSettingsForm();
    setupEventListeners();

    setupPwaInstallListeners();
    setupTabKeyboardNav();
    setupSidebar();   // A.3 — collapse toggle + restore
    setupGuiModal();  // A.4 — appearance modal
    setupDraggableModal('gui-settings-modal'); // draggable, corner-resizable appearance window
    setupPageSettingsModals(); // Phase D — per-page settings modals
    setupDashboardEmptyActions(); // F.1 — welcome empty-state action cards
    setupCardLinks(); // F.2 — dashboard cards link to their tab
    setupExpenseSearch(); // H.2 — expense name filter
    setupInfoSections(); // C.1 — collapsible info guides

    updateAllUI();
    restoreActiveTab(); // A.3 — restore last-viewed section (defaults to dashboard)

    // Re-fit currency figures when the viewport changes (rotate / resize).
    let fitRaf;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(fitRaf);
        fitRaf = requestAnimationFrame(() => fitAllAmounts());
    });
});
