// Asset and debt detail migration (owner: F2, chain step 5b; plan section 9.3).
//
// Adds the detail fields of slice F section 2.2 to the existing arrays. Wired and guarded by
// migration-chain.js (its backup condition is needsAssetDebtMigration, so an old save is
// copied byte for byte first, and each step runs on a clone that is committed only on success).
//
// Non-destructive: only absent fields are added. Names, balances and rates are never touched.
// A suggested kind (assets) or label (debts) is written with kindSuggested / labelSuggested true
// so the "Check these N" card (F5) can show it; until confirmed the maths treats it as cash at
// 0% real. Ids are deterministic (`a-<slug>`, `inc-<slug>`, `-2` on collision) and a liability
// gets one only when E4 has not already given it one, so the order of E4 and F2 does not matter,
// and neither does C4's (it does not add income source ids; U37).
// Guard: assetDebtVersion >= 1. Totals check: sum of assets, sum of liabilities and
// calculateTotals(data).netWorth before against after; a mismatch throws, so the chain aborts
// and assetDebtVersion is never written.
//
// Fields written (only when absent). An unset asset interestRate stays absent (absent = unset, 0% real),
// so no null is written into a field the import validator and S1.8 expect to be a number:
//   data.assetDebtVersion (1, last, after the check), data.fiSettings.inflation (2.5),
//   incomeSources[i].id,
//   assets[i]: id, kind, kindSuggested, isSuper, interestFrequency ('monthly'),
//     expectedReturn (null), dividendYield (null), dividendFrequency ('quarterly'), reinvestDividends (true),
//     growthRate (null), depreciation (null; a vehicle default record for a suggested depreciating asset),
//   liabilities[i]: id, interestType ('variable'), fixedUntil (null), rateAfterFixed (null), compounding ('monthly'),
//     repaymentFrequency ('monthly'), minRepayment (null), label (suggested or null), labelSuggested.

import { slug, newLiabilityId } from './bucket-migration.js';
import { suggestKind, suggestLabel, VEHICLE_DEPRECIATION } from '../calc/assets-debts.js';
import { calculateTotals } from '../calc/calculations.js';

export const DEFAULT_INFLATION = 2.5;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const cents = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : 0);
const sumCents = (rows) => (Array.isArray(rows) ? rows : []).reduce((s, r) => s + (isObj(r) ? cents(r.balance) : 0), 0);
const missing = (obj, key) => obj[key] === undefined;
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** True when the asset and debt migration still has to run on this data. */
export function needsAssetDebtMigration(data) {
    if (!isObj(data)) return false;
    return !(data.assetDebtVersion >= 1);
}

function netWorthOf(data) {
    // calculateTotals writes working fields onto the sources, so it runs on a throwaway copy.
    return Math.round(calculateTotals(clone(data)).netWorth * 100);
}

function uniqueId(prefix, name, fallback, used) {
    const base = `${prefix}-${slug(name) || fallback}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
}

function idsInUse(rows) {
    return new Set((Array.isArray(rows) ? rows : []).filter((r) => isObj(r) && typeof r.id === 'string' && r.id).map((r) => r.id));
}

function addAssetFields(a, used) {
    if (!(typeof a.id === 'string' && a.id)) a.id = uniqueId('a', a.name, 'asset', used);
    if (missing(a, 'kind')) {
        const s = suggestKind(a.name);
        a.kind = s.kind;
        if (missing(a, 'isSuper')) a.isSuper = s.isSuper;
        if (missing(a, 'kindSuggested')) a.kindSuggested = true;
    }
    if (missing(a, 'kindSuggested')) a.kindSuggested = false;
    if (missing(a, 'isSuper')) a.isSuper = false;
    if (missing(a, 'interestFrequency')) a.interestFrequency = 'monthly';
    if (missing(a, 'expectedReturn')) a.expectedReturn = null;
    if (missing(a, 'dividendYield')) a.dividendYield = null;
    if (missing(a, 'dividendFrequency')) a.dividendFrequency = 'quarterly';
    if (missing(a, 'reinvestDividends')) a.reinvestDividends = true;
    if (missing(a, 'growthRate')) a.growthRate = null;
    if (missing(a, 'depreciation')) {
        a.depreciation = a.kind === 'depreciating'
            ? { method: 'declining', ratePct: VEHICLE_DEPRECIATION.decliningRatePct, lifeYears: VEHICLE_DEPRECIATION.lifeYears, residual: 0, purchasePrice: null, purchaseDate: null }
            : null;
    }
}

function addDebtFields(l, liabilities) {
    if (!(typeof l.id === 'string' && l.id)) l.id = newLiabilityId(liabilities, l.name);
    if (missing(l, 'interestType')) l.interestType = 'variable';
    if (missing(l, 'fixedUntil')) l.fixedUntil = null;
    if (missing(l, 'rateAfterFixed')) l.rateAfterFixed = null;
    if (missing(l, 'compounding')) l.compounding = 'monthly';
    if (missing(l, 'repaymentFrequency')) l.repaymentFrequency = 'monthly';
    if (missing(l, 'minRepayment')) l.minRepayment = null;
    if (missing(l, 'label')) {
        l.label = suggestLabel(l.name);
        if (missing(l, 'labelSuggested')) l.labelSuggested = l.label !== null;
    }
    if (missing(l, 'labelSuggested')) l.labelSuggested = false;
}

/**
 * Runs the migration in place. Returns true when it changed the data, false when the guard says
 * it already ran. Throws (so the chain aborts and nothing is written) when the totals check fails.
 * `hooks.afterApply(data)` is a test seam run just before the check.
 */
export function migrateAssetDebtDetail(data, hooks = {}) {
    if (!needsAssetDebtMigration(data)) return false;

    const before = { assets: sumCents(data.assets), liabilities: sumCents(data.liabilities), netWorth: netWorthOf(data) };

    if (Array.isArray(data.incomeSources)) {
        const used = idsInUse(data.incomeSources);
        for (const s of data.incomeSources) {
            if (isObj(s) && !(typeof s.id === 'string' && s.id)) s.id = uniqueId('inc', s.name, 'income', used);
        }
    }
    if (Array.isArray(data.assets)) {
        const used = idsInUse(data.assets);
        for (const a of data.assets) if (isObj(a)) addAssetFields(a, used);
    }
    if (Array.isArray(data.liabilities)) {
        for (const l of data.liabilities) if (isObj(l)) addDebtFields(l, data.liabilities);
    }
    if (isObj(data.fiSettings) && missing(data.fiSettings, 'inflation')) data.fiSettings.inflation = DEFAULT_INFLATION;

    if (typeof hooks.afterApply === 'function') hooks.afterApply(data);

    const after = { assets: sumCents(data.assets), liabilities: sumCents(data.liabilities), netWorth: netWorthOf(data) };
    if (before.assets !== after.assets || before.liabilities !== after.liabilities || before.netWorth !== after.netWorth) {
        throw new Error(`Asset and debt check failed: assets ${before.assets} to ${after.assets} cents, liabilities ${before.liabilities} to ${after.liabilities}, net worth ${before.netWorth} to ${after.netWorth}.`);
    }
    data.assetDebtVersion = 1;
    return true;
}

/** Hook run after a JSON import only. Nothing to do for asset and debt detail. */
export function afterImport(data) {
    return false;
}

// F5: ids for rows created after the migration ran (the version guard stops it filling them later).
// One owner for the id shape: the same `a-<slug>` / `inc-<slug>` with `-2` on collision.
/** A unique asset id for a new row. */
export function newAssetId(assets, name) { return uniqueId('a', name, 'asset', idsInUse(assets)); }
/** A unique income source id for a new row. */
export function newIncomeSourceId(sources, name) { return uniqueId('inc', name, 'income', idsInUse(sources)); }
