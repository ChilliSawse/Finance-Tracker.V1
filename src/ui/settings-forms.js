// Live-data settings form renderers (moved from uiSettings.js).
// The What If scenario renderers live in ui/whatif.js; the appearance form
// (initializeGuiSettingsForm / applyGuiStylesToPage) lives in theme/appearance.js.

import { store } from '../state/store.js';
import { getElement, setText, setValue, escapeHtml, formatCurrency } from '../utils.js';
import { calculateTotals } from '../calc/calculations.js';
import { AU_TAX_YEARS } from '../calc/tax-au.js';
import { sumEvents, fyRange, activeFyKey } from '../calc/income-events.js';
import { t } from '../i18n/strings.js';
import { updateDefaultsButtonLabels } from '../events/settings-events.js';
import { initializeGuiSettingsForm } from '../theme/appearance.js';
import { initializeWhatIfTab } from './whatif.js';

export function initializeSettingsUI() {
    setValue('currency-select', store.financeData.currency);
    setValue('dashboard-view-period', store.financeData.dashboardViewPeriod || 'fortnightly');

    renderIncomeSourcesSettings();
    renderTaxBracketsSettings();
    renderTaxSettings();
    renderAssetsSettings();
    renderLiabilitiesSettings();
    renderAllocationSettings();
    renderExpensesSettingsLists(); // Combined essential and non-essential
    renderBillsSettings();
    renderCategoriesSettings();
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
        const isVariable = source.incomeType === 'variable';
        const invoicedPayValue = source.invoicedPayPostTax === null || source.invoicedPayPostTax === undefined ? '' : source.invoicedPayPostTax;
        const taxRemovedValue = source.taxRemoved === null || source.taxRemoved === undefined ? '' : source.taxRemoved;
        const baseId = `income-${index}`;

        // Salaried: gross is entered; net/tax per cycle are OPTIONAL overrides (from a payslip) —
        //   when filled they take precedence over the bracket estimate, otherwise tax is estimated.
        // Self-employed: net (+ optional tax) per cycle is entered, gross back-calculated (gross disabled).
        // Variable: no pay cycle at all — figures come from dated income events (editor below the
        //   row), so every per-cycle field is disabled.
        const grossDisabled = (isSelfEmployed || isVariable) ? 'disabled' : '';
        const cycleDisabled = isVariable ? 'disabled' : '';
        const autoNote = '— auto —';
        const eventsNote = t('varInc.fromEvents');
        const netPlaceholder = isVariable ? eventsNote : (isSelfEmployed ? 'Net Pay/Cycle' : 'Net/Cycle (opt)');
        const taxPlaceholder = isVariable ? eventsNote : 'Tax/Cycle (opt)';

        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-primary" class="visually-hidden">Set as Primary Income Source ${index + 1}</label>
                <input type="radio" name="primary-income" ${isPrimary ? 'checked' : ''} data-index="${index}" id="${baseId}-primary" style="justify-self: center;">
            </span>
            <span>
                <label for="${baseId}-type" class="visually-hidden">Income Type ${index + 1}</label>
                <select data-collection="incomeSources" data-index="${index}" data-field="incomeType" id="${baseId}-type" name="${baseId}-type">
                    <option value="salaried" ${!isSelfEmployed && !isVariable ? 'selected' : ''}>Salaried</option>
                    <option value="selfEmployed" ${isSelfEmployed ? 'selected' : ''}>Self-employed</option>
                    <option value="variable" ${isVariable ? 'selected' : ''}>Variable</option>
                </select>
            </span>
            <span>
                <label for="${baseId}-name" class="visually-hidden">Income Source Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(source.name || '')}" data-collection="incomeSources" data-index="${index}" data-field="name" id="${baseId}-name" name="${baseId}-name" placeholder="Name">
            </span>
            <span>
                <label for="${baseId}-gross" class="visually-hidden">Gross Annual Income ${index + 1}</label>
                <input type="number" value="${source.grossAnnual || 0}" data-collection="incomeSources" data-index="${index}" data-field="grossAnnual" id="${baseId}-gross" name="${baseId}-gross" placeholder="${(isSelfEmployed || isVariable) ? autoNote : 'Gross Annual'}" step="0.01" ${grossDisabled}>
            </span>
            <span>
                <label for="${baseId}-schedule" class="visually-hidden">Pay Schedule ${index + 1}</label>
                <select data-collection="incomeSources" data-index="${index}" data-field="paySchedule" id="${baseId}-schedule" name="${baseId}-schedule" ${cycleDisabled}>
                    <option value="weekly" ${source.paySchedule === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="fortnightly" ${source.paySchedule === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                    <option value="monthly" ${source.paySchedule === 'monthly' ? 'selected' : ''}>Monthly</option>
                    <option value="yearly" ${source.paySchedule === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select>
            </span>
            <span>
                <label for="${baseId}-netpay" class="visually-hidden">Net Pay Per Cycle ${index + 1}</label>
                <input type="number" value="${isVariable ? '' : invoicedPayValue}" data-collection="incomeSources" data-index="${index}" data-field="invoicedPayPostTax" id="${baseId}-netpay" name="${baseId}-netpay" placeholder="${netPlaceholder}" step="0.01" ${cycleDisabled}>
            </span>
            <span>
                 <label for="${baseId}-hours" class="visually-hidden">Hours Per Cycle ${index + 1}</label>
                 <input type="number" value="${isVariable ? '' : (source.hoursPerCycle || '')}" data-collection="incomeSources" data-index="${index}" data-field="hoursPerCycle" id="${baseId}-hours" name="${baseId}-hours" placeholder="${isVariable ? eventsNote : 'Hours'}" step="1" ${cycleDisabled}>
            </span>
            <span>
                <label for="${baseId}-taxremoved" class="visually-hidden">Tax Removed Per Cycle ${index + 1}</label>
                <input type="number" value="${isVariable ? '' : taxRemovedValue}" data-collection="incomeSources" data-index="${index}" data-field="taxRemoved" id="${baseId}-taxremoved" name="${baseId}-taxremoved" placeholder="${taxPlaceholder}" step="0.01" ${cycleDisabled}>
            </span>
            <button class="delete-btn" data-index="${index}" data-type="incomeSource" aria-label="Delete Income Source ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);

        if (isVariable) {
            container.appendChild(buildIncomeEventsEditor(source, index));
        } else {
            // Payslip PDF autofill — fills gross/net/tax per cycle from a real payslip.
            const tools = document.createElement('div');
            tools.className = 'income-row-tools';
            tools.innerHTML = `
                <button type="button" class="btn btn-secondary btn-small payslip-upload-btn" data-parent-index="${index}">
                    ${t('payslip.uploadBtn')}
                </button>
                <span class="settings-hint payslip-status" id="payslip-status-${index}"></span>`;
            container.appendChild(tools);
        }
    });
}

// Variable-income event editor — one block per Variable source, rendered under
// its row. Rows follow the app's delegated-edit convention with a nested
// collection: data-collection="incomeEvents" + data-parent-index (the source)
// + data-index (the event) + data-field; deletes carry data-type="incomeEvent".
function buildIncomeEventsEditor(source, sourceIndex) {
    const wrap = document.createElement('div');
    wrap.className = 'income-events-editor';
    wrap.dataset.sourceIndex = sourceIndex;

    const events = Array.isArray(source.incomeEvents) ? source.incomeEvents : [];
    const fyKey = activeFyKey(store.financeData.taxSettings);
    const { from, to } = fyRange(fyKey);
    const fyTotals = sumEvents(events, from, to);
    const fyLabel = AU_TAX_YEARS[fyKey] ? AU_TAX_YEARS[fyKey].label : fyKey;

    let rowsHtml = '';
    if (!events.length) {
        rowsHtml = `<p class="income-events-empty">${t('varInc.noEvents')}</p>`;
    } else {
        rowsHtml = events.map((e, i) => {
            const baseId = `income-${sourceIndex}-event-${i}`;
            const optVal = (v) => (v === null || v === undefined ? '' : v);
            return `
            <div class="list-item income-event-row">
                <span>
                    <label for="${baseId}-date" class="visually-hidden">Event ${i + 1} date</label>
                    <input type="date" value="${escapeHtml(e.date || '')}" data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="date" id="${baseId}-date">
                </span>
                <span>
                    <label for="${baseId}-label" class="visually-hidden">Event ${i + 1} label</label>
                    <input type="text" value="${escapeHtml(e.label || '')}" data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="label" id="${baseId}-label" placeholder="${t('varInc.labelPh')}">
                </span>
                <span>
                    <label for="${baseId}-net" class="visually-hidden">Event ${i + 1} amount banked</label>
                    <input type="number" value="${e.netAmount || 0}" data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="netAmount" id="${baseId}-net" placeholder="Banked $" step="0.01" min="0">
                </span>
                <span>
                    <label for="${baseId}-tax" class="visually-hidden">Event ${i + 1} tax withheld</label>
                    <input type="number" value="${optVal(e.taxWithheld)}" data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="taxWithheld" id="${baseId}-tax" placeholder="Tax $ (opt)" step="0.01" min="0">
                </span>
                <span>
                    <label for="${baseId}-hours" class="visually-hidden">Event ${i + 1} hours worked</label>
                    <input type="number" value="${optVal(e.hours)}" data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="hours" id="${baseId}-hours" placeholder="Hrs (opt)" step="0.25" min="0">
                </span>
                <span>
                    <label for="${baseId}-cash" class="visually-hidden">Event ${i + 1} cash received</label>
                    <input type="number" value="${optVal(e.cashReceived)}" data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="cashReceived" id="${baseId}-cash" placeholder="Cash $ (opt)" step="0.01" min="0">
                </span>
                <span class="income-event-check">
                    <label for="${baseId}-gst" title="${t('varInc.gstTitle')}">GST</label>
                    <input type="checkbox" ${e.gstInclusive ? 'checked' : ''} data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="gstInclusive" id="${baseId}-gst" aria-label="Event ${i + 1}: amount includes GST">
                </span>
                <span class="income-event-check">
                    <label for="${baseId}-pen" title="${t('varInc.penaltyTitle')}">Pen.</label>
                    <input type="checkbox" ${e.penaltyRates ? 'checked' : ''} data-collection="incomeEvents" data-parent-index="${sourceIndex}" data-index="${i}" data-field="penaltyRates" id="${baseId}-pen" aria-label="Event ${i + 1}: paid at penalty rates">
                </span>
                <button class="delete-btn" data-parent-index="${sourceIndex}" data-index="${i}" data-type="incomeEvent" aria-label="Delete income event ${i + 1}">×</button>
            </div>`;
        }).join('');
    }

    wrap.innerHTML = `
        <div class="income-events-head">
            <span class="income-events-title">${t('varInc.eventsTitle', { name: escapeHtml(source.name || '') })}</span>
            <span class="income-events-fy-total">${t('varInc.fyTotal', {
                fy: escapeHtml(fyLabel),
                net: formatCurrency(fyTotals.net),
                count: fyTotals.count,
                eventWord: t(fyTotals.count === 1 ? 'varInc.eventOne' : 'varInc.eventMany'),
            })}</span>
        </div>
        <div class="income-events-meta">
            <label class="form-label" for="income-${sourceIndex}-baserate">${t('varInc.baseRate')}</label>
            <input type="number" class="income-baserate-input" value="${source.baseHourlyRate == null ? '' : source.baseHourlyRate}"
                data-collection="incomeSources" data-index="${sourceIndex}" data-field="baseHourlyRate"
                id="income-${sourceIndex}-baserate" placeholder="$/hr" step="0.01" min="0">
            <span class="settings-hint">${t('varInc.baseRateHint')}</span>
        </div>
        <div class="dynamic-list income-events-list">
            ${events.length ? `
            <div class="list-header income-event-row">
                <span>Date</span><span>Label / client</span><span>Banked $</span><span>Tax $</span><span>Hours</span><span>Cash $</span><span>GST</span><span>Pen.</span><span></span>
            </div>` : ''}
            ${rowsHtml}
        </div>
        <button class="add-btn add-income-event-btn" data-parent-index="${sourceIndex}">${t('varInc.addEvent')}</button>`;
    return wrap;
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

// Ledger — the estimate components beyond the brackets (FY rates, Medicare, HELP).
export function renderTaxSettings() {
    const ts = store.financeData.taxSettings;
    if (!ts) return;
    const sel = getElement('tax-fy-select');
    if (sel) {
        let html = '';
        for (const [key, fy] of Object.entries(AU_TAX_YEARS)) {
            html += `<option value="${key}" ${ts.financialYear === key ? 'selected' : ''}>${escapeHtml(fy.label)}</option>`;
        }
        html += `<option value="" ${!ts.financialYear ? 'selected' : ''}>Custom brackets</option>`;
        sel.innerHTML = html;
    }
    const medicare = getElement('tax-medicare-check');
    if (medicare) medicare.checked = !!ts.includeMedicareLevy;
    setValue('tax-help-balance', ts.helpBalance || '');
    const helpInc = getElement('tax-help-include');
    if (helpInc) helpInc.checked = ts.includeHelpInEstimate !== false;
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
        itemDiv.style.gridTemplateColumns = '2fr 0.8fr 1fr 1fr 0.6fr auto';
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
            <span style="justify-self: center;" title="${t('taxpot.checkboxTitle')}">
                <label for="${baseId}-taxpot" class="visually-hidden">Use bucket ${index + 1} as the tax provision pot</label>
                <input type="checkbox" ${alloc.isTaxProvision ? 'checked' : ''} data-collection="allocation" data-index="${index}" data-field="isTaxProvision" id="${baseId}-taxpot">
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

// Ledger — categories & budgets editor (Expenses modal). Categories drive CSV
// auto-matching (keywords, first match wins) and envelopes (monthlyBudget).
export function renderCategoriesSettings() {
    const container = getElement('categories-settings');
    if (!container) return;
    container.innerHTML = '';
    (store.financeData.categories || []).forEach((cat, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '1.4fr 1fr 0.6fr 3fr auto';
        const baseId = `cat-${index}`;
        const locked = cat.id === 'other' || cat.id === 'income'; // structural categories
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Category Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(cat.name || '')}" data-collection="categories" data-index="${index}" data-field="name" id="${baseId}-name" placeholder="Name">
            </span>
            <span>
                <label for="${baseId}-budget" class="visually-hidden">Monthly Budget ${index + 1}</label>
                <input type="number" value="${cat.monthlyBudget || ''}" data-collection="categories" data-index="${index}" data-field="monthlyBudget" id="${baseId}-budget" placeholder="No cap" step="1" min="0">
            </span>
            <span style="justify-self: center;">
                <label for="${baseId}-essential" class="visually-hidden">Essential ${index + 1}</label>
                <input type="checkbox" ${cat.essential ? 'checked' : ''} data-collection="categories" data-index="${index}" data-field="essential" id="${baseId}-essential">
            </span>
            <span>
                <label for="${baseId}-keywords" class="visually-hidden">Keywords ${index + 1}</label>
                <input type="text" value="${escapeHtml((cat.keywords || []).join(', '))}" data-collection="categories" data-index="${index}" data-field="keywords" id="${baseId}-keywords" placeholder="woolworths, coles, …">
            </span>
            ${locked
                ? '<span class="settings-hint" style="justify-self: center; margin: 0;">built-in</span>'
                : `<button class="delete-btn" data-index="${index}" data-type="category" aria-label="Delete Category ${index + 1}">Delete</button>`}`;
        container.appendChild(itemDiv);
    });
}

// Ledger — recurring bills editor (Expenses modal). Bills are reminders only.
export function renderBillsSettings() {
    const container = getElement('bills-settings');
    if (!container) return;
    container.innerHTML = '';
    (store.financeData.bills || []).forEach((bill, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'list-item';
        itemDiv.style.gridTemplateColumns = '2fr 1fr 1fr 1.2fr auto';
        const baseId = `bill-${index}`;
        itemDiv.innerHTML = `
            <span>
                <label for="${baseId}-name" class="visually-hidden">Bill Name ${index + 1}</label>
                <input type="text" value="${escapeHtml(bill.name || '')}" data-collection="bills" data-index="${index}" data-field="name" id="${baseId}-name" placeholder="e.g. Car insurance">
            </span>
            <span>
                <label for="${baseId}-amount" class="visually-hidden">Bill Amount ${index + 1}</label>
                <input type="number" value="${bill.amount != null ? bill.amount : ''}" data-collection="bills" data-index="${index}" data-field="amount" id="${baseId}-amount" placeholder="Amount" step="0.01" min="0">
            </span>
            <span>
                <label for="${baseId}-frequency" class="visually-hidden">Bill Frequency ${index + 1}</label>
                <select data-collection="bills" data-index="${index}" data-field="frequency" id="${baseId}-frequency">
                    <option value="weekly" ${bill.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="fortnightly" ${bill.frequency === 'fortnightly' ? 'selected' : ''}>Fortnightly</option>
                    <option value="monthly" ${bill.frequency === 'monthly' || !bill.frequency ? 'selected' : ''}>Monthly</option>
                    <option value="quarterly" ${bill.frequency === 'quarterly' ? 'selected' : ''}>Quarterly</option>
                    <option value="yearly" ${bill.frequency === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select>
            </span>
            <span>
                <label for="${baseId}-due" class="visually-hidden">Next Due Date ${index + 1}</label>
                <input type="date" value="${escapeHtml(bill.nextDue || '')}" data-collection="bills" data-index="${index}" data-field="nextDue" id="${baseId}-due">
            </span>
            <button class="delete-btn" data-index="${index}" data-type="bill" aria-label="Delete Bill ${index + 1}">Delete</button>`;
        container.appendChild(itemDiv);
    });
}

export function renderFISettings() {
    setValue('fi-multiple', store.financeData.fiSettings.multiple);
    setValue('expected-return', store.financeData.fiSettings.expectedReturn);
}
