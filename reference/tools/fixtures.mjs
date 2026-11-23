// Fixture round-trip (FT-0032 DB5/DB6): made-up descriptor lines go through the APP's own matcher
// (categoriseWithReference in src/state/reference-match.js) with the reference data as the app would see it. There is one
// definition of a match: the app's. Run by `npm run ref:check`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CATEGORIES } from '../../src/state/categories.js';
import { categoriseWithReference } from '../../src/state/reference-match.js';

export function fixtureLines(testsDir) {
    const file = join(testsDir, 'fixtures.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).lines : [];
}

/** The reference view the app sees (getReference's shape) from loaded sources: merchants in id order, categories as a list. */
export function referenceView(s) {
    const merchants = s.merchantParts.flatMap((p) => (p.data ? p.data.merchants : [])).sort((a, b) => (a.id < b.id ? -1 : 1));
    return { dataVersion: s.release ? s.release.dataVersion : null, sources: { categories: 'baseline', merchants: 'baseline' }, categories: s.categories ? s.categories.categories : [], merchants };
}

/** A fixture line's amount in cents, signed from its direction (credit +, debit -): the app skips direction-bound entries on an unsigned amount. */
export const fixtureAmount = (l) => (l.direction === 'credit' ? 1 : -1) * (l.amountCents || 12345);

export function fixtureErrors(s, testsDir) {
    const errors = [];
    const ref = referenceView(s);
    for (const l of fixtureLines(testsDir)) {
        const det = categoriseWithReference(l.description, fixtureAmount(l), DEFAULT_CATEGORIES, [], ref);
        const h = det.by === 'reference' ? det.reference : null;
        const got = h ? h.categoryId : null;
        // Where the app's own shipped keyword already names the expected category, the keyword result stands (by 'keyword', no refId).
        const agrees = !h && det.by === 'keyword' && l.ref !== null && det.categoryId === l.ref;
        if (got !== l.ref && !agrees) errors.push(`tests/fixtures.json: '${l.description}' (${l.direction}): reference gave ${got}${h ? ` via '${h.refId}' (${h.via})` : ''}, expected ${l.ref}`);
        if (l.expect !== undefined && det.categoryId !== l.expect) errors.push(`tests/fixtures.json: '${l.description}': final category ${det.categoryId}, expected ${l.expect}`);
    }
    return errors;
}
