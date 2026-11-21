// M0.1 to M0.6: the migration chain (section 9.3 of the Phase 1 plan).
// Each case makes exactly one assertion so tests.html grows by one per case.
// Pure: storage and forceSave are injected, no DOM, no real localStorage.

import { runMigrationChain, BACKUP_KEY } from './migration-chain.js';

const LEGACY = [
    'migrateIncomeSourceTypes', 'migrateAllocationFields',
    'migrateLedgerFields', 'migrateVariableIncomeFields',
];
const NEW_STEPS = ['migratePlanModel', 'migrateBucketModel', 'migrateIncomeFields', 'migrateAssetDebtDetail'];

// A save the four legacy migrations leave untouched: run them once up front.
function settledData() {
    const data = {
        dataVersion: 2, // B3: the plan step has nothing to do on a settled save
        savingModel: { version: 1 }, // E4: nor has the bucket step
        incomeSources: [{ name: 'Job', incomeType: 'salaried' }],
        allocation: [{ name: 'Daily', percentage: 100 }],
    };
    runMigrationChain(data, { storage: null, modules: [] });
    return data;
}

function memStorage(opts = {}) {
    const map = new Map(Object.entries(opts.initial || {}));
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem(k, v) { if (opts.throwOnSet) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    };
}

// A fake owner module: pending until it has stamped the data, then idempotent.
function fakeModules(log) {
    const mod = (name, needs, migrate, field) => ({
        name,
        needs: (d) => needs(d, field),
        migrate: (d) => { log.push(name); if (d[field]) return false; d[field] = 1; return true; },
        afterImport: (d) => { log.push('afterImport:' + name); return false; },
    });
    const pending = (d, f) => !d[f];
    return [
        { ...mod('migratePlanModel', pending, null, 'p'), backupGate: true },
        { ...mod('migrateBucketModel', pending, null, 'b'), backupGate: true },
        { ...mod('migrateIncomeFields', pending, null, 'i'), backupGate: false },
        { ...mod('migrateAssetDebtDetail', pending, null, 'a'), backupGate: true },
    ];
}

export const CHAIN_TEST_CASES = [
    {
        name: 'M0.1 chain order: four legacy migrations, then plan, bucket, income, asset and debt',
        fn(assert) {
            const seen = [];
            runMigrationChain(settledData(), { storage: memStorage(), trace: (n) => seen.push(n) });
            assert('order', seen, [...LEGACY, ...NEW_STEPS]);
        },
    },
    {
        name: 'M0.2 backup: byte-exact raw string, before the first mutation, only when pending and absent',
        fn(assert) {
            const raw = '{"financeData":{"x":1},  "guiSettings":{}}';
            const order = [];
            const modules = fakeModules([]);
            modules[0].migrate = (d) => { order.push('mutate'); d.p = 1; return true; };
            const st = memStorage();
            const setItem = st.setItem;
            st.setItem = (k, v) => { order.push('write:' + k); setItem(k, v); };
            runMigrationChain(settledData(), { raw, storage: st, modules });
            const exact = st.map.get(BACKUP_KEY) === raw;
            // Key already present: left alone. Nothing pending: not written.
            const st2 = memStorage({ initial: { [BACKUP_KEY]: 'older' } });
            runMigrationChain(settledData(), { raw, storage: st2, modules: fakeModules([]) });
            const st3 = memStorage();
            const done = settledData(); Object.assign(done, { p: 1, b: 1, i: 1, a: 1 });
            runMigrationChain(done, { raw, storage: st3, modules: fakeModules([]) });
            assert('exact, first, kept, skipped',
                [exact, order[0], st2.map.get(BACKUP_KEY), st3.map.has(BACKUP_KEY)],
                [true, 'write:' + BACKUP_KEY, 'older', false]);
        },
    },
    {
        name: 'M0.3 abort: a failing backup write gives aborted and changes no field',
        fn(assert) {
            const data = settledData();
            const before = JSON.stringify(data);
            const log = [];
            const res = runMigrationChain(data, {
                raw: '{"a":1}', storage: memStorage({ throwOnSet: true }), modules: fakeModules(log),
                forceSave: () => log.push('save'),
            });
            assert('aborted, untouched, nothing ran',
                [res.aborted, JSON.stringify(data) === before, log.length], [true, true, 0]);
        },
    },
    {
        name: 'M0.4 idempotence: a second run leaves the object deep-equal',
        fn(assert) {
            const data = settledData();
            const opts = () => ({ raw: '{}', storage: memStorage(), modules: fakeModules([]) });
            runMigrationChain(data, opts());
            const afterFirst = JSON.stringify(data);
            const second = runMigrationChain(data, opts());
            assert('equal and unchanged', [JSON.stringify(data) === afterFirst, second.changed], [true, false]);
        },
    },
    {
        name: 'M0.5 save: forceSave once when anything changed, zero times when nothing did',
        fn(assert) {
            let saves = 0;
            const forceSave = () => { saves++; };
            const changedData = settledData();
            runMigrationChain(changedData, { raw: '{}', storage: memStorage(), modules: fakeModules([]), forceSave });
            const afterChange = saves;
            runMigrationChain(settledData(), { raw: '{}', storage: memStorage(), forceSave }); // the stubs
            assert('1 then still 1', [afterChange, saves], [1, 1]);
        },
    },
    {
        name: 'M0.6 import hooks: afterImport runs for import and not for load',
        fn(assert) {
            const imp = [], load = [];
            runMigrationChain(settledData(), { source: 'import', storage: memStorage(), modules: fakeModules(imp) });
            runMigrationChain(settledData(), { source: 'load', storage: memStorage(), modules: fakeModules(load) });
            const hooks = (l) => l.filter((x) => x.startsWith('afterImport:')).length;
            assert('4 on import, 0 on load', [hooks(imp), hooks(load)], [4, 0]);
        },
    },
    {
        name: 'M0.7 atomic step: a module that mutates then throws leaves data byte-identical',
        fn(assert) {
            const data = settledData();
            const before = JSON.stringify(data);
            const modules = fakeModules([]);
            modules[0].migrate = (d) => { d.p = 1; d.allocation.push({ name: 'half' }); throw new Error('boom'); };
            const res = runMigrationChain(data, { raw: '{}', storage: memStorage(), modules });
            assert('untouched and aborted', [JSON.stringify(data) === before, res.aborted], [true, true]);
        },
    },
    {
        name: 'M0.8 stop on first failure: a failing step 2 means step 3 never runs and no forceSave',
        fn(assert) {
            const log = [];
            const modules = fakeModules(log);
            modules[1].migrate = () => { log.push('migrateBucketModel'); throw new Error('boom'); };
            let saves = 0;
            const res = runMigrationChain(settledData(), {
                source: 'import', raw: '{}', storage: memStorage(), modules, forceSave: () => { saves++; },
            });
            assert('plan ran, bucket failed, rest and hooks skipped, no save',
                [log, saves, res.aborted], [['migratePlanModel', 'migrateBucketModel'], 0, true]);
        },
    },
];
