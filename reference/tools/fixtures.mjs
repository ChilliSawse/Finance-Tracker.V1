// Fixture round-trip (FT-0032 DB5): made-up descriptor lines must get the expected category from the reference merchants,
// and then from the app's own default keywords (categoriseDetailed). Run by `npm run ref:check`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { categoriseDetailed, DEFAULT_CATEGORIES } from '../../src/state/categories.js';
import { matchMerchant } from './match.mjs';

export function fixtureLines(testsDir) {
    const file = join(testsDir, 'fixtures.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).lines : [];
}

export function fixtureErrors(s, testsDir) {
    const errors = [];
    const merchants = s.merchantParts.flatMap((p) => (p.data ? p.data.merchants : [])).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const l of fixtureLines(testsDir)) {
        const m = matchMerchant(merchants, l.description, l.direction || 'debit');
        const ref = m ? m.categoryId : null;
        if (ref !== l.ref) errors.push(`tests/fixtures.json: '${l.description}' (${l.direction}): reference gave ${ref}${m ? ` via '${m.id}'` : ''}, expected ${l.ref}`);
        if (l.expect !== undefined) {
            const final = ref || categoriseDetailed(l.description, DEFAULT_CATEGORIES, []).categoryId;
            if (final !== l.expect) errors.push(`tests/fixtures.json: '${l.description}': final category ${final}, expected ${l.expect}`);
        }
    }
    return errors;
}
