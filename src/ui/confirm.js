// Alert / confirm surfaces (moved from events.js).
// showCustomModal is now a thin wrapper over the toast; confirmDialog is the one
// whole-data dialog (Restore, Erase all data). inlineConfirm (A12b) and confirmAction (D2) are gone.

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
        return Promise.resolve(false); // no <dialog> support: do nothing rather than act unasked
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
