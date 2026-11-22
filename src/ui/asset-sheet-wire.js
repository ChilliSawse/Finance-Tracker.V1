// Reopening the asset and debt sheets when an answer changes the questions (DB12). The Plan screen and the Future screen
// both open these sheets, so the wiring lives here once. The sheet reopens with the values entered so far (`carry`) and the
// key that changed (`changed`): picking a type makes the kind follow it, picking a kind drops a type that no longer fits.
// A tap on a note's one-tap fix (accepting the suggested type) changes the same fields without a `change` event, so a click
// on a fix is checked too. Delegated on the sheet's layer; no per-field listeners.
//
// Keyboard: a closed select fires `change` for every arrow key, and rebuilding the sheet each time would throw focus to the
// first field and make it impossible to step through a list. So a change made from the keyboard waits until the select is left
// (blur), and the sheet reopens then with focus on the field the person moved to (or the changed field). A mouse or touch pick
// reopens at once. Either way focus goes back to a field, never to the top of the sheet.

const KEYS_THAT_MOVE_A_SELECT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const isSelect = (el) => !!el && el.tagName === 'SELECT';

/**
 * @param {{layer:HTMLElement, getValues:Function}} handle the openSheet handle
 * @param {{reopenOn?:string[]}} spec
 * @param {(carry:object, changed:string, focusKey:string) => void} reopen focusKey is the field to put focus on after the reopen
 */
export function wireSheetReopen(handle, spec, reopen) {
    const keys = spec && Array.isArray(spec.reopenOn) ? spec.reopenOn : [];
    if (!keys.length || !handle || !handle.layer) return;
    const snap = () => { const v = handle.getValues(); return Object.fromEntries(keys.map((k) => [k, v[k] == null ? '' : v[k]])); };
    const last = snap();
    let typing = null; // the select the keyboard is moving through
    let pending = null; // the key that changed from the keyboard, reopened when the select is left
    handle.layer.addEventListener('keydown', (e) => {
        if (isSelect(e.target) && (KEYS_THAT_MOVE_A_SELECT.has(e.key) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey))) typing = e.target;
    });
    handle.layer.addEventListener('change', (e) => {
        const k = e.target && e.target.dataset ? e.target.dataset.key : null;
        if (!k || !keys.includes(k)) return;
        if (isSelect(e.target) && typing === e.target) { pending = k; return; }
        reopen(handle.getValues(), k, k);
    });
    handle.layer.addEventListener('focusout', (e) => {
        if (!pending || e.target !== typing) return;
        const k = pending;
        pending = null;
        typing = null;
        if (e.relatedTarget && e.relatedTarget.dataset && e.relatedTarget.dataset.sheetAction) return; // heading for Save or Cancel: do not rebuild the sheet under the tap
        const next = e.relatedTarget && e.relatedTarget.dataset && e.relatedTarget.dataset.key && handle.layer.contains(e.relatedTarget) ? e.relatedTarget.dataset.key : k;
        reopen(handle.getValues(), k, next);
    });
    handle.layer.addEventListener('click', (e) => {
        if (!(e.target.closest && e.target.closest('[data-sheet-action="fix"]'))) return;
        const now = snap();
        const k = keys.find((x) => now[x] !== last[x]);
        if (k) reopen(handle.getValues(), k, k);
    });
}

/** Put focus on a field of a freshly opened sheet (after a reopen). */
export function focusSheetField(handle, key) {
    const c = key && handle && handle.layer ? handle.layer.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
    if (c) c.focus();
}
