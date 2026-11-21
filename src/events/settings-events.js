// Settings events. A12b removed the document-level click/change handlers that routed the
// legacy grid editors (and the What If sandbox) and every add/remove list helper: Plan's sheets
// own editing now. What stays is Erase all data, the one whole-data reset.

import { store } from '../state/store.js';
import { t } from '../i18n/strings.js';
import { showCustomModal, confirmDialog } from '../ui/confirm.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings } from '../state/defaults.js';
import { updateDataAndUI } from '../ui/render.js';
import { initializeSettingsUI } from '../ui/settings-forms.js';

// D2 (FT-R-64): "Save as My Defaults" and the user-defaults store are gone; Back up and Restore replace them.
// Erase all data is the one whole-data reset: one dialog, then a fresh start (settings, plan, transactions, events).
export async function eraseAllData() {
    const yes = await confirmDialog({
        title: t('d.erase.title'), body: t('d.erase.body'), confirmLabel: t('d.erase.confirm'), danger: true,
    });
    if (!yes) return false;
    await import('../state/scenarios.js'); // F1: registers the scenarios part, so erase-all clears it
    const { commitErase, RETIRED_KEYS } = await import('../state/backup.js');
    const result = await commitErase(store, {
        financeData: cloneDefaultFinanceData(), guiSettings: cloneDefaultGuiSettings(),
    }, {
        storage: localStorage,
        render: () => {
            initializeSettingsUI(); // re-renders the settings inputs and re-applies the appearance
            updateDataAndUI();
            document.dispatchEvent(new CustomEvent('ledger:data-swapped'));
        },
        save: () => (store.autoSave ? store.autoSave.forceSave() : true), // false = the main save failed (S9)
    });
    if (!result.ok) {
        if (result.detail) console.error('Erase failed:', result.detail);
        showCustomModal(t('d.erase.failed'), 'error');
        return false;
    }
    try {
        const sample = await import('../state/sample-data.js');
        sample.clearSampleFlag();
        for (const key of RETIRED_KEYS) localStorage.removeItem(key);
        const { refreshSpendCache } = await import('../state/spend-cache.js');
        await refreshSpendCache();
        updateDataAndUI();
    } catch (err) { console.error('Erase clean-up failed', err); }
    showCustomModal(t('d.erase.done'), 'success');
    return true;
}
