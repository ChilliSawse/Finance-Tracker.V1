// Home — the activity feed. A narrative timeline of what's happening with your
// money (imports, milestones, bills due), topped by a conversational greeting
// and three "pulse" tiles with trend sparklines.
//
// Events come from the IndexedDB event log as {type, data} facts; this module
// owns turning them into copy at render time. All colours are theme tokens so
// every preset/custom theme works.

import { store } from '../state/store.js';
import { getElement, setHTML, escapeHtml, formatCurrency, fitAllAmounts } from '../utils.js';
import { calculateTotals } from '../calc/calculations.js';
import { listRecentEvents } from '../state/eventlog.js';
import { listSnapshots, snapshotBefore } from '../state/snapshots.js';
import { upcomingBills } from '../state/bills.js';
import { sparklineSvg } from './sparkline.js';

// ---------- greeting ----------

function greetingTitle() {
    const h = new Date().getHours();
    if (h < 5) return 'Up late?';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}

// One insight line, picked by priority — a financially-literate friend's summary.
function insightLine(totals) {
    if (totals.totalNetAnnualIncome <= 0 && totals.totalWeeklyExpenses <= 0) {
        return "Let's get your money story started.";
    }
    if (totals.savingsRate < 0) {
        return "Spending is running ahead of income right now — worth a look at the Expenses tab.";
    }
    const prev = snapshotBefore(30);
    if (prev && prev.netWorth !== 0 && totals.netWorth > prev.netWorth) {
        const pct = ((totals.netWorth - prev.netWorth) / Math.abs(prev.netWorth)) * 100;
        if (pct >= 0.5) return `Net worth is up ${pct.toFixed(1)}% this month. Keep it rolling.`;
    }
    if (totals.savingsRate >= 20) {
        return `You're saving ${totals.savingsRate.toFixed(0)}% of your income. That's the good stuff.`;
    }
    if (totals.savingsRate > 0) {
        return `You're saving ${totals.savingsRate.toFixed(0)}% of your income — every point counts.`;
    }
    return "Here's what's happening with your money.";
}

// ---------- pulse tiles ----------

function deltaChip(now, before, { asPercentOfBefore = true, suffix = ' this month', goodIsUp = true } = {}) {
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
    return `<span class="pulse-delta ${good ? 'is-good' : 'is-bad'}">${up ? '↑' : '↓'} ${label}${suffix}</span>`;
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
            <div class="pulse-label">Net worth</div>
            <div class="pulse-value amount${totals.netWorth < 0 ? ' is-negative-value' : ''}">${formatCurrency(totals.netWorth)}</div>
            ${deltaChip(totals.netWorth, prev30 ? prev30.netWorth : null)}
            ${sparklineSvg(nwSeries)}
        </div>
        <div class="pulse-tile">
            <div class="pulse-label">Savings rate</div>
            <div class="pulse-value amount${totals.savingsRate < 0 ? ' is-negative-value' : ''}">${totals.savingsRate.toFixed(1)}%</div>
            ${totals.savingsRate >= 20 ? '<span class="pulse-delta is-good">on target</span>' : ''}
            ${sparklineSvg(srSeries)}
        </div>
        <div class="pulse-tile">
            <div class="pulse-label">Left over each fortnight</div>
            <div class="pulse-value amount${fortnightlySavings < 0 ? ' is-negative-value' : ''}">${formatCurrency(fortnightlySavings)}</div>
            <span class="pulse-sub">after tax and all expenses</span>
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
            <span class="upcoming-due${u.dueInDays <= 2 ? ' is-close' : ''}">${u.dueLabel}</span>
            <span class="upcoming-amount">${formatCurrency(parseFloat(u.bill.amount) || 0)}</span>
        </div>`).join('');
    el.innerHTML = `
        <div class="upcoming-card">
            <div class="upcoming-head">
                <span class="upcoming-title">Coming up</span>
                <span class="upcoming-total">${soon.length} bill${soon.length === 1 ? '' : 's'} · ${formatCurrency(total)} in the next fortnight</span>
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
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This week';
    if (diffDays < 31) return 'This month';
    return 'Earlier';
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
                html: `You imported <strong>${d.count}</strong> transaction${d.count === 1 ? '' : 's'}${d.sourceName ? ' from ' + escapeHtml(d.sourceName) : ''}.`,
            };
        case 'milestone':
            if (d.kind === 'net-worth') {
                return {
                    kind: 'good',
                    html: `Net worth crossed <strong>${formatCurrency(d.threshold)}</strong> — you're at ${formatCurrency(d.value)}.`,
                };
            }
            if (d.kind === 'savings-rate') {
                return {
                    kind: 'good',
                    html: `Your savings rate hit <strong>${d.threshold}%</strong> — you're keeping ${d.value}% of what you earn.`,
                };
            }
            return null;
        case 'bill-due':
            return {
                kind: 'warn',
                html: `<strong>${escapeHtml(d.name)}</strong> is due ${escapeHtml(d.dueLabel || 'soon')} — ${formatCurrency(d.amount)}.`,
            };
        case 'income-added':
            return {
                kind: 'good',
                html: `You added <strong>${escapeHtml(d.name)}</strong>${d.amount ? ` (${formatCurrency(d.amount)} ${escapeHtml(d.schedule || '')})` : ''}.`,
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
    for (const event of events) {
        const composed = composeEvent(event);
        if (!composed) continue;
        const cluster = clusterLabel(event.ts);
        if (cluster !== currentCluster) {
            currentCluster = cluster;
            html += `<div class="feed-cluster-label">${cluster}</div>`;
        }
        const when = (cluster === 'Today' || cluster === 'Yesterday') ? timeLabel(event.ts) : dateLabel(event.ts);
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

const FEED_EMPTY_HTML = `
    <div class="feed-empty">
        <p class="feed-empty-title">Your story starts here</p>
        <p class="feed-empty-sub">As things happen — a bank import, a milestone, a bill coming up —
        they'll show up in this feed. Add your income and expenses to get the first entries rolling.</p>
    </div>`;

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
    setHTML('home-feed', itemsHtml || FEED_EMPTY_HTML);

    fitAllAmounts(getElement('home'));
}
