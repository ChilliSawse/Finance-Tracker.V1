// What If, the bottom of the Answer (owner: F8b, FT-R-43, FT-R-89). The figures behind "What changes" (result cards,
// before to after), "Show all numbers" and the Compare view, one model for all three.
//
// Every figure here comes from F1 (`resolveAt` over the real data), F3 (`fiSummary`, `savingsRatePlanned`), F4
// (`planGoalsFromData`) and the bucket split (`getBuckets`, `netPerPayCents`) those engines already use. This file types
// no amount and no date: words come from the catalogue (`f.res.*`) and amounts from the calculators. All text is set
// with textContent, never markup.
//
// The model is pure (no DOM); `renderAnswerBottom` and the view registration at the bottom need a document.

import '../../i18n/en-lazy-results.js'; // results strings (en-lazy)
import './results.css'; // F8b — What If results, Compare, Make this real
import { t } from '../../i18n/strings.js';
import { resolveAt } from '../../calc/scenario.js';
import { fiSummary, savingsPlanned } from '../../calc/fi.js';
import { showCheckCard } from '../check-card-link.js';
import { planGoalsFromData } from '../../calc/goal-planner.js';
import { getBuckets } from '../../state/saving-model.js';
import { netPerPayCents } from '../../calc/plan.js';
import { fmtMoney, fmtDate } from './starters.js';
import { openExplain } from './explain.js';
import { renderMakeRealBar, renderMakeRealButton } from './make-real.js';
import { getAnswer } from './answer-top.js';

export const PRESETS = ['everyday', 'goals', 'safety', 'debt', 'decision', 'longRange'];
export const DEFAULT_PRESET = 'decision';
export const NET_WORTH_YEARS = [1, 5, 10, 20];
const ROLES = ['daily', 'splurge', 'smile', 'fire', 'mojo', 'grow'];

// Which rows each preset shows (the six lenses of 03d section 8; no add, remove or reorder). `goal:*` is every goal row.
export const PRESET_ROWS = {
    everyday: ['takeHome', 'daily', 'splurge', 'smile', 'fire', 'savingsRate', 'goal:*'],
    goals: ['goal:*', 'smile', 'required', 'short', 'earnGap'],
    safety: ['daily', 'mojo', 'mojoBalance', 'takeHome'],
    debt: ['debts', 'help', 'takeHome'],
    decision: ['takeHome', 'savingsRate', 'goal:*', 'fiYears', 'earnGap'],
    longRange: ['savingsRate', 'nw1', 'nw5', 'nw10', 'nw20', 'fiYears', 'fiNumber'],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const toCents = (dollars) => Math.round(num(dollars) * 100);
const round1 = (n) => Math.round(n * 10) / 10;

function safe(fn, fallback, what) {
    try { return fn(); } catch (err) { console.warn(`scenario results: ${what} could not be worked out`, err); return fallback; }
}

/** The date the scenario is read at: the last start date among its changes, or today when none starts later. */
export function scenarioDate(changes, today) {
    let date = today;
    for (const c of Array.isArray(changes) ? changes : []) if (isObj(c) && typeof c.from === 'string' && c.from > date) date = c.from;
    return date;
}

/** Everything one side (Now, or the scenario) shows, worked out from the engines. */
export function sideFigures(data, changes, today, date) {
    const list = Array.isArray(changes) ? changes : [];
    const resolved = resolveAt(data, list, date);
    const buckets = safe(() => getBuckets(resolved, today), [], 'the split').filter((b) => !b.parentId);
    const byRole = {};
    for (const role of ROLES) {
        const rows = buckets.filter((b) => b.role === role);
        byRole[role] = rows.length ? { perPay: rows.reduce((s, b) => s + b.perPayCents, 0), balance: rows.reduce((s, b) => s + b.balanceCents, 0), name: rows[0].name, pct: rows[0].pct } : null;
    }
    const net = safe(() => netPerPayCents(resolved), 0, 'take-home');
    const plan = safe(() => planGoalsFromData(data, { today, date, changes: list }), null, 'the goal plan');
    const summary = safe(() => fiSummary(data, { today, changes: list }), null, 'the FI figures');
    const debts = (Array.isArray(resolved.liabilities) ? resolved.liabilities : []).reduce((s, l) => s + (isObj(l) ? Math.max(0, toCents(l.balance)) : 0), 0);
    const side = {
        resolved, buckets, byRole, net, plan, summary, debts, date,
        savings: safe(() => savingsPlanned(resolved, { today }), null, 'the savings rate'),
        savingsRate: null, // set just below from `savings`
        goals: goalMap(resolved, plan),
    };
    side.savingsRate = side.savings ? side.savings.ratePct : null;
    return side;
}

function goalMap(resolved, plan) {
    const out = new Map();
    if (!plan) return out;
    const cost = new Map((Array.isArray(resolved.bucketGoals) ? resolved.bucketGoals : []).filter(isObj).map((g) => [String(g.id), g]));
    for (const row of plan.perGoal || []) {
        const g = cost.get(String(row.id)) || {};
        out.set(String(row.id), { id: String(row.id), name: row.name || g.name || '', due: row.due, costCents: toCents(g.cost), needPerPay: row.perPayCents, impossible: !!row.impossible });
    }
    return out;
}

// ---------- rows ----------

const val = (v, text) => ({ v, text });

function formatMoney(c) { return fmtMoney(c / 100); }

function yearsText(y) {
    if (y === Infinity) return t('f.res.never');
    if (y == null) return '';
    if (y <= 0) return t('f.res.reached');
    return t('f.res.years', { n: round1(y) });
}

function moneyVal(c, zeroText) {
    if (c == null) return val(null, '');
    return val(c, c === 0 && zeroText ? t(zeroText) : formatMoney(c));
}

const bucketName = (set, role) => (set.scen.byRole[role] || set.now.byRole[role] || {}).name || t(`f.res.role.${role}`);

function goalValue(g, smilePerPay) {
    if (!g) return val(null, t('f.res.goal.absent'));
    if (g.impossible) return val(Infinity, t('f.res.goal.noPay', { date: fmtDate(g.due) }));
    const short = Math.max(0, g.needPerPay - smilePerPay);
    return val(short, short === 0 ? t('f.res.goal.onTime') : t('f.res.goal.short', { amount: formatMoney(short) }));
}

/**
 * The model behind the cards, the table and the Compare view.
 * @returns {{today, date, now, scen, rows:Array<{id,group,kind,label,better,role,now:{v,text},scen:{v,text},goalId?}>, cards:Array}}
 */
export function buildResultSet(data, changes, today, answer = null) {
    const date = scenarioDate(changes, today);
    const now = sideFigures(data, [], today, today);
    const scen = sideFigures(data, changes, today, date);
    const set = { today, date, now, scen, rows: [], cards: [] };
    const add = (id, group, kind, label, better, a, b, extra = {}) => {
        if (a.v == null && b.v == null && kind !== 'goal') return;
        set.rows.push({ id, group, kind, label, better, role: null, now: a, scen: b, ...extra });
    };
    const money = (side, get, zeroText) => moneyVal(get(side), zeroText);
    const both = (get, zeroText) => [money(now, get, zeroText), money(scen, get, zeroText)];

    add('takeHome', 'pay', 'money', t('f.res.row.takeHome'), 'high', ...both((s) => s.net));
    for (const role of ROLES) {
        const get = (s) => (s.byRole[role] ? s.byRole[role].perPay : null);
        if (role === 'mojo') continue;
        add(role, 'pay', 'money', t('f.res.row.perPay', { name: bucketName(set, role) }), null, ...both(get), { role });
    }
    add('savingsRate', 'long', 'pct', t('f.res.row.savingsRate'), 'high', ...[now, scen].map((s) => (s.savingsRate == null ? val(null, '') : val(s.savingsRate, t('f.res.rateAmount', { n: round1(s.savingsRate), amount: formatMoney(s.savings.perPayCents) })))), { amount: { now: now.savings ? now.savings.perPayCents : null, scen: scen.savings ? scen.savings.perPayCents : null } });

    // goals (F4): a row per goal, whichever side has it
    const ids = [...new Set([...now.goals.keys(), ...scen.goals.keys()])];
    const smileNow = now.plan ? now.plan.smilePerPayCents : 0;
    const smileScen = scen.plan ? scen.plan.smilePerPayCents : 0;
    for (const id of ids) {
        const gn = now.goals.get(id);
        const gs = scen.goals.get(id);
        const g = gs || gn;
        const label = t('f.res.goal.label', { name: g.name || t('f.res.goal.unnamed'), cost: formatMoney(g.costCents) });
        add(`goal:${id}`, 'goals', 'goal', label, 'low', goalValue(gn, smileNow), goalValue(gs, smileScen), { goalId: id, role: 'smile', due: g.due });
    }
    const planned = (s) => s.plan && s.plan.perGoal.length > 0;
    const planRow = (id, label, get, zero) => add(id, 'goals', 'money', label, 'low', ...[now, scen].map((s) => (planned(s) ? moneyVal(get(s.plan), zero) : val(null, ''))));
    planRow('required', t('f.res.row.required'), (p) => p.requiredPerPayCents);
    planRow('short', t('f.res.row.short'), (p) => p.gapCents, 'f.res.none');
    planRow('earnGap', t('f.res.row.earnGap'), (p) => p.options.earn.earnedCents, 'f.res.none');

    // safety
    add('mojo', 'safety', 'money', t('f.res.row.perPay', { name: bucketName(set, 'mojo') }), null, ...both((s) => (s.byRole.mojo ? s.byRole.mojo.perPay : null)), { role: 'mojo' });
    add('mojoBalance', 'safety', 'money', t('f.res.row.balance', { name: bucketName(set, 'mojo') }), 'high', ...both((s) => (s.byRole.mojo ? s.byRole.mojo.balance : null)), { role: 'mojo' });

    // debt
    add('debts', 'debt', 'money', t('f.res.row.debts'), 'low', ...both((s) => s.debts));
    add('help', 'debt', 'money', t('f.res.row.help'), 'low', ...both((s) => (s.summary ? toCents(s.summary.now.help) : null)));

    // long range (F3)
    for (const y of NET_WORTH_YEARS) {
        add(`nw${y}`, 'long', 'money', t('f.res.row.netWorth', { n: y }), 'high', ...both((s) => {
            const p = s.summary && s.summary.path ? s.summary.path[y] : null;
            return p ? toCents(p.netWorth) : null;
        }));
    }
    add('fiYears', 'long', 'years', t('f.res.row.fiYears'), 'low', ...[now, scen].map((s) => (s.summary ? val(s.summary.yearsToFI, yearsText(s.summary.yearsToFI)) : val(null, ''))));
    add('fiNumber', 'long', 'money', t('f.res.row.fiNumber'), null, ...both((s) => (s.summary ? toCents(s.summary.fiNumber) : null)));

    if (answer) applyAnswer(set, answer);
    set.cards = buildCards(set);
    return set;
}

/**
 * The option picked in F8a's top half (read from `getAnswer`, not recomputed): Splurge drops to what the planner
 * left it, Smile reaches what the goals need, and take-home rises by the extra earnings. All cents come from F4's plan.
 */
function applyAnswer(set, answer) {
    const { option, plan } = answer;
    if (!isObj(option) || !isObj(plan)) return;
    const row = (id) => set.rows.find((r) => r.id === id);
    const put = (r, c) => { if (r && r.scen.v != null) r.scen = moneyVal(c); };
    if (plan.gapCents > 0) {
        put(row('splurge'), option.splurgeLeftCents);
        put(row('smile'), plan.requiredPerPayCents);
        const take = row('takeHome');
        if (take && option.earnedCents > 0) take.scen = moneyVal(take.scen.v + option.earnedCents);
        // Smile now gets what the goals need, so each goal that can be paid in time is on time, and nothing is short (Q1)
        for (const r of set.rows) {
            if (r.kind === 'goal' && r.scen.v != null && r.scen.v !== Infinity) r.scen = val(0, t('f.res.goal.onTime'));
        }
        const short = row('short');
        if (short && short.scen.v != null) short.scen = moneyVal(0, 'f.res.none');
        const earnGap = row('earnGap');
        if (earnGap && earnGap.scen.v != null) earnGap.scen = moneyVal(option.earnedCents, 'f.res.none');
    }
}

const CARD_ORDER = ['smile', 'splurge', 'takeHome', 'savingsRate', 'daily', 'fire', 'fiYears'];

function buildCards(set) {
    const byId = new Map(set.rows.map((r) => [r.id, r]));
    const ids = [...set.rows.filter((r) => r.kind === 'goal').map((r) => r.id), ...CARD_ORDER].filter((id) => byId.has(id));
    return ids.map((id) => {
        const row = byId.get(id);
        return { id, row, tint: row.role && ['daily', 'splurge', 'smile', 'fire'].includes(row.role) ? row.role : null, wide: id === 'smile' };
    });
}

/** The rows a preset shows, in the preset's order. */
export function rowsForPreset(set, preset) {
    const names = PRESET_ROWS[preset] || PRESET_ROWS[DEFAULT_PRESET];
    const out = [];
    for (const n of names) {
        if (n === 'goal:*') out.push(...set.rows.filter((r) => r.kind === 'goal'));
        else { const r = set.rows.find((x) => x.id === n); if (r) out.push(r); }
    }
    return out;
}

// ---------- differences and "Best" ----------

/** {dir:'up'|'down'|'same'|'none', tone:'ok'|'warn'|'neutral'|'scen', text} for one row. */
export function diffOf(row) {
    const a = row.now.v;
    const b = row.scen.v;
    const none = { dir: 'none', tone: 'neutral', text: '' };
    if (row.kind === 'goal') return goalDiff(row);
    if (a == null || b == null) return none;
    if (row.id === 'savingsRate' && row.amount && row.amount.now != null && row.amount.scen != null) return savingsDiff(row);
    if (a === b) return { dir: 'same', tone: 'neutral', text: t('f.res.diff.same') };
    const up = b > a;
    const better = row.better ? ((row.better === 'high') === up) : null;
    const tone = better === null ? 'scen' : (better ? 'ok' : 'warn');
    let text;
    if (row.kind === 'money') text = t(up ? 'f.res.diff.more' : 'f.res.diff.less', { amount: formatMoney(Math.abs(b - a)) });
    else if (row.kind === 'pct') text = t(up ? 'f.res.diff.pointsUp' : 'f.res.diff.pointsDown', { n: round1(Math.abs(b - a)) });
    else if (b === Infinity) text = t('f.res.diff.neverNow');
    else if (a === Infinity) text = t('f.res.diff.reachesNow');
    else text = t(up ? 'f.res.diff.later' : 'f.res.diff.sooner', { n: round1(Math.abs(b - a)) });
    return { dir: up ? 'up' : 'down', tone, text };
}

/** The savings rate with its amount (FT-R-116): the points and the dollars a pay, so a pay change shows as the same rate and more money. */
function savingsDiff(row) {
    const a = row.now.v;
    const b = row.scen.v;
    const da = row.amount.scen - row.amount.now;
    if (a === b && da === 0) return { dir: 'same', tone: 'neutral', text: t('f.res.diff.same') };
    const up = (a === b ? da : b - a) > 0;
    const tone = up ? 'ok' : 'warn';
    const amount = formatMoney(Math.abs(da));
    let text;
    if (da === 0) text = t(up ? 'f.res.diff.pointsUp' : 'f.res.diff.pointsDown', { n: round1(Math.abs(b - a)) });
    else if (a === b) text = t(da > 0 ? 'f.res.diff.sameRateMore' : 'f.res.diff.sameRateLess', { amount });
    else text = t(da > 0 ? 'f.res.diff.rateAndMore' : 'f.res.diff.rateAndLess', { rate: t(up ? 'f.res.diff.pointsUp' : 'f.res.diff.pointsDown', { n: round1(Math.abs(b - a)) }), amount });
    return { dir: up ? 'up' : 'down', tone, text };
}

function goalDiff(row) {
    const a = row.now.v;
    const b = row.scen.v;
    if (a == null && b == null) return { dir: 'none', tone: 'neutral', text: '' };
    if (a == null) return { dir: 'up', tone: 'scen', text: t('f.res.diff.newGoal') };
    if (b == null) return { dir: 'down', tone: 'scen', text: t('f.res.diff.goneGoal') };
    if (a === b) return { dir: 'same', tone: 'neutral', text: t('f.res.diff.same') };
    if (b === 0) return { dir: 'down', tone: 'ok', text: t('f.res.diff.nowOnTime') };
    if (b === Infinity) return { dir: 'up', tone: 'warn', text: t('f.res.diff.nowNoPay') };
    if (a === 0 || a === Infinity) return { dir: 'up', tone: 'warn', text: t('f.res.diff.nowShort', { amount: formatMoney(b) }) };
    const up = b > a;
    return { dir: up ? 'up' : 'down', tone: up ? 'warn' : 'ok', text: t(up ? 'f.res.diff.moreShort' : 'f.res.diff.lessShort', { amount: formatMoney(Math.abs(b - a)) }) };
}

/** Which column leads a row: 'now', 'scen' or null (a tie, or a row with no better direction). */
export function bestOf(row) {
    if (!row.better) return null;
    const a = row.now.v;
    const b = row.scen.v;
    if (row.id === 'savingsRate' && a === b && row.amount && row.amount.now != null && row.amount.scen != null && row.amount.now !== row.amount.scen) return row.amount.scen > row.amount.now ? 'scen' : 'now';
    if (a == null || b == null || a === b) return null;
    const low = row.better === 'low';
    return (b < a) === low ? 'scen' : 'now';
}

// ---------- the view ----------

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

function explainBtn(rowId, label) {
    const b = el('button', 'link res-explain', t('f.res.explain'));
    b.type = 'button';
    b.dataset.resAct = 'explain';
    b.dataset.row = rowId;
    b.setAttribute('aria-label', t('f.res.explainFor', { name: label }));
    return b;
}

function cardEl(card) {
    const { row } = card;
    const li = el('li', `wc-card${card.tint ? ` c-${card.tint}` : ''}${card.wide ? ' wide' : ''}`);
    li.dataset.row = row.id;
    const title = el('span', 'wc-t');
    if (card.tint && card.id !== 'goal') title.appendChild(el('span', `bk b-${card.tint}`, row.label));
    else title.textContent = row.label;
    const v = el('span', 'wc-v');
    v.append(document.createTextNode(`${row.now.text || t('f.res.dash')} `), el('span', 'arr', '→'), document.createTextNode(' '), el('b', '', row.scen.text || t('f.res.dash')));
    v.querySelector('.arr').setAttribute('aria-label', t('f.res.becomes'));
    const d = diffOf(row);
    li.append(title, v);
    if (d.text) li.appendChild(el('span', `chip-s ${d.tone}`, d.text));
    li.appendChild(explainBtn(row.id, row.label));
    return li;
}

/** "N items worth $X aren't counted toward FI until you confirm", opening the Check card; null when nothing is held out. */
export function heldOutText(set) {
    const s = set.now && set.now.summary;
    const n = s && s.heldOut ? s.heldOut.count : 0;
    return n > 0 ? t(n === 1 ? 'f.res.heldOut.one' : 'f.res.heldOut', { count: n, amount: formatMoney(toCents(s.heldOutValue)) }) : null;
}

export function heldOutLineEl(set) {
    const text = heldOutText(set);
    if (text === null) return null;
    const p = el('p', 'fine res-held');
    const b = el('button', 'link', text);
    b.type = 'button';
    b.dataset.resAct = 'check';
    p.appendChild(b);
    return p;
}

function tableEl(set) {
    const det = el('details', 'all-nums card');
    const sum = el('summary');
    sum.append(el('b', '', t('f.res.showAll')), el('span', 'muted', t('f.res.showAllSub')));
    det.appendChild(sum);
    const table = el('table', 'wi-table res');
    const head = el('tr');
    for (const k of ['output', 'now', 'scenario', 'difference']) {
        const th = el('th', '', t(`f.res.col.${k}`));
        th.scope = 'col';
        head.appendChild(th);
    }
    const thead = el('thead');
    thead.appendChild(head);
    const body = el('tbody');
    for (const row of set.rows) {
        const tr = el('tr');
        const th = el('th');
        th.scope = 'row';
        th.append(el('span', 'res-lab', row.label), explainBtn(row.id, row.label));
        const d = diffOf(row);
        const cell = (lab, text) => { const td = el('td', 'money', text); td.dataset.l = lab; return td; };
        tr.append(th, cell(t('f.res.col.now'), row.now.text || t('f.res.dash')), cell(t('f.res.col.scenario'), row.scen.text || t('f.res.dash')), cell(t('f.res.col.difference'), d.dir === 'none' ? t('f.res.dash') : `${d.dir === 'up' ? '▲ ' : d.dir === 'down' ? '▼ ' : ''}${d.text}`));
        body.appendChild(tr);
    }
    table.append(thead, body);
    det.append(table, el('p', 'fine', t('f.res.nowNote')));
    return det;
}

let current = null; // the bottom half on screen, redrawn when F8a's option changes
if (typeof document !== 'undefined') {
    document.addEventListener('ft:answer-change', (e) => {
        if (current && current.container.isConnected && e.detail && current.ctx.scenario.id === e.detail.scenarioId) renderAnswerBottom(current.container, current.ctx);
    });
}

/** The part of the Answer under F8a's top: What changes, Show all numbers, and the Make this real bar. */
export function renderAnswerBottom(container, ctx) {
    container.textContent = '';
    const { scenario, data, today } = ctx;
    if (!scenario || !scenario.changes.length) {
        container.appendChild(el('p', 'muted', t('f.res.empty')));
        return;
    }
    const answer = getAnswer(scenario.id);
    const set = buildResultSet(data, scenario.changes, today, answer);
    current = { container, ctx };
    const sec = el('section', 'res-sec');
    sec.setAttribute('aria-labelledby', 'res-wc-h');
    const head = el('div', 'sec-head');
    const h = el('h3', '', t('f.res.whatChanges'));
    h.id = 'res-wc-h';
    head.append(h, el('span', 'muted', t('f.res.whatChangesSub')));
    const ul = el('ul', 'wc');
    for (const card of set.cards) ul.appendChild(cardEl(card));
    sec.append(head, ul);
    const held = heldOutLineEl(set);
    if (held) sec.appendChild(held);
    sec.appendChild(tableEl(set));
    container.append(sec);
    renderMakeRealBar(container, ctx);
    // one listener for the container's life: the bottom half is redrawn on every option change, and a listener added
    // per draw would open one Explain sheet per earlier draw (Q1)
    container._explain = { set, data };
    if (!container._explainWired) {
        container._explainWired = true;
        container.addEventListener('click', (e) => {
            const c = e.target.closest('[data-res-act="check"]');
            if (c && container.contains(c)) { showCheckCard(); return; }
            const b = e.target.closest('[data-res-act="explain"]');
            if (!b || !container.contains(b)) return;
            openExplain(container._explain.set, b.dataset.row, container._explain.data);
        });
    }
}

export { renderMakeRealButton };

// ---------- registration ----------
// The registry lives in index.js, which needs a browser; this file's model does not, so register lazily.

if (typeof document !== 'undefined') {
    import('./index.js').then(async (m) => {
        const { renderCompare } = await import('./compare.js');
        m.registerScenarioView('answer', renderAnswerBottom, { order: 10 });
        m.registerScenarioView('compare', renderCompare);
        m.registerScenarioView('make-real', renderMakeRealButton);
    }).catch((err) => console.error('What If result views could not be registered', err));
}
