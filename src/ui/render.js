// Render coordination — the replacement for the old 'dataChanged' CustomEvent
// that re-rendered all six tabs on every keystroke.
//
// Model: data mutations call updateDataAndUI() (same name as before, so call
// sites read identically). It debounce-saves via autoSave, marks every
// data-driven tab dirty, and re-renders ONLY the tab on screen. A dirty tab
// re-renders when it's next shown (ui/tabs.js calls renderActiveTab on switch).

import { store } from '../state/store.js';
import { calculateTotals } from '../calc/calculations.js';
import { fitAllAmounts } from '../utils.js';
import { renderToday } from './today.js';
import { recordDailySnapshot } from '../state/snapshots.js';
import { checkMilestones } from '../state/milestones.js';
import { savingsPlanned } from '../calc/fi.js';
import { activityFeed } from '../state/today-model.js';
import { t } from '../i18n/strings.js';
import { renderScopeLine } from './tabs.js'; // tabs.js imports this file; both only call each other at runtime

// Today is the landing screen and stays in the startup download. The other three screens are
// separate chunks: they load the first time the tab is needed (P3a), and are prefetched when the
// browser is idle a few seconds after load so a first open is usually instant.
const TAB_NAMES = ['today', 'activity', 'plan', 'future'];
const DEFAULT_LOADERS = {
    activity: () => import('./activity.js').then((m) => m.renderActivity),
    plan: () => import('./plan.js').then((m) => m.renderPlan),
    future: () => import('./future.js').then((m) => m.renderFuture),
    // The old What If panel is not rendered (A5); F6/F7 replace it.
};
let loaders = DEFAULT_LOADERS;
const renderers = { today: renderToday }; // tab -> renderer, once loaded
const inflight = new Map(); // tab -> Promise of the loader
const dirty = new Set();
let prefetchScheduled = false;

/** The sidebar "N to review" count by Activity; hidden at 0, and the tab's accessible name carries it. */
export function renderNavCount() {
    const el = document.getElementById('activity-review-count');
    const tab = document.getElementById('tab-activity');
    if (!el || !tab) return;
    const feed = activityFeed();
    const n = feed && feed.ready && feed.toReviewCount > 0 ? feed.toReviewCount : 0;
    el.hidden = n === 0;
    el.textContent = n ? t('a.nav.toReview', { n }) : '';
    if (n) tab.setAttribute('aria-label', t('a.nav.activityAria', { n })); else tab.removeAttribute('aria-label');
}

/** Chrome that follows the data on every render pass: the scope line and the review count. */
function renderChrome() {
    renderScopeLine();
    renderNavCount();
}

// True when showing the tab needs no download: it has nothing pending, or its renderer is loaded.
export function isTabReady(tabName) {
    return !dirty.has(tabName) || !!renderers[tabName] || !loaders[tabName];
}

export function isTabDirty(tabName) { return dirty.has(tabName); }

/** Load a tab's renderer (once; a failed load can be retried). Resolves with the renderer. */
export function ensureTabLoaded(tabName) {
    if (renderers[tabName]) return Promise.resolve(renderers[tabName]);
    const load = loaders[tabName];
    if (!load) return Promise.resolve(null);
    if (!inflight.has(tabName)) {
        inflight.set(tabName, Promise.resolve().then(load).then((fn) => {
            renderers[tabName] = fn;
            inflight.delete(tabName);
            return fn;
        }, (err) => { inflight.delete(tabName); throw err; }));
    }
    return inflight.get(tabName);
}

function runRenderer(tabName, renderer, totals) {
    renderer(totals || calculateTotals(store.financeData));
    fitAllAmounts();
    dirty.delete(tabName);
}

// Renders now when the renderer is loaded (returns undefined); otherwise returns a promise that
// loads it and renders with the data as it is then.
function renderTab(tabName, totals) {
    if (renderers[tabName]) { runRenderer(tabName, renderers[tabName]); return undefined; }
    if (!loaders[tabName]) return undefined; // whatIf etc.
    return ensureTabLoaded(tabName).then((fn) => runRenderer(tabName, fn));
}

function settle(result) {
    return Promise.resolve(result).catch((err) => { console.error('tab render failed', err); });
}

/** After first paint, quietly fetch the other tab modules when the browser is idle. */
function schedulePrefetch() {
    if (prefetchScheduled || typeof window === 'undefined') return;
    prefetchScheduled = true;
    const run = () => {
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
        idle(() => { Object.keys(loaders).forEach((tab) => { ensureTabLoaded(tab).catch(() => { /* prefetch only; the real open retries and reports */ }); }); });
    };
    if (document.readyState === 'complete') setTimeout(run, 3000);
    else window.addEventListener('load', () => setTimeout(run, 3000), { once: true });
}

// FT-R-116: snapshots and milestones track savings as pay going into saving buckets (with the amount),
// not the legacy net-minus-expenses rate that calculateTotals still carries.
function withPlannedSavings(totals) {
    let s = { ratePct: totals.savingsRate, perPayCents: null };
    try { s = savingsPlanned(store.financeData); } catch (_) { /* keep the legacy figure rather than lose the day's snapshot */ }
    return { ...totals, savingsRate: s.ratePct, savingsPerPayCents: s.perPayCents };
}

// Full render — initial load, resets, imports. Only the visible tab renders; the rest are
// marked dirty and render when first opened. Returns a promise that settles when it has.
export function updateAllUI() {
    const totals = calculateTotals(store.financeData);
    const tracked = withPlannedSavings(totals);
    recordDailySnapshot(tracked);
    checkMilestones(tracked);
    TAB_NAMES.forEach((tab) => dirty.add(tab));
    const pending = renderTab(store.activeTab, totals);
    renderChrome();
    schedulePrefetch();
    return settle(pending);
}

// Data changed — autosave + scoped re-render. Same call-site name as before.
export function updateDataAndUI(callback) {
    if (callback) callback(); // legacy signature: execute the data-modifying function

    if (store.autoSave) store.autoSave.onDataChange();

    // Trend + celebration bookkeeping ride along with every data change.
    const totals = calculateTotals(store.financeData);
    const tracked = withPlannedSavings(totals);
    recordDailySnapshot(tracked);
    checkMilestones(tracked);

    TAB_NAMES.forEach((tab) => dirty.add(tab));
    const pending = renderActiveTab();
    renderChrome();
    return pending;
}

// Re-render the visible tab if it has pending changes (called on data change and
// by showTab when a dirty tab is revealed). Returns a promise.
export function renderActiveTab() {
    const tab = store.activeTab;
    if (!dirty.has(tab)) return Promise.resolve();
    return settle(renderTab(tab, calculateTotals(store.financeData)));
}

// Display-only refresh of one tab (e.g. the expense search filter).
export function refreshTab(tabName) {
    return settle(renderTab(tabName));
}

/** Test seam: swap the lazy loaders and clear all render state. Call with no argument to restore. */
export function _resetTabsForTest(testLoaders) {
    loaders = testLoaders || DEFAULT_LOADERS;
    Object.keys(renderers).forEach((k) => { if (k !== 'today') delete renderers[k]; });
    inflight.clear();
    dirty.clear();
    prefetchScheduled = true; // never prefetch from a test
}
