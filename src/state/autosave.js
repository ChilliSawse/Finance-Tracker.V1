// localStorage persistence (moved from state.js).
// Debounced save + periodic flush + unload/visibility flush. The storage key
// is unchanged (financeTrackerData_v2) — real saves in the wild depend on it.

import { store } from './store.js';
import { cloneDefaultFinanceData, cloneDefaultGuiSettings, defaultGuiSettings } from './defaults.js';
import { migrateIncomeSourceTypes, migrateAllocationFields, migrateLedgerFields, migrateVariableIncomeFields } from './migrations.js';
import { migrateGuiTheme, migrateGuiColorFields, pickFirstRunTheme, THEMES } from '../theme/theme.js';

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

    forceSave() {
        this.performSave();
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
            setTimeout(() => this.updateSaveStatus('saved'), 500); // UI feedback
        } catch (error) {
            console.error('Auto-save to localStorage failed:', error);
            this.updateSaveStatus('error');
            // Storage full: say what happened and what to do, once per session —
            // not on every retried save.
            if (error && error.name === 'QuotaExceededError' && !this._quotaWarned) {
                this._quotaWarned = true;
                alert("[STORAGE FULL] Your latest changes couldn't be saved — this device's storage for Ledger is full.\n\n"
                    + '1. Open Settings → Save, Reset & Backup → Export Backup (JSON) so nothing is lost.\n'
                    + '2. Free space by removing a custom font or saved themes (they take the most room).\n\n'
                    + 'Saving will resume automatically once there is space.');
            }
        }
    }

    loadData() {
        try {
            const savedDataString = localStorage.getItem('financeTrackerData_v2');
            if (savedDataString) {
                const loadedBundle = JSON.parse(savedDataString);
                if (loadedBundle && loadedBundle.financeData && loadedBundle.guiSettings) {
                    store.financeData = loadedBundle.financeData;
                    store.guiSettingsData = loadedBundle.guiSettings;
                    // Migrate older saves that predate the theme system
                    if (!store.guiSettingsData.theme) store.guiSettingsData.theme = 'midnight';
                    if (!store.guiSettingsData.colorPositive) store.guiSettingsData.colorPositive = defaultGuiSettings.colorPositive;
                    if (!store.guiSettingsData.colorNegative) store.guiSettingsData.colorNegative = defaultGuiSettings.colorNegative;
                    if (!store.guiSettingsData.colorNeutral) store.guiSettingsData.colorNeutral = defaultGuiSettings.colorNeutral;
                    // J1 — repoint saves on removed presets ('default'/'dark') to the closest
                    // survivor and refresh the colour overlay so the old palette can't bleed through.
                    migrateGuiTheme(store.guiSettingsData);
                    migrateGuiColorFields(store.guiSettingsData);
                    migrateIncomeSourceTypes(store.financeData); // Backfill incomeType on legacy saves
                    migrateAllocationFields(store.financeData); // Stage 0 — backfill allocation goal/funds
                    migrateLedgerFields(store.financeData); // Ledger — tax settings, categories, bills
                    migrateVariableIncomeFields(store.financeData); // Variable income — events/baseHourlyRate
                    // Rebrand: the heading editor was removed pre-Ledger, so every save
                    // carries the old default strings — safe to upgrade them in place.
                    if (store.guiSettingsData.mainHeading === 'Personal Finance Dashboard') {
                        store.guiSettingsData.mainHeading = defaultGuiSettings.mainHeading;
                        store.guiSettingsData.subHeading = defaultGuiSettings.subHeading;
                    }
                    this.lastSaveHash = this.getDataHash();
                    this.updateSaveStatus('saved');
                    return true;
                }
            }
        } catch (error) {
            console.error('Failed to load data from localStorage (v2):', error);
        }
        // Fallback to default if load fails or no data
        store.financeData = cloneDefaultFinanceData();
        store.guiSettingsData = cloneDefaultGuiSettings();
        // First run: respect the system colour scheme — dark systems open in
        // midnight instead of the warm sunrise default. Mirrors a preset click
        // (write the 8 base colours; overrides stay empty).
        const firstTheme = pickFirstRunTheme();
        if (firstTheme !== store.guiSettingsData.theme && THEMES[firstTheme]) {
            const p = THEMES[firstTheme];
            Object.assign(store.guiSettingsData, {
                theme: firstTheme,
                primaryBgStart: p.bg, cardBgStart: p.panel, textColor: p.fg,
                borderColor: p.border, accentColor: p.accent,
                colorPositive: p.positive, colorNegative: p.negative, colorNeutral: p.neutral,
            });
        }
        this.lastSaveHash = this.getDataHash();
        this.updateSaveStatus('saved'); // Consider it 'saved' as it's default
        return false;
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
