// Bucket-model migration (owner: E4). Plan section 9.3 step 4; survey E section 3 (M0 to M9).
//
// Gives the saved allocation its roles, slots and kinds; adds the Mojo row; gives debts ids and
// builds the Fire target list; moves a legacy Smile goal and Fire goal into their new holders
// (totals unchanged); decides template or own template (FT-R-85); keeps auto-credit off for
// migrated data (FT-R-80); keeps an exact copy of the old allocation.
//
// Idempotent behind `savingModel.version >= 1`. Runs only through the chain, which clones the
// data and commits only when this returns without throwing. This module also builds everything
// on copies and writes to `data` last, after the balance-sum check. A failed check throws, which
// the chain turns into {aborted:true}: nothing is written and no later step runs.
// Money in savingModel is integer cents (E2); legacy allocation balances and goal `saved` stay in dollars.
// Pure: no DOM, no storage.

import { ensureAllocationIdentity } from './plan-migration.js';
import {
    BUCKET_METHOD, checkTemplateBounds, forkToCustom, allocateCents,
} from '../calc/saving-model.js';
import { defaultFireTargets, fireStatus, MOJO_STARTER_CENTS } from '../calc/fire.js';
import { netPerPayCents } from '../calc/plan.js';
import { getCycle } from '../calc/pay-cycle.js';

const ROLES = ['daily', 'splurge', 'smile', 'fire', 'mojo', 'grow'];
const SLOT_OF = { daily: 1, splurge: 2, smile: 3, fire: 4, mojo: 5, grow: 6 };
const SPEND = ['daily', 'splurge'];
const GUIDE = { daily: 60, splurge: 10, smile: 10, fire: 20, mojo: 0 };
const TEMPLATE_NAMES = { daily: 'Daily expenses', splurge: 'Splurge', smile: 'Smile', fire: 'Fire extinguisher', mojo: 'Mojo' };

const deepClone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const toCents = (dollars) => Math.round(num(dollars) * 100);

function slug(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** True when the bucket model migration still has to run on this data. */
export function needsBucketMigration(data) {
    return !(data && data.savingModel && data.savingModel.version >= 1);
}

// ---------- ids and the template ----------

/** A unique liability id: `l-<slug>`, `-2`, `-3` on collision. Used by the migration and the add-liability factory. */
export function newLiabilityId(liabilities, name) {
    const used = new Set((Array.isArray(liabilities) ? liabilities : [])
        .filter((l) => isObj(l) && typeof l.id === 'string' && l.id).map((l) => l.id));
    const base = `l-${slug(name) || 'debt'}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    return id;
}

function templateRow(role) {
    return {
        name: TEMPLATE_NAMES[role], percentage: GUIDE[role], currentBalance: 0, savingsGoal: 0, isTaxProvision: false,
        id: role === 'mojo' ? 'mojo' : `b-${role}`, role, slot: SLOT_OF[role],
        kind: SPEND.includes(role) ? 'spend' : 'save', bankLabel: '', autoCreated: role === 'mojo',
    };
}

/** The Bucket method's five buckets at the book's guide split 60 / 10 / 10 / 20 (Mojo at 0). */
export function templateAllocation() {
    return ['daily', 'splurge', 'smile', 'fire', 'mojo'].map(templateRow);
}

/** Per-pay amounts in cents for every bucket but Mojo and Grow, at today's net (zeros when no pay is set). */
function seedBankSetTo(rows, netCents) {
    const objRows = rows.filter(isObj);
    const split = allocateCents(netCents, objRows.map((r) => num(r.percentage)));
    const out = {};
    objRows.forEach((r, i) => { if (r.role !== 'mojo' && r.role !== 'grow') out[String(r.id)] = split[i]; });
    return out;
}

function sumCents(allocation, goals, targets) {
    let s = 0;
    for (const r of allocation) if (isObj(r)) s += toCents(r.currentBalance);
    for (const g of goals) if (isObj(g)) s += toCents(g.saved);
    for (const t of targets) if (isObj(t) && t.type === 'saver') s += num(t.savedCents);
    return s;
}

function statesOf(targets, liabilities, mojoBalanceCents) {
    const st = fireStatus(targets, liabilities, { balanceCents: mojoBalanceCents, targetCents: null });
    return targets.map((t, i) => ({ ...t, state: st.targets[i].state }));
}

function newModel({ rules, outcomeId = 'bucket-method', targets, mojo, bankSetTo, autoCreditOn, legacyAllocation, migration }) {
    return {
        version: 1,
        id: outcomeId,
        name: BUCKET_METHOD.name,
        after: BUCKET_METHOD.after,
        basedOn: null,
        basis: 'net',
        rules: deepClone(rules),
        fire: { targets },
        mojo,
        transfers: { bankSetTo, hiddenFor: null },
        autoCredit: { on: autoCreditOn, rolledThrough: null },
        splitNudge: { dismissedAt: null },
        review: { lastOpenedMonth: null },
        movements: [],
        legacyAllocation,
        migration,
    };
}

/** The saving model for a brand new setup (FT-R-80: auto-credit on). Used by defaults.js. */
export function freshSavingModel() {
    const rows = templateAllocation();
    return newModel({
        rules: BUCKET_METHOD.rules,
        targets: statesOf(defaultFireTargets([]), [], 0),
        mojo: { starter: MOJO_STARTER_CENTS, months: 3, basis: 'auto', steps: [] },
        bankSetTo: seedBankSetTo(rows, 0),
        autoCreditOn: true,
        legacyAllocation: null,
        migration: null,
    });
}

// ---------- the migration ----------

function isPlaceholder(rows) {
    if (rows.length === 0) return true;
    if (rows.length !== 1 || !isObj(rows[0])) return false;
    const r = rows[0];
    return r.name === 'New Allocation' && num(r.percentage) === 100 && num(r.currentBalance) === 0 && num(r.savingsGoal) === 0;
}

function smileGoalName(name) {
    const m = /\(([^)]+)\)/.exec(String(name == null ? '' : name));
    const inner = m ? m[1].trim() : '';
    return inner || 'Smile goal';
}

function uniqueGoalId(goals, base) {
    const used = new Set(goals.filter(isObj).map((g) => String(g.id)));
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    return id;
}

/**
 * Runs the migration in place. Returns true when it changed the data.
 * Throws (so the chain aborts and nothing is written) when the balance-sum check fails.
 * `opts.testTamper(work)` is a test hook run on the work copy just before the check.
 */
export function migrateBucketModel(data, opts = {}) {
    if (!data || typeof data !== 'object' || !needsBucketMigration(data)) return false;

    // M0. Work on copies; the input is never touched until the check passes.
    const input = Array.isArray(data.allocation) ? data.allocation : [];
    const legacyAllocation = deepClone(input);
    const existingGoals = Array.isArray(data.bucketGoals) ? deepClone(data.bucketGoals) : [];
    const goals = existingGoals;
    const liabilities = Array.isArray(data.liabilities) ? deepClone(data.liabilities) : [];
    const beforeCents = sumCents(legacyAllocation, existingGoals, []);

    let alloc = deepClone(input);
    let placeholder = false;

    // M2 (decided before identity so the placeholder is not given a slug id and a role by mistake).
    if (isPlaceholder(alloc)) { alloc = templateAllocation(); placeholder = true; }

    // M1. Ids and roles (B's helper, idempotent), then keep roles valid and unique.
    const holder = { allocation: alloc };
    ensureAllocationIdentity(holder);
    const seenRoles = new Set();
    for (const r of alloc) {
        if (!isObj(r)) continue;
        if (!ROLES.includes(r.role) || seenRoles.has(r.role)) r.role = null;
        else seenRoles.add(r.role);
    }
    const unmapped = alloc.filter((r) => isObj(r) && r.role === null).map((r) => String(r.name == null ? '' : r.name));

    // M3. Slots and kinds. Unmapped rows take 7 to 10 in array order, then repeat.
    let extra = 0;
    for (const r of alloc) {
        if (!isObj(r)) continue;
        if (!Number.isInteger(r.slot) || r.slot < 1) {
            r.slot = r.role ? SLOT_OF[r.role] : 7 + (extra++ % 4);
        } else if (!r.role) extra++;
        if (r.kind !== 'spend' && r.kind !== 'save') r.kind = SPEND.includes(r.role) ? 'spend' : 'save';
        if (typeof r.bankLabel !== 'string') r.bankLabel = '';
        if (typeof r.autoCreated !== 'boolean') r.autoCreated = false;
    }

    // M4. The Mojo row: no share of pay, so no percentage moves.
    if (!seenRoles.has('mojo')) {
        const used = new Set(alloc.filter(isObj).map((r) => r.id));
        const row = templateRow('mojo');
        for (let n = 2; used.has(row.id); n++) row.id = `mojo-${n}`;
        alloc.push(row);
    }

    // M5. Debt ids and the Fire target list.
    const libUsed = new Set(liabilities.filter((l) => isObj(l) && typeof l.id === 'string' && l.id).map((l) => l.id));
    for (const l of liabilities) {
        if (!isObj(l) || (typeof l.id === 'string' && l.id)) continue;
        const base = `l-${slug(l.name) || 'debt'}`;
        let id = base;
        for (let n = 2; libUsed.has(id); n++) id = `${base}-${n}`;
        libUsed.add(id);
        l.id = id;
    }
    let targets = defaultFireTargets(liabilities);

    // M6. Legacy goals and balances move into their new holders; the total stays the same.
    const goalsMoved = [];
    const steps = [];
    const rowOf = (role) => alloc.find((r) => isObj(r) && r.role === role) || null;
    const smile = rowOf('smile');
    const fire = rowOf('fire');
    const mojo = rowOf('mojo');
    if (smile && num(smile.savingsGoal) > 0) {
        const id = uniqueGoalId(goals, 'g-mig-smile');
        goals.push({
            id, parentId: smile.id, name: smileGoalName(smile.name), share: 100,
            cost: smile.savingsGoal, saved: num(smile.currentBalance), due: null, order: 0, done: false,
        });
        smile.currentBalance = 0;
        goalsMoved.push(id);
    }
    if (fire && num(fire.savingsGoal) > 0) {
        targets.unshift({
            id: 't-mig-fire', type: 'saver', label: 'Fire extinguisher goal', goalCents: toCents(fire.savingsGoal),
            savedCents: toCents(fire.currentBalance), skip: false, state: 'queued',
        });
        fire.currentBalance = 0;
        goalsMoved.push('t-mig-fire');
    }
    if (mojo && num(mojo.savingsGoal) > 0) {
        steps.push({ id: 'mig-mojo', kind: 'custom', amount: toCents(mojo.savingsGoal) });
        goalsMoved.push('mig-mojo');
    }
    targets = statesOf(targets, liabilities, mojo ? toCents(mojo.currentBalance) : 0);

    // M7. Bounds check (never blocks, never removes a bucket).
    const bounds = checkTemplateBounds(BUCKET_METHOD.rules, alloc, goals);
    const reasons = [...new Set(bounds.violations.map((v) => v.code))];
    const total = Math.round(alloc.filter(isObj).reduce((s, r) => s + num(r.percentage), 0) * 1000) / 1000;
    const splitTotalOff = Math.abs(total - 100) > 0.05 + 1e-9;

    // M8. The instance.
    let netCents = 0;
    try {
        const n = netPerPayCents(data);
        netCents = Number.isFinite(n) && n > 0 ? n : 0;
    } catch (err) { netCents = 0; }
    let model = newModel({
        rules: BUCKET_METHOD.rules,
        targets,
        mojo: { starter: MOJO_STARTER_CENTS, months: 3, basis: 'auto', steps },
        bankSetTo: seedBankSetTo(alloc, netCents),
        autoCreditOn: false,
        legacyAllocation,
        migration: null,
    });
    if (!bounds.inBounds) model = forkToCustom(model, 1);
    model.migration = {
        at: new Date().toISOString(),
        outcome: bounds.inBounds ? 'template' : 'own',
        reasons, unmapped, goalsMoved, splitTotalOff, placeholder, cardDismissed: false,
    };

    // Balance-sum check: buckets, goals saved and saver targets, before against after.
    if (typeof opts.testTamper === 'function') opts.testTamper({ alloc, goals, targets: model.fire.targets });
    const afterCents = sumCents(alloc, goals, model.fire.targets);
    if (afterCents !== beforeCents) {
        throw new Error(`Bucket balance check failed: ${beforeCents} cents before, ${afterCents} cents after.`);
    }

    // M9. Commit.
    data.allocation = alloc;
    if (Array.isArray(data.liabilities)) data.liabilities = liabilities;
    data.bucketGoals = goals;
    data.savingModel = model;
    return true;
}

/**
 * Hook run after a JSON import only: a restored backup never credits retroactively, so a stale
 * pay-roll marker moves to the latest pay date (FT-R-80). Returns true when it changed the data.
 */
export function afterImport(data) {
    const sm = data && data.savingModel;
    const ac = sm && sm.autoCredit;
    if (!ac || !ac.on || !ac.rolledThrough) return false;
    try {
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const sources = Array.isArray(data.incomeSources) ? data.incomeSources : [];
        const source = sources[data.primaryIncomeIndex || 0] || sources[0] || null;
        if (!source) return false;
        const cycle = getCycle(source, today);
        if (cycle.mode !== 'cycle' || !(cycle.start > ac.rolledThrough)) return false;
        ac.rolledThrough = cycle.start;
        return true;
    } catch (err) {
        return false;
    }
}
