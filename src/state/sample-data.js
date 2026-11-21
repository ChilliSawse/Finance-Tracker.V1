// Sample household (B5): Alex and Sam, a fictional Australian demo so someone can explore Ledger
// before committing their own numbers. Loaded from onboarding; cleared by Settings, Your data, "Erase all data"
// (which also deletes the sample transaction batch).
// Every figure comes from the app's own engine (FT-R-48, FT-R-87): pay from calculateTotals, the
// split from applySuggestedSplit, bills matched by matchBills. Dates are relative to today.

import { store } from './store.js';
import { cloneDefaultFinanceData } from './defaults.js';
import { CURRENT_TAX_YEAR } from '../calc/tax-au.js';
import { resolveCategory } from './categories.js';
import { makeTransaction, addTransactions } from './transactions.js';
import { logEvent } from './eventlog.js';
import { migrateAssetDebtDetail } from './asset-debt-migration.js';
import { calculateTotals } from '../calc/calculations.js';
import { matchBills } from '../calc/bill-match.js';
import { billOccurrences, addMonthsClamped, addDays, toIso, parseIso } from '../calc/pay-cycle.js';
import { getBuckets, applySuggestedSplit, addGoal, setGoalShares, addTarget, moveTarget, removeTarget } from './saving-model.js';

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

/** The sample household in the legacy (pre plan model) shape. Also the B3 migration fixture. */
export function legacySampleFinanceData() {
    const data = cloneDefaultFinanceData();
    delete data.dataVersion;
    delete data.plan;
    delete data.savingModel; // E4: the bucket model is what the migration adds
    delete data.bucketGoals;
    delete data.assetDebtVersion; // F2: the asset and debt detail is what the migration adds
    delete data.fiSettings.inflation;
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

// ---------- B5: the sample household built on the plan model ----------

const rel = (todayIso, days) => addDays(todayIso, days);

function todayIsoOf(today) {
    if (typeof today === 'string') return toIso(parseIso(today));
    const d = today instanceof Date ? today : new Date();
    return toIso(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}

const cents = (dollars) => Math.round(dollars * 100);

// Bank wording for the plan's dated items (the bills match these through B8's matcher).
const BILL_TEXT = {
    'p-rent': 'RAY WHITE NEWTOWN RENT',
    'p-phone': 'TELSTRA PREPAID RECHARGE',
    'p-car-insurance': 'NRMA INSURANCE PREMIUM',
    'p-netflix': 'NETFLIX.COM SYDNEY',
    'p-rego': 'SERVICE NSW REGO',
};

function samplePlan(t) {
    const item = (id, categoryId, name, amount, frequency, extra = {}) => ({
        id, categoryId, name, amount, frequency, anchorDue: null, matchRule: null, bucketId: null, inTotals: true, ...extra,
    });
    return [
        // Essentials (A$2,072 a fortnight). Rent is paid fortnightly, so its due date is a pay-day bill.
        item('p-rent', 'housing', 'Rent', 1120, 'fortnightly', { anchorDue: rel(t, -60), matchRule: { keys: ['ray white'] } }),
        item('p-groceries', 'groceries', 'Groceries', 290, 'weekly'),
        item('p-utilities', 'utilities', 'Utilities & internet', 75, 'weekly'),
        item('p-transport', 'transport', 'Transport & fuel', 65, 'weekly'),
        item('p-health', 'health', 'Health insurance', 46, 'weekly'),
        // Non-essentials (A$366.62 a fortnight). Netflix is split out of the old 55 a month so it can be matched.
        item('p-dining', 'dining', 'Dining out & takeaway', 110, 'weekly'),
        item('p-netflix', 'entertainment', 'Netflix', 18.99, 'monthly', { anchorDue: addMonthsClamped(rel(t, 0), -2) }),
        item('p-subscriptions', 'subscriptions', 'Other subscriptions', 36.01, 'monthly'),
        item('p-gym', 'fitness', 'Gym', 26, 'weekly'),
        item('p-hobbies', 'other', 'Hobbies & fun', 150, 'monthly'),
        // Bills that sit inside the lines above (FT-R-53): dated, never double counted in the totals.
        item('p-phone', 'phone-internet', 'Phone plan', 65, 'monthly', { anchorDue: addMonthsClamped(rel(t, 4), -2), inTotals: false }),
        item('p-car-insurance', 'insurance', 'Car insurance', 128.4, 'monthly', { anchorDue: addMonthsClamped(rel(t, 9), -2), inTotals: false, matchRule: { keys: ['nrma'] } }),
        item('p-rego', 'transport', 'Car rego', 214, 'quarterly', { anchorDue: addMonthsClamped(rel(t, 23), -6), inTotals: false }),
    ];
}

/** A source's net pay per cycle from the engine, in cents: its own calculated net over its cycles. */
function engineNetPerCycleCents(data, sourceIndex, today) {
    const probe = structuredClone(data);
    calculateTotals(probe, { today: parseIso(today) });
    const s = probe.incomeSources[sourceIndex];
    const cycles = s.paySchedule === 'weekly' ? 52 : s.paySchedule === 'monthly' ? 12 : 26;
    return Math.round((s._calculatedNetAnnual / cycles) * 100);
}

/**
 * The sample household, pure: {data, rows, today}. `rows` are bank-history rows
 * {id, date, description, amountCents, categoryId, status, source, bucketId?, note?, billMatch?}.
 * `today` is an ISO date or a Date (default now); every date is relative to it.
 * The asset and debt detail (chain step 5b) is already applied, so loading the sample never makes the
 * chain copy the sample into the one-time pre-migration backup slot (G6W12-2). `opts.beforeAssetDebt`
 * (a test seam) leaves the pre-5b shape instead.
 */
export function buildSampleHousehold(today, opts = {}) {
    const t = todayIsoOf(today);
    const data = cloneDefaultFinanceData();
    data.primaryIncomeIndex = 0;
    const alex = {
        name: 'Alex — marketing coordinator', incomeType: 'salaried', grossAnnual: 85000, paySchedule: 'fortnightly', hoursPerCycle: 76,
        taxRemoved: null, invoicedPayPostTax: null, incomeEvents: [], payAnchor: rel(t, -4),
        hourlyRate: null, hoursPerWeek: 38, superPct: 12, basis: 'salary', taxCheck: null,
        withholding: { claimsTaxFree: true, hasStudyDebt: true, medicareExemption: false, extraPerPay: 0 },
    };
    // Hourly rate from the source's own fields: gross over hours a cycle times 26 (85,000 / 1,976 = 43.02).
    alex.hourlyRate = Math.round((alex.grossAnnual / (alex.hoursPerCycle * 26)) * 100) / 100;
    const sam = {
        name: 'Sam — freelance design', incomeType: 'selfEmployed', grossAnnual: 0, paySchedule: 'fortnightly', hoursPerCycle: 20,
        taxRemoved: 120, invoicedPayPostTax: 940, incomeEvents: [], payAnchor: rel(t, -1),
        hourlyRate: null, hoursPerWeek: 10, superPct: null, basis: 'selfEmployed', taxCheck: null,
        withholding: { claimsTaxFree: true, hasStudyDebt: false, medicareExemption: false, extraPerPay: 0 },
    };
    data.incomeSources = [alex, sam];
    data.taxSettings = { financialYear: CURRENT_TAX_YEAR, includeMedicareLevy: true, helpBalance: 24600, includeHelpInEstimate: true };
    data.plan = samplePlan(t);
    data.rules = [];
    data.assets = [
        { name: 'Savings account', balance: 16500, interestRate: 4.8, interestFrequency: 'monthly' },
        { name: 'Superannuation', balance: 78400 },
        { name: 'ETF portfolio', balance: 24800, dividendYield: 3.5, dividendFrequency: 'quarterly' },
    ];
    data.liabilities = [
        { id: 'l-car-loan', name: 'Car loan', balance: 11200, interestRate: 7.9 },
        { id: 'l-credit-card', name: 'Credit card', balance: 1850, interestRate: 20.99 },
    ];
    for (const cat of data.categories) {
        if (cat.id === 'groceries') cat.monthlyBudget = 1300;
        if (cat.id === 'dining') cat.monthlyBudget = 550;
    }
    // F2 step 5b: applied here, not on load (its totals check guards net worth, A$106,650).
    delete data.assetDebtVersion;
    delete data.fiSettings.inflation;
    if (!opts.beforeAssetDebt) migrateAssetDebtDetail(data);

    // Buckets: the engine's expenses-first split (Daily about 60.3%), not the book's 60/10/10/20 (FT-R-87).
    applySuggestedSplit(data);
    const row = (role) => data.allocation.find((r) => r.role === role);
    row('daily').currentBalance = 2200;
    row('splurge').currentBalance = 450;
    row('fire').currentBalance = 8000;
    row('mojo').currentBalance = 1400;
    // Smile: one goal (the holiday) with two sub-buckets. The goal's balance is its children's.
    row('smile').savingsGoal = 4000;
    const trip = addGoal(data, row('smile').id, { name: 'Bali trip', cost: 4000, saved: 0 });
    const flights = addGoal(data, trip.item.id, { name: 'Flights', cost: 1800, saved: 700 });
    const stay = addGoal(data, trip.item.id, { name: 'Accommodation', cost: 2200, saved: 500 });
    setGoalShares(data, trip.item.id, { [flights.item.id]: 45, [stay.item.id]: 55 });
    // Fire list, FT-R-82: debts first with the card first, then Mojo, home, Super. The old A$10,000 pot is not on it.
    for (const old of data.savingModel.fire.targets.filter((x) => x.type === 'saver')) removeTarget(data, old.id);
    addTarget(data, { type: 'debt', liabilityId: 'l-car-loan' });
    addTarget(data, { type: 'debt', liabilityId: 'l-credit-card' });
    const indexOf = (id) => data.savingModel.fire.targets.findIndex((x) => x.id === id);
    while (indexOf('debt:l-credit-card') > 0) moveTarget(data, 'debt:l-credit-card', -1);
    while (indexOf('debt:l-car-loan') > 1) moveTarget(data, 'debt:l-car-loan', -1);
    // What the bank transfers were last set to: the split rounded to the nearest ten dollars per pay, so the review's "Transfers to update" has rows to tick.
    for (const b of getBuckets(data, t).filter((x) => !x.parentId && x.role !== 'mojo' && x.role !== 'grow')) {
        data.savingModel.transfers.bankSetTo[b.id] = Math.round(b.perPayCents / 1000) * 1000;
    }

    // Pay from the engine at generation time: no literal figure (the old 2,612.42 ignored HELP and Medicare).
    const alexPay = engineNetPerCycleCents(data, 0, t);
    const rows = [];
    let n = 0;
    const add = (daysAgo, description, amountCents, extra = {}) => {
        const { categoryId: chosen, ...rest } = extra;
        const c = chosen ? { categoryId: chosen, status: 'ok' } : resolveCategory(description, null, data.categories, data.rules);
        rows.push({ id: `sample-row-${++n}`, date: rel(t, -daysAgo), description, amountCents, categoryId: c.categoryId, status: c.status, source: 'sample', ...rest });
    };

    // Income. Alex's pay lands on the pay anchor and every fortnight back; Sam invoices on his own cycle.
    for (const d of [4, 18, 32, 46, 60]) add(d, 'SALARY BRIGHTPATH MEDIA PTY LTD', alexPay, { categoryId: 'income' });
    for (const d of [1, 15, 29, 43, 57]) add(d, 'TRANSFER SAM DESIGN INVOICE', cents(940), { categoryId: 'income' });

    // Bills: one row per past due date of each dated plan item. The ones due from today on stay unpaid.
    for (const item of data.plan.filter((x) => x.anchorDue)) {
        for (const due of billOccurrences(item, rel(t, -62), rel(t, -1))) {
            add(Math.round((parseIso(t) - parseIso(due)) / 86400000), BILL_TEXT[item.id], -cents(item.amount));
        }
    }

    // This pay (0 to 4 days ago): rent plus three Daily shops, so Daily has spent A$1,374.45.
    add(1, 'WOOLWORTHS 1234 NEWTOWN', -cents(142.3));
    add(2, 'TRANSPORTFORNSW OPAL TRAVEL', -cents(39.75));
    add(3, 'AMPOL FOODARY ENMORE', -cents(72.4));
    // Splurge-side rows this pay: dining, an uncategorisable merchant, a gym debit, a cash coffee typed in by hand.
    add(1, 'UBER EATS SYDNEY', -cents(42.6));
    add(2, 'SQ *MELB FARMERS MKT', -cents(32));
    add(1, 'Coffee and a bake (cash)', -cents(9.5), { categoryId: 'dining', source: 'manual', note: 'Typed in by hand' });
    add(4, 'ANYTIME FITNESS DEBIT', -cents(25.9));

    // Earlier pays.
    const grocery = [
        [8, 'WOOLWORTHS 1234 NEWTOWN', -128.4], [11, 'ALDI STORE 522 ASHFIELD', -74.2],
        [15, 'COLES 0482 MARRICKVILLE', -156.1], [18, 'WOOLWORTHS 1234 NEWTOWN', -94.6],
        [22, 'WOOLWORTHS 1234 NEWTOWN', -138.85], [25, 'ALDI STORE 522 ASHFIELD', -68.3],
        [29, 'COLES 0482 MARRICKVILLE', -149.95], [32, 'WOOLWORTHS 1234 NEWTOWN', -101.2],
        [36, 'WOOLWORTHS 1234 NEWTOWN', -133.7], [39, 'COLES 0482 MARRICKVILLE', -92.45],
        [43, 'ALDI STORE 522 ASHFIELD', -81.6], [46, 'WOOLWORTHS 1234 NEWTOWN', -147.25],
        [50, 'COLES 0482 MARRICKVILLE', -108.9], [53, 'WOOLWORTHS 1234 NEWTOWN', -126.4],
        [57, 'WOOLWORTHS 1234 NEWTOWN', -139.15], [60, 'COLES 0482 MARRICKVILLE', -88.6],
    ];
    grocery.forEach(([d, desc, amt]) => add(d, desc, cents(amt)));
    for (const [d, amt] of [[13, -68.9], [24, -75.15], [37, -70.6], [51, -73.85]]) add(d, 'AMPOL FOODARY ENMORE', cents(amt));
    for (const d of [9, 16, 23, 30, 37, 44, 51, 58]) add(d, 'TRANSPORTFORNSW OPAL TRAVEL', -cents(32.6));
    for (const d of [10, 40]) add(d, 'SPOTIFY PREMIUM', -cents(13.99));
    for (const d of [12, 42]) add(d, 'ICLOUD STORAGE APPLE.COM', -cents(4.49));
    const dining = [
        [5, "MARY'S BURGERS NEWTOWN CAFE", -58.4], [7, 'GLORIA JEANS COFFEE', -11.8], [12, 'SUSHI HUB CENTRAL', -24.5],
        [14, 'THE COURTHOUSE HOTEL RESTAURANT', -86.3], [19, 'GUZMAN Y GOMEZ NEWTOWN', -31.7],
        [21, 'GLORIA JEANS COFFEE', -9.4], [26, 'UBER EATS SYDNEY', -38.95], [28, 'CAFE SHENKIN ENMORE', -27.6],
        [34, "DOMINO'S PIZZA MARRICKVILLE", -29.85], [41, 'SOUL BURGER RESTAURANT', -44.2],
        [48, 'GLORIA JEANS COFFEE', -12.6], [55, 'UBER EATS SYDNEY', -51.3],
    ];
    dining.forEach(([d, desc, amt]) => add(d, desc, cents(amt)));
    add(20, 'AGL ENERGY PAYMENT', -cents(186.4));
    add(27, 'AUSSIE BROADBAND PTY LTD', -cents(89));
    for (const d of [11, 18, 25, 32, 39, 46, 53, 60]) add(d, 'ANYTIME FITNESS DEBIT', -cents(25.9));
    add(17, 'CHEMIST WAREHOUSE NEWTOWN', -cents(34.75));
    add(31, 'MEDIBANK PRIVATE PREMIUM', -cents(199.2));
    add(35, 'JB HI-FI CITY WESTFIELD', -cents(129));
    add(49, 'BUNNINGS WAREHOUSE ALEXANDRIA', -cents(84.55));
    add(45, 'BIG W 0244 EASTGARDENS', -cents(43.2));
    // One row moved to a different bucket by hand: a Kmart shop that is really household basics.
    add(9, 'KMART 1093 BROADWAY', -cents(67.4), { bucketId: row('daily').id, note: 'Household basics, so it comes out of Daily' });
    // Uncategorisable merchants stay in To review (FT-R-55).
    add(12, 'PAYPAL *4F9K2L', -cents(24.9));
    add(27, 'TRYBOOKING 8841923', -cents(45));

    // Match the bills to the rows (B8). Matched rows carry a billMatch; unmatched bills stay due or upcoming.
    const matched = matchBills(rows, data.plan).rows;
    matched.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { data, rows: matched, today: t };
}

/**
 * Replace the current (empty) data with the sample household, generate its bank
 * history, and drop a welcome note in the feed. Returns the transaction count.
 */
export async function loadSampleData() {
    const built = buildSampleHousehold();
    store.financeData = built.data;
    try { localStorage.setItem(SAMPLE_FLAG_KEY, '1'); } catch (_) { /* storage full or blocked: skip, deliberate */ }

    const txns = built.rows.map((r) => makeTransaction({
        date: r.date,
        description: r.description,
        amountCents: r.amountCents,
        categoryId: r.categoryId,
        status: r.status,
        source: r.source,
        importBatchId: SAMPLE_BATCH_ID,
        ...(r.bucketId ? { bucketId: r.bucketId } : {}),
        ...(r.note ? { note: r.note } : {}),
        ...(r.billMatch ? { billMatch: r.billMatch } : {}),
    }));
    let added = 0;
    try {
        const res = await addTransactions(txns);
        added = res.added;
        await logEvent('import', { batchId: SAMPLE_BATCH_ID, count: added, sourceName: 'the sample bank history' });
        await logEvent('note', { text: "You're exploring Ledger with sample data — everything here is made up. When you're ready, use Settings, Your data, Erase all data, and add your own numbers." });
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
    try { localStorage.removeItem(SAMPLE_FLAG_KEY); } catch (_) { /* storage full or blocked: skip, deliberate */ }
}
