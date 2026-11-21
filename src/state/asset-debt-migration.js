// Asset and debt detail migration (owner: F2, chain step 5b). M0 stub: nothing is
// pending, nothing changes. F2 replaces the bodies; its backup condition is
// needsAssetDebtMigration, already wired into migration-chain.js.

/** True when the asset and debt migration still has to run on this data. */
export function needsAssetDebtMigration(data) {
    return false;
}

/** Runs the migration in place. Returns true when it changed the data. */
export function migrateAssetDebtDetail(data) {
    return false;
}

/** Hook run after a JSON import only. */
export function afterImport(data) {
    return false;
}
