// --- START OF: events.js ---

function setupEventListeners() {
    // Tab navigation
    const tabsContainer = document.querySelector('.tabs');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('tab')) {
                const tabName = event.target.dataset.tabTarget;
                if (tabName) {
                    showTab(tabName);
                }
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

    // Settings Tab: Dynamic Lists (Income, Tax Brackets, Assets, Liabilities, Allocation, Expenses)
    const settingsContent = getElement('settings'); // Main settings tab container
    if (settingsContent) {
        settingsContent.addEventListener('click', handleSettingsClickEvents);
        settingsContent.addEventListener('change', handleSettingsChangeEvents);
    }
    
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
            el.addEventListener('input', () => { /* Could call applyGuiSettings for live preview */ });
            el.addEventListener('change', () => { /* Could call applyGuiSettings for live preview */ });
        }
    });
// --- JSON IMPORT LISTNER ---
    const jsonImportSettingsInput = getElement('json-import-settings');
    if (jsonImportSettingsInput) {
        jsonImportSettingsInput.addEventListener('change', (event) => {
            handleJSONImport(event, false); // Pass 'false' or remove if 'isGuiTabImport' isn't used
        });
    }

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
    else if (target.id === 'add-essential-expense-settings') addExpenseToList('essentialExpenses');
    else if (target.id === 'add-non-essential-expense-settings') addExpenseToList('nonEssentialExpenses');

    // Delete buttons for dynamic lists
    else if (target.classList.contains('delete-btn')) {
        if (dataType === 'incomeSource') removeIncomeSource(index);
        else if (dataType === 'taxBracket') removeTaxBracket(index);
        else if (dataType === 'asset') removeAsset(index);
        else if (dataType === 'liability') removeLiability(index);
        else if (dataType === 'allocation') removeAllocationCategory(index);
        else if (dataType === 'essentialExpense') removeExpenseFromList('essentialExpenses', index);
        else if (dataType === 'nonEssentialExpense') removeExpenseFromList('nonEssentialExpenses', index);
    }

    // Action buttons
    else if (target.id === 'save-download-html') actionSaveAndDownloadHTML();
    else if (target.id === 'set-current-default') actionSetCurrentAsDefault();
    else if (target.id === 'reset-to-defaults') actionResetToAppDefaults();
    else if (target.id === 'export-data-json') actionExportDataJSON();
    else if (target.id === 'import-data-json-btn') getElement('json-import-settings').click();

}

function handleSettingsChangeEvents(event) {
    const target = event.target;
    const index = parseInt(target.dataset.index, 10);
    const field = target.dataset.field;
    let value = target.value;

    // Handle radio button for primary income separately
    if (target.name === 'primary-income' && target.type === 'radio') {
        financeData.primaryIncomeIndex = index;
        updateDataAndUI(); // Re-render income sources to reflect primary change
        return;
    }

    if (field) { // Ensure field is defined
        // Determine which array to update
        let arrayToUpdate;
        if (target.closest('#income-sources-settings')) arrayToUpdate = financeData.incomeSources;
        else if (target.closest('#tax-brackets-settings')) arrayToUpdate = financeData.taxBrackets;
        else if (target.closest('#assets-settings')) arrayToUpdate = financeData.assets;
        else if (target.closest('#liabilities-settings')) arrayToUpdate = financeData.liabilities;
        else if (target.closest('#allocation-settings')) arrayToUpdate = financeData.allocation;
        else if (target.dataset.array === 'essentialExpenses') arrayToUpdate = financeData.essentialExpenses;
        else if (target.dataset.array === 'nonEssentialExpenses') arrayToUpdate = financeData.nonEssentialExpenses;
        else if (target.id === 'fi-multiple') { financeData.fiSettings.multiple = parseFloat(value) || 25; updateDataAndUI(); return; }
        else if (target.id === 'expected-return') { financeData.fiSettings.expectedReturn = parseFloat(value) || 7; updateDataAndUI(); return; }


        if (arrayToUpdate && arrayToUpdate[index] !== undefined) {
            // Type conversions
            if (['grossAnnual', 'balance', 'interestRate', 'percentage', 'amount', 'min', 'max', 'rate', 'hoursPerCycle', 'taxRemoved', 'invoicedPayPostTax'].includes(field)) {
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

            if (field === 'percentage' && target.closest('#allocation-settings')) {
                 updateAllocationTotalDisplay(); // Special update for allocation total
            }
            updateDataAndUI();
        }
    }
}


function handleWhatIfClickEvents(event) {
    const target = event.target;
    const dataType = target.dataset.type; // e.g., 'whatIfEssential'
    const index = parseInt(target.dataset.index, 10);

    if (target.id === 'add-whatif-essential-expense') addWhatIfExpenseItem('essential');
    else if (target.id === 'add-whatif-non-essential-expense') addWhatIfExpenseItem('nonEssential');
    else if (target.id === 'run-whatif-calculation') runWhatIfScenario();
    else if (target.classList.contains('delete-btn')) {
        if (dataType === 'whatIfEssential') removeWhatIfExpenseItem('essential', index);
        else if (dataType === 'whatIfNonEssential') removeWhatIfExpenseItem('nonEssential', index);
    }
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
    if (target.id === 'apply-gui-settings') actionApplyGuiSettings();
    else if (target.id === 'reset-gui-settings') actionResetGuiToDefaults();
    else if (target.id === 'export-json-gui') actionExportDataJSON(); // Re-use the main JSON export
    else if (target.id === 'import-json-gui-btn') getElement('json-import-gui').click();
}

// --- Action Functions (called by event handlers) ---

// Add/Remove for main settings
function addIncomeSource() {
    financeData.incomeSources.push({ name: "New Income", grossAnnual: 0, paySchedule: "monthly", hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null });
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

function addAsset() {
    financeData.assets.push({ name: "New Asset", balance: 0 });
    renderAssetsSettings();
    updateDataAndUI();
}
function removeAsset(index) {
    financeData.assets.splice(index, 1);
    renderAssetsSettings();
    updateDataAndUI();
}

function addLiability() {
    financeData.liabilities.push({ name: "New Liability", balance: 0, interestRate: 0 });
    renderLiabilitiesSettings();
    updateDataAndUI();
}
function removeLiability(index) {
    financeData.liabilities.splice(index, 1);
    renderLiabilitiesSettings();
    updateDataAndUI();
}

function addAllocationCategory() {
    financeData.allocation.push({ name: "New Category", percentage: 0 });
    renderAllocationSettings();
    updateDataAndUI();
}
function removeAllocationCategory(index) {
    financeData.allocation.splice(index, 1);
    renderAllocationSettings();
    updateDataAndUI();
}

function addExpenseToList(arrayName) { // arrayName is 'essentialExpenses' or 'nonEssentialExpenses'
    financeData[arrayName].push({ name: "New Expense", amount: 0, frequency: "monthly" });
    renderExpensesSettingsLists();
    updateDataAndUI();
}
function removeExpenseFromList(arrayName, index) {
    financeData[arrayName].splice(index, 1);
    renderExpensesSettingsLists();
    updateDataAndUI();
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
function actionSaveAndDownloadHTML() {
    // Gather current settings from inputs first, in case they haven't triggered 'change'
    updateFinanceDataFromFISettingsInputs();

    const currentFinanceDataString = `let financeData = ${JSON.stringify(financeData, null, 4)};`;
    const currentDefaultFinanceDataString = `let defaultFinanceData = ${JSON.stringify(defaultFinanceData, null, 4)};`;
    const currentGuiSettingsString = `let guiSettingsData = ${JSON.stringify(guiSettingsData, null, 4)};`;
    const currentDefaultGuiSettingsString = `let defaultGuiSettings = ${JSON.stringify(defaultGuiSettings, null, 4)};`;

    let htmlContent = document.documentElement.outerHTML;

    // Replace financeData
    htmlContent = htmlContent.replace(/let financeData = \{[\s\S]*?};/, currentFinanceDataString);
    // Replace defaultFinanceData
    htmlContent = htmlContent.replace(/let defaultFinanceData = \{[\s\S]*?};/, currentDefaultFinanceDataString);
    // Replace guiSettingsData
    htmlContent = htmlContent.replace(/let guiSettingsData = \{[\s\S]*?};/, currentGuiSettingsString);
    // Replace defaultGuiSettings
    htmlContent = htmlContent.replace(/let defaultGuiSettings = \{[\s\S]*?};/, currentDefaultGuiSettingsString);


    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
    link.download = `finance-tracker-backup-${timestamp}.html`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    showCustomModal("HTML Backup Saved!");
}

function updateFinanceDataFromFISettingsInputs() {
    financeData.fiSettings.multiple = parseFloat(getValue('fi-multiple')) || 25;
    financeData.fiSettings.expectedReturn = parseFloat(getValue('expected-return')) || 7;
}


function actionSetCurrentAsDefault() {
    if (confirmAction('Set current finance settings as the new default? This will be used when you reset.')) {
        updateFinanceDataFromFISettingsInputs(); // Ensure FI settings are captured from inputs
        defaultFinanceData = JSON.parse(JSON.stringify(financeData));
        showCustomModal('Current settings set as default.');
        if(autoSave) autoSave.forceSave(); // Save this change if defaults are part of the main save bundle (they are not currently)
    }
}

function actionResetToAppDefaults() {
    if (confirmAction('Reset all finance data to the application defaults? All your current data will be lost.')) {
        financeData = JSON.parse(JSON.stringify(defaultFinanceData));
        initializeSettingsUI(); // Re-render all settings inputs
        updateDataAndUI(); // Update all displays and save
        showCustomModal('Reset to defaults complete!');
    }
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

function handleJSONImport(event, isGuiTabImport = false) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedBundle = JSON.parse(e.target.result);
            if (importedBundle.financeData && importedBundle.guiSettings) {
                 if (confirmAction('Importing this file will replace ALL current data (financial and GUI). Are you sure?')) {
                    financeData = importedBundle.financeData;
                    guiSettingsData = importedBundle.guiSettings;

                    initializeSettingsUI(); // Re-render settings inputs
                    initializeGuiSettingsForm(); // Re-render GUI settings inputs and apply styles
                    updateDataAndUI(); // Update all displays and save

                    showCustomModal('Data imported successfully! Please review all tabs.');
                    // Optionally, switch to a relevant tab, e.g., dashboard
                    showTab('dashboard');
                }
            } else {
                showCustomModal('Invalid backup file format. Must contain financeData and guiSettings.', 'error');
            }
        } catch (error) {
            showCustomModal('Failed to import backup file. It might be corrupted.', 'error');
            console.error("Import error:", error);
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset file input
}


// GUI Settings Actions
function actionApplyGuiSettings() {
    guiSettingsData.primaryBgStart = getValue('gui-primary-bg-start');
    guiSettingsData.primaryBgEnd = getValue('gui-primary-bg-end');
    guiSettingsData.headerTextColor = getValue('gui-header-text-color');
    guiSettingsData.cardBgStart = getValue('gui-card-bg-start');
    guiSettingsData.cardBgEnd = getValue('gui-card-bg-end');
    guiSettingsData.accentColor = getValue('gui-accent-color');
    guiSettingsData.fontFamily = getValue('gui-font-family');
    guiSettingsData.baseFontSize = getValue('gui-base-font-size');
    guiSettingsData.mainHeading = getValue('gui-main-heading');
    guiSettingsData.subHeading = getValue('gui-sub-heading');

    applyGuiStylesToPage();
    if (autoSave) autoSave.onDataChange(); // Save GUI changes
    showCustomModal('GUI Settings Applied!');
}

function actionResetGuiToDefaults() {
    if (confirmAction('Reset GUI settings to application defaults?')) {
        guiSettingsData = JSON.parse(JSON.stringify(defaultGuiSettings));
        initializeGuiSettingsForm(); // This also calls applyGuiStylesToPage
        if (autoSave) autoSave.onDataChange();
        showCustomModal('GUI Settings reset.');
    }
}

// What If Scenario Action
function runWhatIfScenario() {
    const newAnnualNetIncomeInput = getValue('whatif-new-annual-income', true);
    const assetsChange = getValue('whatif-assets-change', true);
    const newExpectedReturn = getValue('whatif-return-change', true);

    if (isNaN(newAnnualNetIncomeInput) || newAnnualNetIncomeInput < 0) {
        showCustomModal("Please enter a valid new annual net income for the scenario.", 'error');
        return;
    }

    // Create a deep copy of the current financeData for scenario planning
    let scenarioFinanceData = JSON.parse(JSON.stringify(financeData));

    // Adjust income for the scenario
    // This is a simplified adjustment; a more robust approach might scale individual sources
    // or require more detailed input for how the income changes.
    // For now, we'll assume the change applies proportionally or is a new total net.
    const currentTotalsForRatio = calculateTotals(financeData);
    if (currentTotalsForRatio.totalNetAnnualIncome > 0) {
        const incomeMultiplier = newAnnualNetIncomeInput / currentTotalsForRatio.totalNetAnnualIncome;
        scenarioFinanceData.incomeSources.forEach(source => {
            source.grossAnnual = (source.grossAnnual || 0) * incomeMultiplier;
            // If taxRemoved or invoicedPayPostTax were set, they should also be scaled
            // or the tax calculation logic re-run for the new gross.
            // For simplicity here, we are primarily affecting the gross and letting calculateTotals re-evaluate net.
            // This means the tax logic in calculateTotals will apply to the new gross.
            // If specific net or tax amounts were part of the scenario, this would need more detail.
        });
    } else if (newAnnualNetIncomeInput > 0 && scenarioFinanceData.incomeSources.length > 0) {
        // If current net is 0, distribute new income to the first source's gross for simplicity
        scenarioFinanceData.incomeSources[0].grossAnnual = newAnnualNetIncomeInput; // This is a rough approximation
        // A proper tax calculation would be needed to get from this new gross to a net.
        // For now, we'll assume the input IS the new net, and calculateTotals will work from that.
        // This part is tricky without knowing how tax is structured for the new income.
        // Let's assume the input 'newAnnualNetIncomeInput' IS the target net income for the scenario.
        // And calculateTotals will use this to derive savings etc.
        // So, we need to adjust scenarioFinanceData so calculateTotals() yields this net income.
        // This is complex. For now, let's use the input directly as the scenario's net income.
    }


    // Use the temporary what-if expenses
    scenarioFinanceData.essentialExpenses = JSON.parse(JSON.stringify(whatIfEssentialExpenses));
    scenarioFinanceData.nonEssentialExpenses = JSON.parse(JSON.stringify(whatIfNonEssentialExpenses));

    // Apply new expected return for FI calculation in scenario
    scenarioFinanceData.fiSettings.expectedReturn = isNaN(newExpectedReturn) ? financeData.fiSettings.expectedReturn : newExpectedReturn;

    // Calculate totals for the scenario
    // We need calculateTotals to reflect the newAnnualNetIncomeInput as the net income.
    // This is where it gets a bit circular if calculateTotals derives net from gross.
    // Let's make a temporary override for the scenario's net income for this calculation.
    const scenarioTotals = calculateTotals(scenarioFinanceData);
    // If newAnnualNetIncomeInput was meant to be the *net* income for the scenario:
    const scenarioNetAnnualIncome = newAnnualNetIncomeInput;
    scenarioTotals.totalNetAnnualIncome = scenarioNetAnnualIncome; // Override
    scenarioTotals.weeklySavings = (scenarioNetAnnualIncome / 52) - scenarioTotals.totalWeeklyExpenses;
    scenarioTotals.annualSavings = scenarioTotals.weeklySavings * 52;
    scenarioTotals.savingsRate = scenarioNetAnnualIncome > 0 ? (scenarioTotals.annualSavings / scenarioNetAnnualIncome) * 100 : 0;


    // Adjust assets for the scenario
    let scenarioCurrentAssets = calculateTotals(financeData).currentAssets + assetsChange;
    scenarioTotals.currentAssets = scenarioCurrentAssets; // Update scenario totals with asset change

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

    const resultsDiv = getElement('whatif-results-display');
    if (resultsDiv) {
        resultsDiv.innerHTML = `
            <h3>Scenario Results vs Current Situation</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0;">
                <div style="background: #f0f8ff; padding: 15px; border-radius: 8px;">
                    <h4 style="color: #1976d2; margin-bottom: 10px;">💰 Net Income (Annual)</h4>
                    <p><strong>Scenario:</strong> ${formatCurrency(scenarioNetAnnualIncome)}</p>
                    <p><strong>Current:</strong> ${formatCurrency(currentTotals.totalNetAnnualIncome)}</p>
                    <p style="color: ${scenarioNetAnnualIncome >= currentTotals.totalNetAnnualIncome ? '#4CAF50' : '#f44336'};">
                        <strong>Change:</strong> ${scenarioNetAnnualIncome >= currentTotals.totalNetAnnualIncome ? '+' : ''}${formatCurrency(scenarioNetAnnualIncome - currentTotals.totalNetAnnualIncome)}
                    </p>
                </div>
                <div style="background: #fff3e0; padding: 15px; border-radius: 8px;">
                    <h4 style="color: #f57c00; margin-bottom: 10px;">💸 Expenses (Annual)</h4>
                    <p><strong>Scenario:</strong> ${formatCurrency(scenarioAnnualExpenses)}</p>
                    <p><strong>Current:</strong> ${formatCurrency(currentAnnualExpenses)}</p>
                    <p style="color: ${scenarioAnnualExpenses <= currentAnnualExpenses ? '#4CAF50' : '#f44336'};">
                        <strong>Change:</strong> ${scenarioAnnualExpenses <= currentAnnualExpenses ? '' : '+'}${formatCurrency(scenarioAnnualExpenses - currentAnnualExpenses)}
                    </p>
                </div>
                <div style="background: #e8f5e8; padding: 15px; border-radius: 8px;">
                    <h4 style="color: #4CAF50; margin-bottom: 10px;">📈 Savings (Annual)</h4>
                    <p><strong>Scenario:</strong> ${formatCurrency(scenarioTotals.annualSavings)}</p>
                    <p><strong>Current:</strong> ${formatCurrency(currentTotals.annualSavings)}</p>
                    <p style="color: ${scenarioTotals.annualSavings >= currentTotals.annualSavings ? '#4CAF50' : '#f44336'};">
                        <strong>Change:</strong> ${scenarioTotals.annualSavings >= currentTotals.annualSavings ? '+' : ''}${formatCurrency(scenarioTotals.annualSavings - currentTotals.annualSavings)}
                    </p>
                </div>
                <div style="background: #fce4ec; padding: 15px; border-radius: 8px;">
                    <h4 style="color: #c2185b; margin-bottom: 10px;">🎯 FI Timeline (Years)</h4>
                    <p><strong>Scenario:</strong> ${typeof scenarioYearsToFI === 'number' ? scenarioYearsToFI.toFixed(1) : '∞'}</p>
                    <p><strong>Current:</strong> ${typeof currentYearsToFI === 'number' ? currentYearsToFI.toFixed(1) : '∞'}</p>
                    <p style="color: ${yearsDifference !== 'N/A' && yearsDifference < 0 ? '#4CAF50' : (yearsDifference !== 'N/A' && yearsDifference > 0 ? '#f44336' : '#666')};">
                        <strong>Difference:</strong> ${yearsDifference !== 'N/A' ? (yearsDifference > 0 ? '+' : '') + yearsDifference.toFixed(1) : 'N/A'} years
                    </p>
                </div>
            </div>
            <div style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px;">
                <h4>📊 Key Metrics (Scenario)</h4>
                <p><strong>Savings Rate:</strong> ${scenarioTotals.savingsRate.toFixed(1)}% (Current: ${currentTotals.savingsRate.toFixed(1)}%, Change: ${savingsRateDifference > 0 ? '+' : ''}${savingsRateDifference.toFixed(1)}%)</p>
                <p><strong>FI Target Amount:</strong> ${formatCurrency(scenarioFiTarget)}</p>
                <p><strong>Assets After Change:</strong> ${formatCurrency(scenarioCurrentAssets)}</p>
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


// --- END OF: events.js ---