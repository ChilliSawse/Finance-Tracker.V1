// Scenario resolver (owner: F1, M-14). A scenario is a list of dated changes laid over the real data,
// never a clone, so it is never stale: change real rent and every scenario that did not touch rent
// picks it up. Pure: no DOM, no storage. The IndexedDB store and Make this real's state calls are
// in src/state/scenarios.js.
//
//   change = { id, kind, target:{collection, id}|null, field, op:'set'|'scale'|'add'|'remove',
//              value, baseValue, from:'YYYY-MM-DD'|null, until:'YYYY-MM-DD'|null, note }
//
// Targets are by id, never by index. A change whose target no longer exists is skipped (never thrown)
// and listed by `missingTargets`. `scale` takes a FACTOR (1.1 is +10%). `add` with a target and a field
// adds a number; `add` with `target.id` null appends `value` to the collection (a new income source, a
// loan, a goal). `remove` deletes the target row.

import { rebaseIncomeSources, fillNewSalarySource } from './income-rebase.js';
import { addGoal, removeGoal } from '../state/saving-model.js';

export const KINDS = ['income', 'expense', 'split', 'goal', 'goalFund', 'incomeAdd', 'debtAdd', 'oneOff', 'assumption'];
export const OPS = ['set', 'scale', 'add', 'remove'];
export const COLLECTIONS = ['plan', 'allocation', 'bucketGoals', 'liabilities', 'assets', 'incomeSources', 'fiSettings'];

// Which collections a kind may touch.
export const KIND_COLLECTIONS = {
    income: ['incomeSources'],
    expense: ['plan'],
    split: ['allocation'],
    goal: ['bucketGoals'],
    goalFund: ['assets', 'allocation'],
    incomeAdd: ['incomeSources'],
    debtAdd: ['liabilities'],
    oneOff: [],
    assumption: ['fiSettings'],
};

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FIELD_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(s) {
    if (typeof s !== 'string') return false;
    const m = ISO_RE.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function toIso(date) {
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
        const p = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
    }
    return typeof date === 'string' ? date : '';
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Deep copy that keeps Infinity (the tax bands' top edge). */
function deepClone(v) {
    if (v === undefined) return null;
    return structuredClone(v);
}

/**
 * Why a change cannot be used, as a list of codes (empty when it is fine). Used on save and on restore.
 * Codes: shape, kind, op, target, collection, field, value, from, until.
 */
export function changeProblems(c) {
    const out = [];
    if (!isObj(c)) return ['shape'];
    if (!KINDS.includes(c.kind)) out.push('kind');
    if (!OPS.includes(c.op)) out.push('op');
    if (c.from != null && !isIsoDate(c.from)) out.push('from');
    if (c.until != null && !isIsoDate(c.until)) out.push('until');
    if (c.from && c.until && c.until < c.from) out.push('until');
    const tg = c.target;
    if (tg != null) {
        if (!isObj(tg) || !COLLECTIONS.includes(tg.collection)) out.push('collection');
        else if (tg.id != null && (typeof tg.id !== 'string' || !tg.id || tg.id.length > 200)) out.push('target');
        else if (KINDS.includes(c.kind) && !KIND_COLLECTIONS[c.kind].includes(tg.collection)) out.push('collection');
    } else if (c.kind !== 'oneOff') out.push('collection');
    if (c.field != null && (typeof c.field !== 'string' || !FIELD_RE.test(c.field) || BAD_KEYS.has(c.field))) out.push('field');
    const targeted = isObj(tg) && tg.id != null;
    if (c.kind === 'oneOff') {
        if (!(isNum(c.value) || (isObj(c.value) && isNum(c.value.amount)))) out.push('value');
    } else if (c.op === 'scale' || (c.op === 'add' && targeted && c.field)) {
        if (!isNum(c.value)) out.push('value');
    } else if (c.op === 'add' && isObj(tg) && tg.id == null && tg.collection !== 'fiSettings') {
        if (!isObj(c.value)) out.push('value');
    } else if (c.op === 'set' && c.value === undefined) out.push('value');
    const needsField = isObj(tg) && c.kind !== 'oneOff' && c.kind !== 'goalFund' && c.op !== 'remove'
        && (targeted || tg.collection === 'fiSettings');
    if (needsField && !c.field) out.push('field');
    return [...new Set(out)];
}

/** True when the change is active on `date` (from <= date < until; a null end is open). */
export function isActiveOn(change, date) {
    const d = toIso(date);
    if (!isIsoDate(d) || !isObj(change)) return false;
    if (change.from != null && (!isIsoDate(change.from) || change.from > d)) return false;
    if (change.until != null && (!isIsoDate(change.until) || change.until <= d)) return false;
    return true;
}

/** The new value one change gives a number or value (pure; used by the resolver and by Make this real). */
export function applyOp(current, change) {
    switch (change.op) {
        case 'set': return deepClone(change.value);
        case 'scale': return isNum(current) && isNum(change.value) ? current * change.value : current;
        case 'add': return isNum(change.value) ? (isNum(current) ? current : 0) + change.value : current;
        default: return current;
    }
}

function rowIndex(list, id) {
    if (!Array.isArray(list)) return -1;
    return list.findIndex((r) => isObj(r) && r.id === id);
}

/** True when the change's target row is still in `data` (no target, or an add, counts as present). */
export function targetExists(data, change) {
    const tg = isObj(change) ? change.target : null;
    if (!isObj(tg) || tg.id == null) return true;
    if (!isObj(data)) return false;
    return rowIndex(data[tg.collection], tg.id) >= 0;
}

/** Changes whose target is gone: shown as "no longer in your plan" and skipped. */
export function missingTargets(data, changes) {
    return (Array.isArray(changes) ? changes : []).filter((c) => isObj(c) && !targetExists(data, c));
}

function applyOne(out, c) {
    const tg = isObj(c.target) ? c.target : null;
    if (c.kind === 'oneOff') {
        if (!Array.isArray(out.scenarioOneOffs)) out.scenarioOneOffs = [];
        const amount = isNum(c.value) ? c.value : isObj(c.value) && isNum(c.value.amount) ? c.value.amount : null;
        if (amount !== null) out.scenarioOneOffs.push({ id: c.id, amount, date: c.from, note: typeof c.note === 'string' ? c.note : '' });
        return;
    }
    if (!tg) return;
    if (c.kind === 'goalFund') {
        // Ticked on by default (op add or set, any value but false); off when op is 'remove' or value is false (F4's shape).
        if (c.op === 'remove' || c.value === false) return;
        if (tg.id == null || rowIndex(out[tg.collection], tg.id) < 0) return;
        if (!Array.isArray(out.scenarioGoalFunds)) out.scenarioGoalFunds = [];
        if (!out.scenarioGoalFunds.some((f) => f.collection === tg.collection && f.id === tg.id)) out.scenarioGoalFunds.push({ collection: tg.collection, id: tg.id });
        return;
    }
    if (tg.collection === 'fiSettings' && tg.id == null) {
        if (!isObj(out.fiSettings)) out.fiSettings = {};
        if (c.field && c.op !== 'remove') out.fiSettings[c.field] = applyOp(out.fiSettings[c.field], c);
        return;
    }
    if (tg.id == null) {
        if (c.op !== 'add' || !isObj(c.value)) return;
        if (!Array.isArray(out[tg.collection])) out[tg.collection] = [];
        const row = deepClone(c.value);
        if (typeof row.id !== 'string' || !row.id) row.id = `sc-${c.id}`;
        if (rowIndex(out[tg.collection], row.id) >= 0) return;
        // H6: a new row goes in the way the app's own save puts it in, so every figure that reads it matches.
        if (tg.collection === 'incomeSources') fillNewSalarySource(row);
        if (tg.collection === 'bucketGoals' && isObj(row) && row.parentId != null) {
            const res = addGoal(out, row.parentId, { name: row.name, cost: row.cost, saved: row.saved, due: row.due }, { fork: true });
            if (res.ok) { res.item.id = row.id; return; }
        }
        out[tg.collection].push(row);
        return;
    }
    const list = out[tg.collection];
    const i = rowIndex(list, tg.id);
    if (i < 0) return; // the target is gone: skipped, never thrown
    if (c.op === 'remove') {
        // H6: dropping a goal moves its saved money up and rebalances its siblings, as the app does.
        if (tg.collection === 'bucketGoals' && removeGoal(out, tg.id).ok) return;
        list.splice(i, 1);
        return;
    }
    if (!c.field) return;
    let next = applyOp(list[i][c.field], c);
    // H6: the app's split save keeps one decimal (setSplit); a scenario split reads the same percentage.
    if (tg.collection === 'allocation' && c.field === 'percentage' && isNum(next)) next = Math.round(next * 10) / 10;
    list[i][c.field] = next;
}

/**
 * Data as it stands on a date once the scenario's changes apply: a transient deep clone (never the
 * input, never stored) with every change active on that date applied in list order.
 * Never throws on a change it cannot place: a missing target, a row with no id or role, a bad field.
 * Virtual results: `scenarioOneOffs` (dated one-off costs and gains) and `scenarioGoalFunds` (balances
 * ticked as counting towards goals) are added to the clone only when a change asks for them.
 */
export function resolveAt(data, changes, date) {
    const out = deepClone(data === undefined ? null : data);
    if (!isObj(out) || !Array.isArray(changes)) return out;
    for (const c of changes) {
        if (!isObj(c) || changeProblems(c).length || !isActiveOn(c, date)) continue;
        applyOne(out, c);
    }
    // H5: a new gross on a source with payslip figures must move those figures too, or take-home, tax, per pay
    // and savings stay on the old payslip while only the long-range numbers move.
    rebaseIncomeSources(data.incomeSources, out.incomeSources, date);
    return out;
}

/** Sorted unique dates strictly inside (from, to) where some change starts or ends. */
export function breakpoints(changes, from, to) {
    const set = new Set();
    for (const c of Array.isArray(changes) ? changes : []) {
        if (!isObj(c)) continue;
        for (const d of [c.from, c.until]) if (isIsoDate(d) && d > from && d < to) set.add(d);
    }
    return [...set].sort();
}

/**
 * The date segments between the breakpoints: `[{from, to, key}]`, `to` exclusive, `key` the active
 * change ids (a cache key: two segments with one key resolve the same). One segment when no change
 * falls inside the range. An invalid or empty range gives [].
 */
export function segments(changes, from, to) {
    if (!isIsoDate(from) || !isIsoDate(to) || to <= from) return [];
    const list = Array.isArray(changes) ? changes : [];
    const cuts = [from, ...breakpoints(list, from, to), to];
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
        const key = list.filter((c) => isObj(c) && !changeProblems(c).length && isActiveOn(c, cuts[i])).map((c) => c.id).join('|');
        out.push({ from: cuts[i], to: cuts[i + 1], key });
    }
    return out;
}

/**
 * Resolve once per segment, caching by the set of active change ids: `[{from, to, key, data}]`.
 * Segments with the same key share one resolution (so `resolutions` can be lower than the segment count
 * when a change ends and an identical set returns); `opts.resolve` lets a test count the calls.
 */
export function resolveSegments(data, changes, from, to, opts = {}) {
    const resolve = opts.resolve || resolveAt;
    const cache = new Map();
    return segments(changes, from, to).map((s) => {
        if (!cache.has(s.key)) cache.set(s.key, resolve(data, changes, s.from));
        return { ...s, data: cache.get(s.key) };
    });
}

/**
 * The conflict rule. `baseValue` is the real value when the change was made; if the live value now
 * differs, the row reads "Real rent is now A$520; this scenario says A$610" with Keep or Update.
 * Only a `set` with a recorded baseValue can conflict. Returns {conflict, live, scenario}.
 */
export function conflictFor(data, change) {
    const tg = isObj(change) ? change.target : null;
    let live = null;
    if (isObj(data) && isObj(tg) && c_hasField(change)) {
        if (tg.id == null && tg.collection === 'fiSettings') live = isObj(data.fiSettings) ? data.fiSettings[change.field] : null;
        else {
            const list = data[tg.collection];
            const i = rowIndex(list, tg.id);
            live = i >= 0 ? list[i][change.field] : null;
        }
    }
    const scenario = isObj(change) ? change.value : null;
    const has = isObj(change) && change.op === 'set' && change.baseValue !== null && change.baseValue !== undefined
        && live !== null && live !== undefined;
    const conflict = !!has && !sameValue(live, change.baseValue) && !sameValue(live, scenario);
    return { conflict, live: live === undefined ? null : live, scenario: scenario === undefined ? null : scenario };
}

function c_hasField(c) { return typeof c.field === 'string' && c.field.length > 0; }
function sameValue(a, b) {
    return isNum(a) && isNum(b) ? Math.abs(a - b) < 1e-9 : a === b;
}

/** Every conflicting change of a scenario, as [{change, live, scenario}]. */
export function conflictsFor(data, changes) {
    const out = [];
    for (const c of Array.isArray(changes) ? changes : []) {
        const r = conflictFor(data, c);
        if (r.conflict) out.push({ change: c, live: r.live, scenario: r.scenario });
    }
    return out;
}

/**
 * The one line under a scenario in the Future list, from results the caller already worked out
 * (F3's FI years, F4's goal verdict, E2's left per pay): goals present gives the goal verdict;
 * else the FI years difference; else the left-this-pay difference; else nothing.
 * Returns {kind, key, params} where `key` is a catalogue key (`f.scenario.headline.*`) for `t()`.
 * @param {{goals?:{verdict:'on'|'short'|'ahead', shortPerPayCents?:number}|null,
 *          fiYears?:{now:number, scenario:number}|null,
 *          leftPerPayCents?:{now:number, scenario:number}|null}} summary
 */
export function scenarioHeadline(summary) {
    const s = isObj(summary) ? summary : {};
    if (isObj(s.goals) && ['on', 'short', 'ahead'].includes(s.goals.verdict)) {
        return { kind: 'goal', key: `f.scenario.headline.goal.${s.goals.verdict}`, params: { cents: isNum(s.goals.shortPerPayCents) ? Math.abs(s.goals.shortPerPayCents) : 0 } };
    }
    const fy = s.fiYears;
    if (isObj(fy) && (isNum(fy.now) || fy.now === Infinity) && (isNum(fy.scenario) || fy.scenario === Infinity)) {
        if (fy.now === Infinity && fy.scenario === Infinity) return { kind: 'fi', key: 'f.scenario.headline.fi.never', params: {} };
        if (fy.scenario === Infinity) return { kind: 'fi', key: 'f.scenario.headline.fi.never', params: {} };
        if (fy.now === Infinity) return { kind: 'fi', key: 'f.scenario.headline.fi.reaches', params: { years: round1(fy.scenario) } };
        const diff = round1(fy.scenario - fy.now);
        if (diff === 0) return { kind: 'fi', key: 'f.scenario.headline.fi.same', params: {} };
        return { kind: 'fi', key: diff < 0 ? 'f.scenario.headline.fi.sooner' : 'f.scenario.headline.fi.later', params: { years: Math.abs(diff) } };
    }
    const lp = s.leftPerPayCents;
    if (isObj(lp) && isNum(lp.now) && isNum(lp.scenario)) {
        const diff = Math.round(lp.scenario - lp.now);
        if (diff === 0) return { kind: 'left', key: 'f.scenario.headline.left.same', params: {} };
        return { kind: 'left', key: diff > 0 ? 'f.scenario.headline.left.more' : 'f.scenario.headline.left.less', params: { cents: Math.abs(diff) } };
    }
    return { kind: 'none', key: 'f.scenario.headline.none', params: {} };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Make this real, the plan (FT-R-95): no clock, nothing scheduled. Changes active `today` apply
 * together; each future-dated change is offered one at a time (a split's changes with one start date
 * stay together, because a split only saves at 100); `until` dates are dropped (named in `droppedUntil`
 * so the screen shows a note); a missing target is listed in `missing` and never offered.
 * Each step carries a `route`: 'plan' (B4), 'split' and 'goal' (E5), 'fi' (FI settings, direct),
 * 'income', 'asset' and 'debt' (the normal sheet, pre-filled, opened by the screen), or 'virtual'
 * (a one-off or a ticked balance has no real equivalent: shown, not applied).
 * @returns {{now:Step[], later:Step[], droppedUntil:string[], missing:object[], conflicts:object[]}}
 */
export function makeRealPlan(data, changes, today) {
    const day = toIso(today);
    const list = (Array.isArray(changes) ? changes : []).filter((c) => isObj(c) && !changeProblems(c).length);
    const missing = list.filter((c) => !targetExists(data, c));
    const gone = new Set(missing.map((c) => c.id));
    const usable = list.filter((c) => !gone.has(c.id));
    const droppedUntil = usable.filter((c) => c.until != null).map((c) => c.id);
    const started = usable.filter((c) => c.until == null || c.until > day);
    const active = started.filter((c) => c.from == null || c.from <= day);
    const future = started.filter((c) => c.from != null && c.from > day);
    const step = (cs) => ({ id: cs.map((c) => c.id).join('+'), from: cs[0].from, route: routeFor(cs[0]), changes: cs });
    const group = (cs) => {
        const steps = [];
        const splits = new Map();
        for (const c of cs) {
            if (c.kind === 'split') {
                const k = c.from || '';
                if (!splits.has(k)) { const s = []; splits.set(k, s); steps.push(s); }
                splits.get(k).push(c);
            } else steps.push([c]);
        }
        return steps.map(step);
    };
    return {
        now: group(active),
        later: group(future).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)),
        droppedUntil,
        missing,
        conflicts: conflictsFor(data, usable),
    };
}

/** Which owner applies a change. */
export function routeFor(c) {
    switch (c.kind) {
        case 'expense': return 'plan';
        case 'split': return 'split';
        case 'goal': return 'goal';
        case 'assumption': return 'fi';
        case 'income': case 'incomeAdd': return 'income';
        case 'debtAdd': return 'debt';
        case 'goalFund': case 'oneOff': return 'virtual';
        default: return 'virtual';
    }
}
