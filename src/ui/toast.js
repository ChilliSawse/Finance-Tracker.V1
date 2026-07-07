// Toast — the small, friendly announcement pill (milestones, onboarding,
// confirmations). One at a time; auto-dismisses; respects reduced motion via
// the global transition kill-switch in style.css.

import { t } from '../i18n/strings.js';

let hideTimer = null;

export function showToast(message, kind = 'info', duration = 4500) {
    let toast = document.getElementById('ledger-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ledger-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `is-${kind}`;
    // Restart the show animation even when a toast is already visible.
    toast.classList.remove('is-visible');
    void toast.offsetWidth; // reflow
    toast.classList.add('is-visible');

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast.classList.remove('is-visible'), duration);
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
