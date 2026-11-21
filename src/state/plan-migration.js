// Plan-model migration (owner: B3). M0 stub: nothing is pending, nothing changes.
// B3 replaces the bodies; the exported names and the (data) signatures are fixed
// by docs/PHASE1-CONTRACT.md and wired in migration-chain.js.

/** True when the plan model migration still has to run on this data. */
export function needsPlanMigration(data) {
    return false;
}

/** Runs the migration in place. Returns true when it changed the data. */
export function migratePlanModel(data) {
    return false;
}

/** Hook run after a JSON import only. */
export function afterImport(data) {
    return false;
}
