// Test cases for the "plan-migration" group (registered in src/test-registry.js).
// B3.1 to B3.9 (plan section 12). Pure: storage is injected, no DOM, no real localStorage.
// Shape: { name, fn(assert) }, assert(label, actual, expected).
// Fixtures are synthetic: the sample household and small hand-made objects.

import {
    needsPlanMigration, migratePlanModel, ensureAllocationIdentity, afterImport,
} from './plan-migration.js';
import { runMigrationChain, BACKUP_KEY } from './migration-chain.js';
import { legacySampleFinanceData } from './sample-data.js';
import { cloneDefaultFinanceData } from './defaults.js';
import { DEFAULT_CATEGORIES, categoriseDescription } from './categories.js';
import { calculateTotals } from '../calc/calculations.js';
import { planTotals } from '../calc/plan.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const cats = () => clone(DEFAULT_CATEGORIES);

// A small legacy-shaped save with default categories.
function legacy(essential, nonEssential, bills = []) {
    return {
        primaryIncomeIndex: 0,
        incomeSources: [{ name: 'Job', incomeType: 'salaried', grossAnnual: 80000, paySchedule: 'fortnightly' }],
        categories: cats(),
        essentialExpenses: essential.map(([name, amount, frequency]) => ({ name, amount, frequency: frequency || 'weekly' })),
        nonEssentialExpenses: nonEssential.map(([name, amount, frequency]) => ({ name, amount, frequency: frequency || 'weekly' })),
        bills,
        allocation: [{ name: 'Daily expenses', percentage: 100, currentBalance: 0, savingsGoal: 0 }],
    };
}

function categoryOf(data, name) {
    const item = data.plan.find((p) => p.name === name);
    return item ? item.categoryId : undefined;
}

function sampleTotals(data) {
    const t = calculateTotals(clone(data));
    return {
        ess: t.essentialWeeklyTotal, non: t.nonEssentialWeeklyTotal,
        savingsRate: t.savingsRate, netWorth: t.netWorth,
    };
}

function memStorage() {
    const map = new Map();
    let writes = 0;
    return {
        map,
        get writes() { return writes; },
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem(k, v) { writes++; map.set(k, String(v)); },
    };
}

export const PLAN_MIGRATION_TEST_CASES = [
    {
        name: 'B3.1 name mapping: the four ordered rules and the essential flag check',
        fn(assert) {
            const d = legacy(
                [['Rent', 100], ['Groceries', 100], ['Utilities & internet', 10], ['Transport & fuel', 10],
                 ['Health insurance', 10], ['Entertainment', 5]],
                [['Dining out & takeaway', 10], ['Streaming & subscriptions', 5, 'monthly'], ['Gym', 26], ['Hobbies & fun', 150, 'monthly']],
            );
            const changed = migratePlanModel(d);
            assert('changed', changed, true);
            assert('Rent (keyword)', categoryOf(d, 'Rent'), 'housing');
            assert('Groceries (name equality)', categoryOf(d, 'Groceries'), 'groceries');
            assert('Utilities & internet', categoryOf(d, 'Utilities & internet'), 'utilities');
            assert('Transport & fuel', categoryOf(d, 'Transport & fuel'), 'transport');
            assert('Health insurance (shared word)', categoryOf(d, 'Health insurance'), 'health');
            assert('Dining out & takeaway', categoryOf(d, 'Dining out & takeaway'), 'dining');
            assert('Streaming & subscriptions', categoryOf(d, 'Streaming & subscriptions'), 'subscriptions');
            assert('Gym falls to fitness (FT-R-60)', categoryOf(d, 'Gym'), 'fitness');
            assert('Hobbies & fun falls to other', categoryOf(d, 'Hobbies & fun'), 'other');
            assert('essential row matching only a non-essential category lands in other-essential',
                categoryOf(d, 'Entertainment'), 'other-essential');
            const oe = d.categories.find((c) => c.id === 'other-essential');
            assert('other-essential created on demand, essential', [oe.name, oe.essential, oe.bucketId], ['Other essential', true, null]);
            assert('every category has bucketId null', d.categories.every((c) => c.bucketId === null), true);
            assert('ids are deterministic', d.plan.map((p) => p.id).slice(0, 2).concat(d.plan.map((p) => p.id).slice(-1)),
                ['mig-ess-0', 'mig-ess-1', 'mig-non-3']);
            assert('legacy pointer', d.plan[6].legacy, { list: 'nonEssential', index: 0 });
        },
    },
    {
        name: 'B3.1b other-essential is not created when nothing needs it',
        fn(assert) {
            const d = legacy([['Rent', 100]], [['Gym', 26]]);
            migratePlanModel(d);
            assert('no other-essential', d.categories.some((c) => c.id === 'other-essential'), false);
            assert('other kept', d.categories.some((c) => c.id === 'other'), true);
        },
    },
    {
        name: 'B3.2 totals preserved on the sample household (2,072 and 366.62 a fortnight)',
        fn(assert) {
            const d = legacySampleFinanceData();
            const before = sampleTotals(d);
            const legacyBefore = clone([d.essentialExpenses, d.nonEssentialExpenses, d.bills]);
            const fortnight = (w) => Math.round(w * 2 * 100) / 100;
            assert('before essential per fortnight', fortnight(before.ess), 2072);
            assert('before non-essential per fortnight', fortnight(before.non), 366.62);
            assert('before net worth (HELP counts, FT-R-125)', before.netWorth, 82050);
            assert('pending', needsPlanMigration(d), true);
            assert('changed', migratePlanModel(d), true);
            assert('dataVersion 2', d.dataVersion, 2);
            const after = sampleTotals(d);
            assert('after equals before (ess, non, savings rate, net worth)', after, before);
            assert('after essential per fortnight', fortnight(after.ess), 2072);
            assert('after non-essential per fortnight', fortnight(after.non), 366.62);
            assert('planTotals agrees exactly', [planTotals(d).essentialWeekly, planTotals(d).nonEssentialWeekly], [before.ess, before.non]);
            assert('legacy arrays untouched', [d.essentialExpenses, d.nonEssentialExpenses, d.bills], legacyBefore);
            assert('summary counts', d.planMigration.counts, { essential: 5, nonEssential: 4, bills: 3 });
            assert('summary has a time and no error', [typeof d.planMigration.at, 'error' in d.planMigration], ['string', false]);
            assert('rules array', d.rules, []);
            assert('payAnchor null, never invented', d.incomeSources.map((s) => s.payAnchor), [null, null]);
        },
    },
    {
        name: 'B3.3 idempotence: a second run is a no-op',
        fn(assert) {
            const d = legacySampleFinanceData();
            const legacyBefore = clone([d.essentialExpenses, d.nonEssentialExpenses, d.bills]);
            migratePlanModel(d);
            const once = clone(d);
            assert('not pending any more', needsPlanMigration(d), false);
            assert('second run returns false', migratePlanModel(d), false);
            assert('deep-equal after the second run', clone(d), once);
            assert('legacy arrays deep-equal to before', [d.essentialExpenses, d.nonEssentialExpenses, d.bills], legacyBefore);
            assert('after-import hook changes nothing', afterImport(d), false);
        },
    },
    {
        name: 'B3.4 empty and default data',
        fn(assert) {
            const def = cloneDefaultFinanceData();
            assert('default is dataVersion 2', def.dataVersion, 2);
            assert('empty plan and rules', [def.plan, def.rules], [[], []]);
            assert('placeholder rows dropped', [def.essentialExpenses, def.nonEssentialExpenses], [[], []]);
            assert('default needs no migration', needsPlanMigration(def), false);
            const storage = memStorage();
            const res = runMigrationChain(def, { raw: JSON.stringify(def), storage });
            assert('no backup requested for default data', [res.backedUp, storage.map.has(BACKUP_KEY), res.aborted], [false, false, false]);

            const e = legacy([], []);
            assert('legacy-shaped empty lists are pending', needsPlanMigration(e), true);
            assert('migrates', migratePlanModel(e), true);
            assert('to an empty plan at version 2', [e.dataVersion, e.plan, e.planMigration.counts], [2, [], { essential: 0, nonEssential: 0, bills: 0 }]);
            assert('totals zero', planTotals(e).essentialWeekly + planTotals(e).nonEssentialWeekly, 0);
        },
    },
    {
        name: 'B3.5 bills become reminders',
        fn(assert) {
            const bills = [
                { id: 'b-rego', name: 'Car rego', amount: 214, frequency: 'quarterly', nextDue: '2026-12-01' },
                { id: 'b-phone', name: 'Widget plan', amount: 65, frequency: 'monthly', nextDue: '2026-12-05' },
                { id: 'b-cat', name: 'Gym pass', amount: 30, frequency: 'monthly', nextDue: '2026-12-09', categoryId: 'health' },
            ];
            const d = legacy([['Rent', 560]], [['Dining out', 20]], bills);
            const before = sampleTotals(d);
            const billsBefore = clone(d.bills);
            migratePlanModel(d);
            const planBills = d.plan.filter((p) => p.legacy && p.legacy.list === 'bill');
            assert('ids preserved', planBills.map((p) => p.id), ['b-rego', 'b-phone', 'b-cat']);
            assert('anchorDue from nextDue', planBills.map((p) => p.anchorDue), ['2026-12-01', '2026-12-05', '2026-12-09']);
            assert('reminders: inTotals false', planBills.map((p) => p.inTotals), [false, false, false]);
            assert('list rows count', d.plan.filter((p) => p.inTotals === true).length, 2);
            assert('frequency and amount unchanged', planBills.map((p) => [p.amount, p.frequency]), [[214, 'quarterly'], [65, 'monthly'], [30, 'monthly']]);
            assert('keyword category for rego', planBills[0].categoryId, 'transport');
            assert('bill with no categoryId gets a category', planBills.every((p) => typeof p.categoryId === 'string' && p.categoryId), true);
            assert('existing categoryId kept', planBills[2].categoryId, 'health');
            assert('fallback bill is listed for review', d.planMigration.reviewBills, ['b-phone']);
            assert('fallback names include it', d.planMigration.fallbacks.includes('Widget plan'), true);
            assert('totals unchanged', sampleTotals(d), before);
            assert('legacy bills untouched', d.bills, billsBefore);
            assert('envelopes untouched, no plan item from them', d.categories.map((c) => c.monthlyBudget).every((m) => m === 0) && d.plan.length === 5, true);
        },
    },
    {
        name: 'B3.5b envelopes stay a cap (FT-R-52)',
        fn(assert) {
            const d = legacy([['Groceries', 290]], []);
            d.categories.find((c) => c.id === 'groceries').monthlyBudget = 1300;
            const before = sampleTotals(d);
            migratePlanModel(d);
            assert('cap kept', d.categories.find((c) => c.id === 'groceries').monthlyBudget, 1300);
            assert('no extra plan item', d.plan.length, 1);
            assert('totals unchanged', sampleTotals(d), before);
        },
    },
    {
        name: 'B3.6 allocation identity: unique ids and roles by name',
        fn(assert) {
            const d = legacy([], []);
            d.allocation = [
                { name: 'Daily expenses', percentage: 60, currentBalance: 1 },
                { name: 'Daily expenses', percentage: 5, currentBalance: 2 },
                { name: 'Splurge', percentage: 10, currentBalance: 3 },
                { name: 'Smile (holiday fund)', percentage: 10, currentBalance: 4 },
                { name: 'Fire extinguisher', percentage: 15, currentBalance: 5 },
                { name: 'Mojo', percentage: 0, currentBalance: 0 },
                { name: 'Holidays!!', percentage: 0, currentBalance: 0 },
            ];
            const before = clone(d.allocation).map((r) => [r.name, r.percentage, r.currentBalance]);
            assert('changed', ensureAllocationIdentity(d), true);
            const ids = d.allocation.map((r) => r.id);
            assert('ids unique', new Set(ids).size, ids.length);
            assert('slug and -2 on collision', ids.slice(0, 3), ['daily-expenses', 'daily-expenses-2', 'splurge']);
            assert('roles by name through detectRole', d.allocation.map((r) => r.role),
                ['daily', null, 'splurge', 'smile', 'fire', 'mojo', null]);
            assert('names and numbers never change', d.allocation.map((r) => [r.name, r.percentage, r.currentBalance]), before);
            const again = clone(d.allocation);
            assert('idempotent', [ensureAllocationIdentity(d), d.allocation], [false, again]);
            const keep = { allocation: [{ id: 'x', name: 'Daily', role: 'fire' }, { name: 'X' }] };
            ensureAllocationIdentity(keep);
            assert('existing id and role kept; new id avoids existing', [keep.allocation[0].id, keep.allocation[0].role, keep.allocation[1].id], ['x', 'fire', 'x-2']);
            assert('tolerates missing allocation', ensureAllocationIdentity({}), false);
        },
    },
    {
        name: 'B3.7 cutover: each shape ignores the other source',
        fn(assert) {
            const d = legacySampleFinanceData();
            migratePlanModel(d);
            const stale = clone(d);
            stale.essentialExpenses = [{ name: 'Stale', amount: 99999, frequency: 'weekly' }];
            stale.nonEssentialExpenses = [{ name: 'Stale', amount: 88888, frequency: 'weekly' }];
            const t = calculateTotals(stale);
            assert('dataVersion 2 ignores stale legacy arrays', [t.essentialWeeklyTotal, t.nonEssentialWeeklyTotal],
                [sampleTotals(d).ess, sampleTotals(d).non]);
            const old = clone(d);
            delete old.dataVersion;
            old.plan = [{ id: 'p', categoryId: 'housing', name: 'X', amount: 7777, frequency: 'weekly', inTotals: true }];
            const o = calculateTotals(old);
            assert('an unmigrated object ignores plan', [o.essentialWeeklyTotal, o.nonEssentialWeeklyTotal],
                [sampleTotals(d).ess, sampleTotals(d).non]);
            const noPlanFlag = clone(d);
            noPlanFlag.plan.push({ id: 'r', categoryId: 'housing', name: 'Reminder', amount: 500, frequency: 'weekly', inTotals: false });
            assert('reminders never count', calculateTotals(noPlanFlag).essentialWeeklyTotal, sampleTotals(d).ess);
        },
    },
    {
        name: 'B3.8 safety check: a mismatch leaves dataVersion unset and sets planMigration.error',
        fn(assert) {
            // Two categories share an id with opposite flags (corrupt data). The matcher takes the
            // first, the totals read the last, so the weekly totals differ and the migration must abort.
            const d = legacy([['Rent', 100]], [['Gym', 26]]);
            d.categories = [
                { id: 'housing', name: 'Rent & Mortgage', essential: true, monthlyBudget: 0, keywords: ['rent'] },
                { id: 'housing', name: 'Rent & Mortgage', essential: false, monthlyBudget: 0, keywords: ['rent'] },
                { id: 'other', name: 'Other', essential: false, monthlyBudget: 0, keywords: [] },
            ];
            const res = migratePlanModel(d);
            assert('reports a change so the error is saved', res, true);
            assert('dataVersion stays unset', d.dataVersion, undefined);
            assert('error recorded', typeof d.planMigration.error, 'string');
            assert('no plan written', d.plan, undefined);
            assert('legacy lists untouched', [d.essentialExpenses.length, d.nonEssentialExpenses.length], [1, 1]);
            assert('still pending so it can retry', needsPlanMigration(d), true);
            assert('same error again is a no-op', migratePlanModel(d), false);
        },
    },
    {
        name: 'B3.8b chain: the sample passes the chain once, backup byte-exact, second pass is a no-op',
        fn(assert) {
            const d = legacySampleFinanceData();
            const raw = JSON.stringify({ financeData: d, guiSettings: {} });
            const storage = memStorage();
            let saves = 0;
            const r1 = runMigrationChain(d, { raw, storage, forceSave: () => { saves++; } });
            assert('changed, backed up, not aborted', [r1.changed, r1.backedUp, r1.aborted], [true, true, false]);
            assert('backup is the raw string', storage.map.get(BACKUP_KEY), raw);
            assert('one backup write, one forced save', [storage.writes, saves], [1, 1]);
            const once = clone(d);
            const r2 = runMigrationChain(d, { raw: JSON.stringify({ financeData: d }), storage, forceSave: () => { saves++; } });
            assert('second pass: no change, no backup, no save', [r2.changed, r2.backedUp, saves, storage.writes], [false, false, 1, 1]);
            assert('data deep-equal', clone(d), once);
        },
    },
    {
        name: 'B3.9 keyword claim (U31): categoriseDescription Groceries is other; the migration maps by name',
        fn(assert) {
            assert('keyword matcher alone', categoriseDescription('Groceries', DEFAULT_CATEGORIES), 'other');
            const d = legacy([['Groceries', 290]], []);
            migratePlanModel(d);
            assert('migration still maps to groceries', categoryOf(d, 'Groceries'), 'groceries');
        },
    },
];
