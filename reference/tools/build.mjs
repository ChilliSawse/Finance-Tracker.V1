// Reference database build (FT-0032 DB1; R3 sections 5, 6, 10, 11).
//   node reference/tools/build.mjs [--src dir] [--out distDir] [--diff baseRefDir] [--refresh-baseline] [--quiet]
// With no --out it only validates (this is `npm run ref:check`). With --out it writes <distDir>/ref/.
// --diff takes a `reference/` folder (or its `src/`) of the base revision and prints added/changed/removed ids as markdown.
// --refresh-baseline rewrites reference/baseline/ from the current source. The baseline is a pinned snapshot, so a
// data-only change leaves dist/sw.js byte-identical (the baseline is the only part of ref/ the service worker precaches).

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateModelDef } from '../../src/calc/saving-model.js';
import { merchantKey } from '../../src/state/categories.js';
import { fixtureErrors, fixtureLines } from './fixtures.mjs';
import { importPathErrors } from './import-path.mjs';
import { assetTypeErrors } from './asset-match.mjs';

export const REF_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const KNOWN_ENGINES = ['expenses-first', 'fixed'];
// Gzip size cap per built file (bytes). A breach fails the build; raise a cap only on purpose.
export const GZIP_CAPS = { categories: 20_000, merchants: 150_000, assetTypes: 40_000, models: 10_000, model: 10_000, tax: 60_000 };
export const BASELINE_GZIP_CAP = 250_000;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- schemas ----------

export function makeValidators(schemaDir = join(REF_DIR, 'schemas')) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
    const byName = {};
    for (const f of readdirSync(schemaDir).filter((n) => n.endsWith('.schema.json'))) {
        const s = readJson(join(schemaDir, f));
        ajv.addSchema(s);
        byName[f.replace('.schema.json', '')] = s.$id;
    }
    const fns = {};
    for (const [name, id] of Object.entries(byName)) fns[name] = ajv.getSchema(id);
    return fns;
}

export function schemaErrors(fn, data, file) {
    if (fn(data)) return [];
    return fn.errors.map((e) => {
        let extra = '';
        if (e.keyword === 'enum') extra = ` (${e.params.allowedValues.join(', ')})`;
        if (e.keyword === 'additionalProperties') extra = ` '${e.params.additionalProperty}'`;
        if (e.keyword === 'required') extra = ` '${e.params.missingProperty}'`;
        return `${file}: ${e.instancePath || '(root)'} ${e.message}${extra}`;
    });
}

// ---------- load ----------

export function loadSource(src = join(REF_DIR, 'src')) {
    const errors = [];
    const rd = (rel) => {
        const p = join(src, rel);
        if (!existsSync(p)) return undefined;
        try { return readJson(p); } catch (e) { errors.push(`${rel}: not valid JSON (${e.message})`); return null; }
    };
    const out = { src, errors };
    out.release = rd('release.json');
    out.categories = rd('categories.json');
    out.assetTypes = rd('asset-types.json');
    out.tax = rd('tax.json');
    out.merchantsMeta = rd('merchants/_meta.json');
    out.modelsMeta = rd('models/_meta.json');
    out.merchantParts = [];
    out.models = [];
    const listJson = (dir) => (existsSync(join(src, dir)) ? readdirSync(join(src, dir)).filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort() : []);
    for (const n of listJson('merchants')) out.merchantParts.push({ file: `merchants/${n}`, data: rd(`merchants/${n}`) });
    for (const n of listJson('models')) out.models.push({ file: `models/${n}`, data: rd(`models/${n}`) });
    return out;
}

// ---------- validate ----------

const MODEL_MESSAGES = {
    engine: (d) => `unknown engine (known: ${KNOWN_ENGINES.join(', ')})`,
    'fixed-total': (d) => `fixed model percentages must total 100, they total ${d}`,
    'fixed-needs-numbers': (d) => `bucket ${d}: a fixed model needs a number for every pct`,
    'role-duplicate': (d) => `role '${d}' is used by more than one bucket`,
    'bucket-slot': (d) => `bucket ${d}: slot must be a whole number 1 to 10`,
    'bucket-kind': (d) => `bucket ${d}: kind must be spend or save`,
    'bucket-pct': (d) => `bucket ${d}: pct is not a number, 'remainder' or 'expenses-first:...'`,
    'bucket-role': (d) => `bucket ${d}: unknown role`,
    'bucket-name': (d) => `bucket ${d}: name missing`,
};

export function modelDefProblems(def) {
    const res = validateModelDef(def);
    const out = res.errors.map((e) => (MODEL_MESSAGES[e.code] ? MODEL_MESSAGES[e.code](e.detail) : `${e.code}${e.detail != null ? ' ' + e.detail : ''}`));
    if (def && Array.isArray(def.buckets)) {
        const slots = new Set();
        for (const b of def.buckets) {
            if (b && Number.isInteger(b.slot)) {
                if (slots.has(b.slot)) out.push(`slot ${b.slot} is used by more than one bucket (slots must be unique)`);
                slots.add(b.slot);
            }
        }
    }
    if (def && def.engine && !KNOWN_ENGINES.includes(def.engine) && !res.errors.some((e) => e.code === 'engine')) out.push(`unknown engine '${def.engine}'`);
    else if (def && typeof def.engine === 'string' && !KNOWN_ENGINES.includes(def.engine)) out[out.findIndex((m) => m.startsWith('unknown engine'))] = `unknown engine '${def.engine}' (known: ${KNOWN_ENGINES.join(', ')})`;
    return out;
}

export function validateSource(s, v = makeValidators()) {
    const errors = [...s.errors];
    const need = (x, name) => { if (x === undefined) errors.push(`${name}: missing`); return x; };
    const release = need(s.release, 'release.json');
    if (release) errors.push(...schemaErrors(v.release, release, 'release.json'));
    const cats = need(s.categories, 'categories.json');
    const catIds = new Set();
    if (cats) {
        errors.push(...schemaErrors(v.categories, cats, 'categories.json'));
        for (const c of cats.categories || []) {
            if (catIds.has(c.id)) errors.push(`categories.json: duplicate category id '${c.id}'`);
            catIds.add(c.id);
            for (const kw of c.keywords || []) if (kw !== kw.toLowerCase()) errors.push(`categories.json: category '${c.id}' keyword '${kw}' must be lowercase`);
        }
        if (!catIds.has('other')) errors.push("categories.json: the 'other' category is required");
    }
    if (need(s.merchantsMeta, 'merchants/_meta.json')) errors.push(...schemaErrors(v.meta, s.merchantsMeta, 'merchants/_meta.json'));
    if (need(s.modelsMeta, 'models/_meta.json')) errors.push(...schemaErrors(v.meta, s.modelsMeta, 'models/_meta.json'));
    const at = need(s.assetTypes, 'asset-types.json');
    if (at) {
        errors.push(...schemaErrors(v['asset-types'], at, 'asset-types.json'));
        const ids = new Set();
        for (const t of at.types || []) { if (ids.has(t.id)) errors.push(`asset-types.json: duplicate asset type id '${t.id}'`); ids.add(t.id); }
    }
    if (s.tax) errors.push(...schemaErrors(v['tax-figures'], s.tax, 'tax.json'));

    // merchants
    const keys = new Map();
    const ids = new Map();
    for (const part of s.merchantParts) {
        if (!part.data) continue;
        errors.push(...schemaErrors(v['merchants-part'], part.data, part.file));
        const letter = part.file.replace('merchants/', '').replace('.json', '');
        if (!/^([a-z]|0)$/.test(letter)) errors.push(`${part.file}: merchant files are named a.json to z.json, or 0.json for keys that start with a digit`);
        for (const m of part.data.merchants || []) {
            const where = `${part.file}: merchant '${m.id}'`;
            if (ids.has(m.id)) errors.push(`${where}: duplicate id (also in ${ids.get(m.id)})`);
            ids.set(m.id, part.file);
            if (keys.has(m.key)) errors.push(`${where}: duplicate key '${m.key}' (also used by '${keys.get(m.key)}')`);
            keys.set(m.key, m.id);
            if (typeof m.key === 'string') {
                const first = m.key[0];
                const want = /[a-z]/.test(first) ? first : '0';
                if (letter !== want) errors.push(`${where}: key '${m.key}' belongs in ${want}.json, not ${letter}.json`);
            }
            if (m.categoryId && cats && !catIds.has(m.categoryId)) errors.push(`${where}: categoryId '${m.categoryId}' is not a category`);
            if (m.match === 'word') {
                if (m.key !== norm(m.key)) errors.push(`${where}: key '${m.key}' must be normalised (lowercase letters and digits, single spaces)`);
                for (const a of m.aliases || []) if (!(m.patterns || []).includes(a)) errors.push(`${where}: alias '${a}' is not one of the patterns`);
            } else {
                if (merchantKey(m.key) !== m.key) errors.push(`${where}: key '${m.key}' is not its own merchantKey (the app would make '${merchantKey(m.key)}')`);
                for (const a of m.aliases || []) if (merchantKey(a) !== m.key) errors.push(`${where}: alias '${a}' does not map to key '${m.key}' (merchantKey gives '${merchantKey(a)}')`);
            }
        }
    }

    // models
    const modelIds = new Set();
    for (const mf of s.models) {
        if (!mf.data) continue;
        errors.push(...schemaErrors(v['saving-model'], mf.data, mf.file));
        const stem = mf.file.replace('models/', '').replace('.json', '');
        if (mf.data.id !== stem) errors.push(`${mf.file}: id '${mf.data.id}' must match the file name '${stem}'`);
        if (modelIds.has(mf.data.id)) errors.push(`${mf.file}: duplicate model id '${mf.data.id}'`);
        modelIds.add(mf.data.id);
        const def = mf.data.model;
        if (def && def.id !== mf.data.id) errors.push(`${mf.file}: model.id '${def && def.id}' must equal the envelope id '${mf.data.id}'`);
        for (const p of modelDefProblems(def)) errors.push(`${mf.file}: model ${p}`);
        const req = mf.data.meta && mf.data.meta.requires && mf.data.meta.requires.engine;
        if (def && req && req !== def.engine) errors.push(`${mf.file}: meta.requires.engine '${req}' differs from model.engine '${def.engine}'`);
    }
    return errors;
}

// ---------- build ----------

const stringify = (o) => Buffer.from(JSON.stringify(o), 'utf8');
const hashed = (name, buf) => `${name}.${sha256(buf).slice(0, 8)}.json`;

export function buildRef(s, v = makeValidators()) {
    const errors = validateSource(s, v);
    if (errors.length) return { errors };
    const files = new Map(); // relative path in ref/ -> Buffer
    const entries = {};
    const add = (kind, name, content, rev) => {
        const buf = stringify(content);
        const path = hashed(name, buf);
        files.set(path, buf);
        entries[kind] = { path, sha256: sha256(buf), bytes: buf.length, rev };
        return buf;
    };
    add('categories', 'categories', s.categories, s.categories.rev);
    const merchants = s.merchantParts.flatMap((p) => (p.data ? p.data.merchants : []));
    add('merchants', 'merchants', { schema: 1, rev: s.merchantsMeta.rev, merchants }, s.merchantsMeta.rev);
    add('assetTypes', 'asset-types', s.assetTypes, s.assetTypes.rev);
    const index = [];
    for (const mf of [...s.models].sort((a, b) => a.data.id.localeCompare(b.data.id))) {
        const buf = stringify(mf.data);
        const path = hashed(`models/${mf.data.id}`, buf);
        files.set(path, buf);
        index.push({ id: mf.data.id, name: mf.data.meta.title, blurb: mf.data.meta.blurb, version: mf.data.version, engine: mf.data.model.engine, path, sha256: sha256(buf), bytes: buf.length });
    }
    add('models', 'models/index', { schema: 1, rev: s.modelsMeta.rev, models: index }, s.modelsMeta.rev);
    if (s.tax) add('tax', 'tax', s.tax, s.tax.rev);
    const manifest = { schema: 1, dataVersion: s.release.dataVersion, released: s.release.released, minApp: s.release.minApp, files: entries, disabled: [], sig: null };
    const mErr = schemaErrors(v.manifest, manifest, 'manifest.json');
    // Output files are checked against their schemas too, so the built bytes are what was validated.
    const outErr = [...mErr, ...builtContentErrors(files, entries, v)];
    // gzip caps
    for (const [kind, e] of Object.entries(entries)) {
        const size = gz(files.get(e.path));
        if (size > GZIP_CAPS[kind]) outErr.push(`${e.path}: gzip size ${size} bytes is over the ${GZIP_CAPS[kind]} byte cap`);
    }
    for (const m of index) { const size = gz(files.get(m.path)); if (size > GZIP_CAPS.model) outErr.push(`${m.path}: gzip size ${size} bytes is over the ${GZIP_CAPS.model} byte cap`); }
    files.set('manifest.json', stringify(manifest));
    return { errors: outErr, manifest, files, index };
}

const KIND_SCHEMA = { categories: 'categories', merchants: 'merchants', assetTypes: 'asset-types', models: 'models-index', tax: 'tax-figures' };

function builtContentErrors(files, entries, v) {
    const errs = [];
    for (const [kind, e] of Object.entries(entries)) {
        const buf = files.get(e.path);
        errs.push(...schemaErrors(v[KIND_SCHEMA[kind]], JSON.parse(buf.toString('utf8')), e.path));
    }
    return errs;
}

// Check a built ref folder (a fresh build, or the pinned baseline): manifest valid, every file present with the stated hash.
export function verifyBuiltDir(dir, v = makeValidators()) {
    const errs = [];
    const mp = join(dir, 'manifest.json');
    if (!existsSync(mp)) return [`${dir}: manifest.json missing`];
    const manifest = readJson(mp);
    errs.push(...schemaErrors(v.manifest, manifest, `${dir}/manifest.json`));
    if (errs.length) return errs;
    const files = new Map();
    const entries = manifest.files;
    for (const [kind, e] of Object.entries(entries)) {
        const p = join(dir, e.path);
        if (!existsSync(p)) { errs.push(`${e.path}: listed in the manifest but missing`); continue; }
        const buf = readFileSync(p);
        if (sha256(buf) !== e.sha256 || buf.length !== e.bytes) errs.push(`${e.path}: bytes or sha256 differ from the manifest`);
        if (!e.path.includes(e.sha256.slice(0, 8))) errs.push(`${e.path}: file name does not carry the first 8 characters of its sha256`);
        files.set(e.path, buf);
        if (kind === 'models') {
            for (const m of JSON.parse(buf.toString('utf8')).models) {
                const mp2 = join(dir, m.path);
                if (!existsSync(mp2)) { errs.push(`${m.path}: listed in the models index but missing`); continue; }
                const mb = readFileSync(mp2);
                if (sha256(mb) !== m.sha256 || mb.length !== m.bytes) errs.push(`${m.path}: bytes or sha256 differ from the models index`);
                const doc = JSON.parse(mb.toString('utf8'));
                errs.push(...schemaErrors(v['saving-model'], doc, m.path), ...modelDefProblems(doc.model).map((p) => `${m.path}: model ${p}`));
            }
        }
    }
    errs.push(...builtContentErrors(files, entries, v));
    return errs;
}

export function baselineGzipBytes(dir) {
    let total = 0;
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else total += gz(readFileSync(p)); } };
    if (existsSync(dir)) walk(dir);
    return total;
}

function writeFiles(dir, files) {
    for (const [rel, buf] of files) {
        const p = join(dir, rel);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, buf);
    }
}

export function refreshBaseline(built, baselineDir = join(REF_DIR, 'baseline')) {
    rmSync(baselineDir, { recursive: true, force: true });
    writeFiles(baselineDir, built.files);
}

/** Write <distDir>/ref/: manifest, hashed files, and the pinned baseline. Throws on any problem. */
export function buildToDist(distDir, { src, baselineDir = join(REF_DIR, 'baseline') } = {}) {
    const v = makeValidators();
    const built = buildRef(loadSource(src), v);
    if (built.errors.length) throw new Error('reference data is invalid:\n  ' + built.errors.join('\n  '));
    const bErr = verifyBuiltDir(baselineDir, v);
    if (bErr.length) throw new Error('reference/baseline is not a valid snapshot (run: node reference/tools/build.mjs --refresh-baseline):\n  ' + bErr.join('\n  '));
    const bBytes = baselineGzipBytes(baselineDir);
    if (bBytes > BASELINE_GZIP_CAP) throw new Error(`reference/baseline gzip total ${bBytes} bytes is over the ${BASELINE_GZIP_CAP} byte cap`);
    const refDir = join(resolve(distDir), 'ref');
    rmSync(refDir, { recursive: true, force: true });
    writeFiles(refDir, built.files);
    cpSync(baselineDir, join(refDir, 'baseline'), { recursive: true });
    return { built, refDir, baselineGzip: bBytes };
}

// ---------- diff ----------

function idMaps(s) {
    const m = {};
    const byId = (arr) => new Map((arr || []).map((x) => [x.id, JSON.stringify(x)]));
    m.categories = byId(s.categories && s.categories.categories);
    m.merchants = byId(s.merchantParts.flatMap((p) => (p.data ? p.data.merchants : [])));
    m.assetTypes = byId(s.assetTypes && s.assetTypes.types);
    m.models = new Map(s.models.filter((x) => x.data).map((x) => [x.data.id, JSON.stringify(x.data)]));
    const tax = new Map();
    if (s.tax && s.tax.years) for (const [y, groups] of Object.entries(s.tax.years)) for (const [g, figs] of Object.entries(groups)) for (const [n, f] of Object.entries(figs)) tax.set(`${y}/${g}/${n}`, JSON.stringify(f));
    m.tax = tax;
    return m;
}
const revOf = (s) => ({ categories: s.categories && s.categories.rev, merchants: s.merchantsMeta && s.merchantsMeta.rev, assetTypes: s.assetTypes && s.assetTypes.rev, models: s.modelsMeta && s.modelsMeta.rev, tax: s.tax && s.tax.rev });

export function diffSources(base, head) {
    const a = idMaps(base);
    const b = idMaps(head);
    const ra = revOf(base);
    const rb = revOf(head);
    const lines = [];
    let changedKinds = 0;
    for (const kind of Object.keys(b)) {
        const added = [...b[kind].keys()].filter((k) => !a[kind].has(k));
        const removed = [...a[kind].keys()].filter((k) => !b[kind].has(k));
        const changed = [...b[kind].keys()].filter((k) => a[kind].has(k) && a[kind].get(k) !== b[kind].get(k));
        const same = !added.length && !removed.length && !changed.length;
        const revMoved = ra[kind] !== rb[kind];
        if (same && !revMoved) continue;
        changedKinds++;
        lines.push(`### ${kind}: ${added.length} added, ${changed.length} changed, ${removed.length} removed (rev ${ra[kind] ?? '-'} to ${rb[kind] ?? '-'})`);
        const list = (label, arr) => { if (arr.length) lines.push(`- ${label}: ${arr.slice(0, 200).map((x) => '`' + x + '`').join(', ')}${arr.length > 200 ? ` and ${arr.length - 200} more` : ''}`); };
        list('added', added); list('changed', changed); list('removed', removed);
        if (!same && !(rb[kind] > (ra[kind] ?? 0))) lines.push(`- WARNING: content changed but rev was not raised (${ra[kind] ?? '-'} to ${rb[kind] ?? '-'}). Raise it by 1.`);
    }
    const head1 = ['## Reference data changes', ''];
    const va = base.release && base.release.dataVersion;
    const vb = head.release && head.release.dataVersion;
    if (va !== vb) head1.push(`dataVersion: ${va ?? '-'} to ${vb ?? '-'}`, '');
    if (!changedKinds && va === vb) head1.push('No data changes.');
    return [...head1, ...lines].join('\n') + '\n';
}

export function resolveSrcDir(p) {
    const r = resolve(p);
    if (existsSync(join(r, 'src', 'release.json')) || existsSync(join(r, 'src', 'categories.json'))) return join(r, 'src');
    return r;
}

// ---------- CLI ----------

async function main(argv) {
    const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
    const quiet = argv.includes('--quiet');
    const log = (...x) => { if (!quiet) console.log(...x); };
    const src = arg('--src') ? resolve(arg('--src')) : join(REF_DIR, 'src');
    const v = makeValidators();
    const s = loadSource(src);
    const built = buildRef(s, v);
    if (built.errors.length) {
        console.error('REFERENCE CHECK FAILED');
        for (const e of built.errors) console.error('  ' + e);
        return 1;
    }
    const baselineDir = join(REF_DIR, 'baseline');
    if (argv.includes('--refresh-baseline')) { refreshBaseline(built, baselineDir); log('baseline refreshed from the current source'); }
    const testsDir = join(REF_DIR, 'tests');
    const fxErr = arg('--src') ? [] : [...fixtureErrors(s, testsDir), ...importPathErrors(s, testsDir)];
    if (fxErr.length) { console.error('REFERENCE FIXTURES FAILED'); for (const e of fxErr) console.error('  ' + e); return 1; }
    const atRes = arg('--src') ? { errors: [], lines: 0 } : assetTypeErrors(s, testsDir);
    if (atRes.errors.length) { console.error('ASSET TYPES FAILED'); for (const e of atRes.errors) console.error('  ' + e); return 1; }
    const bErr = verifyBuiltDir(baselineDir, v);
    if (bErr.length) { console.error('REFERENCE BASELINE INVALID (run --refresh-baseline)'); for (const e of bErr) console.error('  ' + e); return 1; }
    if (arg('--diff')) {
        const base = loadSource(resolveSrcDir(arg('--diff')));
        console.log(diffSources(base, s));
    }
    let total = 0;
    const rows = [...built.files].filter(([p]) => p !== 'manifest.json').map(([p, buf]) => { total += gz(buf); return `${p}  ${buf.length} bytes, ${gz(buf)} gzip`; });
    const bBytes = baselineGzipBytes(baselineDir);
    if (bBytes > BASELINE_GZIP_CAP) { console.error(`baseline gzip total ${bBytes} is over the ${BASELINE_GZIP_CAP} cap`); return 1; }
    if (arg('--out')) {
        const r = buildToDist(arg('--out'), { src });
        log(`wrote ${r.refDir}`);
    }
    if (!arg('--diff')) {
        log(`asset types ok: ${atRes.lines} name cases`);
        log(`fixtures and import path ok: ${fixtureLines(testsDir).length} lines`);
        log(`reference ok: dataVersion ${built.manifest.dataVersion}, ${built.files.size} files, ${total} bytes gzip (this build), baseline ${bBytes} bytes gzip`);
        for (const r of rows) log('  ' + r);
        const live = JSON.stringify(readJson(join(baselineDir, 'manifest.json')).files);
        const now = JSON.stringify(built.manifest.files);
        if (live !== now) log('  note: the pinned baseline is older than the source (normal after a data-only change; refresh it when you cut an app release)');
    }
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main(process.argv.slice(2));
}
