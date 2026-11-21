// Scenario resolver (owner: F1, M-14). M0 stub with the final signatures so F3, F4,
// F6 and F7 can import them before F1 lands. Pure: no DOM, no storage.

/**
 * Data as it stands on a date once the scenario changes apply.
 * The stub applies none and returns a deep clone, never the input.
 */
export function resolveAt(data, changes, date) {
    return JSON.parse(JSON.stringify(data === undefined ? null : data));
}

/** Date segments between breakpoints of the changes. The stub has none. */
export function segments(changes, from, to) {
    return [];
}
