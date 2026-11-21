// Entry point — startup sequence (from js/main.js).
// Order matters: load data → apply theme (before first render) → build the
// settings forms → wire events → first full render → restore the active tab.

// Style load order matters (A3): generated tokens, legacy aliases, fonts, base design system, then the shrinking legacy sheet.
import './styles/tokens.generated.css';
import './styles/legacy-aliases.css';
import './styles/fonts.css';
import './styles/base.css';
import '../style.css';
import './theme/appearance.css'; // A4: stripped appearance modal
import './ui/shell.css'; // A5 — sidebar, phone bottom bar, screens
import { store } from './state/store.js';
import { FinanceAutoSave } from './state/autosave.js';
import { loadTheme } from './theme/theme.js';
import { initializeSettingsUI } from './ui/settings-forms.js';
import { initializeGuiSettingsForm } from './theme/appearance-form.js';
import { setupEventListeners } from './events/setup.js';
import { updateAllUI } from './ui/render.js';
import {
    restoreActiveTab, renderScopeLine, setupTabKeyboardNav, setupCardLinks,
    setupDashboardEmptyActions, setupExpenseSearch, setupInfoSections,
} from './ui/tabs.js';
import { setupGuiModal, setupPageSettingsModals } from './ui/modals.js';
import { setupImport } from './import/import-ui.js';
import { setupPdfImport } from './import/pdf-ui.js';
import { setupIncomeStatement } from './ui/income-statement.js';
import { rollForwardBills, generateBillDueEvents } from './state/bills.js';
import { refreshSpendCache } from './state/spend-cache.js';
import { setupOnboarding } from './ui/onboarding.js';
import { setupMilestoneToasts } from './ui/toast.js';
import './ui/sheet.css'; // D1 — sheet, undo toast and dialog styles
import './ui/quick-add.css'; // A8 — Quick-add panel
import { setupPwaUpdateListeners, setupPwaInstallListeners } from './pwa.js';
import { fitAllAmounts } from './utils.js';
import { showLoadNotices, showRecoveryPanel } from './events/import-export.js';
import { runPayRollIfDue } from './state/saving-model.js'; // E5 — pay-day credit

function boot() {
    setupPwaUpdateListeners();
    store.autoSave = new FinanceAutoSave();
    const hadSavedData = store.autoSave.loadData();
    // E5: pay-day credit (a no-op when auto-credit is off); saved with the next autosave.
    if (runPayRollIfDue(store.financeData).changed) store.autoSave.onDataChange();
    loadTheme(); // A4: palette and mode attributes plus text size, before the UI renders

    // Ledger — un-migrated (legacy) bills roll to their next occurrence; plan-item bills (B6)
    // never roll: their dates come from anchorDue, so this is a no-op for them. Announce
    // anything due this week in the feed (once per bill+date).
    if (rollForwardBills(store.financeData) && store.autoSave) store.autoSave.onDataChange();
    generateBillDueEvents(store.financeData);

    initializeSettingsUI();
    initializeGuiSettingsForm();
    setupEventListeners();

    setupPwaInstallListeners();
    setupTabKeyboardNav();
    setupGuiModal();  // A.4 — appearance modal
    setupPageSettingsModals(); // Phase D — per-page settings modals
    setupImport(); // Ledger — bank CSV import (Tools)
    setupPdfImport(); // Variable income — bank PDF import + payslip autofill (Tools)
    setupIncomeStatement(); // Variable income — printable statement (income modal)
    setupDashboardEmptyActions(); // F.1 — welcome empty-state action cards
    setupCardLinks(); // F.2 — dashboard cards link to their tab
    setupExpenseSearch(); // H.2 — expense name filter
    setupInfoSections(); // C.1 — collapsible info guides

    updateAllUI();
    renderScopeLine(); // A5 — sidebar "Paid fortnightly", hidden when unset
    restoreActiveTab(); // A.3 — restore last-viewed section (legacy names mapped; defaults to Today)

    setupMilestoneToasts(); // Ledger — celebration toasts
    setupOnboarding(hadSavedData); // Ledger — first-run guided setup / sample data

    // Spending aggregates load async from IndexedDB; refresh the visible tab
    // once they're in so transaction-fed cards appear without a manual switch.
    // B7: data is loaded by now, so the cache can resolve the pay cycle; Today and Activity selectors stay ready:false until then.
    refreshSpendCache({ data: store.financeData }).then(() => {
        updateAllUI();
    });

    // E5: coming back to the app rolls any pay day that has passed (off by default for migrated data).
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && runPayRollIfDue(store.financeData).changed) { store.autoSave.onDataChange(); updateAllUI(); }
    });

    // Re-fit currency figures when the viewport changes (rotate / resize).
    let fitRaf;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(fitRaf);
        fitRaf = requestAnimationFrame(() => fitAllAmounts());
    });

    showLoadNotices(); // S1: once-only notices (unreadable save set aside, upgrade aborted)
}

// S1/M3: if startup throws because of the saved data, show a recovery panel instead of a dead page.
document.addEventListener('DOMContentLoaded', () => {
    try { boot(); } catch (err) { showRecoveryPanel(err); }
});
