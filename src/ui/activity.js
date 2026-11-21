// Activity screen (A7). The A5 title row (Import CSV and PDF, FT-R-62) lives in index.html; this
// file builds everything under it into #activity-body: search and filter chips, "This pay so far"
// with the To review and Covered boxes, Coming up, day groups with a total each, and the full-width
// "Where it went this pay".
//
// Two layers. buildActivityView() is pure: it takes the B7 feed and today model plus the data and
// returns a view model in which every status is DERIVED from transaction and bill state (never
// typed). renderActivityView() turns that into HTML, escaping every data string. The DOM layer at
// the bottom wires delegated events once. Amounts are integer cents.

import './activity.css'; // A7 — Activity screen styles
import { t, plural } from '../i18n/strings.js';
import { esc } from './html.js';
import { store } from '../state/store.js';
import { activityFeed, todayModel } from '../state/today-model.js';
import { getBuckets } from '../state/saving-model.js';
import { categoryIcon } from '../state/categories.js';
import { effectiveBucket, SPENDABLE_POOL } from '../calc/plan.js';
import { daysBetween, parseIso } from '../calc/pay-cycle.js';
import { formatCurrency } from '../utils.js';
import { openQuickAdd } from './quick-add.js';

export const ACTIVITY_FILTERS = ['all', 'review', 'essential', 'nonessential', 'income', 'bills'];

// ---------- icons (FT-R-39): small stroked glyphs on a 16 px grid, drawn inline ----------

const ICONS = {
    cart: 'M2 3h2l1.4 7h6.2l1.4-5H4.6M6 13.2h.01M11 13.2h.01',
    home: 'M2.5 8L8 3l5.5 5M4 7v6h8V7',
    bolt: 'M9 2L4 9h4l-1 5 5-7H8z',
    phone: 'M5 2.5h6v11H5zM7.5 11.5h1',
    car: 'M3 10V7l1.5-3h7L13 7v3zM3 10h10M4.5 12h.01M11.5 12h.01',
    heart: 'M8 13s-5-3-5-6.5A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5 1.5C13 10 8 13 8 13z',
    shield: 'M8 2l5 2v4c0 3-2.5 5-5 6-2.5-1-5-3-5-6V4z',
    utensils: 'M5 2v5M3.5 2v3.5a1.5 1.5 0 0 0 3 0V2M5 7v7M11 14V2c-1.5 1-2 3-2 5h2',
    film: 'M2.5 3h11v10h-11zM5.5 3v10M10.5 3v10M2.5 6.5h3M2.5 9.5h3M10.5 6.5h3M10.5 9.5h3',
    repeat: 'M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2',
    dumbbell: 'M2 6v4M4 4.5v7M12 4.5v7M14 6v4M4 8h8',
    bag: 'M3.5 5h9l-.7 8.5H4.2zM5.5 5V4a2.5 2.5 0 0 1 5 0v1',
    plane: 'M14 3L2 7.5l4 1.5 1.5 4zM6 9l8-6',
    wallet: 'M2.5 4.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10zM2.5 4.5l9-2v2M10.5 8.5h1.5',
    dots: 'M4 8h.01M8 8h.01M12 8h.01',
    tag: 'M2.5 8.5V3h5.5l5.5 5.5-5.5 5.5zM5.5 5.5h.01',
    search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5l3 3',
    import: 'M8 2.5v7M5 6.5l3 3 3-3M2.5 10.5v3h11v-3',
    alert: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5.5V8.5M8 10.8h.01',
    tick: 'M3.5 8.5l3 3 6-7',
    clock: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5',
    swap: 'M3 5.5h9l-2.5-2.5M13 10.5H4l2.5 2.5',
};

export function iconSvg(name) {
    const d = ICONS[name] || ICONS.tag;
    return `<svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

// ---------- formatting ----------

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Tue 4 Nov' from an ISO date, no locale (the same text on every device). */
export function dayLabel(iso, withWeekday = true) {
    const d = parseIso(iso);
    const base = `${d.getDate()} ${MON[d.getMonth()]}`;
    return withWeekday ? `${WD[d.getDay()]} ${base}` : base;
}

const abs = (n) => Math.abs(Number(n) || 0);
const dollars = (cents) => formatCurrency(abs(cents) / 100);
/** Signed money text: a true minus for money out, a plus for money in. */
export function signedMoney(cents) {
    const c = Number(cents) || 0;
    return `${c < 0 ? '−' : c > 0 ? '+' : ''}${dollars(c)}`;
}

// ---------- derived state ----------

/** Plain category facts for a row or bill, tolerant of a missing or unknown category. */
function catFacts(categoryId, cats) {
    const c = cats.get(categoryId);
    return {
        id: categoryId || 'other',
        name: c && typeof c.name === 'string' && c.name ? c.name : (!categoryId || categoryId === 'other' ? t('a.act.cat.other') : String(categoryId)),
        icon: categoryIcon(c || { id: categoryId }),
        essential: !!(c && c.essential),
        known: !!c,
    };
}

/**
 * Bucket this row was MOVED to by hand, or null. Quick-add writes bucketId only when it differs from the
 * category's usual bucket (FT-R-46), and the Covered box shows only manual overrides, so a row counts when its
 * own bucketId is a live bucket other than Daily (spending that did not come out of Daily expenses).
 */
export function coveredFrom(row, category, planItem, allocation, buckets) {
    if (!row || !row.bucketId || !(row.amountCents < 0)) return null;
    const actual = effectiveBucket(row, category, planItem, allocation);
    if (!actual || actual !== row.bucketId) return null; // a stale or unknown bucketId is no override
    const b = (buckets || []).find((x) => x.id === actual);
    if (b && b.role === 'daily') return null;
    return { id: actual, name: bucketName(actual, buckets), role: b ? b.role : null };
}

function bucketName(id, buckets) {
    if (id === SPENDABLE_POOL) return t('a.act.pool');
    const b = (buckets || []).find((x) => x.id === id);
    return b && b.name ? b.name : String(id);
}

function topBuckets(data, today) {
    try {
        return getBuckets(data, today).filter((b) => !b.parentId).map((b) => ({ id: b.id, name: b.name, role: b.role, slot: b.slot }));
    } catch (_) {
        return (Array.isArray(data && data.allocation) ? data.allocation : []).filter((a) => a && a.id)
            .map((a, i) => ({ id: a.id, name: a.name || '', role: a.role || null, slot: i + 1 }));
    }
}

const SRC_KEYS = { csv: 'a.act.src.csv', pdf: 'a.act.src.pdf', manual: 'a.act.src.manual', sample: 'a.act.src.sample' };

/**
 * Status pills for one transaction, all read from the row: review (status), matched (billMatch),
 * covered (manual bucket). Each pill is { key, label, icon, cls }. Nothing is typed per row.
 */
export function txnStatus(row, ctx) {
    const pills = [];
    let action = null;
    if (row.status === 'review') {
        pills.push({ key: 'review', label: t('a.act.st.review'), icon: 'alert', cls: 'review' });
        action = { label: row.categoryId && row.categoryId !== 'other' ? t('a.act.st.confirm') : t('a.act.st.choose') };
    }
    if (row.billMatch) pills.push({ key: 'matched', label: t('a.act.st.matched'), icon: 'tick', cls: 'ok' });
    const cat = ctx.cats.get(row.categoryId);
    const plan = row.billMatch ? ctx.plan.get(row.billMatch.planId) : null;
    const cov = coveredFrom(row, cat, plan, ctx.allocation, ctx.buckets);
    if (cov) pills.push({ key: 'covered', label: t('a.act.st.covered', { bucket: cov.name }), icon: 'swap', cls: 'tag', role: cov.role, bucket: cov });
    return { pills, action, covered: cov };
}

/** Pill for one bill occurrence, from billStatus ('Upcoming', 'Due', 'Missed') and today. */
export function billPill(occ, todayIso) {
    if (occ.status === 'Due') return { key: 'due', label: t('a.act.st.dueToday'), icon: 'clock', cls: 'due' };
    if (occ.status === 'Missed') return { key: 'missed', label: t('a.act.st.missed', { date: dayLabel(occ.dueDate) }), icon: 'alert', cls: 'due' };
    const n = daysBetween(todayIso, occ.dueDate);
    const date = dayLabel(occ.dueDate);
    return { key: 'soon', label: n === 1 ? t('a.act.st.inDays.one', { date }) : t('a.act.st.inDays', { date, count: n }), icon: 'clock', cls: 'soon' };
}

function kindWord(cat, amountCents) {
    if (amountCents > 0) return t('a.act.kind.income');
    if (cat.id === 'other' || !cat.known) return t('a.act.kind.unsorted');
    return cat.essential ? t('a.act.kind.essential') : t('a.act.kind.nonessential');
}

function buildCtx(data, today) {
    const cats = new Map((Array.isArray(data && data.categories) ? data.categories : []).map((c) => [c.id, c]));
    const plan = new Map((Array.isArray(data && data.plan) ? data.plan : []).map((p) => [p.id, p]));
    const allocation = (Array.isArray(data && data.allocation) ? data.allocation : []).filter((a) => a && a.id);
    return { cats, plan, allocation, buckets: topBuckets(data, today), today };
}

function decorate(item, ctx) {
    if (item.type === 'bill') {
        const plan = ctx.plan.get(item.planId);
        const cat = catFacts(plan && plan.categoryId, ctx.cats);
        const freq = plan && plan.frequency && ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'].includes(plan.frequency) ? plan.frequency : null;
        return {
            kind: 'bill', key: `${item.planId}|${item.dueDate}`, name: item.name, date: item.dueDate,
            amountCents: -abs(item.amountCents), cat,
            src: freq ? t('a.act.bill.freq', { freq: t(`a.act.freq.${freq}`) }) : t('a.act.bill'),
            kindText: kindWord(cat, -1), pills: [billPill(item, ctx.today)], action: null, isBill: true, status: item.status,
        };
    }
    const row = item.row;
    const cat = catFacts(row.categoryId, ctx.cats);
    const st = txnStatus(row, ctx);
    return {
        kind: 'txn', key: row.id, id: row.id, name: row.description || '', date: row.date, amountCents: row.amountCents, cat,
        src: t(SRC_KEYS[row.source] || 'a.act.src.other'), kindText: kindWord(cat, row.amountCents),
        pills: st.pills, action: st.action, covered: st.covered, isBill: !!row.billMatch, review: row.status === 'review', row,
    };
}

// ---------- filter and search ----------

export function matchesFilter(d, filter) {
    switch (filter) {
        case 'review': return d.kind === 'txn' && d.review;
        case 'essential': return d.amountCents < 0 && d.cat.essential;
        case 'nonessential': return d.amountCents < 0 && !d.cat.essential;
        case 'income': return d.kind === 'txn' && d.amountCents > 0;
        case 'bills': return d.isBill;
        default: return true;
    }
}

export function matchesQuery(d, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    if (d.name.toLowerCase().includes(q) || d.cat.name.toLowerCase().includes(q)) return true;
    const num = q.replace(/[^0-9.]/g, '');
    if (!num) return false;
    const amount = (abs(d.amountCents) / 100).toFixed(2);
    return amount.includes(num) || amount.replace(/\.00$/, '').includes(num);
}

// ---------- the view model ----------

/**
 * @param {{feed:object, model:object, data:object, today:string, filter?:string, query?:string}} input
 *   feed = activityFeed() result, model = todayModel() result (both ready), data = financeData.
 */
export function buildActivityView({ feed, model, data, today, filter = 'all', query = '' }) {
    const ctx = buildCtx(data, today);
    const monthMode = model && model.mode === 'month';
    const f = ACTIVITY_FILTERS.includes(filter) ? filter : 'all';
    const keep = (d) => matchesFilter(d, f) && matchesQuery(d, query);

    const all = [];
    const days = [];
    for (const day of feed.days) {
        const items = [];
        for (const it of day.items) {
            // Bills still to come are shown under Coming up; a past unpaid one (Missed) stays in its day.
            if (it.type === 'bill' && it.dueDate >= today) continue;
            const d = decorate(it, ctx);
            all.push(d);
            if (keep(d)) items.push(d);
        }
        if (!items.length) continue;
        const spent = items.filter((d) => d.kind === 'txn' && d.amountCents < 0).reduce((a, d) => a - d.amountCents, 0);
        const inCents = items.filter((d) => d.kind === 'txn' && d.amountCents > 0).reduce((a, d) => a + d.amountCents, 0);
        const isPay = !monthMode && day.date === feed.range.from && inCents > 0;
        days.push({
            date: day.date, spentCents: spent, inCents, isToday: day.date === today, isPay,
            label: day.date === today ? t('a.act.day.today', { date: dayLabel(day.date) })
                : isPay ? t('a.act.day.payDay', { date: dayLabel(day.date) }) : dayLabel(day.date),
            items,
        });
    }

    const coming = feed.comingUp.map((o) => decorate(o, ctx));
    const comingShown = coming.filter(keep);
    const comingTotal = comingShown.reduce((a, d) => a + abs(d.amountCents), 0);

    const txnAll = all.filter((d) => d.kind === 'txn');
    const reviewRows = feed.toReview.map((r) => decorate({ type: 'txn', row: r }, ctx));
    const covered = txnAll.filter((d) => d.covered).map((d) => ({ ...d, who: `${d.name}, ${dayLabel(d.date)}` }));

    // This pay so far: figures from the Today model (one source), money in from the feed rows.
    let summary = null;
    if (model && model.ready) {
        const head = (model.buckets || []).find((b) => b.role === 'daily') || (model.buckets || []).find((b) => b.id === SPENDABLE_POOL) || (model.buckets || [])[0];
        const alloc = head ? ctx.allocation.find((a) => a.id === head.id) : null;
        const pct = alloc ? Number(alloc.percentage != null ? alloc.percentage : alloc.pct) || 0 : 0;
        const name = head ? bucketName(head.id, ctx.buckets) : t('a.act.pool');
        summary = {
            title: monthMode ? t('a.act.sum.titleMonth') : t('a.act.sum.titlePay'),
            inCents: txnAll.filter((d) => d.amountCents > 0).reduce((a, d) => a + d.amountCents, 0),
            poolLabel: alloc && pct > 0 ? t('a.act.sum.pool', { name, pct: Math.round(pct * 10) / 10 }) : t('a.act.sum.poolPlain', { name }),
            poolCents: model.poolCents, spentCents: model.spentCents, billsDueCents: model.billsDueCents, leftCents: model.leftCents,
            leftLabel: monthMode ? t('a.act.sum.leftMonth') : t('a.act.sum.leftPay'),
        };
    }

    // Where it went: spending by category over the range, with its kind and share.
    const whereRows = feed.whereItWent.map((w) => {
        const cat = catFacts(w.categoryId, ctx.cats);
        const unsorted = cat.id === 'other' || !cat.known;
        const kind = unsorted ? t('a.act.kind.unsorted') : cat.essential ? t('a.act.kind.essential') : t('a.act.kind.nonessential');
        const hasReview = unsorted && txnAll.some((d) => d.review && d.cat.id === cat.id);
        const pct = Math.round(w.share * 100);
        return {
            cat, unsorted, spentCents: w.spentCents, share: w.share, pct, kind,
            name: hasReview ? t('a.act.where.otherReview', { name: cat.name }) : cat.name,
            line: t('a.act.where.line', { pct, kind }),
        };
    });
    const sumWhere = (fn) => whereRows.filter(fn).reduce((a, w) => a + w.spentCents, 0);
    const where = {
        title: monthMode ? t('a.act.where.hMonth') : t('a.act.where.h'),
        sub: monthMode ? t('a.act.where.subMonth', { date: dayLabel(feed.range.from) }) : t('a.act.where.sub', { date: dayLabel(feed.range.from) }),
        totalCents: feed.spentCents,
        essentialCents: sumWhere((w) => !w.unsorted && w.cat.essential),
        nonEssentialCents: sumWhere((w) => !w.unsorted && !w.cat.essential),
        unsortedCents: sumWhere((w) => w.unsorted),
        rows: whereRows,
    };

    const txnCount = txnAll.length;
    const chips = ACTIVITY_FILTERS.map((id) => ({ id, label: t(`a.act.f.${id}`), count: id === 'review' && feed.toReviewCount > 0 ? feed.toReviewCount : null, on: id === f }));
    return {
        ready: true, filter: f, query: String(query || ''), monthMode, chips,
        sub: t('a.act.sub.range', {
            lead: monthMode ? t('a.act.sub.month') : t('a.act.sub.pay'), from: dayLabel(feed.range.from, false), to: dayLabel(feed.range.to, false),
            txns: plural(txnCount, 'a.act.txns.one', 'a.act.txns.many'), bills: plural(feed.comingUp.length, 'a.act.bills.one', 'a.act.bills.many'),
        }),
        summary,
        reviewBox: reviewRows.length ? { count: reviewRows.length, items: reviewRows.slice(0, 3) } : null,
        coveredBox: covered.length ? { items: covered } : null,
        coming: { items: comingShown, totalCents: comingTotal, monthMode },
        days, where,
        empty: txnCount === 0 && feed.comingUp.length === 0,
        hasResults: days.length > 0 || comingShown.length > 0,
    };
}

// ---------- HTML ----------

const moneyCls = (cents) => (cents > 0 ? 'money plus' : 'money');

function pillHtml(p) {
    const cls = p.key === 'covered' && p.role ? `pill b-${esc(p.role)}` : `pill ${esc(p.cls)}`;
    return `<span class="${cls}">${iconSvg(p.icon)}${esc(p.label)}</span>`;
}

function rowHtml(d, coming) {
    const isTxn = d.kind === 'txn';
    const label = isTxn ? t('a.act.row.edit', { name: d.name }) : t('a.act.row.bill', { name: d.name });
    const attrs = isTxn ? `data-act-edit="${esc(d.id)}"` : 'data-act-plan="1"';
    const pills = d.pills.map(pillHtml).join('');
    const action = d.action ? `<button type="button" class="st-act" ${attrs}>${esc(d.action.label)}</button>` : '';
    const st = pills || action ? `<span class="st">${pills}${action}</span>` : '<span class="st"></span>';
    const catLine = `<span class="cat">${iconSvg(d.cat.icon)}<span class="cat-name">${esc(d.cat.name)}</span> <span class="k">· ${esc(d.kindText)}</span></span>`;
    const due = coming && d.pills[0] && d.pills[0].key === 'due' ? ' is-due' : '';
    return `<li class="txn"><button type="button" class="n" ${attrs} aria-label="${esc(label)}">${esc(d.name)}</button>`
        + `<span class="src">${esc(d.src)}</span>${catLine}${st}`
        + `<span class="${moneyCls(d.amountCents)}${due}">${esc(signedMoney(d.amountCents))}</span></li>`;
}

export function renderSummaryHtml(v) {
    const s = v.summary;
    const dl = s ? `<dl class="sum-dl">
            <div><dt>${esc(t('a.act.sum.in'))}</dt><dd class="${s.inCents > 0 ? 'money plus' : 'money'}">${esc(s.inCents > 0 ? '+' + dollars(s.inCents) : dollars(0))}</dd></div>
            <div><dt>${esc(s.poolLabel)}</dt><dd class="money">${esc(dollars(s.poolCents))}</dd></div>
            <div><dt>${esc(t('a.act.sum.spent'))}</dt><dd class="money">${esc(dollars(s.spentCents))}</dd></div>
            <div><dt>${esc(t('a.act.sum.bills'))}</dt><dd class="money">${esc(dollars(s.billsDueCents))}</dd></div>
            <div class="left"><dt>${esc(s.leftLabel)}</dt><dd class="money">${esc((s.leftCents < 0 ? '−' : '') + dollars(s.leftCents))}</dd></div>
        </dl>` : '';
    const rb = v.reviewBox;
    const review = rb ? `<section class="box box-review" aria-labelledby="act-h-rev">
            <h3 id="act-h-rev">${iconSvg('alert')}${esc(plural(rb.count, 'a.act.review.h.one', 'a.act.review.h.many'))}</h3>
            <p>${esc(t('a.act.review.p'))}</p>
            <ul>${rb.items.map((d) => `<li><span>${esc(d.name)}</span><span class="money">${esc(dollars(d.amountCents))}</span></li>`).join('')}</ul>
            <button class="btn" type="button" data-act-filter="review">${esc(rb.count === 1 ? t('a.act.review.show.one') : t('a.act.review.show', { count: rb.count }))}</button>
        </section>` : '';
    const cb = v.coveredBox;
    const covered = cb ? `<section class="box box-covered" aria-labelledby="act-h-cov">
            <h3 id="act-h-cov">${esc(t('a.act.covered.h'))}</h3>
            <p>${esc(t('a.act.covered.p'))}</p>
            <ul>${cb.items.map((d) => {
        const p = d.pills.find((x) => x.key === 'covered');
        const tag = p ? `<span class="tag${p.role ? ` b-${esc(p.role)}` : ''}">${esc(t('a.act.covered.from', { bucket: p.bucket.name }))}</span>` : '';
        return `<li><span class="who">${esc(d.who)}</span><span class="money">${esc(dollars(d.amountCents))}</span>${tag}</li>`;
    }).join('')}</ul>
        </section>` : '';
    const boxes = review || covered ? `<div class="boxes">${review}${covered}</div>` : '';
    return `<h2 id="act-h-sum">${esc(s ? s.title : t('a.act.sum.titlePay'))}</h2><div class="sum-body">${dl}${boxes}</div>`;
}

export function renderListHtml(v) {
    if (v.empty) {
        return `<div class="card act-empty"><p>${esc(t('a.act.empty'))}</p><button type="button" class="btn" data-quick-add>${iconSvg('import').replace(/<path[^>]*>/, '<path d="M8 3v10M3 8h10"/>')}${esc(t('a.act.emptyAdd'))}</button></div>`;
    }
    if (!v.hasResults) {
        const msg = v.filter === 'review' && !v.query ? t('a.act.noReview') : t('a.act.noMatch');
        return `<div class="card act-empty"><p>${esc(msg)}</p><button type="button" class="btn" data-act-clear>${esc(t('a.act.showAll'))}</button></div>`;
    }
    const parts = [];
    if (v.coming.items.length) {
        const total = esc(dollars(v.coming.totalCents));
        const note = esc(t(v.coming.monthMode ? 'a.act.coming.beforeMonth' : 'a.act.coming.before', { amount: '\u0001' })).replace('\u0001', `<b class="money">${total}</b>`);
        parts.push(`<section class="day coming" aria-labelledby="act-g-soon"><div class="day-head"><h2 id="act-g-soon">${esc(t('a.act.coming.h'))}</h2><span class="total">${note}</span></div>
            <ul class="card rows">${v.coming.items.map((d) => rowHtml(d, true)).join('')}</ul></section>`);
    }
    for (const day of v.days) {
        const spent = day.spentCents > 0 ? esc(t('a.act.day.spent', { amount: '\u0001' })).replace('\u0001', `<b class="money">${esc(dollars(day.spentCents))}</b>`) : '';
        const inn = day.inCents > 0 ? esc(t('a.act.day.in', { amount: '\u0001' })).replace('\u0001', `<b class="money plus">+${esc(dollars(day.inCents))}</b>`) : '';
        const total = [spent, inn].filter(Boolean).join(' · ');
        parts.push(`<section class="day" aria-labelledby="act-g-${esc(day.date)}"><div class="day-head"><h2 id="act-g-${esc(day.date)}">${esc(day.label)}</h2><span class="total">${total}</span></div>
            <ul class="card rows">${day.items.map((d) => rowHtml(d, false)).join('')}</ul></section>`);
    }
    return parts.join('');
}

export function renderWhereHtml(v) {
    const w = v.where;
    const kinds = [
        [t('a.act.where.essential'), w.essentialCents], [t('a.act.where.nonessential'), w.nonEssentialCents],
        [t('a.act.where.unsorted'), w.unsortedCents],
    ].filter(([, c]) => c > 0);
    const grid = w.rows.length ? `<ul class="wi-grid">${w.rows.map((r) => `<li${r.unsorted ? ' class="unsorted"' : ''}>
            <span class="nm">${iconSvg(r.cat.icon)}${esc(r.name)}</span><span class="v money">${esc(dollars(r.spentCents))}</span>
            <span class="s">${esc(r.line)}</span>
            <span class="bar" role="img" aria-label="${esc(t('a.act.where.share', { pct: r.pct }))}"><i style="width:${Math.max(0, Math.min(100, r.share * 100)).toFixed(1)}%"></i></span></li>`).join('')}</ul>`
        : `<p class="muted">${esc(t('a.act.where.none'))}</p>`;
    return `<div class="card-head"><h2 id="act-h-where">${esc(w.title)}</h2></div>
        <div class="wi-top"><div><p class="total money">${esc(dollars(w.totalCents))}</p><p class="total-sub">${esc(w.sub)}</p></div>
        <ul class="wi-kind">${kinds.map(([k, c]) => `<li><span class="k">${esc(k)}</span><span class="money">${esc(dollars(c))}</span></li>`).join('')}</ul></div>${grid}`;
}

export function renderChipsHtml(v) {
    return v.chips.map((c) => `<button type="button" class="chip" data-act-filter="${esc(c.id)}" aria-pressed="${c.on ? 'true' : 'false'}">${esc(c.label)}${c.count != null ? ` <span class="c">${esc(c.count)}</span>` : ''}</button>`).join('');
}

// ---------- the screen ----------

let filter = 'all';
let query = '';
let lastFeed = null;

export function setActivityFilter(id) {
    filter = ACTIVITY_FILTERS.includes(id) ? id : 'all';
}

export function getActivityFilter() { return filter; }

/** After an import: turn To review on and show Activity (FT-R-55, X-21). */
export async function openActivityToReview() {
    setActivityFilter('review');
    query = '';
    const input = document.getElementById('act-search');
    if (input) input.value = '';
    const { showTab } = await import('./tabs.js'); // tabs.js reaches render.js, which imports this file
    showTab('activity');
    renderActivity(); // the tab may already be showing, so showTab alone would not repaint the chips
}

const todayIsoNow = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function skeleton(body) {
    body.innerHTML = `<div class="act-skel" aria-busy="true"><p class="muted">${esc(t('a.act.loading'))}</p></div>`;
    body.dataset.ready = '';
}

function ensureShell(body) {
    if (body.dataset.ready === '1') return;
    body.dataset.ready = '1';
    body.innerHTML = `<div class="toolbar">
            <label class="search">${iconSvg('search')}<span class="sr">${esc(t('a.act.search'))}</span><input id="act-search" type="search" autocomplete="off" placeholder="${esc(t('a.act.searchPlaceholder'))}"></label>
            <div class="chips" id="act-chips" role="group" aria-label="${esc(t('a.act.filters'))}"></div>
        </div>
        <div class="grid act">
            <aside class="card act-sum" id="act-sum" aria-labelledby="act-h-sum"></aside>
            <div class="act-list" id="act-list"></div>
            <section class="card act-where" id="act-where" aria-labelledby="act-h-where"></section>
        </div>`;
    const input = body.querySelector('#act-search');
    input.value = query;
    input.addEventListener('input', () => { query = input.value; renderActivity(); });
}

export function renderActivity() {
    const body = document.getElementById('activity-body');
    if (!body) return;
    const sub = document.getElementById('activity-sub');
    const feed = activityFeed();
    const model = todayModel();
    if (!feed.ready || !model.ready) {
        if (sub) sub.textContent = t('a.activity.sub');
        if (body.dataset.ready !== '') skeleton(body);
        return;
    }
    ensureShell(body);
    const v = buildActivityView({ feed, model, data: store.financeData, today: todayIsoNow(), filter, query });
    lastFeed = feed;
    if (sub) sub.textContent = v.sub;
    body.querySelector('#act-chips').innerHTML = renderChipsHtml(v);
    body.querySelector('#act-sum').innerHTML = renderSummaryHtml(v);
    body.querySelector('#act-list').innerHTML = renderListHtml(v);
    body.querySelector('#act-where').innerHTML = renderWhereHtml(v);
}

/**
 * FT-R-61: a row opens Quick-add in edit mode, openQuickAdd({ txn }) (A8 owns the sheet, its Delete and the Undo toast).
 */
export function editRow(row) {
    return openQuickAdd({ txn: row });
}

let wired = false;
export function setupActivityEvents() {
    if (wired) return;
    wired = true;
    document.addEventListener('click', async (event) => {
        const scope = event.target.closest && event.target.closest('#activity-body');
        if (!scope) return;
        const f = event.target.closest('[data-act-filter]');
        if (f) { setActivityFilter(f.dataset.actFilter); renderActivity(); return; }
        if (event.target.closest('[data-act-clear]')) {
            setActivityFilter('all'); query = '';
            const input = document.getElementById('act-search');
            if (input) input.value = '';
            renderActivity();
            return;
        }
        const ed = event.target.closest('[data-act-edit]');
        if (ed && lastFeed) {
            const id = ed.dataset.actEdit;
            const row = lastFeed.days.flatMap((d) => d.items).find((it) => it.type === 'txn' && it.row.id === id);
            if (row) editRow(row.row);
            return;
        }
        if (event.target.closest('[data-act-plan]')) {
            const { showTab } = await import('./tabs.js');
            showTab('plan');
        }
    });
}
if (typeof document !== 'undefined') setupActivityEvents();
