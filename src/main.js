// Entry point — startup sequence (from js/main.js).
// Order matters: load data → apply theme (before first render) → build the
// settings forms → wire events → first full render → restore the active tab.

// Style load order matters (A3): generated tokens, legacy aliases, fonts, base design system, then the shrinking legacy sheet.
import './styles/tokens.generated.css';
import './styles/legacy-aliases.css';
import './styles/fonts.css';
import './styles/base.css';
import '../style.css';
import './ui/shell.css'; // A5 — sidebar, phone bottom bar, screens
import './ui/today.css'; // A6 — Today screen
import './ui/future/future.css'; // F6 — Future screen
import './ui/income-layout.css'; // C6 — Salary and Set-hours sheets
import './ui/plan-buckets.css'; // E6 — Plan buckets section
import './ui/review.css'; // E9 — monthly review
import { store } from './state/store.js';
import { FinanceAutoSave } from './state/autosave.js';
import { loadTheme } from './theme/theme.js';
import { initializeSettingsUI } from './ui/settings-forms.js';
import { setupSettingsScreen } from './ui/settings-screen.js';
import './ui/settings.css'; // D2 — Settings screen
import { setupEventListeners } from './events/setup.js';
import { updateAllUI } from './ui/render.js';
import {
    restoreActiveTab, renderScopeLine, setupTabKeyboardNav,
} from './ui/tabs.js';
import { setupImport } from './import/import-ui.js';
import { setupPdfImport } from './import/pdf-ui.js';
import { rollForwardBills, generateBillDueEvents } from './state/bills.js';
import { refreshSpendCache } from './state/spend-cache.js';
import { setupOnboarding } from './ui/onboarding.js';
import { setupMilestoneToasts } from './ui/toast.js';
import './ui/sheet.css'; // D1 — sheet, undo toast and dialog styles
import './ui/quick-add.css'; // A8 — Quick-add panel
import './ui/activity.css'; // A7 — Activity screen styles
import './ui/plan.css'; // A9a — Plan screen
import './ui/setup/setup.css'; // C7 — full-screen setup
import './ui/help.css'; // A11 — the "?" button and help sheet
import './ui/scenario/scenario.css'; // F7 — What If shell
import './ui/scenario/answer-top.css'; // F8a — What If Answer, top half
import './ui/scenario/answer-top.js'; // F8a — registers the Answer view
import { mountHelpButtons } from './ui/help.js';
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
    setupSettingsScreen(); // D2 — Settings, About and the Install row
    setupEventListeners();

    setupPwaInstallListeners();
    setupTabKeyboardNav();
    setupImport(); // Ledger — bank CSV import (Tools)
    setupPdfImport(); // Variable income — bank PDF import + payslip autofill (Tools)
    mountHelpButtons(); // A11 — one "?" per screen

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
