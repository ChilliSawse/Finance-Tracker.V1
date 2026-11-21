// Z1 (AT-5): assertion calls per test file, pre-phase1 vs now. Any file whose count fell is printed.
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const A = /\b(assertEqual|assertTrue|assertClose)\(|\bassert\(/g;
const cnt = (s) => (s.match(A) || []).length;
const old = git('ls-tree', '-r', '--name-only', 'pre-phase1').split('\n').filter((f) => /(\.test-cases\.js|tests\.html|\.test\.js)$/.test(f));
let fell = 0, tb = 0, tn = 0;
for (const f of old) {
    const b = cnt(git('show', 'pre-phase1:' + f)); tb += b;
    let n = 0, moved = false;
    if (fs.existsSync(f)) n = cnt(fs.readFileSync(f, 'utf8')); else moved = true;
    tn += n;
    if (n < b) { fell++; console.log(moved ? 'MISSING' : 'FELL', f, b, '->', n); }
}
console.log('files checked', old.length, 'assert calls before', tb, 'now (same files)', tn, 'files that fell', fell);
