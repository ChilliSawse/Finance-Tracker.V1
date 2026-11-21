// The single migration sequence (Phase 1 plan section 9.3).
//
// Called once from loadData (autosave.js) and once from the JSON import path
// (events/import-export.js). Order:
//   1. the four legacy migrations, unchanged;
//   2. if any gated migration is pending, write the raw save to BACKUP_KEY
//      (byte for byte, only if the key is absent). A failed write aborts: no
//      new migration runs and the app carries on with the legacy shape;
//   3-5b. plan, bucket, income fields, asset and debt detail;
//   6. forceSave() once if any of 3-5b changed the data;
//   7. on import only, each module's afterImport(data).
// Each owner module keeps its own version guard and totals check, so the chain
// is idempotent. The legacy four never trigger the forced save (as today).
// Owner steps are atomic: each runs on a clone and is committed into data only
// if it returns without throwing. The first failure stops the chain: no later
// owner step, no forceSave, no afterImport, and the result is {aborted: true}.
// Steps committed before the failure are complete and consistent.

import {
    migrateIncomeSourceTypes, migrateAllocationFields, migrateLedgerFields, migrateVariableIncomeFields,
} from './migrations.js';
import * as plan from './plan-migration.js';
import * as bucket from './bucket-migration.js';
import * as income from './income-migration.js';
import * as assetDebt from './asset-debt-migration.js';

export const BACKUP_KEY = 'ft-backup-pre-plan';

const LEGACY_STEPS = [
    ['migrateIncomeSourceTypes', migrateIncomeSourceTypes],
    ['migrateAllocationFields', migrateAllocationFields],
    ['migrateLedgerFields', migrateLedgerFields],
    ['migrateVariableIncomeFields', migrateVariableIncomeFields],
];

/** The four owner steps in chain order. backupGate: pending => the backup is taken first. */
export const DEFAULT_MODULES = [
    { name: 'migratePlanModel', needs: plan.needsPlanMigration, migrate: plan.migratePlanModel, afterImport: plan.afterImport, backupGate: true },
    { name: 'migrateBucketModel', needs: bucket.needsBucketMigration, migrate: bucket.migrateBucketModel, afterImport: bucket.afterImport, backupGate: true },
    { name: 'migrateIncomeFields', needs: income.needsIncomeMigration, migrate: income.migrateIncomeFields, afterImport: income.afterImport, backupGate: false },
    { name: 'migrateAssetDebtDetail', needs: assetDebt.needsAssetDebtMigration, migrate: assetDebt.migrateAssetDebtDetail, afterImport: assetDebt.afterImport, backupGate: true },
];

function cloneData(data) {
    return typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data));
}

/** Replace data's contents in place (callers hold it by reference). */
function commitInto(data, clone) {
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, clone);
}

function defaultStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (err) {
        console.warn('Migration chain: storage unavailable.', err);
        return null;
    }
}

/**
 * @param {object} data - financeData, mutated in place.
 * @param {object} [opts]
 * @param {string|null} [opts.raw] - the raw saved string, copied byte for byte to the backup key.
 * @param {'load'|'import'} [opts.source]
 * @param {{getItem:Function,setItem:Function}|null} [opts.storage] - injected for Node runs.
 * @param {Function} [opts.forceSave] - called once if a new step changed the data.
 * @param {Function} [opts.trace] - called with each step name as it runs.
 * @param {Array} [opts.modules] - override of DEFAULT_MODULES (tests).
 * @returns {{changed:boolean, aborted:boolean, backedUp:boolean, errors:string[]}}
 */
export function runMigrationChain(data, opts = {}) {
    const { raw = null, source = 'load', forceSave = null, trace = null } = opts;
    const modules = opts.modules || DEFAULT_MODULES;
    const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    const result = { changed: false, aborted: false, backedUp: false, errors: [] };
    const note = (name) => { if (trace) trace(name); };
    const fail = (name, err) => {
        console.warn(`Migration chain: ${name} failed and was skipped.`, err);
        result.errors.push(name);
    };

    // 1. Legacy four, unchanged.
    for (const [name, fn] of LEGACY_STEPS) {
        note(name);
        try { fn(data); } catch (err) { fail(name, err); }
    }

    // 2. Backup before the first new mutation.
    let pending = false;
    for (const m of modules) {
        if (!m.backupGate) continue;
        try {
            if (m.needs(data)) pending = true;
        } catch (err) {
            fail(m.name + '.needs', err);
            result.aborted = true;
            return result;
        }
    }
    if (pending && raw != null) {
        try {
            if (!storage) throw new Error('no storage to write the backup to');
            if (storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw);
            result.backedUp = true;
        } catch (err) {
            console.warn('Migration chain: backup failed, running on the legacy shape.', err);
            result.aborted = true;
            return result;
        }
    }

    // 3 to 5b. The owner steps, in order.
    for (const m of modules) {
        note(m.name);
        try {
            const work = cloneData(data);
            const didChange = m.migrate(work);
            if (didChange) { commitInto(data, work); result.changed = true; }
        } catch (err) {
            fail(m.name, err);
            result.aborted = true;
            return result;
        }
    }

    // 6. One forced save, after the backup and after step 5b.
    if (result.changed && typeof forceSave === 'function') forceSave();

    // 7. Import only.
    if (source === 'import') {
        for (const m of modules) {
            try { m.afterImport(data); } catch (err) { fail(m.name + '.afterImport', err); }
        }
    }
    return result;
}
