// Test cases for the "bucket-migration" group (registered in src/test-registry.js).
// T20 (sample) and T21 (edges) of plan section 12, plus the abort, idempotence and defaults checks.
// Pure: storage is injected. Fixtures are synthetic (the sample household and hand-made rows).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    needsBucketMigration, migrateBucketModel, afterImport, templateAllocation, newLiabilityId,
} from './bucket-migration.js';
import { ensureAllocationIdentity } from './plan-migration.js';
import { runMigrationChain, BACKUP_KEY } from './migration-chain.js';
import { legacySampleFinanceData } from './sample-data.js';
import { cloneDefaultFinanceData } from './defaults.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

function memStorage() {
    const map = new Map();
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem(k, v) { map.set(k, String(v)); } };
}

const row = (name, percentage, currentBalance = 0, savingsGoal = 0, extra = {}) =>
    ({ name, percentage, currentBalance, savingsGoal, ...extra });

// The sample household with a different allocation, run through the whole chain.
function run(allocation, mutate) {
    const d = legacySampleFinanceData();
    d.allocation = allocation;
    if (mutate) mutate(d);
    const raw = JSON.stringify(d);
    const storage = memStorage();
    const result = runMigrationChain(d, { raw, source: 'load', storage });
    return { d, result, storage, raw };
}

const balanceCents = (d) => {
    let s = d.allocation.reduce((a, r) => a + Math.round(r.currentBalance * 100), 0);
    s += (d.bucketGoals || []).reduce((a, g) => a + Math.round(g.saved * 100), 0);
    s += d.savingModel.fire.targets.filter((t) => t.type === 'saver').reduce((a, t) => a + t.savedCents, 0);
    return s;
};
const byRole = (d, role) => d.allocation.find((r) => r.role === role);
const outcome = (d) => [d.savingModel.migration.outcome, d.savingModel.migration.reasons];

export const BUCKET_MIGRATION_TEST_CASES = [
    {
        name: 'T20 sample household lands as the template with the balance sum kept',
        fn(assert) {
            const d = legacySampleFinanceData();
            const input = clone(d.allocation);
            const sumBefore = d.allocation.reduce((a, r) => a + Math.round(r.currentBalance * 100), 0);
            const { d: m, result, storage, raw } = run(input);
            assert('legacy balance sum 11,850', sumBefore, 1185000);
            assert('chain ran clean and saved', [result.aborted, result.changed, result.errors], [false, true, []]);
            assert('backup is the raw string', storage.getItem(BACKUP_KEY), raw);
            assert('outcome template, no reasons', outcome(m), ['template', []]);
            assert('model identity', [m.savingModel.version, m.savingModel.id, m.savingModel.after], [1, 'bucket-method', 'Scott Pape']);
            assert('percentages unchanged, Mojo at 0%', m.allocation.map((r) => r.percentage), [60, 10, 10, 20, 0]);
            assert('roles', m.allocation.map((r) => r.role), ['daily', 'splurge', 'smile', 'fire', 'mojo']);
            assert('slots and kinds', m.allocation.map((r) => [r.slot, r.kind]),
                [[1, 'spend'], [2, 'spend'], [3, 'save'], [4, 'save'], [5, 'save']]);
            assert('Mojo row is auto-created', [byRole(m, 'mojo').autoCreated, byRole(m, 'mojo').id], [true, 'mojo']);
            assert('Smile goal moved: cost 4,000 saved 1,200, bucket 0', [m.bucketGoals.map((g) => [g.name, g.cost, g.saved, g.share, g.parentId]), byRole(m, 'smile').currentBalance],
                [[['holiday fund', 4000, 1200, 100, byRole(m, 'smile').id]], 0]);
            const t0 = m.savingModel.fire.targets[0];
            assert('Fire saver target first and active', [t0.type, t0.goalCents, t0.savedCents, t0.state], ['saver', 1000000, 800000, 'active']);
            assert('Fire list order after it', m.savingModel.fire.targets.map((t) => t.id),
                ['t-mig-fire', 'debt:l-credit-card', 'debt:l-car-loan', 'mojo', 'home', 'super']);
            assert('only the saver is active (home has no deposit goal yet)', m.savingModel.fire.targets.map((t) => t.state),
                ['active', 'queued', 'queued', 'queued', 'skipped', 'queued']);
            assert('Fire bucket balance 0', byRole(m, 'fire').currentBalance, 0);
            assert('balance sum 11,850 after', balanceCents(m), 1185000);
            const strip = (rows) => rows.map((r) => { const c = { ...r }; delete c.id; delete c.role; return c; });
            assert('legacyAllocation equals the input (B3 only added id and role before E4 ran)', strip(m.savingModel.legacyAllocation), input);
            const direct = legacySampleFinanceData();
            const directInput = clone(direct.allocation);
            migrateBucketModel(direct);
            assert('run alone, legacyAllocation deep-equals the input exactly', direct.savingModel.legacyAllocation, directInput);
            assert('auto-credit off', m.savingModel.autoCredit, { on: false, rolledThrough: null });
            assert('liabilities got ids, rest untouched', m.liabilities.map((l) => [l.id, l.name, l.balance]),
                [['l-car-loan', 'Car loan', 11200], ['l-credit-card', 'Credit card', 1850]]);
            assert('bank set-to seeded to today (card starts empty)', Object.keys(m.savingModel.transfers.bankSetTo).length, 4);
            assert('goalsMoved listed', m.savingModel.migration.goalsMoved, ['g-mig-smile', 't-mig-fire']);
            // second run is a no-op
            const before = JSON.stringify(m);
            const again = runMigrationChain(m, { raw: before, source: 'load', storage: memStorage() });
            assert('second chain run changes nothing', [again.changed, JSON.stringify(m)], [false, before]);
            assert('guard', [needsBucketMigration(m), migrateBucketModel(m)], [false, false]);
        },
    },
    {
        name: 'T21 edges: extras, Living/Savings, Mojo share, total 99, duplicate Smile',
        fn(assert) {
            const base = () => [row('Daily expenses', 55, 100), row('Splurge', 15, 50), row('Smile', 10, 30, 500), row('Fire extinguisher', 20, 70)];

            const tax = run([...base(), row('Tax', 0, 400, 0, { isTaxProvision: true })]).d;
            assert('extra Tax bucket: own, extra-top-level', outcome(tax), ['own', ['extra-top-level']]);
            assert('Tax keeps tag, name, balance, slot 7', [tax.allocation[4].isTaxProvision, tax.allocation[4].name, tax.allocation[4].currentBalance, tax.allocation[4].slot, tax.allocation[4].role],
                [true, 'Tax', 400, 7, null]);
            assert('own template identity', [tax.savingModel.id, tax.savingModel.name, tax.savingModel.basedOn, tax.savingModel.after], ['custom-1', 'My template', 'bucket-method', null]);

            const living = run([row('Living', 70, 900), row('Savings', 30, 300)]).d;
            assert('Living 70 / Savings 30: own, core-removed', outcome(living)[0], 'own');
            assert('reasons include core-removed', living.savingModel.migration.reasons.includes('core-removed'), true);
            assert('both unmapped, no role', [living.savingModel.migration.unmapped, living.allocation.slice(0, 2).map((r) => r.role)], [['Living', 'Savings'], [null, null]]);
            assert('slots 7 and 8, Mojo row appended', [living.allocation.map((r) => r.slot), living.allocation[2].role], [[7, 8, 5], 'mojo']);
            assert('percentages and balances untouched', living.allocation.slice(0, 2).map((r) => [r.percentage, r.currentBalance]), [[70, 900], [30, 300]]);

            const mojo = run([...base().slice(0, 3), row('Fire extinguisher', 15, 70), row('Mojo', 5, 1000, 3000)]).d;
            assert('Mojo with a share: own, mojo-share', outcome(mojo), ['own', ['mojo-share']]);
            assert('Mojo share and balance kept, no extra row, goal becomes a ladder step', [byRole(mojo, 'mojo').percentage, byRole(mojo, 'mojo').currentBalance, mojo.allocation.length, mojo.savingModel.mojo.steps],
                [5, 1000, 5, [{ id: 'mig-mojo', kind: 'custom', amount: 300000 }]]);

            const off = run([row('Daily expenses', 59, 0), row('Splurge', 10, 0), row('Smile', 10, 0), row('Fire extinguisher', 20, 0)]).d;
            assert('total 99: template, splitTotalOff, percentages untouched', [off.savingModel.migration.outcome, off.savingModel.migration.splitTotalOff, off.allocation.map((r) => r.percentage)],
                ['template', true, [59, 10, 10, 20, 0]]);

            const dup = run([row('Daily expenses', 60, 0), row('Splurge', 10, 0), row('Smile', 10, 500), row('Smile (travel)', 5, 700), row('Fire extinguisher', 15, 0)]).d;
            assert('duplicate Smile: own, second role null', [dup.savingModel.migration.outcome, dup.allocation[2].role, dup.allocation[3].role], ['own', 'smile', null]);
            assert('second Smile unmapped and takes slot 7, balance kept', [dup.savingModel.migration.unmapped, dup.allocation[3].slot, dup.allocation[3].currentBalance], [['Smile (travel)'], 7, 700]);

            const grow = run([...base(), row('Investments', 0, 20)]).d;
            assert('Grow bucket: own, role grow, slot 6', [grow.savingModel.migration.outcome, grow.allocation[4].role, grow.allocation[4].slot], ['own', 'grow', 6]);

            const sums = [tax, living, mojo, off, dup, grow].map((x) => x.savingModel.migration && balanceCents(x));
            assert('balance sums all positive and finite', sums.every((x) => Number.isInteger(x) && x >= 0), true);
        },
    },
    {
        name: 'T21 placeholder and empty land as the template at 60/10/10/20',
        fn(assert) {
            const ph = run([row('New Allocation', 100, 0)]).d;
            assert('placeholder: template at the guide split', [ph.savingModel.migration.outcome, ph.allocation.map((r) => [r.role, r.percentage])],
                ['template', [['daily', 60], ['splurge', 10], ['smile', 10], ['fire', 20], ['mojo', 0]]]);
            const empty = run([]).d;
            assert('empty: template', [empty.savingModel.migration.outcome, empty.allocation.map((r) => r.percentage)], ['template', [60, 10, 10, 20, 0]]);
            const none = run(null, (d) => { delete d.allocation; }).d;
            assert('missing allocation: template', [none.savingModel.migration.outcome, none.allocation.length], ['template', 5]);
            assert('an edited single row is not the placeholder', run([row('New Allocation', 100, 5)]).d.savingModel.migration.placeholder, false);
        },
    },
    {
        name: 'T21 a bucket with no id or role (and odd rows) does not throw',
        fn(assert) {
            let threw = false;
            const messy = [{ percentage: 50 }, { name: null, percentage: 'x', currentBalance: 'y' }, null, { name: 'Smile', percentage: 50, currentBalance: 10, savingsGoal: 20 }];
            try { ensureAllocationIdentity({ allocation: clone(messy) }); migrateBucketModel({ allocation: clone(messy), liabilities: [null, {}] }); } catch (e) { threw = true; }
            assert('no throw', threw, false);
            const h = { allocation: [{ percentage: 5 }] };
            ensureAllocationIdentity(h);
            assert('identity filled', [typeof h.allocation[0].id, h.allocation[0].role], ['string', null]);
            const d = { allocation: [{ percentage: 50 }, null], liabilities: [{ balance: 5 }, { name: 'Loan', balance: 3 }, { name: 'Loan', balance: 4 }] };
            migrateBucketModel(d);
            assert('liability ids unique', d.liabilities.map((l) => l.id), ['l-debt', 'l-loan', 'l-loan-2']);
            assert('null row left in place', d.allocation[1], null);
        },
    },
    {
        name: 'E4 a failed balance check aborts the chain and writes nothing',
        fn(assert) {
            const d = legacySampleFinanceData();
            const plain = (x) => JSON.stringify(x.allocation.map((r) => [r.name, r.percentage, r.currentBalance, r.id, r.role]));
            const before = JSON.stringify(d);
            const plainBefore = plain(d);
            let threw = false;
            try { migrateBucketModel(d, { testTamper: (w) => { w.alloc[0].currentBalance += 1; } }); } catch (e) { threw = true; }
            assert('throws on mismatch', threw, true);
            assert('data untouched, no savingModel', [JSON.stringify(d), d.savingModel], [before, undefined]);
            const calls = [];
            const modules = [
                { name: 'migrateBucketModel', needs: () => true, migrate: (x) => migrateBucketModel(x, { testTamper: (w) => { w.alloc[0].currentBalance += 1; } }), afterImport: () => false, backupGate: true },
                { name: 'next', needs: () => false, migrate: () => { calls.push('next'); return false; }, afterImport: () => false, backupGate: false },
            ];
            const r = runMigrationChain(d, { raw: JSON.stringify(d), storage: memStorage(), modules });
            assert('chain aborted, later step skipped, data identical', [r.aborted, calls, plain(d), d.savingModel], [true, [], plainBefore, undefined]);
        },
    },
    {
        name: 'E4 new setups: template allocation, auto-credit on, a new liability gets an id',
        fn(assert) {
            const f = cloneDefaultFinanceData();
            assert('five buckets at the guide split', f.allocation.map((r) => [r.id, r.role, r.percentage]),
                [['b-daily', 'daily', 60], ['b-splurge', 'splurge', 10], ['b-smile', 'smile', 10], ['b-fire', 'fire', 20], ['mojo', 'mojo', 0]]);
            assert('auto-credit on for new setups', f.savingModel.autoCredit, { on: true, rolledThrough: null });
            assert('no migration pending', [needsBucketMigration(f), migrateBucketModel(f)], [false, false]);
            assert('goals empty, Mojo first active target', [f.bucketGoals, f.savingModel.fire.targets.map((t) => [t.id, t.state])],
                [[], [['mojo', 'active'], ['home', 'skipped'], ['super', 'queued']]]);
            assert('template helper is fresh each call', templateAllocation() !== templateAllocation(), true);
            assert('newLiabilityId collides to -2', newLiabilityId([{ id: 'l-new-liability' }], 'New Liability'), 'l-new-liability-2');
        },
    },
    {
        name: 'E4 afterImport moves a stale pay-roll marker forward, never back',
        fn(assert) {
            const mk = (rolled, on) => ({
                primaryIncomeIndex: 0, incomeSources: [{ paySchedule: 'fortnightly', payAnchor: '2020-01-03' }],
                savingModel: { version: 1, autoCredit: { on, rolledThrough: rolled } },
            });
            const stale = mk('2021-01-01', true);
            assert('stale marker moves', [afterImport(stale), stale.savingModel.autoCredit.rolledThrough > '2021-01-01'], [true, true]);
            const off = mk('2021-01-01', false);
            assert('off: untouched', [afterImport(off), off.savingModel.autoCredit.rolledThrough], [false, '2021-01-01']);
            const future = mk('2999-01-01', true);
            assert('future marker not moved back', [afterImport(future), future.savingModel.autoCredit.rolledThrough], [false, '2999-01-01']);
            assert('no marker: untouched', afterImport(mk(null, true)), false);
        },
    },
];
