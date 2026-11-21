// Today screen (A6). Every figure comes from todayModel() (B7) and the engine behind it
// (leftThisPay, getBuckets, calculateTotals); nothing is typed in. The renderers below are
// pure string builders over (model, ctx), so the tests can run them without a DOM. The three
// reserved slots (#today-setup-slot, #today-tax-slot, #today-review-slot) belong to C7, C8
// and E9; this file only adds the "Set your pay day" nudge as its own child of the setup slot.
// All data is escaped (esc / escNum); colours come from theme tokens (today.css).

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { getSpendCache } from '../state/spend-cache.js';
import { todayModel } from '../state/today-model.js';
import { getBuckets } from '../state/saving-model.js';
import { calculateTotals } from '../calc/calculations.js';
import { inferPayAnchor, billOccurrences, billStatus, addDays, daysBetween, getCycle } from '../calc/pay-cycle.js';
import { effectiveBucket, SPENDABLE_POOL } from '../calc/plan.js';
import { formatCurrency } from '../utils.js';
import { esc, escNum } from './html.js';
import { renderHomeFeed } from './feed.js';
import { renderSetupChecklist } from './setup/checklist.js'; // C7: fills #today-setup-slot

// ---------- small formatters ----------

const money = (cents) => formatCurrency((Number(cents) || 0) / 100);
const moneyWhole = (cents) => formatCurrency((Number(cents) || 0) / 100, undefined, 0);
const cents = (dollars) => Math.round((Number(dollars) || 0) * 100);
const localDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (iso, opts) => localDate(iso).toLocaleDateString('en-AU', opts).replace(',', '');
const dayLong = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const dayShort = (iso) => fmt(iso, { day: 'numeric', month: 'short' });
const dayAxis = (iso) => fmt(iso, { weekday: 'short', day: 'numeric' });
const monthName = (iso) => fmt(iso, { month: 'long' });
const plural = (n) => t(n === 1 ? 'a.today.dayOne' : 'a.today.dayMany', { n: escNum(n) });
const pct = (x) => Math.max(0, Math.min(100, Math.round(x * 10) / 10));

// A figure for the hero: the cents part is a lighter span, as in the mock.
function heroMoney(c) {
    const s = money(c);
    const m = s.match(/^(.*?)([.,]\d{2})$/);
    return m ? `${esc(m[1])}<span class="cents">${esc(m[2])}</span>` : esc(s);
}

const ROLE_CLASS = { daily: 'b-daily', splurge: 'b-splurge', smile: 'b-smile', fire: 'b-fire' };

// ---------- the rows the screen reads besides the model ----------

function isTransfer(row, cat) {
    return row.categoryId === 'transfer' || (cat && (cat.kind === 'transfer' || cat.id === 'transfer'));
}

/** Income landed this cycle (Income-category credits). `latest` is the newest one. */
function incomeThisCycle(cycleRows) {
    const rows = cycleRows.filter((r) => r.amountCents > 0 && r.categoryId === 'income');
    const total = rows.reduce((a, r) => a + r.amountCents, 0);
    const latest = rows.reduce((best, r) => (!best || r.date > best.date ? r : best), null);
    return { total, latest };
}

/**
 * The cycle (or month, in month mode) just before the current one: { start, end } with end exclusive.
 * Steps back from the current cycle's own start, so an inferred pay day works the same as a set one.
 */
function previousPeriod(model, data) {
    const cur = model.cycle;
    const day = addDays(cur.start, -1);
    if (cur.mode !== 'cycle') {
        const [y, m] = day.split('-');
        return { start: `${y}-${m}-01`, end: cur.start };
    }
    const sources = (data && data.incomeSources) || [];
    const src = sources[(data && data.primaryIncomeIndex) || 0] || sources[0] || {};
    const anchor = /^d{4}-d{2}-d{2}$/.test(String(src.payAnchor || '')) ? src.payAnchor : cur.start;
    const p = getCycle({ ...src, payAnchor: anchor }, day);
    return { start: p.start, end: p.end };
}

/**
 * Savings rate, labelled by where it came from (FT-R-59). Planned (from the plan) until at least one
 * COMPLETE pay cycle (month, in month mode) of transactions exists. Then actual for the last completed
 * cycle, never the one in progress, with that cycle's dates (`from`, `to` inclusive).
 * "Complete" = the history reaches back to that cycle's first day and income landed in it.
 */
export function savingsRateFigure(model, ctx) {
    const planned = ctx.totals && Number.isFinite(ctx.totals.savingsRate) ? ctx.totals.savingsRate : 0;
    const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
    if (rows.length && model && model.cycle) {
        const prev = previousPeriod(model, ctx.data);
        const earliest = rows.reduce((m, r) => (r.date && (m === null || r.date < m) ? r.date : m), null);
        if (earliest !== null && earliest <= prev.start) {
            const inPrev = rows.filter((r) => r.date >= prev.start && r.date < prev.end);
            const income = inPrev.filter((r) => r.amountCents > 0 && r.categoryId === 'income').reduce((a, r) => a + r.amountCents, 0);
            if (income > 0) {
                const cats = new Map(((ctx.data && ctx.data.categories) || []).map((c) => [c.id, c]));
                const out = inPrev.filter((r) => r.amountCents < 0 && !isTransfer(r, cats.get(r.categoryId))).reduce((a, r) => a - r.amountCents, 0);
                return { kind: 'actual', value: Math.round(((income - out) / income) * 100), from: prev.start, to: addDays(prev.end, -1) };
            }
        }
    }
    return { kind: 'planned', value: Math.round(planned) };
}

/** Rows and totals the screen needs besides the model. Reads the store and the spend cache. */
export function todayContext() {
    const c = getSpendCache();
    let totals = null;
    try { totals = calculateTotals(store.financeData); } catch (_) { totals = null; }
    return { data: store.financeData, rows: c.rows || [], cycleRows: c.cycleRows || [], totals };
}

// ---------- the day-by-day chart ----------

/**
 * Daily's day-by-day figures for the cycle: spend per day, the left line up to today, and the
 * projection to pay day (today's pace, bill days stepping it down). Pure; cents.
 */
export function dayByDay(model, ctx) {
    const data = ctx.data || {};
    const { start, end } = model.cycle;
    const n = daysBetween(start, end);
    if (!(n >= 2) || n > 62) return null;
    const head = model.buckets.find((b) => b.role === 'daily') || model.buckets.find((b) => b.id === SPENDABLE_POOL);
    if (!head) return null;
    const alloc = Array.isArray(data.allocation) ? data.allocation.filter((a) => a && a.id) : [];
    const configured = alloc.some((a) => a.role) || alloc.length > 1;
    const allocForResolve = configured ? alloc : [];
    const cats = new Map((data.categories || []).map((c) => [c.id, c]));
    const plan = new Map((data.plan || []).map((p) => [p.id, p]));
    const days = Array.from({ length: n }, (_, i) => addDays(start, i));
    const spent = days.map(() => 0);
    for (const r of ctx.cycleRows) {
        if (!(r.amountCents < 0)) continue;
        const item = r.billMatch ? plan.get(r.billMatch.planId) : null;
        if (effectiveBucket(r, cats.get(r.categoryId), item, allocForResolve) !== head.id) continue;
        const i = days.indexOf(r.date);
        if (i >= 0) spent[i] += -r.amountCents;
    }
    const bills = days.map(() => 0);
    let missed = 0;
    for (const item of data.plan || []) {
        if (!item || !item.anchorDue) continue;
        if (effectiveBucket(null, cats.get(item.categoryId), item, allocForResolve) !== head.id) continue;
        for (const due of billOccurrences(item, start, addDays(end, -1))) {
            if (billStatus(item, due, ctx.rows, model.today) === 'Paid') continue;
            if (due < model.today) missed += cents(item.amount);
            else bills[days.indexOf(due)] += cents(item.amount);
        }
    }
    const ti = Math.max(0, Math.min(n - 1, daysBetween(start, model.today)));
    const pool = head.poolCents;
    const actual = [];
    let cum = 0;
    for (let i = 0; i <= ti; i++) { cum += spent[i]; actual.push(pool - cum); }
    const pace = Math.max(0, model.perDayCents);
    const proj = [{ i: ti, v: actual[ti] }];
    let held = missed;
    for (let i = ti; i < n; i++) {
        held += bills[i];
        if (i > ti) proj.push({ i, v: actual[ti] - held - pace * (i - ti) });
    }
    const endValue = proj[proj.length - 1].v;
    return { days, spent, bills, missed, ti, pool, actual, proj, pace, endValue, headId: head.id };
}

function chartHtml(model, ctx) {
    const s = dayByDay(model, ctx);
    if (!s) return '';
    const n = s.days.length;
    const vals = [s.pool, 0, ...s.actual, ...s.proj.map((p) => p.v)];
    const ymax = Math.max(...vals);
    const ymin = Math.min(...vals);
    const span = Math.max(1, ymax - ymin);
    const Y0 = 10, Y1 = 230;
    const y = (v) => Math.round((Y1 - ((v - ymin) / span) * (Y1 - Y0)) * 10) / 10;
    const x = (i) => Math.round(((i + 0.5) / n) * 10000) / 10;
    const base = y(0);
    const bw = Math.min(30, (1000 / n) * 0.55);
    const bars = s.spent.map((c, i) => {
        if (!c || i > s.ti) return '';
        const h = Math.max(2, (c / span) * (Y1 - Y0));
        return `<rect class="t-bar" x="${escNum(Math.round((x(i) - bw / 2) * 10) / 10)}" y="${escNum(Math.round((base - h) * 10) / 10)}" width="${escNum(Math.round(bw * 10) / 10)}" height="${escNum(Math.round(h * 10) / 10)}" rx="3"/>`;
    }).join('');
    const line = s.actual.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
    const area = `${line} L${x(s.ti)},${base} L${x(0)},${base} Z`;
    const proj = s.proj.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' ');
    const billLines = s.bills.map((c, i) => (c ? `<line class="t-bill" x1="${x(i)}" x2="${x(i)}" y1="${Y0}" y2="${Y1}" vector-effect="non-scaling-stroke"/>` : '')).join('');
    const axis = s.days.map((d, i) => {
        const cls = [i === s.ti ? 'is-today key' : '', i === 0 || i === n - 1 ? 'key' : '', i % 7 === 0 ? 'wk' : ''].filter(Boolean).join(' ');
        return `<span${cls ? ` class="${cls}"` : ''}>${esc(dayAxis(d))}</span>`;
    }).join('');
    const billsStill = model.billsDueCents;
    const over = model.leftCents < 0;
    const note = over
        ? t('a.today.chartNoteOver', { bills: esc(money(billsStill)), over: esc(money(-model.leftCents)) })
        : t('a.today.chartNote', { bills: esc(money(billsStill)), perDay: esc(money(s.pace)), end: esc(money(Math.max(0, s.endValue))) });
    const desc = t('a.today.chartDesc', {
        start: esc(money(s.pool)), from: esc(dayLong(s.days[0])), now: esc(money(s.actual[s.ti])),
        end: esc(money(s.endValue)), bills: esc(money(billsStill)),
    });
    const rows = s.days.map((d, i) => {
        const proj0 = s.proj.find((p) => p.i === i);
        const left = i <= s.ti ? s.actual[i] : proj0 ? proj0.v : null;
        return `<tr><th scope="row">${esc(dayLong(d))}</th><td>${i <= s.ti ? esc(money(s.spent[i])) : ''}</td><td>${left == null ? '' : esc(money(left))}</td><td>${s.bills[i] ? esc(money(s.bills[i])) : ''}</td><td>${esc(t(i <= s.ti ? 'a.today.kindActual' : 'a.today.kindProjected'))}</td></tr>`;
    }).join('');
    return `
      <section class="card t-trend a-trend" aria-labelledby="h-trend">
        <div class="card-head"><h2 id="h-trend">${t('a.today.chartTitle')}</h2><span class="aside">${t('a.today.chartAside', { from: esc(dayShort(s.days[0])), to: esc(dayShort(s.days[n - 1])) })}</span></div>
        <ul class="t-key">
          <li><i class="k-line"></i>${t('a.today.keyLeft', { amount: esc(money(s.actual[s.ti])) })}</li>
          <li><i class="k-bar"></i>${t('a.today.keySpent')}</li>
          <li><i class="k-proj"></i>${t('a.today.keyProj', { amount: esc(money(s.pace)) })}</li>
          ${s.bills.some(Boolean) ? `<li><i class="k-bill"></i>${t('a.today.keyBill')}</li>` : ''}
        </ul>
        <div class="t-plot"${n > 16 ? ' data-dense="1"' : ''}>
          <svg class="t-chart" viewBox="0 0 1000 240" preserveAspectRatio="none" role="img" aria-labelledby="h-trend t-desc">
            <desc id="t-desc">${desc}</desc>
            <line class="t-base" x1="8" x2="992" y1="${base}" y2="${base}" vector-effect="non-scaling-stroke"/>
            ${billLines}${bars}
            <path class="t-area" d="${area}"/>
            <path class="t-line" d="${line}" vector-effect="non-scaling-stroke"/>
            <path class="t-proj" d="${proj}" vector-effect="non-scaling-stroke"/>
            <line class="t-today" x1="${x(s.ti)}" x2="${x(s.ti)}" y1="${Y0}" y2="${Y1}" vector-effect="non-scaling-stroke"/>
          </svg>
          <div class="t-x" style="grid-template-columns:repeat(${escNum(n)},minmax(0,1fr))" aria-hidden="true">${axis}</div>
        </div>
        <p class="t-note">${note}</p>
        <table class="today-sr">
          <caption>${t('a.today.tableCaption')}</caption>
          <thead><tr><th scope="col">${t('a.today.colDate')}</th><th scope="col">${t('a.today.colSpent')}</th><th scope="col">${t('a.today.colLeft')}</th><th scope="col">${t('a.today.colBills')}</th><th scope="col">${t('a.today.colKind')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

// ---------- cards ----------

function heroHtml(model, ctx, buckets) {
    const { cycle } = model;
    const monthMode = model.mode === 'month';
    const n = daysBetween(cycle.start, cycle.end);
    const dayNo = Math.max(1, Math.min(n, daysBetween(cycle.start, model.today) + 1));
    const left = model.leftCents;
    const over = left < 0;
    const daysTo = plural(cycle.daysLeft);
    const toPay = monthMode
        ? t('a.today.toMonthEnd', { days: daysTo })
        : t('a.today.toPayDay', { days: daysTo, date: esc(dayLong(cycle.nextPay || cycle.end)) });
    const perDay = over
        ? t('a.today.overBy', { amount: esc(money(-left)) })
        : t('a.today.perDay', { amount: esc(money(model.perDayCents)) });
    const strip = Array.from({ length: n }, (_, i) => `<span${i < dayNo - 1 ? ' class="past"' : i === dayNo - 1 ? ' class="now"' : ''}></span>`).join('');
    const lastDay = addDays(cycle.end, -1);
    const head = model.buckets.find((b) => b.role === 'daily') || model.buckets[0];
    const bk = buckets.find((b) => b.id === head.id);
    const dailyName = bk && bk.name ? bk.name : '';
    const share = model.netCents > 0 ? Math.round((head.poolCents / model.netCents) * 100) : 0;
    const poolOk = head.poolCents > 0;
    const wSpent = poolOk ? pct((Math.max(0, head.spentCents) / head.poolCents) * 100) : 0;
    const wBills = poolOk ? Math.min(100 - wSpent, pct((Math.max(0, head.billsDueCents) / head.poolCents) * 100)) : 0;
    const rate = savingsRateFigure(model, ctx);
    const netWorth = ctx.totals && Number.isFinite(ctx.totals.netWorth) ? Math.round(ctx.totals.netWorth * 100) : null;
    const review = model.toReview > 0
        ? `<p class="hero-review"><button type="button" class="pill review" data-go="activity">${t(model.toReview === 1 ? 'a.today.storyReviewOne' : 'a.today.storyReview', { n: escNum(model.toReview) })}</button></p>`
        : '';
    return `
      <section class="card hero a-hero" aria-labelledby="h-left">
        <div class="hero-top">
          <div>
            <h2 class="hero-label" id="h-left">${t(monthMode ? 'a.today.heroMonth' : 'a.today.heroCycle')}</h2>
            <p class="hero-fig money${over ? ' is-over' : ''}">${heroMoney(left)}</p>
            <p class="hero-sub">${toPay} · ${perDay}</p>
            ${review}
            <div class="days" role="img" aria-label="${esc(t('a.today.daysAria', { day: escNum(dayNo), total: escNum(n), left: daysTo }))}">${strip}</div>
            <div class="days-cap"><span>${esc(dayLong(cycle.start))}</span><span>${esc(t(monthMode ? 'a.today.monthEndCap' : 'a.today.payDayCap', { date: dayLong(monthMode ? lastDay : (cycle.nextPay || cycle.end)) }))}</span></div>
          </div>
          <div>
            <div class="gauge-head"><span>${t('a.today.gaugeHead', { name: esc(dailyName), pct: escNum(share) })}</span><span class="money">${esc(money(head.poolCents))}</span></div>
            <div class="gauge" role="img" aria-label="${esc(t('a.today.gaugeAria', { name: dailyName, spent: money(head.spentCents), bills: money(head.billsDueCents), left: money(head.leftCents) }))}">
              <span class="spent" style="width:${escNum(wSpent)}%"></span><span class="bills" style="width:${escNum(wBills)}%"></span>
            </div>
            <ul class="gauge-key">
              <li><span class="k"><i class="sw-spent"></i>${t('a.today.spent')}</span><span class="v money">${esc(money(head.spentCents))}</span></li>
              <li><span class="k"><i class="sw-bills"></i>${t('a.today.billsStill')}</span><span class="v money">${esc(money(head.billsDueCents))}</span></li>
              <li><span class="k"><i class="sw-left"></i>${t('a.today.left')}</span><span class="v money">${esc(money(head.leftCents))}</span></li>
            </ul>
          </div>
        </div>
        <ul class="figs">
          <li><div class="k">${t(rate.kind === 'actual' ? 'a.today.rateActual' : 'a.today.ratePlanned')}</div><div class="v num">${escNum(rate.value)}%</div><div class="s">${rate.kind === 'actual' ? t('a.today.rateCapActual', { from: esc(dayShort(rate.from)), to: esc(dayShort(rate.to)) }) : t('a.today.rateCapPlanned')}</div></li>
          <li><div class="k">${t('a.today.essential')}</div><div class="v money">${esc(money(model.essentialSoFarCents))}</div><div class="s">${t('a.today.thisPay')}</div></li>
          <li><div class="k">${t('a.today.nonEssential')}</div><div class="v money">${esc(money(model.nonEssentialSoFarCents))}</div><div class="s">${t('a.today.thisPay')}</div></li>
          ${netWorth == null ? '' : `<li><div class="k">${t('a.today.netWorth')}</div><div class="v money">${esc(moneyWhole(netWorth))}</div><div class="s">${t('a.today.netWorthCap')}</div></li>`}
        </ul>
      </section>`;
}

function dueHtml(model) {
    const missed = (model.missed || []).filter((m) => m.dueDate >= model.cycle.start);
    const rows = [];
    for (const m of missed) {
        rows.push(`<li class="bill"><div><div class="n">${esc(m.bill.name)}</div><div class="d">${esc(t('a.today.missedDays', { date: dayLong(m.dueDate), n: escNum(m.daysOverdue) }))}</div></div><span class="pill due">${t('a.today.pillMissed')}</span><span class="money">${esc(money(cents(m.bill.amount)))}</span></li>`);
    }
    for (const b of model.dueBeforePay || []) {
        const today = b.dueInDays === 0;
        rows.push(`<li class="bill"><div><div class="n">${esc(b.bill.name)}</div><div class="d">${esc(today ? `${t('feed.today')}, ${dayLong(b.dueDate)}` : dayLong(b.dueDate))}</div></div><span class="pill${today || b.status === 'Due' ? ' due' : ''}">${esc(today || b.status === 'Due' ? t('a.today.pillDue') : b.dueLabel)}</span><span class="money">${esc(money(cents(b.bill.amount)))}</span></li>`);
    }
    return `
      <section class="card due-card a-due" aria-labelledby="h-due">
        <div class="card-head"><h2 id="h-due">${t(model.mode === 'month' ? 'a.today.dueTitleMonth' : 'a.today.dueTitle')}</h2><button type="button" class="link" data-go="activity">${t('a.today.allBills')}</button></div>
        ${rows.length ? `<ul class="rows">${rows.join('')}</ul>` : `<p class="muted">${t('a.today.dueNone')}</p>`}
        <div class="due-total"><span>${t('a.today.heldBack')}</span><span class="money">${esc(money(model.billsDueCents))}</span></div>
      </section>`;
}

function tileHtml(b, mb) {
    const role = b.role && ROLE_CLASS[b.role] ? b.role : (b.role === 'mojo' ? 'smile' : 'smile');
    let value, sub, extra = '';
    const name = b.name || '';
    const barHtml = (p, label) => `<div class="bar" role="img" aria-label="${esc(t('a.today.barAria', { pct: escNum(Math.round(p)), name: label }))}"><i style="width:${escNum(pct(p))}%"></i></div>`;
    if (mb && (b.role === 'daily' || b.role === 'splurge')) {
        value = mb.leftCents;
        sub = t('a.today.leftThisPayLower');
        if (mb.poolCents > 0) extra = barHtml((Math.max(0, mb.leftCents) / mb.poolCents) * 100, name);
    } else {
        value = b.balanceCents;
        const t0 = b.target;
        const saver = t0 && Number(t0.goalCents) > 0 ? t0 : null; // the active Fire target's own saved and goal (T1)
        if (saver) {
            value = Number(saver.savedCents) || 0;
            const p = Math.min(100, (value / saver.goalCents) * 100);
            sub = t('a.today.ofGoal', { goal: esc(moneyWhole(saver.goalCents)), pct: escNum(Math.round(p)) });
            extra = barHtml(p, name);
        } else if (b.role === 'fire' && t0 && t0.label) {
            const p = Number.isFinite(t0.progress) ? t0.progress * 100 : null;
            sub = p == null ? t('a.today.fireNow', { label: esc(t0.label) }) : t('a.today.fireNowPct', { label: esc(t0.label), pct: escNum(Math.round(p)) });
            if (p != null) extra = barHtml(p, t0.label);
        } else if (b.goal > 0) {
            const p = Math.min(100, (b.balanceCents / b.goal) * 100);
            sub = t('a.today.ofGoal', { goal: esc(moneyWhole(b.goal)), pct: escNum(Math.round(p)) });
            extra = barHtml(p, name);
            if (b.perPayCents > 0 && b.balanceCents < b.goal) extra += `<div class="s after">${t('a.today.afterPayDay', { amount: esc(money(Math.min(b.goal, b.balanceCents + b.perPayCents))) })}</div>`;
        } else if (t0 && t0.label) {
            const p = Number.isFinite(t0.progress) ? t0.progress * 100 : null;
            sub = p == null ? t('a.today.fireNow', { label: esc(t0.label) }) : t('a.today.fireNowPct', { label: esc(t0.label), pct: escNum(Math.round(p)) });
            if (p != null) extra = barHtml(p, t0.label);
        } else {
            sub = t('a.today.balance');
            extra = `<div class="nogoal">${t('a.today.noGoal')}</div>`;
        }
    }
    const perPay = mb ? mb.poolCents : b.perPayCents;
    return `
          <div class="tile ${ROLE_CLASS[role]}">
            <div class="t"><span>${esc(name)}</span><span class="money">${t('a.today.plusThisPay', { amount: esc(money(perPay)) })}</span></div>
            <div class="v money">${esc(money(value))}</div>
            <div class="s">${sub}</div>
            ${extra}
          </div>`;
}

function bucketsHtml(model, ctx, buckets) {
    const tops = buckets.filter((b) => b.kind !== 'goal');
    if (!tops.length) return '';
    const total = tops.reduce((a, b) => a + (b.pct || 0), 0) || 1;
    const parts = tops.map((b) => `${b.name} ${Math.round(b.pct)}%`).join(', ');
    const split = tops.map((b) => {
        const cls = ROLE_CLASS[b.role] || 'b-smile';
        const label = b.pct >= 25 ? `${esc(b.name)} ${escNum(Math.round(b.pct))}%` : `${escNum(Math.round(b.pct))}%`;
        return `<span class="${cls}${b.pct < 25 ? ' p10' : ''}" style="flex:${escNum(Math.round((b.pct / total) * 1000) / 10)}">${label}</span>`;
    }).join('');
    const { latest } = incomeThisCycle(ctx.cycleRows);
    const cap = latest
        ? t('a.today.payLanded', { amount: esc(money(latest.amountCents)), date: esc(dayLong(latest.date)) })
        : t('a.today.payPlanned', { amount: esc(money(model.netCents)) });
    const tiles = tops.map((b) => tileHtml(b, model.buckets.find((x) => x.id === b.id))).join('');
    return `
      <section class="card a-buckets" aria-labelledby="h-buckets">
        <div class="card-head"><h2 id="h-buckets">${t('a.today.bucketsTitle')}</h2><button type="button" class="link" data-go="plan">${t('a.today.changeSplit')}</button></div>
        <div class="split" role="img" aria-label="${esc(t('a.today.splitAria', { parts }))}">${split}</div>
        <div class="split-cap"><span>${cap}</span><span>${t('a.today.method')}</span></div>
        <div class="tiles">${tiles}
        </div>
      </section>`;
}

function storyHtml(model) {
    const n = model.toReview;
    const reviewRow = n > 0
        ? `<ol class="rows story"><li><span class="dot now" aria-hidden="true"></span><div><p>${t(n === 1 ? 'a.today.storyReviewOne' : 'a.today.storyReview', { n: escNum(n) })}</p><div class="when">${t('feed.today')} · <button type="button" class="link" data-go="activity">${t('a.today.reviewThem')}</button></div></div></li></ol>`
        : '';
    return `
      <section class="card story-card a-story" aria-labelledby="h-story">
        <div class="card-head"><h2 id="h-story">${t('a.today.storyTitle')}</h2><span class="aside">${t('a.today.storyAside')}</span></div>
        ${reviewRow}
        <ol class="rows story" id="today-story-events" data-used="${n > 0 ? 1 : 0}"></ol>
        <p class="muted" id="today-story-empty"${n > 0 ? ' hidden' : ''}>${t('a.today.storyNone')}</p>
        <div class="card-foot"><button type="button" class="link" data-go="activity">${t('a.today.allActivity')}</button></div>
      </section>`;
}

/** The skeleton shown while the spend cache has not loaded (B7 `ready:false`). */
export function skeletonHtml() {
    return `
      <div class="grid today today-skeleton" aria-busy="true" role="status">
        <span class="today-sr">${t('a.today.loading')}</span>
        <section class="card a-hero" aria-hidden="true"><div class="sk sk-title"></div><div class="sk sk-fig"></div><div class="sk sk-line"></div><div class="sk sk-bar"></div></section>
        <section class="card a-due" aria-hidden="true"><div class="sk sk-title"></div><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div></section>
        <section class="card a-buckets" aria-hidden="true"><div class="sk sk-title"></div><div class="sk sk-bar"></div><div class="sk sk-tiles"></div></section>
        <section class="card a-story" aria-hidden="true"><div class="sk sk-title"></div><div class="sk sk-row"></div><div class="sk sk-row"></div></section>
      </div>`;
}

function emptyHtml() {
    return `
      <section class="card today-empty" aria-labelledby="h-empty">
        <h2 id="h-empty">${t('a.today.emptyTitle')}</h2>
        <p class="muted">${t('a.today.emptyBody')}</p>
        <button type="button" class="btn" data-go="plan">${t('a.today.emptyBtn')}</button>
      </section>`;
}

/** The body of the Today screen for a ready model. Pure: returns HTML. */
export function buildTodayHtml(model, ctx) {
    if (!model || !model.ready) return skeletonHtml();
    const c = ctx || { data: {}, rows: [], cycleRows: [], totals: null };
    if (!(model.netCents > 0) && !c.cycleRows.length) return emptyHtml();
    const buckets = getBuckets(c.data, model.today);
    return `
    <div class="grid today">
      ${heroHtml(model, c, buckets)}
      ${dueHtml(model)}
      ${bucketsHtml(model, c, buckets)}
      ${storyHtml(model)}
      ${chartHtml(model, c)}
    </div>`;
}

/** The "Set your pay day" nudge (FT-R-58): a pay anchor is unset and none can be inferred. */
export function needsPayDayNudge(data, rows, today) {
    const d = data || {};
    const sources = d.incomeSources || [];
    const source = sources[d.primaryIncomeIndex || 0] || sources[0];
    if (!source || source.payAnchor) return false;
    return inferPayAnchor(rows || [], source, today).nudge === true;
}

function nudgeHtml() {
    return `
      <section class="card today-nudge" aria-labelledby="h-payday">
        <div><h2 id="h-payday">${t('a.today.setPayTitle')}</h2><p class="muted">${t('a.today.setPayBody')}</p></div>
        <button type="button" class="btn" data-set-payday>${t('a.today.setPayBtn')}</button>
      </section>`;
}

// ---------- mount ----------

function subLine(model) {
    const date = esc(dayLong(model.today));
    if (model.mode === 'month') return t('a.today.subMonth', { date, month: esc(monthName(model.today)) });
    const n = daysBetween(model.cycle.start, model.cycle.end);
    const day = Math.max(1, Math.min(n, daysBetween(model.cycle.start, model.today) + 1));
    return t('a.today.subCycle', { date, day: escNum(day), from: esc(dayShort(model.cycle.start)), to: esc(dayShort(addDays(model.cycle.end, -1))) });
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    document.addEventListener('click', (e) => {
        const root = document.getElementById('today');
        if (!root || !e.target.closest) return;
        const go = e.target.closest('#today [data-go]');
        if (go) {
            const tab = document.querySelector(`[data-tab-target="${go.dataset.go}"]`);
            if (tab) tab.click();
            return;
        }
        if (e.target.closest('#today [data-set-payday]')) {
            const d = store.financeData || {};
            import('./income-layout.js').then((m) => {
                if (m.openIncomeSheet(d.primaryIncomeIndex || 0) === false) {
                    const tab = document.querySelector('[data-tab-target="plan"]');
                    if (tab) tab.click();
                }
            });
        }
    });
}

function slotChild(slotId, childId) {
    const slot = document.getElementById(slotId);
    if (!slot) return null;
    let el = document.getElementById(childId);
    if (!el) { el = document.createElement('div'); el.id = childId; slot.appendChild(el); }
    return el;
}

export function renderToday() {
    wire();
    const body = document.getElementById('today-body');
    if (!body) return;
    const model = todayModel();
    const ctx = todayContext();
    body.innerHTML = buildTodayHtml(model, ctx);
    // title row: the date line, set once the model is ready
    const h1 = document.querySelector('#today .title-row h1');
    if (h1 && h1.parentElement) {
        let p = h1.parentElement.querySelector('#today-sub');
        if (!p) { p = document.createElement('p'); p.id = 'today-sub'; h1.parentElement.appendChild(p); }
        p.innerHTML = model.ready ? subLine(model) : '';
    }
    const nudge = slotChild('today-setup-slot', 'today-payday-nudge');
    if (nudge) nudge.innerHTML = model.ready && needsPayDayNudge(ctx.data, ctx.rows, model.today) ? nudgeHtml() : '';
    if (model.ready) renderHomeFeed(); // Story rows from the event log (async)
    renderSetupChecklist(); // C7: the setup checklist stays until done
}
