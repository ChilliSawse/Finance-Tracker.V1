// Plan-model migration (owner: B3). Plan section 9.3 step 3; survey B section 3.
//
// One plan item per legacy expense row and per bill, deterministic ids, legacy arrays
// kept untouched. Guarded by dataVersion >= 2. Runs only through the chain
// (migration-chain.js), which clones the data and commits only on success; this module
// also works on its own copies and writes to `data` only after the totals check passes.
// Pure: no DOM, no storage.

import { getWeeklyAmount } from '../utils.js';
import { planTotals } from '../calc/plan.js';
import { detectRole } from '../calc/saving-model.js';

const TOLERANCE = 1e-9;

function deepClone(v) {
    return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

/** True when the plan model migration still has to run on this data. */
export function needsPlanMigration(data) {
    return !(data && data.dataVersion >= 2);
}

// ---------- allocation identity ----------

function slug(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Gives every allocation row a unique id (slug of the name, -2, -3 on collision) and a
 * role through detectRole (first match per role). Existing ids and roles are kept; names,
 * percentages and balances are never touched. Returns true when anything changed.
 */
export function ensureAllocationIdentity(data) {
    const rows = data && Array.isArray(data.allocation) ? data.allocation : [];
    let changed = false;
    const used = new Set();
    for (const r of rows) {
        if (r && typeof r === 'object' && typeof r.id === 'string' && r.id && !used.has(r.id)) used.add(r.id);
    }
    const seen = new Set();
    rows.forEach((r) => {
        if (!r || typeof r !== 'object') return;
        if (typeof r.id === 'string' && r.id && !seen.has(r.id)) { seen.add(r.id); return; }
        const base = slug(r.name) || 'bucket';
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        seen.add(id);
        r.id = id;
        changed = true;
    });
    const taken = new Set();
    for (const r of rows) {
        if (r && typeof r === 'object' && typeof r.role === 'string' && r.role) taken.add(r.role);
    }
    for (const r of rows) {
        if (!r || typeof r !== 'object' || r.role !== undefined) continue;
        const role = detectRole(r.name, taken);
        if (role) taken.add(role);
        r.role = role || null;
        changed = true;
    }
    return changed;
}

// ---------- category matching ----------

const STOP = new Set(['and', 'the', 'out', 'for', 'with', 'other', 'plan', 'new', 'bill', 'fees', 'fee']);

function normalise(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function words(name) {
    return normalise(name).split(' ')
        .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
        .filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * The first category that wins, by four ordered rules. `flag` (true/false) restricts the
 * candidates to categories whose essential flag agrees; null means any. Returns the category
 * or null (the caller falls back to the catch-all).
 */
function matchCategory(name, categories, flag) {
    const ok = (c) => c && typeof c === 'object' && (flag === null || !!c.essential === flag);
    const norm = normalise(name);
    if (!norm) return null;
    for (const c of categories) if (ok(c) && normalise(c.name) === norm) return c;
    const lower = String(name).toLowerCase();
    for (const c of categories) {
        if (!ok(c)) continue;
        for (const kw of (c.keywords || [])) if (kw && lower.includes(kw)) return c;
    }
    const mine = words(name);
    if (mine.length) {
        for (const c of categories) {
            if (!ok(c)) continue;
            const theirs = words(c.name);
            if (mine.some((w) => theirs.includes(w))) return c;
        }
    }
    return null;
}

/** A catch-all with the given flag: reuse an existing one, else add one on demand. */
function ensureCatchAll(categories, baseId, name, essential) {
    for (let n = 1; ; n++) {
        const id = n === 1 ? baseId : `${baseId}-${n}`;
        const found = categories.find((c) => c && c.id === id);
        if (found) { if (!!found.essential === essential) return found; continue; }
        const made = { id, name, essential, monthlyBudget: 0, keywords: [], bucketId: null };
        categories.push(made);
        return made;
    }
}

function legacyWeekly(rows) {
    return (rows || []).reduce((s, r) => s + getWeeklyAmount(r && r.amount, r && r.frequency), 0);
}

function sameNumber(a, b) {
    return a === b || Math.abs(a - b) <= TOLERANCE || (Number.isNaN(a) && Number.isNaN(b));
}

function fail(data, message) {
    const prev = data.planMigration && data.planMigration.error;
    if (prev === message) return false;
    data.planMigration = { at: new Date().toISOString(), error: message };
    return true;
}

/** Runs the migration in place. Returns true when it changed the data. */
export function migratePlanModel(data) {
    if (!data || data.dataVersion >= 2) return false;

    const categories = deepClone(Array.isArray(data.categories) ? data.categories : []);
    const allocationHolder = { allocation: deepClone(Array.isArray(data.allocation) ? data.allocation : []) };
    const sources = deepClone(Array.isArray(data.incomeSources) ? data.incomeSources : []);
    const essentialRows = Array.isArray(data.essentialExpenses) ? data.essentialExpenses : [];
    const nonEssentialRows = Array.isArray(data.nonEssentialExpenses) ? data.nonEssentialExpenses : [];
    const billRows = Array.isArray(data.bills) ? data.bills : [];

    for (const c of categories) if (c && typeof c === 'object' && c.bucketId === undefined) c.bucketId = null;

    const plan = [];
    const fallbacks = [];
    const reviewBills = [];
    const usedIds = new Set();
    const uniqueId = (id) => {
        let out = id;
        for (let n = 2; usedIds.has(out); n++) out = `${id}-${n}`;
        usedIds.add(out);
        return out;
    };

    const addList = (rows, list, prefix, essential) => {
        rows.forEach((row, index) => {
            const r = row && typeof row === 'object' ? row : {};
            let cat = matchCategory(r.name, categories, essential);
            let isFallback = false;
            if (!cat) {
                cat = essential
                    ? ensureCatchAll(categories, 'other-essential', 'Other essential', true)
                    : ensureCatchAll(categories, 'other', 'Other', false);
                isFallback = true;
            }
            if (isFallback) fallbacks.push(String(r.name == null ? '' : r.name));
            plan.push({
                id: uniqueId(`${prefix}-${index}`), categoryId: cat.id, name: r.name, amount: r.amount,
                frequency: r.frequency, anchorDue: null, matchRule: null, bucketId: null, inTotals: true,
                legacy: { list, index },
            });
        });
    };
    addList(essentialRows, 'essential', 'mig-ess', true);
    addList(nonEssentialRows, 'nonEssential', 'mig-non', false);

    billRows.forEach((row, index) => {
        const b = row && typeof row === 'object' ? row : {};
        let cat = null;
        if (typeof b.categoryId === 'string' && b.categoryId) cat = categories.find((c) => c && c.id === b.categoryId) || null;
        let isFallback = false;
        if (!cat) {
            cat = matchCategory(b.name, categories, null);
            if (!cat) { cat = ensureCatchAll(categories, 'other', 'Other', false); isFallback = true; }
        }
        const id = uniqueId(typeof b.id === 'string' && b.id ? b.id : `mig-bill-${index}`);
        if (isFallback) { fallbacks.push(String(b.name == null ? '' : b.name)); reviewBills.push(id); }
        plan.push({
            id, categoryId: cat.id, name: b.name, amount: b.amount, frequency: b.frequency,
            anchorDue: b.nextDue || null, matchRule: null, bucketId: null, inTotals: false,
            legacy: { list: 'bill', index },
        });
    });

    for (const s of sources) if (s && typeof s === 'object' && s.payAnchor === undefined) s.payAnchor = null;
    ensureAllocationIdentity(allocationHolder);

    // Safety check: weekly essential and non-essential from the plan against the legacy lists.
    const probe = { dataVersion: 2, plan, categories, incomeSources: sources, primaryIncomeIndex: data.primaryIncomeIndex };
    const after = planTotals(probe);
    const wantEss = legacyWeekly(essentialRows);
    const wantNon = legacyWeekly(nonEssentialRows);
    if (!sameNumber(after.essentialWeekly, wantEss) || !sameNumber(after.nonEssentialWeekly, wantNon)) {
        return fail(data, `Totals check failed: essential ${after.essentialWeekly} vs ${wantEss}, `
            + `non-essential ${after.nonEssentialWeekly} vs ${wantNon} (weekly).`);
    }

    // Commit.
    data.categories = categories;
    if (Array.isArray(data.allocation)) data.allocation = allocationHolder.allocation;
    if (Array.isArray(data.incomeSources)) data.incomeSources = sources;
    data.plan = plan;
    data.rules = Array.isArray(data.rules) ? data.rules : [];
    data.planMigration = {
        at: new Date().toISOString(),
        counts: { essential: essentialRows.length, nonEssential: nonEssentialRows.length, bills: billRows.length },
        fallbacks, reviewBills,
    };
    data.dataVersion = 2;
    return true;
}

/** Hook run after a JSON import only. Nothing to do for the plan model. */
export function afterImport(data) {
    return false;
}
