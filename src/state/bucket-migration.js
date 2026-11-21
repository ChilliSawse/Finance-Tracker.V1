// Bucket-model migration (owner: E4). M0 stub: nothing is pending, nothing changes.

/** True when the bucket model migration still has to run on this data. */
export function needsBucketMigration(data) {
    return false;
}

/** Runs the migration in place. Returns true when it changed the data. */
export function migrateBucketModel(data) {
    return false;
}

/** Hook run after a JSON import only (E4: move the pay-roll marker to the latest pay date). */
export function afterImport(data) {
    return false;
}
