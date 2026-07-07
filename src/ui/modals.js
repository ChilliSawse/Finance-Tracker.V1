// Reusable modal shell + per-page settings modals (from main.js).

import { getElement } from '../utils.js';
import { initializeGuiSettingsForm } from '../theme/appearance.js';
import {
    renderIncomeSourcesSettings, renderTaxBracketsSettings, renderAssetsSettings,
    renderLiabilitiesSettings, renderAllocationSettings, renderExpensesSettingsLists,
    renderFISettings, renderTaxSettings, renderBillsSettings, renderCategoriesSettings,
} from './settings-forms.js';

// A.4 / Phase D — reusable modal shell: open/close, focus trap, focus restore.
// `onOpen` runs each time the modal opens (e.g. to (re)populate it).
export function getModalFocusables(modal) {
    return Array.from(modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.disabled && el.offsetParent !== null);
}

export function setupModal(modalId, openBtnId, onOpen) {
    const modal = getElement(modalId);
    const openBtn = getElement(openBtnId);
    const closeBtn = modal ? modal.querySelector('.modal-close') : null;
    if (!modal || !openBtn) return;

    let lastFocused = null;

    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        const f = getModalFocusables(modal);
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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

// A.4 — appearance modal populates its colour pickers/typography from guiSettingsData on open.
export function setupGuiModal() {
    setupModal('gui-settings-modal', 'open-gui-settings', initializeGuiSettingsForm);
}

// Make a modal behave like a real window: drag it by its header, resize it from the
// bottom-right corner. The dialog is position:fixed (see style.css), so we set explicit
// top/left coords — centred each time it opens, then updated as the user drags.
export function setupDraggableModal(backdropId) {
    const backdrop = getElement(backdropId);
    if (!backdrop) return;
    const dialog = backdrop.querySelector('.modal');
    const header = backdrop.querySelector('.modal-header');
    if (!dialog || !header) return;

    const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
    const center = () => {
        const w = dialog.offsetWidth, h = dialog.offsetHeight;
        dialog.style.left = clamp((window.innerWidth - w) / 2, 8, window.innerWidth - 80) + 'px';
        dialog.style.top  = clamp((window.innerHeight - h) / 2, 8, window.innerHeight - 80) + 'px';
    };
    // Re-centre whenever it transitions from hidden → shown (microtask, so no paint flash).
    new MutationObserver(() => { if (!backdrop.hidden) center(); })
        .observe(backdrop, { attributes: true, attributeFilter: ['hidden'] });

    let dragging = false, offX = 0, offY = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.modal-close')) return; // don't drag when grabbing the close button
        const r = dialog.getBoundingClientRect();
        dragging = true; offX = e.clientX - r.left; offY = e.clientY - r.top;
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        dialog.style.left = clamp(e.clientX - offX, 0, window.innerWidth - 60) + 'px';
        dialog.style.top  = clamp(e.clientY - offY, 0, window.innerHeight - 40) + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false; document.body.style.userSelect = '';
    });
}

// Phase D — per-page settings modals. Their inner lists are kept fresh by the
// renderers; re-rendering on open just guarantees current values.
export function setupPageSettingsModals() {
    setupModal('income-settings-modal', 'open-income-settings', () => {
        renderIncomeSourcesSettings();
        renderTaxBracketsSettings();
        renderTaxSettings();
    });
    setupModal('expenses-settings-modal', 'open-expenses-settings', () => {
        renderExpensesSettingsLists();
        renderBillsSettings();
        renderCategoriesSettings();
    });
    setupModal('savings-settings-modal', 'open-savings-settings', () => {
        renderAssetsSettings();
        renderAllocationSettings();
        renderFISettings();
    });
    setupModal('liabilities-settings-modal', 'open-liabilities-settings', () => {
        renderLiabilitiesSettings();
    });
}
