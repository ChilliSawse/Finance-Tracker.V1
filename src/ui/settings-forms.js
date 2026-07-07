// Live-data settings form renderers (moved from uiSettings.js).
// The What If scenario renderers live in ui/whatif.js; the appearance form
// (initializeGuiSettingsForm / applyGuiStylesToPage) lives in theme/appearance.js.

import { store } from '../state/store.js';
import { getElement, setText, setValue, escapeHtml, formatCurrency } from '../utils.js';
import { calculateTotals } from '../calc/calculations.js';
import { updateDefaultsButtonLabels } from '../events/settings-events.js';
import { initializeGuiSettingsForm } from '../theme/appearance.js';
import { initializeWhatIfTab } from './whatif.js';

export function initializeSettingsUI() {
    setValue('currency-select', store.financeData.currency);
    setValue('dashboard-view-period', store.financeData.dashboardViewPeriod || 'fortnightly');

    renderIncomeSourcesSettings();
    renderTaxBracketsSettings();
    renderAssetsSettings();
    renderLiabilitiesSettings();
    renderAllocationSettings();
    renderExpensesSettingsLists(); // Combined essential and non-essential
    renderFISettings();
    updateDefaultsButtonLabels(); // Reflect whether user defaults exist
    initializeGuiSettingsForm(); // Appearance modal form
    initializeWhatIfTab(); // What If? tab
}

export function renderIncomeSourcesSettings() {
    const container = getElement('income-sources-settings');
    if (!container) return;
    container.innerHTML = '';
    store.financeData.incomeSources.forEach((source, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '0.4fr 0.9fr 1.2fr 0.8fr 0.8fr 1fr 0.6fr 0.8fr 0.5fr';
        const isPrimary = index === store.financeData.primaryIncomeIndex;
        const isSelfEmployed = source.incomeType === 'selfEmployed';
        const invoicedPayValue = source.invoicedPayPostTax === null || source.invoicedPayPostTax === undefined ? '' : source.invoicedPayPostTax;
        const taxRemovedValue = source.taxRemoved === null || source.taxRemoved === undefined ? '' : source.taxRemoved;
        const baseId = `income-${index}`;

        // Salaried: gross is entered; net/tax per cycle are OPTIONAL overrides (from a payslip) —
        //   when filled they take precedence over the bracket estimate, otherwise tax is estimated.
        // Self-employed: net (+ optional tax) per cycle is entered, gross back-calculated (gross disabled).
        const grossDisabled = isSelfEmployed ? 'disabled' : '';
        const autoNote = '— auto —';
        const netPlaceholder = isSelfEmployed ? 'Net Pay/Cycle' : 'Net/Cycle (opt)';
        const taxPlaceholder = 'Tax/Cycle (opt)';

        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-primary" class="visually-hidden">Set as Primary Income Source ${index + 1}</label>
                <input type="radio" name="primary-income" ${isPrimary ? 'checked' : ''} data-index="${index}" id="${baseId}-primary" style="justify-self: center;">
            </span>
            <span>
                <label for="${baseId}-type" class="visually-hidden">Income Type ${index + 1}</label>
                <select data-collection="incomeSources" data-index="${index}" data-field="incomeType" id="${baseId}-type" name="${baseId}-type">
                    <option value="salaried" ${!isSelfEmployed ? 'selected' : ''}>Salaried</option>
                    <option value="selfEmployed" ${isSelfEmployed ? 'selected' : ''}>Self-employed</option>
                </select>
            </span>
            <span>
                <label for="${baseId}-name" class="visually-hidden">Income Source Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(source.name || '')}" data-collection="incomeSources" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Name">
            </span>
            <span>
                <label for="${baseId}-gross" class="visually-hidden">Gross Annual Income ${index + 1}</label>
                <input type="number" value="${source.grossAnnual || 0}" data-collection="incomeSources" data-index="${index}" data-field="grossAnnual" id="${baseId}-gross" name="${baseId}-gross" placeholder="${isSelfEmployed ? autoNote : 'Gross Annual'}" step="0.01" ${grossDisabled}>
            </span>
            <span>
                <label for="${baseId}-schedule" class="visually-hidden">Pay Schedule ${index + 1}</label>
                <select data-collection="incomeSources" data-index="${index}" data-field="paySchedule" id="${baseId}-schedule" name="${baseId}-schedule">
                    <option value="weekly" ${source.paySchedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="fortnightly" ${source.paySchedule === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                    <option value="monthly" ${source.paySchedule === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${source.paySchedule === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select>
            </span>
            <span>
                <label for="${baseId}-netpay" class="visually-hidden">Net Pay Per Cycle ${index + 1}</label>
                <input type="number" value="${invoicedPayValue}" data-collection="incomeSources" data-index="${index}" data-field="invoicedPayPostTax" id="${baseId}-netpay" name="${baseId}-netpay" placeholder="${netPlaceholder}" step="0.01">
            </span>
            <span>
                 <label for="${baseId}-hours" class="visually-hidden">Hours Per Cycle ${index + 1}</label>
                 <input type="number" value="${source.hoursPerCycle || ''}" data-collection="incomeSources" data-index="${index}" data-field="hoursPerCycle" id="${baseId}-hours" name="${baseId}-hours" placeholder="Hours" step="1">
            </span>
            <span>
                <label for="${baseId}-taxremoved" class="visually-hidden">Tax Removed Per Cycle ${index + 1}</label>
                <input type="number" value="${taxRemovedValue}" data-collection="incomeSources" data-index="${index}" data-field="taxRemoved" id="${baseId}-taxremoved" name="${baseId}-taxremoved" placeholder="${taxPlaceholder}" step="0.01">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="incomeSource" aria-label="Delete Income Source ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

export function renderTaxBracketsSettings() {
    const container = getElement('tax-brackets-settings');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(store.financeData.taxBrackets)) store.financeData.taxBrackets = [];
    const sortedBrackets = [...store.financeData.taxBrackets].sort((a, b) => a.min - b.min);
    store.financeData.taxBrackets = sortedBrackets;

    store.financeData.taxBrackets.forEach((bracket, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tax-bracket-item';
        const baseId = `tax-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-min" class="visually-hidden">Min Income Bracket ${index + 1}</label>
                <input type="number" value="${bracket.min}" data-collection="taxBrackets" data-index="${index}" data-field="min" id="${baseId}-min" name="${baseId}-min" placeholder="Min income" step="0.01">
            </span>
            <span>
                <label for="${baseId}-max" class="visually-hidden">Max Income Bracket ${index + 1}</label>
                <input type="number" value="${bracket.max === Infinity ? '' : bracket.max}" data-collection="taxBrackets" data-index="${index}" data-field="max" id="${baseId}-max" name="${baseId}-max" placeholder="Max (empty=infinity)" step="0.01">
            </span>
            <span>
                <label for="${baseId}-rate" class="visually-hidden">Tax Rate Bracket ${index + 1}</label>
                <input type="number" value="${(bracket.rate * 100).toFixed(2)}" data-collection="taxBrackets" data-index="${index}" data-field="rate" id="${baseId}-rate" name="${baseId}-rate" placeholder="Rate %" step="0.01">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="taxBracket" aria-label="Delete Tax Bracket ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

export function renderAssetsSettings() {
    const container = getElement('assets-settings');
    if (!container) return;
    container.innerHTML = '';
    store.financeData.assets.forEach((asset, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1.5fr auto';
        const baseId = `asset-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Asset Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(asset.name)}" data-collection="assets" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Asset name">
            </span>
            <span>
                <label for="${baseId}-balance" class="visually-hidden">Asset Balance ${index + 1}</label>
                <input type="number" value="${asset.balance}" data-collection="assets" data-index="${index}" data-field="balance" id="${baseId}-balance" name="${baseId}-balance" placeholder="Balance" step="0.01">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="asset" aria-label="Delete Asset ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

export function renderLiabilitiesSettings() {
    const container = getElement('liabilities-settings');
    if (!container) return;
    container.innerHTML = '';
    store.financeData.liabilities.forEach((liability, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1.5fr 1fr auto';
        const baseId = `liability-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Liability Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(liability.name)}" data-collection="liabilities" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Liability name">
            </span>
            <span>
                <label for="${baseId}-balance" class="visually-hidden">Liability Balance ${index + 1}</label>
                <input type="number" value="${liability.balance}" data-collection="liabilities" data-index="${index}" data-field="balance" id="${baseId}-balance" name="${baseId}-balance" placeholder="Balance" step="0.01">
            </span>
            <span>
                <label for="${baseId}-rate" class="visually-hidden">Liability Interest Rate ${index + 1}</label>
                <input type="number" value="${liability.interestRate || 0}" data-collection="liabilities" data-index="${index}" data-field="interestRate" id="${baseId}-rate" name="${baseId}-rate" placeholder="Interest %" step="0.01">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="liability" aria-label="Delete Liability ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
    const totals = calculateTotals(store.financeData);
    setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
}

export function renderAllocationSettings() {
    const container = getElement('allocation-settings');
    if (!container) return;
    container.innerHTML = '';
    store.financeData.allocation.forEach((alloc, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 0.8fr 1fr 1fr auto';
        const baseId = `alloc-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Allocation Category Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(alloc.name)}" data-collection="allocation" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Category Name">
            </span>
            <span>
                <label for="${baseId}-percentage" class="visually-hidden">Allocation Percentage ${index + 1}</label>
                <input type="number" value="${alloc.percentage}" data-collection="allocation" data-index="${index}" data-field="percentage" id="${baseId}-percentage" name="${baseId}-percentage" placeholder="%" step="0.1" min="0">
            </span>
            <span>
                <label for="${baseId}-current" class="visually-hidden">Current Funds ${index + 1}</label>
                <input type="number" value="${alloc.currentBalance != null ? alloc.currentBalance : 0}" data-collection="allocation" data-index="${index}" data-field="currentBalance" id="${baseId}-current" name="${baseId}-current" placeholder="Funds $" step="0.01" min="0">
            </span>
            <span>
                <label for="${baseId}-goal" class="visually-hidden">Savings Goal ${index + 1}</label>
                <input type="number" value="${alloc.savingsGoal != null ? alloc.savingsGoal : 0}" data-collection="allocation" data-index="${index}" data-field="savingsGoal" id="${baseId}-goal" name="${baseId}-goal" placeholder="Goal $ (opt)" step="0.01" min="0">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="allocation" aria-label="Delete Allocation Category ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
    updateAllocationTotalDisplay();
}

export function updateAllocationTotalDisplay(scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    const totalSpan = getElement(scope === 'whatif' ? 'whatif-total-percent' : 'total-percent');
    const total = (fd.allocation || []).reduce((sum, alloc) => sum + (parseFloat(alloc.percentage) || 0), 0);
    if (totalSpan) {
        // H.3 — live sum enforcement: show the exact over/under so it's easy to balance to 100%.
        const ok = Math.abs(total - 100) < 0.11;
        const diff = total - 100;
        let label = `${total.toFixed(1)}%`;
        if (!ok) label += diff > 0 ? ` — ${diff.toFixed(1)}% over` : ` — ${Math.abs(diff).toFixed(1)}% under`;
        totalSpan.textContent = label;
        totalSpan.style.color = ok ? 'var(--color-positive)' : 'var(--color-negative)';
    }
}

export function renderExpensesSettingsLists() {
    const renderList = (listId, expensesArrayName, expenseType) => {
        const container = getElement(listId);
        if (!container) return;
        container.innerHTML = '';
        store.financeData[expensesArrayName].forEach((expense, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'list-item';
            itemDiv.style.gridTemplateColumns = '2fr 1fr 1fr auto';
            const baseId = `${expenseType}-${index}`;
            const typeLabel = expenseType === 'essentialExpense' ? 'Essential' : 'Non-Essential';
            itemDiv.innerHTML = `
                <span>
                    <label for="${baseId}-name" class="visually-hidden">${typeLabel} Expense Name ${index + 1}</label>
                    <input type="text" value="${escapeHtml(expense.name)}" data-collection="${expensesArrayName}" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Name">
                </span>
                <span>
                    <label for="${baseId}-amount" class="visually-hidden">${typeLabel} Expense Amount ${index + 1}</label>
                    <input type="number" value="${expense.amount}" data-collection="${expensesArrayName}" data-index="${index}" data-field="amount" id="${baseId}-amount" name="${baseId}-amount" placeholder="Amount" step="0.01">
                </span>
                <span>
                    <label for="${baseId}-frequency" class="visually-hidden">${typeLabel} Expense Frequency ${index + 1}</label>
                    <select data-collection="${expensesArrayName}" data-index="${index}" data-field="frequency" id="${baseId}-frequency" name="${baseId}-frequency">
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

export function renderFISettings() {
    setValue('fi-multiple', store.financeData.fiSettings.multiple);
    setValue('expected-return', store.financeData.fiSettings.expectedReturn);
}
