// Reference overrides migration (FT-0032 DB7, R3 step R6): adds data.refOverrides = { v, dataVersionSeen, items }.
// Items are '<kind>:<id>' -> { op: 'hide' | 'patch', patch?, baseRev, at }; the lazy ref-overrides.js reads and edits them and
// repairs a missing or non-object `items`. Core chunk, so kept tiny. Idempotent; a field with v >= 1 is never touched.

export const needsRefOverridesMigration = (d) => !!d && typeof d === 'object' && !(d.refOverrides && d.refOverrides.v >= 1);

export function migrateRefOverrides(d) {
    if (!needsRefOverridesMigration(d)) return false;
    d.refOverrides = { v: 1, dataVersionSeen: null, items: {} };
    return true;
}

/** The chain entry. No backup is needed: the step only adds an empty field. */
export const refOverridesStep = { name: 'migrateRefOverrides', needs: needsRefOverridesMigration, migrate: migrateRefOverrides, afterImport: () => false };
