// Reusable modal shell (from main.js). A12b removed the per-page settings modals and the draggable-window helper.

import { getElement } from '../utils.js';
import { getFocusables, trapTab } from './focus.js';

// A.4 / Phase D — reusable modal shell: open/close, focus trap, focus restore.
// `onOpen` runs each time the modal opens (e.g. to (re)populate it).
export function getModalFocusables(modal) {
    return getFocusables(modal); // the helper lives in focus.js, shared with the sheet
}

export function setupModal(modalId, openBtnId, onOpen) {
    const modal = getElement(modalId);
    const openBtn = getElement(openBtnId);
    const closeBtn = modal ? modal.querySelector('.modal-close') : null;
    if (!modal || !openBtn) return;

    let lastFocused = null;

    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        trapTab(e, modal);
    };

    function open() {
        lastFocused = document.activeElement;
        if (typeof onOpen === 'function') onOpen(); // populate from current state
        modal.hidden = false;
        const f = getModalFocusables(modal);
        (f[0] || modal).focus();
        document.addEventListener('keydown', onKey, true);
    }
    function close() {
        modal.hidden = true;
        document.removeEventListener('keydown', onKey, true);
        if (lastFocused && document.body.contains(lastFocused)) lastFocused.focus();
    }

    openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); }); // backdrop click
}
