// --- START OF: events.js ---

// Phase R — the financeData array keys that settings inputs may write to. An input declares
// its target via `data-collection`; this whitelist keeps a stray/forged value from writing to
// an arbitrary financeData property. Names must match the keys in defaultFinanceData exactly
// (note `allocation` is singular).
const SETTINGS_COLLECTIONS = [
    'incomeSources', 'taxBrackets', 'assets', 'liabilities',
    'allocation', 'essentialExpenses', 'nonEssentialExpenses'
];

function setupEventListeners() {
    // Tab navigation
    const tabsContainer = document.querySelector('[role="tablist"]');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (event) => {
            const tab = event.target.closest('.tab');
            if (tab) {
                const tabName = tab.dataset.tabTarget;
                if (tabName) showTab(tabName);
            }
        });
    }

    // Dashboard view period change
    const dashboardViewPeriodSelect = getElement('dashboard-view-period');
    if (dashboardViewPeriodSelect) {
        dashboardViewPeriodSelect.addEventListener('change', (event) => {
            financeData.dashboardViewPeriod = event.target.value;
            updateDataAndUI();
        });
    }

    // Settings Tab: General Settings
    const currencySelect = getElement('currency-select');
    if (currencySelect) {
        currencySelect.addEventListener('change', (event) => {
            financeData.currency = event.target.value;
            updateDataAndUI();
        });
    }

    // Settings dynamic lists (Income, Tax Brackets, Assets, Liabilities, Allocation, Expenses).
    // Phase D — delegated at the document level rather than on #settings, because these
    // sections now live in per-page settings modals (body-level) as well as the Settings tab.
    // Both handlers are fully guarded — they only act on elements carrying the settings
    // add-button ids, a `.delete-btn` with a settings `data-type`, or a `data-field` +
    // whitelisted `data-collection` — so What If / GUI inputs are never matched.
    document.addEventListener('click', handleSettingsClickEvents);
    document.addEventListener('change', handleSettingsChangeEvents);
    
    // What If Tab Events
    const whatIfContent = getElement('whatIf');
    if (whatIfContent) {
        whatIfContent.addEventListener('click', handleWhatIfClickEvents);
        whatIfContent.addEventListener('change', handleWhatIfChangeEvents); // For inputs in what-if expenses
    }


    // GUI Settings Tab
    const guiSettingsContent = getElement('guiSettings');
    if (guiSettingsContent) {
        guiSettingsContent.addEventListener('click', handleGuiSettingsClickEvents);
        // Input changes are handled by the "Apply GUI Settings" button typically,
        // but if live updates were desired, listeners could be added here.
    }
     // GUI Settings Form Element Change Handlers (for live update or just data gathering before apply)
    const guiElementsToWatch = [
        'gui-primary-bg-start', 'gui-primary-bg-end', 'gui-header-text-color',
        'gui-card-bg-start', 'gui-card-bg-end', 'gui-accent-color',
        'gui-font-family', 'gui-base-font-size', 'gui-main-heading', 'gui-sub-heading'
    ];
    guiElementsToWatch.forEach(id => {
        const el = getElement(id);
        if (el) {
            // Appearance auto-saves: 'input' previews live while dragging/typing; 'change'
            // commits + persists once the value settles (no "Save Appearance" button).
            el.addEventListener('input', applyGuiSettingsLivePreview);
            el.addEventListener('change', commitGuiSettings);
        }
    });
// --- JSON IMPORT LISTENER ---
    // (The former Settings-tab import input was removed with the tab in D.6; import now
    //  goes solely through the appearance modal's #json-import-gui below.)
    const jsonImportGuiInput = getElement('json-import-gui');
    if (jsonImportGuiInput) {
        jsonImportGuiInput.addEventListener('change', (event) => {
            handleJSONImport(event, true); // Pass 'true' or remove if 'isGuiTabImport' isn't used
        });
    }
}

function handleSettingsClickEvents(event) {
    const target = event.target;
    const dataType = target.dataset.type;
    const index = parseInt(target.dataset.index, 10);

    // Add buttons
    if (target.id === 'add-income-source') addIncomeSource();
    else if (target.id === 'add-tax-bracket') addTaxBracket();
    else if (target.id === 'add-asset') addAsset();
    else if (target.id === 'add-liability') addLiability();
    else if (target.id === 'add-allocation-category') addAllocationCategory();
    else if (target.id === 'whatif-add-allocation') addAllocationCategory('whatif'); // What If sandbox
    else if (target.id === 'whatif-add-asset') addAsset('whatif');
    else if (target.id === 'whatif-add-liability') addLiability('whatif');
    else if (target.id === 'whatif-add-essential') addExpenseToList('essentialExpenses', 'whatif');
    else if (target.id === 'whatif-add-nonessential') addExpenseToList('nonEssentialExpenses', 'whatif');
    else if (target.id === 'add-essential-expense-settings') addExpenseToList('essentialExpenses');
    else if (target.id === 'add-non-essential-expense-settings') addExpenseToList('nonEssentialExpenses');

    // Delete buttons for dynamic lists.
    // B.4: expense and liability deletes go through a non-blocking inline confirm popover
    // (the rows users edit most and are most likely to delete by accident). The other lists
    // keep their existing immediate delete plus their own "must keep at least one" guards.
    else if (target.classList.contains('delete-btn')) {
        const scope = target.dataset.scope; // 'whatif' for scenario rows, undefined for live
        if (dataType === 'incomeSource') removeIncomeSource(index);
        else if (dataType === 'taxBracket') removeTaxBracket(index);
        else if (dataType === 'asset') removeAsset(index, scope);
        else if (dataType === 'allocation') removeAllocationCategory(index, scope);
        else if (dataType === 'liability') inlineConfirm(target, 'Delete this liability?', () => removeLiability(index, scope));
        else if (dataType === 'essentialExpense') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('essentialExpenses', index));
        else if (dataType === 'nonEssentialExpense') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('nonEssentialExpenses', index));
        // What If scenario expenses tag data-type with the collection name (plural).
        else if (dataType === 'essentialExpenses') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('essentialExpenses', index, scope));
        else if (dataType === 'nonEssentialExpenses') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('nonEssentialExpenses', index, scope));
    }

    // Data action buttons (now live in the appearance/settings modal; D.6).
    // Export/Import data is handled by the modal's own export-json-gui / import-json-gui-btn.
    else if (target.id === 'set-current-default') actionSetCurrentAsDefault();
    else if (target.id === 'reset-to-defaults') {
        // H.5 — non-blocking inline confirm (reuse B.4) instead of window.confirm.
        const ud = getUserDefaults();
        const msg = ud
            ? 'Reset all data to your saved defaults? Your current changes will be lost.'
            : 'Reset all finance data to the factory defaults? All your current data will be lost.';
        inlineConfirm(target, msg, actionResetToAppDefaults);
    }

}

function handleSettingsChangeEvents(event) {
    const target = event.target;
    const index = parseInt(target.dataset.index, 10);
    const field = target.dataset.field;
    let value = target.value;

    // Handle radio button for primary income separately
    if (target.name === 'primary-income' && target.type === 'radio') {
        financeData.primaryIncomeIndex = index;
        updateDataAndUI();
        return;
    }
    // Income source type (salaried / self-employed) — re-render to toggle which fields are active
    else if (field === 'incomeType' && target.dataset.collection === 'incomeSources') {
        if (financeData.incomeSources[index] !== undefined) {
            financeData.incomeSources[index].incomeType = value === 'selfEmployed' ? 'selfEmployed' : 'salaried';
            renderIncomeSourcesSettings();
            updateDataAndUI();
        }
        return;
    }
    // What If scenario FI settings — write to the sandbox clone, no live update.
    else if (target.id === 'whatif-fi-multiple-set') {
        const val = parseFloat(value);
        if (whatIfFinanceData && !isNaN(val) && val > 0) whatIfFinanceData.fiSettings.multiple = val;
        return;
    }
    else if (target.id === 'whatif-expected-return-set') {
        const val = parseFloat(value);
        if (whatIfFinanceData && !isNaN(val) && val >= 0) whatIfFinanceData.fiSettings.expectedReturn = val;
        return;
    }
    else if (target.id === 'fi-multiple') {
        const val = parseFloat(value);
        if (isNaN(val) || val <= 0) {
            showFieldError(target, 'Must be greater than 0');
            return;
        }
        clearFieldError(target);
        financeData.fiSettings.multiple = val;
        updateDataAndUI();
        return;
    }
    else if (target.id === 'expected-return') {
        const val = parseFloat(value);
        if (isNaN(val) || val < 0) {
            showFieldError(target, 'Must be 0 or greater');
            return;
        }
        clearFieldError(target);
        financeData.fiSettings.expectedReturn = val;
        updateDataAndUI();
        return;
    }

    // This block now correctly handles ONLY the array-based items that have a data-field attribute
    if (field) {
        const validationError = validateFieldValue(field, value);
        if (validationError) {
            showFieldError(target, validationError);
            return;
        }
        clearFieldError(target);

        // Phase R — declarative routing. The collection an input belongs to is read from
        // `data-collection` (set in uiSettings.js) rather than DOM ancestry (`.closest()`),
        // so these inputs keep routing correctly no matter where Phase D relocates them.
        // The whitelist guards against writing to arbitrary financeData keys.
        // What If redesign — `data-scope="whatif"` routes the edit to the sandbox clone
        // (whatIfFinanceData) instead of live data; results refresh on "Simulate".
        const scope = target.dataset.scope;
        const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
        const collection = target.dataset.collection;
        const arrayToUpdate = (fd && SETTINGS_COLLECTIONS.includes(collection)) ? fd[collection] : undefined;

        if (arrayToUpdate && arrayToUpdate[index] !== undefined) {
            // Type conversions
            if (['grossAnnual', 'balance', 'interestRate', 'percentage', 'amount', 'min', 'max', 'rate', 'hoursPerCycle', 'taxRemoved', 'invoicedPayPostTax', 'currentBalance', 'savingsGoal'].includes(field)) {
                if (field === 'invoicedPayPostTax' || field === 'taxRemoved' || field === 'hoursPerCycle') {
                     value = value === '' ? null : parseFloat(value);
                } else if (field === 'max' && value === '') {
                    value = Infinity;
                } else if (field === 'rate') {
                    value = parseFloat(value) / 100; // Convert percentage to decimal
                }
                 else {
                    value = parseFloat(value) || 0;
                }
            }
            arrayToUpdate[index][field] = value;

            if (field === 'percentage' && collection === 'allocation') {
                 updateAllocationTotalDisplay(scope); // Special update for allocation total
            }
            if (scope !== 'whatif') updateDataAndUI(); // sandbox edits only touch the clone
        }
    }
}


function handleWhatIfClickEvents(event) {
    const target = event.target;
    // Scenario section add/delete now route through the document-level settings handlers
    // (data-scope="whatif"); only Calculate + Reset remain What-If-specific.
    if (target.id === 'run-whatif-calculation') runWhatIfScenario();
    else if (target.id === 'reset-whatif-to-current') initializeWhatIfTab(true); // force-reseed from live data
}

function handleWhatIfChangeEvents(event) {
    const target = event.target;
    const index = parseInt(target.dataset.index, 10);
    const field = target.dataset.field;
    const arrayPrefix = target.dataset.arrayPrefix; // 'whatIfEssential' or 'whatIfNonEssential'
    let value = target.value;

    if (field && arrayPrefix) {
        let arrayToUpdate;
        if (arrayPrefix === 'whatIfEssential') arrayToUpdate = whatIfEssentialExpenses;
        else if (arrayPrefix === 'whatIfNonEssential') arrayToUpdate = whatIfNonEssentialExpenses;

        if (arrayToUpdate && arrayToUpdate[index] !== undefined) {
            if (field === 'amount') {
                value = parseFloat(value) || 0;
            }
            arrayToUpdate[index][field] = value;
            // No need to call updateDataAndUI() here as WhatIf changes are temporary
            // and only applied when "Calculate Scenario" is clicked.
        }
    }
}


function handleGuiSettingsClickEvents(event) {
    const target = event.target;
    // (No "Save Appearance" button — appearance auto-saves on change; see commitGuiSettings.)
    if (target.id === 'reset-gui-settings') {
        inlineConfirm(target, 'Reset appearance to application defaults?', actionResetGuiToDefaults); // H.5
        return;
    }
    if (target.id === 'export-json-gui') { actionExportDataJSON(); return; }
    if (target.id === 'import-json-gui-btn') { getElement('json-import-gui').click(); return; }

    // Theme preset swatch click
    const swatch = target.closest('[data-theme]');
    if (swatch && typeof THEMES !== 'undefined') {
        const key = swatch.dataset.theme;
        const preset = THEMES[key];
        if (!preset) return;

        // Apply full theme immediately (derives tab colours, tints, etc.)
        applyTheme(preset);

        // Update colour pickers to reflect the preset so clicking Apply saves them
        const tokens = deriveTokens(preset);
        setValue('gui-primary-bg-start', preset.bg);
        setValue('gui-primary-bg-end',   preset.accent);
        setValue('gui-header-text-color', tokens['--header-text-color']);
        setValue('gui-card-bg-start',    preset.panel);
        setValue('gui-card-bg-end',      tokens['--card-bg-gradient-end']);
        setValue('gui-accent-color',     preset.accent);

        // Commit those picker values into guiSettingsData so the per-colour fields match the
        // preset. Without this, only `theme` changed while primaryBgStart/cardBgStart/… stayed
        // stale; on reload loadTheme() applies the preset, then applyGuiStylesToPage() splatters
        // the stale per-colour subset back over it → a split/half-applied theme. (Bug 2026-06-20.)
        syncGuiSettingsFromInputs();

        // Persist theme name + semantic colours immediately
        guiSettingsData.theme = key;
        guiSettingsData.colorPositive = preset.positive;
        guiSettingsData.colorNegative = preset.negative;
        guiSettingsData.colorNeutral  = preset.neutral;

        // Re-render swatches so active state updates
        renderThemeSwitcher(document.getElementById('theme-switcher-container'));

        if (autoSave) autoSave.onDataChange();
    }
}

// --- Action Functions (called by event handlers) ---

// Add/Remove for main settings
function addIncomeSource() {
    financeData.incomeSources.push({ name: "New Income", incomeType: "salaried", grossAnnual: 0, paySchedule: "monthly", hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null });
    renderIncomeSourcesSettings();
    updateDataAndUI();
}
function removeIncomeSource(index) {
    if (financeData.incomeSources.length <= 1) {
        showCustomModal("You must have at least one income source.");
        return;
    }
    financeData.incomeSources.splice(index, 1);
    if (financeData.primaryIncomeIndex === index) financeData.primaryIncomeIndex = 0;
    else if (financeData.primaryIncomeIndex > index) financeData.primaryIncomeIndex--;
    renderIncomeSourcesSettings();
    updateDataAndUI();
}

function addTaxBracket() {
    financeData.taxBrackets.push({ min: 0, max: Infinity, rate: 0 });
    renderTaxBracketsSettings(); // This will sort and re-render
    updateDataAndUI();
}
function removeTaxBracket(index) {
    if (financeData.taxBrackets.length <= 1 && financeData.taxBrackets[0].min === 0 && financeData.taxBrackets[0].max === Infinity && financeData.taxBrackets[0].rate === 0) {
         showCustomModal("You should have at least one 'catch-all' tax bracket (0 to Infinity at 0% if no tax).");
        return;
    }
    if (financeData.taxBrackets.length === 0) return; // Should not happen if above check is there
    financeData.taxBrackets.splice(index, 1);
    renderTaxBracketsSettings();
    updateDataAndUI();
}

function addAsset(scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd.assets.push({ name: "New Asset", balance: 0 });
    if (scope === 'whatif') { renderWhatIfAssets(); } else { renderAssetsSettings(); updateDataAndUI(); }
}
function removeAsset(index, scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd.assets.splice(index, 1);
    if (scope === 'whatif') { renderWhatIfAssets(); } else { renderAssetsSettings(); updateDataAndUI(); }
}

function addLiability(scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd.liabilities.push({ name: "New Liability", balance: 0, interestRate: 0 });
    if (scope === 'whatif') { renderWhatIfLiabilities(); } else { renderLiabilitiesSettings(); updateDataAndUI(); }
}
function removeLiability(index, scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd.liabilities.splice(index, 1);
    if (scope === 'whatif') { renderWhatIfLiabilities(); } else { renderLiabilitiesSettings(); updateDataAndUI(); }
}

function addAllocationCategory(scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd.allocation.push({ name: "New Category", percentage: 0, currentBalance: 0, savingsGoal: 0 });
    if (scope === 'whatif') { renderWhatIfAllocation(); }
    else { renderAllocationSettings(); updateDataAndUI(); }
}
function removeAllocationCategory(index, scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd.allocation.splice(index, 1);
    if (scope === 'whatif') { renderWhatIfAllocation(); }
    else { renderAllocationSettings(); updateDataAndUI(); }
}

function addExpenseToList(arrayName, scope) { // arrayName is 'essentialExpenses' or 'nonEssentialExpenses'
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd[arrayName].push({ name: "New Expense", amount: 0, frequency: "monthly" });
    if (scope === 'whatif') { renderWhatIfExpensesList(arrayName, `whatif-${arrayName === 'essentialExpenses' ? 'essential' : 'non-essential'}-expenses-settings`); }
    else { renderExpensesSettingsLists(); updateDataAndUI(); }
}
function removeExpenseFromList(arrayName, index, scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd[arrayName].splice(index, 1);
    if (scope === 'whatif') { renderWhatIfExpensesList(arrayName, `whatif-${arrayName === 'essentialExpenses' ? 'essential' : 'non-essential'}-expenses-settings`); }
    else { renderExpensesSettingsLists(); updateDataAndUI(); }
}

// Add/Remove for What If tab
function addWhatIfExpenseItem(type) { // type is 'essential' or 'nonEssential'
    const newExpense = { name: "Test Expense", amount: 0, frequency: "monthly" };
    if (type === 'essential') {
        whatIfEssentialExpenses.push(newExpense);
        renderWhatIfExpenseSettingsList('whatif-essential-expenses-settings', whatIfEssentialExpenses, 'whatIfEssential');
    } else {
        whatIfNonEssentialExpenses.push(newExpense);
        renderWhatIfExpenseSettingsList('whatif-non-essential-expenses-settings', whatIfNonEssentialExpenses, 'whatIfNonEssential');
    }
}
function removeWhatIfExpenseItem(type, index) {
    if (type === 'essential') {
        whatIfEssentialExpenses.splice(index, 1);
        renderWhatIfExpenseSettingsList('whatif-essential-expenses-settings', whatIfEssentialExpenses, 'whatIfEssential');
    } else {
        whatIfNonEssentialExpenses.splice(index, 1);
        renderWhatIfExpenseSettingsList('whatif-non-essential-expenses-settings', whatIfNonEssentialExpenses, 'whatIfNonEssential');
    }
}


// Main Settings Actions
// NOTE: "Save & Download HTML" backup was removed (Phase 0.3). It regex-replaced
// `let financeData = {…}` inside document.outerHTML to bake state into a downloadable
// page, but the app's JS now lives in external js/*.js files, so the pattern was never
// present in the HTML and the regex matched nothing — producing a broken/empty backup.
// JSON Export/Import (validated) is the supported backup path.

function updateFinanceDataFromFISettingsInputs() {
    // Only update from inputs if the financeData values are somehow invalid
    const inputMultiple = parseFloat(getValue('fi-multiple')) || 25;
    const inputReturn = parseFloat(getValue('expected-return')) || 7;
    
    // Only override if financeData doesn't have valid values
    if (!financeData.fiSettings.multiple || isNaN(financeData.fiSettings.multiple)) {
        financeData.fiSettings.multiple = inputMultiple;
    }
    if (!financeData.fiSettings.expectedReturn || isNaN(financeData.fiSettings.expectedReturn)) {
        financeData.fiSettings.expectedReturn = inputReturn;
    }
    
}


const USER_DEFAULTS_KEY = 'ft-user-defaults';

// Returns the saved user-defaults bundle, or null if none/invalid.
function getUserDefaults() {
    try {
        const raw = localStorage.getItem(USER_DEFAULTS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.financeData) return parsed;
    } catch (e) {
        console.error('Failed to read user defaults:', e);
    }
    return null;
}

// Keeps the reset button label in sync with whether user defaults exist.
function updateDefaultsButtonLabels() {
    const resetBtn = getElement('reset-to-defaults');
    if (resetBtn) {
        resetBtn.textContent = getUserDefaults()
            ? 'Reset to My Defaults'
            : 'Reset to Factory Defaults';
    }
}

function actionSetCurrentAsDefault() {
    if (!confirmAction('Save your current finance and appearance settings as your defaults? Resetting will return to this state.')) return;
    updateFinanceDataFromFISettingsInputs(); // Ensure FI settings are captured from inputs

    const bundle = {
        financeData: JSON.parse(JSON.stringify(financeData)),
        guiSettings: JSON.parse(JSON.stringify(guiSettingsData)),
        timestamp: new Date().toISOString()
    };
    try {
        localStorage.setItem(USER_DEFAULTS_KEY, JSON.stringify(bundle));
        // Keep the in-memory session default in sync too
        defaultFinanceData = JSON.parse(JSON.stringify(financeData));
        updateDefaultsButtonLabels();
        showCustomModal('Saved as your defaults.', 'success');
    } catch (e) {
        console.error('Failed to save user defaults:', e);
        showCustomModal('Could not save defaults (storage error).', 'error');
    }
}

function actionResetToAppDefaults() {
    // Confirmation handled by the caller's inlineConfirm (H.5).
    const userDefaults = getUserDefaults();
    if (userDefaults) {
        financeData = JSON.parse(JSON.stringify(userDefaults.financeData));
        if (userDefaults.guiSettings) {
            guiSettingsData = JSON.parse(JSON.stringify(userDefaults.guiSettings));
        }
    } else {
        financeData = JSON.parse(JSON.stringify(defaultFinanceData));
    }

    initializeSettingsUI(); // Re-render all settings inputs (also re-applies GUI settings form/styles)
    updateDataAndUI();       // Update all displays and save
    showCustomModal(userDefaults ? 'Reset to your defaults complete!' : 'Reset to factory defaults complete!', 'success');
}

function actionExportDataJSON() {
    updateFinanceDataFromFISettingsInputs(); // Ensure FI settings are captured
    const exportBundle = {
        financeData: financeData,
        guiSettings: guiSettingsData, // Include GUI settings in the JSON export
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

function validateImportBundle(bundle) {
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

function handleJSONImport(event, isGuiTabImport = false) {
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
                financeData = importedBundle.financeData;
                guiSettingsData = importedBundle.guiSettings;
                migrateIncomeSourceTypes(financeData); // Backfill incomeType on imported legacy data
                migrateAllocationFields(financeData); // Stage 0 — backfill allocation goal/funds
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


// GUI Settings Actions

// Copies the GUI form inputs into guiSettingsData (no persistence / side effects).
function syncGuiSettingsFromInputs() {
    guiSettingsData.primaryBgStart  = getValue('gui-primary-bg-start');
    guiSettingsData.primaryBgEnd    = getValue('gui-primary-bg-end');
    guiSettingsData.headerTextColor = getValue('gui-header-text-color');
    guiSettingsData.cardBgStart     = getValue('gui-card-bg-start');
    guiSettingsData.cardBgEnd       = getValue('gui-card-bg-end');
    guiSettingsData.accentColor     = getValue('gui-accent-color');
    guiSettingsData.fontFamily      = getValue('gui-font-family');
    guiSettingsData.baseFontSize    = getValue('gui-base-font-size');
    guiSettingsData.mainHeading     = getValue('gui-main-heading');
    guiSettingsData.subHeading      = getValue('gui-sub-heading');
}

// B.6 — live preview while the user drags a colour picker / edits a field. Applies styles
// immediately but does NOT persist; persistence happens on Save (or the debounced autosave).
// Live preview while a control is being dragged/typed — no persistence (avoids spamming
// autoSave on every 'input' tick as a colour picker drags).
function applyGuiSettingsLivePreview() {
    syncGuiSettingsFromInputs();
    applyGuiStylesToPage();
}

// Commit + persist once a value settles ('change'). Appearance auto-saves (no Save button).
function commitGuiSettings() {
    syncGuiSettingsFromInputs();
    applyGuiStylesToPage();
    if (autoSave) autoSave.onDataChange();
}

function actionResetGuiToDefaults() {
    // Confirmation handled by the caller's inlineConfirm (H.5).
    guiSettingsData = JSON.parse(JSON.stringify(defaultGuiSettings));
    // initializeGuiSettingsForm → applyGuiStylesToPage now applies the full theme base
    // (not just the customisable subset), so the whole UI returns to default cleanly.
    initializeGuiSettingsForm();
    if (autoSave) autoSave.onDataChange();
    showCustomModal('Appearance reset.');
}

// What If Scenario Action
function runWhatIfScenario() {
    if (!whatIfFinanceData) initializeWhatIfTab(true); // safety — seed the sandbox if missing
    const newAnnualNetIncomeInput = getValue('whatif-new-annual-income', true);

    if (isNaN(newAnnualNetIncomeInput) || newAnnualNetIncomeInput < 0) {
        showCustomModal("Please enter a valid new annual net income for the scenario.", 'error');
        return;
    }

    // What If redesign — the scenario IS the fully-edited sandbox clone (expenses, assets,
    // liabilities, allocation, FI all come from whatIfFinanceData). Income is the one remaining
    // override lever (a total net-annual-income override; full income-source editing is next).
    const scenarioFinanceData = whatIfFinanceData;

    const scenarioTotals = calculateTotals(scenarioFinanceData);
    const scenarioNetAnnualIncome = newAnnualNetIncomeInput;
    scenarioTotals.totalNetAnnualIncome = scenarioNetAnnualIncome;
    scenarioTotals.weeklySavings = (scenarioNetAnnualIncome / 52) - scenarioTotals.totalWeeklyExpenses;
    scenarioTotals.annualSavings = scenarioTotals.weeklySavings * 52;
    scenarioTotals.savingsRate = scenarioNetAnnualIncome > 0 ? (scenarioTotals.annualSavings / scenarioNetAnnualIncome) * 100 : 0;

    const scenarioCurrentAssets = scenarioTotals.currentAssets; // from the sandbox assets

    const scenarioAnnualExpenses = scenarioTotals.totalWeeklyExpenses * 52;
    const scenarioFiTarget = scenarioAnnualExpenses * scenarioFinanceData.fiSettings.multiple;
    const scenarioYearsToFI = calculateYearsToFI(scenarioTotals.annualSavings, scenarioCurrentAssets, scenarioFiTarget, scenarioFinanceData.fiSettings.expectedReturn);

    // For comparison, get current FI years
    const currentTotals = calculateTotals(financeData);
    const currentAnnualExpenses = currentTotals.totalWeeklyExpenses * 52;
    const currentFiTarget = currentAnnualExpenses * financeData.fiSettings.multiple;
    const currentYearsToFI = calculateYearsToFI(currentTotals.annualSavings, currentTotals.currentAssets, currentFiTarget, financeData.fiSettings.expectedReturn);

    const yearsDifference = (typeof scenarioYearsToFI === 'number' && typeof currentYearsToFI === 'number')
        ? (scenarioYearsToFI - currentYearsToFI)
        : 'N/A';
    const savingsRateDifference = scenarioTotals.savingsRate - currentTotals.savingsRate;

    // Scenario liabilities + net worth — both from the sandbox.
    const scenarioLiabilities = scenarioTotals.currentLiabilities;
    const scenarioNetWorth = scenarioCurrentAssets - scenarioLiabilities;
    const currentNetWorth = currentTotals.netWorth;
    const netWorthDifference = scenarioNetWorth - currentNetWorth;

    const resultsDiv = getElement('whatif-results-display');
    if (resultsDiv) {
        // Phase 0.5 — token-ised colours. All colours below resolve to theme CSS variables so the
        // panel renders correctly on every theme (incl. dark) instead of hardcoded light-mode hex.
        const POS = 'var(--color-positive)';
        const NEG = 'var(--color-negative)';
        const MUTED = 'var(--text-color-secondary)';
        const cardStyle = 'background: var(--info-bg); border: 1px solid var(--info-border); padding: 15px; border-radius: 8px;';
        const headingStyle = 'color: var(--accent-color); margin-bottom: 10px;';
        resultsDiv.innerHTML = `
            <h3>Scenario Results vs Current Situation</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0;">
                <div style="${cardStyle}">
                    <h4 style="${headingStyle}">Net Income (Annual)</h4>
                    <p><strong>Scenario:</strong> ${formatCurrency(scenarioNetAnnualIncome)}</p>
                    <p><strong>Current:</strong> ${formatCurrency(currentTotals.totalNetAnnualIncome)}</p>
                    <p style="color: ${scenarioNetAnnualIncome >= currentTotals.totalNetAnnualIncome ? POS : NEG};">
                        <strong>Change:</strong> ${scenarioNetAnnualIncome >= currentTotals.totalNetAnnualIncome ? '+' : ''}${formatCurrency(scenarioNetAnnualIncome - currentTotals.totalNetAnnualIncome)}
                    </p>
                </div>
                <div style="${cardStyle}">
                    <h4 style="${headingStyle}">Expenses (Annual)</h4>
                    <p><strong>Scenario:</strong> ${formatCurrency(scenarioAnnualExpenses)}</p>
                    <p><strong>Current:</strong> ${formatCurrency(currentAnnualExpenses)}</p>
                    <p style="color: ${scenarioAnnualExpenses <= currentAnnualExpenses ? POS : NEG};">
                        <strong>Change:</strong> ${scenarioAnnualExpenses <= currentAnnualExpenses ? '' : '+'}${formatCurrency(scenarioAnnualExpenses - currentAnnualExpenses)}
                    </p>
                </div>
                <div style="${cardStyle}">
                    <h4 style="${headingStyle}">Savings (Annual)</h4>
                    <p><strong>Scenario:</strong> ${formatCurrency(scenarioTotals.annualSavings)}</p>
                    <p><strong>Current:</strong> ${formatCurrency(currentTotals.annualSavings)}</p>
                    <p style="color: ${scenarioTotals.annualSavings >= currentTotals.annualSavings ? POS : NEG};">
                        <strong>Change:</strong> ${scenarioTotals.annualSavings >= currentTotals.annualSavings ? '+' : ''}${formatCurrency(scenarioTotals.annualSavings - currentTotals.annualSavings)}
                    </p>
                </div>
                <div style="${cardStyle}">
                    <h4 style="${headingStyle}">FI Timeline (Years)</h4>
                    <p><strong>Scenario:</strong> ${typeof scenarioYearsToFI === 'number' ? scenarioYearsToFI.toFixed(1) : '∞'}</p>
                    <p><strong>Current:</strong> ${typeof currentYearsToFI === 'number' ? currentYearsToFI.toFixed(1) : '∞'}</p>
                    <p style="color: ${yearsDifference !== 'N/A' && yearsDifference < 0 ? POS : (yearsDifference !== 'N/A' && yearsDifference > 0 ? NEG : MUTED)};">
                        <strong>Difference:</strong> ${yearsDifference !== 'N/A' ? (yearsDifference > 0 ? '+' : '') + yearsDifference.toFixed(1) : 'N/A'} years
                    </p>
                </div>
                <div style="${cardStyle}">
                    <h4 style="${headingStyle}">Net Worth</h4>
                    <p><strong>Scenario:</strong> ${formatCurrency(scenarioNetWorth)}</p>
                    <p><strong>Current:</strong> ${formatCurrency(currentNetWorth)}</p>
                    <p style="color: ${netWorthDifference >= 0 ? POS : NEG};">
                        <strong>Change:</strong> ${netWorthDifference >= 0 ? '+' : ''}${formatCurrency(netWorthDifference)}
                    </p>
                </div>
            </div>
            <div style="margin-top: 20px; padding: 15px; background: var(--content-bg-color); border: 1px solid var(--info-border); border-radius: 8px;">
                <h4>Key Metrics (Scenario)</h4>
                <p><strong>Savings Rate:</strong> ${scenarioTotals.savingsRate.toFixed(1)}% (Current: ${currentTotals.savingsRate.toFixed(1)}%, Change: ${savingsRateDifference > 0 ? '+' : ''}${savingsRateDifference.toFixed(1)}%)</p>
                <p><strong>FI Target Amount:</strong> ${formatCurrency(scenarioFiTarget)} (${scenarioFinanceData.fiSettings.multiple}× expenses)</p>
                <p><strong>Assets After Change:</strong> ${formatCurrency(scenarioCurrentAssets)}</p>
                <p><strong>Liabilities (Scenario):</strong> ${formatCurrency(scenarioLiabilities)}</p>
                <p><strong>Expected Annual Return:</strong> ${scenarioFinanceData.fiSettings.expectedReturn}%</p>
            </div>
        `;
    }
}

// Custom Modal for Alerts/Confirms (simple version)
function showCustomModal(message, type = 'info') { // type can be 'info', 'error', 'success'
    // For a real app, you'd build a proper modal DOM element.
    // For now, we'll use a simple browser alert, but flag it for upgrade.
    // console.log(`MODAL [${type.toUpperCase()}]: ${message}`); // Log to console
    alert(`[${type.toUpperCase()}] ${message}`); // Replace with a proper UI element
}

function confirmAction(message) {
    // Replace with a proper UI element for confirmation dialogs
    return confirm(message);
}

// B.4 — Non-blocking inline confirmation popover, anchored to the trigger element.
// Reusable (intended for reuse by H.5's reset confirm and any future destructive action).
// Auto-focuses "Yes"; dismisses on Escape, "No", or any outside click. Calls onConfirm()
// only when the user explicitly confirms.
function inlineConfirm(triggerEl, message, onConfirm) {
    // Only one popover at a time.
    document.querySelectorAll('.inline-confirm').forEach(el => el.dispatchEvent(new Event('ft-dismiss')));

    const pop = document.createElement('div');
    pop.className = 'inline-confirm';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', message);
    pop.innerHTML = `
        <span class="inline-confirm-msg">${escapeHtml(message)}</span>
        <span class="inline-confirm-actions">
            <button type="button" class="inline-confirm-yes">Yes</button>
            <button type="button" class="inline-confirm-no">No</button>
        </span>`;
    document.body.appendChild(pop);

    // Anchor under the trigger, right-aligned to it, kept within the viewport.
    const rect = triggerEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8));
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.left = `${left}px`;

    const cleanup = () => {
        pop.removeEventListener('ft-dismiss', cleanup);
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('mousedown', onOutside, true);
        pop.remove();
    };
    const dismiss = (refocus) => { cleanup(); if (refocus && document.body.contains(triggerEl)) triggerEl.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(true); } };
    const onOutside = (e) => { if (!pop.contains(e.target)) dismiss(false); };

    pop.addEventListener('ft-dismiss', cleanup);
    pop.querySelector('.inline-confirm-yes').addEventListener('click', () => { cleanup(); onConfirm(); });
    pop.querySelector('.inline-confirm-no').addEventListener('click', () => dismiss(true));
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onOutside, true);

    pop.querySelector('.inline-confirm-yes').focus();
}


// --- END OF: events.js ---