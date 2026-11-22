// CI check for the en-lazy-* catalogues (DB9). Based on the DB9 re-check probe.
//   node tools/lazy-check.mjs [--verbose]     exits 1 when a moved string could be read before its catalogue has loaded
// Static check: every use of a key moved to an en-lazy-* catalogue must sit in a module whose every load path
// (static or dynamic import, from src/main.js) has already evaluated that catalogue.
// Run: node lazy-check.mjs <tree root>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const VERBOSE = process.argv.includes('--verbose');
const log = (...a) => { if (VERBOSE) console.log(...a); };
let failures = 0;

const root = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || fileURLToPath(new URL('..', import.meta.url)));
const src = join(root, 'src');
const files = [];
(function walk(d) {
    for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
    }
})(src);
const rel = (p) => relative(src, p).split('\\').join('/');
const isTest = (p) => /\.test-cases\.js$|test-registry\.js$|[\\/]tests?[\\/]/.test(p);
const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

// Catalogues and their keys.
const cats = files.filter((f) => /i18n[\\/]en-lazy-[^\\/]+\.js$/.test(f));
const keyCat = new Map();
for (const c of cats) for (const m of text.get(c).matchAll(/^\s*'([a-zA-Z0-9_.\-]+)'\s*:/gm)) {
    if (keyCat.has(m[1])) { console.log('FAIL key in two lazy catalogues', m[1]); failures++; }
    keyCat.set(m[1], rel(c));
}
// Keys still in a core catalogue too?
const coreCat = files.filter((f) => /i18n[\\/]en(-[a-f])?\.js$/.test(f));
let stillCore = 0;
for (const c of coreCat) for (const m of text.get(c).matchAll(/^\s*'([a-zA-Z0-9_.\-]+)'\s*:/gm)) if (keyCat.has(m[1])) stillCore++;
log('lazy keys', keyCat.size, 'in', cats.length, 'catalogues; also still in a core catalogue:', stillCore);
if (stillCore) { console.log('FAIL', stillCore, 'lazy keys are still in a core catalogue'); failures++; }

// Import graph.
const edges = new Map(); // file -> [{to, dyn}]
for (const f of files) {
    const out = [];
    const s = text.get(f);
    const add = (spec, dyn) => {
        if (!spec.startsWith('.')) return;
        let p = resolve(dirname(f), spec);
        if (!p.endsWith('.js')) { if (text.has(p + '.js')) p += '.js'; else if (text.has(join(p, 'index.js'))) p = join(p, 'index.js'); }
        if (text.has(p)) out.push({ to: p, dyn });
    };
    for (const m of s.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g)) add(m[1], false);
    for (const m of s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], true);
    edges.set(f, out);
}
const importers = new Map(files.map((f) => [f, []]));
for (const [f, out] of edges) for (const e of out) importers.get(e.to).push(f);

// Reachable app modules from main.js (tests excluded).
const entry = join(src, 'main.js');
const reach = new Set([entry]);
for (const q = [entry]; q.length;) { const f = q.pop(); for (const e of edges.get(f)) if (!isTest(e.to) && !reach.has(e.to)) { reach.add(e.to); q.push(e.to); } }

// guaranteed(F): catalogues evaluated before F can run = intersection over app importers of (guaranteed(I) + I's direct catalogue imports).
const ALL = new Set(cats.map(rel));
const direct = (f) => new Set(edges.get(f).filter((e) => !e.dyn && ALL.has(rel(e.to))).map((e) => rel(e.to)));
const g = new Map();
for (const f of reach) g.set(f, f === entry ? new Set() : new Set(ALL));
for (let changed = true; changed;) {
    changed = false;
    for (const f of reach) {
        if (f === entry) continue;
        let acc = null;
        for (const i of importers.get(f)) {
            if (!reach.has(i)) continue;
            const s = new Set([...g.get(i), ...direct(i)]);
            acc = acc ? new Set([...acc].filter((x) => s.has(x))) : s;
        }
        acc = acc || new Set();
        if (acc.size !== g.get(f).size) { g.set(f, acc); changed = true; }
    }
}
const have = (f) => new Set([...g.get(f), ...direct(f)]);

// Uses: any quoted literal equal to a moved key, plus template-literal key prefixes.
const problems = [];
const prefixUses = [];
for (const f of reach) {
    if (cats.includes(f)) continue;
    const s = text.get(f);
    const h = have(f);
    for (const m of s.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_\-]*(?:\.[a-zA-Z0-9_\-]+)+)['"`]/g)) {
        const c = keyCat.get(m[1]);
        if (c && !h.has(c)) problems.push({ file: rel(f), line: s.slice(0, m.index).split('\n').length, key: m[1], needs: c });
    }
    for (const m of s.matchAll(/`([a-zA-Z][a-zA-Z0-9_\-]*(?:\.[a-zA-Z0-9_\-]+)*\.)\$\{/g)) {
        const pre = m[1];
        const needs = [...new Set([...keyCat].filter(([k]) => k.startsWith(pre)).map(([, c]) => c))].filter((c) => !h.has(c));
        if (needs.length) prefixUses.push({ file: rel(f), line: s.slice(0, m.index).split('\n').length, prefix: pre, needs });
    }
}
const byFile = new Map();
for (const p of problems) { const k = p.file + ' needs ' + p.needs; byFile.set(k, (byFile.get(k) || []).concat(p.line + ':' + p.key)); }
log('\nLITERAL USES OUTSIDE A GUARANTEED CATALOGUE:', problems.length);
for (const [k, v] of byFile) log(' ', k, '\n     ', v.slice(0, 8).join('  '), v.length > 8 ? `(+${v.length - 8})` : '');
log('\nTEMPLATE-PREFIX USES THAT MAY HIT A LAZY KEY:', prefixUses.length);
for (const p of prefixUses) log(' ', p.file + ':' + p.line, p.prefix, '->', p.needs.join(','));
// Lazy keys with no literal use anywhere (maybe built dynamically).
const used = new Set();
for (const f of files) if (!cats.includes(f)) for (const m of text.get(f).matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_\-]*(?:\.[a-zA-Z0-9_\-]+)+)['"`]/g)) used.add(m[1]);
const unused = [...keyCat.keys()].filter((k) => !used.has(k));
log('\nlazy keys with no literal use (dynamic or dead):', unused.length, unused.slice(0, 30).join(' '));
// Who imports each catalogue's owner, and how?
log('\nGUARANTEED SETS OF CATALOGUE OWNERS:');
for (const c of cats) for (const f of reach) if (direct(f).has(rel(c))) log(' ', rel(c), '<-', rel(f), 'importers:', importers.get(f).filter((i) => reach.has(i)).map(rel).join(', '));

// One load path from main.js to each flagged file that never passes a module importing the needed catalogue.
log('\nPATHS THAT LOAD THE FILE WITHOUT ITS CATALOGUE:');
const need = new Map();
for (const p of problems) need.set(p.file + '|' + p.needs, p);
for (const p of prefixUses) for (const c of p.needs) need.set(p.file + '|' + c, { file: p.file, needs: c });
for (const { file, needs } of need.values()) {
    const target = [...reach].find((f) => rel(f) === file);
    const blocked = (f) => direct(f).has(needs);
    const prev = new Map([[entry, null]]);
    const q = [entry];
    while (q.length) {
        const f = q.shift();
        if (f === target) break;
        for (const e of edges.get(f)) if (reach.has(e.to) && !prev.has(e.to) && !blocked(e.to)) { prev.set(e.to, { f, dyn: e.dyn }); q.push(e.to); }
    }
    if (!prev.has(target)) { log(' ', file, 'needs', needs, ': none (safe)'); continue; }
    const chain = [];
    for (let c = target; c; c = prev.get(c) && prev.get(c).f) chain.unshift(rel(c) + (prev.get(c) && prev.get(c).dyn ? '(dyn)' : ''));
    log(' ', file, 'needs', needs, ':\n     ', chain.join(' -> '));
}

// Runtime view (render time, after module evaluation): a unit = static closure of main.js or of a dynamic import() target.
log('\nRUNTIME (render-time) CHECK BY LOAD UNIT:');
const closure = (r) => { const s = new Set([r]); for (const q = [r]; q.length;) { const f = q.pop(); for (const e of edges.get(f)) if (!e.dyn && reach.has(e.to) && !s.has(e.to)) { s.add(e.to); q.push(e.to); } } return s; };
const roots = new Set([entry]);
for (const f of reach) for (const e of edges.get(f)) if (e.dyn && reach.has(e.to)) roots.add(e.to);
const S = new Map([...roots].map((r) => [r, closure(r)]));
const catsIn = (set) => new Set([...set].filter((f) => ALL.has(rel(f))).map(rel));
const loaded = new Map([...roots].map((r) => [r, r === entry ? catsIn(S.get(r)) : new Set(ALL)]));
for (let ch = true; ch;) {
    ch = false;
    for (const r of roots) {
        if (r === entry) continue;
        let acc = null;
        for (const [v, sv] of S) for (const m of sv) if (edges.get(m).some((e) => e.dyn && e.to === r)) {
            const l = loaded.get(v); acc = acc ? new Set([...acc].filter((x) => l.has(x))) : new Set(l);
        }
        const nx = new Set([...(acc || []), ...catsIn(S.get(r))]);
        if (nx.size !== loaded.get(r).size) { loaded.set(r, nx); ch = true; }
    }
}
const rt = new Map();
for (const p of [...problems, ...prefixUses.flatMap((u) => u.needs.map((c) => ({ file: u.file, line: u.line, key: u.prefix + '*', needs: c })))]) {
    const f = [...reach].find((x) => rel(x) === p.file);
    for (const [r, s] of S) if (s.has(f) && !loaded.get(r).has(p.needs)) {
        const k = `${p.file} needs ${p.needs} when loaded via unit ${rel(r)}`;
        rt.set(k, (rt.get(k) || []).concat(p.line + ':' + p.key));
    }
}
for (const [k, v] of rt) log(' ', k, '\n     ', v.slice(0, 10).join('  '), v.length > 10 ? `(+${v.length - 10})` : '');
log(' total runtime-risk groups:', rt.size);
for (const [k, v] of rt) { console.log('FAIL', k, v.slice(0, 5).join(' ')); failures++; }
// Top-level (evaluation-time) t() calls in flagged files.
log('\nTOP-LEVEL t() CALLS IN FLAGGED FILES (column 0 const/let/export lines):');
for (const file of new Set(problems.map((p) => p.file))) {
    const s = text.get([...reach].find((x) => rel(x) === file));
    s.split('\n').forEach((ln, i) => { if (/^(export\s+)?(const|let|var)\s.*\bt\(/.test(ln) && !/=>/.test(ln)) { console.log('FAIL top-level t() call in a file that uses lazy strings:', file + ':' + (i + 1)); failures++; } if (/^(export\s+)?(const|let|var)\s.*\bt\(/.test(ln)) log(' ', file + ':' + (i + 1), ln.trim().slice(0, 110)); });
}

console.log(failures ? `lazy-check: ${failures} problem(s)` : `lazy-check ok: ${keyCat.size} lazy strings in ${cats.length} catalogues, each is loaded before any screen that renders it`);
process.exit(failures ? 1 : 0);
