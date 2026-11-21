// Income-fields migration (owner: C4). M0 stub: nothing is pending, nothing changes.
// Independent of the plan and bucket migrations; idempotent.

/** True when the income-fields migration still has to run on this data. */
export function needsIncomeMigration(data) {
    return false;
}

/** Runs the migration in place. Returns true when it changed the data. */
export function migrateIncomeFields(data) {
    return false;
}

/** Hook run after a JSON import only. */
export function afterImport(data) {
    return false;
}
