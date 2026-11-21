// Feed items — the event log ({type, data} facts) turned into copy through the i18n
// catalogue (src/i18n/en.js). A6: the greeting, pulse tiles and "coming up" card are gone;
// Today owns the screen and this file supplies its Story rows (renderHomeFeed, storyRows).
// A12a removed the unused item renderer (renderFeedItems).
// All colours are theme tokens. Interpolated params are escaped here — t() does not escape.

import { getElement, setHTML, escapeHtml, formatCurrency } from '../utils.js';
import { listRecentEvents } from '../state/eventlog.js';
import { todayModel } from '../state/today-model.js';
import { t } from '../i18n/strings.js';
import { escNum } from './html.js';

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
                    count: escNum(d.count),
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
                    html: t('feed.milestone.savingsRate', { threshold: escNum(d.threshold), value: escNum(d.value) }),
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

/** Story rows for Today: up to `limit` event lines dated on or after `since` (epoch ms), newest first. */
export function storyRows(events, since, limit) {
    const out = [];
    for (const event of events) {
        if (out.length >= limit) break;
        if (Number(event.ts) < since) continue;
        const composed = composeEvent(event);
        if (!composed) continue;
        out.push({ kind: composed.kind, html: composed.html, when: clusterLabel(event.ts) === t('feed.today') ? `${t('feed.today')} · ${timeLabel(event.ts)}` : dateLabel(event.ts) });
    }
    return out;
}

/**
 * Fill Today's Story list (#today-story-events) from the event log. Async because the log
 * lives in IndexedDB; safe to call on every activation. The model supplies the cycle start
 * and how many rows the To-review line already used.
 */
export async function renderHomeFeed() {
    const el = document.getElementById('today-story-events');
    if (!el) return;
    const m = todayModel();
    if (!m.ready) return;
    const used = Number(el.dataset.used) || 0;
    let events = [];
    try {
        events = await listRecentEvents(60);
    } catch (_) {
        // IndexedDB unavailable (rare: private windows on some browsers): the Story keeps its other lines.
    }
    const [y, mo, d] = m.cycle.start.split('-').map(Number);
    const rows = storyRows(events, new Date(y, mo - 1, d).getTime(), Math.max(0, 3 - used));
    const html = rows.map((r) => `
        <li><span class="dot" aria-hidden="true"></span><div><p>${r.html}</p><div class="when">${escapeHtml(r.when)}</div></div></li>`).join('');
    setHTML('today-story-events', html);
    const empty = getElement('today-story-empty');
    if (empty) empty.hidden = used + rows.length > 0;
}
