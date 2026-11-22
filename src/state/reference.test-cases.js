// R4 (FT-0032): the read-only reference client against fakes (fetch, Cache Storage, storage, clock). Pure: no network.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    checkForReferenceUpdate, getReference, rollbackReference, getStoredReferenceVersion, setReferenceCheckEnabled, REF_CHECKED_KEY, REF_CHECK_INTERVAL_MS, sha256Hex,
} from './reference.js';
import { validateReferenceFile, validateManifest, compareVersions, isSafeRefPath } from './reference-validate.js';
import { DEFAULT_CATEGORIES } from './categories.js';

const enc = new TextEncoder();
const T0 = Date.UTC(2026, 10, 22);

const catDoc = (rev, name) => ({ schema: 1, rev, categories: [{ id: 'groceries', name, keywords: ['shop'], essential: true }] });
const merDoc = (rev, key) => ({ schema: 1, rev, merchants: [{ id: 'm-' + key, key, categoryId: 'groceries', match: 'key', confidence: 'high' }] });

// A fake server: files by relative path, every requested URL recorded.
async function makeServer(spec, opts = {}) {
    const files = new Map();
    const manifest = { schema: 1, dataVersion: spec.dataVersion, released: '2026-11-22', minApp: spec.minApp || '2.0.0', files: {}, disabled: spec.disabled || [], sig: null };
    for (const [kind, doc] of Object.entries(spec.docs)) {
        const text = JSON.stringify(doc);
        const bytes = enc.encode(text);
        const path = kind + '.' + (spec.tag || 'a') + '.json';
        files.set(path, text);
        manifest.files[kind] = { path, sha256: await sha256Hex(bytes), bytes: bytes.byteLength, rev: doc.rev };
    }
    if (opts.mutate) opts.mutate(manifest, files);
    files.set('manifest.json', JSON.stringify(manifest));
    return files;
}

function makeEnv(files, over = {}) {
    const urls = [];
    const store = new Map();
    const ls = new Map();
    const net = { files, fail: false };
    const env = {
        urls, store, ls, net,
        base: './',
        now: () => env.clock,
        clock: T0,
        appVersion: '2.0.0',
        storage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); } },
        caches: {
            async open() {
                return {
                    async match(u) { return store.has(u) ? new Response(store.get(u)) : undefined; },
                    async put(u, res) { store.set(u, new Uint8Array(await res.arrayBuffer())); },
                    async delete(u) { return store.delete(u); },
                    async keys() { return [...store.keys()].map((url) => ({ url })); },
                };
            },
        },
        fetch: async (url) => {
            urls.push(url);
            if (net.fail) throw new TypeError('network down');
            const rel = url.replace(/^\.\/ref\//, '');
            if (!net.files.has(rel)) return new Response('not found', { status: 404 });
            return new Response(net.files.get(rel));
        },
        ...over,
    };
    return env;
}

const check = (env, extra = {}) => checkForReferenceUpdate({ env, force: true, ...extra });
const names = (view) => view.categories.map((c) => c.name);

export const REFERENCE_TEST_CASES = [
    {
        name: 'R4 validator: good files pass; bad shapes fail with a message',
        fn: async (assert) => {
            assert('good categories', validateReferenceFile('categories', catDoc(1, 'Groceries')).ok, true);
            assert('good merchants', validateReferenceFile('merchants', merDoc(1, 'woolworths')).ok, true);
            assert('unknown schema', validateReferenceFile('categories', { ...catDoc(1, 'x'), schema: 2 }).ok, false);
            assert('missing list', validateReferenceFile('categories', { schema: 1, rev: 1 }).ok, false);
            assert('bad entry names the field', validateReferenceFile('merchants', { schema: 1, rev: 1, merchants: [{ id: 'a' }] }).error, 'merchants: merchants[0].key must be a non-empty string');
            assert('duplicate id', validateReferenceFile('categories', { schema: 1, rev: 1, categories: [catDoc(1, 'a').categories[0], catDoc(1, 'b').categories[0]] }).ok, false);
            assert('proto key', validateReferenceFile('categories', JSON.parse('{"schema":1,"rev":1,"categories":[],"__proto__":{"x":1}}')).ok, false);
            assert('unknown kind', validateReferenceFile('nope', {}).ok, false);
            assert('versions', [compareVersions('2.0.0', '2.0.1'), compareVersions('2.1', '2.0.9'), compareVersions('2.0.0', '2')], [-1, 1, 0]);
            assert('paths', ['a.json', 'models/x.1.json', 'a.json?x=1', '../a.json', '/a.json', 'http://x/a.json'].map(isSafeRefPath), [true, true, false, false, false, false]);
            assert('manifest ok', validateManifest(JSON.parse((await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'G') } })).get('manifest.json'))).ok, true);
        },
    },
    {
        name: 'R4 first check installs, getReference reads the cache',
        fn: async (assert) => {
            const env = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'Groceries v1'), merchants: merDoc(1, 'woolworths') } }));
            const r = await check(env);
            const view = await getReference(env);
            assert('status', r.status, 'updated');
            assert('dataVersion', view.dataVersion, '2026.11.1');
            assert('sources', [view.sources.categories, view.sources.merchants, view.sources.assetTypes], ['cache', 'cache', 'default']);
            assert('category from cache', names(view), ['Groceries v1']);
            assert('merchant list', view.merchants.length, 1);
            assert('no defaults for the rest', [view.assetTypes, view.models], [[], []]);
        },
    },
    {
        name: 'R4 with nothing cached: baseline, then in-code defaults',
        fn: async (assert) => {
            const empty = makeEnv(new Map());
            const v1 = await getReference(empty);
            assert('categories fall back to DEFAULT_CATEGORIES', [v1.sources.categories, v1.categories.length, v1.dataVersion], ['default', DEFAULT_CATEGORIES.length, null]);
            const base = await makeServer({ dataVersion: '2026.10.1', docs: { categories: catDoc(1, 'Baseline cat') } });
            const files = new Map();
            for (const [k, v] of base) files.set('baseline/' + k, v);
            files.set('baseline/manifest.json', base.get('manifest.json'));
            const env = makeEnv(files);
            const v2 = await getReference(env);
            assert('baseline used', [v2.sources.categories, names(v2), v2.dataVersion], ['baseline', ['Baseline cat'], '2026.10.1']);
        },
    },
    {
        name: 'R4 failures keep the previous good copy',
        fn: async (assert) => {
            const good = { dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'Good') } };
            const cases = [
                ['bad hash', (m) => { m.files.categories.sha256 = 'a'.repeat(64); }, 'error'],
                ['truncated body', (m, f) => { const p = m.files.categories.path; f.set(p, f.get(p).slice(0, 20)); }, 'error'],
                ['wrong byte count', (m) => { m.files.categories.bytes += 5; }, 'error'],
                ['404 on the file', (m, f) => { f.delete(m.files.categories.path); }, 'error'],
            ];
            for (const [label, mutate, status] of cases) {
                const env = makeEnv(await makeServer(good));
                await check(env);
                env.net.files = await makeServer({ dataVersion: '2026.11.2', tag: 'b', docs: { categories: catDoc(2, 'Bad') } }, { mutate });
                const r = await check(env);
                const view = await getReference(env);
                assert(label + ': status', r.status, status);
                assert(label + ': previous data stays', [names(view), view.dataVersion], [['Good'], '2026.11.1']);
            }
            // Bad schema inside the file: hash and size are right, content fails the validator.
            const env = makeEnv(await makeServer(good));
            await check(env);
            env.net.files = await makeServer({ dataVersion: '2026.11.2', tag: 'b', docs: { categories: { schema: 1, rev: 2, categories: [{ id: 'x' }] } } });
            const r = await check(env);
            assert('bad schema in file: status', r.status, 'error');
            assert('bad schema in file: previous stays', names(await getReference(env)), ['Good']);
            // Network error.
            env.net.fail = true;
            const n = await check(env);
            assert('network error: status', n.status, 'error');
            assert('network error: previous stays', names(await getReference(env)), ['Good']);
        },
    },
    {
        name: 'R4 unknown schema and minApp too high stop the check',
        fn: async (assert) => {
            const env = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'Good') } }));
            await check(env);
            const reqs = env.urls.length;
            env.net.files = await makeServer({ dataVersion: '2026.11.2', tag: 'b', docs: { categories: catDoc(2, 'New') } }, { mutate: (m) => { m.schema = 2; } });
            assert('unknown schema', (await check(env)).status, 'unknown-schema');
            assert('only the manifest was fetched', env.urls.length, reqs + 1);
            env.net.files = await makeServer({ dataVersion: '2026.11.2', tag: 'b', minApp: '9.0.0', docs: { categories: catDoc(2, 'New') } });
            assert('minApp too high', (await check(env)).status, 'app-too-old');
            assert('current data stays', names(await getReference(env)), ['Good']);
        },
    },
    {
        name: 'R4 an update swaps the changed file only; rollback re-points to the previous version',
        fn: async (assert) => {
            const env = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'One'), merchants: merDoc(1, 'aldi') } }));
            await check(env);
            env.net.files = await makeServer({ dataVersion: '2026.11.2', tag: 'b', docs: { categories: catDoc(2, 'Two'), merchants: merDoc(1, 'aldi') } },
                { mutate: (m) => { m.files.merchants.path = 'merchants.a.json'; } });
            env.net.files.set('merchants.a.json', JSON.stringify(merDoc(1, 'aldi')));
            const before = env.urls.length;
            const r = await check(env);
            const fetched = env.urls.slice(before);
            assert('updated', [r.status, (await getReference(env)).dataVersion], ['updated', '2026.11.2']);
            assert('unchanged merchants file was not refetched', fetched.some((u) => u.includes('merchants.')), false);
            assert('new data live', names(await getReference(env)), ['Two']);
            const rb = await rollbackReference(env);
            assert('rollback ok', [rb.ok, rb.dataVersion], [true, '2026.11.1']);
            assert('old data live', names(await getReference(env)), ['One']);
            assert('a check does not reinstall the rolled-back version', (await check(env)).status, 'unchanged');
            assert('still old', names(await getReference(env)), ['One']);
            assert('nothing left to roll back to', (await rollbackReference(env)).ok, false);
            // A newer release clears the pin.
            env.net.files = await makeServer({ dataVersion: '2026.11.3', tag: 'c', docs: { categories: catDoc(3, 'Three') } });
            assert('newer release installs', [(await check(env)).status, names(await getReference(env))], ['updated', ['Three']]);
        },
    },
    {
        name: 'R4 keeps only the previous two versions',
        fn: async (assert) => {
            const env = makeEnv(new Map());
            for (let i = 1; i <= 4; i++) {
                env.net.files = await makeServer({ dataVersion: '2026.11.' + i, tag: 't' + i, docs: { categories: catDoc(i, 'V' + i) } });
                await check(env);
            }
            assert('v4 live', names(await getReference(env)), ['V4']);
            assert('back to v3', (await rollbackReference(env)).dataVersion, '2026.11.3');
            assert('back to v2', (await rollbackReference(env)).dataVersion, '2026.11.2');
            assert('v1 was dropped', (await rollbackReference(env)).ok, false);
            const bodies = [...env.store.keys()].filter((k) => k.includes('/f/')).length;
            assert('bodies pruned to the versions kept', bodies, 1);
        },
    },
    {
        name: 'R4 the disabled list sends a kind to the baseline',
        fn: async (assert) => {
            const base = await makeServer({ dataVersion: '2026.10.1', docs: { merchants: merDoc(1, 'baseline-shop') } });
            const files = await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'Cat'), merchants: merDoc(2, 'bad-shop') } });
            for (const [k, v] of base) files.set('baseline/' + k, v);
            const env = makeEnv(files);
            await check(env);
            assert('both from cache', (await getReference(env)).merchants[0].key, 'bad-shop');
            const m = JSON.parse(files.get('manifest.json'));
            m.disabled = ['merchants'];
            files.set('manifest.json', JSON.stringify(m));
            const r = await check(env);
            const view = await getReference(env);
            assert('kill switch applied', [r.status, view.sources.merchants, view.merchants[0].key], ['updated', 'baseline', 'baseline-shop']);
            assert('other kinds untouched', [view.sources.categories, names(view)], ['cache', ['Cat']]);
        },
    },
    {
        name: 'R4 rate limit, query strings, and the off switch',
        fn: async (assert) => {
            const env = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'One'), merchants: merDoc(1, 'x') } }));
            const opts = { env };
            assert('first check runs', (await checkForReferenceUpdate(opts)).status, 'updated');
            const n = env.urls.length;
            assert('stamped', env.ls.get(REF_CHECKED_KEY), String(T0));
            env.clock = T0 + REF_CHECK_INTERVAL_MS - 1000;
            assert('inside 24 h: rate limited', (await checkForReferenceUpdate(opts)).status, 'rate-limited');
            assert('no request made', env.urls.length, n);
            env.clock = T0 + REF_CHECK_INTERVAL_MS + 1000;
            assert('after 24 h: runs', (await checkForReferenceUpdate(opts)).status, 'unchanged');
            assert('manifest fetched once more', env.urls.length, n + 1);
            assert('no URL has a query string, fragment or scheme', env.urls.filter((u) => /[?#]|:\/\//.test(u)).length, 0);
            assert('all under ref/', env.urls.every((u) => u.startsWith('./ref/')), true);

            const off = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'One') } }));
            assert('off: status', (await checkForReferenceUpdate({ env: off, enabled: false, force: true })).status, 'off');
            assert('off: no request, nothing stored', [off.urls.length, off.store.size, off.ls.size], [0, 0, 0]);
            const broken = makeEnv(new Map(), { storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
            assert('storage that throws does not break a check', (await checkForReferenceUpdate({ env: broken })).status, 'error');
        },
    },
    {
        name: 'R4 validator accepts what DB1 schemas allow',
        fn: async (assert) => {
            const m = (match) => ({ schema: 1, rev: 1, merchants: [{ id: 'm-a', key: 'a', categoryId: 'groceries', match, confidence: 'high' }] });
            assert('match word', validateReferenceFile('merchants', m('word')).ok, true);
            assert('match regex refused', validateReferenceFile('merchants', m('regex')).ok, false);
            const t = (e) => validateReferenceFile('assetTypes', { schema: 1, rev: 1, types: [{ id: 't', kind: 'car', ...e }] }).ok;
            assert('asset type with label', t({ label: 'Car' }), true);
            assert('asset type with name', t({ name: 'Car' }), true);
            assert('asset type with neither', t({}), false);
            const long = 'k'.repeat(100);
            assert('100-char keyword and 1000-char name', validateReferenceFile('categories', { schema: 1, rev: 1, categories: [{ id: 'i'.repeat(64), name: 'n'.repeat(1000), keywords: [long] }] }).ok, true);
            const sha = 'a'.repeat(64);
            const mod = (e) => validateReferenceFile('models', { schema: 1, rev: 1, models: [{ id: 'x', name: 'X', blurb: 'b', version: '1.0.0', engine: 'fixed', path: 'models/x.1.json', sha256: sha, bytes: 10, ...e }] }).ok;
            assert('catalogue entry', mod({}), true);
            assert('catalogue bad path', mod({ path: '../x.json' }), false);
            assert('catalogue bad sha', mod({ sha256: 'zz' }), false);
        },
    },
    {
        name: 'R4 the kill switch still applies while pinned after a rollback',
        fn: async (assert) => {
            const env = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'One'), merchants: merDoc(1, 'aldi') } }));
            await check(env);
            env.net.files = await makeServer({ dataVersion: '2026.11.2', tag: 'b', docs: { categories: catDoc(2, 'Two'), merchants: merDoc(2, 'aldi2') } });
            await check(env);
            await rollbackReference(env); // pinned at 2026.11.2
            const m = JSON.parse(env.net.files.get('manifest.json'));
            m.disabled = ['merchants'];
            env.net.files.set('manifest.json', JSON.stringify(m));
            assert('pinned check', (await check(env)).status, 'unchanged');
            const view = await getReference(env);
            assert('merchants disabled anyway, categories still the rolled-back copy', [view.sources.merchants, names(view), view.dataVersion], ['default', ['One'], '2026.11.1']);
        },
    },
    {
        name: 'R4 a partial update is labelled, flagged, retried in place, and rolls back cleanly',
        fn: async (assert) => {
            const env = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'One'), merchants: merDoc(1, 'a') } }));
            await check(env);
            const files = await makeServer({ dataVersion: '2026.11.2', tag: 'b', docs: { categories: catDoc(2, 'Two'), merchants: merDoc(2, 'b') } },
                { mutate: (m) => { m.files.merchants.sha256 = 'c'.repeat(64); } });
            env.net.files = files;
            const r = await check(env);
            const view = await getReference(env);
            assert('partial: new categories, old merchants, new label', [r.status, names(view), view.merchants[0].key, view.dataVersion], ['updated', ['Two'], 'a', '2026.11.2']);
            // The server fixes the bad file: the retry completes the same release without a second history entry.
            const fixed = await makeServer({ dataVersion: '2026.11.2', tag: 'b', docs: { categories: catDoc(2, 'Two'), merchants: merDoc(2, 'b') } });
            env.net.files = fixed;
            await check(env);
            assert('retry completes', (await getReference(env)).merchants[0].key, 'b');
            const rb = await rollbackReference(env);
            assert('rollback goes to 2026.11.1, not a copy of 2026.11.2', [rb.dataVersion, names(await getReference(env))], ['2026.11.1', ['One']]);
            assert('and stays there', (await check(env)).status, 'unchanged');
        },
    },
    {
        name: 'DB7 two rollbacks keep both versions pinned; only a release newer than all of them installs',
        fn: async (assert) => {
            const env = makeEnv(new Map());
            for (let i = 1; i <= 3; i++) {
                env.net.files = await makeServer({ dataVersion: '2026.11.' + i, tag: 'p' + i, docs: { categories: catDoc(i, 'V' + i) } });
                await check(env);
            }
            await rollbackReference(env); // off 2026.11.3
            await rollbackReference(env); // off 2026.11.2, now on 2026.11.1
            assert('on v1', names(await getReference(env)), ['V1']);
            env.net.files = await makeServer({ dataVersion: '2026.11.2', tag: 'p2', docs: { categories: catDoc(2, 'V2') } });
            assert('v2 stays pinned', [(await check(env)).status, names(await getReference(env))], ['unchanged', ['V1']]);
            env.net.files = await makeServer({ dataVersion: '2026.11.3', tag: 'p3', docs: { categories: catDoc(3, 'V3') } });
            assert('v3 stays pinned', [(await check(env)).status, names(await getReference(env))], ['unchanged', ['V1']]);
            env.net.files = await makeServer({ dataVersion: '2026.11.4', tag: 'p4', docs: { categories: catDoc(4, 'V4') } });
            assert('a newer release installs and clears the pins', [(await check(env)).status, names(await getReference(env))], ['updated', ['V4']]);
        },
    },
    {
        name: 'DB7 the stored version is read without any request; a blocked setting is reported, not shown as saved',
        fn: async (assert) => {
            const env = makeEnv(await makeServer({ dataVersion: '2026.11.1', docs: { categories: catDoc(1, 'One') } }));
            assert('nothing downloaded yet: built-in (null)', await getStoredReferenceVersion(env), null);
            await check(env);
            const n = env.urls.length;
            assert('after an update: its version', await getStoredReferenceVersion(env), '2026.11.1');
            assert('reading the version made no request', env.urls.length, n);
            const blocked = { storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } };
            assert('blocked storage: not saved', setReferenceCheckEnabled(false, blocked), false);
            assert('working storage: saved', setReferenceCheckEnabled(false, env), true);
        },
    },
];
