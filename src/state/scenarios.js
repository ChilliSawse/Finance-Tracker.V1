// Scenario store (F1): the IndexedDB `scenarios` store, its restore sanitizer (G6), the backup part,
// and "Make this real" (FT-R-95), which applies changes through B4's and E5's state APIs.
//
//   scenario = { id, name, startedFrom, createdAt, updatedAt, pinned, archived, changes: [change], presetId }
//
// List order: pinned first, then updatedAt descending; archived hidden but kept. No cap on how many.
// The pure maths (resolveAt, segments, conflicts, headline, makeRealPlan) is in src/calc/scenario.js.

import { withStore } from './db.js';
import { registerBackupPart, cleanValue, MAX_PART_ROWS } from './backup.js';
import { changeProblems, applyOp, isIsoDate } from '../calc/scenario.js';
import { addPlanItem, updatePlanItem, removePlanItem } from './plan.js';
import { setSplit, addGoal, updateGoal, removeGoal } from './saving-model.js';
import { t, plural } from '../i18n/strings.js';

export const MAX_SCENARIO_ROWS = 10000;   // on restore; saving by hand has no cap
export const MAX_CHANGES = 500;           // changes in one scenario, on save and on restore
const MAX_ROW_JSON = 400000;              // characters, one scenario row
const MAX_NAME = 120;
const MAX_NOTE = 500;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cut = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const isStamp = (s) => typeof s === 'string' && s.length > 0 && s.length <= 40 && !Number.isNaN(Date.parse(s));
const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

/** One change from untrusted JSON: a clean copy, or null when it cannot be used. */
export function sanitizeChange(raw) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 200) return null;
    if (changeProblems(raw).length) return null;
    const c = {
        id: raw.id,
        kind: raw.kind,
        target: isObj(raw.target) ? { collection: raw.target.collection, id: raw.target.id == null ? null : raw.target.id } : null,
        field: raw.field == null ? null : raw.field,
        op: raw.op,
        value: raw.value === undefined ? null : cleanValue(raw.value, 0),
        baseValue: raw.baseValue === undefined ? null : cleanValue(raw.baseValue, 0),
        from: raw.from == null ? null : raw.from,
        until: raw.until == null ? null : raw.until,
        note: cut(raw.note, MAX_NOTE),
    };
    // The cleaned value must still satisfy the rules (a value that vanished is not allowed).
    return changeProblems(c).length ? null : c;
}

/** One scenario from untrusted JSON (a file or a save): {scenario, dropped} or null when it has no usable id. */
export function sanitizeScenario(raw, now = new Date()) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 200) return null;
    const stamp = now.toISOString();
    const list = Array.isArray(raw.changes) ? raw.changes.slice(0, MAX_CHANGES) : [];
    let dropped = Array.isArray(raw.changes) ? Math.max(0, raw.changes.length - list.length) : 0;
    const changes = [];
    const seen = new Set();
    for (const r of list) {
        const c = sanitizeChange(r);
        if (!c || seen.has(c.id)) { dropped++; continue; }
        seen.add(c.id);
        changes.push(c);
    }
    const scenario = {
        id: raw.id,
        name: cut(raw.name, MAX_NAME),
        startedFrom: isIsoDate(raw.startedFrom) ? raw.startedFrom : null,
        createdAt: isStamp(raw.createdAt) ? raw.createdAt : stamp,
        updatedAt: isStamp(raw.updatedAt) ? raw.updatedAt : stamp,
        pinned: raw.pinned === true,
        archived: raw.archived === true,
        changes,
        presetId: typeof raw.presetId === 'string' && raw.presetId.length <= 60 ? raw.presetId : null,
    };
    if (JSON.stringify(scenario).length > MAX_ROW_JSON) return null;
    return { scenario, dropped };
}

/** Backup restore: scenarios from a file. A row that cannot be used is left out and counted. */
export function sanitizeScenarioRows(rows) {
    const out = [];
    let skipped = 0;
    const list = Array.isArray(rows) ? rows.slice(0, Math.min(MAX_SCENARIO_ROWS, MAX_PART_ROWS)) : [];
    skipped += Array.isArray(rows) ? Math.max(0, rows.length - list.length) : 0;
    const ids = new Set();
    for (const r of list) {
        const res = sanitizeScenario(r);
        if (!res || ids.has(res.scenario.id)) { skipped++; continue; }
        ids.add(res.scenario.id);
        skipped += res.dropped;
        out.push(res.scenario);
    }
    return { rows: out, skipped };
}

/** Pinned first, then updatedAt descending (ties: newest created, then id), so the order is always the same. */
export function orderScenarios(rows) {
    return rows.slice().sort((a, b) => (b.pinned === true) - (a.pinned === true)
        || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)
        || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
        || (a.id < b.id ? -1 : 1));
}

/** The saved scenarios in list order. Archived ones are hidden unless `includeArchived`. */
export async function listScenarios({ includeArchived = false } = {}) {
    const rows = await withStore('scenarios', 'readonly', (s) => s.getAll());
    return orderScenarios(rows.filter((r) => includeArchived || !r.archived));
}

export async function getScenario(id) {
    return (await withStore('scenarios', 'readonly', (s) => s.get(id))) || null;
}

/** A blank scenario (not saved). */
export function newScenario(fields = {}, now = new Date()) {
    const stamp = now.toISOString();
    return {
        id: newId('sc'), name: cut(fields.name, MAX_NAME), startedFrom: isIsoDate(fields.startedFrom) ? fields.startedFrom : null,
        createdAt: stamp, updatedAt: stamp, pinned: false, archived: false, changes: [], presetId: fields.presetId || null,
    };
}

/** A fresh change id, unique inside `changes`. */
export function newChangeId(changes = []) {
    const used = new Set(changes.map((c) => c && c.id));
    let id;
    do id = newId('ch'); while (used.has(id));
    return id;
}

/**
 * Save (add or replace) one scenario. Changes that cannot be used are dropped and counted.
 * `opts.now` sets the timestamps (tests); `opts.touch === false` keeps `updatedAt`.
 * @returns {Promise<{ok:boolean, scenario?:object, dropped?:number}>}
 */
export async function saveScenario(scenario, opts = {}) {
    const now = opts.now || new Date();
    const res = sanitizeScenario(isObj(scenario) ? { ...scenario, id: scenario.id || newId('sc') } : null, now);
    if (!res) return { ok: false };
    const row = res.scenario;
    if (opts.touch !== false) row.updatedAt = now.toISOString();
    await withStore('scenarios', 'readwrite', (s) => { s.put(row); });
    return { ok: true, scenario: row, dropped: res.dropped };
}

/** A copy with a new id, new change ids and the name plus " copy"; not pinned, not archived. */
export async function duplicateScenario(id, opts = {}) {
    const src = await getScenario(id);
    if (!src) return { ok: false };
    const now = opts.now || new Date();
    const copy = {
        ...JSON.parse(JSON.stringify(src)), id: newId('sc'), name: cut(`${src.name} copy`, MAX_NAME),
        createdAt: now.toISOString(), pinned: false, archived: false,
    };
    copy.changes = copy.changes.map((c) => ({ ...c, id: newId('ch') }));
    return saveScenario(copy, { now });
}

async function patchScenario(id, patch, opts) {
    const src = await getScenario(id);
    if (!src) return { ok: false };
    return saveScenario({ ...src, ...patch }, opts);
}
export const renameScenario = (id, name, opts) => patchScenario(id, { name: cut(String(name == null ? '' : name).trim(), MAX_NAME) }, opts);
export const pinScenario = (id, pinned = true, opts) => patchScenario(id, { pinned: !!pinned }, opts);
export const archiveScenario = (id, archived = true, opts) => patchScenario(id, { archived: !!archived }, opts);

// ---------- the backup part (D2's extension point): export, restore and erase-all ----------

export const SCENARIOS_PART = {
    key: 'scenarios',
    read: () => withStore('scenarios', 'readonly', (s) => s.getAll()),
    sanitize: sanitizeScenarioRows,
    async replace(rows) {
        await withStore('scenarios', 'readwrite', (s) => { s.clear(); });
        if (rows.length) await withStore('scenarios', 'readwrite', (s) => { rows.forEach((r) => s.put(r)); });
    },
};
registerBackupPart(SCENARIOS_PART);

// ---------- Make this real ----------

const liveRow = (data, c) => (Array.isArray(data[c.target.collection]) ? data[c.target.collection].find((r) => isObj(r) && r.id === c.target.id) : undefined);

function applyPlanChange(data, c) {
    if (c.target.id == null) return c.op === 'add' ? addPlanItem(data, c.value) : { ok: false, code: 'shape' };
    if (c.op === 'remove') return removePlanItem(data, c.target.id);
    const row = liveRow(data, c);
    if (!row) return { ok: false, code: 'missing' };
    const next = applyOp(row[c.field], c);
    const res = updatePlanItem(data, c.target.id, { [c.field]: next });
    if (res.ok && JSON.stringify(res.item[c.field]) !== JSON.stringify(next)) { res.onUndo(); return { ok: false, code: 'field' }; }
    return res;
}

function applyGoalChange(data, c) {
    if (c.target.id == null) return c.op === 'add' && isObj(c.value) ? addGoal(data, c.value.parentId, c.value) : { ok: false, code: 'shape' };
    if (c.op === 'remove') return removeGoal(data, c.target.id);
    const row = liveRow(data, c);
    if (!row) return { ok: false, code: 'missing' };
    return updateGoal(data, c.target.id, { [c.field]: applyOp(row[c.field], c) });
}

function applySplitChanges(data, cs) {
    const map = {};
    for (const c of cs) {
        const row = c.target.id == null ? null : liveRow(data, c);
        if (!row || c.field !== 'percentage') return { ok: false, code: 'shape' };
        map[c.target.id] = applyOp(row.percentage, c);
    }
    return setSplit(data, map);
}

function applyFiChange(data, c) {
    const fi = isObj(data.fiSettings) ? data.fiSettings : (data.fiSettings = {});
    const next = applyOp(fi[c.field], c);
    if (typeof next !== 'number' || !Number.isFinite(next)) return { ok: false, code: 'value' };
    const had = Object.prototype.hasOwnProperty.call(fi, c.field);
    const old = fi[c.field];
    fi[c.field] = next;
    return { ok: true, onUndo() { if (had) fi[c.field] = old; else delete fi[c.field]; } };
}

/**
 * Apply steps from `makeRealPlan` through the owners' APIs: plan items via B4, split and goals via E5,
 * FI assumptions directly. Income, loan and asset steps are handed back in `sheets` for the screen to
 * open the normal sheet pre-filled (C6's `openIncomeSheet`, F5's sheets); one-offs and ticked balances
 * have no real equivalent and come back in `skipped`. The caller renders and saves afterwards.
 * No clock and no timer: nothing is scheduled.
 * @returns {{ok:boolean, message:string, applied:string[], failed:{id:string, code:string}[], sheets:object[],
 *            skipped:object[], onUndo:Function, onExpire:undefined}} one undo payload for the whole call
 */
export function applyMakeReal(data, steps) {
    const undos = [];
    const applied = [];
    const failed = [];
    const sheets = [];
    const skipped = [];
    for (const step of Array.isArray(steps) ? steps : []) {
        let res = null;
        const c = step.changes[0];
        switch (step.route) {
            case 'plan': res = applyPlanChange(data, c); break;
            case 'goal': res = applyGoalChange(data, c); break;
            case 'split': res = applySplitChanges(data, step.changes); break;
            case 'fi': res = applyFiChange(data, c); break;
            case 'income': case 'debt': case 'asset': sheets.push(step); continue;
            default: skipped.push(step); continue;
        }
        if (res && res.ok) { applied.push(step.id); undos.push(res); } else failed.push({ id: step.id, code: (res && res.code) || 'failed' });
    }
    let used = false;
    return {
        ok: failed.length === 0, applied, failed, sheets, skipped, onExpire: undefined,
        message: plural(applied.length, 'f.scenario.madeReal.one', 'f.scenario.madeReal'),
        onUndo() {
            if (used) return;
            used = true;
            for (const u of undos.slice().reverse()) u.onUndo();
        },
    };
}
