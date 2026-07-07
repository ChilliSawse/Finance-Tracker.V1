// Full-data JSON backup export / import (from events.js).

import { store } from '../state/store.js';
import { migrateIncomeSourceTypes, migrateAllocationFields, migrateLedgerFields } from '../state/migrations.js';
import { showCustomModal, confirmAction } from '../ui/confirm.js';
import { updateDataAndUI } from '../ui/render.js';
import { initializeSettingsUI } from '../ui/settings-forms.js';
import { initializeGuiSettingsForm } from '../theme/appearance.js';
import { showTab } from '../ui/tabs.js';
import { updateFinanceDataFromFISettingsInputs } from './settings-events.js';

export function actionExportDataJSON() {
    updateFinanceDataFromFISettingsInputs(); // Ensure FI settings are captured
    const exportBundle = {
        financeData: store.financeData,
        guiSettings: store.guiSettingsData, // Include GUI settings in the JSON export
        timestamp: new Date().toISOString()
    };
    const dataStr = JSON.stringify(exportBundle, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = `finance-data-backup-${timestamp}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
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
    const quote = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = ['Date,Description,Amount,Category'];
    // Oldest first reads naturally in a spreadsheet.
    [...rows].reverse().forEach(r => {
        lines.push([r.date, quote(r.description), (r.amountCents / 100).toFixed(2), quote(catName(r.categoryId))].join(','));
    });
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `ledger-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
}

export function validateImportBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') return 'File does not contain valid JSON.';
    if (!bundle.financeData || typeof bundle.financeData !== 'object') return 'Missing financeData in backup file.';
    if (!bundle.guiSettings || typeof bundle.guiSettings !== 'object') return 'Missing guiSettings in backup file.';

    const fd = bundle.financeData;
    if (!Array.isArray(fd.incomeSources)) return 'financeData.incomeSources must be an array.';
    if (!Array.isArray(fd.essentialExpenses)) return 'financeData.essentialExpenses must be an array.';
    if (!Array.isArray(fd.nonEssentialExpenses)) return 'financeData.nonEssentialExpenses must be an array.';
    if (!Array.isArray(fd.assets)) return 'financeData.assets must be an array.';
    if (!Array.isArray(fd.liabilities)) return 'financeData.liabilities must be an array.';
    if (!fd.fiSettings || typeof fd.fiSettings.multiple !== 'number') return 'financeData.fiSettings is invalid.';

    return null;
}

export function handleJSONImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedBundle = JSON.parse(e.target.result);
            const validationError = validateImportBundle(importedBundle);
            if (validationError) {
                showCustomModal(`Invalid backup file: ${validationError}`, 'error');
                return;
            }
            if (confirmAction('Importing this file will replace ALL current data (financial and GUI). Are you sure?')) {
                store.financeData = importedBundle.financeData;
                store.guiSettingsData = importedBundle.guiSettings;
                migrateIncomeSourceTypes(store.financeData); // Backfill incomeType on imported legacy data
                migrateAllocationFields(store.financeData); // Stage 0 — backfill allocation goal/funds
                migrateLedgerFields(store.financeData); // Ledger — tax settings, categories, bills
                initializeSettingsUI();
                initializeGuiSettingsForm();
                updateDataAndUI();
                showCustomModal('Data imported successfully! Please review all tabs.');
                showTab('dashboard');
            }
        } catch (error) {
            showCustomModal('Failed to import backup file. It might be corrupted.', 'error');
            console.error('Import error:', error);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}
