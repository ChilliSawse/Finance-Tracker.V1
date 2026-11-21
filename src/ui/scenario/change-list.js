// What If, the Adjust step's change list (owner: F7). `describeChange` is pure (plain strings, the DOM
// code sets them as text); `editSpecFor` picks the sheet that edits a change; `renderChangeList` builds
// the rows with dates, Edit and Remove, "no longer in your plan" and the Keep or Update conflict row.

import { t } from '../../i18n/strings.js';
import { conflictFor, targetExists } from '../../calc/scenario.js';
import { starterSpec, fmtMoney, fmtDate, fmtPct } from './starters.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const NAME_COLLECTIONS = ['plan', 'allocation', 'bucketGoals', 'liabilities', 'assets', 'incomeSources'];

/** The real row a change points at, or null. */
export function targetRow(data, change) {
    const tg = isObj(change) ? change.target : null;
    if (!isObj(tg) || tg.id == null || !NAME_COLLECTIONS.includes(tg.collection) || !isObj(data)) return null;
    const list = data[tg.collection];
    return Array.isArray(list) ? (list.find((r) => isObj(r) && r.id === tg.id) || null) : null;
}

export function targetName(data, change) {
    const row = targetRow(data, change);
    return row && typeof row.name === 'string' && row.name.trim() ? row.name.trim() : t('a.plan.list.unnamed');
}

const KIND_LABEL = {
    income: 'f.wi.kind.pay', incomeAdd: 'f.wi.kind.income', expense: 'f.wi.kind.expense', split: 'f.wi.kind.split',
    goal: 'f.wi.kind.goal', goalFund: 'f.wi.kind.fund', debtAdd: 'f.wi.kind.loan', oneOff: 'f.wi.kind.oneOff', assumption: 'f.wi.kind.assumption',
};

const FIELD_FMT = { grossAnnual: fmtMoney, amount: fmtMoney, cost: fmtMoney, balance: fmtMoney, percentage: (n) => `${round2(n)}%` };
const fmtValue = (field, v) => {
    if (typeof v === 'number') return (FIELD_FMT[field] || String)(v);
    return v == null ? '' : String(v);
};

/** What the change does, in one plain line (no markup). */
function whatText(data, c, missing) {
    const name = missing ? t('f.scenario.noLongerInPlan') : (c.target && c.target.id != null ? targetName(data, c) : '');
    const live = missing ? null : (targetRow(data, c) || {})[c.field];
    const was = c.baseValue != null ? c.baseValue : live;
    if (c.op === 'remove') return t('f.wi.what.remove', { name });
    switch (c.kind) {
        case 'income':
            if (c.op === 'scale') return t('f.wi.what.payScale', { name, pct: fmtPct((c.value - 1) * 100) });
            return t('f.wi.what.paySet', { name, from: was == null ? '' : `${fmtMoney(was)} → `, to: fmtMoney(c.value) });
        case 'expense':
            if (c.op === 'scale') return t('f.wi.what.scale', { name, pct: fmtPct((c.value - 1) * 100) });
            return t('f.wi.what.set', { name, from: was == null ? '' : `${fmtMoney(was)} → `, to: fmtValue(c.field, c.value) });
        case 'split':
            return t('f.wi.what.splitOne', { name, from: was == null ? '' : `${round2(was)}% → `, to: `${round2(c.value)}%` });
        case 'goal':
            if (c.op === 'add' && isObj(c.value)) return t('f.wi.what.goalAdd', { name: c.value.name || '', cost: fmtMoney(c.value.cost), due: fmtDate(c.value.due) || t('f.wi.noDate') });
            return t('f.wi.what.set', { name, from: was == null ? '' : `${fmtValue(c.field, was)} → `, to: fmtValue(c.field, c.value) });
        case 'incomeAdd':
            return t('f.wi.what.incomeAdd', { name: isObj(c.value) ? c.value.name || '' : '', gross: fmtMoney(isObj(c.value) ? c.value.grossAnnual : 0) });
        case 'debtAdd':
            return t('f.wi.what.loanAdd', { name: isObj(c.value) ? c.value.name || '' : '', balance: fmtMoney(isObj(c.value) ? c.value.balance : 0), rate: isObj(c.value) ? round2(Number(c.value.interestRate) || 0) : 0 });
        case 'oneOff': {
            const amt = isObj(c.value) ? c.value.amount : c.value;
            return t('f.wi.what.oneOff', { amount: fmtMoney(amt) });
        }
        case 'goalFund':
            return t('f.wi.what.fund', { name });
        default:
            return t('f.wi.what.set', { name: c.field || '', from: '', to: fmtValue(c.field, c.value) });
    }
}

/**
 * Everything a row needs, as plain strings and flags.
 * @returns {{kindLabel:string, what:string, from:string, until:string, note:string, missing:boolean,
 *            conflict:null|{message:string, live:*, scenario:*}}}
 */
export function describeChange(data, change) {
    const c = isObj(change) ? change : {};
    const missing = !targetExists(data, c);
    const cf = missing ? { conflict: false } : conflictFor(data, c);
    let conflict = null;
    if (cf.conflict) {
        conflict = {
            live: cf.live, scenario: cf.scenario,
            message: t('f.scenario.conflict', { name: targetName(data, c), live: fmtValue(c.field, cf.live), scenario: fmtValue(c.field, cf.scenario) }),
        };
    }
    return {
        kindLabel: t(KIND_LABEL[c.kind] || 'f.wi.kind.other'),
        what: whatText(data, c, missing),
        from: c.from ? fmtDate(c.from) : t('f.wi.now'),
        until: c.until ? fmtDate(c.until) : t('f.wi.noEnd'),
        note: typeof c.note === 'string' ? c.note : '',
        missing, conflict,
    };
}

/** Resolve a conflict row. Keep: the scenario's value stays, the recorded real value moves to today's. Update: take today's. */
export function resolveConflict(data, change, how) {
    const cf = conflictFor(data, change);
    if (!cf.conflict) return change;
    if (how === 'update') return { ...change, value: cf.live, baseValue: cf.live };
    return { ...change, baseValue: cf.live };
}

/** The split changes edited together with `change` (same start and end), or just the change. */
export function groupOf(changes, change) {
    if (change.kind !== 'split') return [change];
    return changes.filter((c) => c.kind === 'split' && c.from === change.from && c.until === change.until);
}

function genericSpec(change) {
    return {
        title: t('f.wi.edit.title'),
        fields: [
            { key: 'from', label: t('f.wi.f.from'), type: 'date', hint: t('f.wi.f.from.hint') },
            { key: 'until', label: t('f.wi.f.until'), type: 'date', hint: t('f.wi.f.until.hint') },
            { key: 'note', label: t('f.wi.f.note'), type: 'text' },
        ],
        values: { from: change.from, until: change.until, note: change.note || '' },
        validate(v) {
            const e = {};
            if (v.from && v.until && v.until <= v.from) e.until = t('f.wi.err.until');
            return e;
        },
        build: (v) => [{ ...change, from: v.from || null, until: v.until || null, note: String(v.note || '') }],
    };
}

/**
 * The sheet that edits a change: the starter's own sheet when the change came from one, else dates and note.
 * `replaces` lists the change ids the built changes take the place of (a split's whole group).
 */
export function editSpecFor(data, change, changes, ctx = {}) {
    const base = { ...ctx, changes };
    let spec = null;
    let group = [change];
    const tg = change.target;
    const targeted = isObj(tg) && tg.id != null;
    if (change.kind === 'income' && targeted && change.field === 'grossAnnual' && (change.op === 'set' || change.op === 'scale')) spec = starterSpec('pay', data, { ...base, existing: change });
    else if (change.kind === 'expense' && targeted && change.field === 'amount' && (change.op === 'set' || change.op === 'scale')) spec = starterSpec('expense', data, { ...base, existing: change });
    else if (change.kind === 'goal' && change.op === 'add' && isObj(tg) && tg.id == null && isObj(change.value)) spec = starterSpec('goal', data, { ...base, existing: change });
    else if (change.kind === 'incomeAdd' && change.op === 'add' && isObj(change.value)) spec = starterSpec('extra', data, { ...base, existing: change });
    else if (change.kind === 'debtAdd' && change.op === 'add' && isObj(change.value)) spec = starterSpec('loan', data, { ...base, existing: change });
    else if (change.kind === 'split' && targeted && change.field === 'percentage' && change.op === 'set') {
        group = groupOf(changes, change);
        spec = starterSpec('split', data, { ...base, existing: group });
    }
    if (!spec) spec = genericSpec(change);
    return { ...spec, replaces: group.map((c) => c.id) };
}

// ---------- the DOM ----------

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

/**
 * Fill `container` with the change rows. Every string goes in as text. Buttons carry data-act and
 * data-id; the screen listens on its root. Returns the number of rows.
 */
export function renderChangeList(container, data, changes) {
    container.textContent = '';
    const done = new Set();
    let rows = 0;
    changes.forEach((c) => {
        if (done.has(c.id)) return;
        const group = groupOf(changes, c);
        group.forEach((g) => done.add(g.id));
        const d = describeChange(data, c);
        const li = el('li', 'wi-change' + (d.missing ? ' is-gone' : ''));
        li.dataset.id = c.id;
        li.appendChild(el('span', 'wi-kind', d.kindLabel));
        const what = el('div', 'wi-what');
        if (group.length > 1) {
            what.appendChild(el('b', '', t('f.wi.what.splitMany', { count: group.length })));
            for (const g of group) what.appendChild(el('span', '', describeChange(data, g).what));
        } else {
            what.appendChild(el('b', '', d.what));
            if (d.note) what.appendChild(el('span', '', d.note));
        }
        if (d.missing) what.appendChild(el('span', 'wi-gone', t('f.scenario.noLongerInPlan')));
        li.appendChild(what);
        const when = el('div', 'wi-when');
        when.append(el('span', 'k', t('f.wi.from')), document.createTextNode(` ${d.from} `), el('span', 'k', t('f.wi.until')), document.createTextNode(` ${d.until}`));
        li.appendChild(when);
        const act = el('div', 'wi-act');
        if (!d.missing) {
            const edit = el('button', 'btn sm', t('f.wi.edit'));
            edit.type = 'button'; edit.dataset.act = 'edit'; edit.dataset.id = c.id;
            act.appendChild(edit);
        }
        const rm = el('button', 'btn sm', t('f.wi.remove'));
        rm.type = 'button'; rm.dataset.act = 'remove'; rm.dataset.id = c.id;
        rm.setAttribute('aria-label', t('f.wi.remove.label', { what: d.what }));
        act.appendChild(rm);
        li.appendChild(act);
        if (d.conflict) {
            const row = el('div', 'wi-conflict');
            row.setAttribute('role', 'group');
            row.appendChild(el('span', '', d.conflict.message));
            for (const how of ['keep', 'update']) {
                const b = el('button', 'btn sm', t(`f.scenario.${how}`));
                b.type = 'button'; b.dataset.act = how; b.dataset.id = c.id;
                row.appendChild(b);
            }
            li.appendChild(row);
        }
        container.appendChild(li);
        rows++;
    });
    return rows;
}
