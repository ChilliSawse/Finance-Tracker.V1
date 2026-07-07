// Sample household — a complete, realistic Australian demo so someone can
// explore Ledger before committing their own numbers. Loaded from onboarding;
// cleared by "Reset to Factory Defaults" (which also deletes the sample
// transaction batch).

import { store } from './store.js';
import { cloneDefaultFinanceData } from './defaults.js';
import { CURRENT_TAX_YEAR } from '../calc/tax-au.js';
import { categoriseDescription } from './categories.js';
import { makeTransaction, addTransactions } from './transactions.js';
import { logEvent } from './eventlog.js';

export const SAMPLE_BATCH_ID = 'ledger-sample-data';
export const SAMPLE_FLAG_KEY = 'ft-sample-data';

function isoDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoDaysAhead(days) {
    return isoDaysAgo(-days);
}

function sampleFinanceData() {
    const data = cloneDefaultFinanceData();
    data.primaryIncomeIndex = 0;
    data.incomeSources = [
        { name: 'Alex — marketing coordinator', incomeType: 'salaried', grossAnnual: 85000, paySchedule: 'fortnightly', hoursPerCycle: 76, taxRemoved: null, invoicedPayPostTax: null },
        { name: 'Sam — freelance design', incomeType: 'selfEmployed', grossAnnual: 0, paySchedule: 'fortnightly', hoursPerCycle: 20, taxRemoved: 120, invoicedPayPostTax: 940 },
    ];
    data.essentialExpenses = [
        { name: 'Rent', amount: 560, frequency: 'weekly' },
        { name: 'Groceries', amount: 290, frequency: 'weekly' },
        { name: 'Utilities & internet', amount: 75, frequency: 'weekly' },
        { name: 'Transport & fuel', amount: 65, frequency: 'weekly' },
        { name: 'Health insurance', amount: 46, frequency: 'weekly' },
    ];
    data.nonEssentialExpenses = [
        { name: 'Dining out & takeaway', amount: 110, frequency: 'weekly' },
        { name: 'Streaming & subscriptions', amount: 55, frequency: 'monthly' },
        { name: 'Gym', amount: 26, frequency: 'weekly' },
        { name: 'Hobbies & fun', amount: 150, frequency: 'monthly' },
    ];
    data.assets = [
        { name: 'Savings account', balance: 16500 },
        { name: 'Superannuation', balance: 78400 },
        { name: 'ETF portfolio', balance: 24800 },
    ];
    data.liabilities = [
        { name: 'Car loan', balance: 11200, interestRate: 7.9 },
        { name: 'Credit card', balance: 1850, interestRate: 20.99 },
    ];
    data.allocation = [
        { name: 'Daily expenses', percentage: 60, currentBalance: 2200, savingsGoal: 0 },
        { name: 'Splurge', percentage: 10, currentBalance: 450, savingsGoal: 0 },
        { name: 'Smile (holiday fund)', percentage: 10, currentBalance: 1200, savingsGoal: 4000 },
        { name: 'Fire extinguisher', percentage: 20, currentBalance: 8000, savingsGoal: 10000 },
    ];
    data.taxSettings = { financialYear: CURRENT_TAX_YEAR, includeMedicareLevy: true, helpBalance: 24600, includeHelpInEstimate: true };
    data.bills = [
        { id: 'sample-bill-phone', name: 'Phone plan', amount: 65, frequency: 'monthly', nextDue: isoDaysAhead(4) },
        { id: 'sample-bill-insurance', name: 'Car insurance', amount: 128.4, frequency: 'monthly', nextDue: isoDaysAhead(9) },
        { id: 'sample-bill-rego', name: 'Car rego', amount: 214, frequency: 'quarterly', nextDue: isoDaysAhead(23) },
    ];
    // Envelopes on the two most watchable categories.
    for (const cat of data.categories) {
        if (cat.id === 'groceries') cat.monthlyBudget = 1300;
        if (cat.id === 'dining') cat.monthlyBudget = 550;
    }
    return data;
}

// ~9 weeks of plausible bank history. Deterministic (no RNG) so the demo reads
// the same for everyone; descriptions hit the default category keywords.
function sampleTransactionRows() {
    const rows = [];
    const add = (daysAgo, description, dollars) =>
        rows.push({ date: isoDaysAgo(daysAgo), description, amountCents: Math.round(dollars * 100) });

    // Fortnightly pay (Alex) + fortnightly freelance invoices (Sam).
    for (const d of [2, 16, 30, 44, 58]) add(d, 'SALARY BRIGHTPATH MEDIA PTY LTD', 2612.42);
    for (const d of [5, 19, 33, 47, 61]) add(d, 'TRANSFER SAM DESIGN INVOICE', 940);

    // Weekly-ish groceries, two shops a week.
    const grocery = [
        [1, 'WOOLWORTHS 1234 NEWTOWN', -142.3], [4, 'COLES 0482 MARRICKVILLE', -86.75],
        [8, 'WOOLWORTHS 1234 NEWTOWN', -128.4], [11, 'ALDI STORE 522 ASHFIELD', -74.2],
        [15, 'COLES 0482 MARRICKVILLE', -156.1], [18, 'WOOLWORTHS 1234 NEWTOWN', -94.6],
        [22, 'WOOLWORTHS 1234 NEWTOWN', -138.85], [25, 'ALDI STORE 522 ASHFIELD', -68.3],
        [29, 'COLES 0482 MARRICKVILLE', -149.95], [32, 'WOOLWORTHS 1234 NEWTOWN', -101.2],
        [36, 'WOOLWORTHS 1234 NEWTOWN', -133.7], [39, 'COLES 0482 MARRICKVILLE', -92.45],
        [43, 'ALDI STORE 522 ASHFIELD', -81.6], [46, 'WOOLWORTHS 1234 NEWTOWN', -147.25],
        [50, 'COLES 0482 MARRICKVILLE', -108.9], [53, 'WOOLWORTHS 1234 NEWTOWN', -126.4],
        [57, 'WOOLWORTHS 1234 NEWTOWN', -139.15], [60, 'COLES 0482 MARRICKVILLE', -88.6],
    ];
    grocery.forEach(([d, desc, amt]) => add(d, desc, amt));

    // Fuel + transport.
    for (const [d, amt] of [[3, -72.4], [13, -68.9], [24, -75.15], [37, -70.6], [51, -73.85]]) {
        add(d, 'AMPOL FOODARY ENMORE', amt);
    }
    for (const d of [2, 9, 16, 23, 30, 37, 44, 51, 58]) add(d, 'TRANSPORTFORNSW OPAL TRAVEL', -32.6);

    // Subscriptions (monthly).
    for (const d of [6, 36]) add(d, 'NETFLIX.COM SYDNEY', -18.99);
    for (const d of [10, 40]) add(d, 'SPOTIFY PREMIUM', -13.99);
    for (const d of [12, 42]) add(d, 'ICLOUD STORAGE APPLE.COM', -4.49);

    // Dining out.
    const dining = [
        [1, 'UBER EATS SYDNEY', -42.6], [5, 'MARY\'S BURGERS NEWTOWN CAFE', -58.4],
        [7, 'GLORIA JEANS COFFEE', -11.8], [12, 'SUSHI HUB CENTRAL', -24.5],
        [14, 'THE COURTHOUSE HOTEL RESTAURANT', -86.3], [19, 'GUZMAN Y GOMEZ NEWTOWN', -31.7],
        [21, 'GLORIA JEANS COFFEE', -9.4], [26, 'UBER EATS SYDNEY', -38.95],
        [28, 'CAFE SHENKIN ENMORE', -27.6], [34, 'DOMINO\'S PIZZA MARRICKVILLE', -29.85],
        [41, 'SOUL BURGER RESTAURANT', -44.2], [48, 'GLORIA JEANS COFFEE', -12.6],
        [55, 'UBER EATS SYDNEY', -51.3],
    ];
    dining.forEach(([d, desc, amt]) => add(d, desc, amt));

    // Utilities + phone + gym + health + shopping one-offs.
    add(20, 'AGL ENERGY PAYMENT', -186.4);
    add(27, 'AUSSIE BROADBAND PTY LTD', -89);
    for (const d of [8, 38]) add(d, 'TELSTRA PREPAID RECHARGE', -65);
    for (const d of [4, 11, 18, 25, 32, 39, 46, 53, 60]) add(d, 'ANYTIME FITNESS DEBIT', -25.9);
    add(17, 'CHEMIST WAREHOUSE NEWTOWN', -34.75);
    add(31, 'MEDIBANK PRIVATE PREMIUM', -199.2);
    add(9, 'KMART 1093 BROADWAY', -67.4);
    add(35, 'JB HI-FI CITY WESTFIELD', -129);
    add(49, 'BUNNINGS WAREHOUSE ALEXANDRIA', -84.55);
    add(45, 'BIG W 0244 EASTGARDENS', -43.2);

    return rows;
}

/**
 * Replace the current (empty) data with the sample household, generate its bank
 * history, and drop a welcome note in the feed. Returns the transaction count.
 */
export async function loadSampleData() {
    store.financeData = sampleFinanceData();
    try { localStorage.setItem(SAMPLE_FLAG_KEY, '1'); } catch (_) {}

    const rows = sampleTransactionRows();
    const txns = rows.map(r => makeTransaction({
        date: r.date,
        description: r.description,
        amountCents: r.amountCents,
        categoryId: categoriseDescription(r.description, store.financeData.categories),
        source: 'sample',
        importBatchId: SAMPLE_BATCH_ID,
    }));
    let added = 0;
    try {
        const res = await addTransactions(txns);
        added = res.added;
        await logEvent('import', { batchId: SAMPLE_BATCH_ID, count: added, sourceName: 'the sample bank history' });
        await logEvent('note', { text: "You're exploring Ledger with sample data — everything here is made up. When you're ready, use Reset to Factory Defaults in Settings and add your own numbers." });
    } catch (_) {
        // No IndexedDB: the config-side sample still works; the feed just stays quieter.
    }
    if (store.autoSave) store.autoSave.onDataChange();
    return added;
}

export function sampleDataActive() {
    try { return localStorage.getItem(SAMPLE_FLAG_KEY) === '1'; } catch (_) { return false; }
}

export function clearSampleFlag() {
    try { localStorage.removeItem(SAMPLE_FLAG_KEY); } catch (_) {}
}
