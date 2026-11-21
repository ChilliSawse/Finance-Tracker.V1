// localStorage persistence (moved from state.js).
// Debounced save + periodic flush + unload/visibility flush. The storage key
// is unchanged (financeTrackerData_v2) — real saves in the wild depend on it.

import { store } from './store.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings } from './defaults.js';
import { runMigrationChain } from './migration-chain.js';
import { migrateGuiAppearance } from '../theme/theme.js';
import { showToast } from '../ui/toast.js';
import { t } from '../i18n/strings.js';
import { SAVE_KEY, sanitizeFinanceData, sanitizeGuiSettings, quarantineCorruptSave, removeLegacyPartsCopy } from './sanitize.js';

export class FinanceAutoSave {
    constructor() {
        this.saveInterval = null;
        this.lastSaveHash = null;
        this.saveStatus = 'saved'; // 'saved', 'unsaved', 'saving', 'error'
        this.changeTimeout = null;
        this.statusIndicator = null;
        this.initAutoSave();
        this.addSaveIndicatorDOM();
    }

    addSaveIndicatorDOM() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._createIndicatorElement());
        } else {
            this._createIndicatorElement();
        }
    }

    _createIndicatorElement() {
        const header = document.querySelector('.header');
        if (!header) {
            console.warn("Header element not found for save status indicator.");
            return;
        }
        if (document.getElementById('save-status-indicator')) return; // Already exists

        this.statusIndicator = document.createElement('div');
        this.statusIndicator.id = 'save-status-indicator';
        this.statusIndicator.textContent = 'All changes saved';
        this.statusIndicator.setAttribute('aria-live', 'polite');
        this.statusIndicator.setAttribute('aria-atomic', 'true');
        this.statusIndicator.classList.add('saved', 'visible');
        header.appendChild(this.statusIndicator);
        this.updateSaveStatus('saved'); // Explicitly set style for saved
    }

    updateSaveStatus(status) {
        this.saveStatus = status;
        if (!this.statusIndicator) return;

        this.statusIndicator.classList.remove('saving', 'saved', 'error', 'unsaved', 'visible');
        this.statusIndicator.classList.add(status, 'visible');

        const statusText = {
            saving: 'Saving...',
            saved: 'All changes saved',
            error: 'Save failed',
            unsaved: 'Unsaved changes'
        };
        this.statusIndicator.textContent = statusText[status] || 'All changes saved';
        this.statusIndicator.title = this.statusIndicator.textContent; // sighted hint when only the dot shows on narrow phones
    }

    getDataHash() {
        try {
            const dataString = JSON.stringify(store.financeData) + JSON.stringify(store.guiSettingsData);
            // Basic hash function (not cryptographically secure, just for change detection)
            let hash = 0;
            for (let i = 0; i < dataString.length; i++) {
                const char = dataString.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash;
        } catch (e) {
            console.error("Error generating data hash:", e);
            return null;
        }
    }

    smartSave() {
        const currentHash = this.getDataHash();
        if (currentHash !== this.lastSaveHash && currentHash !== null) {
            this.performSave();
        } else if (this.saveStatus === 'unsaved') { // Hash matches — effectively saved
            this.updateSaveStatus('saved');
        }
    }

    /** Returns true when the data was written, false when the save failed (S9: a restore treats false as a failed restore). */
    forceSave() {
        return this.performSave();
    }

    performSave() {
        this.updateSaveStatus('saving');
        try {
            const combinedData = {
                financeData: store.financeData,
                guiSettings: store.guiSettingsData,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem('financeTrackerData_v2', JSON.stringify(combinedData));
            this.lastSaveHash = this.getDataHash(); // Update hash after successful save
            this._quotaWarned = false; // saving works again, so a later full-storage failure may warn again
            setTimeout(() => this.updateSaveStatus('saved'), 500); // UI feedback
            return true;
        } catch (error) {
            console.error('Auto-save to localStorage failed:', error);
            this.updateSaveStatus('error');
            // Storage full: a persistent notice (D2) that stays until dismissed, once until a save works again,
            // not on every retried save. It says what to do first: back up.
            if (error && error.name === 'QuotaExceededError' && !this._quotaWarned) {
                this._quotaWarned = true;
                showToast(t('d.storage.full'), 'error', 0);
            }
            return false;
        }
    }

    loadData() {
        // S9: the retired localStorage rows copy (every transaction in plain text) is removed.
        try { removeLegacyPartsCopy(localStorage); } catch (error) { console.error('Could not remove the old safety copy:', error); }
        // S1: what happened while loading, for a later UI step (main.js shows the notices once).
        store.loadStatus = { corruptKey: null, migrationAborted: false, migrationErrors: [], failed: false };
        let raw = null;
        try { raw = localStorage.getItem(SAVE_KEY); } catch (error) {
            console.error('Could not read localStorage:', error);
        }
        if (raw) {
            try {
                const loadedBundle = JSON.parse(raw);
                if (loadedBundle && loadedBundle.financeData && loadedBundle.guiSettings
                    && typeof loadedBundle.financeData === 'object' && typeof loadedBundle.guiSettings === 'object') {
                    // S1: prototype keys, non-finite numbers and a hostile currency never reach the store.
                    const financeData = sanitizeFinanceData(loadedBundle.financeData);
                    const guiSettings = sanitizeGuiSettings(loadedBundle.guiSettings);
                    // A4: old theme names, colour fields and the retired mode land on a palette and a colour mode.
                    migrateGuiAppearance(guiSettings);
                    store.financeData = financeData;
                    store.guiSettingsData = guiSettings;
                    // The four legacy migrations, then the Phase 1 steps (backup, one forceSave).
                    const result = runMigrationChain(store.financeData, {
                        raw, source: 'load', forceSave: () => this.forceSave(),
                    });
                    if (result && result.aborted) {
                        // L5: carry on with the committed state; the flag lets the UI tell the user.
                        store.loadStatus.migrationAborted = true;
                        store.loadStatus.migrationErrors = result.errors || [];
                    }
                    this.lastSaveHash = this.getDataHash();
                    this.updateSaveStatus('saved');
                    return true;
                }
                // Parsed but not a bundle: keep a copy, same as unparseable.
                this._setAsideCorruptSave(raw);
            } catch (error) {
                console.error('Failed to load data from localStorage (v2):', error);
                this._setAsideCorruptSave(raw);
            }
        }
        // Fallback to default if load fails or no data
        store.financeData = cloneDefaultFinanceData();
        store.guiSettingsData = cloneDefaultGuiSettings();
        this.lastSaveHash = this.getDataHash();
        this.updateSaveStatus('saved'); // Consider it 'saved' as it's default
        return false;
    }

    // M4: copy the raw string aside (once) before anything can overwrite it.
    _setAsideCorruptSave(raw) {
        store.loadStatus.failed = true;
        try {
            const { key } = quarantineCorruptSave(raw, localStorage);
            store.loadStatus.corruptKey = key;
        } catch (e) { /* storage unavailable */ }
    }

    onDataChange() {
        if (this.saveStatus === 'saved') {
            this.updateSaveStatus('unsaved');
        }
        clearTimeout(this.changeTimeout);
        this.changeTimeout = setTimeout(() => {
            this.smartSave();
        }, 2500); // Debounce save for 2.5 seconds
    }

    initAutoSave() {
        // Auto-save periodically (every 15 seconds if changes were made)
        this.saveInterval = setInterval(() => {
            if (this.saveStatus === 'unsaved') {
                this.smartSave();
            }
        }, 15000);

        // Save on page unload
        window.addEventListener('beforeunload', (e) => {
            if (this.saveStatus === 'unsaved') {
                this.forceSave();
                e.preventDefault(); // Necessary for Chrome
                e.returnValue = ''; // Necessary for other browsers
            }
        });

        // Save on visibility change (tab switch)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.saveStatus === 'unsaved') {
                this.forceSave();
            }
        });
    }
}
