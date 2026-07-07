// First-run onboarding — shown once on a fresh install (no saved data and not
// previously completed/skipped). Three paths: guided setup (income → spending
// → done), sample household, or skip. Every step says why it matters.

import { store } from '../state/store.js';
import { getElement, getValue, formatCurrency, setText } from '../utils.js';
import { calculateTotals } from '../calc/calculations.js';
import { updateAllUI } from './render.js';
import { initializeSettingsUI } from './settings-forms.js';
import { loadSampleData } from '../state/sample-data.js';
import { showToast } from './toast.js';
import { t } from '../i18n/strings.js';

const ONBOARDED_KEY = 'ft-onboarded';

function markOnboarded() {
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch (_) {}
}
function alreadyOnboarded() {
    try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch (_) { return false; }
}

function showStep(id) {
    document.querySelectorAll('#onboarding-modal .onboarding-step').forEach(s => { s.hidden = s.id !== id; });
    const first = document.querySelector(`#${id} input, #${id} button`);
    if (first) first.focus();
}

function closeOnboarding() {
    const modal = getElement('onboarding-modal');
    if (modal) modal.hidden = true;
    markOnboarded();
}

function applySetupAnswers() {
    const name = (getValue('onboard-income-name') || 'My job').trim();
    const gross = Math.max(0, parseFloat(getValue('onboard-income-gross')) || 0);
    const schedule = getValue('onboard-income-schedule') || 'fortnightly';
    store.financeData.incomeSources = [{
        name, incomeType: 'salaried', grossAnnual: gross, paySchedule: schedule,
        hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null,
    }];
    store.financeData.primaryIncomeIndex = 0;

    const essential = Math.max(0, parseFloat(getValue('onboard-spend-essential')) || 0);
    const fun = Math.max(0, parseFloat(getValue('onboard-spend-fun')) || 0);
    store.financeData.essentialExpenses = essential > 0
        ? [{ name: 'Living costs (rough)', amount: essential, frequency: 'weekly' }]
        : [];
    store.financeData.nonEssentialExpenses = fun > 0
        ? [{ name: 'Fun & extras (rough)', amount: fun, frequency: 'weekly' }]
        : [];

    initializeSettingsUI();
    updateAllUI();
    if (store.autoSave) store.autoSave.onDataChange();
}

function renderSummary() {
    const totals = calculateTotals(store.financeData);
    const el = getElement('onboard-summary');
    if (!el) return;
    if (totals.totalNetAnnualIncome <= 0) {
        el.textContent = t('onboard.summary.plain');
        return;
    }
    const fortnightly = totals.weeklySavings * 2;
    if (totals.savingsRate > 0) {
        el.textContent = t('onboard.summary.saving', {
            fortnightly: formatCurrency(fortnightly), rate: totals.savingsRate.toFixed(0),
        });
    } else {
        el.textContent = t('onboard.summary.overspending', {
            fortnightly: formatCurrency(Math.abs(fortnightly)),
        });
    }
}

/**
 * Decide whether to show onboarding (call once at boot, after loadData).
 * @param {boolean} hadSavedData - loadData() found an existing save.
 */
export function setupOnboarding(hadSavedData) {
    const modal = getElement('onboarding-modal');
    if (!modal) return;
    if (hadSavedData || alreadyOnboarded()) return;

    modal.hidden = false;
    showStep('onboard-step-welcome');

    getElement('onboard-skip').addEventListener('click', closeOnboarding);
    getElement('onboard-setup').addEventListener('click', () => showStep('onboard-step-income'));
    getElement('onboard-sample').addEventListener('click', async () => {
        const btn = getElement('onboard-sample');
        btn.disabled = true;
        btn.textContent = t('onboard.sample.loading');
        const count = await loadSampleData();
        initializeSettingsUI();
        const { generateBillDueEvents } = await import('../state/bills.js');
        generateBillDueEvents(store.financeData); // announce the demo's due-soon bills now, not next boot
        const { refreshSpendCache } = await import('../state/spend-cache.js');
        await refreshSpendCache();
        updateAllUI();
        closeOnboarding();
        showToast(count > 0
            ? t('toast.sample.loaded', { count })
            : t('toast.sample.loadedNoTxns'));
    });

    getElement('onboard-income-back').addEventListener('click', () => showStep('onboard-step-welcome'));
    getElement('onboard-income-next').addEventListener('click', () => showStep('onboard-step-spend'));
    getElement('onboard-spend-back').addEventListener('click', () => showStep('onboard-step-income'));
    getElement('onboard-spend-next').addEventListener('click', () => {
        applySetupAnswers();
        renderSummary();
        showStep('onboard-step-done');
    });

    getElement('onboard-finish').addEventListener('click', () => {
        closeOnboarding();
        showToast(t('toast.onboarding.done'));
    });
    getElement('onboard-import').addEventListener('click', () => {
        closeOnboarding();
        const openImport = getElement('open-import');
        if (openImport) openImport.click();
    });

    // Escape = skip (don't trap someone who just wants to look around).
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeOnboarding();
    });
}
