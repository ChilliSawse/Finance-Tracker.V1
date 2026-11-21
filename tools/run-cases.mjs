// Node runner for the pure test groups registered in src/test-registry.js.
// Same case shape and the same JSON comparison as tests.html. Groups marked
// env 'browser' need a DOM or IndexedDB and are skipped here.
//   node tools/run-cases.mjs [group ...]

import { TEST_GROUPS } from '../src/test-registry.js';

const only = new Set(process.argv.slice(2));
let pass = 0;
let fail = 0;
let skipped = 0;

for (const g of TEST_GROUPS) {
    if (only.size && !only.has(g.name)) continue;
    if (g.env === 'browser') { skipped += g.cases.length; continue; }
    if (!g.cases.length) continue;
    console.log(`# ${g.name}`);
    for (const tc of g.cases) {
        const record = (label, ok, expected, actual) => {
            if (ok) { pass++; console.log(`  ok   ${tc.name} - ${label}`); return; }
            fail++;
            console.log(`  FAIL ${tc.name} - ${label}\n       expected ${expected}\n       actual   ${actual}`);
        };
        try {
            await tc.fn((label, actual, expected) => {
                const a = JSON.stringify(actual);
                const e = JSON.stringify(expected);
                record(label, a === e, e, a);
            });
        } catch (err) {
            fail++;
            console.log(`  FAIL ${tc.name} - threw ${err && err.stack ? err.stack : err}`);
        }
    }
}

console.log(`\n${pass} passed, ${fail} failed` + (skipped ? `, ${skipped} browser-only skipped` : ''));
process.exit(fail ? 1 : 0);
