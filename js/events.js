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
    // J2 — appearance inputs. Each colour picker (GUI_COLOR_FIELDS) writes ONLY its own
    // guiSettings field, so override colours stay un-pinned until actually edited. Font /
    // size / heading-text are gathered together by commitGuiText. 'input' previews live
    // while dragging/typing; 'change' persists (appearance auto-saves — no Save button).
    GUI_COLOR_FIELDS.forEach(field => {
        const el = getElement(field.id);
        if (!el) return;
        el.addEventListener('input',  () => commitGuiColor(field, false));
        el.addEventListener('change', () => commitGuiColor(field, true));
    });
    ['gui-font-family', 'gui-base-font-size', 'gui-main-heading', 'gui-sub-heading'].forEach(id => {
        const el = getElement(id);
        if (!el) return;
        el.addEventListener('input',  () => commitGuiText(false));
        el.addEventListener('change', () => commitGuiText(true));
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
    else if (target.id === 'whatif-add-income') addIncomeSource('whatif');
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
        if (dataType === 'incomeSource') removeIncomeSource(index, scope);
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
    // What If scenario primary income (distinct radio name; writes to the sandbox).
    else if (target.name === 'whatif-primary-income' && target.type === 'radio') {
        if (whatIfFinanceData) { whatIfFinanceData.primaryIncomeIndex = index; renderWhatIfIncomeSources(); }
        return;
    }
    // Income source type (salaried / self-employed) — re-render to toggle which fields are active
    else if (field === 'incomeType' && target.dataset.collection === 'incomeSources') {
        const scope = target.dataset.scope;
        const data = scope === 'whatif' ? whatIfFinanceData : financeData;
        if (data && data.incomeSources[index] !== undefined) {
            data.incomeSources[index].incomeType = value === 'selfEmployed' ? 'selfEmployed' : 'salaried';
            if (scope === 'whatif') renderWhatIfIncomeSources();
            else { renderIncomeSourcesSettings(); updateDataAndUI(); }
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
    // Simulated-dashboard period switcher: re-render the results in the new period.
    // (Scenario section field edits route through the document-level settings handlers
    // via data-scope="whatif"; nothing else What-If-specific happens on change.)
    if (target.id === 'whatif-view-period') {
        whatIfViewPeriod = target.value;
        runWhatIfScenario();
    }
}


function handleGuiSettingsClickEvents(event) {
    const target = event.target;
    // (No "Save Appearance" button — appearance auto-saves on change; see commitGuiColor/commitGuiText.)
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

        // J2 — selecting a preset starts from its base colours and CLEARS every custom
        // override, so the preset drives the whole page (no stale overlay = no split look).
        // applyGuiStylesToPage() then derives the full token set from the base.
        guiSettingsData.theme           = key;
        guiSettingsData.primaryBgStart  = preset.bg;
        guiSettingsData.cardBgStart     = preset.panel;
        guiSettingsData.textColor       = preset.fg;
        guiSettingsData.borderColor     = preset.border;
        guiSettingsData.accentColor     = preset.accent;
        guiSettingsData.colorPositive   = preset.positive;
        guiSettingsData.colorNegative   = preset.negative;
        guiSettingsData.colorNeutral    = preset.neutral;
        guiSettingsData.headingColor    = '';
        guiSettingsData.mutedColor      = '';
        guiSettingsData.headerTextColor = '';
        guiSettingsData.colorEssential  = '';
        guiSettingsData.colorWarning    = '';

        applyGuiStylesToPage();
        syncGuiColorInputs(); // refresh the Customize pickers to the new colours
        renderThemeSwitcher(document.getElementById('theme-switcher-container'));

        if (autoSave) autoSave.onDataChange();
    }
}

// --- Action Functions (called by event handlers) ---

// Add/Remove for main settings
function addIncomeSource(scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    fd.incomeSources.push({ name: "New Income", incomeType: "salaried", grossAnnual: 0, paySchedule: "monthly", hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null });
    if (scope === 'whatif') { renderWhatIfIncomeSources(); } else { renderIncomeSourcesSettings(); updateDataAndUI(); }
}
function removeIncomeSource(index, scope) {
    const fd = scope === 'whatif' ? whatIfFinanceData : financeData;
    if (!fd) return;
    if (fd.incomeSources.length <= 1) {
        showCustomModal("You must have at least one income source.");
        return;
    }
    fd.incomeSources.splice(index, 1);
    if (fd.primaryIncomeIndex === index) fd.primaryIncomeIndex = 0;
    else if (fd.primaryIncomeIndex > index) fd.primaryIncomeIndex--;
    if (scope === 'whatif') { renderWhatIfIncomeSources(); } else { renderIncomeSourcesSettings(); updateDataAndUI(); }
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

// J2 — appearance colour fields. `mode: 'base'` feeds deriveTokens (so the rest of the
// palette follows it); `mode: 'override'` overlays a single CSS var only when the user
// pins it (default empty = derived). `cssVar` is the token an override pins / reads back.
const GUI_COLOR_FIELDS = [
    { id: 'gui-col-bg',         key: 'primaryBgStart', mode: 'base' },
    { id: 'gui-col-surface',    key: 'cardBgStart',    mode: 'base' },
    { id: 'gui-col-text',       key: 'textColor',      mode: 'base' },
    { id: 'gui-col-accent',     key: 'accentColor',    mode: 'base' },
    { id: 'gui-col-border',     key: 'borderColor',    mode: 'base' },
    { id: 'gui-col-heading',    key: 'headingColor',   mode: 'override', cssVar: '--heading-color' },
    { id: 'gui-col-muted',      key: 'mutedColor',     mode: 'override', cssVar: '--text-color-secondary' },
    { id: 'gui-col-headertext', key: 'headerTextColor',mode: 'override', cssVar: '--header-text-color' },
    { id: 'gui-col-positive',   key: 'colorPositive',  mode: 'base' },
    { id: 'gui-col-negative',   key: 'colorNegative',  mode: 'base' },
    { id: 'gui-col-neutral',    key: 'colorNeutral',   mode: 'base' },
    { id: 'gui-col-essential',  key: 'colorEssential', mode: 'override', cssVar: '--color-essential' },
    { id: 'gui-col-warning',    key: 'colorWarning',   mode: 'override', cssVar: '--color-warning' },
];

// Normalise a CSS colour (hex or rgb/rgba) to #rrggbb for a native colour input.
function toHexColor(c) {
    if (!c) return '';
    c = c.trim();
    if (c[0] === '#') {
        return c.length === 4 ? '#' + c.slice(1).split('').map(x => x + x).join('') : c;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return '';
    const [r, g, b] = m[1].split(',').map(n => parseInt(n, 10));
    const h = v => Math.max(0, Math.min(255, v || 0)).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

// Push current colours into the Customize pickers: base fields from guiSettings, override
// fields from the live computed value (so the swatch shows the effective colour even when
// the field is empty = derived). Called on form open + after a preset swatch click.
function syncGuiColorInputs() {
    const cs = getComputedStyle(document.documentElement);
    GUI_COLOR_FIELDS.forEach(field => {
        const el = getElement(field.id);
        if (!el) return;
        let val = guiSettingsData[field.key];
        if (field.mode === 'override' && !val) val = toHexColor(cs.getPropertyValue(field.cssVar));
        if (val) el.value = val;
    });
}

// One colour picker changed — write just its field, re-derive/apply, persist on commit.
function commitGuiColor(field, persist) {
    guiSettingsData[field.key] = getValue(field.id);
    applyGuiStylesToPage();
    if (persist && autoSave) autoSave.onDataChange();
}

// Font / base size / dashboard-label text changed — gather them and apply.
function commitGuiText(persist) {
    guiSettingsData.fontFamily   = getValue('gui-font-family');
    guiSettingsData.baseFontSize = getValue('gui-base-font-size');
    guiSettingsData.mainHeading  = getValue('gui-main-heading');
    guiSettingsData.subHeading   = getValue('gui-sub-heading');
    applyGuiStylesToPage();
    if (persist && autoSave) autoSave.onDataChange();
}

// J2 — Themes / Customize tab switching in the appearance modal. Idempotent
// (guarded), so repeated initializeGuiSettingsForm() calls don't double-bind.
function activateAppearanceTab(btn) {
    const tabs = btn.closest('.appearance-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('.appearance-tab').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(b.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
    });
}

function setupAppearanceTabs() {
    const tabs = document.querySelector('#guiSettings .appearance-tabs');
    if (!tabs || tabs.dataset.wired) return;
    tabs.dataset.wired = '1';
    const buttons = [...tabs.querySelectorAll('.appearance-tab')];
    buttons.forEach(btn => btn.addEventListener('click', () => activateAppearanceTab(btn)));
    // Roving Left/Right arrow keys across the tabs (matches the sidebar tablist pattern).
    tabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const i = buttons.indexOf(document.activeElement);
        if (i < 0) return;
        const next = e.key === 'ArrowRight'
            ? (i + 1) % buttons.length
            : (i - 1 + buttons.length) % buttons.length;
        buttons[next].focus();
        activateAppearanceTab(buttons[next]);
        e.preventDefault();
    });
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

// Stage 3 — ↑/↓ delta badge vs current (good direction shows in the positive colour).
function whatIfDelta(scenarioVal, currentVal, goodIsHigher = true) {
    const diff = scenarioVal - currentVal;
    if (!isFinite(diff) || Math.abs(diff) < 0.005) return '<span class="wi-delta wi-delta-flat">no change</span>';
    const good = goodIsHigher ? diff > 0 : diff < 0;
    const arrow = diff > 0 ? '↑' : '↓';
    return `<span class="wi-delta ${good ? 'wi-delta-good' : 'wi-delta-bad'}">${arrow} ${formatCurrency(Math.abs(diff))}</span>`;
}

// What If Scenario Action
function runWhatIfScenario() {
    if (!whatIfFinanceData) initializeWhatIfTab(true); // safety — seed the sandbox if missing

    // What If redesign — the scenario IS the fully-edited sandbox clone. Everything (income
    // sources, expenses, assets, liabilities, allocation, FI) comes from whatIfFinanceData, so
    // totals derive entirely from calculateTotals() with no overrides.
    const scenarioFinanceData = whatIfFinanceData;
    const scenarioTotals = calculateTotals(scenarioFinanceData);
    const scenarioNetAnnualIncome = scenarioTotals.totalNetAnnualIncome;
    const scenarioCurrentAssets = scenarioTotals.currentAssets;

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
        const fmtYears = (y) => (y === 0 ? 'Reached' : (!isFinite(y) ? '∞' : y.toFixed(1) + ' yr'));
        const scenarioNetAnnual = scenarioTotals.totalNetAnnualIncome;

        // Stage 3 — period switcher reflows the cash-flow figures (Net Worth + FI are absolute).
        const period = whatIfViewPeriod || 'fortnightly';
        const periodLabel = { daily: 'day', weekly: 'week', fortnightly: 'fortnight', monthly: 'month', yearly: 'year' }[period];
        const incomeF = { daily: 1 / 260, weekly: 1 / 52, fortnightly: 1 / 26, monthly: 1 / 12, yearly: 1 }[period];
        const weeklyF = { daily: 1 / 5, weekly: 1, fortnightly: 2, monthly: 52 / 12, yearly: 52 }[period];
        const sInc = scenarioNetAnnual * incomeF,        cInc = currentTotals.totalNetAnnualIncome * incomeF;
        const sExp = scenarioTotals.totalWeeklyExpenses * weeklyF, cExp = currentTotals.totalWeeklyExpenses * weeklyF;
        const sSav = scenarioTotals.weeklySavings * weeklyF,      cSav = currentTotals.weeklySavings * weeklyF;
        const sEss = scenarioTotals.essentialWeeklyTotal * weeklyF,    cEss = currentTotals.essentialWeeklyTotal * weeklyF;
        const sNon = scenarioTotals.nonEssentialWeeklyTotal * weeklyF, cNon = currentTotals.nonEssentialWeeklyTotal * weeklyF;
        const periodOptions = ['daily', 'weekly', 'fortnightly', 'monthly', 'yearly']
            .map(p => `<option value="${p}" ${p === period ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('');

        const allocItems = (scenarioFinanceData.allocation || []).map(alloc => {
            const annualContribution = scenarioNetAnnual * (alloc.percentage / 100);
            let goalLine = '';
            const goal = alloc.savingsGoal || 0;
            if (goal > 0) {
                const current = alloc.currentBalance || 0;
                const remaining = goal - current;
                let t;
                if (remaining <= 0) t = 'Goal reached';
                else if (annualContribution <= 0) t = 'needs allocation';
                else t = formatTimeToGoal(remaining / annualContribution);
                const pct = Math.min(100, Math.max(0, (current / goal) * 100));
                goalLine = `<div class="savings-goal"><div class="savings-goal-bar"><div class="savings-goal-fill" style="width:${pct}%;"></div></div><div class="savings-goal-meta">${formatCurrency(current)} / ${formatCurrency(goal)} · ${t}</div></div>`;
            }
            return `<div class="savings-item"><div class="savings-label">${escapeHtml(alloc.name)} (${alloc.percentage}%)</div><div class="savings-amount">${formatCurrency(annualContribution * incomeF)}/${periodLabel}</div>${goalLine}</div>`;
        }).join('');
        const allocBlock = allocItems
            ? `<div class="card" style="margin-top: 16px;"><div class="card-title">Income Allocation Strategy</div><div class="card-subtitle">Per-${periodLabel} split of scenario net income, with goal progress</div><div class="savings-breakdown">${allocItems}</div></div>`
            : '';

        const fiDelta = yearsDifference === 'N/A'
            ? '<span class="wi-delta wi-delta-flat">vs now: N/A</span>'
            : `<span class="wi-delta ${yearsDifference < -0.05 ? 'wi-delta-good' : (yearsDifference > 0.05 ? 'wi-delta-bad' : 'wi-delta-flat')}">${yearsDifference < 0 ? '↓' : (yearsDifference > 0 ? '↑' : '')} ${Math.abs(yearsDifference).toFixed(1)} yr vs now</span>`;
        const srDelta = Math.abs(savingsRateDifference) < 0.05
            ? '<span class="wi-delta wi-delta-flat">no change</span>'
            : `<span class="wi-delta ${savingsRateDifference >= 0 ? 'wi-delta-good' : 'wi-delta-bad'}">${savingsRateDifference >= 0 ? '↑' : '↓'} ${Math.abs(savingsRateDifference).toFixed(1)}%</span>`;

        resultsDiv.innerHTML = `
            <div class="wi-results-head">
                <h3>Simulated Dashboard <span class="wi-results-sub">scenario vs your current plan</span></h3>
                <label class="wi-period-label">View period:
                    <select id="whatif-view-period">${periodOptions}</select>
                </label>
            </div>
            <div class="dashboard-grid" style="margin-top: 16px;">
                <div class="card">
                    <div class="card-title">Income</div>
                    <div class="card-subtitle">Net, after tax</div>
                    <div class="amount neutral">${formatCurrency(sInc)}<span class="wi-period-suffix"> /${periodLabel}</span></div>
                    <p class="wi-line">${whatIfDelta(sInc, cInc, true)} <span style="color: var(--text-color-secondary);">· ${formatCurrency(scenarioNetAnnual)}/yr</span></p>
                </div>
                <div class="card">
                    <div class="card-title">Outgoing vs Savings</div>
                    <div class="card-subtitle">Per ${periodLabel}</div>
                    <p class="wi-line">Expenses: <strong>${formatCurrency(sExp)}</strong> ${whatIfDelta(sExp, cExp, false)}</p>
                    <p class="wi-line">Savings: <strong>${formatCurrency(sSav)}</strong> ${whatIfDelta(sSav, cSav, true)}</p>
                    <p class="wi-line">Savings rate: <strong>${scenarioTotals.savingsRate.toFixed(1)}%</strong> ${srDelta}</p>
                </div>
                <div class="card">
                    <div class="card-title">Net Worth</div>
                    <div class="card-subtitle">Assets − Liabilities</div>
                    <div class="amount net-worth${scenarioNetWorth < 0 ? ' is-negative' : ''}">${formatCurrency(scenarioNetWorth)}</div>
                    <p class="wi-line">${whatIfDelta(scenarioNetWorth, currentNetWorth, true)}</p>
                    <p class="wi-line">Assets ${formatCurrency(scenarioCurrentAssets)} · Liabilities ${formatCurrency(scenarioLiabilities)}</p>
                </div>
                <div class="card">
                    <div class="card-title">Expense Breakdown</div>
                    <div class="card-subtitle">Essential vs Non-Essential, per ${periodLabel}</div>
                    <p class="wi-line">Essential: <strong style="color: var(--color-essential);">${formatCurrency(sEss)}</strong> ${whatIfDelta(sEss, cEss, false)}</p>
                    <p class="wi-line">Non-Essential: <strong style="color: var(--color-warning);">${formatCurrency(sNon)}</strong> ${whatIfDelta(sNon, cNon, false)}</p>
                </div>
                <div class="card">
                    <div class="card-title">Financial Independence</div>
                    <div class="card-subtitle">${scenarioFinanceData.fiSettings.multiple}× expenses @ ${scenarioFinanceData.fiSettings.expectedReturn}%</div>
                    <div class="amount">${fmtYears(scenarioYearsToFI)}</div>
                    <p class="wi-line">${fiDelta}</p>
                    <p class="wi-line">Target ${formatCurrency(scenarioFiTarget)}</p>
                </div>
            </div>
            ${allocBlock}
        `;
        fitAllAmounts(resultsDiv); // shrink any over-long scenario figure to fit its card
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