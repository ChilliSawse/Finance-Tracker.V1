// The What If sandbox (renderers from uiSettings.js + handlers from events.js).
// Reference architecture: a full clone of financeData (store.whatIfFinanceData),
// edited via data-scope="whatif" routing, rendered in isolation — edits never
// touch live data. New complex features (CSV import) are modelled on this.

import { store } from '../state/store.js';
import {
    getElement, setHTML, setValue, escapeHtml, formatCurrency,
    formatTimeToGoal, fitAllAmounts,
} from '../utils.js';
import { calculateTotals, calculateYearsToFI } from '../calc/calculations.js';
import { updateAllocationTotalDisplay } from './settings-forms.js';

// Phase 0.4: Seed the What If tab from live data ONLY on first show (or when the user
// explicitly clicks "Reset to current", which passes force=true). On ordinary tab switches
// this is a no-op so in-progress scenario edits survive.
export function initializeWhatIfTab(force = false) {
    if (store.whatIfInitialized && !force) return;

    // The full sandbox clone; every scenario section edits this, not live data.
    store.whatIfFinanceData = JSON.parse(JSON.stringify(store.financeData));

    renderWhatIfSections();
    setHTML('whatif-results-display', '<h3>Scenario Results</h3><p>Your "What If" results will appear here after calculation.</p>');

    store.whatIfInitialized = true;
}

// Render every scenario section from the sandbox clone.
export function renderWhatIfSections() {
    renderWhatIfIncomeSources();
    renderWhatIfAllocation();
    renderWhatIfAssets();
    renderWhatIfLiabilities();
    renderWhatIfExpensesList('essentialExpenses', 'whatif-essential-expenses-settings');
    renderWhatIfExpensesList('nonEssentialExpenses', 'whatif-non-essential-expenses-settings');
    renderWhatIfFISettings();
}

// Scenario allocation editor. Mirrors renderAllocationSettings but reads the sandbox
// clone and tags inputs with data-scope="whatif" so edits route to whatIfFinanceData.
export function renderWhatIfAllocation() {
    const container = getElement('whatif-allocation-settings');
    if (!container || !store.whatIfFinanceData) return;
    container.innerHTML = '';
    store.whatIfFinanceData.allocation.forEach((alloc, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 0.8fr 1fr 1fr auto';
        const baseId = `whatif-alloc-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Scenario Allocation Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(alloc.name)}" data-scope="whatif" data-collection="allocation" data-index="${index}" data-field="name" id="${baseId}-name" placeholder="Category Name">
            </span>
            <span>
                <label for="${baseId}-percentage" class="visually-hidden">Scenario Allocation Percentage ${index + 1}</label>
                <input type="number" value="${alloc.percentage}" data-scope="whatif" data-collection="allocation" data-index="${index}" data-field="percentage" id="${baseId}-percentage" placeholder="%" step="0.1" min="0">
            </span>
            <span>
                <label for="${baseId}-current" class="visually-hidden">Scenario Current Funds ${index + 1}</label>
                <input type="number" value="${alloc.currentBalance != null ? alloc.currentBalance : 0}" data-scope="whatif" data-collection="allocation" data-index="${index}" data-field="currentBalance" id="${baseId}-current" placeholder="Funds $" step="0.01" min="0">
            </span>
            <span>
                <label for="${baseId}-goal" class="visually-hidden">Scenario Savings Goal ${index + 1}</label>
                <input type="number" value="${alloc.savingsGoal != null ? alloc.savingsGoal : 0}" data-scope="whatif" data-collection="allocation" data-index="${index}" data-field="savingsGoal" id="${baseId}-goal" placeholder="Goal $ (opt)" step="0.01" min="0">
            </span>
            <button class="delete-btn" data-scope="whatif" data-index="${index}" data-type="allocation" aria-label="Delete Scenario Allocation ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
    updateAllocationTotalDisplay('whatif');
}

// Scenario Income Sources editor (sandbox clone). Mirrors renderIncomeSourcesSettings;
// primary radio uses a distinct name so it doesn't collide with the live one.
export function renderWhatIfIncomeSources() {
    const container = getElement('whatif-income-sources-settings');
    if (!container || !store.whatIfFinanceData) return;
    container.innerHTML = '';
    store.whatIfFinanceData.incomeSources.forEach((source, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '0.4fr 0.9fr 1.2fr 0.8fr 0.8fr 1fr 0.6fr 0.8fr 0.5fr';
        const isPrimary = index === store.whatIfFinanceData.primaryIncomeIndex;
        const isSelfEmployed = source.incomeType === 'selfEmployed';
        const invoicedPayValue = source.invoicedPayPostTax == null ? '' : source.invoicedPayPostTax;
        const taxRemovedValue = source.taxRemoved == null ? '' : source.taxRemoved;
        const baseId = `whatif-income-${index}`;
        const grossDisabled = isSelfEmployed ? 'disabled' : '';
        const netPlaceholder = isSelfEmployed ? 'Net Pay/Cycle' : 'Net/Cycle (opt)';
        itemDiv.innerHTML = `
            <span><label for="${baseId}-primary" class="visually-hidden">Set Scenario Primary ${index + 1}</label>
                <input type="radio" name="whatif-primary-income" ${isPrimary ? 'checked' : ''} data-scope="whatif" data-index="${index}" id="${baseId}-primary" style="justify-self: center;"></span>
            <span><label for="${baseId}-type" class="visually-hidden">Scenario Income Type ${index + 1}</label>
                <select data-scope="whatif" data-collection="incomeSources" data-index="${index}" data-field="incomeType" id="${baseId}-type">
                    <option value="salaried" ${!isSelfEmployed ? 'selected' : ''}>Salaried</option>
                    <option value="selfEmployed" ${isSelfEmployed ? 'selected' : ''}>Self-employed</option>
                </select></span>
            <span><label for="${baseId}-name" class="visually-hidden">Scenario Income Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(source.name || '')}" data-scope="whatif" data-collection="incomeSources" data-index="${index}" data-field="name" id="${baseId}-name" placeholder="Name"></span>
            <span><label for="${baseId}-gross" class="visually-hidden">Scenario Gross ${index + 1}</label>
                <input type="number" value="${source.grossAnnual || 0}" data-scope="whatif" data-collection="incomeSources" data-index="${index}" data-field="grossAnnual" id="${baseId}-gross" placeholder="${isSelfEmployed ? '— auto —' : 'Gross Annual'}" step="0.01" ${grossDisabled}></span>
            <span><label for="${baseId}-schedule" class="visually-hidden">Scenario Schedule ${index + 1}</label>
                <select data-scope="whatif" data-collection="incomeSources" data-index="${index}" data-field="paySchedule" id="${baseId}-schedule">
                    <option value="weekly" ${source.paySchedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="fortnightly" ${source.paySchedule === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                    <option value="monthly" ${source.paySchedule === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${source.paySchedule === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select></span>
            <span><label for="${baseId}-netpay" class="visually-hidden">Scenario Net Pay ${index + 1}</label>
                <input type="number" value="${invoicedPayValue}" data-scope="whatif" data-collection="incomeSources" data-index="${index}" data-field="invoicedPayPostTax" id="${baseId}-netpay" placeholder="${netPlaceholder}" step="0.01"></span>
            <span><label for="${baseId}-hours" class="visually-hidden">Scenario Hours ${index + 1}</label>
                <input type="number" value="${source.hoursPerCycle || ''}" data-scope="whatif" data-collection="incomeSources" data-index="${index}" data-field="hoursPerCycle" id="${baseId}-hours" placeholder="Hours" step="1"></span>
            <span><label for="${baseId}-taxremoved" class="visually-hidden">Scenario Tax Removed ${index + 1}</label>
                <input type="number" value="${taxRemovedValue}" data-scope="whatif" data-collection="incomeSources" data-index="${index}" data-field="taxRemoved" id="${baseId}-taxremoved" placeholder="Tax/Cycle (opt)" step="0.01"></span>
            <button class="delete-btn" data-scope="whatif" data-index="${index}" data-type="incomeSource" aria-label="Delete Scenario Income Source ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

// Scenario Assets editor (sandbox clone, data-scope="whatif").
export function renderWhatIfAssets() {
    const container = getElement('whatif-assets-settings');
    if (!container || !store.whatIfFinanceData) return;
    container.innerHTML = '';
    store.whatIfFinanceData.assets.forEach((asset, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1.5fr auto';
        const baseId = `whatif-asset-${index}`;
        itemDiv.innerHTML = `
            <span><label for="${baseId}-name" class="visually-hidden">Scenario Asset Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(asset.name)}" data-scope="whatif" data-collection="assets" data-index="${index}" data-field="name" id="${baseId}-name" placeholder="Asset name"></span>
            <span><label for="${baseId}-balance" class="visually-hidden">Scenario Asset Balance ${index + 1}</label>
                <input type="number" value="${asset.balance}" data-scope="whatif" data-collection="assets" data-index="${index}" data-field="balance" id="${baseId}-balance" placeholder="Balance" step="0.01"></span>
            <button class="delete-btn" data-scope="whatif" data-index="${index}" data-type="asset" aria-label="Delete Scenario Asset ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

// Scenario Liabilities editor.
export function renderWhatIfLiabilities() {
    const container = getElement('whatif-liabilities-settings');
    if (!container || !store.whatIfFinanceData) return;
    container.innerHTML = '';
    store.whatIfFinanceData.liabilities.forEach((liability, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1.5fr 1fr auto';
        const baseId = `whatif-liability-${index}`;
        itemDiv.innerHTML = `
            <span><label for="${baseId}-name" class="visually-hidden">Scenario Liability Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(liability.name)}" data-scope="whatif" data-collection="liabilities" data-index="${index}" data-field="name" id="${baseId}-name" placeholder="Liability name"></span>
            <span><label for="${baseId}-balance" class="visually-hidden">Scenario Liability Balance ${index + 1}</label>
                <input type="number" value="${liability.balance}" data-scope="whatif" data-collection="liabilities" data-index="${index}" data-field="balance" id="${baseId}-balance" placeholder="Balance" step="0.01"></span>
            <span><label for="${baseId}-rate" class="visually-hidden">Scenario Interest Rate ${index + 1}</label>
                <input type="number" value="${liability.interestRate || 0}" data-scope="whatif" data-collection="liabilities" data-index="${index}" data-field="interestRate" id="${baseId}-rate" placeholder="Interest %" step="0.01"></span>
            <button class="delete-btn" data-scope="whatif" data-index="${index}" data-type="liability" aria-label="Delete Scenario Liability ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

// Scenario Expenses editor (essential or non-essential collection).
export function renderWhatIfExpensesList(collection, containerId) {
    const container = getElement(containerId);
    if (!container || !store.whatIfFinanceData) return;
    container.innerHTML = '';
    store.whatIfFinanceData[collection].forEach((expense, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1fr 1fr auto';
        const baseId = `whatif-${collection}-${index}`;
        itemDiv.innerHTML = `
            <span><label for="${baseId}-name" class="visually-hidden">Scenario Expense Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(expense.name)}" data-scope="whatif" data-collection="${collection}" data-index="${index}" data-field="name" id="${baseId}-name" placeholder="Name"></span>
            <span><label for="${baseId}-amount" class="visually-hidden">Scenario Expense Amount ${index + 1}</label>
                <input type="number" value="${expense.amount}" data-scope="whatif" data-collection="${collection}" data-index="${index}" data-field="amount" id="${baseId}-amount" placeholder="Amount" step="0.01"></span>
            <span><label for="${baseId}-frequency" class="visually-hidden">Scenario Expense Frequency ${index + 1}</label>
                <select data-scope="whatif" data-collection="${collection}" data-index="${index}" data-field="frequency" id="${baseId}-frequency">
                    <option value="weekly" ${expense.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="fortnightly" ${expense.frequency === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                    <option value="monthly" ${expense.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${expense.frequency === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select></span>
            <button class="delete-btn" data-scope="whatif" data-index="${index}" data-type="${collection}" aria-label="Delete Scenario Expense ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

// Scenario FI settings (inputs write to whatIfFinanceData.fiSettings).
export function renderWhatIfFISettings() {
    if (!store.whatIfFinanceData) return;
    setValue('whatif-fi-multiple-set', store.whatIfFinanceData.fiSettings.multiple);
    setValue('whatif-expected-return-set', store.whatIfFinanceData.fiSettings.expectedReturn);
}

// --- Event handlers (from events.js) ---

export function handleWhatIfClickEvents(event) {
    const target = event.target;
    // Scenario section add/delete route through the document-level settings handlers
    // (data-scope="whatif"); only Calculate + Reset remain What-If-specific.
    if (target.id === 'run-whatif-calculation') runWhatIfScenario();
    else if (target.id === 'reset-whatif-to-current') initializeWhatIfTab(true); // force-reseed from live data
}

export function handleWhatIfChangeEvents(event) {
    const target = event.target;
    // Simulated-dashboard period switcher: re-render the results in the new period.
    if (target.id === 'whatif-view-period') {
        store.whatIfViewPeriod = target.value;
        runWhatIfScenario();
    }
}

// Stage 3 — ↑/↓ delta badge vs current (good direction shows in the positive colour).
export function whatIfDelta(scenarioVal, currentVal, goodIsHigher = true) {
    const diff = scenarioVal - currentVal;
    if (!isFinite(diff) || Math.abs(diff) < 0.005) return '<span class="wi-delta wi-delta-flat">no change</span>';
    const good = goodIsHigher ? diff > 0 : diff < 0;
    const arrow = diff > 0 ? '↑' : '↓';
    return `<span class="wi-delta ${good ? 'wi-delta-good' : 'wi-delta-bad'}">${arrow} ${formatCurrency(Math.abs(diff))}</span>`;
}

export function runWhatIfScenario() {
    if (!store.whatIfFinanceData) initializeWhatIfTab(true); // safety — seed the sandbox if missing

    // The scenario IS the fully-edited sandbox clone. Everything (income sources,
    // expenses, assets, liabilities, allocation, FI) comes from whatIfFinanceData, so
    // totals derive entirely from calculateTotals() with no overrides.
    const scenarioFinanceData = store.whatIfFinanceData;
    const scenarioTotals = calculateTotals(scenarioFinanceData);
    const scenarioCurrentAssets = scenarioTotals.currentAssets;

    const scenarioAnnualExpenses = scenarioTotals.totalWeeklyExpenses * 52;
    const scenarioFiTarget = scenarioAnnualExpenses * scenarioFinanceData.fiSettings.multiple;
    const scenarioYearsToFI = calculateYearsToFI(scenarioTotals.annualSavings, scenarioCurrentAssets, scenarioFiTarget, scenarioFinanceData.fiSettings.expectedReturn);

    // For comparison, get current FI years
    const currentTotals = calculateTotals(store.financeData);
    const currentAnnualExpenses = currentTotals.totalWeeklyExpenses * 52;
    const currentFiTarget = currentAnnualExpenses * store.financeData.fiSettings.multiple;
    const currentYearsToFI = calculateYearsToFI(currentTotals.annualSavings, currentTotals.currentAssets, currentFiTarget, store.financeData.fiSettings.expectedReturn);

    const yearsDifference = (typeof scenarioYearsToFI === 'number' && typeof currentYearsToFI === 'number')
        ? (scenarioYearsToFI - currentYearsToFI)
        : 'N/A';
    const savingsRateDifference = scenarioTotals.savingsRate - currentTotals.savingsRate;

    // Scenario liabilities + net worth — both from the sandbox.
    const scenarioLiabilities = scenarioTotals.currentLiabilities;
    const scenarioNetWorth = scenarioCurrentAssets - scenarioLiabilities;
    const currentNetWorth = currentTotals.netWorth;

    const resultsDiv = getElement('whatif-results-display');
    if (resultsDiv) {
        const fmtYears = (y) => (y === 0 ? 'Reached' : (!isFinite(y) ? '∞' : y.toFixed(1) + ' yr'));
        const scenarioNetAnnual = scenarioTotals.totalNetAnnualIncome;

        // Stage 3 — period switcher reflows the cash-flow figures (Net Worth + FI are absolute).
        const period = store.whatIfViewPeriod || 'fortnightly';
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
