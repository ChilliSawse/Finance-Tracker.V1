// Test cases for the "ref-build" group (FT-0032 DB1): the reference database build and its gate.
// Node only (it reads reference/ from disk and runs Ajv): in tests.html each case passes at once.
// Synthetic data only. Shape: { name, fn(assert) }, assert(label, actual, expected).

const IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node);

async function env() {
    const n = (m) => import(/* @vite-ignore */ m);
    const fs = await n('node:fs');
    const path = await n('node:path');
    const os = await n('node:os');
    const cp = await n('node:child_process');
    const url = await n('node:url');
    const build = await n(new URL('../reference/tools/build.mjs', import.meta.url).href);
    const root = url.fileURLToPath(new URL('..', import.meta.url));
    return { fs, path, os, cp, build, root, refSrc: path.join(root, 'reference', 'src') };
}

// A scratch copy of reference/src that a case may break on purpose.
async function scratchSrc(e) {
    const dir = e.fs.mkdtempSync(e.path.join(e.os.tmpdir(), 'ft-refsrc-'));
    e.fs.cpSync(e.refSrc, dir, { recursive: true });
    return dir;
}
const put = (e, dir, rel, obj) => { e.fs.mkdirSync(e.path.dirname(e.path.join(dir, rel)), { recursive: true }); e.fs.writeFileSync(e.path.join(dir, rel), JSON.stringify(obj)); };
const problems = (e, dir) => e.build.validateSource(e.build.loadSource(dir));
const merchant = (o) => ({ id: 'fake-shop', key: 'fakeshop', name: 'Fake Shop (test)', categoryId: 'groceries', match: 'key', confidence: 'low', source: 'test fixture, not real', reviewed: null, ...o });
const model = (o = {}, def = {}) => ({
    schema: 1, id: 'test-split', version: '1.0.0',
    meta: { title: 'Test split', blurb: 'A test model.', source: 'test fixture', licence: 'CC0-1.0', reviewed: null, requires: { engine: 'fixed' } },
    model: { id: 'test-split', name: 'Test split', basis: 'net', engine: 'fixed',
        buckets: [{ name: 'A', slot: 1, kind: 'spend', pct: 60 }, { name: 'B', slot: 2, kind: 'save', pct: 40 }],
        rules: { coreBuckets: [], maxDepth: 3, renamable: true, splitEditable: true, topLevelAddAllowed: true }, ...def },
    ...o,
});

async function withScratch(fn) {
    const e = await env();
    const dir = await scratchSrc(e);
    try { return await fn(e, dir); } finally { e.fs.rmSync(dir, { recursive: true, force: true }); }
}

export const REF_BUILD_TEST_CASES = [
    { name: 'DB1.1 the shipped reference source passes every check', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        const e = await env();
        assert('no problems', problems(e, e.refSrc), []);
        const built = e.build.buildRef(e.build.loadSource(e.refSrc));
        assert('builds without errors', built.errors, []);
        assert('manifest names the four required kinds and the tax file (DB14)', Object.keys(built.manifest.files).sort(), ['assetTypes', 'categories', 'merchants', 'models', 'tax']);
        assert('dataVersion is CalVer', /^\d{4}\.\d{2}\.\d+$/.test(built.manifest.dataVersion), true);
    } },
    { name: 'DB1.2 a merchant whose key is not its own merchantKey fails with a clear message', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        await withScratch((e, dir) => {
            put(e, dir, 'merchants/f.json', { schema: 1, merchants: [merchant({ key: 'fakeshop 1234', id: 'fake-bad-key' })] });
            const p = problems(e, dir);
            assert('names the key and what the app would make', p.some((m) => m.includes("key 'fakeshop 1234' is not its own merchantKey") && m.includes("'fakeshop'")), true);
        });
    } },
    { name: 'DB1.3 a duplicate merchant key fails, and so does an alias that maps elsewhere and a missing category', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        await withScratch((e, dir) => {
            put(e, dir, 'merchants/f.json', { schema: 1, merchants: [merchant({}), merchant({ id: 'fake-shop-2' })] });
            assert('duplicate key', problems(e, dir).some((m) => m.includes("duplicate key 'fakeshop'")), true);
            put(e, dir, 'merchants/f.json', { schema: 1, merchants: [merchant({ aliases: ['otherplace'] })] });
            assert('alias to another key', problems(e, dir).some((m) => m.includes("alias 'otherplace' does not map to key 'fakeshop'")), true);
            put(e, dir, 'merchants/f.json', { schema: 1, merchants: [merchant({ categoryId: 'no-such-category' })] });
            assert('unknown categoryId', problems(e, dir).some((m) => m.includes("categoryId 'no-such-category' is not a category")), true);
            put(e, dir, 'merchants/g.json', { schema: 1, merchants: [merchant({})] });
            assert('wrong letter file', problems(e, dir).some((m) => m.includes('belongs in f.json, not g.json')), true);
        });
    } },
    { name: 'DB1.4 a merchant with no source or evidence, or with reviewed missing, fails the schema', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        await withScratch((e, dir) => {
            const noSource = merchant({}); delete noSource.source;
            put(e, dir, 'merchants/f.json', { schema: 1, merchants: [noSource] });
            assert('source or evidence required', problems(e, dir).length > 0, true);
            const noReviewed = merchant({}); delete noReviewed.reviewed;
            put(e, dir, 'merchants/f.json', { schema: 1, merchants: [noReviewed] });
            assert('reviewed required (null is allowed)', problems(e, dir).some((m) => m.includes("'reviewed'")), true);
        });
    } },
    { name: 'DB1.5 a saving model with an unknown engine, a bad total or a repeated slot fails', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        await withScratch((e, dir) => {
            put(e, dir, 'models/test-split.json', model({}, { engine: 'milestones' }));
            assert('unknown engine', problems(e, dir).some((m) => m.includes("unknown engine 'milestones' (known: expenses-first, fixed)")), true);
            put(e, dir, 'models/test-split.json', model({}, { buckets: [{ name: 'A', slot: 1, kind: 'spend', pct: 60 }, { name: 'B', slot: 2, kind: 'save', pct: 30 }] }));
            assert('fixed total', problems(e, dir).some((m) => m.includes('must total 100, they total 90')), true);
            put(e, dir, 'models/test-split.json', model({}, { buckets: [{ name: 'A', slot: 1, kind: 'spend', pct: 60 }, { name: 'B', slot: 1, kind: 'save', pct: 40 }] }));
            assert('repeated slot', problems(e, dir).some((m) => m.includes('slot 1 is used by more than one bucket')), true);
            put(e, dir, 'models/test-split.json', model());
            assert('the good fixture passes', problems(e, dir), []);
        });
    } },
    { name: 'DB1.6 BUCKET_METHOD passes validateModelDef and the saving-model schema, so the two agree', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        const e = await env();
        const { BUCKET_METHOD, validateModelDef } = await import('./calc/saving-model.js');
        const def = JSON.parse(JSON.stringify(BUCKET_METHOD));
        assert('validateModelDef', validateModelDef(def).ok, true);
        const v = e.build.makeValidators();
        const env1 = model({ id: 'bucket-method' }, {});
        env1.model = def;
        env1.meta.requires.engine = def.engine;
        assert('schema', v['saving-model'](env1), true);
        assert('both known engines are accepted by the validator too', e.build.KNOWN_ENGINES.every((en) => validateModelDef({ ...model().model, engine: en, buckets: en === 'fixed' ? model().model.buckets : def.buckets }).errors.every((x) => x.code !== 'engine')), true);
        assert('an unknown engine fails both', [validateModelDef({ ...def, engine: 'milestones' }).ok, v['saving-model']({ ...env1, model: { ...def, engine: 'milestones' } })], [false, false]);
    } },
    { name: 'DB1.7 the build writes hashed files, a valid manifest and the baseline; a built folder verifies and tampering is caught', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        const e = await env();
        const dist = e.fs.mkdtempSync(e.path.join(e.os.tmpdir(), 'ft-refdist-'));
        try {
            const r = e.build.buildToDist(dist);
            const ref = e.path.join(dist, 'ref');
            const manifest = JSON.parse(e.fs.readFileSync(e.path.join(ref, 'manifest.json'), 'utf8'));
            assert('every listed file exists', Object.values(manifest.files).every((f) => e.fs.existsSync(e.path.join(ref, f.path))), true);
            assert('file names carry the hash', Object.values(manifest.files).every((f) => f.path.includes(f.sha256.slice(0, 8))), true);
            assert('the baseline has its own manifest and the same paths', e.fs.existsSync(e.path.join(ref, 'baseline', 'manifest.json')) && Object.values(JSON.parse(e.fs.readFileSync(e.path.join(ref, 'baseline', 'manifest.json'), 'utf8')).files).every((f) => e.fs.existsSync(e.path.join(ref, 'baseline', f.path))), true);
            assert('built folder verifies', e.build.verifyBuiltDir(ref), []);
            const first = Object.values(manifest.files)[0].path;
            e.fs.appendFileSync(e.path.join(ref, first), ' ');
            assert('a changed byte is caught', e.build.verifyBuiltDir(ref).length > 0, true);
            assert('baseline size is reported and under the cap', r.baselineGzip > 0 && r.baselineGzip < e.build.BASELINE_GZIP_CAP, true);
        } finally { e.fs.rmSync(dist, { recursive: true, force: true }); }
    } },
    { name: 'DB1.8 --diff lists added, changed and removed ids and warns when rev was not raised', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        await withScratch(async (e, dir) => {
            const base = e.build.loadSource(dir);
            const cats = JSON.parse(e.fs.readFileSync(e.path.join(dir, 'categories.json'), 'utf8'));
            cats.categories[0].name = 'Renamed groceries';
            cats.categories.pop();
            cats.categories.push({ ...cats.categories[0], id: 'fake-new', name: 'Fake new' });
            put(e, dir, 'categories.json', cats);
            const head = e.build.loadSource(dir);
            const text = e.build.diffSources(base, head);
            assert('added', text.includes('- added: `fake-new`'), true);
            assert('changed', text.includes('- changed: `groceries`'), true);
            assert('removed', text.includes('- removed: `other`'), true);
            assert('rev warning', text.includes('WARNING: content changed but rev was not raised'), true);
            assert('no change reads as no change', e.build.diffSources(base, base).includes('No data changes.'), true);
        });
    } },
    { name: 'DB1.9 a data-only change leaves dist/sw.js byte-identical (the pinned baseline is the only ref/ file the service worker precaches)', async fn(assert) {
        if (!IS_NODE) { assert('node only', true, true); return; }
        await withScratch((e, dir) => {
            const out = e.fs.mkdtempSync(e.path.join(e.os.tmpdir(), 'ft-refsw-'));
            const run = (name) => {
                const outDir = e.path.join(out, name);
                const r = e.cp.spawnSync(process.execPath, [e.path.join(e.root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'],
                    { cwd: e.root, env: { ...process.env, FT_NO_TESTS: '1', FT_REF_SRC: dir }, encoding: 'utf8' });
                return { status: r.status, log: (r.stdout || '') + (r.stderr || ''), sw: e.path.join(outDir, 'sw.js'), outDir };
            };
            try {
                const a = run('a');
                assert('build a ok', a.status, 0);
                const cats = JSON.parse(e.fs.readFileSync(e.path.join(dir, 'categories.json'), 'utf8'));
                cats.rev += 1;
                cats.categories[0].keywords.push('fake keyword for the byte test');
                put(e, dir, 'categories.json', cats);
                const b = run('b');
                assert('build b ok', b.status, 0);
                const ma = JSON.parse(e.fs.readFileSync(e.path.join(a.outDir, 'ref', 'manifest.json'), 'utf8'));
                const mb = JSON.parse(e.fs.readFileSync(e.path.join(b.outDir, 'ref', 'manifest.json'), 'utf8'));
                assert('the data really changed (new hashed categories file)', ma.files.categories.path !== mb.files.categories.path, true);
                assert('sw.js is byte-identical', e.fs.readFileSync(a.sw).equals(e.fs.readFileSync(b.sw)), true);
                const sw = e.fs.readFileSync(a.sw, 'utf8');
                const urls = [...sw.matchAll(/url:"(ref\/[^"]+)"/g)].map((m) => m[1]);
                assert('sw.js precaches the baseline and nothing else under ref/', [urls.includes('ref/baseline/manifest.json'), urls.every((u) => u.startsWith('ref/baseline/'))], [true, true]);
            } finally { e.fs.rmSync(out, { recursive: true, force: true }); }
        });
    } },
];
