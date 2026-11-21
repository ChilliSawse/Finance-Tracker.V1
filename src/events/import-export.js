// Full-data JSON backup export / import (from events.js).
// S1: imports are staged on a clone and committed only on success; the load-safety notices and
// the boot recovery panel live here too.

import { store } from '../state/store.js';
import { showCustomModal, confirmDialog } from '../ui/confirm.js';
import { t } from '../i18n/strings.js';
import {
    SAVE_KEY, PRE_RESTORE_KEY, CORRUPT_PREFIX, MAX_IMPORT_BYTES, prepareImport, commitImport,
    validateBundleShape, buildTransactionsCsv, quarantineCorruptSave,
} from '../state/sanitize.js';
import { updateDataAndUI } from '../ui/render.js';
import { initializeSettingsUI } from '../ui/settings-forms.js';
import { initializeGuiSettingsForm } from '../theme/appearance-form.js';
import { showTab } from '../ui/tabs.js';
import { updateFinanceDataFromFISettingsInputs } from './settings-events.js';

function downloadText(text, filename, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
}

export function actionExportDataJSON() {
    updateFinanceDataFromFISettingsInputs(); // Ensure FI settings are captured
    const exportBundle = {
        financeData: store.financeData,
        guiSettings: store.guiSettingsData, // Include GUI settings in the JSON export
        timestamp: new Date().toISOString()
    };
    const dataStr = JSON.stringify(exportBundle, null, 2);
    downloadText(dataStr, `finance-data-backup-${new Date().toISOString().slice(0, 10)}.json`);
    showCustomModal("Data exported as JSON!");
}

// Ledger — export imported transactions as CSV (date, description, amount, category).
export async function actionExportTransactionsCSV() {
    const { listTransactions } = await import('../state/transactions.js');
    let rows;
    try {
        rows = await listTransactions();
    } catch (err) {
        showCustomModal('Could not read transactions: ' + (err && err.message || err), 'error');
        return;
    }
    if (!rows.length) {
        showCustomModal('No transactions to export yet — import a bank CSV first.');
        return;
    }
    const catName = (id) => {
        const c = (store.financeData.categories || []).find(x => x.id === id);
        return c ? c.name : 'Other';
    };
    // M5: text cells starting = + - @ tab or CR get a leading quote; amounts stay plain numbers.
    downloadText(buildTransactionsCsv(rows, catName), `ledger-transactions-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
}

export function validateImportBundle(bundle) {
    return validateBundleShape(bundle);
}

export function handleJSONImport(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    // M6: refuse an oversized file before reading it.
    if (file.size > MAX_IMPORT_BYTES) {
        showCustomModal(t('d.import.tooBig'), 'error');
        return;
    }
    const reader = new FileReader();
    reader.onerror = () => showCustomModal(t('d.import.failed'), 'error');
    reader.onload = async (e) => {
        // M3: validate, sanitize and migrate on a clone. The store is not touched until all of it works.
        const prepared = prepareImport(e.target.result);
        if (!prepared.ok) {
            if (prepared.detail) console.error('Import error:', prepared.detail);
            showCustomModal(prepared.detail ? prepared.error : t('d.import.invalid', { reason: prepared.error }), 'error');
            return;
        }
        const yes = await confirmDialog({
            title: t('d.import.confirmTitle'), body: t('d.import.confirmBody'),
            confirmLabel: t('d.import.confirmLabel'), danger: true,
        });
        if (!yes) return;
        const result = commitImport(store, prepared, {
            storage: localStorage,
            render: () => {
                initializeSettingsUI();
                initializeGuiSettingsForm();
                updateDataAndUI();
            },
            save: () => { if (store.autoSave) store.autoSave.forceSave(); },
        });
        if (!result.ok) {
            if (result.detail) console.error('Import error:', result.detail);
            showCustomModal(result.error, 'error');
            return;
        }
        showCustomModal(t('d.import.done'));
        showTab('today');
    };
    reader.readAsText(file);
}

// ---------- load safety (M3 recovery, M4 notice, L5 notice) ----------

function newestCorruptRaw() {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CORRUPT_PREFIX) && (best === null || k > best)) best = k;
    }
    return best ? localStorage.getItem(best) : null;
}

/** One-time notices after load: an unreadable save was set aside; the migration chain aborted. */
export async function showLoadNotices() {
    const status = store.loadStatus;
    if (!status) return;
    if (status.migrationAborted) showCustomModal(t('d.migrate.aborted'), 'error');
    if (status.corruptKey) {
        const key = status.corruptKey;
        status.corruptKey = null; // once
        const yes = await confirmDialog({ title: t('d.corrupt.title'), body: t('d.corrupt.body'), confirmLabel: t('d.corrupt.export') });
        if (yes) {
            const raw = localStorage.getItem(key);
            if (raw) downloadText(raw, `ledger-unreadable-save-${key.slice(CORRUPT_PREFIX.length)}.json`);
        }
    }
}

/**
 * Minimal recovery panel for when startup throws. Built from plain DOM so it works even if the
 * normal UI cannot: export the raw saved data, import a backup, or reset. No DevTools needed.
 */
export function showRecoveryPanel(error) {
    console.error('Ledger boot failed:', error);
    if (document.getElementById('ledger-recovery')) return;
    const dlg = document.createElement('dialog');
    dlg.id = 'ledger-recovery';
    dlg.className = 'ledger-dialog';
    const h = document.createElement('h2'); h.textContent = t('d.recovery.title');
    const p = document.createElement('p'); p.textContent = t('d.recovery.body');
    const msg = document.createElement('p'); msg.setAttribute('role', 'status');
    const row = document.createElement('div'); row.className = 'ledger-dialog-actions';
    const btn = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sheet-btn ' + cls; b.textContent = label;
        b.addEventListener('click', fn);
        return b;
    };
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    const rawNow = () => { try { return localStorage.getItem(SAVE_KEY) || newestCorruptRaw(); } catch (e) { return null; } };
    const keepCopy = () => {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) { quarantineCorruptSave(raw, localStorage); localStorage.setItem(PRE_RESTORE_KEY, raw); }
    };

    row.append(
        btn(t('d.recovery.export'), '', () => {
            const raw = rawNow();
            if (!raw) { msg.textContent = t('d.recovery.nothing'); return; }
            downloadText(raw, `ledger-saved-data-${new Date().toISOString().slice(0, 10)}.json`);
        }),
        btn(t('d.recovery.import'), '', () => file.click()),
        btn(t('d.recovery.reset'), 'is-danger', async () => {
            const yes = await confirmDialog({ title: t('d.recovery.resetTitle'), body: t('d.recovery.resetBody'), danger: true });
            if (!yes) return;
            try { keepCopy(); localStorage.removeItem(SAVE_KEY); } catch (e) { console.error(e); }
            location.reload();
        }),
    );
    file.addEventListener('change', () => {
        const f = file.files[0];
        if (!f) return;
        if (f.size > MAX_IMPORT_BYTES) { msg.textContent = t('d.import.tooBig'); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            const prepared = prepareImport(e.target.result);
            if (!prepared.ok) { msg.textContent = t('d.recovery.importFailed', { reason: prepared.error }); return; }
            try {
                keepCopy();
                localStorage.setItem(SAVE_KEY, JSON.stringify({
                    financeData: prepared.financeData, guiSettings: prepared.guiSettings, timestamp: new Date().toISOString(),
                }));
            } catch (err) { msg.textContent = t('d.recovery.importFailed', { reason: String(err && err.message || err) }); return; }
            location.reload();
        };
        reader.readAsText(f);
    });
    dlg.addEventListener('cancel', (e) => e.preventDefault()); // no way past it but a choice
    dlg.append(h, p, row, msg, file);
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}
