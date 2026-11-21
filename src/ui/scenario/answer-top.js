// What If Answer, top half (F8a; 03d sections 6 and 11, FT-R-35, FT-R-43, FT-R-89).
// The verdict, three key figures, the goal landing timeline, the three option cards (Cut Splurge, Mix, Earn it)
// with the earnings shown three ways, Plan for this, Fine-tune and Counting towards goals.
//
// The top verdict is derived from the same `selectedOption` the cards use (the v2 build note): picking a card,
// moving the slider or ticking an item changes `selected`, and the verdict, key figures, timeline and Plan for
// this are all drawn from it. Daily and Fire extinguisher are never adjusted (the planner has no input for them).
//
// Every text is set as text, never markup. The bottom half (F8b) registers its own region; it can read the chosen
// option with `getAnswer(scenarioId)` or listen for the `ft:answer-change` event this view dispatches.

import './answer-top.css'; // F8a — What If Answer, top half
import { t } from '../../i18n/strings.js';
import {
    planGoalsFromData, earningsThreeWays, tickSplurgeItems, BIG_CUT_SHARE,
} from '../../calc/goal-planner.js';
import { netPerPayCents } from '../../calc/plan.js';
import { getBuckets } from '../../state/saving-model.js';
import { saveScenario, newChangeId } from '../../state/scenarios.js';
import { showToast } from '../toast.js';
import { registerScenarioView, openScenario } from './index.js';
import { landingDates, timelineModel, renderTimeline, dayLong, dayShort, daysApart } from './timeline.js';
import {
    goalsFromPlan, payDatesFor, pushDate, planScenario, renderPlanForThis, money,
} from './plan-for-this.js';

export const OPTION_IDS = ['cut', 'mix', 'earn'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- state (kept per scenario, so the shell can redraw without losing the choice) ----------

const states = new Map();
const answers = new Map();

export function defaultState() {
    return {
        optionId: 'mix', cutCents: null, manualTicks: null, fundTicks: new Set(), fineOpen: false, focus: null,
        pft: { split: true, pushGoal: null, dropGoal: null, oneSplit: { push: true, order: true, shrink: true, drop: true } },
    };
}

function stateFor(id) {
    if (!states.has(id)) states.set(id, defaultState());
    return states.get(id);
}

/** What F8b needs: the chosen option and the plan it came from (null before the view has drawn). */
export function getAnswer(scenarioId) {
    return answers.get(scenarioId) || null;
}

// ---------- the model (pure) ----------

/** The perPay wording for a pay schedule: 'a fortnight'. */
export function perWord(schedule) {
    const k = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].includes(schedule) ? schedule : 'other';
    return t(`f.wa.per.${k}`);
}

/** The option for a Splurge cut the slider chose: same shape as the planner's own options. */
export function customOption(plan, cutCents) {
    const rest = plan.gapAfterUnallocatedCents;
    const splurge = plan.splurgePerPayCents;
    const cut = Math.max(0, Math.min(Math.round(cutCents) || 0, rest, splurge));
    const earned = rest - cut;
    const adjustments = [];
    if (plan.unallocatedUsedCents > 0) adjustments.push({ kind: 'unallocated', cents: plan.unallocatedUsedCents });
    if (cut > 0) adjustments.push({ kind: 'splurge', cents: cut });
    if (earned > 0) adjustments.push({ kind: 'earnings', cents: earned });
    return {
        id: 'custom', cutCents: cut, splurgeLeftCents: splurge - cut, earnedCents: earned,
        cutPct: splurge > 0 ? Math.round((cut / splurge) * 1000) / 10 : 0, bigCut: cut > splurge * BIG_CUT_SHARE, adjustments,
    };
}

function tickChanges(fundTicks) {
    return [...fundTicks].map((k) => {
        const at = k.indexOf(':');
        return {
            id: `tick-${k}`, kind: 'goalFund', target: { collection: k.slice(0, at), id: k.slice(at + 1) }, field: null, op: 'add',
            value: true, baseValue: null, from: null, until: null, note: '',
        };
    });
}

/** Balances that could be ticked as counting towards goals (never Smile: it always counts; never Daily, Splurge or Fire). */
export function countingCandidates(plan, today) {
    const out = [];
    const skip = new Set(['smile', 'daily', 'splurge', 'fire']);
    for (const b of getBuckets(plan.resolved, today)) {
        if (b.parentId || skip.has(b.role) || !(b.balanceCents > 0)) continue;
        out.push({ key: `allocation:${b.id}`, label: b.name, cents: b.balanceCents, kind: b.role === 'mojo' ? 'mojo' : 'bucket' });
    }
    for (const a of Array.isArray(plan.resolved.assets) ? plan.resolved.assets : []) {
        if (!isObj(a) || typeof a.id !== 'string' || !a.id || !(Number(a.balance) > 0)) continue;
        out.push({ key: `assets:${a.id}`, label: a.name || a.id, cents: Math.round(Number(a.balance) * 100), kind: 'asset' });
    }
    return out;
}

function lateBy(days) {
    if (days < 14) return t('f.wa.late.days');
    if (days < 60) return t('f.wa.late.weeks', { n: Math.round(days / 7) });
    return t('f.wa.late.months', { n: Math.max(2, Math.round(days / 30.44)) });
}

/**
 * Everything the view shows, from the real data and the scenario's changes. `st` is the view state
 * ({optionId, cutCents, manualTicks, fundTicks}). Returns {empty: 'noGoals'|'noPayDates'|'failed'} when
 * there is nothing to plan. `waysFor(id)` gives the earnings three ways for an option (memoised).
 */
export function computeAnswer({ scenario, data, today }, st) {
    const tick = tickChanges(st.fundTicks || new Set());
    const changes = [...scenario.changes, ...tick];
    const date = changes.reduce((m, c) => (c.from && c.from > m ? c.from : m), today);
    let plan;
    try { plan = planGoalsFromData(data, { today, date, changes }); } catch (err) { console.error('goal plan failed', err); return { empty: 'failed' }; }
    if (!plan.perGoal.length) return { empty: 'noGoals' };
    const lastDue = plan.perGoal.reduce((m, g) => (g.due > m ? g.due : m), '');
    const payDates = payDatesFor(plan.resolved, today, lastDue);
    if (!payDates.length) return { empty: 'noPayDates' };

    const options = { ...plan.options };
    if (st.optionId === 'custom') options.custom = customOption(plan, st.cutCents == null ? plan.options.mix.cutCents : st.cutCents);
    const selected = options[st.optionId] || options.mix;
    const wayCache = new Map();
    const waysFor = (id) => {
        const o = options[id];
        if (!o) return null;
        if (!wayCache.has(id)) wayCache.set(id, earningsThreeWays(plan.resolved, o.earnedCents));
        return wayCache.get(id);
    };
    const idx = Number.isInteger(plan.resolved.primaryIncomeIndex) && plan.resolved.incomeSources[plan.resolved.primaryIncomeIndex] ? plan.resolved.primaryIncomeIndex : 0;
    const source = (plan.resolved.incomeSources || [])[idx] || {};
    const goals = goalsFromPlan(plan);
    const smile = plan.smilePerPayCents;
    const landNow = landingDates({ goals, fundsCents: plan.fundsCountedCents, perPayCents: smile, payDates });
    const landPlan = landingDates({ goals, fundsCents: plan.fundsCountedCents, perPayCents: smile + plan.gapCents, payDates });
    const net = netPerPayCents(plan.resolved);
    const mixCut = options.mix.cutCents;
    const model = {
        plan, options, selected, waysFor, payDates, goals, lastDue, perWord: perWord(source.paySchedule), net,
        landNow, landPlan, tl: timelineModel({ today, now: landNow, plan: landPlan }),
        splurgeItems: plan.splurgeItems, changes, tick,
        needs: plan.gapAfterUnallocatedCents > 0, onTrack: plan.onTrack,
        maxCut: Math.min(plan.gapAfterUnallocatedCents, plan.splurgePerPayCents),
        smilePctNow: net > 0 ? (smile / net) * 100 : 0,
        later: plan.bindingGoalId && mixCut >= 0
            ? pushDate({ plan, payDates, today, goalId: plan.bindingGoalId, cutCents: mixCut }) : null,
    };
    const e = selected.earnedCents;
    model.smilePctPlan = net + e > 0 ? ((smile + plan.gapCents) / (net + e)) * 100 : 0;
    model.threeWays = waysFor(selected.id);
    model.verdict = verdictFor(selected.id, model);
    model.verdictNow = verdictNow(model, today);
    return model;
}

/**
 * The top verdict for an option, derived from the model the cards use. Green Yes (`ok`) with what it takes, or
 * amber Not yet when a goal has no pay days left. The headline is different for each of Cut, Mix and Earn it.
 * @returns {{ok:boolean, optionId:string, key:string, headline:string, say:{key:string, params:object}|null}}
 */
export function verdictFor(optionId, model) {
    const o = model.options[optionId] || model.selected;
    const plan = model.plan;
    if (plan.impossible.length) {
        return { ok: false, optionId: o.id, key: 'f.wa.v.blocked', headline: t('f.wa.v.blocked'), say: { key: 'f.wa.v.blockedSay', params: { count: plan.impossible.length } } };
    }
    if (plan.gapAfterUnallocatedCents <= 0) {
        return { ok: true, optionId: o.id, key: 'f.wa.v.fits', headline: t('f.wa.v.fits'), say: null };
    }
    const key = `f.wa.v.${o.id}`;
    const ways = model.waysFor(o.id) || model.waysFor('mix');
    const params = { per: model.perWord, cut: { text: money(o.cutCents) }, take: { text: money(o.earnedCents) } };
    let sayKey;
    if (o.earnedCents > 0 && ways && ways.reachable) params.before = { text: money(ways.beforeTaxPerPayCents) };
    if (o.cutCents > 0 && o.earnedCents > 0) sayKey = params.before ? 'f.wa.v.say.both' : 'f.wa.v.say.bothTake';
    else if (o.cutCents > 0) sayKey = 'f.wa.v.say.cut';
    else sayKey = params.before ? 'f.wa.v.say.earn' : 'f.wa.v.say.earnTake';
    return { ok: true, optionId: o.id, key, headline: t(key), say: { key: sayKey, params } };
}

/** The second box: how it stands on the current split. */
function verdictNow(model, today) {
    const plan = model.plan;
    if (plan.gapCents <= 0 && !plan.impossible.length) return { ok: true, headline: t('f.wa.now.ok'), say: null };
    const rows = model.landNow.filter((r) => r.state !== 'covered');
    let worst = null;
    for (const r of rows) {
        const late = r.state === 'lands' ? (r.late ? daysApart(r.due, r.date) : 0) : 1e9;
        if (late > 0 && (!worst || late > worst.late)) worst = { r, late };
    }
    let say = null;
    if (worst) {
        const r = worst.r;
        say = r.state === 'lands'
            ? { key: 'f.wa.now.say', params: { name: r.name, date: dayLong(r.date, today), by: lateBy(worst.late), due: dayLong(r.due, today) } }
            : { key: 'f.wa.now.sayFar', params: { name: r.name } };
    }
    return { ok: false, headline: t('f.wa.now.short', { short: money(plan.gapCents), per: model.perWord }), say };
}

// ---------- small DOM helpers ----------

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

/** Fill `parent` from a catalogue string with {name} holes. A hole given {text} is a bold figure; a string is text. */
export function rich(parent, key, params = {}) {
    const s = t(key);
    const re = /\{(\w+)\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
        if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
        const v = params[m[1]];
        if (isObj(v)) { const b = el('b', v.cls || 'money', v.text); parent.appendChild(b); }
        else parent.appendChild(document.createTextNode(v == null ? m[0] : String(v)));
        last = re.lastIndex;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
    return parent;
}

const fig = (label, big, sub) => {
    const d = el('div');
    d.append(el('span', 'k', label), el('b', 'money', big));
    const s = el('span', 's');
    if (typeof sub === 'string') s.textContent = sub; else sub(s);
    d.appendChild(s);
    return d;
};

// ---------- the regions ----------

function drawTop(model, today) {
    const wrap = el('div', 'wa-top');
    const v = model.verdict;
    const vn = model.verdictNow;
    const verdicts = el('div', 'wa-verdicts');
    const needsPlan = model.needs || model.plan.impossible.length;
    if (needsPlan) {
        const a = el('div', `wa-verdict ${v.ok ? 'ok' : 'warn'}`);
        a.setAttribute('aria-live', 'polite');
        a.dataset.verdict = v.optionId;
        a.append(el('p', 'wa-vk', t('f.wa.v.with')), el('p', 'wa-vbig', v.headline));
        if (v.say) rich(a.appendChild(el('p', 'wa-vsay')), v.say.key, v.say.params);
        verdicts.appendChild(a);
    }
    const b = el('div', `wa-verdict ${vn.ok ? 'ok' : 'warn'}`);
    b.append(el('p', 'wa-vk', t('f.wa.now.title')));
    b.appendChild(el('p', 'wa-vbig', vn.headline));
    if (vn.say) rich(b.appendChild(el('p', 'wa-vsay')), vn.say.key, vn.say.params);
    verdicts.appendChild(b);
    wrap.appendChild(verdicts);

    // three key figures
    const o = model.selected;
    const plan = model.plan;
    const ul = el('ul', 'wa-keys');
    const smileNow = plan.smilePerPayCents;
    const into = el('li');
    const intoCents = smileNow + plan.gapCents;
    into.appendChild(fig(t('f.wa.k.smile'), money(intoCents), (s) => {
        s.textContent = model.needs
            ? t('f.wa.k.smile.sub', { per: model.perWord, pct: round1(model.smilePctPlan), now: round1(model.smilePctNow) })
            : t('f.wa.k.smile.same', { per: model.perWord, pct: round1(model.smilePctNow) });
    }));
    const spl = el('li');
    spl.appendChild(fig(t('f.wa.k.splurge'), o.cutCents > 0 ? `−${money(o.cutCents)}` : t('f.wa.k.none'), (s) => {
        s.textContent = o.cutCents > 0 ? t('f.wa.k.splurge.sub', { per: model.perWord, date: dayLong(model.lastDue, today) }) : t('f.wa.k.splurge.same');
    }));
    const ways = model.threeWays;
    const ex = el('li');
    ex.appendChild(fig(t('f.wa.k.extra'), o.earnedCents <= 0 ? t('f.wa.k.none') : ways && ways.reachable ? money(ways.beforeTaxPerPayCents) : money(o.earnedCents), (s) => {
        if (o.earnedCents <= 0) s.textContent = t('f.wa.k.extra.none');
        else if (ways && ways.reachable) s.textContent = t('f.wa.k.extra.sub', { per: model.perWord, year: money(ways.beforeTaxPerYearCents) });
        else s.textContent = t('f.wa.k.extra.take', { per: model.perWord });
    }));
    ul.append(into, spl, ex); // Into Smile, Splurge, Extra pay (as the mock)
    wrap.appendChild(ul);
    return wrap;
}

const round1 = (n) => Math.round(n * 10) / 10;

function drawTimeline(model, today) {
    const sec = el('section', 'card wa-tl');
    sec.setAttribute('aria-labelledby', 'wa-tl-h');
    const head = el('div', 'card-head');
    const h = el('h3', '', t('f.wa.tl.title'));
    h.id = 'wa-tl-h';
    head.append(h, el('span', 'aside', t('f.wa.tl.aside')));
    sec.appendChild(head);
    const holder = el('div', 'wa-tl-holder');
    holder.dataset.tl = '1';
    sec.appendChild(holder);
    const list = el('ol', 'wa-tl-list');
    model.landNow.forEach((r, i) => {
        const p = model.landPlan[i];
        const li = el('li');
        li.appendChild(el('b', '', `${i + 1} ${r.name}`));
        const state = (x) => (x.state === 'lands' ? dayLong(x.date, today) : t(`f.wa.tl.state.${x.state}`));
        const a = el('span', r.late ? 'late' : '');
        a.textContent = `${t('f.wa.tl.now')}: ${state(r)}`;
        const b = el('span', 'plan');
        b.textContent = `${t('f.wa.tl.plan')}: ${state(p)}`;
        const c = el('span');
        c.textContent = `${t('f.wa.tl.wanted')}: ${dayLong(r.due, today)}`;
        li.append(a, b, c);
        list.appendChild(li);
    });
    sec.appendChild(list);
    return sec;
}

/** Draw the lanes at the holder's real width (so label rows suit the screen) and again when it changes. */
function layoutTimeline(sec, model, today) {
    const holder = sec.querySelector('[data-tl]');
    if (!holder) return;
    const paint = () => {
        const w = holder.clientWidth || 330;
        if (holder._w && Math.abs(holder._w - w) < 4) return;
        holder._w = w;
        renderTimeline(holder, model.tl, { axisPx: w, today });
    };
    holder._w = 0;
    paint();
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => { if (!holder.isConnected) { ro.disconnect(); return; } paint(); });
        ro.observe(holder);
    }
}

function wayText(model, o) {
    const left = money(o.splurgeLeftCents);
    if (o.id === 'cut') return o.earnedCents > 0 ? t('f.wa.way.cut.short', { left, earned: money(o.earnedCents) }) : t('f.wa.way.cut', { left, pct: Math.round(o.cutPct) });
    if (o.id === 'mix') return o.earnedCents > 0 ? t('f.wa.way.mix', { left }) : t('f.wa.way.mix.all', { left });
    return t('f.wa.way.earn', { left });
}

let uid = 0;

function drawWays(model, st) {
    const plan = model.plan;
    const sec = el('section', 'card wa-ways');
    sec.setAttribute('aria-labelledby', 'wa-ways-h');
    const head = el('div', 'card-head');
    const h = el('h3');
    h.id = 'wa-ways-h';
    rich(h, 'f.wa.ways.title', { gap: { text: money(plan.gapAfterUnallocatedCents) }, per: model.perWord });
    head.append(h, el('span', 'aside', t('f.wa.ways.aside')));
    sec.appendChild(head);
    if (!model.needs) {
        sec.appendChild(el('p', 'muted', plan.impossible.length ? t('f.wa.ways.blocked') : t('f.wa.ways.fits')));
        return sec;
    }
    const group = el('div', 'wa-ways-grid');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', 'wa-ways-h');
    const name = `wa-way-${++uid}`;
    const rest = plan.gapAfterUnallocatedCents;
    for (const id of OPTION_IDS) {
        const o = model.options[id];
        const lab = el('label', 'wa-way');
        const inp = document.createElement('input');
        inp.type = 'radio'; inp.name = name; inp.value = id; inp.className = 'wa-radio';
        inp.checked = model.selected.id === id;
        inp.dataset.act = 'way';
        inp.dataset.focusKey = `way-${id}`;
        lab.appendChild(inp);
        lab.appendChild(el('b', 'w-t', t(`f.wa.opt.${id}`)));
        const bar = el('span', 'wbar');
        bar.setAttribute('aria-hidden', 'true');
        const sp = rest > 0 ? (o.cutCents / rest) * 100 : 0;
        if (o.cutCents > 0) { const i = el('i', 'w-spl'); i.style.width = `${sp}%`; bar.appendChild(i); }
        if (o.earnedCents > 0) { const i = el('i', 'w-earn'); i.style.width = `${100 - sp}%`; bar.appendChild(i); }
        lab.appendChild(bar);
        const legend = el('span', 'w-legend');
        if (o.cutCents > 0) {
            const s = el('span');
            s.append(el('i', 'k-spl'));
            rich(s, 'f.wa.way.fromSplurge', { amt: { text: money(o.cutCents) } });
            legend.appendChild(s);
        }
        if (o.earnedCents > 0) {
            const s = el('span');
            s.append(el('i', 'k-earn'));
            rich(s, 'f.wa.way.earned', { amt: { text: money(o.earnedCents) } });
            legend.appendChild(s);
        }
        lab.appendChild(legend);
        lab.appendChild(el('span', 'w-r', wayText(model, o)));
        if (o.bigCut) lab.appendChild(el('span', 'w-flag', t('f.wa.way.big')));
        group.appendChild(lab);
    }
    sec.appendChild(group);

    // the earnings three ways, for the chosen option
    const o = model.selected;
    const box = el('div', 'wa-earn');
    box.setAttribute('aria-live', 'polite');
    const label = o.id === 'custom' ? t('f.wa.opt.custom') : t(`f.wa.opt.${o.id}`);
    box.appendChild(el('p', 'eb-h', t('f.wa.earn.title', { option: label })));
    if (o.earnedCents <= 0) box.appendChild(el('p', 'muted', t('f.wa.earn.none')));
    else box.appendChild(threeWaysBlock(model.threeWays, o.earnedCents, model.perWord, true));
    sec.appendChild(box);
    return sec;
}

/** The three figures that always go together: take-home, before tax, extra hours. */
function threeWaysBlock(ways, earnedCents, per, withFoot) {
    const wrap = el('div');
    const g = el('div', 'wa-gap3');
    if (!ways || !ways.reachable) {
        g.appendChild(fig(t('f.wa.g.take'), money(earnedCents), t('f.wa.g.take.sub', { per })));
        wrap.appendChild(g);
        wrap.appendChild(el('p', 'fine', t('f.wa.g.unreach')));
        return wrap;
    }
    g.appendChild(fig(t('f.wa.g.take'), money(ways.takeHomePerPayCents), t('f.wa.g.take.sub', { per })));
    g.appendChild(fig(t('f.wa.g.before'), money(ways.beforeTaxPerPayCents), t('f.wa.g.before.sub', { per, year: money(ways.beforeTaxPerYearCents) })));
    const hours = el('div');
    hours.append(el('span', 'k', t('f.wa.g.hours')));
    hours.append(el('b', 'num', ways.hoursPerPay == null ? t('f.wa.g.hours.unknown') : t('f.wa.g.hours.value', { n: ways.hoursPerPay })));
    hours.append(el('span', 's', ways.hoursPerPay == null ? t('f.wa.g.hours.hint') : t('f.wa.g.hours.sub', { per, rate: money(Math.round((ways.hourlyRate || 0) * 100)) })));
    g.appendChild(hours);
    wrap.appendChild(g);
    if (withFoot && ways.beforeTaxPerPayCents > 0) {
        wrap.appendChild(el('p', 'fine', t('f.wa.g.foot', { cents: Math.round((ways.takeHomePerPayCents / ways.beforeTaxPerPayCents) * 100) })));
    }
    return wrap;
}

function drawFine(model, st) {
    const det = el('details', 'card wa-fine');
    det.open = !!st.fineOpen;
    det.dataset.fine = '1';
    const sum = el('summary');
    const txt = el('span');
    txt.append(el('b', '', t('f.wa.fine.title')), el('span', '', t('f.wa.fine.sub')));
    sum.appendChild(txt);
    det.appendChild(sum);
    const body = el('div', 'wa-ft');
    const main = el('div', 'wa-ft-main');
    const sl = el('div', 'wa-slider');
    const lab = el('label', 'field-label', t('f.wa.fine.q'));
    lab.htmlFor = 'wa-cut';
    const now = el('p', 'wa-cut-now');
    now.dataset.ref = 'now';
    const inp = document.createElement('input');
    inp.type = 'range'; inp.id = 'wa-cut'; inp.min = '0'; inp.step = '0.01';
    inp.max = String(model.maxCut / 100);
    inp.dataset.act = 'slider';
    inp.disabled = model.maxCut <= 0;
    const ends = el('div', 'wa-ends');
    ends.append(el('span', '', t('f.wa.fine.none')));
    ends.append(el('span', '', model.plan.splurgePerPayCents < model.plan.gapAfterUnallocatedCents
        ? t('f.wa.fine.allSplurge', { amt: money(model.maxCut) }) : t('f.wa.fine.all', { amt: money(model.maxCut) })));
    sl.append(lab, now, inp, ends);
    const dyn = el('div', 'wa-ft-dyn');
    dyn.dataset.ref = 'dyn';
    main.append(sl, dyn);
    const items = el('div', 'wa-items');
    items.dataset.ref = 'items';
    body.append(main, items);
    det.appendChild(body);
    det.addEventListener('toggle', () => { st.fineOpen = det.open; });
    return det;
}

/** Update the Fine-tune parts that depend on the chosen cut, without rebuilding the slider you are dragging. */
function refreshFine(det, model, st, today) {
    const o = model.selected;
    const plan = model.plan;
    const inp = det.querySelector('input[type="range"]');
    if (document.activeElement !== inp) inp.value = String(o.cutCents / 100);
    inp.setAttribute('aria-valuetext', money(o.cutCents));
    const now = det.querySelector('[data-ref="now"]');
    now.textContent = '';
    rich(now, 'f.wa.fine.now', { amt: { text: money(o.cutCents) }, per: model.perWord, pct: Math.round(o.cutPct) });
    const dyn = det.querySelector('[data-ref="dyn"]');
    dyn.textContent = '';
    if (o.earnedCents > 0) dyn.appendChild(threeWaysBlock(model.waysFor(o.id), o.earnedCents, model.perWord, false));
    else dyn.appendChild(el('p', 'muted', t('f.wa.earn.none')));
    if (o.bigCut) {
        const hon = el('div', 'wa-honest');
        hon.setAttribute('role', 'note');
        const p = el('p');
        p.append(el('b', '', t('f.wa.honest.lead', { pct: Math.round(o.cutPct) })), document.createTextNode(` ${t('f.wa.honest.body')}`));
        hon.appendChild(p);
        const opts = el('div', 'wa-opts');
        const mix = model.options.mix;
        const b1 = el('button', 'wa-opt-btn');
        b1.type = 'button'; b1.dataset.act = 'smaller-rise'; b1.dataset.focusKey = 'smaller-rise';
        b1.appendChild(el('b', '', t('f.wa.honest.rise')));
        const w = model.waysFor('mix');
        const s1 = el('span');
        rich(s1, w && w.reachable ? 'f.wa.honest.riseSub' : 'f.wa.honest.riseSubTake', {
            cut: { text: money(mix.cutCents) }, before: { text: money(w && w.reachable ? w.beforeTaxPerPayCents : mix.earnedCents) }, per: model.perWord,
        });
        b1.appendChild(s1);
        opts.appendChild(b1);
        if (model.later) {
            const b2 = el('button', 'wa-opt-btn');
            b2.type = 'button'; b2.dataset.act = 'smaller-date'; b2.dataset.focusKey = 'smaller-date';
            b2.appendChild(el('b', '', t('f.wa.honest.date')));
            const s2 = el('span');
            rich(s2, 'f.wa.honest.dateSub', { cut: { text: money(mix.cutCents) }, name: model.later.name, date: dayLong(model.later.to, today) });
            b2.appendChild(s2);
            opts.appendChild(b2);
        }
        hon.appendChild(opts);
        dyn.appendChild(hon);
    }
    // the items you splurge on, biggest first, ticked against the cut
    const holder = det.querySelector('[data-ref="items"]');
    holder.textContent = '';
    holder.appendChild(el('h4', '', t('f.wa.items.title')));
    if (!model.splurgeItems.length) { holder.appendChild(el('p', 'fine', t('f.wa.items.none'))); return; }
    holder.appendChild(el('p', 'fine', t('f.wa.items.lead')));
    let ticked;
    if (st.manualTicks) ticked = new Set(st.manualTicks);
    else ticked = new Set(tickSplurgeItems(model.splurgeItems, o.cutCents).items.filter((i) => i.ticked).map((i) => i.id));
    const ul = el('ul');
    ul.setAttribute('role', 'group');
    ul.setAttribute('aria-label', t('f.wa.items.title'));
    let total = 0;
    for (const it of model.splurgeItems) {
        const li = el('li');
        const l = el('label');
        const c = document.createElement('input');
        c.type = 'checkbox'; c.checked = ticked.has(it.id); c.dataset.act = 'item'; c.dataset.id = it.id; c.dataset.cents = String(it.perPayCents);
        c.dataset.focusKey = `item-${it.id}`;
        if (c.checked) total += it.perPayCents;
        l.append(c, el('span', '', it.name), el('span', 'money', money(it.perPayCents)));
        li.appendChild(l);
        ul.appendChild(li);
    }
    holder.appendChild(ul);
    const tot = el('p', 'wa-i-total');
    tot.append(el('span', '', t('f.wa.items.ticked')), el('b', 'money', money(total)));
    holder.appendChild(tot);
}

function drawCounting(model, st, today) {
    const plan = model.plan;
    const sec = el('section', 'card wa-count');
    sec.setAttribute('aria-labelledby', 'wa-count-h');
    const head = el('div', 'card-head');
    const h = el('h3', '', t('f.wa.count.title'));
    h.id = 'wa-count-h';
    head.append(h, el('span', 'aside', t('f.wa.count.total', { amt: money(plan.fundsCountedCents) })));
    sec.append(head, el('p', 'muted', t('f.wa.count.lead')));
    const ul = el('ul', 'wa-count-list');
    for (const c of plan.counted.filter((x) => x.kind === 'smile')) {
        const li = el('li');
        const l = el('label');
        const i = document.createElement('input');
        i.type = 'checkbox'; i.checked = true; i.disabled = true;
        l.append(i, el('span', '', c.label), el('span', 'money', money(c.cents)), el('span', 'fine', t('f.wa.count.always')));
        li.appendChild(l);
        ul.appendChild(li);
    }
    for (const c of countingCandidates(plan, today)) {
        const li = el('li');
        const l = el('label');
        const i = document.createElement('input');
        i.type = 'checkbox'; i.checked = st.fundTicks.has(c.key); i.dataset.act = 'fund'; i.dataset.key = c.key; i.dataset.focusKey = `fund-${c.key}`;
        l.append(i, el('span', '', c.label), el('span', 'money', money(c.cents)));
        li.appendChild(l);
        if (i.checked && c.kind === 'mojo') li.appendChild(el('p', 'fine', t('f.wa.count.mojo')));
        ul.appendChild(li);
    }
    sec.appendChild(ul);
    sec.appendChild(el('p', 'fine', t('f.wa.count.note')));
    return sec;
}

// ---------- the view ----------

function renderAnswer(container, ctx) {
    const { scenario, data, today } = ctx;
    container.textContent = '';
    const root = el('div', 'wa');
    container.appendChild(root);
    const st = stateFor(scenario.id);
    let model = computeAnswer({ scenario, data, today }, st);
    if (model.empty) {
        const card = el('div', 'card wa-empty');
        card.appendChild(el('p', 'muted', t(`f.wa.empty.${model.empty}`)));
        root.appendChild(card);
        answers.delete(scenario.id);
        return;
    }
    const regions = {};
    for (const k of ['top', 'tl', 'ways', 'pft', 'fine', 'count']) { regions[k] = el('div', `wa-r wa-r-${k}`); root.appendChild(regions[k]); }

    async function onSave(changes, label) {
        const pool = [...scenario.changes];
        const ticks = model.tick.map((c) => ({ ...c, id: newChangeId(pool) }));
        const sc = planScenario({ scenario, changes: [...ticks, ...changes], label, today });
        try {
            const res = await saveScenario(sc);
            if (!res.ok) { showToast(t('f.wi.saveFailed'), 'error'); return; }
            showToast(t('f.wa.pft.saved', { name: res.scenario.name }), 'info');
            openScenario(res.scenario.id, { step: 'answer' });
        } catch (err) {
            console.error('plan save failed', err);
            showToast(t('f.wi.saveFailed'), 'error');
        }
    }

    function paint(which) {
        for (const k of which) {
            const r = regions[k];
            r.textContent = '';
            if (k === 'top') r.appendChild(drawTop(model, today));
            else if (k === 'tl') { const s = drawTimeline(model, today); r.appendChild(s); layoutTimeline(s, model, today); }
            else if (k === 'ways') r.appendChild(drawWays(model, st));
            else if (k === 'pft') { if (model.needs) renderPlanForThis(r, { data, scenario, model, st, today, onSave }); }
            else if (k === 'fine') { if (model.needs) { const d = drawFine(model, st); r.appendChild(d); refreshFine(d, model, st, today); } }
            else if (k === 'count') r.appendChild(drawCounting(model, st, today));
        }
    }
    function publish() {
        answers.set(scenario.id, { optionId: model.selected.id, option: model.selected, plan: model.plan, changes: model.changes });
        root.dispatchEvent(new CustomEvent('ft:answer-change', { bubbles: true, detail: { scenarioId: scenario.id, optionId: model.selected.id, option: model.selected } }));
    }
    function recompute() { model = computeAnswer({ scenario, data, today }, st); }
    function refocus() {
        if (!st.focus) return;
        const n = root.querySelector(`[data-focus-key="${st.focus}"]`);
        st.focus = null;
        if (n) n.focus({ preventScroll: true });
    }
    const ALL = ['top', 'tl', 'ways', 'pft', 'fine', 'count'];
    const LIVE = ['top', 'tl', 'ways', 'pft'];

    function choose(id) {
        st.optionId = id; st.cutCents = null; st.manualTicks = null;
        recompute(); paint(ALL); publish(); refocus();
    }

    root.addEventListener('input', (e) => {
        if (e.target.dataset.act !== 'slider') return;
        st.optionId = 'custom';
        st.cutCents = Math.round(Number(e.target.value) * 100) || 0;
        st.manualTicks = null;
        recompute(); paint(LIVE);
        const det = regions.fine.querySelector('[data-fine]');
        if (det) refreshFine(det, model, st, today);
        publish();
    });
    root.addEventListener('change', (e) => {
        const a = e.target.dataset.act;
        if (a === 'way') { st.focus = `way-${e.target.value}`; choose(e.target.value); return; }
        if (a === 'item') {
            const ids = [...root.querySelectorAll('input[data-act="item"]')].filter((c) => c.checked);
            st.manualTicks = new Set(ids.map((c) => c.dataset.id));
            const sum = ids.reduce((s, c) => s + Number(c.dataset.cents), 0);
            st.optionId = 'custom'; st.cutCents = Math.min(sum, model.maxCut);
            st.focus = `item-${e.target.dataset.id}`;
            recompute(); paint(LIVE);
            const det = regions.fine.querySelector('[data-fine]');
            if (det) refreshFine(det, model, st, today);
            publish(); refocus();
            return;
        }
        if (a === 'fund') {
            if (e.target.checked) st.fundTicks.add(e.target.dataset.key); else st.fundTicks.delete(e.target.dataset.key);
            st.focus = e.target.dataset.focusKey;
            recompute();
            if (model.empty) { renderAnswer(container, ctx); return; }
            paint(ALL); publish(); refocus();
            return;
        }
        if (a === 'pft-split') { st.pft.split = e.target.checked; st.focus = 'pft-split'; paint(['pft']); refocus(); return; }
        if (a === 'one-split') { st.pft.oneSplit[e.target.dataset.key] = e.target.checked; st.focus = e.target.dataset.focusKey; paint(['pft']); refocus(); return; }
        if (a === 'one-goal') {
            if (e.target.dataset.key === 'push') st.pft.pushGoal = e.target.value; else st.pft.dropGoal = e.target.value;
            st.focus = e.target.dataset.focusKey; paint(['pft']); refocus();
        }
    });
    root.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.dataset.act === 'smaller-rise') { st.focus = 'way-mix'; st.fineOpen = false; choose('mix'); }
        if (b.dataset.act === 'smaller-date') {
            st.optionId = 'custom'; st.cutCents = model.options.mix.cutCents; st.manualTicks = null;
            st.pft.pushGoal = model.later ? model.later.goalId : st.pft.pushGoal;
            recompute(); paint(ALL); publish();
            const one = root.querySelector('[data-one="push"]');
            if (one && one.scrollIntoView) one.scrollIntoView({ block: 'center' });
        }
    });

    paint(ALL);
    publish();
}

registerScenarioView('answer', renderAnswer, { order: -10 });
export { renderAnswer, dayShort };
