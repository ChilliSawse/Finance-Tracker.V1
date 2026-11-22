// Plan screen buckets section (owner: E6, plan section 6). Mounted into #plan-buckets by A9a.
// Every figure comes from the engine (getBuckets, suggestSplit, fireStatus, mojoSteps, smilePlan,
// housingCheck, transfersToUpdate); nothing is typed in. Colours come from the slot classes
// (.k1 to .k10, .kN-s1 to -s3, .p-bar.kN) and tokens only. All data is escaped (esc / escNum).
// Writes go through the E5 state API, which hands back an undo payload for showUndoToast.
//
// Shape: buildBucketsModel(data, today, ctx) and buildBucketsHtml(model, ui) are pure (no DOM);
// dispatchBucketAction(data, action, args, ctx) is the pure part of every click; mountBuckets
// wires them to the page. Sheets: E7's openBucketSheet(kind, id) first, else a small D1 sheet.

import './plan-buckets.css'; // E6 — Plan buckets section
import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import {
    getBuckets, applySuggestedSplit, setSplit, forkOwnTemplate, switchBackToBase, addBucket, relinkCategory,
    tickTransfer, moveTarget, skipTarget, removeTarget, addTarget, applyCashToTarget, setMojo, addGoal, updateGoal,
    setGoalShares, setAutoCredit,
} from '../state/saving-model.js';
import { BUCKET_METHOD, suggestSplit, fitSuggestionToRoom, checkTemplateBounds, canReturnToBase } from '../calc/saving-model.js';
import { fireStatus, mojoLivingCosts, mojoSteps, payoffPays, MOJO_STARTER_CENTS } from '../calc/fire.js';
import { smilePlan, suggestGoalShares, housingCheck, transfersToUpdate } from '../calc/smile.js';
import { planTotals, netPerPayCents, effectiveBucket } from '../calc/plan.js';
import { getCycle, nextPayDates, toIso, parseIso } from '../calc/pay-cycle.js';
import { formatCurrency } from '../utils.js';
import { todayModel } from '../state/today-model.js';
import { esc, escNum } from './html.js';
import { openSheet } from './sheet.js';
import { showUndoToast, showToast } from './toast.js';
import { openBucketSheet } from './bucket-sheets.js';

// ---------- small helpers ----------

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const money = (cents) => formatCurrency(num(cents) / 100);
const moneyWhole = (cents) => formatCurrency(num(cents) / 100, undefined, 0);
const pctText = (x) => `${Math.round(num(x) * 10) / 10}%`;
const clamp01 = (x) => Math.max(0, Math.min(1, num(x)));
const dayLong = (iso) => {
    const d = parseIso(iso);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
};
const slotOf = (b) => Math.max(1, Math.min(10, num(b && b.slot) || 1));
const toneClass = (slot, shade) => `k${slot}${shade > 0 ? `-s${Math.min(3, shade)}` : ''}`;

/** t() with every param escaped: for text nodes. */
function T(key, params) {
    const p = {};
    Object.keys(params || {}).forEach((k) => { p[k] = esc(params[k]); });
    return t(key, p);
}
/** Fully escaped t(): for attribute values. */
const A = (key, params) => esc(t(key, params));

// ---------- the model (pure) ----------

function sourceOf(d) {
    const s = Array.isArray(d.incomeSources) ? d.incomeSources : [];
    return s[d.primaryIncomeIndex || 0] || s[0] || null;
}

function categoriesIn(d, bucketId) {
    return (Array.isArray(d.categories) ? d.categories : [])
        .filter((c) => c && c.id && c.id !== 'income' && c.id !== 'transfer' && c.kind !== 'income')
        .filter((c) => effectiveBucket({ amountCents: -1 }, c, null, d.allocation) === bucketId)
        .map((c) => ({ id: c.id, name: c.name || c.id, explicit: c.bucketId === bucketId }));
}

const FOUR = ['daily', 'splurge', 'smile', 'fire'];

function nudgeOf(sm, rows, s) {
    if (!s || s.overspent) return null;
    const stored = (role) => num((rows.find((r) => r.role === role) || {}).pct);
    const far = Math.abs(stored('daily') - s.daily) >= 0.5 || Math.abs(stored('splurge') - s.splurge) >= 0.5;
    if (!far) return null;
    const dm = sm.splitNudge && sm.splitNudge.dismissedAt;
    if (isObj(dm) && Math.abs(num(dm.daily) - s.daily) < 0.5 && Math.abs(num(dm.splurge) - s.splurge) < 0.5) return null;
    return { daily: s.daily, splurge: s.splurge, smile: s.smile, fire: s.fire };
}

function targetRow(tg, ctx) {
    const { d, st, firePerPay, paysPerYear, payDates, ladder, mojoBal } = ctx;
    const lib = tg.type === 'debt' ? (d.liabilities || []).find((l) => l && String(l.id) === String(tg.liabilityId)) : null;
    const rate = lib ? num(lib.interestRate) : 0;
    const row = { id: tg.id, type: tg.type, label: tg.label || '', state: tg.state, skip: !!tg.skip, progress: tg.progress, rate, removable: tg.type === 'saver' };
    if (tg.type === 'debt') { row.remainingCents = num(tg.remainingCents); row.rate = rate; }
    if (tg.type === 'mojo') { row.nowCents = mojoBal; row.targetCents = num(ladder.targetCents); }
    if (tg.type === 'home' || tg.type === 'saver') { row.savedCents = num(tg.savedCents); row.goalCents = num(tg.goalCents); }
    if (tg.type === 'super') row.savedCents = num(tg.savedCents);
    if (tg.id === st.activeId && tg.type === 'debt') {
        const pays = payoffPays(row.remainingCents, rate, firePerPay, paysPerYear);
        row.pays = pays;
        row.doneOn = Number.isFinite(pays) && pays > 0 ? payDates[pays - 1] || null : null;
    }
    return row;
}

/**
 * The whole section as plain data. Returns null when there is no saving model or no buckets yet.
 * ctx: {leftByBucket: {id: cents}} (Today's "left this pay", optional).
 */
export function buildBucketsModel(data, today, ctx = {}) {
    const d = data;
    const sm = d && d.savingModel;
    if (!sm || !Array.isArray(d.allocation) || !d.allocation.length) return null;
    let net = 0;
    try { net = Math.max(0, netPerPayCents(d)); } catch (e) { net = 0; }
    let pt = { essentialPerCycle: 0, nonEssentialPerCycle: 0, cyclesPerYear: 26 };
    try { pt = planTotals(d); } catch (e) { /* keeps the zeros */ }
    const source = sourceOf(d);
    let cycle = { cyclesPerYear: 26, mode: 'month' };
    let payDates = [];
    try { if (source) { cycle = getCycle(source, today); payDates = nextPayDates(source, today, 80); } } catch (e) { /* month mode */ }
    const paysPerYear = pt.cyclesPerYear || cycle.cyclesPerYear || 26;
    const all = getBuckets(d, today);
    const tops = all.filter((b) => !b.parentId);
    const goalsAll = all.filter((b) => b.kind === 'goal');
    const rawGoals = new Map((Array.isArray(d.bucketGoals) ? d.bucketGoals : []).filter(isObj).map((g) => [String(g.id), g]));
    const custom = typeof sm.id === 'string' && sm.id.startsWith('custom-');
    const rules = sm.rules || BUCKET_METHOD.rules;

    const suggestion = net > 0 ? suggestSplit({
        netCents: net, essentialCents: Math.round(num(pt.essentialPerCycle) * 100),
        nonEssentialCents: Math.round(num(pt.nonEssentialPerCycle) * 100), rules,
    }) : null;
    const linkable = tops.filter((b) => b.role !== 'mojo' && b.role !== 'grow' && (b.kind === 'spend' || b.kind === 'save'));
    const left = ctx.leftByBucket || {};
    const tiles = tops.filter((b) => b.role !== 'mojo' && b.role !== 'grow').map((b) => ({
        id: b.id, role: b.role, slot: slotOf(b), name: b.name, pct: b.pct, perPayCents: b.perPayCents, balanceCents: b.balanceCents,
        kind: b.kind, leftCents: b.kind === 'spend' && Number.isFinite(left[b.id]) ? left[b.id] : null,
        cats: categoriesIn(d, b.id),
    }));
    const mojoRow = tops.find((b) => b.role === 'mojo') || null;
    const fireRow = tops.find((b) => b.role === 'fire') || null;
    const smileRow = tops.find((b) => b.role === 'smile') || null;

    // Mojo ladder (the same planned living costs getBuckets uses).
    const living = mojoLivingCosts({
        essentialPerPayCents: Math.round(num(pt.essentialPerCycle) * 100), cyclesPerYear: pt.cyclesPerYear || 26,
        basis: (sm.mojo && sm.mojo.basis) || 'auto',
    });
    const mojoBal = mojoRow ? mojoRow.balanceCents : 0;
    const ladder = mojoSteps(sm.mojo || {}, living, mojoBal);
    const mojo = mojoRow ? {
        balanceCents: mojoBal, activeCents: ladder.active ? ladder.active.amountCents : null, progressPct: ladder.progressPct,
        complete: ladder.complete, basis: living.basis,
        steps: ladder.steps.map((s) => ({ id: s.id, kind: s.kind, amountCents: s.amountCents, reached: mojoBal >= s.amountCents, active: !!ladder.active && ladder.active.id === s.id })),
        months: num(sm.mojo && sm.mojo.months == null ? 3 : sm.mojo && sm.mojo.months),
    } : null;

    // Fire extinguisher.
    let fire = null;
    const targets = sm.fire && Array.isArray(sm.fire.targets) ? sm.fire.targets : null;
    if (fireRow && targets) {
        const st = fireStatus(targets, d.liabilities, { balanceCents: mojoBal, targetCents: ladder.targetCents });
        const tctx = { d, st, firePerPay: fireRow.perPayCents, paysPerYear, payDates, ladder, mojoBal };
        const rows = st.targets.map((tg) => targetRow(tg, tctx));
        const cashCents = Math.max(0, fireRow.balanceCents);
        const active = rows.find((r) => r.id === st.activeId) || null;
        const usedDebts = new Set(targets.filter((x) => x && x.type === 'debt').map((x) => String(x.liabilityId)));
        fire = {
            pct: fireRow.pct, slot: slotOf(fireRow), rows, active, free: st.free, note: st.note, cashCents: active ? cashCents : 0,
            freeDebts: (Array.isArray(d.liabilities) ? d.liabilities : []).filter((l) => l && l.id != null && !usedDebts.has(String(l.id)) && num(l.balance) > 0)
                .map((l) => ({ id: String(l.id), name: l.name || '' })),
        };
    }

    // Goals (Smile always; another bucket only once it has goals).
    const groups = [];
    tops.forEach((parent) => {
        const kids = goalsAll.filter((g) => g.parentId === parent.id);
        if (!kids.length && parent.role !== 'smile') return;
        const items = kids.map((g) => {
            const raw = rawGoals.get(g.id) || {};
            const descendants = [];
            const walk = (pid, prefix) => goalsAll.filter((x) => x.parentId === pid).forEach((x) => {
                descendants.push({ id: x.id, name: `${prefix}${x.name}`, slot: slotOf(x), shade: x.shade || 1, saved: x.balanceCents, goalCents: x.goal || 0 });
                walk(x.id, `${prefix}${x.name} › `);
            });
            walk(g.id, `${g.name} › `);
            const share = num(raw.share);
            const plan = g.goal ? smilePlan({ costCents: g.goal, savedCents: g.balanceCents, due: raw.due || null,
                smilePerPayCents: parent.perPayCents, sharePct: share, payDates, today }) : null;
            return { id: g.id, name: g.name, slot: slotOf(g), shade: g.shade || 0, share, perPayCents: g.perPayCents, savedCents: g.balanceCents,
                costCents: g.goal || 0, due: raw.due || null, plan, kids: descendants };
        });
        let hint = null;
        if (parent.role === 'smile' && items.length > 1) {
            const sg = suggestGoalShares({
                goals: items.filter((i) => i.costCents > 0).map((i) => ({ id: i.id, name: i.name, costCents: i.costCents, savedCents: i.savedCents, due: i.due, share: i.share })),
                smilePerPayCents: parent.perPayCents, payDates, today, netCents: net,
            });
            if (sg && sg.kind === 'move') {
                const nameOf = (id) => (items.find((i) => i.id === id) || {}).name || '';
                hint = { kind: 'move', moves: sg.moves.map((m) => ({ pct: m.pct, from: nameOf(m.fromId), to: nameOf(m.toId) })), shares: sg.shares };
            } else if (sg && sg.kind === 'raise') hint = { kind: 'raise', neededPerPayCents: sg.neededPerPayCents, smilePct: sg.smilePct };
        }
        groups.push({
            id: parent.id, name: parent.name, slot: slotOf(parent), role: parent.role, perPayCents: parent.perPayCents,
            savedCents: parent.balanceCents, costCents: items.reduce((a, i) => a + i.costCents, 0), items, hint,
        });
    });

    const xf = transfersToUpdate({ allocation: d.allocation, netCents: net, bankSetTo: sm.transfers && sm.transfers.bankSetTo });
    const mig = isObj(sm.migration) ? sm.migration : null;
    const bounds = checkTemplateBounds(BUCKET_METHOD.rules, d.allocation, d.bucketGoals);
    const unmapped = mig && Array.isArray(mig.unmapped) ? mig.unmapped.map((u) => (typeof u === 'string' ? u : u && u.name ? u.name : '')).filter(Boolean) : [];

    return {
        today, netCents: net, freq: source && source.paySchedule ? String(source.paySchedule) : '',
        template: { custom, name: sm.name || BUCKET_METHOD.name, after: sm.after || null, baseName: BUCKET_METHOD.name, coreCount: (rules.coreBuckets || BUCKET_METHOD.rules.coreBuckets).length },
        canReturn: custom && canReturnToBase(sm, d.allocation, d.bucketGoals),
        whyNot: custom ? [...new Set(bounds.violations.map((v) => v.code))] : [],
        tiles, linkable: linkable.map((b) => ({ id: b.id, name: b.name, slot: slotOf(b) })),
        hasMojo: !!mojoRow, hasGrow: true,
        suggestion, nudge: nudgeOf(sm, tops, fitSuggestionToRoom(suggestion, num(d.allocation.filter((r) => r && !FOUR.includes(r.role)).reduce((a, r) => a + num(r.percentage), 0)))),
        guide: BUCKET_METHOD.guide,
        firstRun: mig && !mig.cardDismissed ? { outcome: mig.outcome === 'own' ? 'own' : 'template', unmapped, autoOn: !!(sm.autoCredit && sm.autoCredit.on) } : null,
        transfers: xf, fire, mojo, groups,
        housing: housingCheck({ plan: d.plan, netPerPayCents: net, cyclesPerYear: paysPerYear }),
    };
}

// ---------- the HTML (pure) ----------

function suggestParts(s) {
    return [['daily', t('e.plan.suggestDaily')], ['splurge', t('e.plan.suggestSplurge')], ['smile', t('e.plan.suggestSmile')], ['fire', t('e.plan.suggestFire')]]
        .map(([k, label]) => `${label} ${pctText(s[k])}`).join(', ');
}

function chipsHtml(tile, model, ui) {
    if (!tile.cats.length) return `<div class="pb-cats"><span class="pb-cats-none">${esc(t('e.plan.catsNone'))}</span></div>`;
    const open = !!(ui.expanded && ui.expanded[tile.id]);
    const limit = 4;
    const shown = open ? tile.cats : tile.cats.slice(0, limit);
    const chips = shown.map((c) => `<button type="button" class="pb-chip${c.explicit ? ' is-linked' : ''}" data-pb="chip" data-cat="${esc(c.id)}" aria-expanded="${ui.moving === c.id ? 'true' : 'false'}" aria-label="${A('e.plan.catMove', { name: c.name })}" title="${A('e.plan.catMove', { name: c.name })}">${esc(c.name)}</button>`).join('');
    const extra = tile.cats.length - limit;
    const more = extra > 0 ? `<button type="button" class="pb-chip pb-more" data-pb="more-cats" data-id="${esc(tile.id)}">${esc(open ? t('e.plan.catFewer') : t('e.plan.catMore', { n: extra }))}</button>` : '';
    let move = '';
    const moving = ui.moving && tile.cats.find((c) => c.id === ui.moving);
    if (moving) {
        const targets = model.linkable.filter((b) => b.id !== tile.id)
            .map((b) => `<button type="button" class="pb-mv ${toneClass(b.slot, 0)}" data-pb="move-cat" data-cat="${esc(moving.id)}" data-bucket="${esc(b.id)}">${esc(b.name)}</button>`).join('');
        const follow = moving.explicit ? `<button type="button" class="pb-mv pb-mv-plain" data-pb="move-cat" data-cat="${esc(moving.id)}" data-bucket="">${esc(t('e.plan.catFollow'))}</button>` : '';
        move = `<div class="pb-move" role="group" aria-label="${A('e.plan.catMoveTo', { name: moving.name })}"><span class="pb-move-l">${T('e.plan.catMoveTo', { name: moving.name })}</span>${targets}${follow}<button type="button" class="pb-mv pb-mv-plain" data-pb="chip" data-cat="${esc(moving.id)}">${esc(t('e.plan.catCancel'))}</button></div>`;
    }
    return `<div class="pb-cats"><span class="pb-cats-l">${T('e.plan.cats', { bucket: tile.name })}</span><div class="pb-chips">${chips}${more}</div>${move}</div>`;
}

function tilesHtml(m, ui) {
    return `<ul class="pb-tiles">${m.tiles.map((b) => {
        const balLine = b.leftCents !== null
            ? T('e.plan.leftThisPay', { amount: money(b.leftCents) })
            : T('e.plan.balance', { amount: money(b.balanceCents) });
        return `<li class="pb-tile ${toneClass(b.slot, 0)}" data-bucket="${esc(b.id)}">
            <button type="button" class="pb-nm pb-linkbtn" data-pb="bucket-open" data-id="${esc(b.id)}" aria-label="${A('e.plan.bucketOpenAria', { name: b.name })}">${esc(b.name)}</button><span class="pb-pc num">${esc(pctText(b.pct))}</span>
            <span class="pb-pp money">${T('e.plan.perPay', { amount: money(b.perPayCents) })}</span>
            <span class="pb-bal">${balLine}</span>${chipsHtml(b, m, ui)}</li>`;
    }).join('')}</ul>`;
}

function splitBarHtml(m) {
    const live = m.tiles.filter((b) => b.pct > 0);
    const label = live.map((b) => `${b.name} ${pctText(b.pct)}`).join(', ');
    const spans = live.map((b) => `<span class="${toneClass(b.slot, 0)}" style="flex:${escNum(b.pct)}">${b.pct >= 14 ? `${esc(b.name)} ` : ''}${esc(pctText(b.pct))}</span>`).join('');
    return `<div class="pb-split" role="img" aria-label="${A('e.plan.splitAria', { parts: label })}">${spans}</div>`;
}

function firstRunHtml(m) {
  const f = m.firstRun;
  if (!f) return '';
  const body = f.outcome === 'own' ? T('e.plan.firstOwn', { name: m.template.baseName }) : T('e.plan.firstTemplate', { name: m.template.baseName });
  const un = f.unmapped.length ? ` ${T('e.plan.firstUnmapped', { names: f.unmapped.join(', ') })}` : '';
  return `<section class="card pb-card pb-first" aria-labelledby="pb-h-first">
    <div class="pb-first-head"><h3 id="pb-h-first">${esc(t('e.plan.firstTitle'))}</h3><button type="button" class="link small" data-pb="card-dismiss">${esc(t('e.plan.dismiss'))}</button></div>
    <p>${body}${un}</p>
    <div class="pb-ask"><b>${esc(t('e.plan.autoQ'))}</b><p>${esc(t('e.plan.autoBody'))}</p>
    <div class="pb-acts"><button type="button" class="btn sm primary" data-pb="auto-yes">${esc(t('e.plan.autoYes'))}</button><button type="button" class="btn sm" data-pb="auto-no">${esc(t('e.plan.autoNo'))}</button></div></div>
  </section>`;
}

function ownCardHtml(m) {
    if (!m.template.custom) return '';
    const base = m.template.baseName;
    const state = m.canReturn
        ? `<p>${T('e.plan.switchReady', { name: base })}</p><div class="pb-acts"><button type="button" class="btn sm primary" data-pb="switch-back">${esc(t('e.plan.switchBack'))}</button></div>`
        : `<p>${T('e.plan.switchWhy', { name: base, reasons: m.whyNot.map((c) => t(`e.plan.why.${c}`)).join(', ') || '-' })}</p>`;
    return `<div class="pb-owncard"><h3 class="pb-h4">${esc(t('e.plan.ownCardTitle'))}</h3><p>${T('e.plan.ownCardBody', { name: base })}</p>${state}</div>`;
}

function addBucketHtml(m, ui) {
    if (m.template.custom) return `<div class="pb-own"><button type="button" class="pb-addbtn" data-pb="add-bucket">${esc(t('e.plan.addBucket'))}</button></div>`;
    return `<details class="pb-own"${ui.ownOpen ? ' open' : ''}><summary>${esc(t('e.plan.addBucket'))}</summary>
        <div class="pb-box"><div><h3 class="pb-h4">${esc(t('e.plan.ownTitle'))}</h3><p>${T('e.plan.ownBody', { name: m.template.baseName, n: m.template.coreCount })}</p></div>
        <div class="pb-acts"><button type="button" class="btn sm primary" data-pb="make-mine">${esc(t('e.plan.makeMine'))}</button><button type="button" class="btn sm" data-pb="goal-add" data-parent="${esc((m.groups.find((g) => g.role === 'smile') || {}).id || '')}">${esc(t('e.plan.goalInstead'))}</button></div></div></details>`;
}

function mainCardHtml(m, ui) {
    const tp = m.template;
    const who = tp.custom ? t('e.plan.tplOwnBased', { name: tp.name, base: tp.baseName }) : (tp.after ? t('e.plan.tplAfter', { name: tp.name, after: tp.after }) : tp.name);
    const nudge = m.nudge ? `<div class="pb-nudge" role="status"><span>${T('e.plan.nudge', { parts: suggestParts(m.nudge) })}</span>
        <span class="pb-acts"><button type="button" class="btn sm primary" data-pb="use-suggested">${esc(t('e.plan.useThese'))}</button><button type="button" class="btn sm" data-pb="dismiss-nudge">${esc(t('e.plan.notNow'))}</button></span></div>` : '';
    const guide = BUCKET_METHOD.guide;
    const guideText = [guide.daily, guide.splurge, guide.smile, guide.fire].join(' · ');
    const sug = m.suggestion && !m.suggestion.overspent
        ? `<span>${T('e.plan.suggestLine', { parts: suggestParts(m.suggestion), guide: guideText })}</span>`
        : (m.suggestion ? `<span>${esc(t('e.plan.overspent'))}</span>` : '');
    const pay = m.netCents > 0 ? `<span>${T('e.plan.payLine', { amount: `${money(m.netCents)}`, freq: m.freq || '' }).replace(/ · $/, '')}</span>` : '';
    const extras = `<div class="pb-extra">${m.hasMojo ? `<div><span class="pb-tag k5">${esc(mojoName(m))}</span><span>${esc(t('e.plan.mojoTag'))}</span></div>` : ''}
        <div><span class="pb-tag k6">${esc(t('e.plan.growName'))}</span><span>${esc(t('e.plan.growTag'))}</span></div></div>`;
    return `<section class="card pb-card ${m.transfers.length ? 'pb-s8' : 'pb-s12'}" aria-labelledby="pb-h-split">
        <div class="pb-model"><div class="pb-who"><span>${esc(t('e.plan.tplLabel'))}</span><b id="pb-h-split">${esc(who)}</b></div>
        <div class="pb-acts"><button type="button" class="btn sm" data-pb="change-template">${esc(t('e.plan.change'))}</button><button type="button" class="btn sm primary" data-pb="edit-split">${esc(t('e.plan.editSplit'))}</button></div></div>
        ${ownCardHtml(m)}${nudge}${splitBarHtml(m)}${tilesHtml(m, ui)}${extras}
        <div class="pb-suggest">${sug}${pay}</div>${addBucketHtml(m, ui)}</section>`;
}

function mojoName() { return t('e.plan.mojoTitle'); }

function transfersHtml(m) {
    if (!m.transfers.length) return '';
    const todo = m.transfers.filter((r) => !r.informational).length;
    const rows = m.transfers.map((r) => {
        const detail = r.informational ? t('e.plan.xferStays') : (r.bankLabel || t('e.plan.xferNew'));
        const was = !r.informational && r.wasCents !== null && r.wasCents !== r.nowCents ? `<span class="was">${esc(money(r.wasCents))}</span>` : '';
        return `<li><label><input class="pb-tickbox" type="checkbox" data-pb="tick" data-id="${esc(r.bucketId)}"${r.informational ? ' checked disabled' : ''} aria-label="${A('e.plan.xferTick', { name: r.name })}">
            <span><span class="n">${esc(r.name)}</span><span class="d">${esc(detail)}</span></span><span class="money">${was}${esc(r.wasCents === null && !r.nowCents ? t('e.plan.xferNewTag') : money(r.nowCents))}</span></label></li>`;
    }).join('');
    return `<section class="card pb-card pb-xfer pb-s4" aria-labelledby="pb-h-xfer">
        <div class="pb-head"><h3 id="pb-h-xfer">${esc(t('e.plan.xferTitle'))}</h3>${todo ? `<span class="pill due">${T('e.plan.xferTodo', { n: todo })}</span>` : ''}</div>
        <p class="pb-lead">${esc(t('e.plan.xferLead'))}</p><ul class="pb-ticks">${rows}</ul>
        <div class="pb-foot"><span>${esc(t('e.plan.xferFoot'))}${m.freq ? `: ${esc(m.freq)}` : ''}</span><button type="button" class="link small" data-pb="tick-all">${esc(t('e.plan.xferDone'))}</button></div></section>`;
}

function targetDetail(r, activeId) {
    const working = r.id === activeId ? ` · ${t('e.plan.fireWorking')}` : '';
    let d = '';
    if (r.type === 'debt') d = t('e.plan.fireDebtLine', { amount: money(r.remainingCents), rate: pctText(r.rate) });
    else if (r.type === 'mojo') d = r.targetCents > 0 ? t('e.plan.fireMojoLine', { target: moneyWhole(r.targetCents), now: moneyWhole(r.nowCents) }) : t('e.plan.mojoDStarter');
    else if (r.type === 'home') d = r.goalCents > 0 ? t('e.plan.fireHomeGoal', { saved: money(r.savedCents), goal: money(r.goalCents) }) : t('e.plan.fireHome');
    else if (r.type === 'super') d = t('e.plan.fireSuper');
    else d = r.goalCents > 0 ? t('e.plan.fireSaver', { saved: money(r.savedCents), goal: money(r.goalCents) }) : t('e.plan.fireSaverOpen', { saved: money(r.savedCents) });
    const state = r.state === 'skipped' ? ` · ${t('e.plan.fireSkipped')}` : r.state === 'done' ? ` · ${t('e.plan.fireDoneState')}` : '';
    return esc(d + working + state);
}

function fireNowHtml(f) {
    const a = f.active;
    if (!a) return `<div class="pb-now ${toneClass(f.slot, 0)}"><div class="pb-top"><span class="lbl">${esc(t('e.plan.fireFree'))}</span></div></div>`;
    let value = '';
    let sub1 = '';
    let sub2 = '';
    if (a.type === 'debt') {
        value = t('e.plan.fireToGo', { amount: money(a.remainingCents) });
        sub1 = t('e.plan.firePaid', { pct: pctText(clamp01(a.progress) * 100), rate: pctText(a.rate) });
        if (a.pays === Infinity) sub2 = t('e.plan.fireNever');
        else if (a.doneOn) sub2 = t('e.plan.fireDone', { date: dayLong(a.doneOn), n: a.pays });
        else if (a.pays > 0) sub2 = t('e.plan.fireDoneNoDate', { n: a.pays });
    } else if (a.type === 'mojo') value = t('e.plan.fireOf', { saved: money(a.nowCents), goal: money(a.targetCents) });
    else if (a.type === 'home' || a.type === 'saver') value = a.goalCents > 0 ? t('e.plan.fireOf', { saved: money(a.savedCents), goal: money(a.goalCents) }) : t('e.plan.fireSaverOpen', { saved: money(a.savedCents) });
    else value = t('e.plan.fireSaverOpen', { saved: money(a.savedCents) });
    const p = a.progress === null || a.progress === undefined ? null : clamp01(a.progress);
    const bar = p === null ? '' : `<div class="p-bar pb-bar" role="img" aria-label="${A('e.plan.fireBarAria', { pct: pctText(p * 100), name: a.label })}"><i style="width:${escNum(Math.round(p * 1000) / 10)}%"></i></div>`;
    return `<div class="pb-now ${toneClass(f.slot, 0)}"><div class="pb-top"><span class="lbl">${T('e.plan.fireNow', { name: a.label })}</span><span class="v money">${esc(value)}</span></div>${bar}
        <div class="pb-sub"><span>${esc(sub1)}</span><span>${esc(sub2)}</span></div></div>`;
}

function fireHtml(m) {
    const f = m.fire;
    if (!f) return '';
    const last = f.rows.length - 1;
    const items = f.rows.map((r, i) => `<li class="${r.id === (f.active && f.active.id) ? 'on' : ''}${r.skip ? ' skip' : ''}"><span class="ord">${i + 1}</span>
        <div><div class="n">${esc(r.label)}</div><div class="d">${targetDetail(r, f.active && f.active.id)}</div></div>
        <div class="ctl"><button type="button" class="pb-mvb" data-pb="fire-up" data-id="${esc(r.id)}" aria-label="${A('e.plan.fireUp', { name: r.label })}"${i === 0 ? ' disabled' : ''}><span aria-hidden="true">↑</span></button>
        <button type="button" class="pb-mvb" data-pb="fire-down" data-id="${esc(r.id)}" aria-label="${A('e.plan.fireDown', { name: r.label })}"${i === last ? ' disabled' : ''}><span aria-hidden="true">↓</span></button>
        <button type="button" class="link small" data-pb="fire-skip" data-id="${esc(r.id)}" data-skip="${r.skip ? '0' : '1'}" aria-label="${A(r.skip ? 'e.plan.fireUnskipAria' : 'e.plan.fireSkipAria', { name: r.label })}">${esc(t(r.skip ? 'e.plan.fireUnskip' : 'e.plan.fireSkip'))}</button>
        ${r.removable ? `<button type="button" class="link small" data-pb="fire-edit" data-id="${esc(r.id)}" aria-label="${A('e.plan.fireEditAria', { name: r.label })}">${esc(t('e.plan.fireEdit'))}</button><button type="button" class="link small" data-pb="fire-remove" data-id="${esc(r.id)}" aria-label="${A('e.plan.fireRemoveAria', { name: r.label })}">${esc(t('e.plan.fireRemove'))}</button>` : ''}</div></li>`).join('');
    const cash = f.cashCents > 0 ? `<div class="pb-hint"><span>${T('e.plan.fireCash', { amount: money(f.cashCents), name: f.active.label })}</span><button type="button" class="btn sm" data-pb="fire-cash">${esc(t('e.plan.fireCashBtn'))}</button></div>` : '';
    const note = f.note ? `<p class="pb-note">${T('e.plan.fireMojoNote', { starter: moneyWhole(MOJO_STARTER_CENTS) })}</p>` : '';
    const debtBtn = f.freeDebts.length ? `<button type="button" class="link small" data-pb="fire-add-debt">${esc(t('e.plan.fireAddDebt'))}</button>` : '';
    return `<section class="card pb-card pb-s7" id="pb-fire" aria-labelledby="pb-h-fire">
        <div class="pb-head"><div><h3 id="pb-h-fire">${esc(t('e.plan.fireTitle'))}</h3><p>${T('e.plan.fireSub', { pct: pctText(f.pct) })}</p></div><span class="pb-tag ${toneClass(f.slot, 0)}">${esc(t('e.plan.fireTitle'))}</span></div>
        ${fireNowHtml(f)}${cash}<ol class="pb-targets" aria-label="${A('e.plan.fireListAria')}">${items}</ol>${note}
        <div class="pb-foot"><span>${esc(t('e.plan.fireAutoMove'))}</span><span class="pb-acts"><button type="button" class="link small" data-pb="fire-add-pot">${esc(t('e.plan.fireAddPot'))}</button>${debtBtn}</span></div></section>`;
}

function mojoHtml(m) {
    const o = m.mojo;
    if (!o) return '';
    const stepLabel = (s) => (s.kind === 'starter' ? t('e.plan.mojoStarter') : s.kind === 'custom' ? t('e.plan.mojoYours') : t('e.plan.mojoMonths', { n: Math.round(num(m.mojo.months) * 10) / 10 }));
    const stepNote = (s) => (s.reached ? t('e.plan.mojoDReached') : s.kind === 'custom' ? t('e.plan.mojoDYours') : s.kind === 'months' ? t('e.plan.mojoDPlanned') : t('e.plan.mojoDStarter'));
    const steps = o.steps.map((s) => `<li class="${s.reached ? 'done' : s.active ? 'on' : ''}"><span class="dot" aria-hidden="true"></span><span><span class="n">${esc(stepLabel(s))}</span> <span class="d">· ${esc(stepNote(s))}</span></span><span class="money">${esc(moneyWhole(s.amountCents))}</span></li>`).join('');
    const pct = pctText(o.progressPct);
    const of = o.complete ? t('e.plan.mojoDone') : t('e.plan.mojoOf', { step: moneyWhole(o.activeCents), pct });
    return `<section class="card pb-card pb-mojo" id="pb-mojo" aria-labelledby="pb-h-mojo">
        <div class="pb-head"><div><h3 id="pb-h-mojo">${esc(t('e.plan.mojoTitle'))}</h3><p>${esc(t('e.plan.mojoSub'))}</p></div><span class="pb-tag k5">${esc(t('e.plan.mojoTitle'))}</span></div>
        <div class="pb-fig"><span class="v money">${esc(money(o.balanceCents))}</span><span class="s">${esc(of)}</span></div>
        <div class="p-bar pb-bar k5" role="img" aria-label="${A('e.plan.mojoBarAria', { pct, step: o.activeCents ? moneyWhole(o.activeCents) : '' })}"><i style="width:${escNum(Math.min(100, num(o.progressPct)))}%"></i></div>
        <ol class="pb-ladder" aria-label="${A('e.plan.mojoLadderAria')}">${steps}</ol>
        <div class="pb-foot"><span>${esc(t('e.plan.mojoFoot'))}</span><button type="button" class="link small" data-pb="mojo-change">${esc(t('e.plan.mojoChange'))}</button></div></section>`;
}

function housingHtml(m) {
    const h = m.housing;
    if (!h) return '';
    const pct = pctText(h.pctOfTakeHome);
    const guide = `${h.guide}%`;
    const fill = Math.min(100, (h.pctOfTakeHome / 50) * 100);
    const mark = (h.guide / 50) * 100;
    const text = t(h.over ? 'e.plan.houseOver' : 'e.plan.houseUnder', { amount: money(h.perPayCents), pct, net: money(m.netCents), guide });
    return `<section class="card pb-card pb-house" aria-labelledby="pb-h-house">
        <div class="pb-head"><h3 id="pb-h-house">${esc(t('e.plan.houseTitle'))}</h3><span class="aside">${esc(t('e.plan.houseAside'))}</span></div>
        <div class="pb-big num">${esc(t('e.plan.houseBig', { pct }))} <span class="muted small">${esc(t('e.plan.houseOf'))}</span></div>
        <div class="pb-meter" role="img" aria-label="${A('e.plan.houseAria', { pct, guide })}"><i style="width:${escNum(Math.round(fill * 10) / 10)}%"></i><b style="left:${escNum(Math.round(mark * 10) / 10)}%"></b></div>
        <div class="pb-scale"><span>0%</span><span>${esc(t('e.plan.houseGuide', { guide }))}</span><span>50%</span></div>
        <p>${esc(text)}</p></section>`;
}

function goalWhen(g) {
    const p = g.plan;
    if (!p) return { left: '', right: '', cls: '' };
    const left = g.due ? t('e.plan.goalBy', { date: dayLong(g.due) }) : t('e.plan.goalNoDate');
    if (p.status === 'done') return { left, right: t('e.plan.goalDone'), cls: 'on-track' };
    if (p.status === 'impossible') return { left, right: t('e.plan.goalImpossible'), cls: 'late' };
    if (p.status === 'on-track') return { left, right: p.readyOn ? t('e.plan.goalOnTrack', { date: dayLong(p.readyOn) }) : t('e.plan.goalOnTrackNoDate'), cls: 'on-track' };
    if (p.status === 'late') {
        const days = num(p.lateDays);
        const late = days >= 14 ? t('e.plan.lateWeeks', { n: Math.round(days / 7) }) : t('e.plan.lateDays', { n: days });
        return { left, right: p.readyOn ? t('e.plan.goalLate', { late, date: dayLong(p.readyOn) }) : t('e.plan.goalLateNoDate'), cls: 'late' };
    }
    return { left: t('e.plan.goalNoDate'), right: p.readyOn ? t('e.plan.goalReady', { date: dayLong(p.readyOn) }) : '', cls: '' };
}

function hintHtml(g, m) {
    const h = g.hint;
    if (!h) return '';
    if (h.kind === 'move') {
        const moves = h.moves.map((x) => t('e.plan.hintMoveOne', { pct: pctText(x.pct), parent: g.name, from: x.from, to: x.to })).join(', ');
        return `<div class="pb-hint"><span>${T('e.plan.hintMove', { moves })}</span><button type="button" class="btn sm" data-pb="hint-apply" data-parent="${esc(g.id)}">${esc(t('e.plan.hintDo'))}</button></div>`;
    }
    const pct = h.smilePct !== null && h.smilePct !== undefined ? pctText(h.smilePct) : '';
    return `<div class="pb-hint"><span>${T('e.plan.hintRaise', { parent: g.name, amount: money(h.neededPerPayCents), pct })}</span><button type="button" class="btn sm" data-pb="edit-split">${esc(t('e.plan.hintEdit'))}</button></div>`;
}

function goalsHtml(g, m) {
    const sub = g.costCents > 0
        ? T('e.plan.smileSub', { saved: money(g.savedCents), cost: money(g.costCents), name: g.name, perPay: money(g.perPayCents) })
        : T('e.plan.smileSubNoCost', { saved: money(g.savedCents), name: g.name, perPay: money(g.perPayCents) });
    const items = g.items.map((i) => {
        const w = goalWhen(i);
        const p = i.costCents > 0 ? clamp01(i.savedCents / i.costCents) : null;
        const amt = i.costCents > 0 ? t('e.plan.goalOf', { saved: money(i.savedCents), cost: money(i.costCents) }) : t('e.plan.goalSaved', { saved: money(i.savedCents) });
        const bar = p === null ? '' : `<div class="p-bar pb-bar ${toneClass(i.slot, 0)}" role="img" aria-label="${A('e.plan.goalBarAria', { pct: pctText(p * 100) })}"><i style="width:${escNum(Math.round(p * 1000) / 10)}%"></i></div>`;
        const kids = i.kids.length ? `<ul class="pb-kids" aria-label="${A('e.plan.kidsAria', { name: i.name })}">${i.kids.map((k) => `<li class="${toneClass(k.slot, k.shade)}"><span><b>${esc(k.name)}</b></span><span class="money">${esc(k.goalCents > 0 ? t('e.plan.goalOf', { saved: money(k.saved), cost: money(k.goalCents) }) : money(k.saved))}</span></li>`).join('')}</ul>` : '';
        return `<li><div class="pb-goal"><span class="n"><button type="button" class="pb-linkbtn" data-pb="goal-open" data-id="${esc(i.id)}">${esc(i.name)}</button> <span class="muted small nw">${T('e.plan.goalShare', { pct: pctText(i.share), name: g.name, amount: money(i.perPayCents) })}</span></span>
            <span class="amt money">${esc(amt)}</span>${bar}<div class="when"><span>${esc(w.left)}</span><span class="${esc(w.cls)}">${esc(w.right)}</span></div></div>${kids}</li>`;
    }).join('');
    return `<section class="card pb-card pb-s12" id="pb-goals-${esc(g.id)}" aria-labelledby="pb-h-goals-${esc(g.id)}">
        <div class="pb-head"><div><h3 id="pb-h-goals-${esc(g.id)}">${T('e.plan.smileTitle', { name: g.name })}</h3><p>${sub}</p></div><span class="pb-tag ${toneClass(g.slot, 0)}">${esc(g.name)}</span></div>
        ${g.items.length ? `<ul class="pb-goals">${items}</ul>` : `<p class="pb-lead">${T('e.plan.goalNone', { name: g.name })}</p>`}
        ${hintHtml(g, m)}
        <div class="pb-foot"><span>${T('e.plan.goalFoot', { name: g.name })}</span><button type="button" class="link small" data-pb="goal-add" data-parent="${esc(g.id)}">${esc(t('e.plan.goalAdd'))}</button></div></section>`;
}

/** The section as an HTML string. ui: {moving, expanded:{bucketId:true}, ownOpen}. */
export function buildBucketsHtml(m, ui = {}) {
    if (!m) return '';
    const cards = [firstRunHtml(m), mainCardHtml(m, ui), transfersHtml(m), fireHtml(m)];
    const stack = [mojoHtml(m), housingHtml(m)].filter(Boolean).join('');
    if (stack) cards.push(`<div class="pb-stack pb-s5">${stack}</div>`);
    m.groups.forEach((g) => cards.push(goalsHtml(g, m)));
    return `<div class="pb" role="group" aria-label="${A('e.plan.aria')}"><div class="pb-grid">${cards.filter(Boolean).join('')}</div></div>`;
}

// ---------- actions (pure over the data) ----------

const keep = (d) => d.savingModel;

/**
 * One click, as data. Returns {res} (an E5 payload: ok, message, onUndo), {sheet:{kind,id,parent}}, {ui:{...}}
 * or {changed:true} for a plain write with no undo. Nothing here touches the DOM.
 */
export function dispatchBucketAction(data, action, a = {}, ctx = {}) {
    const today = ctx.today || toIso(new Date());
    const sm = keep(data);
    switch (action) {
        case 'edit-split': return { sheet: { kind: 'split' } };
        case 'change-template': return { sheet: { kind: 'template' } };
        case 'use-suggested': return { res: applySuggestedSplit(data) };
        case 'dismiss-nudge': {
            const m = buildBucketsModel(data, today, ctx);
            if (!sm || !m || !m.nudge) return { changed: false };
            sm.splitNudge = { ...(sm.splitNudge || {}), dismissedAt: { daily: m.nudge.daily, splurge: m.nudge.splurge } };
            return { changed: true };
        }
        case 'chip': return { ui: { moving: a.cat === ctx.moving ? null : a.cat } };
        case 'more-cats': return { ui: { toggleExpanded: a.id } };
        case 'move-cat': return { res: relinkCategory(data, a.cat, a.bucket || null), ui: { moving: null } };
        case 'tick': return { res: tickTransfer(data, a.id) };
        case 'tick-all': return { res: tickTransfer(data, null) };
        case 'fire-up': return { res: moveTarget(data, a.id, -1) };
        case 'fire-down': return { res: moveTarget(data, a.id, 1) };
        case 'fire-skip': return { res: skipTarget(data, a.id, a.skip !== '0') };
        case 'fire-remove': return { res: removeTarget(data, a.id) };
        case 'fire-cash': return { res: applyCashToTarget(data, { today }) };
        case 'fire-edit': return { sheet: { kind: 'target-edit', id: a.id } };
        case 'fire-add-pot': return { sheet: { kind: 'target-pot' } };
        case 'fire-add-debt': return { sheet: { kind: 'target-debt' } };
        case 'mojo-change': return { sheet: { kind: 'mojo' } };
        case 'bucket-open': return { sheet: { kind: 'bucket', id: a.id } };
        case 'goal-open': return { sheet: { kind: 'goal', id: a.id } };
        case 'goal-add': return { sheet: { kind: 'goal-new', parent: a.parent } };
        case 'hint-apply': {
            const m = buildBucketsModel(data, today, ctx);
            const g = m && m.groups.find((x) => x.id === a.parent);
            if (!g || !g.hint || g.hint.kind !== 'move') return { changed: false };
            return { res: setGoalShares(data, g.id, g.hint.shares) };
        }
        case 'make-mine': return { res: forkOwnTemplate(data), ui: { ownOpen: false } };
        case 'add-bucket': return { sheet: { kind: 'bucket-new' } };
        case 'switch-back': return { res: switchBackToBase(data) };
        case 'card-dismiss':
            if (sm && sm.migration) sm.migration.cardDismissed = true;
            return { changed: true };
        case 'auto-yes':
        case 'auto-no': {
            if (sm && sm.migration) sm.migration.cardDismissed = true;
            return { res: setAutoCredit(data, action === 'auto-yes') };
        }
        default: return { changed: false };
    }
}

// ---------- fallback sheets (D1 openSheet) used until E7's bucket sheets are in ----------

/** Fields for the Edit split sheet: one percent per bucket that can hold a share. */
export function splitSheetSpec(data, today) {
    const m = buildBucketsModel(data, today, {});
    const rows = (data.allocation || []).filter((r) => r && r.role !== 'mojo' && r.role !== 'grow');
    const fields = rows.map((r) => ({ key: String(r.id), label: r.name || '', type: 'percent' }));
    const values = {};
    rows.forEach((r) => { values[String(r.id)] = num(r.percentage); });
    const smile = rows.find((r) => r.role === 'smile') || rows[0];
    return { fields, values, smileKey: smile ? String(smile.id) : null, net: m ? m.netCents : 0, suggestion: m ? m.suggestion : null };
}

// ---------- the page glue ----------

const todayIso = () => toIso(new Date());

function changedAfter(root) {
    renderInto(root);
    import('./render.js').then((r) => { try { r.updateDataAndUI(); } catch (e) { /* the page keeps its own copy */ } }).catch(() => {});
}

function handleResult(root, res) {
    if (!res) return;
    if (res.ok) {
        showUndoToast({ message: res.message, onUndo: () => { res.onUndo(); changedAfter(root); }, onExpire: res.onExpire });
        changedAfter(root);
    } else if (res.needsFork) {
        root.__pb.ui.ownOpen = true;
        renderInto(root);
        showToast(res.message);
    } else if (res.message) showToast(res.message);
}

function openSplitSheet(root) {
    const spec = splitSheetSpec(store.financeData, todayIso());
    if (!spec.fields.length) return;
    const total = (v) => Math.round(spec.fields.reduce((s, f) => s + (Number(v[f.key]) || 0), 0) * 100) / 100;
    openSheet({
        title: t('e.plan.splitSheet'), fields: spec.fields, values: spec.values, saveLabel: t('e.plan.change'),
        validate: (v) => (Math.abs(total(v) - 100) < 0.05 ? {} : { [spec.fields[0].key]: t('e.plan.splitTotal', { total: total(v) }) }),
        plausibility: (v) => {
            const sum = total(v);
            if (Math.abs(sum - 100) < 0.005 || !spec.smileKey) return [];
            const fixed = Math.round((Number(v[spec.smileKey] || 0) + (100 - sum)) * 100) / 100;
            const note = { field: spec.smileKey, message: t('e.plan.splitTotal', { total: sum }) };
            if (fixed >= 0) note.fix = { label: t('d.plaus.fixSmile'), apply: () => ({ [spec.smileKey]: fixed }) };
            return [note];
        },
        onSave: (v) => handleResult(root, setSplit(store.financeData, v)),
    });
}

async function openTemplateSheet(root) {
    const d = store.financeData;
    if (!d || !d.savingModel) return;
    const { openModelPicker } = await import('./model-picker.js'); // lazy: the catalogue picker (DB15)
    openModelPicker({ data: d, onResult: (res) => handleResult(root, res) });
}

function openGoalSheet(root, id, parent) {
    const d = store.financeData;
    const goal = id ? (d.bucketGoals || []).find((g) => g && String(g.id) === String(id)) : null;
    const fields = [
        { key: 'name', label: t('e.plan.goalName'), type: 'text', required: true },
        { key: 'cost', label: t('e.plan.goalCost'), type: 'money' },
        { key: 'saved', label: t('e.plan.goalSavedLabel'), type: 'money' },
        { key: 'due', label: t('e.plan.goalDue'), type: 'date' },
    ];
    if (goal) fields.push({ key: 'share', label: t('e.plan.goalShareOnly'), type: 'percent' });
    openSheet({
        title: t('e.plan.goalSheetTitle'), fields, saveLabel: undefined,
        values: goal ? { name: goal.name, cost: goal.cost, saved: goal.saved, due: goal.due, share: goal.share } : { name: '', cost: null, saved: 0, due: null },
        onSave: (v) => {
            const f = { name: v.name, cost: v.cost || 0, saved: v.saved || 0, due: v.due || null };
            handleResult(root, goal ? updateGoal(d, goal.id, { ...f, ...(typeof v.share === 'number' ? { share: v.share } : {}) }) : addGoal(d, parent, f));
        },
    });
}

function openMojoSheet(root) {
    const d = store.financeData;
    const mj = (d.savingModel && d.savingModel.mojo) || {};
    openSheet({
        title: t('e.plan.mojoSheet'),
        fields: [
            { key: 'starter', label: t('e.plan.mojoStarterLabel'), type: 'money', unit: 'cents' },
            { key: 'months', label: t('e.plan.mojoMonthsLabel'), type: 'number' },
        ],
        values: { starter: mj.starter == null ? MOJO_STARTER_CENTS : mj.starter, months: mj.months == null ? 3 : mj.months },
        onSave: (v) => handleResult(root, setMojo(d, { starter: v.starter == null ? 0 : v.starter, months: v.months == null ? 0 : v.months })),
    });
}

function openBucketNew(root) {
    const d = store.financeData;
    openSheet({
        title: t('e.plan.addBucket'), saveLabel: t('e.plan.bucketSave'),
        fields: [{ key: 'name', label: t('e.plan.bucketNameLabel'), type: 'text', required: true }], values: { name: '' },
        onSave: (v) => handleResult(root, addBucket(d, { name: v.name })),
    });
}

function openTargetSheet(root, kind) {
    const d = store.financeData;
    if (kind === 'target-debt') {
        const m = buildBucketsModel(d, todayIso(), {});
        const opts = m && m.fire ? m.fire.freeDebts.map((x) => ({ value: x.id, label: x.name })) : [];
        if (!opts.length) return;
        openSheet({
            title: t('e.plan.addDebtTitle'), fields: [{ key: 'liabilityId', label: t('e.plan.addDebtPick'), type: 'select', options: opts, required: true }], values: { liabilityId: opts[0].value },
            onSave: (v) => handleResult(root, addTarget(d, { type: 'debt', liabilityId: v.liabilityId })),
        });
        return;
    }
    openSheet({
        title: t('e.plan.addTargetTitle'),
        fields: [{ key: 'label', label: t('e.plan.addTargetLabel'), type: 'text', required: true }, { key: 'goalCents', label: t('e.plan.addTargetGoal'), type: 'money', unit: 'cents' }],
        values: { label: '', goalCents: null },
        onSave: (v) => handleResult(root, addTarget(d, { type: 'saver', label: v.label, goalCents: v.goalCents || 0 })),
    });
}

const E7_KINDS = ['split', 'template', 'goal', 'goal-new', 'mojo', 'bucket-new', 'target-pot', 'target-debt', 'target-edit'];

/** Which E7 sheet an action opens: { kind, id } for openBucketSheet, or null (T3; pure so it can be tested). */
export function bucketSheetRoute(sheet) {
    if (!sheet || !sheet.kind) return null;
    if (sheet.kind === 'bucket') return { kind: 'bucket', id: sheet.id || null };
    return E7_KINDS.includes(sheet.kind) ? { kind: sheet.kind, id: sheet.id || sheet.parent || null } : null;
}

function openFor(root, sheet) {
    const kind = sheet.kind;
    const route = bucketSheetRoute(sheet);
    if (kind === 'bucket') { if (route) openBucketSheet(route.kind, route.id); return; }
    const e7 = route ? openBucketSheet(route.kind, route.id) : false;
    if (e7 || kind === 'target-edit') return; // a target that is gone opens nothing, never the add sheet
    if (kind === 'split') openSplitSheet(root);
    else if (kind === 'template') openTemplateSheet(root);
    else if (kind === 'goal') openGoalSheet(root, sheet.id, null);
    else if (kind === 'goal-new') openGoalSheet(root, null, sheet.parent);
    else if (kind === 'mojo') openMojoSheet(root);
    else if (kind === 'bucket-new') openBucketNew(root);
    else openTargetSheet(root, kind);
}

function leftByBucket() {
    try {
        const tm = todayModel();
        if (tm && tm.ready && Array.isArray(tm.buckets)) return Object.fromEntries(tm.buckets.map((b) => [b.id, b.leftCents]));
    } catch (e) { /* Daily falls back to its balance */ }
    return {};
}

function renderInto(root) {
    const ui = root.__pb.ui;
    const model = buildBucketsModel(store.financeData, todayIso(), { leftByBucket: leftByBucket() });
    root.innerHTML = buildBucketsHtml(model, ui);
}

function onClick(ev) {
    const el = ev.target.closest && ev.target.closest('[data-pb]');
    const root = ev.currentTarget;
    if (!el || !root.contains(el) || el.dataset.pb === 'tick' || el.disabled) return;
    run(root, el);
}

function onChange(ev) {
    const el = ev.target;
    const root = ev.currentTarget;
    if (el && el.dataset && el.dataset.pb === 'tick' && el.type === 'checkbox') run(root, el);
}

function run(root, el) {
    const ui = root.__pb.ui;
    const out = dispatchBucketAction(store.financeData, el.dataset.pb, { ...el.dataset }, { today: todayIso(), moving: ui.moving });
    if (out.ui) {
        if ('moving' in out.ui) ui.moving = out.ui.moving;
        if ('ownOpen' in out.ui) ui.ownOpen = out.ui.ownOpen;
        if (out.ui.toggleExpanded) ui.expanded[out.ui.toggleExpanded] = !ui.expanded[out.ui.toggleExpanded];
    }
    if (out.sheet) { openFor(root, out.sheet); return; }
    if (out.res) handleResult(root, out.res);
    else if (out.changed) changedAfter(root);
    else renderInto(root);
}

/** Mounts the buckets section into #plan-buckets (or any element). Safe to call again to re-render. */
export function mountBuckets(root) {
    if (!root) return;
    if (!root.__pb) {
        root.__pb = { ui: { moving: null, expanded: {}, ownOpen: false } };
        root.addEventListener('click', onClick);
        root.addEventListener('change', onChange);
    }
    renderInto(root);
}
