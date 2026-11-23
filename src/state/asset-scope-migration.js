// Asset scope migration (FT-0032 DB10, FT-R-125). Chain step after reference overrides. Core chunk, so kept tiny.
//
// Adds, only where absent:
//   assets[i].use = 'liveIn' and assets[i].useSuggested = true, on a property (kind 'appreciating'): a home counts in net
//     worth but not toward FI until the person says it is an investment (FT-R-125 1), and the default stays suggested
//     until confirmed (FT-R-117). Other assets get no field (absent = not a property).
//   fiSettings.multiple = 25 when it is missing or not a positive number (FT-R-125 5; the person's own choice is kept).
//   data.assetScopeVersion = 1, last.
// Idempotent behind assetScopeVersion >= 1. Names, balances, kinds and rates are never touched (the asset and debt step's
// own totals check is unaffected). The net worth shown does change at this release, because HELP now counts in it
// (calculateTotals, FT-R-125); that is the maths, not this migration.

export const DEFAULT_FI_MULTIPLE = 25;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export const needsAssetScopeMigration = (d) => isObj(d) && !(d.assetScopeVersion >= 1);

export function migrateAssetScope(d) {
    if (!needsAssetScopeMigration(d)) return false;
    if (Array.isArray(d.assets)) {
        for (const a of d.assets) {
            if (!isObj(a) || a.kind !== 'appreciating') continue;
            if (a.use === undefined) a.use = 'liveIn';
            if (a.useSuggested === undefined) a.useSuggested = a.use === 'liveIn';
        }
    }
    if (isObj(d.fiSettings) && !(typeof d.fiSettings.multiple === 'number' && d.fiSettings.multiple > 0)) d.fiSettings.multiple = DEFAULT_FI_MULTIPLE;
    d.assetScopeVersion = 1;
    return true;
}

/** The chain entry. No backup gate: the step only adds fields and never touches a balance, kind or rate. It does not change the listed assets or debts; net worth moves only through the new HELP rule in calculateTotals (FT-R-125), not through this step. */
export const assetScopeStep = { name: 'migrateAssetScope', needs: needsAssetScopeMigration, migrate: migrateAssetScope, afterImport: () => false };
