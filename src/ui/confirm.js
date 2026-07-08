// Alert / confirm surfaces (moved from events.js).

import { escapeHtml } from '../utils.js';

// Custom Modal for Alerts/Confirms (simple version)
export function showCustomModal(message, type = 'info') { // type: 'info' | 'error' | 'success'
    // For a real app, you'd build a proper modal DOM element.
    // For now, we'll use a simple browser alert, but flag it for upgrade.
    alert(`[${type.toUpperCase()}] ${message}`); // Replace with a proper UI element
}

export function confirmAction(message) {
    // Replace with a proper UI element for confirmation dialogs
    return confirm(message);
}

// B.4 — Non-blocking inline confirmation popover, anchored to the trigger element.
// Auto-focuses "Yes"; dismisses on Escape, "No", or any outside click. Calls onConfirm()
// only when the user explicitly confirms.
export function inlineConfirm(triggerEl, message, onConfirm) {
    // Only one popover at a time.
    document.querySelectorAll('.inline-confirm').forEach(el => el.dispatchEvent(new Event('ft-dismiss')));

    const pop = document.createElement('div');
    pop.className = 'inline-confirm';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', message);
    pop.innerHTML = `
        <span class="inline-confirm-msg">${escapeHtml(message)}</span>
        <span class="inline-confirm-actions">
            <button type="button" class="inline-confirm-yes">Yes</button>
            <button type="button" class="inline-confirm-no">No</button>
        </span>`;
    document.body.appendChild(pop);

    // Anchor under the trigger, right-aligned to it, clamped to the viewport.
    // On phones the trigger (e.g. a Delete button low in a settings modal) can
    // sit near the bottom edge — flip the popover above it rather than letting
    // it render off-screen, and clamp both axes as a final guarantee.
    const rect = triggerEl.getBoundingClientRect();
    const margin = 8;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(margin, Math.min(rect.right - w, window.innerWidth - w - margin));
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - margin) top = rect.top - 6 - h;
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;

    const cleanup = () => {
        pop.removeEventListener('ft-dismiss', cleanup);
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('mousedown', onOutside, true);
        pop.remove();
    };
    const dismiss = (refocus) => { cleanup(); if (refocus && document.body.contains(triggerEl)) triggerEl.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(true); } };
    const onOutside = (e) => { if (!pop.contains(e.target)) dismiss(false); };

    pop.addEventListener('ft-dismiss', cleanup);
    pop.querySelector('.inline-confirm-yes').addEventListener('click', () => { cleanup(); onConfirm(); });
    pop.querySelector('.inline-confirm-no').addEventListener('click', () => dismiss(true));
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onOutside, true);

    pop.querySelector('.inline-confirm-yes').focus();
}
