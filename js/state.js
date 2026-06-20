// --- START OF: state.js ---

// Default Data Structures
let defaultFinanceData = {
    currency: "AUD",
    primaryIncomeIndex: 0,
    incomeSources: [
        { name: "New Income Source", incomeType: "salaried", grossAnnual: 0, paySchedule: "fortnightly", hoursPerCycle: 0, taxRemoved: null, invoicedPayPostTax: null }
    ],
    // Half-open intervals [min, max): each band's min equals the previous band's max,
    // so no income value can fall between bands (fixes off-by-one cracks). The top band
    // uses max: Infinity so income above the cap keeps being taxed (fixes regressive cap).
    taxBrackets: [
        { min: 0, max: 18200, rate: 0 },
        { min: 18200, max: 45000, rate: 0.19 },
        { min: 45000, max: 120000, rate: 0.325 },
        { min: 120000, max: Infinity, rate: 0.37 },
    ],
    assets: [
        { name: "New Asset", balance: 0 },
    ],
    liabilities: [
        { name: "New Liability", balance: 0, interestRate: 0 }
    ],
    allocation: [
        { name: "New Allocation", percentage: 100, currentBalance: 0, savingsGoal: 0 },

    ],
    essentialExpenses: [
        { name: "New Expense", amount: 0, frequency: "weekly" },
    ],
    nonEssentialExpenses: [
        { name: "New Expense", amount: 0, frequency: "monthly" },
    ],
    fiSettings: {
        multiple: 25,
        expectedReturn: 7 // Default expected return
    },
    dashboardViewPeriod: "fortnightly" // Default view period
};

let defaultGuiSettings = {
    theme: 'default',
    primaryBgStart: "#667eea",
    primaryBgEnd: "#764ba2",
    headerTextColor: "#ffffff",
    cardBgStart: "#ffffff",
    cardBgEnd: "#f0f0f0",
    accentColor: "#667eea",
    colorPositive: "#4CAF50",
    colorNegative: "#f44336",
    colorNeutral: "#2196F3",
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    baseFontSize: "16",
    mainHeading: "Personal Finance Dashboard",
    subHeading: "Track your income, expenses, and savings with style"
};

// Application State
let financeData = JSON.parse(JSON.stringify(defaultFinanceData));
let guiSettingsData = JSON.parse(JSON.stringify(defaultGuiSettings));
let whatIfEssentialExpenses = [];
let whatIfNonEssentialExpenses = [];
// What If redesign — a full sandboxed clone of financeData. Editable What If sections write
// here (via data-scope="whatif" routing), never to live data. Seeded in initializeWhatIfTab.
let whatIfFinanceData = null;
let whatIfViewPeriod = 'fortnightly'; // period switcher for the simulated dashboard
// Phase 0.4: tracks whether the What If tab has been seeded from live data yet, so tab
// switches don't clobber in-progress edits. Reset to false by "Reset to current".
let whatIfInitialized = false;

// AutoSave Class (Simplified for this context, full IndexedDB would be more complex)
class FinanceAutoSave {
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

        // Hide "saved" message after a few seconds
        if (status === 'saved') {
            setTimeout(() => {
                if (this.saveStatus === 'saved') { // Check if still saved
                    // this.statusIndicator.classList.remove('visible');
                }
            }, 3000);
        }
    }


    getDataHash() {
        try {
            const dataString = JSON.stringify(financeData) + JSON.stringify(guiSettingsData);
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
        } else if (this.saveStatus === 'unsaved') { // If it was unsaved but hash matches, it means it's now effectively saved
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
                financeData: financeData,
                guiSettings: guiSettingsData,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem('financeTrackerData_v2', JSON.stringify(combinedData));
            this.lastSaveHash = this.getDataHash(); // Update hash after successful save
            setTimeout(() => this.updateSaveStatus('saved'), 500); // UI feedback
        } catch (error) {
            console.error('Auto-save to localStorage failed:', error);
            this.updateSaveStatus('error');
        }
    }

    loadData() {
        try {
            const savedDataString = localStorage.getItem('financeTrackerData_v2');
            if (savedDataString) {
                const loadedBundle = JSON.parse(savedDataString);
                if (loadedBundle && loadedBundle.financeData && loadedBundle.guiSettings) {
                    financeData = loadedBundle.financeData;
                    guiSettingsData = loadedBundle.guiSettings;
                    // Migrate older saves that predate the theme system
                    if (!guiSettingsData.theme) guiSettingsData.theme = 'default';
                    if (!guiSettingsData.colorPositive) guiSettingsData.colorPositive = defaultGuiSettings.colorPositive;
                    if (!guiSettingsData.colorNegative) guiSettingsData.colorNegative = defaultGuiSettings.colorNegative;
                    if (!guiSettingsData.colorNeutral) guiSettingsData.colorNeutral = defaultGuiSettings.colorNeutral;
                    migrateIncomeSourceTypes(financeData); // Backfill incomeType on legacy saves
                    migrateAllocationFields(financeData); // Stage 0 — backfill allocation goal/funds
                    this.lastSaveHash = this.getDataHash();
                    this.updateSaveStatus('saved');
                    return true;
                }
            }
        } catch (error) {
            console.error('Failed to load data from localStorage (v2):', error);
        }
        // Fallback to default if load fails or no data
        financeData = JSON.parse(JSON.stringify(defaultFinanceData));
        guiSettingsData = JSON.parse(JSON.stringify(defaultGuiSettings));
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
        // Auto-save periodically (e.g., every 15 seconds if changes were made)
        this.saveInterval = setInterval(() => {
            if (this.saveStatus === 'unsaved') { // Only save if there are pending changes
                this.smartSave();
            }
        }, 15000);

        // Save on page unload
        window.addEventListener('beforeunload', (e) => {
            if (this.saveStatus === 'unsaved') {
                this.forceSave();
                // Standard way to prompt user if there are unsaved changes, though modern browsers might override this.
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

/**
 * Backfills the `incomeType` field on income sources saved before the
 * salaried/self-employed split. Sources that had a manual net or tax entry
 * become 'selfEmployed' (with their net + tax per cycle reconstructed so the
 * numbers are preserved exactly); everything else becomes 'salaried' so the
 * tax brackets drive the estimate. Idempotent — skips already-tagged sources.
 */
function migrateIncomeSourceTypes(data) {
    if (!data || !Array.isArray(data.incomeSources)) return;
    data.incomeSources.forEach(source => {
        if (source.incomeType === 'salaried' || source.incomeType === 'selfEmployed') return;

        const cycles = getPayCyclesPerYear(source.paySchedule);
        const grossAnnual = parseFloat(source.grossAnnual) || 0;
        const netVal = parseFloat(source.invoicedPayPostTax);
        const taxVal = parseFloat(source.taxRemoved);
        // Include taxRemoved=0 as "explicitly set" — old default was 0, not null.
        // Excluding zero caused old-format sources to migrate to salaried, silently
        // applying brackets and dropping net income by 20–30%.
        const hasNet = source.invoicedPayPostTax !== null && source.invoicedPayPostTax !== '' && !isNaN(netVal);
        const hasTax = source.taxRemoved !== null && source.taxRemoved !== '' && !isNaN(taxVal);

        // All old-format sources become selfEmployed — the old engine never deducted
        // brackets, so net was always gross-derived. Users who want bracket-estimated
        // tax can explicitly switch a source to Salaried.
        source.incomeType = 'selfEmployed';

        if (hasNet) {
            const oldNetAnnual = netVal * cycles;
            const oldTaxAnnual = Math.max(0, grossAnnual - oldNetAnnual);
            source.invoicedPayPostTax = +(oldNetAnnual / cycles).toFixed(2);
            source.taxRemoved = +(oldTaxAnnual / cycles).toFixed(2);
        } else if (hasTax) {
            const oldTaxAnnual = taxVal * cycles;
            const oldNetAnnual = Math.max(0, grossAnnual - oldTaxAnnual);
            source.invoicedPayPostTax = +(oldNetAnnual / cycles).toFixed(2);
            source.taxRemoved = +(oldTaxAnnual / cycles).toFixed(2);
        } else {
            // No net or tax entry — old engine gave net = gross.
            source.invoicedPayPostTax = cycles > 0 ? +(grossAnnual / cycles).toFixed(2) : 0;
            source.taxRemoved = null;
        }
    });
}

// Stage 0 — backfill per-bucket savings goal + current funds on allocation categories
// saved before those fields existed.
function migrateAllocationFields(data) {
    if (!data || !Array.isArray(data.allocation)) return;
    data.allocation.forEach(alloc => {
        if (typeof alloc.currentBalance !== 'number') alloc.currentBalance = 0;
        if (typeof alloc.savingsGoal !== 'number') alloc.savingsGoal = 0;
    });
}

let autoSave; // Will be initialized in main.js after DOM content loaded

// --- END OF: state.js ---