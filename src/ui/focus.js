// Focus helpers shared by the modal shell (modals.js) and the sheet (sheet.js):
// list the tabbable controls, wrap Tab at the ends, and restore focus on close.

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Visible, enabled, tabbable controls inside `root`, in DOM order. */
export function getFocusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE))
        .filter((el) => !el.disabled && el.getClientRects().length > 0);
}

/**
 * Wrap Tab / Shift+Tab inside `root`. Returns true when it handled the key.
 * Call from a keydown handler.
 */
export function trapTab(e, root) {
    if (e.key !== 'Tab') return false;
    const f = getFocusables(root);
    if (f.length === 0) { e.preventDefault(); return true; }
    const first = f[0], last = f[f.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); return true; }
    if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); return true; }
    return false;
}

/** Remember the element that had focus, so it can be given back on close. */
export function rememberFocus() {
    const el = document.activeElement;
    return () => { if (el && el !== document.body && document.body.contains(el)) el.focus(); };
}
