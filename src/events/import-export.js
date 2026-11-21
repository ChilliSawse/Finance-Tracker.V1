// Full-data JSON backup export / import (from events.js).
// S1: imports are staged on a clone and committed only on success; the load-safety notices and
// the boot recovery panel live here too.

import { store } from '../state/store.js';
import { showCustomModal, confirmDialog } from '../ui/confirm.js';
import { showUndoToast } from '../ui/toast.js';
import { t } from '../i18n/strings.js';
import {
    SAVE_KEY, PRE_RESTORE_KEY, CORRUPT_PREFIX, MAX_IMPORT_BYTES,
    validateBundleShape, buildTransactionsCsv, quarantineCorruptSave,
} from '../state/sanitize.js';
import { updateDataAndUI } from '../ui/render.js';
import { initializeSettingsUI } from '../ui/settings-forms.js';
import {
    collectParts, buildBackupBundle, prepareBackup, commitBackup, carriesParts, undoLastRestore,
    collectRecoveryBundle, restoreFromRecovery, restoreUndoToast,
} from '../state/backup.js';
import '../state/scenarios.js'; // F1: registers the scenarios part of the backup bundle
import { showTab } from '../ui/tabs.js';

function downloadText(text, filename, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
}

// D2: one backup holds the settings plus the transactions and events (bundle version 2, state/backup.js).
export async function actionExportDataJSON() {
    const { rows, failed } = await collectParts();
    const bundle = buildBackupBundle({ financeData: store.financeData, guiSettings: store.guiSettingsData, partRows: rows });
    downloadText(JSON.stringify(bundle, null, 2), `finance-data-backup-${new Date().toISOString().slice(0, 10)}.json`);
    showCustomModal(t(failed.length ? 'd.backup.doneNoRows' : 'd.backup.done'), failed.length ? 'error' : 'success');
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

// The app's own render and save hooks for a restore or an undo.
function appCommitOptions() {
    return {
        storage: localStorage,
        render: () => {
            initializeSettingsUI();
            updateDataAndUI();
            document.dispatchEvent(new CustomEvent('ledger:data-swapped'));
        },
        save: () => (store.autoSave ? store.autoSave.forceSave() : true), // false = the main save failed (S9)
    };
}

/** Tells the Settings screen to look again for a restore copy (it shows its Undo row only while one exists). */
function announceCopyChanged() {
    document.dispatchEvent(new CustomEvent('ledger:restore-copy-changed'));
}

/**
 * U3: put back what was here before the last restore (settings, transactions, events). Used by the Undo toast
 * and the Settings row. A successful undo spends the copy. Shows its own result toast.
 */
export async function undoRestoreNow() {
    const result = await undoLastRestore(store, appCommitOptions());
    if (!result.ok) {
        if (result.detail) console.error('Undo error:', result.detail);
        const msg = (result.notPutBack && result.notPutBack.length) ? t('d.backup.cantPutBack')
            : result.error === 'noCopy' ? t('d.undo.noCopy')
            : result.error === 'copyMismatch' ? t('d.undo.mismatch')
            : ['cantReadCurrent', 'cantWrite', 'cantKeepCopy'].includes(result.error) ? t('d.backup.' + result.error)
            : t('d.undo.failed');
        showCustomModal(msg, 'error');
        announceCopyChanged();
        return result;
    }
    try {
        const { refreshSpendCache } = await import('../state/spend-cache.js');
        await refreshSpendCache();
        updateDataAndUI();
    } catch (err) { console.error('Spend cache refresh failed', err); }
    showCustomModal(t('d.undo.done'), 'success');
    announceCopyChanged();
    return result;
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
        const prepared = prepareBackup(e.target.result);
        if (!prepared.ok) {
            if (prepared.detail) console.error('Import error:', prepared.detail);
            showCustomModal(prepared.detail ? prepared.error : t('d.import.invalid', { reason: prepared.error }), 'error');
            return;
        }
        // The one whole-data dialog.
        const yes = await confirmDialog({
            title: t('d.import.confirmTitle'),
            body: t(carriesParts(prepared) ? 'd.backup.confirmBody' : 'd.backup.confirmBodyOld'),
            confirmLabel: t('d.import.confirmLabel'), danger: true,
        });
        if (!yes) return;
        const result = await commitBackup(store, prepared, appCommitOptions());
        if (!result.ok) {
            if (result.detail) console.error('Import error:', result.detail);
            const known = ['cantReadCurrent', 'cantWrite', 'cantKeepCopy'].includes(result.error);
            showCustomModal((result.notPutBack && result.notPutBack.length) ? t('d.backup.cantPutBack') : known ? t('d.backup.' + result.error) : result.error, 'error');
            return;
        }
        try {
            const { refreshSpendCache } = await import('../state/spend-cache.js');
            await refreshSpendCache();
            updateDataAndUI();
        } catch (err) { console.error('Spend cache refresh failed', err); }
        const c = result.counts || {};
        const done = carriesParts(prepared)
            ? t('d.backup.restoredCounts', { transactions: c.transactions || 0, events: c.events || 0 })
            : t('d.backup.restoredOld');
        // U3: straight after a restore, an Undo toast (the same copy is also offered in Settings, Backup).
        showUndoToast(restoreUndoToast({
            message: prepared.skipped ? done + ' ' + t('d.backup.skipped', { count: prepared.skipped }) : done,
            undo: () => undoRestoreNow(),
        }));
        announceCopyChanged();
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

/** "your settings, your transactions and your events" from a list of part keys. */
function plainList(keys) {
    const names = keys.map((k) => {
        const key = 'd.recovery.part.' + k;
        const label = t(key);
        return label === key ? k : label;
    });
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/**
 * Minimal recovery panel for when startup throws. Built from plain DOM so it works even if the
 * normal UI cannot. U3: it covers the whole backup, not only the settings.
 *  - Export writes a full backup bundle (settings, transactions, events, scenarios), read part by part. A part that
 *    cannot be read is named and left out; the rest is still saved.
 *  - Import restores a full bundle through the same safety copy and rollback as a normal restore.
 *  - Reset clears the saved settings (a copy is kept first); transactions and events are not touched.
 */
export function showRecoveryPanel(error) {
    console.error('Ledger boot failed:', error);
    if (document.getElementById('ledger-recovery')) return;
    const dlg = document.createElement('dialog');
    dlg.id = 'ledger-recovery';
    dlg.className = 'ledger-dialog';
    const h = document.createElement('h2'); h.textContent = t('d.recovery.title');
    const p = document.createElement('p'); p.textContent = t('d.recovery.body');
    const msg = document.createElement('p'); msg.setAttribute('role', 'status'); msg.style.marginTop = '12px';
    const row = document.createElement('div'); row.className = 'ledger-dialog-actions';
    const buttons = [];
    const btn = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sheet-btn ' + cls; b.textContent = label;
        b.addEventListener('click', fn);
        buttons.push(b);
        return b;
    };
    const busy = (on) => buttons.forEach((b) => { b.disabled = on; });
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    const keepCopy = () => {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) { quarantineCorruptSave(raw, localStorage); localStorage.setItem(PRE_RESTORE_KEY, raw); }
    };

    row.append(
        btn(t('d.recovery.export'), '', async () => {
            busy(true);
            msg.textContent = t('d.recovery.exporting');
            try {
                const { bundle, unreadable, anything } = await collectRecoveryBundle({ storage: localStorage, fallbackRaw: newestCorruptRaw() });
                if (!anything) { msg.textContent = t('d.recovery.nothing'); return; }
                downloadText(JSON.stringify(bundle, null, 2), `ledger-saved-data-${new Date().toISOString().slice(0, 10)}.json`);
                msg.textContent = unreadable.length ? t('d.recovery.exportPartial', { parts: plainList(unreadable) }) : t('d.recovery.exportDone');
            } catch (err) {
                console.error('Recovery export failed', err);
                msg.textContent = t('d.recovery.nothing');
            } finally { busy(false); }
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
        file.value = '';
        if (!f) return;
        if (f.size > MAX_IMPORT_BYTES) { msg.textContent = t('d.import.tooBig'); return; }
        const reader = new FileReader();
        reader.onerror = () => { msg.textContent = t('d.import.failed'); };
        reader.onload = async (e) => {
            busy(true);
            try {
                const result = await restoreFromRecovery(e.target.result, { store, storage: localStorage });
                if (!result.ok) {
                    if (result.detail) console.error('Recovery import error:', result.detail);
                    const known = ['cantReadCurrent', 'cantWrite', 'cantKeepCopy'].includes(result.error);
                    msg.textContent = (result.notPutBack && result.notPutBack.length) ? t('d.backup.cantPutBack')
                        : known ? t('d.backup.' + result.error)
                        : t('d.recovery.importFailed', { reason: result.error });
                    return;
                }
                msg.textContent = t('d.recovery.importDone');
                location.reload();
            } catch (err) {
                console.error('Recovery import failed', err);
                msg.textContent = t('d.recovery.importFailed', { reason: String(err && err.message || err) });
            } finally { busy(false); }
        };
        reader.readAsText(f);
    });
    dlg.addEventListener('cancel', (e) => e.preventDefault()); // no way past it but a choice
    dlg.append(h, p, row, msg, file);
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}
