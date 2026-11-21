// Toast — the small, friendly announcement pill (milestones, onboarding,
// confirmations) and the undo toast. One at a time: a second toast replaces the
// first and commits it (calls its onExpire once). Auto-dismisses; pauses on
// hover and focus; duration 0 means "stay until dismissed" (storage full).
//
// The queue is pure (injectable timers and view) so it is tested without a DOM;
// the DOM view below is the single #ledger-toast element.

import { t } from '../i18n/strings.js';

const DEFAULT_DURATION = 4500;
const UNDO_DURATION = 6000;

function safely(fn) {
    if (typeof fn !== 'function') return;
    try { fn(); } catch (err) { console.error('toast callback failed', err); }
}

/**
 * entry: { message, kind='info', duration, action?: {label, onAction}, onExpire? }
 * view:  { show(entry), hide() }
 */
export function createToastQueue({ view, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
    let cur = null; // { entry, timer, remaining, startedAt, done }

    function arm(c) {
        if (c.entry.duration <= 0) return; // persistent: no timer
        c.startedAt = now();
        c.timer = setTimer(() => finish(c, 'expire'), c.remaining);
    }

    function finish(c, how) {
        if (c.done) return;
        c.done = true;
        if (c.timer != null) clearTimer(c.timer);
        c.timer = null;
        if (cur === c) cur = null;
        if (how === 'act') safely(c.entry.action && c.entry.action.onAction);
        else safely(c.entry.onExpire); // expire, dismiss, replace: the change is committed
        if (how !== 'replace' && !cur) view.hide();
    }

    return {
        show(input) {
            const entry = {
                kind: 'info', duration: DEFAULT_DURATION, ...input,
                message: String(input.message == null ? '' : input.message),
            };
            if (entry.duration == null) entry.duration = DEFAULT_DURATION;
            if (cur) finish(cur, 'replace');
            const c = { entry, timer: null, remaining: entry.duration, startedAt: 0, done: false };
            cur = c;
            view.show(entry);
            arm(c);
        },
        /** The action button (Undo): runs onAction, does not commit. */
        act() { if (cur) finish(cur, 'act'); },
        /** The dismiss button: commits. */
        dismiss() { if (cur) finish(cur, 'dismiss'); },
        pause() {
            if (!cur || cur.timer == null) return;
            clearTimer(cur.timer);
            cur.timer = null;
            cur.remaining = Math.max(0, cur.remaining - (now() - cur.startedAt));
        },
        resume() {
            if (!cur || cur.timer != null || cur.entry.duration <= 0) return;
            arm(cur);
        },
        current() { return cur ? cur.entry : null; },
    };
}

// ── DOM view ────────────────────────────────────────────────────────────────
let queue = null;
let toastEl = null;

function ensureToastEl() {
    if (toastEl && document.body.contains(toastEl)) return toastEl;
    toastEl = document.getElementById('ledger-toast');
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'ledger-toast';
        toastEl.setAttribute('role', 'status');
        toastEl.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastEl);
    }
    // One set of delegated listeners on the single toast element.
    toastEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-toast-act]');
        if (!btn || !queue) return;
        if (btn.dataset.toastAct === 'action') queue.act(); else queue.dismiss();
    });
    toastEl.addEventListener('mouseover', () => queue && queue.pause());
    toastEl.addEventListener('mouseout', (e) => { if (!toastEl.contains(e.relatedTarget) && queue) queue.resume(); });
    toastEl.addEventListener('focusin', () => queue && queue.pause());
    toastEl.addEventListener('focusout', (e) => { if (!toastEl.contains(e.relatedTarget) && queue) queue.resume(); });
    return toastEl;
}

const domView = {
    show(entry) {
        const el = ensureToastEl();
        el.textContent = '';
        const msg = document.createElement('span');
        msg.className = 'toast-msg';
        msg.textContent = entry.message; // text only, never HTML
        el.appendChild(msg);
        if (entry.action) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'toast-action';
            b.dataset.toastAct = 'action';
            b.textContent = entry.action.label;
            el.appendChild(b);
        }
        if (entry.duration <= 0) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'toast-dismiss';
            b.dataset.toastAct = 'dismiss';
            b.textContent = t('d.toast.dismiss');
            el.appendChild(b);
        }
        el.className = `is-${entry.kind}`;
        if (entry.action || entry.duration <= 0) el.classList.add('has-controls');
        // Restart the show animation even when a toast is already visible.
        el.classList.remove('is-visible');
        void el.offsetWidth; // reflow
        el.classList.add('is-visible');
    },
    hide() {
        if (toastEl) toastEl.classList.remove('is-visible', 'has-controls');
    },
};

function getQueue() {
    if (!queue) queue = createToastQueue({ view: domView });
    return queue;
}

/** Plain toast. duration 0 keeps it until dismissed (a Dismiss button is added). */
export function showToast(message, kind = 'info', duration = DEFAULT_DURATION, tag = null) {
    getQueue().show({ message, kind, duration, tag });
}

/**
 * Dismiss the visible toast only if it carries this tag (the sample welcome toast, so it never sits
 * over a sheet or Setup's primary button). Undo toasts and others are left alone.
 */
export function dismissToastTagged(tag) {
    if (!queue) return false;
    const cur = queue.current();
    if (!cur || !tag || cur.tag !== tag) return false;
    queue.dismiss();
    return true;
}

/** Toast with an Undo button. onUndo runs on Undo; onExpire when it times out, is dismissed or replaced. */
export function showUndoToast({ message, onUndo, onExpire, duration = UNDO_DURATION }) {
    getQueue().show({
        message, kind: 'info', duration, onExpire,
        action: { label: t('d.toast.undo'), onAction: onUndo },
    });
}

// Milestones are detected deep in the state layer; it announces via a DOM
// event so this UI module can stay out of its dependencies.
export function setupMilestoneToasts() {
    document.addEventListener('ledger:milestone', (e) => {
        const d = e.detail || {};
        if (d.kind === 'net-worth') {
            showToast(t('toast.milestone.netWorth', { threshold: d.thresholdLabel }), 'celebrate', 6000);
        } else if (d.kind === 'savings-rate') {
            showToast(t('toast.milestone.savingsRate', { threshold: d.threshold }), 'celebrate', 6000);
        }
    });
}
