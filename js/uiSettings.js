// --- START OF: uiSettings.js ---

function initializeSettingsUI() {
    setValue('currency-select', financeData.currency);
    setValue('dashboard-view-period', financeData.dashboardViewPeriod || 'fortnightly');

    renderIncomeSourcesSettings();
    renderTaxBracketsSettings();
    renderAssetsSettings();
    renderLiabilitiesSettings();
    renderAllocationSettings();
    renderExpensesSettingsLists(); // Combined essential and non-essential
    renderFISettings();
    updateDefaultsButtonLabels(); // Reflect whether user defaults exist
    initializeGuiSettingsForm(); // For the GUI Settings tab
    initializeWhatIfTab(); // For the What If? tab
}

function renderIncomeSourcesSettings() {
    const container = getElement('income-sources-settings');
    if (!container) return;
    container.innerHTML = '';
    financeData.incomeSources.forEach((source, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '0.4fr 0.9fr 1.2fr 0.8fr 0.8fr 1fr 0.6fr 0.8fr 0.5fr';
        const isPrimary = index === financeData.primaryIncomeIndex;
        const isSelfEmployed = source.incomeType === 'selfEmployed';
        const invoicedPayValue = source.invoicedPayPostTax === null || source.invoicedPayPostTax === undefined ? '' : source.invoicedPayPostTax;
        const taxRemovedValue = source.taxRemoved === null || source.taxRemoved === undefined ? '' : source.taxRemoved;
        const baseId = `income-${index}`;

        // Salaried: gross is entered, tax/net derived from brackets (those fields disabled).
        // Self-employed: net (+ optional tax) per cycle is entered, gross back-calculated (gross disabled).
        const grossDisabled = isSelfEmployed ? 'disabled' : '';
        const netTaxDisabled = isSelfEmployed ? '' : 'disabled';
        const autoNote = '— auto —';

        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-primary" class="visually-hidden">Set as Primary Income Source ${index + 1}</label>
                <input type="radio" name="primary-income" ${isPrimary ? 'checked' : ''} data-index="${index}" id="${baseId}-primary" style="justify-self: center;">
            </span>
            <span>
                <label for="${baseId}-type" class="visually-hidden">Income Type ${index + 1}</label>
                <select data-index="${index}" data-field="incomeType" id="${baseId}-type" name="${baseId}-type">
                    <option value="salaried" ${!isSelfEmployed ? 'selected' : ''}>Salaried</option>
                    <option value="selfEmployed" ${isSelfEmployed ? 'selected' : ''}>Self-employed</option>
                </select>
            </span>
            <span>
                <label for="${baseId}-name" class="visually-hidden">Income Source Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(source.name || '')}" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Name">
            </span>
            <span>
                <label for="${baseId}-gross" class="visually-hidden">Gross Annual Income ${index + 1}</label>
                <input type="number" value="${source.grossAnnual || 0}" data-index="${index}" data-field="grossAnnual" id="${baseId}-gross" name="${baseId}-gross" placeholder="${isSelfEmployed ? autoNote : 'Gross Annual'}" step="0.01" ${grossDisabled}>
            </span>
            <span>
                <label for="${baseId}-schedule" class="visually-hidden">Pay Schedule ${index + 1}</label>
                <select data-index="${index}" data-field="paySchedule" id="${baseId}-schedule" name="${baseId}-schedule">
                    <option value="weekly" ${source.paySchedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="fortnightly" ${source.paySchedule === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                    <option value="monthly" ${source.paySchedule === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${source.paySchedule === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select>
            </span>
            <span>
                <label for="${baseId}-netpay" class="visually-hidden">Net Pay Per Cycle ${index + 1}</label>
                <input type="number" value="${invoicedPayValue}" data-index="${index}" data-field="invoicedPayPostTax" id="${baseId}-netpay" name="${baseId}-netpay" placeholder="${isSelfEmployed ? 'Net Pay/Cycle' : autoNote}" step="0.01" ${netTaxDisabled}>
            </span>
            <span>
                 <label for="${baseId}-hours" class="visually-hidden">Hours Per Cycle ${index + 1}</label>
                 <input type="number" value="${source.hoursPerCycle || ''}" data-index="${index}" data-field="hoursPerCycle" id="${baseId}-hours" name="${baseId}-hours" placeholder="Hours" step="1">
            </span>
            <span>
                <label for="${baseId}-taxremoved" class="visually-hidden">Tax Removed Per Cycle ${index + 1}</label>
                <input type="number" value="${taxRemovedValue}" data-index="${index}" data-field="taxRemoved" id="${baseId}-taxremoved" name="${baseId}-taxremoved" placeholder="${isSelfEmployed ? 'Tax/Cycle (opt)' : autoNote}" step="0.01" ${netTaxDisabled}>
            </span>
            <button class="delete-btn" data-index="${index}" data-type="incomeSource" aria-label="Delete Income Source ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

function renderTaxBracketsSettings() {
    const container = getElement('tax-brackets-settings');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(financeData.taxBrackets)) financeData.taxBrackets = [];
    const sortedBrackets = [...financeData.taxBrackets].sort((a, b) => a.min - b.min);
    financeData.taxBrackets = sortedBrackets;

    financeData.taxBrackets.forEach((bracket, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tax-bracket-item'; // Use existing class for styling
        const baseId = `tax-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-min" class="visually-hidden">Min Income Bracket ${index + 1}</label>
                <input type="number" value="${bracket.min}" data-index="${index}" data-field="min" id="${baseId}-min" name="${baseId}-min" placeholder="Min income" step="0.01">
            </span>
            <span>
                <label for="${baseId}-max" class="visually-hidden">Max Income Bracket ${index + 1}</label>
                <input type="number" value="${bracket.max === Infinity ? '' : bracket.max}" data-index="${index}" data-field="max" id="${baseId}-max" name="${baseId}-max" placeholder="Max (empty=infinity)" step="0.01">
            </span>
            <span>
                <label for="${baseId}-rate" class="visually-hidden">Tax Rate Bracket ${index + 1}</label>
                <input type="number" value="${(bracket.rate * 100).toFixed(2)}" data-index="${index}" data-field="rate" id="${baseId}-rate" name="${baseId}-rate" placeholder="Rate %" step="0.01">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="taxBracket" aria-label="Delete Tax Bracket ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

function renderAssetsSettings() {
    const container = getElement('assets-settings');
    if (!container) return;
    container.innerHTML = '';
    financeData.assets.forEach((asset, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1.5fr auto';
        const baseId = `asset-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Asset Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(asset.name)}" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Asset name">
            </span>
            <span>
                <label for="${baseId}-balance" class="visually-hidden">Asset Balance ${index + 1}</label>
                <input type="number" value="${asset.balance}" data-index="${index}" data-field="balance" id="${baseId}-balance" name="${baseId}-balance" placeholder="Balance" step="0.01">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="asset" aria-label="Delete Asset ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

function renderLiabilitiesSettings() {
    const container = getElement('liabilities-settings');
    if (!container) return;
    container.innerHTML = '';
    financeData.liabilities.forEach((liability, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1.5fr 1fr auto';
        const baseId = `liability-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Liability Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(liability.name)}" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Liability name">
            </span>
            <span>
                <label for="${baseId}-balance" class="visually-hidden">Liability Balance ${index + 1}</label>
                <input type="number" value="${liability.balance}" data-index="${index}" data-field="balance" id="${baseId}-balance" name="${baseId}-balance" placeholder="Balance" step="0.01">
            </span>
            <span>
                <label for="${baseId}-rate" class="visually-hidden">Liability Interest Rate ${index + 1}</label>
                <input type="number" value="${liability.interestRate || 0}" data-index="${index}" data-field="interestRate" id="${baseId}-rate" name="${baseId}-rate" placeholder="Interest %" step="0.01">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="liability" aria-label="Delete Liability ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
    const totals = calculateTotals();
    setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
}

function renderAllocationSettings() {
    const container = getElement('allocation-settings');
    if (!container) return;
    container.innerHTML = '';
    financeData.allocation.forEach((alloc, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1fr auto';
        const baseId = `alloc-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Allocation Category Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(alloc.name)}" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Category Name">
            </span>
            <span>
                <label for="${baseId}-percentage" class="visually-hidden">Allocation Percentage ${index + 1}</label>
                <input type="number" value="${alloc.percentage}" data-index="${index}" data-field="percentage" id="${baseId}-percentage" name="${baseId}-percentage" placeholder="%" step="0.1" min="0">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="allocation" aria-label="Delete Allocation Category ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
    updateAllocationTotalDisplay();
}

function updateAllocationTotalDisplay() {
    const total = financeData.allocation.reduce((sum, alloc) => sum + (parseFloat(alloc.percentage) || 0), 0);
    const totalSpan = getElement('total-percent');
    if (totalSpan) {
        totalSpan.textContent = `${total.toFixed(1)}%`;
        totalSpan.style.color = Math.abs(total - 100) < 0.11
            ? 'var(--color-positive)'
            : 'var(--color-negative)';
    }
}

function renderExpensesSettingsLists() {
    const renderList = (listId, expensesArrayName, expenseType) => {
        const container = getElement(listId);
        if (!container) return;
        container.innerHTML = '';
        financeData[expensesArrayName].forEach((expense, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'list-item';
            itemDiv.style.gridTemplateColumns = '2fr 1fr 1fr auto';
            const baseId = `${expenseType}-${index}`;
            const typeLabel = expenseType === 'essentialExpense' ? 'Essential' : 'Non-Essential';
            itemDiv.innerHTML = `
                <span>
                    <label for="${baseId}-name" class="visually-hidden">${typeLabel} Expense Name ${index + 1}</label>
                    <input type="text" value="${escapeHtml(expense.name)}" data-index="${index}" data-field="name" data-array="${expensesArrayName}" id="${baseId}-name" name="${baseId}-name" placeholder="Name">
                </span>
                <span>
                    <label for="${baseId}-amount" class="visually-hidden">${typeLabel} Expense Amount ${index + 1}</label>
                    <input type="number" value="${expense.amount}" data-index="${index}" data-field="amount" data-array="${expensesArrayName}" id="${baseId}-amount" name="${baseId}-amount" placeholder="Amount" step="0.01">
                </span>
                <span>
                    <label for="${baseId}-frequency" class="visually-hidden">${typeLabel} Expense Frequency ${index + 1}</label>
                    <select data-index="${index}" data-field="frequency" data-array="${expensesArrayName}" id="${baseId}-frequency" name="${baseId}-frequency">
                        <option value="weekly" ${expense.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                        <option value="fortnightly" ${expense.frequency === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                        <option value="monthly" ${expense.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                        <option value="yearly" ${expense.frequency === 'yearly' ? 'selected' : ''}>Yearly</option>
                    </select>
                </span>
                <button class="delete-btn" data-index="${index}" data-type="${expenseType}" aria-label="Delete ${typeLabel} Expense ${index + 1}">Delete</button>`;
            container.appendChild(itemDiv);
        });
    };
    renderList('essential-expenses-settings-list', 'essentialExpenses', 'essentialExpense');
    renderList('non-essential-expenses-settings-list', 'nonEssentialExpenses', 'nonEssentialExpense');
}

function renderFISettings() {
    setValue('fi-multiple', financeData.fiSettings.multiple);
    setValue('expected-return', financeData.fiSettings.expectedReturn);
}

function initializeGuiSettingsForm() {
    renderThemeSwitcher(document.getElementById('theme-switcher-container'));
    setValue('gui-primary-bg-start', guiSettingsData.primaryBgStart);
    setValue('gui-primary-bg-end', guiSettingsData.primaryBgEnd);
    setValue('gui-header-text-color', guiSettingsData.headerTextColor);
    setValue('gui-card-bg-start', guiSettingsData.cardBgStart);
    setValue('gui-card-bg-end', guiSettingsData.cardBgEnd);
    setValue('gui-accent-color', guiSettingsData.accentColor);
    setValue('gui-font-family', guiSettingsData.fontFamily);
    setValue('gui-base-font-size', guiSettingsData.baseFontSize);
    setValue('gui-main-heading', guiSettingsData.mainHeading);
    setValue('gui-sub-heading', guiSettingsData.subHeading);
    applyGuiStylesToPage();
}

function applyGuiStylesToPage() {
    const root = document.documentElement;
    const pickerVars = {
        '--primary-bg-color-start': guiSettingsData.primaryBgStart,
        '--primary-bg-color-end':   guiSettingsData.primaryBgEnd,
        '--header-text-color':      guiSettingsData.headerTextColor,
        '--card-bg-gradient-start': guiSettingsData.cardBgStart,
        '--card-bg-gradient-end':   guiSettingsData.cardBgEnd,
        '--accent-color':           guiSettingsData.accentColor,
        '--color-positive':         guiSettingsData.colorPositive || '#4CAF50',
        '--color-negative':         guiSettingsData.colorNegative || '#f44336',
        '--color-neutral':          guiSettingsData.colorNeutral  || '#2196F3',
    };
    for (const [k, v] of Object.entries(pickerVars)) root.style.setProperty(k, v);
    root.style.setProperty('--font-family-main', guiSettingsData.fontFamily);
    root.style.setProperty('--base-font-size', guiSettingsData.baseFontSize + 'px');

    setText('main-heading-display', guiSettingsData.mainHeading);
    setText('sub-heading-display', guiSettingsData.subHeading);

    // Merge picker-based values into the FOUC cache so the bg is correct on next load
    try {
        const fouc = JSON.parse(localStorage.getItem('ft-theme-fouc') || '{}');
        Object.assign(fouc, pickerVars);
        localStorage.setItem('ft-theme-fouc', JSON.stringify(fouc));
    } catch (_) {}
}

// Phase 0.4: Seed the What If tab from live data ONLY on first show (or when the user
// explicitly clicks "Reset to current", which passes force=true). On ordinary tab switches
// this is a no-op so in-progress scenario edits survive.
function initializeWhatIfTab(force = false) {
    if (whatIfInitialized && !force) return;

    whatIfEssentialExpenses = JSON.parse(JSON.stringify(financeData.essentialExpenses));
    whatIfNonEssentialExpenses = JSON.parse(JSON.stringify(financeData.nonEssentialExpenses));

    renderWhatIfExpenseSettingsList('whatif-essential-expenses-settings', whatIfEssentialExpenses, 'whatIfEssential');
    renderWhatIfExpenseSettingsList('whatif-non-essential-expenses-settings', whatIfNonEssentialExpenses, 'whatIfNonEssential');

    const currentTotals = calculateTotals();
    setValue('whatif-new-annual-income', currentTotals.totalNetAnnualIncome.toFixed(0));
    setValue('whatif-assets-change', 0);
    setValue('whatif-return-change', financeData.fiSettings.expectedReturn);
    setHTML('whatif-results-display', '<h3>Scenario Results</h3><p>Your "What If" results will appear here after calculation.</p>');

    whatIfInitialized = true;
}

function renderWhatIfExpenseSettingsList(containerId, expensesArray, typePrefix) {
    const container = getElement(containerId);
    if (!container) return;
    container.innerHTML = '';
    expensesArray.forEach((expense, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1fr 1fr auto';
        const baseId = `whatif-${typePrefix}-${index}`;
        const typeLabel = typePrefix === 'whatIfEssential' ? 'Test Essential' : 'Test Non-Essential';
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">${typeLabel} Expense Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(expense.name)}" data-index="${index}" data-field="name" data-array-prefix="${typePrefix}" id="${baseId}-name" name="${baseId}-name" placeholder="Name">
            </span>
            <span>
                <label for="${baseId}-amount" class="visually-hidden">${typeLabel} Expense Amount ${index + 1}</label>
                <input type="number" value="${expense.amount}" data-index="${index}" data-field="amount" data-array-prefix="${typePrefix}" id="${baseId}-amount" name="${baseId}-amount" placeholder="Amount" step="0.01">
            </span>
            <span>
                <label for="${baseId}-frequency" class="visually-hidden">${typeLabel} Expense Frequency ${index + 1}</label>
                <select data-index="${index}" data-field="frequency" data-array-prefix="${typePrefix}" id="${baseId}-frequency" name="${baseId}-frequency">
                    <option value="weekly" ${expense.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="fortnightly" ${expense.frequency === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                    <option value="monthly" ${expense.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${expense.frequency === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select>
            </span>
            <button class="delete-btn" data-index="${index}" data-type="${typePrefix}" aria-label="Delete ${typeLabel} Expense ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

// --- END OF: uiSettings.js ---