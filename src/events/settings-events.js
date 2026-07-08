// Delegated settings handlers + list mutations + user defaults (from events.js).
// These are the document-level click/change handlers that route every dynamic-list
// edit (live data AND What If sandbox, via data-scope="whatif").

import { store } from '../state/store.js';
import {
    getElement, getValue, showFieldError, clearFieldError, validateFieldValue,
} from '../utils.js';
import { showCustomModal, confirmAction, inlineConfirm } from '../ui/confirm.js';
import { updateDataAndUI } from '../ui/render.js';
import {
    initializeSettingsUI, renderIncomeSourcesSettings, renderTaxBracketsSettings,
    renderAssetsSettings, renderLiabilitiesSettings, renderAllocationSettings,
    renderExpensesSettingsLists, updateAllocationTotalDisplay, renderTaxSettings,
    renderBillsSettings, renderCategoriesSettings,
} from '../ui/settings-forms.js';
import { AU_TAX_YEARS } from '../calc/tax-au.js';
import {
    renderWhatIfIncomeSources, renderWhatIfAssets, renderWhatIfLiabilities,
    renderWhatIfAllocation, renderWhatIfExpensesList,
} from '../ui/whatif.js';

// Phase R — the financeData array keys that settings inputs may write to. An input declares
// its target via `data-collection`; this whitelist keeps a stray/forged value from writing to
// an arbitrary financeData property. Names must match the keys in defaultFinanceData exactly
// (note `allocation` is singular).
const SETTINGS_COLLECTIONS = [
    'incomeSources', 'taxBrackets', 'assets', 'liabilities',
    'allocation', 'essentialExpenses', 'nonEssentialExpenses', 'bills', 'categories'
];

export function handleSettingsClickEvents(event) {
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
    else if (target.id === 'add-bill') addBill();
    else if (target.id === 'add-category') addCategory();

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
        else if (dataType === 'bill') inlineConfirm(target, 'Delete this bill?', () => removeBill(index));
        else if (dataType === 'category') inlineConfirm(target, 'Delete this category? Transactions using it will show as "Other".', () => removeCategory(index));
        else if (dataType === 'essentialExpense') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('essentialExpenses', index));
        else if (dataType === 'nonEssentialExpense') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('nonEssentialExpenses', index));
        // What If scenario expenses tag data-type with the collection name (plural).
        else if (dataType === 'essentialExpenses') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('essentialExpenses', index, scope));
        else if (dataType === 'nonEssentialExpenses') inlineConfirm(target, 'Delete this expense?', () => removeExpenseFromList('nonEssentialExpenses', index, scope));
    }

    // Data action buttons (in the appearance/settings modal; D.6).
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

export function handleSettingsChangeEvents(event) {
    const target = event.target;
    const index = parseInt(target.dataset.index, 10);
    const field = target.dataset.field;
    let value = target.value;

    // Handle radio button for primary income separately
    if (target.name === 'primary-income' && target.type === 'radio') {
        store.financeData.primaryIncomeIndex = index;
        updateDataAndUI();
        return;
    }
    // What If scenario primary income (distinct radio name; writes to the sandbox).
    else if (target.name === 'whatif-primary-income' && target.type === 'radio') {
        if (store.whatIfFinanceData) { store.whatIfFinanceData.primaryIncomeIndex = index; renderWhatIfIncomeSources(); }
        return;
    }
    // Income source type (salaried / self-employed) — re-render to toggle which fields are active
    else if (field === 'incomeType' && target.dataset.collection === 'incomeSources') {
        const scope = target.dataset.scope;
        const data = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
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
        if (store.whatIfFinanceData && !isNaN(val) && val > 0) store.whatIfFinanceData.fiSettings.multiple = val;
        return;
    }
    else if (target.id === 'whatif-expected-return-set') {
        const val = parseFloat(value);
        if (store.whatIfFinanceData && !isNaN(val) && val >= 0) store.whatIfFinanceData.fiSettings.expectedReturn = val;
        return;
    }
    else if (target.id === 'fi-multiple') {
        const val = parseFloat(value);
        if (isNaN(val) || val <= 0) {
            showFieldError(target, 'Must be greater than 0');
            return;
        }
        clearFieldError(target);
        store.financeData.fiSettings.multiple = val;
        updateDataAndUI();
        return;
    }
    // Ledger — tax estimate components (Income modal, "Tax details" section).
    else if (target.id === 'tax-fy-select') {
        const ts = store.financeData.taxSettings;
        if (!ts) return;
        if (value && AU_TAX_YEARS[value]) {
            ts.financialYear = value;
            // Picking a year loads its official bracket table.
            store.financeData.taxBrackets = AU_TAX_YEARS[value].brackets.map(b => ({ ...b }));
            renderTaxBracketsSettings();
        } else {
            ts.financialYear = null; // custom — leave the brackets as they are
        }
        updateDataAndUI();
        return;
    }
    else if (target.id === 'tax-medicare-check') {
        if (store.financeData.taxSettings) {
            store.financeData.taxSettings.includeMedicareLevy = target.checked;
            updateDataAndUI();
        }
        return;
    }
    else if (target.id === 'tax-help-include') {
        if (store.financeData.taxSettings) {
            store.financeData.taxSettings.includeHelpInEstimate = target.checked;
            updateDataAndUI();
        }
        return;
    }
    else if (target.id === 'tax-help-balance') {
        const ts = store.financeData.taxSettings;
        if (!ts) return;
        const val = parseFloat(value);
        if (value !== '' && (isNaN(val) || val < 0)) {
            showFieldError(target, 'Must be 0 or greater');
            return;
        }
        clearFieldError(target);
        ts.helpBalance = isNaN(val) ? 0 : val;
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
        store.financeData.fiSettings.expectedReturn = val;
        updateDataAndUI();
        return;
    }

    // This block handles ONLY the array-based items that have a data-field attribute
    if (field) {
        const validationError = validateFieldValue(field, value);
        if (validationError) {
            showFieldError(target, validationError);
            return;
        }
        clearFieldError(target);

        // Phase R — declarative routing. The collection an input belongs to is read from
        // `data-collection` (set by the renderers) rather than DOM ancestry (`.closest()`),
        // so these inputs keep routing correctly no matter where the forms live.
        // The whitelist guards against writing to arbitrary financeData keys.
        // `data-scope="whatif"` routes the edit to the sandbox clone (whatIfFinanceData)
        // instead of live data; results refresh on "Calculate Scenario".
        const scope = target.dataset.scope;
        const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
        const collection = target.dataset.collection;
        const arrayToUpdate = (fd && SETTINGS_COLLECTIONS.includes(collection)) ? fd[collection] : undefined;

        if (arrayToUpdate && arrayToUpdate[index] !== undefined) {
            // Category-editor conversions (checkbox boolean; comma list → keyword array).
            if (collection === 'categories' && field === 'essential') {
                value = target.checked;
                arrayToUpdate[index][field] = value;
                updateDataAndUI();
                return;
            }
            if (collection === 'categories' && field === 'keywords') {
                arrayToUpdate[index][field] = String(value).split(',')
                    .map(k => k.trim().toLowerCase()).filter(Boolean);
                updateDataAndUI();
                return;
            }
            if (collection === 'categories' && field === 'monthlyBudget') {
                arrayToUpdate[index][field] = Math.max(0, parseFloat(value) || 0);
                updateDataAndUI();
                return;
            }
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

// --- Add/Remove for main settings (scope-aware: 'whatif' routes to the sandbox) ---

// New rows land at the bottom of a scrollable container (a settings modal's .modal-body,
// or the page itself on the What If tab) — often below the fold, so "Add" looked like a
// no-op. After the list re-render, scroll the new row into view and focus its first input.
// Call AFTER the render (and updateDataAndUI) so the row queried is the freshly built one.
// `index` targets rows that don't land last (sorted tax brackets, category before 'other').
function revealNewRow(containerId, index = -1) {
    const container = getElement(containerId);
    const row = container && (index >= 0 ? container.children[index] : container.lastElementChild);
    if (!row) return;
    // Focus before scrolling (preventScroll stops the browser's instant focus-jump from
    // fighting the smooth scroll). Skipped on coarse pointers so tapping "Add" on a phone
    // doesn't pop the keyboard over the row it just revealed.
    if (!window.matchMedia('(pointer: coarse)').matches) {
        const input = row.querySelector('input[type="text"]') || row.querySelector('input, select');
        if (input) input.focus({ preventScroll: true });
    }
    // 'nearest': no movement if the row is already visible, minimal reveal otherwise —
    // works for both the modal body and the page scroll container.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
}

export function addIncomeSource(scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd.incomeSources.push({ name: "New Income", incomeType: "salaried", grossAnnual: 0, paySchedule: "monthly", hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null });
    if (scope === 'whatif') { renderWhatIfIncomeSources(); } else { renderIncomeSourcesSettings(); updateDataAndUI(); }
    revealNewRow(scope === 'whatif' ? 'whatif-income-sources-settings' : 'income-sources-settings');
}
export function removeIncomeSource(index, scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
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

export function addTaxBracket() {
    const bracket = { min: 0, max: Infinity, rate: 0 };
    store.financeData.taxBrackets.push(bracket);
    renderTaxBracketsSettings(); // This will sort and re-render
    updateDataAndUI();
    // The render sorts by min, so the new bracket isn't necessarily last — locate it.
    revealNewRow('tax-brackets-settings', store.financeData.taxBrackets.indexOf(bracket));
}
export function removeTaxBracket(index) {
    const tb = store.financeData.taxBrackets;
    if (tb.length <= 1 && tb[0].min === 0 && tb[0].max === Infinity && tb[0].rate === 0) {
         showCustomModal("You should have at least one 'catch-all' tax bracket (0 to Infinity at 0% if no tax).");
        return;
    }
    if (tb.length === 0) return;
    tb.splice(index, 1);
    renderTaxBracketsSettings();
    updateDataAndUI();
}

export function addAsset(scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd.assets.push({ name: "New Asset", balance: 0 });
    if (scope === 'whatif') { renderWhatIfAssets(); } else { renderAssetsSettings(); updateDataAndUI(); }
    revealNewRow(scope === 'whatif' ? 'whatif-assets-settings' : 'assets-settings');
}
export function removeAsset(index, scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd.assets.splice(index, 1);
    if (scope === 'whatif') { renderWhatIfAssets(); } else { renderAssetsSettings(); updateDataAndUI(); }
}

export function addLiability(scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd.liabilities.push({ name: "New Liability", balance: 0, interestRate: 0 });
    if (scope === 'whatif') { renderWhatIfLiabilities(); } else { renderLiabilitiesSettings(); updateDataAndUI(); }
    revealNewRow(scope === 'whatif' ? 'whatif-liabilities-settings' : 'liabilities-settings');
}
export function removeLiability(index, scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd.liabilities.splice(index, 1);
    if (scope === 'whatif') { renderWhatIfLiabilities(); } else { renderLiabilitiesSettings(); updateDataAndUI(); }
}

export function addAllocationCategory(scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd.allocation.push({ name: "New Category", percentage: 0, currentBalance: 0, savingsGoal: 0 });
    if (scope === 'whatif') { renderWhatIfAllocation(); }
    else { renderAllocationSettings(); updateDataAndUI(); }
    revealNewRow(scope === 'whatif' ? 'whatif-allocation-settings' : 'allocation-settings');
}
export function removeAllocationCategory(index, scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd.allocation.splice(index, 1);
    if (scope === 'whatif') { renderWhatIfAllocation(); }
    else { renderAllocationSettings(); updateDataAndUI(); }
}

export function addCategory() {
    if (!Array.isArray(store.financeData.categories)) store.financeData.categories = [];
    // Insert before the trailing 'other' catch-all so keyword matching can reach it.
    const cats = store.financeData.categories;
    const cat = { id: 'cat-' + crypto.randomUUID().slice(0, 8), name: 'New Category', essential: false, monthlyBudget: 0, keywords: [] };
    const otherIdx = cats.findIndex(c => c.id === 'other');
    if (otherIdx >= 0) cats.splice(otherIdx, 0, cat); else cats.push(cat);
    renderCategoriesSettings();
    updateDataAndUI();
    // Inserted before 'other', so the new row isn't last — locate it.
    revealNewRow('categories-settings', cats.indexOf(cat));
}
export function removeCategory(index) {
    const cats = store.financeData.categories;
    if (!Array.isArray(cats) || !cats[index]) return;
    if (cats[index].id === 'other' || cats[index].id === 'income') return; // structural
    cats.splice(index, 1);
    renderCategoriesSettings();
    updateDataAndUI();
}

export function addBill() {
    if (!Array.isArray(store.financeData.bills)) store.financeData.bills = [];
    // Default the first due date a month out — a sensible starting point to edit.
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    store.financeData.bills.push({ id: crypto.randomUUID(), name: 'New Bill', amount: 0, frequency: 'monthly', nextDue: iso });
    renderBillsSettings();
    updateDataAndUI();
    revealNewRow('bills-settings');
}
export function removeBill(index) {
    if (!Array.isArray(store.financeData.bills)) return;
    store.financeData.bills.splice(index, 1);
    renderBillsSettings();
    updateDataAndUI();
}

export function addExpenseToList(arrayName, scope) { // arrayName is 'essentialExpenses' or 'nonEssentialExpenses'
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd[arrayName].push({ name: "New Expense", amount: 0, frequency: "monthly" });
    const kind = arrayName === 'essentialExpenses' ? 'essential' : 'non-essential';
    if (scope === 'whatif') { renderWhatIfExpensesList(arrayName, `whatif-${kind}-expenses-settings`); }
    else { renderExpensesSettingsLists(); updateDataAndUI(); }
    revealNewRow(scope === 'whatif' ? `whatif-${kind}-expenses-settings` : `${kind}-expenses-settings-list`);
}
export function removeExpenseFromList(arrayName, index, scope) {
    const fd = scope === 'whatif' ? store.whatIfFinanceData : store.financeData;
    if (!fd) return;
    fd[arrayName].splice(index, 1);
    if (scope === 'whatif') { renderWhatIfExpensesList(arrayName, `whatif-${arrayName === 'essentialExpenses' ? 'essential' : 'non-essential'}-expenses-settings`); }
    else { renderExpensesSettingsLists(); updateDataAndUI(); }
}

// --- User defaults ("Save as My Defaults" / reset) ---

export function updateFinanceDataFromFISettingsInputs() {
    // Only update from inputs if the financeData values are somehow invalid
    const inputMultiple = parseFloat(getValue('fi-multiple')) || 25;
    const inputReturn = parseFloat(getValue('expected-return')) || 7;

    if (!store.financeData.fiSettings.multiple || isNaN(store.financeData.fiSettings.multiple)) {
        store.financeData.fiSettings.multiple = inputMultiple;
    }
    if (!store.financeData.fiSettings.expectedReturn || isNaN(store.financeData.fiSettings.expectedReturn)) {
        store.financeData.fiSettings.expectedReturn = inputReturn;
    }
}

const USER_DEFAULTS_KEY = 'ft-user-defaults';

// Returns the saved user-defaults bundle, or null if none/invalid.
export function getUserDefaults() {
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
export function updateDefaultsButtonLabels() {
    const resetBtn = getElement('reset-to-defaults');
    if (resetBtn) {
        resetBtn.textContent = getUserDefaults()
            ? 'Reset to My Defaults'
            : 'Reset to Factory Defaults';
    }
}

export function actionSetCurrentAsDefault() {
    if (!confirmAction('Save your current finance and appearance settings as your defaults? Resetting will return to this state.')) return;
    updateFinanceDataFromFISettingsInputs(); // Ensure FI settings are captured from inputs

    const bundle = {
        financeData: JSON.parse(JSON.stringify(store.financeData)),
        guiSettings: JSON.parse(JSON.stringify(store.guiSettingsData)),
        timestamp: new Date().toISOString()
    };
    try {
        localStorage.setItem(USER_DEFAULTS_KEY, JSON.stringify(bundle));
        // Keep the in-memory session default in sync too
        store.defaultFinanceData = JSON.parse(JSON.stringify(store.financeData));
        updateDefaultsButtonLabels();
        showCustomModal('Saved as your defaults.', 'success');
    } catch (e) {
        console.error('Failed to save user defaults:', e);
        showCustomModal('Could not save defaults (storage error).', 'error');
    }
}

export function actionResetToAppDefaults() {
    // Confirmation handled by the caller's inlineConfirm (H.5).
    // If the sample household is loaded, clear its transaction batch too so a
    // reset really is a clean slate. Fire-and-forget (IndexedDB).
    import('../state/sample-data.js').then(async (sample) => {
        if (sample.sampleDataActive()) {
            const tx = await import('../state/transactions.js');
            await tx.deleteImportBatch(sample.SAMPLE_BATCH_ID).catch(() => {});
            sample.clearSampleFlag();
            const { refreshSpendCache } = await import('../state/spend-cache.js');
            await refreshSpendCache();
            updateDataAndUI();
        }
    }).catch(() => {});
    const userDefaults = getUserDefaults();
    if (userDefaults) {
        store.financeData = JSON.parse(JSON.stringify(userDefaults.financeData));
        if (userDefaults.guiSettings) {
            store.guiSettingsData = JSON.parse(JSON.stringify(userDefaults.guiSettings));
        }
    } else {
        store.financeData = JSON.parse(JSON.stringify(store.defaultFinanceData));
    }

    initializeSettingsUI(); // Re-render all settings inputs (also re-applies GUI settings form/styles)
    updateDataAndUI();       // Update all displays and save
    showCustomModal(userDefaults ? 'Reset to your defaults complete!' : 'Reset to factory defaults complete!', 'success');
}
