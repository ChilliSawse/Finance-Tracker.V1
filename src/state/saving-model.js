// Saving model state API (owner: E5). Reads and writes financeData.allocation, bucketGoals,
// categories, plan and savingModel through the E1 to E3 maths. Same pattern as B4's plan.js:
// every call is (data, ...), mutates `data` in place, and returns an undo payload shaped for
// showUndoToast: { ok, message, onUndo, onExpire, ...extras }. A failed call changes nothing and
// returns ok:false with a `code`. The caller renders and saves after each call and after onUndo.
// No DOM, no toast. Money in savingModel is integer cents; legacy balances and goal `saved`/`cost`
// stay dollars (E4). Never blocks: an edit outside the template offers the fork (needsFork:true);
// calling again with {fork:true} forks and applies it in one undoable step.

import { t } from '../i18n/strings.js';
import {
    BUCKET_METHOD, allocateCents, bucketBalanceCents, bucketByRole, buildTree, canReturnToBase as canReturn,
    checkTemplateBounds, fitSuggestionToRoom, forkToCustom, suggestSplit, validateSplit,
} from '../calc/saving-model.js';
import { applyPay, fireStatus, mojoLivingCosts, mojoSteps } from '../calc/fire.js';
import { netPerPayCents, planTotals } from '../calc/plan.js';
import { markTransfersDone, transfersToUpdate } from '../calc/smile.js';
import { runPayRoll as rollCalc } from '../calc/pay-roll.js';
import { toIso } from '../calc/pay-cycle.js';

export { canReturnToBase } from '../calc/saving-model.js';

const SPEND_ROLES = ['daily', 'splurge'];
const MAX_SLOT = 10;
const STORAGE_KEY = 'financeTrackerData_v2';

const clone = (v) => JSON.parse(JSON.stringify(v));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const toCents = (dollars) => Math.round(num(dollars) * 100);
const addDollars = (dollars, cents) => Math.round(num(dollars) * 100 + cents) / 100;
const round1 = (x) => Math.round(x * 10) / 10;
const aud = (cents) => `A$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const slug = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

// ---------- undo plumbing ----------

function failed(code, extra) {
    return { ok: false, code, message: '', onUndo() {}, onExpire: undefined, ...(extra || {}) };
}

function replaceIn(data, key, value) {
    const cur = data[key];
    if (value === undefined) { delete data[key]; return; }
    if (Array.isArray(cur) && Array.isArray(value)) { cur.length = 0; cur.push(...value); return; }
    if (isObj(cur) && isObj(value)) { Object.keys(cur).forEach((k) => delete cur[k]); Object.assign(cur, value); return; }
    data[key] = value;
}

function snapshot(data, keys) {
    const before = {};
    keys.forEach((k) => { before[k] = data[k] === undefined ? undefined : clone(data[k]); });
    return before;
}

/** Success payload whose onUndo puts the snapshot back (once). */
function done(data, before, message, extra) {
    let used = false;
    return {
        ok: true, message, onExpire: undefined, ...(extra || {}),
        onUndo() {
            if (used) return;
            used = true;
            Object.keys(before).forEach((k) => replaceIn(data, k, before[k] === undefined ? undefined : clone(before[k])));
        },
    };
}

function ensureArray(data, key) {
    if (!Array.isArray(data[key])) data[key] = [];
    return data[key];
}

const rulesOf = (data) => (data && data.savingModel && data.savingModel.rules) || BUCKET_METHOD.rules;
const isCustom = (data) => !!(data && data.savingModel && typeof data.savingModel.id === 'string' && data.savingModel.id.startsWith('custom-'));
const rowById = (data, id) => (Array.isArray(data.allocation) ? data.allocation.find((r) => r && String(r.id) === String(id)) : null) || null;

function needsFork(violations) {
    return { ok: false, code: 'needs-fork', needsFork: true, violations, message: t('e.bucket.forkOffer'), onUndo() {}, onExpire: undefined };
}

// ---------- getBuckets ----------

function activeTarget(data, mojoBalanceCents, ladderTarget) {
    const sm = data.savingModel;
    const targets = sm && sm.fire && Array.isArray(sm.fire.targets) ? sm.fire.targets : null;
    if (!targets) return null;
    const st = fireStatus(targets, data.liabilities, { balanceCents: mojoBalanceCents, targetCents: ladderTarget });
    const a = st.targets.find((x) => x.id === st.activeId);
    if (!a) return null;
    const out = { id: a.id, type: a.type, label: a.label, progress: a.progress };
    if (a.type === 'saver' || a.type === 'home') { out.goalCents = Math.round(num(a.goalCents)); out.savedCents = Math.round(num(a.savedCents)); }
    return out;
}

function mojoState(data, living) {
    const row = bucketByRole(data, 'mojo');
    const bal = row ? toCents(row.currentBalance) : 0;
    const ladder = mojoSteps((data.savingModel && data.savingModel.mojo) || {}, living, bal);
    return { bal, ladder };
}

function livingFor(data) {
    try {
        const pt = planTotals(data);
        return mojoLivingCosts({ essentialPerPayCents: Math.round(num(pt.essentialPerCycle) * 100), cyclesPerYear: pt.cyclesPerYear || 26,
            basis: (data.savingModel && data.savingModel.mojo && data.savingModel.mojo.basis) || 'auto' });
    } catch (e) { return mojoLivingCosts({}); }
}

/**
 * Buckets for a data object: the top-level allocation rows in order, each followed by its goal and
 * sub-bucket descendants (kind 'goal', parentId set). Sum the rows with parentId null; a bucket's
 * balanceCents already includes its goals. Tolerant: no allocation gives [], a row with no id or
 * role is listed with a fallback id and null role. `today` is accepted for the contract and unused.
 * @returns {Array<{id:string, slot:number|null, shade:number, name:string, role:string|null, kind:string,
 *   parentId:string|null, pct:number, perPayCents:number, balanceCents:number, goal?:number, target?:object, left?:number}>}
 */
export function getBuckets(data, today) { // eslint-disable-line no-unused-vars
    const d = data && typeof data === 'object' ? data : {};
    const raw = Array.isArray(d.allocation) ? d.allocation : [];
    const rows = raw.map((r, i) => {
        const o = isObj(r) ? r : {};
        return { ...o, id: o.id != null ? String(o.id) : `alloc-${i + 1}` };
    });
    const goals = (Array.isArray(d.bucketGoals) ? d.bucketGoals : []).filter((g) => isObj(g) && g.id != null && g.parentId != null);
    const tree = buildTree(rows, goals, rulesOf(d));
    let net = 0;
    try { net = Math.max(0, netPerPayCents(d)); } catch (e) { net = 0; }
    const perPay = allocateCents(net, rows.map((r) => num(r.percentage)));
    const living = (rows.some((r) => r.role === 'mojo') || rows.some((r) => r.role === 'fire')) ? livingFor(d) : null;
    const ms = living ? mojoState(d, living) : null;
    const out = [];
    tree.forEach((node, i) => {
        const r = node.row;
        const bal = bucketBalanceCents(node.id, tree);
        const entry = {
            id: node.id, slot: node.slot != null ? node.slot : Math.min(i + 1, MAX_SLOT), shade: node.shade, name: typeof r.name === 'string' ? r.name : '',
            role: r.role || null, kind: r.kind || (SPEND_ROLES.includes(r.role) ? 'spend' : 'save'), parentId: null,
            pct: num(r.percentage), perPayCents: perPay[i], balanceCents: bal,
        };
        const goalCents = toCents(r.savingsGoal);
        if (goalCents > 0) { entry.goal = goalCents; entry.left = Math.max(0, goalCents - bal); }
        if (r.role === 'fire' && ms) { const a = activeTarget(d, ms.bal, ms.ladder.targetCents); if (a) entry.target = a; }
        if (r.role === 'mojo' && ms && ms.ladder.active) {
            entry.target = { id: ms.ladder.active.id, type: 'mojo', label: ms.ladder.active.kind, amountCents: ms.ladder.active.amountCents, progress: Math.min(1, ms.ladder.progressPct / 100) };
            entry.left = Math.max(0, ms.ladder.active.amountCents - bal);
        }
        out.push(entry);
        const walk = (n, parentPerPay) => {
            const shares = n.children.map((c) => num(c.goal && c.goal.share));
            const totalShare = shares.reduce((a, b) => a + b, 0);
            const parts = totalShare > 0 ? allocateCents(parentPerPay, shares) : n.children.map(() => 0);
            n.children.forEach((c, k) => {
                const g = c.goal;
                const gb = bucketBalanceCents(c.id, tree);
                const pp = parts[k];
                const ge = {
                    id: c.id, slot: c.slot != null ? c.slot : entry.slot, shade: c.shade, name: typeof g.name === 'string' ? g.name : '', role: null, kind: 'goal',
                    parentId: n.id, pct: net > 0 ? Math.round((pp / net) * 100000) / 1000 : 0, perPayCents: pp, balanceCents: gb,
                };
                const cost = toCents(g.cost);
                if (cost > 0) { ge.goal = cost; ge.left = Math.max(0, cost - gb); }
                out.push(ge);
                walk(c, pp);
            });
        };
        walk(node, perPay[i]);
    });
    return out;
}

// ---------- factories ----------

/** A free bucket id in an allocation list: b-<slug>, then -2, -3. */
export function newBucketId(allocation, name) {
    const used = new Set((allocation || []).filter(isObj).map((r) => String(r.id)));
    const base = `b-${slug(name) || 'bucket'}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    return id;
}

function nextSlot(allocation) {
    const used = new Set((allocation || []).filter(isObj).map((r) => r.slot));
    for (let s = 7; s <= MAX_SLOT; s++) if (!used.has(s)) return s;
    for (let s = 1; s <= MAX_SLOT; s++) if (!used.has(s)) return s;
    return null;
}

/** A new top-level bucket row (0%, empty). Also the What If factory: `newBucket(allocation, {name})`. */
export function newBucket(allocation, fields = {}) {
    const f = isObj(fields) ? fields : {};
    const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim() : t('e.bucket.newName');
    return {
        name, percentage: num(f.percentage), currentBalance: num(f.currentBalance), savingsGoal: num(f.savingsGoal),
        isTaxProvision: false, id: newBucketId(allocation, name), role: null, slot: nextSlot(allocation),
        kind: f.kind === 'spend' ? 'spend' : 'save', bankLabel: typeof f.bankLabel === 'string' ? f.bankLabel : '', autoCreated: false,
    };
}

function newGoalId(goals, name) {
    const used = new Set(goals.filter(isObj).map((g) => String(g.id)));
    const base = `g-${slug(name) || 'goal'}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    return id;
}

// ---------- buckets ----------

/**
 * Add a top-level bucket at 0%. Outside the template (no extra top-level bucket in the Bucket method)
 * it does not write: it returns {needsFork:true} to offer "Make this your own template?". Pass
 * {fork:true} to fork and add in one undoable step. Never refuses on its own.
 */
export function addBucket(data, fields = {}, opts = {}) {
    const alloc = ensureArray(data, 'allocation');
    const row = newBucket(alloc, fields);
    let forking = false;
    if (data.savingModel && !isCustom(data)) {
        const b = checkTemplateBounds(rulesOf(data), [...alloc, row], data.bucketGoals);
        if (!b.inBounds) { if (!opts.fork) return needsFork(b.violations); forking = true; }
    }
    const before = snapshot(data, ['allocation', 'savingModel']);
    if (forking) data.savingModel = forkToCustom(data.savingModel, 1);
    alloc.push(row);
    return done(data, before, t(forking ? 'e.bucket.addedFork' : 'e.bucket.added', { name: row.name }), { item: row, forked: forking });
}

export function renameBucket(data, id, name) {
    const row = rowById(data, id);
    const nm = typeof name === 'string' ? name.trim() : '';
    if (!row || !nm) return failed(row ? 'name' : 'missing');
    const before = snapshot(data, ['allocation']);
    const old = row.name;
    row.name = nm;
    return done(data, before, t('e.bucket.renamed', { from: old, to: nm }), { item: row });
}

/**
 * Write new percentages. `splits` is {id: pct} or [{id, pct}]; rows not named keep theirs.
 * Writes only when the result totals 100 (to 0.05) with no negatives and, under the template, no Mojo share.
 */
export function setSplit(data, splits, opts = {}) {
    const alloc = ensureArray(data, 'allocation');
    const list = Array.isArray(splits) ? splits : Object.entries(splits || {}).map(([id, pct]) => ({ id, pct }));
    const next = alloc.map((r) => ({ id: r.id, role: r.role || null, pct: num(r.percentage) }));
    for (const s of list) {
        const i = next.findIndex((r) => String(r.id) === String(s.id));
        if (i < 0) return failed('missing', { id: s.id });
        next[i].pct = typeof s.pct === 'number' && Number.isFinite(s.pct) ? round1(s.pct) : NaN;
    }
    const v = validateSplit(next, rulesOf(data));
    if (!v.ok) return failed('split', { total: v.total, errors: v.errors });
    const before = snapshot(data, ['allocation']);
    next.forEach((r, i) => { alloc[i].percentage = r.pct; });
    return done(data, before, t(opts.suggested ? 'e.bucket.splitSuggested' : 'e.bucket.split'), { total: v.total });
}

/** Apply E1's expenses-first suggestion to Daily, Splurge, Smile and Fire. Inputs default to the plan's. */
export function applySuggestedSplit(data, inputs = {}) {
    let netCents = inputs.netCents;
    let essentialCents = inputs.essentialCents;
    let nonEssentialCents = inputs.nonEssentialCents;
    try {
        if (netCents == null) netCents = netPerPayCents(data);
        if (essentialCents == null || nonEssentialCents == null) {
            const pt = planTotals(data);
            if (essentialCents == null) essentialCents = Math.round(pt.essentialPerCycle * 100);
            if (nonEssentialCents == null) nonEssentialCents = Math.round(pt.nonEssentialPerCycle * 100);
        }
    } catch (e) { return failed('inputs'); }
    const raw = suggestSplit({ netCents, essentialCents, nonEssentialCents, rules: data.savingModel && data.savingModel.rules });
    if (!raw) return failed('suggest', { message: t('e.bucket.suggestFail') });
    const fourRoles = ['daily', 'splurge', 'smile', 'fire'];
    const others = (Array.isArray(data.allocation) ? data.allocation : []).filter((r) => r && !fourRoles.includes(r.role)).reduce((a, r) => a + num(r.percentage), 0);
    const s = fitSuggestionToRoom(raw, others);
    if (!s) return failed('room', { message: t('e.bucket.suggestNoRoom') });
    const splits = {};
    for (const role of ['daily', 'splurge', 'smile', 'fire']) {
        const row = bucketByRole(data, role);
        if (!row) return failed('role', { role, message: t('e.bucket.suggestFail') });
        splits[row.id] = s[role];
    }
    const res = setSplit(data, splits, { suggested: true });
    return res.ok || res.message ? res : { ...res, message: t('e.bucket.suggestFail') };
}

/** Make this your own template (FT-R-78, FT-R-85). Undo puts the Bucket method back. */
export function forkOwnTemplate(data, opts = {}) {
    if (!data.savingModel || isCustom(data)) return failed('already');
    const before = snapshot(data, ['savingModel']);
    data.savingModel = forkToCustom(data.savingModel, 1);
    if (typeof opts.name === 'string' && opts.name.trim()) data.savingModel.name = opts.name.trim();
    return done(data, before, t('e.bucket.forked'));
}

/** "Switch back" to the Bucket method, only when the data fits its bounds. */
export function switchBackToBase(data) {
    if (!data.savingModel || !canReturn(data.savingModel, data.allocation, data.bucketGoals)) return failed('bounds');
    const before = snapshot(data, ['savingModel']);
    Object.assign(data.savingModel, { id: BUCKET_METHOD.id, name: BUCKET_METHOD.name, after: BUCKET_METHOD.after, basedOn: null, rules: clone(BUCKET_METHOD.rules) });
    return done(data, before, t('e.bucket.switchedBack'));
}

function descendantGoalIds(goals, rootId) {
    const out = new Set();
    let grew = true;
    while (grew) {
        grew = false;
        for (const g of goals) {
            if (isObj(g) && !out.has(String(g.id)) && (String(g.parentId) === String(rootId) || out.has(String(g.parentId)))) { out.add(String(g.id)); grew = true; }
        }
    }
    return out;
}

/**
 * Delete a top-level bucket and move its money, its percentage and its goals' saved amounts to another.
 * Money (or a share) with no `toId` returns {code:'move', moveCents} so the sheet can ask "Move A$x to...".
 * A core bucket under the template offers the fork. Category and plan links to it reset to null.
 * `opts`: {fork, today} (today logs a movement).
 */
export function deleteBucketWithMove(data, id, toId, opts = {}) {
    const alloc = ensureArray(data, 'allocation');
    const goals = ensureArray(data, 'bucketGoals');
    const idx = alloc.findIndex((r) => r && String(r.id) === String(id));
    if (idx < 0) return failed('missing');
    const row = alloc[idx];
    if (alloc.length < 2) return failed('last');
    let forking = false;
    if (data.savingModel && !isCustom(data) && (rulesOf(data).coreBuckets || []).includes(row.role)) {
        if (!opts.fork) return needsFork([{ code: 'core-removed', role: row.role }]);
        forking = true;
    }
    const tree = buildTree(alloc, goals, rulesOf(data));
    const cents = bucketBalanceCents(String(row.id), tree);
    const pct = num(row.percentage);
    let dest = null;
    if (cents > 0 || pct > 0) {
        if (toId == null) return failed('move', { moveCents: cents, message: t('e.bucket.moveNeeded', { amount: aud(cents) }) });
        dest = alloc.find((r) => r && String(r.id) === String(toId) && r !== row);
        if (!dest) return failed('dest');
        if (pct > 0 && dest.role === 'mojo' && rulesOf(data).mojoShare === 0 && !forking) return failed('dest-mojo');
    }
    const before = snapshot(data, ['allocation', 'bucketGoals', 'categories', 'plan', 'savingModel']);
    if (forking) data.savingModel = forkToCustom(data.savingModel, 1);
    const gone = descendantGoalIds(goals, row.id);
    for (let i = goals.length - 1; i >= 0; i--) if (gone.has(String(goals[i] && goals[i].id))) goals.splice(i, 1);
    if (dest) {
        dest.currentBalance = addDollars(dest.currentBalance, cents);
        dest.percentage = Math.round((num(dest.percentage) + pct) * 1000) / 1000;
    }
    alloc.splice(idx, 1);
    const sm = data.savingModel;
    if (sm && sm.transfers && isObj(sm.transfers.bankSetTo)) delete sm.transfers.bankSetTo[String(row.id)];
    for (const c of Array.isArray(data.categories) ? data.categories : []) if (c && c.bucketId === row.id) c.bucketId = null;
    for (const p of Array.isArray(data.plan) ? data.plan : []) if (p && p.bucketId === row.id) p.bucketId = null;
    if (sm && opts.today && cents > 0 && dest) {
        sm.movements = Array.isArray(sm.movements) ? sm.movements : [];
        sm.movements.push({ date: opts.today, bucketId: dest.id, cents, kind: 'move', from: String(row.id) });
    }
    const msg = dest && cents > 0
        ? t('e.bucket.deletedMoved', { name: row.name, amount: aud(cents), to: dest.name }) : t('e.bucket.deleted', { name: row.name });
    return done(data, before, msg, { item: row, index: idx, movedCents: cents, forked: forking });
}

// ---------- goals and sub-buckets ----------

function siblingsOf(goals, parentId) { return goals.filter((g) => isObj(g) && String(g.parentId) === String(parentId)); }

/** Give `others` (siblings but one) the rest of 100, in proportion to their current shares, whole tenths. */
function rebalanceOthers(others, keptShare) {
    if (!others.length) return;
    const tenths = Math.max(0, Math.round((100 - keptShare) * 10));
    const w = others.map((g) => num(g.share));
    const parts = allocateCents(tenths, w.some((x) => x > 0) ? w : w.map(() => 1));
    others.forEach((g, i) => { g.share = parts[i] / 10; });
}

/** Add a goal under a bucket, or a sub-bucket under a goal. The share defaults to an equal cut; the others rebalance to 100. */
export function addGoal(data, parentId, fields = {}, opts = {}) {
    const alloc = ensureArray(data, 'allocation');
    const goals = ensureArray(data, 'bucketGoals');
    const parentIsBucket = alloc.some((r) => r && String(r.id) === String(parentId));
    if (!parentIsBucket && !goals.some((g) => g && String(g.id) === String(parentId))) return failed('missing');
    const name = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : t('e.goal.newName');
    const goal = {
        id: newGoalId(goals, name), parentId: String(parentId), name, share: 100,
        cost: num(fields.cost), saved: num(fields.saved), due: fields.due || null,
        order: goals.reduce((m, g) => Math.max(m, num(g && g.order) + 1), 0), done: false,
    };
    let forking = false;
    if (data.savingModel && !isCustom(data)) {
        const b = checkTemplateBounds(rulesOf(data), alloc, [...goals, goal]);
        if (!b.inBounds) { if (!opts.fork) return needsFork(b.violations); forking = true; }
    }
    const before = snapshot(data, ['bucketGoals', 'savingModel']);
    if (forking) data.savingModel = forkToCustom(data.savingModel, 1);
    const sibs = siblingsOf(goals, parentId);
    goal.share = sibs.length ? (typeof fields.share === 'number' ? Math.min(100, Math.max(0, round1(fields.share))) : round1(100 / (sibs.length + 1))) : 100;
    rebalanceOthers(sibs, goal.share);
    goals.push(goal);
    return done(data, before, t('e.goal.added', { name }), { item: goal, forked: forking });
}

const GOAL_FIELDS = ['name', 'cost', 'saved', 'due', 'done', 'order'];

/** Edit a goal. A new `share` rebalances its siblings so they still total 100. */
export function updateGoal(data, id, changes = {}) {
    const goals = ensureArray(data, 'bucketGoals');
    const g = goals.find((x) => x && String(x.id) === String(id));
    if (!g) return failed('missing');
    const before = snapshot(data, ['bucketGoals']);
    for (const k of GOAL_FIELDS) if (Object.prototype.hasOwnProperty.call(changes, k)) g[k] = changes[k];
    if (typeof changes.share === 'number' && Number.isFinite(changes.share)) {
        const sibs = siblingsOf(goals, g.parentId);
        const others = sibs.filter((x) => x !== g);
        g.share = others.length ? Math.min(100, Math.max(0, round1(changes.share))) : 100;
        rebalanceOthers(others, g.share);
    }
    return done(data, before, t('e.goal.changed', { name: g.name }), { item: g });
}

/** Write all of a parent's goal shares at once; only when they total 100. `shares` is {goalId: share}. */
export function setGoalShares(data, parentId, shares) {
    const goals = ensureArray(data, 'bucketGoals');
    const sibs = siblingsOf(goals, parentId);
    if (!sibs.length) return failed('missing');
    const next = sibs.map((g) => (shares && typeof shares[g.id] === 'number' ? round1(shares[g.id]) : num(g.share)));
    const total = Math.round(next.reduce((a, b) => a + b, 0) * 1000) / 1000;
    if (next.some((x) => x < 0) || Math.abs(total - 100) > 0.05 + 1e-9) return failed('shares', { total });
    const before = snapshot(data, ['bucketGoals']);
    sibs.forEach((g, i) => { g.share = next[i]; });
    return done(data, before, t('e.goal.sharesChanged'), { total });
}

/** Remove a goal and its sub-buckets. Saved money goes up to the parent; the siblings rebalance to 100. */
export function removeGoal(data, id) {
    const goals = ensureArray(data, 'bucketGoals');
    const idx = goals.findIndex((x) => x && String(x.id) === String(id));
    if (idx < 0) return failed('missing');
    const g = goals[idx];
    const before = snapshot(data, ['bucketGoals', 'allocation']);
    const alloc = ensureArray(data, 'allocation');
    const tree = buildTree(alloc, goals, rulesOf(data));
    const cents = bucketBalanceCents(String(g.id), tree);
    const gone = descendantGoalIds(goals, g.id);
    gone.add(String(g.id));
    for (let i = goals.length - 1; i >= 0; i--) if (gone.has(String(goals[i] && goals[i].id))) goals.splice(i, 1);
    const parentGoal = goals.find((x) => x && String(x.id) === String(g.parentId));
    const parentRow = parentGoal ? null : alloc.find((r) => r && String(r.id) === String(g.parentId));
    if (parentGoal) parentGoal.saved = addDollars(parentGoal.saved, cents);
    else if (parentRow) parentRow.currentBalance = addDollars(parentRow.currentBalance, cents);
    const sibs = siblingsOf(goals, g.parentId);
    if (sibs.length) rebalanceOthers(sibs, 0);
    return done(data, before, t('e.goal.removed', { name: g.name }), { item: g, index: idx, movedCents: cents });
}

// ---------- Fire targets ----------

function fireTargets(data) {
    const sm = data && data.savingModel;
    if (!sm) return null;
    if (!sm.fire || !Array.isArray(sm.fire.targets)) sm.fire = { ...(sm.fire || {}), targets: [] };
    return sm.fire.targets;
}

function refreshStates(data) {
    const ts = fireTargets(data);
    const { bal, ladder } = mojoState(data, livingFor(data));
    const st = fireStatus(ts, data.liabilities, { balanceCents: bal, targetCents: ladder.targetCents });
    ts.forEach((x, i) => { x.state = st.targets[i].state; });
    return st;
}

/** Move a target up (delta -1) or down (+1) the list. Remaining amounts never change. */
export function moveTarget(data, id, delta) {
    const ts = fireTargets(data);
    const i = ts ? ts.findIndex((x) => x && x.id === id) : -1;
    const j = i + (delta < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= ts.length) return failed(i < 0 ? 'missing' : 'edge');
    const before = snapshot(data, ['savingModel']);
    [ts[i], ts[j]] = [ts[j], ts[i]];
    refreshStates(data);
    return done(data, before, t('e.fire.moved', { name: ts[j].label }));
}

export function skipTarget(data, id, skip = true) {
    const ts = fireTargets(data);
    const tg = ts && ts.find((x) => x && x.id === id);
    if (!tg) return failed('missing');
    const before = snapshot(data, ['savingModel']);
    tg.skip = !!skip;
    refreshStates(data);
    return done(data, before, t(skip ? 'e.fire.skipped' : 'e.fire.unskipped', { name: tg.label }));
}

/** Add a target: {type:'saver', label, goalCents} or {type:'debt', liabilityId}. It goes before the open-ended Super top-up. */
export function addTarget(data, fields = {}) {
    const ts = fireTargets(data);
    if (!ts) return failed('model');
    let target;
    if (fields.type === 'debt') {
        const l = (Array.isArray(data.liabilities) ? data.liabilities : []).find((x) => x && x.id != null && String(x.id) === String(fields.liabilityId));
        if (!l || ts.some((x) => x.id === `debt:${l.id}`)) return failed(l ? 'dup' : 'missing');
        const c = toCents(l.balance);
        target = { id: `debt:${l.id}`, type: 'debt', liabilityId: String(l.id), label: l.name || 'Debt', skip: false, state: 'queued', startCents: c, remainingCents: c, balanceSeenCents: c };
    } else {
        const label = typeof fields.label === 'string' && fields.label.trim() ? fields.label.trim() : t('e.fire.newName');
        const used = new Set(ts.map((x) => x.id));
        let id = `t-${slug(label) || 'goal'}`;
        for (let n = 2; used.has(id); n++) id = `t-${slug(label) || 'goal'}-${n}`;
        target = { id, type: 'saver', label, goalCents: Math.max(0, Math.round(num(fields.goalCents))), savedCents: 0, skip: false, state: 'queued' };
    }
    const before = snapshot(data, ['savingModel']);
    const at = ts.length && ts[ts.length - 1].type === 'super' ? ts.length - 1 : ts.length;
    ts.splice(at, 0, target);
    refreshStates(data);
    return done(data, before, t('e.fire.added', { name: target.label }), { item: target, index: at });
}

/**
 * Edit a target you added, in place (its position and skip flag stay). Only a saver pot (the ones the Remove link is on) takes {label, goalCents}; the other targets are fixed. One undo puts the list back.
 */
export function updateTarget(data, id, fields = {}) {
    const ts = fireTargets(data);
    const i = ts ? ts.findIndex((x) => x && x.id === id) : -1;
    if (i < 0) return failed('missing');
    const tg = ts[i];
    if (tg.type === 'saver') {
        const label = typeof fields.label === 'string' ? fields.label.trim() : tg.label;
        if (!label) return failed('name');
        const before = snapshot(data, ['savingModel']);
        tg.label = label;
        if (fields.goalCents !== undefined) tg.goalCents = Math.max(0, Math.round(num(fields.goalCents)));
        refreshStates(data);
        return done(data, before, t('e.fire.updated', { name: label }), { item: tg, index: i });
    }
    return failed('fixed');
}

/** Remove a target you added (a saver pot or a debt). Saved money goes back into the Fire bucket. */
export function removeTarget(data, id) {
    const ts = fireTargets(data);
    const i = ts ? ts.findIndex((x) => x && x.id === id) : -1;
    if (i < 0) return failed('missing');
    if (!['saver', 'debt'].includes(ts[i].type)) return failed('fixed');
    const before = snapshot(data, ['savingModel', 'allocation']);
    const [tg] = ts.splice(i, 1);
    const fire = bucketByRole(data, 'fire');
    if (tg.type === 'saver' && num(tg.savedCents) > 0 && fire) fire.currentBalance = addDollars(fire.currentBalance, tg.savedCents);
    refreshStates(data);
    return done(data, before, t('e.fire.removed', { name: tg.label }), { item: tg, index: i });
}

/**
 * Put cash sitting in the Fire bucket on the active target (no interest accrues: this is not a pay).
 * opts: {cents (default all of it), today (logs a 'target' movement)}.
 */
export function applyCashToTarget(data, opts = {}) {
    const fire = bucketByRole(data, 'fire');
    const ts = fireTargets(data);
    if (!fire || !ts) return failed('model');
    const cash = toCents(fire.currentBalance);
    const amount = Math.min(cash, opts.cents != null ? Math.max(0, Math.round(opts.cents)) : cash);
    if (amount <= 0) return failed('cash');
    const st0 = refreshStates(data);
    if (st0.activeId === null) return failed('free');
    const before = snapshot(data, ['savingModel', 'allocation', 'liabilities']);
    const tg = ts.find((x) => x.id === st0.activeId);
    const mojoRow = bucketByRole(data, 'mojo');
    const { bal, ladder } = mojoState(data, livingFor(data));
    let use = amount;
    if (tg.type === 'debt') {
        use = Math.min(amount, num(tg.remainingCents));
        tg.remainingCents -= use;
        tg.balanceSeenCents = tg.remainingCents;
        const l = (data.liabilities || []).find((x) => x && String(x.id) === String(tg.liabilityId));
        if (l) l.balance = tg.remainingCents / 100;
    } else if (tg.type === 'mojo') {
        use = Math.min(amount, num(ladder.targetCents) > 0 ? Math.max(0, ladder.targetCents - bal) : amount);
        if (mojoRow) mojoRow.currentBalance = addDollars(mojoRow.currentBalance, use);
    } else if (tg.type === 'home' || tg.type === 'saver') {
        use = Math.min(amount, num(tg.goalCents) > 0 ? Math.max(0, tg.goalCents - num(tg.savedCents)) : amount);
        tg.savedCents = num(tg.savedCents) + use;
    } else {
        tg.savedCents = num(tg.savedCents) + use;
    }
    if (use <= 0) return failed('room');
    fire.currentBalance = addDollars(fire.currentBalance, -use);
    const sm = data.savingModel;
    if (opts.today) {
        sm.movements = Array.isArray(sm.movements) ? sm.movements : [];
        sm.movements.push({ date: opts.today, bucketId: tg.type === 'mojo' && mojoRow ? mojoRow.id : fire.id, cents: use, kind: 'target' });
    }
    const st = refreshStates(data);
    const now = ts.find((x) => x.id === tg.id);
    if (now.state === 'done' && !now.doneOn && opts.today) now.doneOn = opts.today;
    return done(data, before, t('e.fire.applied', { amount: aud(use), name: tg.label }), { appliedCents: use, activeId: st.activeId });
}

// ---------- Mojo ----------

/** Mojo settings: {starter (cents), months (0 to 24), basis ('auto'|'actual'|'planned')}. Only the named fields change. */
export function setMojo(data, fields = {}) {
    const sm = data && data.savingModel;
    if (!sm) return failed('model');
    const m = isObj(sm.mojo) ? sm.mojo : { starter: 200000, months: 3, basis: 'auto', steps: [] };
    const next = { ...m };
    if (fields.starter !== undefined) {
        if (!Number.isFinite(fields.starter) || fields.starter < 0) return failed('starter');
        next.starter = Math.round(fields.starter);
    }
    if (fields.months !== undefined) {
        if (!Number.isFinite(fields.months) || fields.months < 0 || fields.months > 24) return failed('months');
        next.months = fields.months;
    }
    if (fields.basis !== undefined) {
        if (!['auto', 'actual', 'planned'].includes(fields.basis)) return failed('basis');
        next.basis = fields.basis;
    }
    const before = snapshot(data, ['savingModel']);
    sm.mojo = next;
    refreshStates(data);
    return done(data, before, t('e.mojo.changed'));
}

/** Add a custom Mojo step (cents). */
export function addMojoStep(data, amountCents) {
    const sm = data && data.savingModel;
    if (!sm || !Number.isFinite(amountCents) || amountCents <= 0) return failed(sm ? 'amount' : 'model');
    const before = snapshot(data, ['savingModel']);
    sm.mojo = isObj(sm.mojo) ? sm.mojo : { starter: 200000, months: 3, basis: 'auto', steps: [] };
    sm.mojo.steps = Array.isArray(sm.mojo.steps) ? sm.mojo.steps : [];
    const used = new Set(sm.mojo.steps.map((s) => s && s.id));
    let n = 1;
    while (used.has(`mojo-step-${n}`)) n++;
    const step = { id: `mojo-step-${n}`, kind: 'custom', amount: Math.round(amountCents) };
    sm.mojo.steps.push(step);
    refreshStates(data);
    return done(data, before, t('e.mojo.stepAdded', { amount: aud(step.amount) }), { item: step });
}

export function removeMojoStep(data, id) {
    const steps = data && data.savingModel && data.savingModel.mojo && data.savingModel.mojo.steps;
    const i = Array.isArray(steps) ? steps.findIndex((s) => s && s.id === id) : -1;
    if (i < 0) return failed('missing');
    const before = snapshot(data, ['savingModel']);
    const [step] = steps.splice(i, 1);
    refreshStates(data);
    return done(data, before, t('e.mojo.stepRemoved', { amount: aud(num(step.amount)) }), { item: step });
}

// ---------- category links, transfers ----------

/**
 * Point a category at a bucket (FT-R-70), or null to follow the essential tick again. Only a spend or
 * save bucket can be a target; Mojo and Grow cannot. A relink changes future resolution only.
 */
export function relinkCategory(data, categoryId, bucketId) {
    const cat = (Array.isArray(data.categories) ? data.categories : []).find((c) => c && c.id === categoryId);
    if (!cat) return failed('missing');
    let row = null;
    if (bucketId != null) {
        row = rowById(data, bucketId);
        if (!row || row.role === 'mojo' || row.role === 'grow' || (row.kind && !['spend', 'save'].includes(row.kind))) return failed('bucket');
    }
    const before = snapshot(data, ['categories']);
    cat.bucketId = row ? row.id : null;
    return done(data, before, row ? t('e.category.relinked', { name: cat.name, bucket: row.name }) : t('e.category.unlinked', { name: cat.name }), { item: cat });
}

/** "Done in my bank": record this pay's amount for a bucket (or every bucket listed) in bankSetTo. */
export function tickTransfer(data, bucketId) {
    const sm = data && data.savingModel;
    if (!sm || !sm.transfers) return failed('model');
    let net = 0;
    try { net = netPerPayCents(data); } catch (e) { net = 0; }
    const rows = transfersToUpdate({ allocation: data.allocation, netCents: net, bankSetTo: sm.transfers.bankSetTo });
    const pick = bucketId == null ? rows : rows.filter((r) => String(r.bucketId) === String(bucketId));
    if (!pick.length) return failed('nothing');
    const before = snapshot(data, ['savingModel']);
    sm.transfers.bankSetTo = markTransfersDone(sm.transfers.bankSetTo, pick);
    return done(data, before, t('e.transfer.ticked', { name: pick.length === 1 ? pick[0].name : t('e.transfer.all') }), { ticked: pick.map((r) => r.bucketId) });
}

// ---------- auto-credit and the pay roll ----------

function applyRoll(data, next) {
    ['allocation', 'liabilities', 'bucketGoals', 'savingModel'].forEach((k) => replaceIn(data, k, next[k]));
}

/** Newest saved marker in storage (another tab may have rolled), or null. Guarded: storage can throw. */
export function readPersistedMarker(storage) {
    try {
        const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        const raw = s && s.getItem(STORAGE_KEY);
        const m = raw && JSON.parse(raw).financeData.savingModel.autoCredit.rolledThrough;
        return typeof m === 'string' ? m : null;
    } catch (e) { return null; }
}

/**
 * Turn pay-day auto-credit on or off (FT-R-80). Turning on forgets an old marker, so the first roll only
 * sets it to the latest pay date: no retroactive credit. Off changes nothing else. Undo restores the setting.
 */
export function setAutoCredit(data, on) {
    const sm = data && data.savingModel;
    if (!sm) return failed('model');
    const before = snapshot(data, ['savingModel']);
    sm.autoCredit = { ...(isObj(sm.autoCredit) ? sm.autoCredit : {}), on: !!on };
    if (on && !before.savingModel.autoCredit?.on) sm.autoCredit.rolledThrough = null;
    return done(data, before, t(on ? 'e.auto.on' : 'e.auto.off'));
}

/**
 * Roll the pay days up to `today` (E2's runPayRoll) into `data` in place. Off or nothing due changes
 * nothing. Two runs on one day credit once (the marker moves). `opts.persistedMarker` (a date, or null)
 * is the marker saved in storage: when it is ahead of this copy another tab already rolled, so skip.
 * Returns {ok, changed, paysApplied, skipped, message, onUndo, onExpire}.
 */
export function rollPayDays(data, today, opts = {}) {
    const none = { ok: true, changed: false, paysApplied: 0, skipped: 0, message: '', onUndo() {}, onExpire: undefined };
    const ours = data && data.savingModel && data.savingModel.autoCredit && data.savingModel.autoCredit.rolledThrough;
    const theirs = opts.persistedMarker;
    if (typeof theirs === 'string' && (!ours || theirs > ours)) return { ...none, behind: true };
    const r = rollCalc(data, today, opts);
    if (!r.changed) return none;
    const before = snapshot(data, ['allocation', 'liabilities', 'bucketGoals', 'savingModel']);
    applyRoll(data, r.data);
    const u = done(data, before, r.paysApplied ? t('e.roll.done', { count: r.paysApplied }) : '', {});
    return { ...u, changed: true, paysApplied: r.paysApplied, skipped: r.skipped };
}

/** The wiring for main.js: today from the clock, the marker re-read from storage. */
export function runPayRollIfDue(data, opts = {}) {
    const today = opts.today || toIso(new Date());
    const persistedMarker = opts.persistedMarker !== undefined ? opts.persistedMarker : readPersistedMarker(opts.storage);
    return rollPayDays(data, today, { ...opts, persistedMarker });
}
