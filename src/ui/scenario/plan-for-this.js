// "Plan for this" (F8a; 03d section 6, FT-R-35, FT-R-89). Turns the chosen option into dated scenario changes
// that go through F1's `saveScenario`, and offers the one-tap options (push a goal's date, fund the goals one
// after another, drop or shrink a goal), each previewed through F4's `planGoals` before anything is saved.
//
// Pure part (no DOM): everything exported except `renderPlanForThis`. The planner is never asked to touch
// Daily or Fire extinguisher: the only allocation rows a change here targets are Smile and Splurge.
// The DOM part takes callbacks, so this file has no toast or screen import.

import { t } from '../../i18n/strings.js';
import { planGoals, tickSplurgeItems, BIG_CUT_SHARE } from '../../calc/goal-planner.js';
import { resolveAt } from '../../calc/scenario.js';
import { netPerPayCents } from '../../calc/plan.js';
import { addDays, payDatesBetween } from '../../calc/pay-cycle.js';
import { newScenario, newChangeId } from '../../state/scenarios.js';
import { landingDates, dayLong } from './timeline.js';
import { describeChange } from './change-list.js';
import { fmtMoney } from './starters.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const dollars = (c) => Math.round(c) / 100;
export const money = (cents) => fmtMoney(cents / 100);
/** How many years of pay dates the date options may look ahead. */
export const HORIZON_DAYS = 6 * 366;

// ---------- reading the plan back into goals ----------

/** The dated goals behind a plan, in due-date order, each with its own cost (the plan holds cumulative costs). */
export function goalsFromPlan(plan) {
    let prev = 0;
    return (plan.perGoal || []).map((g) => {
        const costCents = g.cumulativeCostCents - prev;
        prev = g.cumulativeCostCents;
        return { id: g.id, name: g.name || '', costCents, due: g.due };
    });
}

export function primaryIndexOf(data) {
    const list = (data && data.incomeSources) || [];
    const i = Number.isInteger(data && data.primaryIncomeIndex) ? data.primaryIncomeIndex : 0;
    return list[i] ? i : 0;
}

/** Pay dates after today, far enough ahead for the landing dates and the date options. */
export function payDatesFor(resolved, today, lastDue) {
    const src = ((resolved && resolved.incomeSources) || [])[primaryIndexOf(resolved)];
    if (!src || !today) return [];
    return payDatesBetween(src, addDays(today, 1), addDays(lastDue && lastDue > today ? lastDue : today, HORIZON_DAYS));
}

/** F4's planner again on changed goals (never on changed Daily or Fire: they are not inputs). */
export function replan(plan, goals, payDates, today) {
    return planGoals({
        goals, fundsCountedCents: plan.fundsCountedCents, payDates, today,
        smilePerPayCents: plan.smilePerPayCents, splurgePerPayCents: plan.splurgePerPayCents, unallocatedPerPayCents: 0,
    });
}

// ---------- change makers ----------

function mk(existing, c) {
    const id = newChangeId(existing);
    const change = { id, field: null, baseValue: null, from: null, until: null, note: '', ...c };
    existing.push(change);
    return change;
}

/** Splurge items to give up for a cut: the ticked ids (auto: biggest first until the cut is covered). */
export function itemsForCut(items, cutCents, manualIds = null) {
    if (manualIds) {
        const set = new Set(manualIds);
        return (items || []).filter((i) => set.has(i.id));
    }
    return tickSplurgeItems(items, cutCents).items.filter((i) => i.ticked);
}

/**
 * How much of each Splurge item the cut takes, biggest first, so the takes add up to exactly the cut (Q1): the
 * last item is cut only in part when the whole item is more than what is left. With ticked ids (`manualIds`) only
 * those items are used, still biggest first and never more than `cutCents` in all.
 * Returns [{id, name, perPayCents, takeCents}] (takeCents > 0 only).
 */
export function cutTakes(items, cutCents, manualIds = null) {
    const ids = manualIds ? new Set(manualIds) : null;
    const pool = (items || []).filter((i) => i && i.perPayCents > 0 && (!ids || ids.has(i.id)));
    let left = Math.max(0, Math.round(cutCents) || 0);
    const out = [];
    for (const it of [...pool].sort((a, b) => b.perPayCents - a.perPayCents)) {
        if (left <= 0) break;
        const take = Math.min(left, it.perPayCents);
        left -= take;
        out.push({ id: it.id, name: it.name, perPayCents: it.perPayCents, takeCents: take });
    }
    return out;
}

/**
 * Split change offer: Smile gets what the plan needs each pay, Splurge pays for it. Daily, Fire extinguisher
 * and every other row keep their percentage. `neededPerPayCents` is the Smile figure the plan needs
 * (`requiredPerPayCents`). `data` is the real data, `changes` everything already in the scenario plus the
 * new changes, so the pay rise (if any) is in the take-home the percentages apply to.
 * Returns null when no move is needed or Splurge could not pay for it (it "fits" only when Splurge stays at or above 0).
 */
export function splitOffer({ data, changes, neededPerPayCents, today, until = null }) {
    if (!isObj(data) || !(neededPerPayCents > 0)) return null;
    const resolved = resolveAt(data, changes, today);
    const net = netPerPayCents(resolved);
    const rows = Array.isArray(resolved.allocation) ? resolved.allocation : [];
    const smile = rows.find((r) => r && r.role === 'smile' && r.id);
    const splurge = rows.find((r) => r && r.role === 'splurge' && r.id);
    if (!smile || !splurge || !(net > 0)) return null;
    const oldSmile = Number(smile.percentage) || 0;
    const oldSplurge = Number(splurge.percentage) || 0;
    const newSmile = Math.ceil((neededPerPayCents / net) * 1000 - 1e-9) / 10;
    if (newSmile <= oldSmile) return null;
    const newSplurge = Math.round((oldSplurge - (newSmile - oldSmile)) * 10) / 10;
    if (newSplurge < 0) return null;
    const list = [];
    const mkSplit = (row, value, base) => ({ kind: 'split', target: { collection: 'allocation', id: row.id }, field: 'percentage', op: 'set', value, baseValue: base, from: today, until });
    return {
        smilePct: newSmile, splurgePct: newSplurge, fromSmilePct: oldSmile, fromSplurgePct: oldSplurge,
        specs: [mkSplit(smile, newSmile, oldSmile), mkSplit(splurge, newSplurge, oldSplurge)], list,
    };
}

/** Give the split specs ids. */
function addSplit(existing, offer) {
    return offer.specs.map((s) => mk(existing, s));
}

/**
 * The scenario changes for the chosen option: an extra-earnings figure becomes an `income` change with that
 * rise (an `incomeAdd` when the pay source has no id), a Splurge cut becomes `expense` changes that take the
 * ticked items to nothing, and (when asked and it fits) the split. `existing` is the scenario's changes
 * (for unique ids). Returns {changes, split}.
 */
export function optionChanges({ data, resolved, existing, option, threeWays, items, manualIds = null, today, until = null, neededPerPayCents = 0, withSplit = false }) {
    const pool = [...existing];
    const out = [];
    if (option.earnedCents > 0 && threeWays && threeWays.reachable && threeWays.beforeTaxPerYearCents > 0) {
        const idx = primaryIndexOf(data);
        const real = (data.incomeSources || [])[idx];
        const res = ((resolved || data).incomeSources || [])[idx] || real;
        if (real && typeof real.id === 'string' && real.id) {
            const base = Number(res.grossAnnual) || 0;
            out.push(mk(pool, {
                kind: 'income', target: { collection: 'incomeSources', id: real.id }, field: 'grossAnnual', op: 'set',
                value: Math.round(base * 100 + threeWays.beforeTaxPerYearCents) / 100, baseValue: Number(real.grossAnnual) || 0,
                from: today, note: t('f.wa.pft.noteRise'),
            }));
        } else if (real) {
            out.push(mk(pool, {
                kind: 'incomeAdd', target: { collection: 'incomeSources', id: null }, op: 'add', from: today, note: t('f.wa.pft.noteRise'),
                value: {
                    id: `sc-extra-${pool.length}`, name: t('f.wa.pft.extraName'), incomeType: 'salaried', paySchedule: real.paySchedule,
                    payAnchor: real.payAnchor, grossAnnual: threeWays.beforeTaxPerYearCents / 100,
                },
            }));
        }
    }
    let uncutCents = 0;
    if (option.cutCents > 0) {
        const takes = cutTakes(items, option.cutCents, manualIds);
        uncutCents = Math.max(0, option.cutCents - takes.reduce((s, x) => s + x.takeCents, 0));
        for (const it of takes) {
            const row = (data.plan || []).find((p) => p && p.id === it.id);
            if (!row) continue;
            const was = Number(row.amount) || 0;
            // a whole item goes to 0; a part-cut item keeps the share of its own amount that is not taken (Q1)
            const value = it.takeCents >= it.perPayCents ? 0 : Math.round((was * (it.perPayCents - it.takeCents) / it.perPayCents) * 100) / 100;
            out.push(mk(pool, {
                kind: 'expense', target: { collection: 'plan', id: it.id }, field: 'amount', op: 'set', value,
                baseValue: was, from: today, until, note: t('f.wa.pft.noteCut'),
            }));
        }
    }
    let split = null;
    // A split is offered only when nothing has to be earned: a rise has not landed yet, and its share would go to
    // Daily and Fire extinguisher by their percentages, so the split cannot honestly be set before it does.
    if (withSplit && option.earnedCents <= 0) {
        split = splitOffer({ data, changes: [...existing, ...out], neededPerPayCents, today, until });
        if (split) out.push(...addSplit(pool, split));
    }
    return { changes: out, split, uncutCents };
}

// ---------- the one-tap options ----------

const goalSet = (goalId, field, value, baseValue, today, note) => ({
    kind: 'goal', target: { collection: 'bucketGoals', id: goalId }, field, op: 'set', value, baseValue, from: today, until: null, note,
});

/**
 * Push one goal's date to the earliest pay date at which the plan needs nothing extra to earn after the
 * Splurge cut `cutCents` (the chosen option's). Previewed with planGoals. Null when no date inside the
 * horizon works or the goal is unknown.
 */
export function pushDate({ plan, payDates, today, goalId, cutCents = 0 }) {
    const goals = goalsFromPlan(plan);
    const g = goals.find((x) => x.id === goalId);
    if (!g) return null;
    for (const d of payDates.filter((x) => x > g.due)) {
        const moved = goals.map((x) => (x.id === goalId ? { ...x, due: d } : x));
        const preview = replan(plan, moved, payDates, today);
        if (preview.impossible.length === 0 && preview.gapCents <= cutCents) {
            return { goalId, name: g.name, from: g.due, to: d, preview, spec: goalSet(goalId, 'due', d, g.due, today, t('f.wa.pft.notePush')) };
        }
    }
    return null;
}

/**
 * Fund the goals one after another at today's Smile plus the Splurge cut: each lands when the money before it
 * and its own cost have been paid in. `goalFund` lists the goals in due-date order with the date each lands;
 * `specs` moves the late ones' dates to those landing dates. Previewed with planGoals. Null when a goal
 * would land past the horizon.
 */
export function fundInOrder({ plan, payDates, today, cutCents = 0 }) {
    const goals = goalsFromPlan(plan);
    if (!goals.length) return null;
    const land = landingDates({ goals, fundsCents: plan.fundsCountedCents, perPayCents: plan.smilePerPayCents + cutCents, payDates });
    if (land.some((r) => r.state === 'beyond' || r.state === 'never')) return null;
    const goalFund = land.map((r, i) => ({ order: i + 1, goalId: r.id, name: r.name, due: r.due, landing: r.date, state: r.state, late: r.late }));
    const dueOf = new Map(goalFund.filter((r) => r.late).map((r) => [r.goalId, r.landing]));
    const preview = replan(plan, goals.map((g) => (dueOf.has(g.id) ? { ...g, due: dueOf.get(g.id) } : g)), payDates, today);
    const specs = goalFund.filter((r) => r.late).map((r) => goalSet(r.goalId, 'due', r.landing, r.due, today, t('f.wa.pft.noteOrder')));
    return { goalFund, specs, preview, anyLate: specs.length > 0 };
}

/** Drop one goal. Previewed with planGoals (the other goals only). */
export function dropGoal({ plan, payDates, today, goalId }) {
    const goals = goalsFromPlan(plan);
    const g = goals.find((x) => x.id === goalId);
    if (!g) return null;
    const preview = replan(plan, goals.filter((x) => x.id !== goalId), payDates, today);
    return {
        goalId, name: g.name, preview,
        spec: { kind: 'goal', target: { collection: 'bucketGoals', id: goalId }, field: null, op: 'remove', value: null, baseValue: null, from: today, until: null, note: t('f.wa.pft.noteDrop') },
    };
}

/**
 * Shrink one goal to the largest whole-dollar cost at which nothing extra needs earning after the Splurge cut.
 * Null when even a cost of 0 does not do it, or the goal already fits.
 */
export function shrinkGoal({ plan, payDates, today, goalId, cutCents = 0 }) {
    const goals = goalsFromPlan(plan);
    const g = goals.find((x) => x.id === goalId);
    if (!g) return null;
    const fits = (cost) => {
        const p = replan(plan, goals.map((x) => (x.id === goalId ? { ...x, costCents: cost } : x)), payDates, today);
        return p.impossible.length === 0 && p.gapCents <= cutCents ? p : null;
    };
    if (fits(g.costCents)) return null;
    if (!fits(0)) return null;
    let lo = 0; let hi = Math.floor(g.costCents / 100); // whole dollars: lo fits, hi does not
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(mid * 100)) lo = mid; else hi = mid;
    }
    if (hi * 100 <= g.costCents && fits(hi * 100)) lo = hi;
    const preview = fits(lo * 100);
    return { goalId, name: g.name, fromCents: g.costCents, toCents: lo * 100, preview, spec: goalSet(goalId, 'cost', lo, dollars(g.costCents), today, t('f.wa.pft.noteShrink')) };
}

// ---------- saving ----------

/**
 * The scenario a Plan for this saves: a new one (so the one you are looking at is not changed behind your
 * back) holding the scenario's own changes plus the new ones, with fresh ids. Save it with F1's `saveScenario`.
 */
export function planScenario({ scenario, changes, label, today }) {
    const name = [scenario && scenario.name ? scenario.name : t('f.wa.pft.baseName'), label].filter(Boolean).join(' - ').slice(0, 120);
    const sc = newScenario({ name, startedFrom: today, presetId: scenario ? scenario.presetId : null });
    const keep = [];
    for (const c of scenario ? scenario.changes : []) keep.push(JSON.parse(JSON.stringify(c)));
    sc.changes = [...keep, ...changes.map((c) => JSON.parse(JSON.stringify(c)))];
    return sc;
}

// ---------- DOM ----------

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

function button(label, act, cls = 'btn', data = {}) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.dataset.act = act;
    for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
    return b;
}

function chk(label, act, checked, data = {}) {
    const l = el('label', 'wa-check');
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = !!checked;
    i.dataset.act = act;
    for (const [k, v] of Object.entries(data)) i.dataset[k] = v;
    l.append(i, el('span', '', label));
    return l;
}

function lines(data, specs) {
    const ul = el('ul', 'wa-pft-lines');
    for (const s of specs) ul.appendChild(el('li', '', describeChange(data, s).what));
    return ul;
}

/**
 * Draw Plan for this. ctx: {data (real), scenario, model (the Answer model), st (the view's state), today,
 * onSave(changes, label)}. The screen decides what to do after a save.
 */
export function renderPlanForThis(parent, ctx) {
    const { data, scenario, model, st, today } = ctx;
    const plan = model.plan;
    const pft = st.pft;
    const sec = el('section', 'card wa-pft');
    sec.setAttribute('aria-labelledby', 'wa-pft-h');
    const head = el('div', 'card-head');
    const h = el('h3', '', t('f.wa.pft.title'));
    h.id = 'wa-pft-h';
    head.append(h, el('span', 'aside', t('f.wa.pft.aside')));
    sec.appendChild(head);

    const sel = model.selected;
    const label = t(`f.wa.opt.${sel.id}`);
    const until = model.lastDue && model.lastDue > today ? model.lastDue : null;
    const base = (withSplit) => optionChanges({
        data, resolved: plan.resolved, existing: scenario.changes, option: sel, threeWays: model.threeWays, items: model.splurgeItems,
        manualIds: st.manualTicks ? [...st.manualTicks] : null, today, until, neededPerPayCents: plan.requiredPerPayCents, withSplit,
    });
    const preview = base(true);
    const noSplit = base(false);

    const main = el('div', 'wa-pft-main');
    main.appendChild(el('p', 'wa-pft-lead', t('f.wa.pft.lead', { option: label })));
    const showSpecs = (pft.split && preview.split ? preview.changes : noSplit.changes);
    if (showSpecs.length) main.appendChild(lines(data, showSpecs));
    else main.appendChild(el('p', 'muted', t('f.wa.pft.nothing')));
    if (preview.split) {
        main.appendChild(chk(t('f.wa.pft.split', {
            smileFrom: `${preview.split.fromSmilePct}%`, smileTo: `${preview.split.smilePct}%`,
            splurgeFrom: `${preview.split.fromSplurgePct}%`, splurgeTo: `${preview.split.splurgePct}%`,
        }), 'pft-split', pft.split, { focusKey: 'pft-split' }));
    } else if (sel.cutCents > 0 || sel.earnedCents > 0) {
        main.appendChild(el('p', 'fine', t(sel.earnedCents > 0 ? 'f.wa.pft.splitWait' : 'f.wa.pft.splitNo')));
    }
    if (sel.cutCents - noSplit.uncutCents > 0) main.appendChild(el('p', 'fine', t('f.wa.pft.cutTotal', { amt: money(sel.cutCents - noSplit.uncutCents), per: model.perWord })));
    if (noSplit.uncutCents > 0) main.appendChild(el('p', 'fine', t('f.wa.pft.uncut', { amt: money(noSplit.uncutCents) })));
    const go = button(t('f.wa.pft.save'), 'pft-save', 'btn btn-primary');
    go.disabled = !showSpecs.length;
    main.appendChild(go);
    main.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="pft-save"]') && !go.disabled) ctx.onSave(showSpecs, label);
    });
    sec.appendChild(main);

    // the one-tap options
    const goals = goalsFromPlan(plan);
    if (goals.length) {
        const sub = el('div', 'wa-onetap');
        sub.appendChild(el('h4', '', t('f.wa.one.title')));
        sub.appendChild(el('p', 'fine', t('f.wa.one.lead')));
        const cut = sel.cutCents;
        const options = (id) => goals.map((g) => {
            const o = el('option', '', g.name || t('f.wa.one.unnamed'));
            o.value = g.id;
            o.selected = g.id === id;
            return o;
        });
        const goalSelect = (key, current) => {
            const w = el('label', 'wa-sel');
            w.appendChild(el('span', '', t('f.wa.one.which')));
            const s = document.createElement('select');
            s.dataset.act = 'one-goal';
            s.dataset.key = key;
            s.dataset.focusKey = `sel-${key}`;
            for (const o of options(current)) s.appendChild(o);
            w.appendChild(s);
            return w;
        };
        const saveBlock = (box, key, specs, neededPerPay, labelText) => {
            const withOffer = splitOffer({ data, changes: [...scenario.changes, ...specs], neededPerPayCents: neededPerPay, today, until });
            const useSplit = !!(withOffer && pft.oneSplit[key]);
            // the selected option's own Splurge cut stays part of the plan
            const cutPart = optionChanges({
                data, resolved: plan.resolved, existing: [...scenario.changes], option: { ...sel, earnedCents: 0 }, threeWays: null, items: model.splurgeItems,
                manualIds: st.manualTicks ? [...st.manualTicks] : null, today, until, neededPerPayCents: neededPerPay, withSplit: false,
            }).changes;
            const all = [...cutPart, ...specs.map((s) => ({ ...s, id: newChangeId([...scenario.changes, ...cutPart]) }))];
            if (useSplit) {
                const pool = [...scenario.changes, ...all];
                all.push(...addSplit(pool, withOffer));
            }
            if (withOffer) {
                box.appendChild(chk(t('f.wa.pft.split', {
                    smileFrom: `${withOffer.fromSmilePct}%`, smileTo: `${withOffer.smilePct}%`,
                    splurgeFrom: `${withOffer.fromSplurgePct}%`, splurgeTo: `${withOffer.splurgePct}%`,
                }), 'one-split', pft.oneSplit[key], { key, focusKey: `split-${key}` }));
            }
            const b = button(t('f.wa.one.save'), 'one-save', 'btn', { key });
            b.dataset.focusKey = `save-${key}`;
            box.appendChild(b);
            box.addEventListener('click', (e) => {
                if (e.target.closest('[data-act="one-save"]') === b) ctx.onSave(all, labelText);
            });
        };
        const card = (key, title) => {
            const box = el('div', 'wa-one');
            box.dataset.one = key;
            box.appendChild(el('h5', '', title));
            return box;
        };

        // 1. push a date
        const pushId = goals.some((g) => g.id === pft.pushGoal) ? pft.pushGoal : (plan.bindingGoalId || goals[goals.length - 1].id);
        const push = card('push', t('f.wa.one.push'));
        push.appendChild(goalSelect('push', pushId));
        const pd = pushDate({ plan, payDates: model.payDates, today, goalId: pushId, cutCents: cut });
        if (sel.earnedCents <= 0) push.appendChild(el('p', 'muted', t('f.wa.one.noneNeeded')));
        else if (!pd) push.appendChild(el('p', 'muted', t('f.wa.one.pushNo')));
        else {
            push.appendChild(el('p', '', t('f.wa.one.pushYes', { name: pd.name || t('f.wa.one.unnamed'), from: dayLong(pd.from, today), to: dayLong(pd.to, today), cut: money(cut) })));
            saveBlock(push, 'push', [pd.spec], pd.preview.requiredPerPayCents, t('f.wa.one.label.push'));
        }
        sub.appendChild(push);

        // 2. fund one after another
        const order = card('order', t('f.wa.one.order'));
        const fo = fundInOrder({ plan, payDates: model.payDates, today, cutCents: cut });
        if (!fo) order.appendChild(el('p', 'muted', t('f.wa.one.orderNo')));
        else {
            const ol = el('ol', 'wa-order');
            for (const r of fo.goalFund) {
                ol.appendChild(el('li', '', r.state === 'covered' ? t('f.wa.one.orderCovered', { name: r.name }) : t('f.wa.one.orderRow', { name: r.name, date: dayLong(r.landing, today), due: dayLong(r.due, today) })));
            }
            order.appendChild(ol);
            if (!fo.anyLate) order.appendChild(el('p', 'muted', t('f.wa.one.noneNeeded')));
            else saveBlock(order, 'order', fo.specs, fo.preview.requiredPerPayCents, t('f.wa.one.label.order'));
        }
        sub.appendChild(order);

        // 3. drop or shrink
        const dropId = goals.some((g) => g.id === pft.dropGoal) ? pft.dropGoal : (plan.bindingGoalId || goals[goals.length - 1].id);
        const drop = card('drop', t('f.wa.one.drop'));
        drop.appendChild(goalSelect('drop', dropId));
        const dr = dropGoal({ plan, payDates: model.payDates, today, goalId: dropId });
        const sh = shrinkGoal({ plan, payDates: model.payDates, today, goalId: dropId, cutCents: cut });
        if (sel.earnedCents <= 0) drop.appendChild(el('p', 'muted', t('f.wa.one.noneNeeded')));
        else {
            if (sh) {
                drop.appendChild(el('p', '', t('f.wa.one.shrinkYes', { name: sh.name, from: money(sh.fromCents), to: money(sh.toCents) })));
                saveBlock(drop, 'shrink', [sh.spec], sh.preview.requiredPerPayCents, t('f.wa.one.label.shrink'));
            } else drop.appendChild(el('p', 'muted', t('f.wa.one.shrinkNo')));
            if (dr) {
                const fitsDrop = dr.preview.gapCents <= cut;
                drop.appendChild(el('p', '', t(fitsDrop ? 'f.wa.one.dropYes' : 'f.wa.one.dropPart', { name: dr.name })));
                saveBlock(drop, 'drop', [dr.spec], dr.preview.requiredPerPayCents, t('f.wa.one.label.drop'));
            }
        }
        sub.appendChild(drop);
        sec.appendChild(sub);
    }
    parent.appendChild(sec);
    return sec;
}

export { BIG_CUT_SHARE };
