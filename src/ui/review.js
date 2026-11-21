// Monthly review (owner: E9, plan section 2.13, FT-R-84). A Plan sub-screen built from existing cards, tiles and bars:
// spending, bucket movements (labelled "planned" when auto-credit is off), target progress, transfers to update.
// The figures come from calc/review.js (E3) and getBuckets (E5); nothing is typed in. Colours are tokens and the slot
// classes (.kN, .p-bar.kN). Every data value is escaped (esc / escNum / T / A).
//
// Shape: reviewModel / reviewHtml are pure (no DOM); openReview, mountReview and mountReviewCard wire them to the page.
// Two state paths differ from the E3 file (see docs/phase1-changelog/E9.md): the real home of the "last opened" marker
// and of bankSetTo is data.savingModel.review and data.savingModel.transfers.bankSetTo; calc/review.js reads those paths.

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { getSpendCache } from '../state/spend-cache.js';
import { monthlySpendByCategory } from '../state/transactions.js';
import { getBuckets } from '../state/saving-model.js';
import { buildMonthlyReview, reviewDue, previousMonth, inMonth } from '../calc/review.js';
import { formatCurrency } from '../utils.js';
import { esc, escNum } from './html.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const money = (cents) => formatCurrency(num(cents) / 100);
const moneyWhole = (cents) => formatCurrency(num(cents) / 100, undefined, 0);
const pctText = (x) => `${Math.round(num(x) * 10) / 10}%`;
const pad = (n) => String(n).padStart(2, '0');
const toneClass = (slot, shade) => `k${Math.max(1, Math.min(10, num(slot) || 1))}${shade > 0 ? `-s${Math.min(3, shade)}` : ''}`;
const localIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** t() with every param escaped: for text nodes. */
function T(key, params) {
    const p = {};
    Object.keys(params || {}).forEach((k) => { p[k] = esc(params[k]); });
    return t(key, p);
}
const A = (key, params) => esc(t(key, params));

/** 'YYYY-MM' to "October 2026". */
export function reviewMonthLabel(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month));
    if (!m) return '';
    return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}
const dayShort = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

/** The twelve months up to and including the previous complete month, newest first. */
export function monthOptions(today, count = 12) {
    const out = [];
    let m = previousMonth(String(today).slice(0, 7));
    for (let i = 0; i < count; i++) { out.push(m); m = previousMonth(m); }
    return out;
}

// ---------- state ----------

/** The marker lives at savingModel.review; calc/review.js reads that path itself. */
export function reviewDueFor(data, today, opts) {
    return reviewDue(data, today, opts);
}

/** Opening a month sets savingModel.review.lastOpenedMonth. It only moves forward. Returns true when it changed. */
export function markReviewOpened(data, month) {
    const sm = data && data.savingModel;
    if (!sm || !/^\d{4}-\d{2}$/.test(String(month))) return false;
    if (!isObj(sm.review)) sm.review = { lastOpenedMonth: null };
    const last = sm.review.lastOpenedMonth;
    if (last && last >= month) return false;
    sm.review.lastOpenedMonth = month;
    return true;
}

// ---------- the model (pure) ----------

/**
 * Everything the screen shows. spend: Map categoryId to cents (outgoing only) for the month.
 * Adds names, slots and the fire target label to E3's blocks, and reads bankSetTo from its real home.
 */
export function reviewModel(data, month, spend, today) {
    const d = data || {};
    const base = buildMonthlyReview({ data: d, month, spendByCategory: spend, today });
    const buckets = getBuckets(d, today);
    const slotOfId = new Map(buckets.map((b) => [String(b.id), b]));
    const transfers = base.transfers.map((r) => {
        const b = slotOfId.get(String(r.bucketId));
        return { ...r, slot: b ? b.slot : 1, shade: b ? b.shade : 0 };
    });
    const lines = base.movements.lines.map((l) => {
        const b = slotOfId.get(String(l.bucketId));
        return { ...l, slot: b ? b.slot : 1, shade: b ? b.shade : 0 };
    });
    const cats = new Map((d.categories || []).map((c) => [c.id, c]));
    const smap = spend instanceof Map ? spend : new Map(Object.entries(spend || {}));
    const topCategories = [...smap].map(([id, cents]) => ({ id, name: (cats.get(id) && cats.get(id).name) || id, cents: num(cents) }))
        .filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 5);
    const fireRow = buckets.find((b) => b.role === 'fire');
    let fireLabel = fireRow && fireRow.target && fireRow.target.label ? fireRow.target.label : '';
    const aid = base.targets.fire.activeId;
    if (!fireLabel && typeof aid === 'string') {
        if (aid.startsWith('debt:')) { const l = (d.liabilities || []).find((x) => `debt:${x.id}` === aid); fireLabel = (l && l.name) || ''; }
        else fireLabel = aid;
    }
    return { ...base, movements: { ...base.movements, lines }, transfers, spending: { ...base.spending, topCategories },
        targets: { ...base.targets, fire: { ...base.targets.fire, label: fireLabel } },
        hasAny: base.spending.totalCents > 0 || lines.length > 0 };
}

// ---------- HTML (pure) ----------

function barHtml(pct, aria, cls) {
    const w = Math.max(0, Math.min(100, num(pct)));
    return `<div class="p-bar rv-bar ${cls || ''}" role="img" aria-label="${esc(aria)}"><i style="width:${escNum(Math.round(w * 10) / 10)}%"></i></div>`;
}

function diffText(diffCents) {
    if (Math.abs(diffCents) < 100) return t('e.review.onPlan');
    return t(diffCents > 0 ? 'e.review.over' : 'e.review.under', { amount: money(Math.abs(diffCents)) });
}

function spendRow(label, actual, planned, diff, pct) {
    const fill = planned > 0 ? (actual / planned) * 100 : (actual > 0 ? 100 : 0);
    const aria = t('e.review.barAria', { actual: money(actual), planned: money(planned) });
    return `<li class="rv-row"><div class="rv-line"><span class="rv-lab">${esc(label)}</span><span class="rv-fig money">${esc(money(actual))}</span></div>
        <div class="rv-sub"><span>${T('e.review.planned', { amount: money(planned) })}</span><span>${esc(diffText(diff))}${pct === null ? '' : ` · ${esc(t('e.review.ofTake', { pct: pctText(pct) }))}`}</span></div>
        ${barHtml(fill, aria)}</li>`;
}

function spendingCard(s) {
    if (!s.totalCents) return `<section class="card rv-card" aria-labelledby="rv-h-spend"><div class="card-head"><h2 id="rv-h-spend">${esc(t('e.review.spendTitle'))}</h2></div><p class="muted rv-empty">${esc(t('e.review.spendEmpty'))}</p></section>`;
    const cats = s.topCategories.length
        ? `<h3 class="rv-h3">${esc(t('e.review.topCats'))}</h3><ul class="rv-cats">${s.topCategories.map((c) => `<li><span>${esc(c.name)}</span><span class="money">${esc(money(c.cents))}</span></li>`).join('')}</ul>` : '';
    return `<section class="card rv-card" aria-labelledby="rv-h-spend"><div class="card-head"><h2 id="rv-h-spend">${esc(t('e.review.spendTitle'))}</h2><span class="aside">${esc(t('e.review.spendTotal', { amount: money(s.totalCents) }))}</span></div>
        <ul class="rv-rows">${spendRow(t('e.review.essential'), s.essentialCents, s.plannedEssentialCents, s.essentialDiffCents, s.essentialPct)}${spendRow(t('e.review.nonEssential'), s.nonEssentialCents, s.plannedNonEssentialCents, s.nonEssentialDiffCents, s.nonEssentialPct)}</ul>${cats}</section>`;
}

function movementsCard(m) {
    const tag = m.planned ? `<span class="pill due rv-tag">${esc(t('e.review.plannedTag'))}</span>` : '';
    let body;
    if (!m.lines.length) body = `<p class="muted rv-empty">${esc(t(m.planned ? 'e.review.movePlannedEmpty' : 'e.review.moveEmpty'))}</p>`;
    else {
        const tiles = m.lines.map((l) => {
            const sub = m.planned ? t('e.review.movePlannedSub') : t('e.review.moveFromTo', { from: money(l.startCents), to: money(l.endCents) });
            return `<li class="tile rv-tile ${toneClass(l.slot, l.shade)}"><div class="t"><span>${esc(l.name)}</span></div><div class="v money">${esc(money(l.creditedCents))}</div><div class="s">${esc(sub)}</div></li>`;
        }).join('');
        const note = m.planned ? `<p class="rv-note">${T('e.review.plannedNote', { pays: m.pays })}</p>` : '';
        body = `<ul class="rv-tiles">${tiles}</ul>${note}`;
    }
    return `<section class="card rv-card" aria-labelledby="rv-h-move"><div class="card-head"><h2 id="rv-h-move">${esc(t('e.review.moveTitle'))}</h2>${tag}</div>${body}</section>`;
}

function smileText(g) {
    if (g.status === 'done') return t('e.plan.goalDone');
    if (g.status === 'impossible') return t('e.plan.goalImpossible');
    if (g.status === 'late') return g.readyOn ? t('e.plan.goalLate', { late: `${num(g.lateDays)} d`, date: dayShort(g.readyOn) }) : t('e.plan.goalLateNoDate');
    if (g.status === 'on-track') return g.readyOn ? t('e.plan.goalOnTrack', { date: dayShort(g.readyOn) }) : t('e.plan.goalOnTrackNoDate');
    return g.readyOn ? t('e.plan.goalReady', { date: dayShort(g.readyOn) }) : t('e.plan.goalNoDate');
}

function targetsCard(tg) {
    const items = [];
    const f = tg.fire;
    if (f.free) items.push(`<li class="rv-row"><div class="rv-line"><span class="rv-lab">${esc(t('e.review.fire'))}</span><span class="rv-fig">${esc(t('e.review.fireFree'))}</span></div></li>`);
    else if (f.activeId) {
        const p = f.progress === null || f.progress === undefined ? null : num(f.progress) * 100;
        items.push(`<li class="rv-row"><div class="rv-line"><span class="rv-lab">${esc(t('e.review.fire'))}</span><span class="rv-fig">${esc(f.label || '')}</span></div>${p === null ? '' : `<div class="rv-sub"><span>${esc(pctText(p))}</span></div>${barHtml(p, t('e.plan.goalBarAria', { pct: pctText(p) }), 'k3')}`}</li>`);
    }
    const mj = tg.mojo || {};
    const active = mj.active ? mj.active.amountCents : null;
    const mp = num(mj.progressPct);
    items.push(`<li class="rv-row"><div class="rv-line"><span class="rv-lab">${esc(t('e.review.mojo'))}</span><span class="rv-fig money">${esc(active ? t('e.review.mojoStep', { amount: moneyWhole(active) }) : '')}</span></div>
        <div class="rv-sub"><span>${esc(pctText(mp))}${mj.complete ? ` · ${esc(t('e.review.mojoDone'))}` : ''}</span></div>${barHtml(mp, t('e.plan.mojoBarAria', { pct: pctText(mp), step: active ? moneyWhole(active) : '' }), 'k5')}</li>`);
    (tg.smile || []).forEach((g) => items.push(`<li class="rv-row"><div class="rv-line"><span class="rv-lab">${esc(g.name)}</span><span class="rv-fig">${esc(smileText(g))}</span></div></li>`));
    return `<section class="card rv-card" aria-labelledby="rv-h-targets"><div class="card-head"><h2 id="rv-h-targets">${esc(t('e.review.targetTitle'))}</h2></div><ul class="rv-rows">${items.join('')}</ul></section>`;
}

function transfersCard(rows) {
    const body = rows.length
        ? `<p class="rv-lead">${esc(t('e.review.transferLead'))}</p><ul class="rv-tiles">${rows.map((r) => `<li class="tile rv-tile ${toneClass(r.slot, r.shade)}"><div class="t"><span>${esc(r.name)}</span>${r.bankLabel ? `<span>${esc(r.bankLabel)}</span>` : ''}</div><div class="v money">${esc(r.wasCents === null && !r.nowCents ? t('e.review.transferNewTag') : money(r.nowCents))}</div><div class="s">${esc(r.wasCents === null ? t('e.review.transferNew') : t('e.review.transferWas', { was: money(r.wasCents) }))}${r.informational ? ` · ${esc(t('e.review.transferInfo'))}` : ''}</div></li>`).join('')}</ul>`
        : `<p class="muted rv-empty">${esc(t('e.review.transferEmpty'))}</p>`;
    return `<section class="card rv-card" aria-labelledby="rv-h-xfer"><div class="card-head"><h2 id="rv-h-xfer">${esc(t('e.review.transferTitle'))}</h2></div>${body}</section>`;
}

/** The whole sub-screen. ui: {options: ['YYYY-MM', ...], loading}. */
export function reviewHtml(model, ui = {}) {
    const opts = (ui.options || []).map((m) => `<option value="${esc(m)}"${m === model.month ? ' selected' : ''}>${esc(reviewMonthLabel(m))}</option>`).join('');
    const head = `<div class="rv-top"><button type="button" class="btn ghost rv-back" data-rv="back">${esc(t('e.review.back'))}</button>
        <div class="rv-pick"><label for="rv-month" class="rv-pick-l">${esc(t('e.review.month'))}</label><select id="rv-month" class="form-input rv-month" data-rv="month">${opts}</select></div></div>
        <div class="rv-title"><h2 id="rv-title" tabindex="-1">${esc(t('e.review.title', { month: reviewMonthLabel(model.month) }))}</h2><p>${esc(t('e.review.sub'))}</p></div>`;
    if (ui.loading) return `${head}<div class="rv-grid" aria-busy="true"><p class="muted">${esc(t('e.review.loading'))}</p></div>`;
    const empty = model.hasAny ? '' : `<p class="rv-nodata card">${esc(t('e.review.noData'))}</p>`;
    return `${head}${empty}<div class="rv-grid">${spendingCard(model.spending)}${movementsCard(model.movements)}${targetsCard(model.targets)}${transfersCard(model.transfers)}</div>`;
}

/** The Today card for a due month. */
export function dueCardHtml(month) {
    if (!month) return '';
    return `<section class="card rv-today" aria-labelledby="rv-today-h"><div class="card-head"><h2 id="rv-today-h">${esc(t('e.review.cardTitle', { month: reviewMonthLabel(month) }))}</h2></div>
        <p class="rv-lead">${esc(t('e.review.cardBody'))}</p><button type="button" class="btn" data-rv="open" data-month="${esc(month)}">${esc(t('e.review.cardOpen'))}</button></section>`;
}

/** Months that have rows in the spend cache (the cache covers back past the previous month). */
export function cacheMonths(cache) {
    const set = new Set();
    ((cache && cache.rows) || []).forEach((r) => { if (r && r.date) set.add(String(r.date).slice(0, 7)); });
    return set;
}

// ---------- page wiring ----------

let selected = null;
let isOpen = false;
let token = 0;

function ctxToday() { return getSpendCache().today || localIso(); }

function screenEl() { return document.getElementById('plan-review-screen'); }

async function spendFor(month) {
    const cache = getSpendCache();
    try { return await monthlySpendByCategory(month); } catch (e) { /* no IndexedDB: fall back to the cache */ }
    const map = new Map();
    ((cache && cache.rows) || []).filter((r) => inMonth(r.date, month) && r.amountCents < 0)
        .forEach((r) => map.set(r.categoryId, (map.get(r.categoryId) || 0) + -r.amountCents));
    return map;
}

async function renderScreen() {
    const el = screenEl();
    if (!el) return;
    const today = ctxToday();
    const month = selected;
    const mine = ++token;
    const options = monthOptions(today);
    if (!options.includes(month)) options.unshift(month);
    el.innerHTML = reviewHtml({ month }, { options, loading: true });
    const spend = await spendFor(month);
    if (mine !== token || !isOpen) return;
    const model = reviewModel(store.financeData, month, spend, today);
    const had = document.activeElement && document.activeElement.id;
    el.innerHTML = reviewHtml(model, { options });
    if (had === 'rv-month') { const s = document.getElementById('rv-month'); if (s) s.focus(); }
}

/** Open the screen on a month (default: the due month, else the previous complete month). */
export function openReview(month) {
    const plan = document.getElementById('plan');
    if (!plan) return false;
    mountReview();
    const today = ctxToday();
    selected = month || reviewDueFor(store.financeData, today, { hasTransactions: cacheMonths(getSpendCache()) }) || previousMonth(today.slice(0, 7));
    isOpen = true;
    plan.classList.add('review-open');
    if (markReviewOpened(store.financeData, selected) && store.autoSave) store.autoSave.onDataChange();
    renderScreen().then(() => { const h = document.getElementById('rv-title'); if (h) h.focus({ preventScroll: false }); });
    renderReviewCard();
    return true;
}

export function closeReview() {
    isOpen = false;
    token++;
    const plan = document.getElementById('plan');
    if (plan) plan.classList.remove('review-open');
    const link = document.querySelector('[data-rv="open-link"]');
    if (link) link.focus();
}

function onClick(e) {
    const b = e.target.closest('[data-rv]');
    if (!b) return;
    const act = b.dataset.rv;
    if (act === 'open-link') openReview();
    else if (act === 'back') closeReview();
    else if (act === 'open') {
        const tab = document.querySelector('[data-tab-target="plan"]');
        if (tab) tab.click();
        openReview(b.dataset.month);
    }
}

function onChange(e) {
    if (!e.target || e.target.dataset.rv !== 'month') return;
    selected = e.target.value;
    if (markReviewOpened(store.financeData, selected) && store.autoSave) store.autoSave.onDataChange();
    renderScreen();
    renderReviewCard();
}

/** Plan side: a link card under the title and the sub-screen container. Safe to call on every Plan render. */
export function mountReview() {
    const plan = document.getElementById('plan');
    if (!plan) return;
    if (!plan.__rv) {
        plan.__rv = true;
        plan.addEventListener('click', onClick);
        plan.addEventListener('change', onChange);
        const link = document.createElement('div');
        link.id = 'plan-review-link'; link.className = 'rv-link';
        link.innerHTML = `<button type="button" class="btn ghost" data-rv="open-link">${esc(t('e.review.link'))}</button>`;
        const title = plan.querySelector('.title-row');
        if (title) title.after(link); else plan.prepend(link);
        const screen = document.createElement('div');
        screen.id = 'plan-review-screen'; screen.className = 'rv';
        plan.appendChild(screen);
    }
    if (isOpen) renderScreen();
}

/** Today side: fills #today-review-slot while a month is due. Safe to call on every Today render. */
export function mountReviewCard() {
    const slot = document.getElementById('today-review-slot');
    if (!slot) return;
    if (!slot.__rv) { slot.__rv = true; slot.addEventListener('click', onClick); }
    renderReviewCard();
}

function renderReviewCard() {
    const slot = document.getElementById('today-review-slot');
    if (!slot) return;
    const cache = getSpendCache();
    const due = cache && cache.ready ? reviewDueFor(store.financeData, ctxToday(), { hasTransactions: cacheMonths(cache) }) : null;
    slot.innerHTML = dueCardHtml(due);
}
