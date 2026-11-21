// What If, the Ask step (owner: F7, FT-R-94). The eight starters, in order, and for each one the
// sheet spec that turns a few answers into one or more dated changes. Pure: no DOM, no storage.
// The same builders re-open pre-filled when a change is edited (`ctx.existing`), so a change is
// always edited with the sheet that made it. Targets are ids, never positions.
//
// spec = { title, fields, values, validate(v)->{field:msg}, build(v)->change[] }   (openSheet takes the first four)

import { t } from '../../i18n/strings.js';
import { isIsoDate } from '../../calc/scenario.js';
import { newChangeId } from '../../state/scenarios.js';
import { newIncomeSourceRow, newDebt, applyDebtValues, debtSheetSpec } from '../plan-assets-debts.js';

/** The eight starters of FT-R-94, in order. Titles and one-line hints come from the catalogue. */
export const STARTERS = [
    { id: 'pay', titleKey: 'f.wi.starter.pay', hintKey: 'f.wi.starter.pay.hint' },
    { id: 'job', titleKey: 'f.wi.starter.job', hintKey: 'f.wi.starter.job.hint' },
    { id: 'extra', titleKey: 'f.wi.starter.extra', hintKey: 'f.wi.starter.extra.hint' },
    { id: 'expense', titleKey: 'f.wi.starter.expense', hintKey: 'f.wi.starter.expense.hint' },
    { id: 'goal', titleKey: 'f.wi.starter.goal', hintKey: 'f.wi.starter.goal.hint' },
    { id: 'goals', titleKey: 'f.wi.starter.goals', hintKey: 'f.wi.starter.goals.hint' },
    { id: 'loan', titleKey: 'f.wi.starter.loan', hintKey: 'f.wi.starter.loan.hint' },
    { id: 'split', titleKey: 'f.wi.starter.split', hintKey: 'f.wi.starter.split.hint' },
];

export const MAX_GOAL_SLOTS = 8;

// ---------- small shared helpers (change-list.js imports these) ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A$1,234 or A$1,234.56. */
export function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 'A$0';
    const whole = Math.abs(v - Math.round(v)) < 0.005;
    const s = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-A$' : 'A$') + s;
}

/** 14 Nov 2026, or '' for a missing or bad date. */
export function fmtDate(iso) {
    if (!isIsoDate(iso)) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A percentage written as +5% or -3.5%. */
export function fmtPct(pct) {
    const p = round2(pct);
    return `${p > 0 ? '+' : ''}${p}%`;
}

const rowsOf = (data, key) => (isObj(data) && Array.isArray(data[key]) ? data[key].filter((r) => isObj(r) && typeof r.id === 'string' && r.id) : []);
const nameOf = (row) => (row && typeof row.name === 'string' && row.name.trim() ? row.name.trim() : t('a.plan.list.unnamed'));
const blank = (v) => v === null || v === undefined || v === '';

/** The "from" and "until" dates and the note, shared by every starter. */
function whenFields({ noteRequired = false } = {}) {
    return [
        { key: 'from', label: t('f.wi.f.from'), type: 'date', hint: t('f.wi.f.from.hint') },
        { key: 'until', label: t('f.wi.f.until'), type: 'date', hint: t('f.wi.f.until.hint') },
        { key: 'note', label: t('f.wi.f.note'), type: 'text', required: noteRequired },
    ];
}

function whenErrors(v, errors = {}) {
    if (!blank(v.from) && !isIsoDate(v.from)) errors.from = t('f.wi.err.date');
    if (!blank(v.until) && !isIsoDate(v.until)) errors.until = t('f.wi.err.date');
    if (!errors.from && !errors.until && !blank(v.from) && !blank(v.until) && v.until <= v.from) errors.until = t('f.wi.err.until');
    return errors;
}

const whenValues = (ex) => ({ from: ex ? ex.from : null, until: ex ? ex.until : null, note: ex ? (ex.note || '') : '' });
const dateOrNull = (v) => (isIsoDate(v) ? v : null);

/** A maker of changes with ids that are unique among the scenario's changes and the ones made so far. */
function maker(ctx) {
    const made = [];
    return (ex, fields) => {
        const id = ex && ex.id ? ex.id : newChangeId([...(Array.isArray(ctx.changes) ? ctx.changes : []), ...made]);
        const c = {
            id, kind: 'expense', target: null, field: null, op: 'set', value: null, baseValue: null,
            from: null, until: null, note: '', ...fields,
        };
        made.push(c);
        return c;
    };
}

const exOf = (ctx) => (Array.isArray(ctx.existing) ? ctx.existing[0] : ctx.existing) || null;

// ---------- 1 and 2: pay changes and a new job (an income swap, no break-even) ----------

function payBuilder(job) {
    return (data, ctx) => {
        const ex = exOf(ctx);
        const sources = rowsOf(data, 'incomeSources');
        const make = maker(ctx);
        const fields = [
            { key: 'sourceId', label: job ? t('f.wi.job.replaces') : t('f.wi.pay.source'), type: 'select', required: true,
                options: sources.map((s) => ({ value: s.id, label: nameOf(s) })) },
            { key: 'newGross', label: job ? t('f.wi.job.newPay') : t('f.wi.pay.newGross'), type: 'money', required: job, hint: t('f.wi.pay.newGross.hint') },
        ];
        if (!job) fields.push({ key: 'pct', label: t('f.wi.pay.pct'), type: 'percent', hint: t('f.wi.pay.pct.hint') });
        fields.push(...whenFields({ noteRequired: job }));
        const values = { sourceId: ex && ex.target ? ex.target.id : (sources[0] ? sources[0].id : ''), newGross: null, pct: null, ...whenValues(ex) };
        if (ex && ex.op === 'set') values.newGross = ex.value;
        if (ex && ex.op === 'scale' && typeof ex.value === 'number') values.pct = round2((ex.value - 1) * 100);
        if (job && !values.note) values.note = '';
        return {
            title: t(ex ? 'f.wi.edit.title' : (job ? 'f.wi.starter.job' : 'f.wi.starter.pay')),
            fields, values,
            validate(v) {
                const e = whenErrors(v);
                if (!sources.some((s) => s.id === v.sourceId)) e.sourceId = t('f.wi.pay.noSource');
                const hasPay = !blank(v.newGross);
                const hasPct = !blank(v.pct);
                if (!job && !hasPay && !hasPct) e.newGross = t('f.wi.pay.one');
                if (!job && hasPay && hasPct) e.pct = t('f.wi.pay.one');
                if (hasPay && !(Number(v.newGross) >= 0)) e.newGross = t('f.wi.err.amount');
                if (hasPct && !(Number(v.pct) > -100)) e.pct = t('f.wi.err.pct');
                return e;
            },
            build(v) {
                const src = sources.find((s) => s.id === v.sourceId);
                const base = src ? num(src.grossAnnual) : 0;
                const set = !blank(v.newGross);
                return [make(ex, {
                    kind: 'income', target: { collection: 'incomeSources', id: v.sourceId }, field: 'grossAnnual',
                    op: set ? 'set' : 'scale', value: set ? Number(v.newGross) : round2(1 + Number(v.pct) / 100),
                    baseValue: set ? base : null, from: dateOrNull(v.from), until: dateOrNull(v.until), note: String(v.note || ''),
                })];
            },
        };
    };
}

// ---------- 3: extra income ----------

const SCHEDULES = ['weekly', 'fortnightly', 'monthly'];

function extraBuilder(data, ctx) {
    const ex = exOf(ctx);
    const make = maker(ctx);
    const row = ex && isObj(ex.value) ? ex.value : null;
    const fields = [
        { key: 'name', label: t('f.wi.extra.name'), type: 'text', required: true },
        { key: 'gross', label: t('f.wi.extra.gross'), type: 'money', required: true, hint: t('f.wi.pay.newGross.hint') },
        { key: 'schedule', label: t('f.wi.extra.schedule'), type: 'select', options: SCHEDULES.map((s) => ({ value: s, label: t(`f.wi.sched.${s}`) })) },
        ...whenFields(),
    ];
    const primary = rowsOf(data, 'incomeSources')[0];
    const values = {
        name: row ? row.name : '', gross: row ? row.grossAnnual : null,
        schedule: row ? row.paySchedule : (primary && SCHEDULES.includes(primary.paySchedule) ? primary.paySchedule : 'fortnightly'),
        ...whenValues(ex),
    };
    return {
        title: t(ex ? 'f.wi.edit.title' : 'f.wi.starter.extra'), fields, values,
        validate(v) {
            const e = whenErrors(v);
            if (!String(v.name || '').trim()) e.name = t('f.wi.err.name');
            if (!(Number(v.gross) >= 0)) e.gross = t('f.wi.err.amount');
            return e;
        },
        build(v) {
            const base = row ? { ...row } : newIncomeSourceRow([...rowsOf(data, 'incomeSources'), ...((ctx.changes || []).filter((c) => c.kind === 'incomeAdd' && isObj(c.value)).map((c) => c.value))], { name: String(v.name).trim() });
            base.name = String(v.name).trim();
            base.grossAnnual = Number(v.gross) || 0;
            base.paySchedule = SCHEDULES.includes(v.schedule) ? v.schedule : 'fortnightly';
            return [make(ex, {
                kind: 'incomeAdd', target: { collection: 'incomeSources', id: null }, field: null, op: 'add', value: base,
                from: dateOrNull(v.from), until: dateOrNull(v.until), note: String(v.note || ''),
            })];
        },
    };
}

// ---------- 4: my expenses change ----------

function expenseBuilder(data, ctx) {
    const ex = exOf(ctx);
    const make = maker(ctx);
    const plan = rowsOf(data, 'plan');
    const cats = isObj(data) && Array.isArray(data.categories) ? data.categories.filter((c) => isObj(c) && typeof c.id === 'string') : [];
    const options = [];
    if (ex && ex.target) {
        const row = plan.find((p) => p.id === ex.target.id);
        options.push({ value: `item:${ex.target.id}`, label: row ? nameOf(row) : t('f.scenario.noLongerInPlan') });
    } else {
        for (const p of plan) options.push({ value: `item:${p.id}`, label: `${nameOf(p)}: ${fmtMoney(p.amount)} ${p.frequency || ''}` });
        const used = new Set(plan.map((p) => p.categoryId));
        for (const c of cats) if (used.has(c.id)) options.push({ value: `cat:${c.id}`, label: t('f.wi.expense.group', { name: c.name || c.id }) });
    }
    const fields = [
        { key: 'target', label: t('f.wi.expense.target'), type: 'select', required: true, options },
        { key: 'newAmount', label: t('f.wi.expense.newAmount'), type: 'money', hint: t('f.wi.expense.newAmount.hint') },
        { key: 'pct', label: t('f.wi.expense.pct'), type: 'percent', hint: t('f.wi.expense.pct.hint') },
        ...whenFields(),
    ];
    const values = { target: ex && ex.target ? `item:${ex.target.id}` : (options[0] ? options[0].value : ''), newAmount: null, pct: null, ...whenValues(ex) };
    if (ex && ex.op === 'set') values.newAmount = ex.value;
    if (ex && ex.op === 'scale' && typeof ex.value === 'number') values.pct = round2((ex.value - 1) * 100);
    const itemsFor = (target) => {
        const s = String(target || '');
        if (s.startsWith('item:')) return plan.filter((p) => p.id === s.slice(5));
        if (s.startsWith('cat:')) return plan.filter((p) => p.categoryId === s.slice(4));
        return [];
    };
    return {
        title: t(ex ? 'f.wi.edit.title' : 'f.wi.starter.expense'), fields, values,
        validate(v) {
            const e = whenErrors(v);
            const items = itemsFor(v.target);
            if (!items.length && !(ex && ex.target)) e.target = t('f.wi.expense.none');
            const hasAmt = !blank(v.newAmount);
            const hasPct = !blank(v.pct);
            if (!hasAmt && !hasPct) e.newAmount = t('f.wi.pay.one');
            if (hasAmt && hasPct) e.pct = t('f.wi.pay.one');
            if (hasAmt && String(v.target).startsWith('cat:')) e.newAmount = t('f.wi.expense.groupPct');
            if (hasAmt && !(Number(v.newAmount) >= 0)) e.newAmount = t('f.wi.err.amount');
            if (hasPct && !(Number(v.pct) > -100)) e.pct = t('f.wi.err.pct');
            return e;
        },
        build(v) {
            const set = !blank(v.newAmount);
            const items = ex && ex.target ? [{ id: ex.target.id, amount: (plan.find((p) => p.id === ex.target.id) || {}).amount }] : itemsFor(v.target);
            return items.map((p, i) => make(i === 0 ? ex : null, {
                kind: 'expense', target: { collection: 'plan', id: p.id }, field: 'amount',
                op: set ? 'set' : 'scale', value: set ? Number(v.newAmount) : round2(1 + Number(v.pct) / 100),
                baseValue: set ? num(p.amount) : null, from: dateOrNull(v.from), until: dateOrNull(v.until), note: String(v.note || ''),
            }));
        },
    };
}

// ---------- 5 and 6: a new goal, and several goals by dates ----------

function bucketOptions(data) {
    return rowsOf(data, 'allocation').map((b) => ({ value: b.id, label: nameOf(b) }));
}
function defaultBucket(data) {
    const rows = rowsOf(data, 'allocation');
    const smile = rows.find((b) => b.role === 'smile');
    return smile ? smile.id : (rows[0] ? rows[0].id : '');
}
function goalValue(changeId, parentId, name, cost, due) {
    return { id: `sg-${changeId}`, parentId, name: String(name).trim(), cost: Number(cost) || 0, saved: 0, due: dateOrNull(due), share: 100, order: 0, done: false };
}

function goalBuilder(data, ctx) {
    const ex = exOf(ctx);
    const make = maker(ctx);
    const row = ex && isObj(ex.value) ? ex.value : null;
    const fields = [
        { key: 'bucketId', label: t('f.wi.goal.bucket'), type: 'select', required: true, options: bucketOptions(data), hint: t('f.wi.goal.bucket.hint') },
        { key: 'name', label: t('f.wi.goal.name'), type: 'text', required: true },
        { key: 'cost', label: t('f.wi.goal.cost'), type: 'money', required: true },
        { key: 'due', label: t('f.wi.goal.due'), type: 'date', required: true },
        { key: 'note', label: t('f.wi.f.note'), type: 'text' },
    ];
    const values = { bucketId: row ? row.parentId : defaultBucket(data), name: row ? row.name : '', cost: row ? row.cost : null, due: row ? row.due : null, note: ex ? (ex.note || '') : '' };
    return {
        title: t(ex ? 'f.wi.edit.title' : 'f.wi.starter.goal'), fields, values,
        validate(v) {
            const e = {};
            if (!bucketOptions(data).some((o) => o.value === v.bucketId)) e.bucketId = t('f.wi.goal.noBucket');
            if (!String(v.name || '').trim()) e.name = t('f.wi.err.name');
            if (!(Number(v.cost) > 0)) e.cost = t('f.wi.err.amount');
            if (!isIsoDate(v.due)) e.due = t('f.wi.err.date');
            return e;
        },
        build(v) {
            const c = make(ex, { kind: 'goal', target: { collection: 'bucketGoals', id: null }, op: 'add', note: String(v.note || '') });
            c.value = goalValue(c.id, v.bucketId, v.name, v.cost, v.due);
            if (row && row.id) c.value.id = row.id;
            return [c];
        },
    };
}

function goalsBuilder(data, ctx) {
    const make = maker(ctx);
    const fields = [{ key: 'bucketId', label: t('f.wi.goal.bucket'), type: 'select', required: true, options: bucketOptions(data), hint: t('f.wi.goals.hint') }];
    const values = { bucketId: defaultBucket(data) };
    for (let i = 1; i <= MAX_GOAL_SLOTS; i++) {
        fields.push(
            { key: `n${i}`, label: t('f.wi.goals.name', { n: i }), type: 'text' },
            { key: `c${i}`, label: t('f.wi.goals.cost', { n: i }), type: 'money' },
            { key: `d${i}`, label: t('f.wi.goals.due', { n: i }), type: 'date' },
        );
        values[`n${i}`] = ''; values[`c${i}`] = null; values[`d${i}`] = null;
    }
    const filled = (v) => {
        const out = [];
        for (let i = 1; i <= MAX_GOAL_SLOTS; i++) if (String(v[`n${i}`] || '').trim() || !blank(v[`c${i}`]) || !blank(v[`d${i}`])) out.push(i);
        return out;
    };
    return {
        title: t('f.wi.starter.goals'), fields, values,
        validate(v) {
            const e = {};
            if (!bucketOptions(data).some((o) => o.value === v.bucketId)) e.bucketId = t('f.wi.goal.noBucket');
            const slots = filled(v);
            if (slots.length < 2) e._form = t('f.wi.goals.min');
            for (const i of slots) {
                if (!String(v[`n${i}`] || '').trim()) e[`n${i}`] = t('f.wi.err.name');
                if (!(Number(v[`c${i}`]) > 0)) e[`c${i}`] = t('f.wi.err.amount');
                if (!isIsoDate(v[`d${i}`])) e[`d${i}`] = t('f.wi.err.date');
            }
            return e;
        },
        build(v) {
            return filled(v).map((i) => {
                const c = make(null, { kind: 'goal', target: { collection: 'bucketGoals', id: null }, op: 'add' });
                c.value = goalValue(c.id, v.bucketId, v[`n${i}`], v[`c${i}`], v[`d${i}`]);
                return c;
            });
        },
    };
}

// ---------- 7: a loan ----------

function loanBuilder(data, ctx) {
    const ex = exOf(ctx);
    const make = maker(ctx);
    const row = ex && isObj(ex.value) ? ex.value : null;
    // F5's own debt sheet fields (the fixed-rate fields are included; they are ignored for a variable loan).
    const spec = debtSheetSpec(row, { carry: { interestType: 'fixed' } });
    const values = { ...debtSheetSpec(row).values, ...whenValues(ex) };
    return {
        title: t(ex ? 'f.wi.edit.title' : 'f.wi.starter.loan'),
        fields: [...spec.fields, ...whenFields()], values,
        validate(v) {
            const e = whenErrors(v, spec.validate ? { ...spec.validate(v) } : {});
            return e;
        },
        build(v) {
            const list = [...rowsOf(data, 'liabilities'), ...((ctx.changes || []).filter((c) => c.kind === 'debtAdd' && isObj(c.value)).map((c) => c.value))];
            const base = row ? { ...row } : newDebt(list, { name: String(v.name || '').trim() || undefined });
            applyDebtValues(base, v);
            return [make(ex, {
                kind: 'debtAdd', target: { collection: 'liabilities', id: null }, field: null, op: 'add', value: base,
                from: dateOrNull(v.from), until: dateOrNull(v.until), note: String(v.note || ''),
            })];
        },
    };
}

// ---------- 8: change my split ----------

function splitBuilder(data, ctx) {
    const group = Array.isArray(ctx.existing) ? ctx.existing : (ctx.existing ? [ctx.existing] : []);
    const ex = group[0] || null;
    const make = maker(ctx);
    const buckets = rowsOf(data, 'allocation');
    const live = (b) => num(b.percentage);
    const key = (b) => `p_${b.id}`;
    const fields = buckets.map((b) => ({ key: key(b), label: nameOf(b), type: 'percent', required: true }));
    fields.push(...whenFields());
    const values = { ...whenValues(ex) };
    for (const b of buckets) {
        const c = group.find((g) => g.target && g.target.id === b.id);
        values[key(b)] = c && typeof c.value === 'number' ? c.value : live(b);
    }
    return {
        title: t(ex ? 'f.wi.edit.title' : 'f.wi.starter.split'), fields, values,
        validate(v) {
            const e = whenErrors(v);
            let total = 0;
            for (const b of buckets) {
                const x = Number(v[key(b)]);
                if (!(x >= 0 && x <= 100)) e[key(b)] = t('f.wi.err.pct');
                total += x || 0;
            }
            if (!Object.keys(e).length) {
                if (Math.abs(total - 100) > 0.05) e._form = t('f.wi.split.total', { total: round2(total) });
                else if (!buckets.some((b) => Math.abs(Number(v[key(b)]) - live(b)) > 1e-9)) e._form = t('f.wi.split.same');
            }
            return e;
        },
        build(v) {
            return buckets.filter((b) => Math.abs(Number(v[key(b)]) - live(b)) > 1e-9).map((b, i) => make(group[i] || null, {
                kind: 'split', target: { collection: 'allocation', id: b.id }, field: 'percentage', op: 'set',
                value: Number(v[key(b)]), baseValue: live(b), from: dateOrNull(v.from), until: dateOrNull(v.until), note: String(v.note || ''),
            }));
        },
    };
}

const BUILDERS = {
    pay: payBuilder(false), job: payBuilder(true), extra: extraBuilder, expense: expenseBuilder,
    goal: goalBuilder, goals: goalsBuilder, loan: loanBuilder, split: splitBuilder,
};

/**
 * The sheet spec for a starter. `ctx`: { today, changes (the scenario's, for unique ids), existing (a change,
 * or for split the group of split changes, when editing) }. Null for an unknown id.
 */
export function starterSpec(id, data, ctx = {}) {
    const b = BUILDERS[id];
    return b ? b(data, ctx) : null;
}

/** A starter's title for display. */
export function starterTitle(id) {
    const s = STARTERS.find((x) => x.id === id);
    return s ? t(s.titleKey) : '';
}
