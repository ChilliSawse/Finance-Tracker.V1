// Alert / confirm surfaces (moved from events.js).
// showCustomModal is now a thin wrapper over the toast; confirmDialog is the one
// whole-data dialog (Restore, Erase all data). confirmAction and inlineConfirm
// stay until their call sites convert (D2, A12b).

import { escapeHtml } from '../utils.js';
import { t } from '../i18n/strings.js';
import { showToast } from './toast.js';
import { rememberFocus } from './focus.js';

const MODAL_KINDS = { info: 'info', success: 'success', error: 'error' };

/** Maps the old alert type to a toast kind (anything unknown is info). */
export function toastKindForModal(type) {
    return MODAL_KINDS[type] || 'info';
}

// Was a native alert; now a toast of the same kind (type: 'info' | 'error' | 'success').
export function showCustomModal(message, type = 'info') {
    const kind = toastKindForModal(type);
    showToast(message, kind, kind === 'error' ? 7000 : 4500);
}

let dialogSeq = 0;
let openDialog = null;

/**
 * Accessible modal <dialog>. Resolves true on confirm, false on cancel, Escape
 * or backdrop click. All text goes in as textContent.
 */
export function confirmDialog({ title, body = '', confirmLabel, danger = false } = {}) {
    if (typeof HTMLDialogElement === 'undefined') {
        return Promise.resolve(window.confirm([title, body].filter(Boolean).join('\n')));
    }
    if (openDialog) openDialog(false); // one at a time
    return new Promise((resolve) => {
        const restoreFocus = rememberFocus();
        const id = `ledger-dialog-${++dialogSeq}`;
        const dlg = document.createElement('dialog');
        dlg.className = 'ledger-dialog' + (danger ? ' is-danger' : '');
        dlg.setAttribute('aria-labelledby', `${id}-t`);
        if (body) dlg.setAttribute('aria-describedby', `${id}-b`);

        const h = document.createElement('h2');
        h.id = `${id}-t`;
        h.textContent = title || '';
        dlg.appendChild(h);
        if (body) {
            const p = document.createElement('p');
            p.id = `${id}-b`;
            p.textContent = body;
            dlg.appendChild(p);
        }
        const row = document.createElement('div');
        row.className = 'ledger-dialog-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'sheet-btn';
        cancel.dataset.dialogCancel = '';
        cancel.textContent = t('d.dialog.cancel');
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'sheet-btn ' + (danger ? 'is-danger' : 'is-primary');
        ok.dataset.dialogConfirm = '';
        ok.textContent = confirmLabel || t('d.dialog.confirm');
        row.append(cancel, ok);
        dlg.appendChild(row);

        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;
            openDialog = null;
            try { if (dlg.open) dlg.close(); } catch (err) { console.error('dialog close failed', err); }
            dlg.remove();
            restoreFocus();
            resolve(result);
        };
        openDialog = settle;

        // One delegated click listener on the dialog; Escape arrives as 'cancel'.
        dlg.addEventListener('click', (e) => {
            if (e.target === dlg) { settle(false); return; } // backdrop
            const b = e.target.closest('button');
            if (!b) return;
            if ('dialogConfirm' in b.dataset) settle(true);
            else if ('dialogCancel' in b.dataset) settle(false);
        });
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); settle(false); });

        document.body.appendChild(dlg);
        dlg.showModal();
        // For a destructive action, start on the safe button.
        (danger ? cancel : ok).focus();
    });
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
