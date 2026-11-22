// FT-R-124 (FT-0032 DB14): feeds the shared database's tax figures to the tax code. Lazy: loaded after first paint
// from render.js, never part of the core chunk. Nothing waits on it: until it finishes (and whenever there is no
// tax file, it is invalid, or the kill switch lists `tax`) every tax result is the built-in table's, exactly as before.
//
// Only legislated figures reach the calculations (see src/calc/tax-tables/reference-tables.js). Years that the
// database holds but the rules keep out are remembered in `heldReferenceYears()` so a screen can say so.

import { getReferenceKind } from './reference.js';
import { validateReferenceFile, referenceList } from './reference-validate.js';
import { tablesFromReference } from '../calc/tax-tables/reference-tables.js';
import { TAX_TABLES, setReferenceTaxTables } from '../calc/tax-tables/index.js';

let held = {};

/** Years the database holds that the app does not use, with why: { '2027-28': { reason, figures, statuses } }. */
export function heldReferenceYears() { return { ...held }; }

/**
 * Validate a tax file and hand its usable tables to the tax code. A missing or invalid file clears any earlier
 * override, so the built-in tables are back. Returns { used: [fy...], held } and never throws.
 */
export function applyReferenceTax(doc) {
    try {
        if (!doc || !validateReferenceFile('tax', doc).ok) { setReferenceTaxTables({}); held = {}; return { used: [], held: {}, changed: false }; }
        const r = tablesFromReference(referenceList('tax', doc));
        setReferenceTaxTables(r.tables);
        held = r.held;
        // changed: a used table differs from the built-in one (or has none), so screens drawn earlier are stale.
        const norm = (t) => JSON.stringify(t, (k, x) => (x === Infinity ? 'Infinity' : (k === 'sources' || k === 'updated' || k === 'origin' ? undefined : x)));
        const changed = Object.keys(r.tables).some((fy) => !Object.hasOwn(TAX_TABLES, fy) || norm(TAX_TABLES[fy]) !== norm(r.tables[fy]));
        return { used: Object.keys(r.tables), held: r.held, changed };
    } catch (_) {
        setReferenceTaxTables({}); held = {};
        return { used: [], held: {}, changed: false };
    }
}

/** Read the tax kind (cache, then baseline) and apply it. `env` is the test seam for the reference client. */
export async function loadReferenceTax(env) {
    try {
        const r = await getReferenceKind('tax', env);
        return applyReferenceTax(r.doc);
    } catch (_) {
        return applyReferenceTax(null);
    }
}
