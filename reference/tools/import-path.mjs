// Import-path test (FT-0032 DB6): the shipped reference content, run through the app's real import entry resolveImportRow with a
// reference view built from reference/src, over the fixture lines. FT-R-126: every reference hit comes back 'review' and
// referenceSuggested; a line with no reference hit never carries the mark; the false-hit traps give no wrong category.
// Run by `npm run ref:check`; also standalone: node reference/tools/import-path.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATEGORIES, cloneDefaultCategories } from '../../src/state/categories.js';
import { resolveImportRow } from '../../src/state/import-rows.js';
import { categoriseWithReference } from '../../src/state/reference-match.js';
import { fixtureLines, fixtureAmount, referenceView } from './fixtures.mjs';

const TRAPS = ['CURRENT ACCOUNT FEE', 'PARENT TEACHER NIGHT 14', 'COCA COLA AMATIL', 'SHELLHARBOUR VILLAGE 22', 'GYMPIE FRUIT BARN',
    'EAGLE BOYS PIZZA ROXBURGH PARK', 'POTATO SHED 31', 'ALDINGA BEACH SURF CLUB', 'AUSTRALIA POST 4821 MELBOURNE VIC', 'PAYPAL *AUSTRALIA POST'];

export function importPathErrors(s, testsDir) {
    const errors = [];
    const ref = referenceView(s);
    const data = { categories: cloneDefaultCategories(), rules: [], allocation: [] };
    const lines = fixtureLines(testsDir);
    for (const l of lines) {
        const r = resolveImportRow(l.description, fixtureAmount(l), undefined, data, ref);
        const at = `import path '${l.description}' (${l.direction})`;
        const det = categoriseWithReference(l.description, fixtureAmount(l), data.categories, [], ref);
        if (l.ref !== null && det.by === 'keyword') {
            // The app's own shipped keyword agrees with the reference: the keyword result stands, so the row stays 'ok' and unmarked.
            if (r.categoryId !== l.ref || r.status !== 'ok' || r.referenceSuggested || r.refId) errors.push(`${at}: keyword agrees with ${l.ref}, expected ok and no refId, got ${r.categoryId}/${r.status}${r.refId ? ' @' + r.refId : ''}`);
        } else if (l.ref !== null) {
            if (r.categoryId !== l.ref) errors.push(`${at}: category ${r.categoryId}, expected ${l.ref}`);
            if (r.status !== 'review') errors.push(`${at}: a reference hit came back '${r.status}', expected 'review' (FT-R-126)`);
            if (r.referenceSuggested !== true || !r.refId) errors.push(`${at}: a reference hit is not marked suggested with its refId`);
        } else {
            if (r.referenceSuggested || r.refId) errors.push(`${at}: no reference hit was expected, got ${r.refId}`);
            if (l.expect !== undefined && r.categoryId !== l.expect) errors.push(`${at}: category ${r.categoryId}, expected ${l.expect}`);
        }
    }
    for (const d of TRAPS) {
        const l = lines.find((x) => x.description === d);
        if (!l) { errors.push(`import path: trap line '${d}' is missing from fixtures.json`); continue; }
        const r = resolveImportRow(d, fixtureAmount(l), undefined, data, ref);
        const wrong = ['transport', 'fitness', 'utilities', 'income', 'phone-internet'];
        if (l.ref === null && r.categoryId !== 'other') errors.push(`import path trap '${d}': got ${r.categoryId}, expected other`);
        if (l.ref !== null && (wrong.includes(r.categoryId) || r.categoryId !== l.ref)) errors.push(`import path trap '${d}': got ${r.categoryId}, expected ${l.ref}`);
    }
    if (!DEFAULT_CATEGORIES.length) errors.push('import path: no default categories');
    return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const here = dirname(fileURLToPath(import.meta.url));
    const { loadSource } = await import('./build.mjs');
    const errs = importPathErrors(loadSource(join(here, '..', 'src')), join(here, '..', 'tests'));
    if (errs.length) { for (const e of errs) console.error('  ' + e); process.exit(1); }
    console.log('import path ok');
}
