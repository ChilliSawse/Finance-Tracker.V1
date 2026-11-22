// Reopening the asset and debt sheets when an answer changes the questions (DB12). The Plan screen and the Future screen
// both open these sheets, so the wiring lives here once. The sheet reopens with the values entered so far (`carry`) and the
// key that changed (`changed`): picking a type makes the kind follow it, picking a kind drops a type that no longer fits.
// A tap on a note's one-tap fix (accepting the suggested type) changes the same fields without a `change` event, so a click
// on a fix is checked too. Delegated on the sheet's layer; no per-field listeners.

/**
 * @param {{layer:HTMLElement, getValues:Function}} handle the openSheet handle
 * @param {{reopenOn?:string[]}} spec
 * @param {(carry:object, changed:string) => void} reopen
 */
export function wireSheetReopen(handle, spec, reopen) {
    const keys = spec && Array.isArray(spec.reopenOn) ? spec.reopenOn : [];
    if (!keys.length || !handle || !handle.layer) return;
    const snap = () => { const v = handle.getValues(); return Object.fromEntries(keys.map((k) => [k, v[k] == null ? '' : v[k]])); };
    const last = snap();
    handle.layer.addEventListener('change', (e) => {
        const k = e.target && e.target.dataset ? e.target.dataset.key : null;
        if (k && keys.includes(k)) reopen(handle.getValues(), k);
    });
    handle.layer.addEventListener('click', (e) => {
        if (!(e.target.closest && e.target.closest('[data-sheet-action="fix"]'))) return;
        const now = snap();
        const k = keys.find((x) => now[x] !== last[x]);
        if (k) reopen(handle.getValues(), k);
    });
}
