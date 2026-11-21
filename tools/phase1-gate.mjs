// Mechanical checks for the Phase 1 wave gate (plan section 8, guardrails G3, G4, G5).
//   node tools/phase1-gate.mjs [--after-d2] [--hex]
// --after-d2 also rejects alert( and confirm( in src/ (D2 removes them).
// --hex rejects hex colours in src/ and style.css outside the generated token file
//   (turn on once A1 and A3 have landed; the legacy code still has them).
// Run from the repo root. Compares against git tag pre-phase1.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const failures = [];
const fail = (msg) => failures.push(msg);

function walk(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}
const srcFiles = walk('src').filter((f) => /\.(js|css)$/.test(f));
const jsFiles = srcFiles.filter((f) => f.endsWith('.js'));
const read = (f) => fs.readFileSync(f, 'utf8');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// 1. No skip or only markers in tests.
const testFiles = [...jsFiles.filter((f) => f.endsWith('.test-cases.js')), 'tests.html'];
for (const f of testFiles) {
    const s = read(f);
    if (/\b(it|test|describe)\.(skip|only)\b|\bxit\(|\.only\(|\.skip\(/.test(s)) fail(`skip or only marker in ${f}`);
}

// 2. No deleted assertions against pre-phase1 (counts of assertion calls in tests.html and csv cases).
const ASSERT = /\b(assertEqual|assertTrue|assertClose)\(|\bassert\(/g;
const count = (s) => (s.match(ASSERT) || []).length;
try {
    for (const f of ['tests.html', 'src/import/csv.test-cases.js']) {
        const before = count(git('show', `pre-phase1:${f}`));
        const now = count(read(f));
        if (now < before) fail(`assertions fell in ${f}: ${before} at pre-phase1, ${now} now`);
    }
} catch (err) {
    fail(`could not compare with tag pre-phase1: ${err.message.split('\n')[0]}`);
}

// 3. No new empty catch: the count per file may not rise above pre-phase1 (some already exist).
const EMPTY_CATCH = /catchs*(([^)]*))?s*{s*}/g;
for (const f of jsFiles) {
    const now = (read(f).match(EMPTY_CATCH) || []).length;
    if (!now) continue;
    let before = 0;
    try { before = (git('show', `pre-phase1:${f.split(path.sep).join('/')}`).match(EMPTY_CATCH) || []).length; } catch { before = 0; }
    if (now > before) fail(`new empty catch in ${f} (${before} at pre-phase1, ${now} now)`);
}

// 4. alert( and confirm( once D2 has landed.
if (args.has('--after-d2')) {
    for (const f of jsFiles) {
        if (/(^|[^.\w])(alert|confirm)\(/m.test(read(f))) fail(`alert( or confirm( in ${f}`);
    }
}

// 5. Hex colours outside the generated token file.
if (args.has('--hex')) {
    const generated = new Set(['src/styles/tokens.generated.css'].map((p) => path.normalize(p)));
    for (const f of [...srcFiles, 'style.css']) {
        if (generated.has(path.normalize(f))) continue;
        if (/#[0-9a-fA-F]{3,8}\b/.test(read(f).replace(/&#\d+;/g, ''))) fail(`hex colour in ${f}`);
    }
}

// 6. Storage keys present at pre-phase1 must still be in src/.
try {
    const KEY = /['"`](financeTrackerData_v2|ft-[a-z0-9-]+)['"`]/g;
    const oldKeys = new Set();
    for (const f of git('ls-tree', '-r', '--name-only', 'pre-phase1', 'src').split('\n').filter((x) => x.endsWith('.js'))) {
        for (const m of git('show', `pre-phase1:${f}`).matchAll(KEY)) oldKeys.add(m[1]);
    }
    const nowText = jsFiles.map(read).join('\n');
    for (const k of oldKeys) if (!nowText.includes(k)) fail(`storage key ${k} from pre-phase1 is missing from src/`);
} catch (err) {
    fail(`could not read storage keys at pre-phase1: ${err.message.split('\n')[0]}`);
}

// afterImport is the one hook name every migration module exports by design (section 9.3).
const KNOWN_DUPLICATES = new Set(['afterImport']);

// 7. The same exported function name defined twice (G3).
const owners = new Map();
for (const f of jsFiles) {
    for (const m of read(f).matchAll(/^export (?:async )?function\s+(\w+)/gm)) {
        owners.set(m[1], [...(owners.get(m[1]) || []), f]);
    }
}
for (const [name, files] of owners) {
    if (files.length > 1 && !KNOWN_DUPLICATES.has(name)) fail(`exported function ${name} defined in ${files.join(' and ')}`);
}

if (failures.length) {
    console.log('phase1-gate FAILED');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
}
console.log('phase1-gate ok');
