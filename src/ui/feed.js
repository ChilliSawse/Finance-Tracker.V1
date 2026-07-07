// Home — the activity feed. A narrative timeline of what's happening with your
// money (imports, milestones, bills due), topped by a conversational greeting
// and three "pulse" tiles with trend sparklines.
//
// Events come from the IndexedDB event log as {type, data} facts; this module
// turns them into copy at render time via the i18n catalogue (src/i18n/en.js).
// All colours are theme tokens so every preset/custom theme works.
// Interpolated params are escaped here — t() does not escape.

import { store } from '../state/store.js';
import { getElement, setHTML, escapeHtml, formatCurrency, fitAllAmounts } from '../utils.js';
import { calculateTotals } from '../calc/calculations.js';
import { listRecentEvents } from '../state/eventlog.js';
import { listSnapshots, snapshotBefore } from '../state/snapshots.js';
import { upcomingBills } from '../state/bills.js';
import { sparklineSvg } from './sparkline.js';
import { t } from '../i18n/strings.js';

// ---------- greeting ----------

function greetingTitle() {
    const h = new Date().getHours();
    if (h < 5) return t('greeting.lateNight');
    if (h < 12) return t('greeting.morning');
    if (h < 18) return t('greeting.afternoon');
    return t('greeting.evening');
}

// One insight line, picked by priority — a financially-literate friend's summary.
function insightLine(totals) {
    if (totals.totalNetAnnualIncome <= 0 && totals.totalWeeklyExpenses <= 0) {
        return t('insight.gettingStarted');
    }
    if (totals.savingsRate < 0) {
        return t('insight.overspending');
    }
    const prev = snapshotBefore(30);
    if (prev && prev.netWorth !== 0 && totals.netWorth > prev.netWorth) {
        const pct = ((totals.netWorth - prev.netWorth) / Math.abs(prev.netWorth)) * 100;
        if (pct >= 0.5) return t('insight.netWorthUp', { pct: pct.toFixed(1) });
    }
    if (totals.savingsRate >= 20) {
        return t('insight.savingsStrong', { rate: totals.savingsRate.toFixed(0) });
    }
    if (totals.savingsRate > 0) {
        return t('insight.savingsSome', { rate: totals.savingsRate.toFixed(0) });
    }
    return t('insight.default');
}

// ---------- pulse tiles ----------

function deltaChip(now, before, { asPercentOfBefore = true, goodIsUp = true } = {}) {
    if (before == null || now == null) return '';
    const diff = now - before;
    if (Math.abs(diff) < 0.005) return '';
    let label;
    if (asPercentOfBefore && Math.abs(before) > 0.005) {
        label = `${Math.abs((diff / Math.abs(before)) * 100).toFixed(1)}%`;
    } else {
        label = formatCurrency(Math.abs(diff));
    }
    const up = diff > 0;
    const good = goodIsUp ? up : !up;
    return `<span class="pulse-delta ${good ? 'is-good' : 'is-bad'}">${up ? '↑' : '↓'} ${label}${t('pulse.deltaSuffix')}</span>`;
}

function renderPulse(totals) {
    const el = getElement('home-pulse');
    if (!el) return;

    const snaps = listSnapshots();
    const nwSeries = snaps.slice(-30).map(s => s.netWorth);
    const srSeries = snaps.slice(-30).map(s => s.savingsRate);
    const prev30 = snapshotBefore(30);

    const fortnightlySavings = totals.weeklySavings * 2;

    el.innerHTML = `
        <div class="pulse-tile">
            <div class="pulse-label">${t('pulse.netWorth')}</div>
            <div class="pulse-value amount${totals.netWorth < 0 ? ' is-negative-value' : ''}">${formatCurrency(totals.netWorth)}</div>
            ${deltaChip(totals.netWorth, prev30 ? prev30.netWorth : null)}
            ${sparklineSvg(nwSeries)}
        </div>
        <div class="pulse-tile">
            <div class="pulse-label">${t('pulse.savingsRate')}</div>
            <div class="pulse-value amount${totals.savingsRate < 0 ? ' is-negative-value' : ''}">${totals.savingsRate.toFixed(1)}%</div>
            ${totals.savingsRate >= 20 ? `<span class="pulse-delta is-good">${t('pulse.onTarget')}</span>` : ''}
            ${sparklineSvg(srSeries)}
        </div>
        <div class="pulse-tile">
            <div class="pulse-label">${t('pulse.leftover')}</div>
            <div class="pulse-value amount${fortnightlySavings < 0 ? ' is-negative-value' : ''}">${formatCurrency(fortnightlySavings)}</div>
            <span class="pulse-sub">${t('pulse.leftoverSub')}</span>
        </div>`;
}

// ---------- coming up (bills due in the next fortnight) ----------

function renderUpcoming() {
    const el = getElement('home-upcoming');
    if (!el) return;
    const soon = upcomingBills(store.financeData, 14);
    if (!soon.length) { el.innerHTML = ''; return; }
    const total = soon.reduce((sum, u) => sum + (parseFloat(u.bill.amount) || 0), 0);
    const rows = soon.map(u => `
        <div class="upcoming-row">
            <span class="upcoming-name">${escapeHtml(u.bill.name)}</span>
            <span class="upcoming-due${u.dueInDays <= 2 ? ' is-close' : ''}">${escapeHtml(u.dueLabel)}</span>
            <span class="upcoming-amount">${formatCurrency(parseFloat(u.bill.amount) || 0)}</span>
        </div>`).join('');
    el.innerHTML = `
        <div class="upcoming-card">
            <div class="upcoming-head">
                <span class="upcoming-title">${t('upcoming.title')}</span>
                <span class="upcoming-total">${t('upcoming.summary', {
                    count: soon.length,
                    billWord: t(soon.length === 1 ? 'upcoming.billOne' : 'upcoming.billMany'),
                    total: formatCurrency(total),
                })}</span>
            </div>
            ${rows}
        </div>`;
}

// ---------- feed ----------

const DAY_MS = 24 * 60 * 60 * 1000;

function clusterLabel(ts) {
    const then = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.floor((startOfToday - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / DAY_MS);
    if (diffDays <= 0) return t('feed.today');
    if (diffDays === 1) return t('feed.yesterday');
    if (diffDays < 7) return t('feed.thisWeek');
    if (diffDays < 31) return t('feed.thisMonth');
    return t('feed.earlier');
}

function timeLabel(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function dateLabel(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Turn one event into { html, kind } — or null to hide it from the feed.
// kind drives the timeline dot colour: 'good' | 'info' | 'warn' | 'note'.
function composeEvent(event) {
    const d = event.data || {};
    switch (event.type) {
        case 'import':
            return {
                kind: 'info',
                html: t('feed.import', {
                    count: d.count,
                    txnWord: t(d.count === 1 ? 'feed.import.txnOne' : 'feed.import.txnMany'),
                    fromSource: d.sourceName ? t('feed.import.fromSource', { source: escapeHtml(d.sourceName) }) : '',
                }),
            };
        case 'milestone':
            if (d.kind === 'net-worth') {
                return {
                    kind: 'good',
                    html: t('feed.milestone.netWorth', { threshold: formatCurrency(d.threshold), value: formatCurrency(d.value) }),
                };
            }
            if (d.kind === 'savings-rate') {
                return {
                    kind: 'good',
                    html: t('feed.milestone.savingsRate', { threshold: d.threshold, value: d.value }),
                };
            }
            return null;
        case 'bill-due':
            return {
                kind: 'warn',
                html: t('feed.billDue', {
                    name: escapeHtml(d.name),
                    due: escapeHtml(d.dueLabel || t('feed.billDueSoon')),
                    amount: formatCurrency(d.amount),
                }),
            };
        case 'income-added':
            return {
                kind: 'good',
                html: t('feed.incomeAdded', {
                    name: escapeHtml(d.name),
                    amountPart: d.amount ? ` (${formatCurrency(d.amount)} ${escapeHtml(d.schedule || '')})` : '',
                }),
            };
        case 'note':
            return { kind: 'note', html: escapeHtml(d.text || '') };
        default:
            return null; // unknown/internal types stay out of the feed
    }
}

function renderFeedItems(events) {
    let html = '';
    let currentCluster = null;
    const todayLabel = t('feed.today');
    const yesterdayLabel = t('feed.yesterday');
    for (const event of events) {
        const composed = composeEvent(event);
        if (!composed) continue;
        const cluster = clusterLabel(event.ts);
        if (cluster !== currentCluster) {
            currentCluster = cluster;
            html += `<div class="feed-cluster-label">${cluster}</div>`;
        }
        const when = (cluster === todayLabel || cluster === yesterdayLabel) ? timeLabel(event.ts) : dateLabel(event.ts);
        html += `
            <div class="feed-item feed-kind-${composed.kind}">
                <span class="feed-dot" aria-hidden="true"></span>
                <div class="feed-body">
                    <p class="feed-text">${composed.html}</p>
                    <span class="feed-time">${when}</span>
                </div>
            </div>`;
    }
    return html;
}

/**
 * Render the Home tab (greeting + pulse tiles + activity feed). Async because
 * the event log lives in IndexedDB; safe to call on every tab activation.
 */
export async function renderHomeFeed() {
    const totals = calculateTotals(store.financeData);

    const titleEl = getElement('home-greeting-title');
    if (titleEl) titleEl.textContent = greetingTitle();
    const subEl = getElement('home-greeting-sub');
    if (subEl) subEl.textContent = insightLine(totals);

    renderPulse(totals);
    renderUpcoming();

    let events = [];
    try {
        events = await listRecentEvents(60);
    } catch (_) {
        // IndexedDB unavailable (rare: private windows on some browsers) — the
        // feed degrades to the pulse tiles; nothing breaks.
    }
    const itemsHtml = renderFeedItems(events);
    setHTML('home-feed', itemsHtml || `
        <div class="feed-empty">
            <p class="feed-empty-title">${t('feed.empty.title')}</p>
            <p class="feed-empty-sub">${t('feed.empty.sub')}</p>
        </div>`);

    fitAllAmounts(getElement('home'));
}
