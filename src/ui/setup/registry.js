// Setup step registry (Phase 1 step C7, X5). DOM-free.
//
//   registerSetupStep({id, order, title, render, validate, onNext, ...})
//
// Required: id (string), order (number), title (string), render(ctx) -> HTML string.
// Optional:
//   validate(ctx)   -> falsy when fine, or a message string that blocks Next
//   onNext(ctx)     -> return false to stay on the step (it handled Next itself)
//   onBack(ctx)     -> return false to stay on the step
//   actions         -> {name: (ctx, el, event) => void}, reached by data-su-act="name" in the HTML
//   skippable       -> false hides "Skip this step" (default true)
//   nextLabel       -> string for the Next button; hideNext hides it
//
// E8 registers `model`, `split` and `transfers` here. C7 ships working versions under the same ids
// with {defaultOnly: true}: a default never replaces a step that is already registered, and a normal
// registration always replaces a default, so load order does not matter.
//
// Every string render() returns goes into innerHTML: escape data with esc() from ../html.js.

/** The planned order (spec of record: model, quiz, layout, pay, essentials, non-essentials, debts, split, transfers, first). */
export const STEP_ORDER = {
    model: 10, quiz: 20, layout: 30, pay: 40, essentials: 50, nonEssentials: 60, debts: 70, split: 80, transfers: 90, first: 100,
};

const steps = new Map();

/** Add or replace a step. Returns true when it was stored. */
export function registerSetupStep(def, opts = {}) {
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error('setup step needs an id');
    if (typeof def.order !== 'number' || !Number.isFinite(def.order)) throw new Error(`setup step ${def.id} needs a numeric order`);
    if (typeof def.render !== 'function') throw new Error(`setup step ${def.id} needs render(ctx)`);
    if (typeof def.title !== 'string' || !def.title) throw new Error(`setup step ${def.id} needs a title`);
    const existing = steps.get(def.id);
    if (opts.defaultOnly && existing) return false;
    steps.set(def.id, { skippable: true, ...def, isDefault: !!opts.defaultOnly });
    return true;
}

export function unregisterSetupStep(id) {
    return steps.delete(id);
}

export function getSetupStep(id) {
    return steps.get(id) || null;
}

/** Steps in order (ties keep registration order). */
export function getSetupSteps() {
    return [...steps.values()]
        .map((s, i) => ({ s, i }))
        .sort((a, b) => a.s.order - b.s.order || a.i - b.i)
        .map((x) => x.s);
}

/** Tests only: empty the registry. */
export function clearSetupSteps() {
    steps.clear();
}
