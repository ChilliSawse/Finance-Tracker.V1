// FT-0032 DB15 (R3 step R8): the saving-model catalogue, "Use this", file import and export. Synthetic data only.
// The file checks read reference/ from disk, so they run in Node; in tests.html they pass at once (like ref-build).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import '../i18n/en-lazy-models.js';
import { BUCKET_METHOD, validateModelDef, validateSplit, allocateCents, canReturnToBase } from '../calc/saving-model.js';
import { cloneDefaultFinanceData } from './defaults.js';
import { forkOwnTemplate, switchBackToBase, getBuckets } from './saving-model.js';
import {
    validateEnvelope, parseModelFile, builtinEnvelope, catalogueFromIndex, loadCatalogue, entryState, updateAvailable,
    useModel, cleanRules, replacesSetup, allocationDiffersFromDefault, exportModel, loadEnvelope, MODEL_FILE_MAX_BYTES, wouldLoseBuckets,
} from './model-catalogue.js';
import { leftThisPay } from '../calc/pay-cycle.js';
import { pickerRows } from '../ui/model-picker.js';
import { modelStep } from '../ui/setup/steps-buckets.js';

const IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
const clone = (v) => JSON.parse(JSON.stringify(v));
const sum = (a) => a.reduce((x, y) => x + y, 0);

const SPLIT = {
    schema: 1, schemaVersion: 1, id: 'test-split', version: '1.0.0',
    meta: { title: 'Test split', blurb: 'A test model.', source: 'test fixture', licence: 'CC0-1.0', reviewed: null, requires: { engine: 'fixed' } },
    model: {
        id: 'test-split', name: 'Test split', basis: 'net', engine: 'fixed',
        buckets: [{ role: 'daily', name: 'Needs', slot: 1, kind: 'spend', pct: 50 }, { role: 'splurge', name: 'Wants', slot: 2, kind: 'spend', pct: 30 }, { name: 'Savings', slot: 3, kind: 'save', pct: 20 }],
        rules: { coreBuckets: [], maxDepth: 3, renamable: true, splitEditable: true, topLevelAddAllowed: true },
    },
};
const entryOf = (env, over = {}) => ({ id: env.id, name: env.meta.title, blurb: env.meta.blurb, version: env.version, engine: env.model.engine, path: null, sha256: null, bytes: 0, builtin: false, ...over });
const fresh = () => cloneDefaultFinanceData();
// A fresh setup with the balances at zero, so nothing is lost by taking a model that rebuilds the buckets.
const bare = () => { const d = fresh(); (d.allocation || []).forEach((r) => { r.currentBalance = 0; r.savingsGoal = 0; }); d.bucketGoals = []; return d; };

async function nodeEnv() {
    const n = (m) => import(/* @vite-ignore */ m);
    const fs = await n('node:fs');
    const path = await n('node:path');
    const url = await n('node:url');
    const build = await n(new URL('../../reference/tools/build.mjs', import.meta.url).href);
    const root = url.fileURLToPath(new URL('../..', import.meta.url));
    return { fs, path, build, src: path.join(root, 'reference', 'src') };
}
const readDir = (e, dir) => (e.fs.existsSync(dir)
    ? e.fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort().map((f) => ({ file: f, doc: JSON.parse(e.fs.readFileSync(e.path.join(dir, f), 'utf8')) }))
    : []);

export const MODEL_CATALOGUE_TEST_CASES = [
    { name: 'DB15.1 every shipped and proposed model passes the gate, validateModelDef and the schema', async fn(assert) {
        assert('the in-code Bucket method passes', validateEnvelope(builtinEnvelope()), { ok: true });
        if (!IS_NODE) return;
        const e = await nodeEnv();
        const v = e.build.makeValidators();
        const shipped = readDir(e, e.path.join(e.src, 'models'));
        const proposed = readDir(e, e.path.join(e.src, 'proposed', 'models'));
        assert('only the Bucket method ships (FT-R-71)', shipped.map((m) => m.doc.id), ['bucket-method']);
        assert('the six D6 methods the engine runs are proposed', proposed.map((m) => m.doc.id).sort(),
            ['bank-bucket-example-au', 'eighty-twenty', 'fifty-thirty-twenty', 'fire-savings-rate-50', 'pay-yourself-first', 'seventy-twenty-ten']);
        for (const { file, doc } of [...shipped, ...proposed]) {
            assert(`${file}: envelope gate`, validateEnvelope(doc), { ok: true });
            assert(`${file}: validateModelDef`, validateModelDef(doc.model).ok, true);
            assert(`${file}: schema`, e.build.schemaErrors(v['saving-model'], doc, file), []);
            assert(`${file}: schemaVersion`, doc.schemaVersion, 1);
            assert(`${file}: one spend bucket is Daily, slots are unique, at most 10`, [doc.model.buckets.filter((b) => b.role === 'daily' && b.kind === 'spend').length, new Set(doc.model.buckets.map((b) => b.slot)).size === doc.model.buckets.length, doc.model.buckets.length <= 10], [1, true, true]);
        }
        for (const { file, doc } of proposed) {
            assert(`${file}: split totals 100`, validateSplit(doc.model.buckets.map((b, i) => ({ id: i, pct: b.pct }))).total, 100);
        }
        assert('the shipped Bucket method file is the in-code definition', clone(shipped[0].doc.model), clone(BUCKET_METHOD));
    } },
    { name: 'DB15.2 the build ignores proposed/models', async fn(assert) {
        if (!IS_NODE) return;
        const e = await nodeEnv();
        const s = e.build.loadSource(e.src);
        assert('the built catalogue lists only the Bucket method', s.models.map((m) => m.data.id), ['bucket-method']);
        assert('the source has no problems', e.build.validateSource(s), []);
    } },
    { name: 'DB15.3 naming (FT-R-14): descriptive titles, a naming note on each, credit and not brand', async fn(assert) {
        if (!IS_NODE) return;
        const e = await nodeEnv();
        const BRANDS = /barefoot|baby steps|profit first|ynab|you need a budget|moneysmart|dave ramsey|everydollar/i;
        const TITLE_BRANDS = new RegExp(BRANDS.source + '|mustache|duke', 'i');
        for (const { file, doc } of readDir(e, e.path.join(e.src, 'proposed', 'models'))) {
            assert(`${file}: no brand or person in the title, model name or blurb`, [TITLE_BRANDS.test(doc.meta.title), TITLE_BRANDS.test(doc.model.name), TITLE_BRANDS.test(doc.meta.blurb)], [false, false, false]);
            assert(`${file}: no brand in meta.after, and no Duke (it is a source, not a credit)`, [BRANDS.test(doc.meta.after || ''), /duke/i.test(doc.meta.after || '')], [false, false]);
            assert(`${file}: a credited author comes with "not affiliated"`, !/Warren|Clason|Mustache/.test(doc.meta.after || '') || /Not affiliated with or endorsed by/.test(doc.meta.after), true);
            assert(`${file}: carries its naming note and the lookup caveat`, [typeof doc.meta.checks.naming, /not legal advice/.test(doc.meta.checks.trademark)], ['string', true]);
            assert(`${file}: marked proposed, not shipped`, /PROPOSED, NOT SHIPPED/.test(doc.meta.status), true);
        }
    } },
    { name: 'DB15.4 importing a model and running the split totals 100; undo restores', fn(assert) {
        const d = bare();
        const before = JSON.stringify(d);
        const res = useModel(d, SPLIT, {});
        assert('used', res.ok, true);
        assert('copied with basedOn and basedOnVersion', [d.savingModel.basedOn, d.savingModel.basedOnVersion, d.savingModel.name], ['test-split', '1.0.0', 'Test split']);
        const pcts = d.allocation.map((r) => r.percentage);
        const sp = validateSplit(d.allocation.map((r) => ({ id: r.id, role: r.role, pct: r.percentage })), d.savingModel.rules);
        assert('the shares total 100', [sp.ok, sp.total], [true, 100]);
        assert('the pay splits to the cent', sum(allocateCents(343843, pcts)), 343843);
        assert('getBuckets runs on the new buckets', [getBuckets(d, '').length, sum(getBuckets(d, '').map((b) => b.pct))], [3, 100]);
        assert('the buckets start empty', d.allocation.every((r) => r.currentBalance === 0 && r.savingsGoal === 0), true);
        res.onUndo();
        assert('undo puts everything back', JSON.stringify(d), before);
        const lost = fresh();
        lost.allocation[0].currentBalance = 25;
        assert('balances are never dropped unasked', [wouldLoseBuckets(lost), useModel(lost, SPLIT, {}).code], [true, 'would-replace']);
        assert('unless asked', useModel(lost, SPLIT, { replaceBuckets: true }).ok, true);
    } },
    { name: 'DB15.5 switch back still works, from the picker path and the old one', fn(assert) {
        const bucket = catalogueFromIndex([])[0];
        const d = fresh();
        assert('on the Bucket method: current', entryState(bucket, d), 'current');
        forkOwnTemplate(d);
        assert('an own template that fits offers switch-back', entryState(bucket, d), 'switch-back');
        const res = useModel(d, builtinEnvelope(), {});
        assert('Use this on the Bucket method switches back', [res.ok, d.savingModel.id, d.savingModel.basedOn, d.savingModel.rules.topLevelAddAllowed], [true, 'bucket-method', null, false]);
        res.onUndo();
        assert('and undoes', d.savingModel.id, 'custom-1');
        d.allocation.push({ id: 'b-extra', name: 'Extra', role: null, percentage: 0, currentBalance: 0 });
        assert('an own template that does not fit stays', [canReturnToBase(d.savingModel, d.allocation, d.bucketGoals), entryState(bucket, d), useModel(d, builtinEnvelope(), {}).code], [false, 'stays', 'bounds']);
        const e = fresh();
        forkOwnTemplate(e);
        assert('the existing switchBackToBase is unchanged', [switchBackToBase(e).ok, e.savingModel.id], [true, 'bucket-method']);
    } },
    { name: 'DB15.6 an unknown engine shows "Needs a newer Ledger" and cannot be chosen', fn(assert) {
        const future = clone(SPLIT);
        future.id = 'future'; future.model.id = 'future'; future.model.engine = 'milestones'; future.meta.requires.engine = 'milestones';
        const entry = entryOf(future);
        const d = fresh();
        assert('state', entryState(entry, d), 'needs-newer');
        const row = pickerRows(catalogueFromIndex([{ ...entry, path: 'models/future.12345678.json', sha256: 'a'.repeat(64) }]), d).find((r) => r.id === 'future');
        assert('listed, not choosable', [!!row, row && row.choosable, row && row.state], [true, false, 'needs-newer']);
        assert('the gate says needs-newer, not broken', validateEnvelope(future), { ok: false, code: 'needs-newer', detail: 'engine' });
        const before = JSON.stringify(d);
        assert('Use this refuses and writes nothing', [useModel(d, future, {}).code, JSON.stringify(d)], ['needs-newer', before]);
        const newer = clone(SPLIT); newer.schemaVersion = 2;
        assert('a newer envelope format is also "needs a newer Ledger"', validateEnvelope(newer).code, 'needs-newer');
        const s = clone(SPLIT); s.schema = 2;
        assert('and a newer schema', validateEnvelope(s).code, 'needs-newer');
    } },
    { name: 'DB15.7 hostile files are rejected', fn(assert) {
        const big = JSON.stringify({ ...SPLIT, pad: 'x'.repeat(MODEL_FILE_MAX_BYTES) });
        assert('huge', parseModelFile(big).code, 'too-big');
        assert('not text', parseModelFile(null).code, 'not-json');
        assert('not JSON', parseModelFile('{nope').code, 'not-json');
        assert('an array', parseModelFile('[]').code, 'not-object');
        const bad = (mut) => { const m = clone(SPLIT); mut(m); return parseModelFile(JSON.stringify(m)); };
        assert('script text in a title', bad((m) => { m.meta.title = '<script>alert(1)</script>'; }).code, 'hostile');
        assert('script text in a bucket name', bad((m) => { m.model.buckets[0].name = '<img src=x onerror=alert(1)>'; }).code, 'hostile');
        assert('a javascript: link', bad((m) => { m.meta.source = 'javascript:alert(1)'; }).code, 'hostile');
        assert('wrong type: pct as a string', bad((m) => { m.model.buckets[0].pct = '50'; }).ok, false);
        assert('wrong type: buckets an object', bad((m) => { m.model.buckets = {}; }).ok, false);
        assert('wrong type: slot a float', bad((m) => { m.model.buckets[0].slot = 1.5; }).ok, false);
        assert('negative share', bad((m) => { m.model.buckets[0].pct = -50; m.model.buckets[1].pct = 130; }).ok, false);
        assert('total not 100', bad((m) => { m.model.buckets[0].pct = 60; }).code, 'model');
        assert('unknown key', bad((m) => { m.extra = 1; }).code, 'field');
        assert('id and model id differ', bad((m) => { m.model.id = 'other'; }).code, 'id-mismatch');
        assert('prototype key', parseModelFile('{"schema":1,"__proto__":{"x":1},"id":"a"}').ok, false);
        assert('too deep', bad((m) => { let o = m.model.rules; for (let i = 0; i < 12; i++) { o.n = {}; o = o.n; } }).code, 'hostile');
        assert('eleven buckets', bad((m) => { m.model.buckets = Array.from({ length: 11 }, (_, i) => ({ role: i ? undefined : 'daily', name: 'B' + i, slot: (i % 10) + 1, kind: i ? 'save' : 'spend', pct: i ? 9 : 10 })); }).code, 'field');
        assert('duplicate slots', bad((m) => { m.model.buckets[1].slot = 1; }).detail, 'slot-duplicate');
        assert('no Daily bucket', bad((m) => { delete m.model.buckets[0].role; }).detail, 'daily');
        assert('two Daily buckets', bad((m) => { m.model.buckets[1].role = 'daily'; }).ok, false);
        assert('Daily must be a spend bucket', bad((m) => { m.model.buckets[0].kind = 'save'; }).detail, 'daily');
        assert('too many buckets', bad((m) => { m.model.buckets = Array.from({ length: 40 }, (_, i) => ({ name: 'B' + i, slot: 1, kind: 'save', pct: 2.5 })); }).ok, false);
        assert('a long string', bad((m) => { m.meta.blurb = 'x'.repeat(5000); }).code, 'hostile');
        assert('a control character', bad((m) => { m.meta.blurb = 'a\u0000b'; }).code, 'hostile');
        assert('the good one still passes', parseModelFile(JSON.stringify(SPLIT)).ok, true);
        const hostileEntry = catalogueFromIndex([{ id: 'x', name: '<b>x</b>', blurb: 'ok', version: '1.0.0', engine: 'fixed', path: 'models/x.12345678.json', sha256: 'a'.repeat(64) }]);
        assert('a hostile index entry never reaches the picker', hostileEntry.map((e) => e.id), ['bucket-method']);
    } },
    { name: "DB15.8 with no reference data the picker equals today's", async fn(assert) {
        assert('the catalogue is the Bucket method alone', catalogueFromIndex([]).map((e) => e.id), ['bucket-method']);
        assert('and from a failing read', (await loadCatalogue({ loadRef: () => { throw new Error('offline'); } })).map((e) => e.id), ['bucket-method']);
        assert('and from the reference view with no models', (await loadCatalogue({ loadRef: async () => ({ models: [] }) })).map((e) => e.id), ['bucket-method']);
        const rows = pickerRows(catalogueFromIndex([]), fresh());
        assert('one row, current, in-code name', [rows.length, rows[0].state, rows[0].name, rows[0].version], [1, 'current', BUCKET_METHOD.name, '1.0.0']);
        const html = modelStep.render();
        assert('the setup step is the single Bucket method card', [(html.match(/name="su-model"/g) || []).length, html.includes('data-su-change')], [1, false]);
        const index = [{ id: 'bucket-method', name: 'Renamed upstream', blurb: 'upstream blurb', version: '9.9.9', engine: 'expenses-first', path: 'models/bucket-method.7a56198c.json', sha256: 'a'.repeat(64), bytes: 1 }];
        const c = catalogueFromIndex(index);
        assert('the in-code Bucket method wins over the index', [c[0].name, c[0].version, c[0].builtin], [BUCKET_METHOD.name, '1.0.0', true]);
        assert('the Bucket method never needs a fetch', (await loadEnvelope(c[0], { fetch: () => { throw new Error('no network'); } })).ok, true);
    } },
    { name: 'DB15.9 a newer upstream version only shows a line, never swaps', fn(assert) {
        const d = bare();
        useModel(d, SPLIT, {});
        const newer = entryOf({ ...SPLIT, version: '1.1.0' });
        const before = JSON.stringify(d);
        assert('update available', updateAvailable(d, newer), true);
        assert('same version: none', updateAvailable(d, entryOf(SPLIT)), false);
        assert('the Bucket method is the code itself: none', updateAvailable(d, catalogueFromIndex([])[0]), false);
        assert("the person's model is untouched", [entryState(newer, d), JSON.stringify(d)], ['current', before]);
    } },
    { name: 'DB15.10 export is the same envelope, carries no amount, and imports back', fn(assert) {
        const d = fresh();
        d.allocation[2].currentBalance = 98765;
        d.allocation[0].name = 'Daily';
        const out = exportModel(d);
        assert('exported', out.ok, true);
        assert('no balance or amount in the file', [/98765|currentBalance|savingsGoal/.test(out.text), out.text.length < MODEL_FILE_MAX_BYTES], [false, true]);
        const back = parseModelFile(out.text);
        assert('the file imports through the same gate', back.ok, true);
        assert('names and shares survive', back.envelope.model.buckets.map((b) => [b.name, b.pct]), d.allocation.map((r) => [r.name, r.percentage]));
        assert('and can be used', useModel(bare(), back.envelope, {}).ok, true);
        const broken = fresh();
        broken.allocation[0].percentage = 10;
        assert('a split that does not total 100 is not exported', exportModel(broken).code, 'split');
        assert('no data, no export', exportModel({}).code, 'no-model');
    } },
    { name: 'DB15.11 loading a model file checks length and hash', async fn(assert) {
        const text = JSON.stringify(SPLIT);
        const bytes = new TextEncoder().encode(text);
        const sha = async () => 'f'.repeat(64);
        const entry = entryOf(SPLIT, { path: 'models/test-split.0123abcd.json', sha256: 'f'.repeat(64), bytes: bytes.length });
        const ok = (body) => async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
        assert('a good file', (await loadEnvelope(entry, { fetch: ok(text), sha256: sha, base: './' })).ok, true);
        assert('a wrong hash is refused', (await loadEnvelope({ ...entry, sha256: 'e'.repeat(64) }, { fetch: ok(text), sha256: sha, base: './' })).code, 'unavailable');
        assert('a wrong length is refused', (await loadEnvelope({ ...entry, bytes: 5 }, { fetch: ok(text), sha256: sha, base: './' })).code, 'unavailable');
        assert('offline is "unavailable", never a throw', (await loadEnvelope(entry, { fetch: async () => { throw new Error('off'); }, sha256: sha, base: './' })).code, 'unavailable');
        assert('a path off the catalogue pattern is refused', (await loadEnvelope({ ...entry, path: '../x.json' }, { fetch: ok(text), sha256: sha })).code, 'unavailable');
    } },
    { name: 'DB15.12 rules from a file are whitelisted and clamped; renaming and split editing stay on (FT-R-78)', fn(assert) {
        const r = cleanRules({ renamable: false, splitEditable: false, topLevelAddAllowed: false, maxDepth: 99, slotCount: 400, mojoShare: 500, coreBuckets: ['daily', 'x'], remainderRatio: { smile: -1, fire: 3 }, evil: 'x', colourRepeat: 'yes' });
        assert('forced on', [r.renamable, r.splitEditable, r.topLevelAddAllowed], [true, true, true]);
        assert('clamped or defaulted', [r.maxDepth, r.slotCount, r.mojoShare, r.coreBuckets, r.remainderRatio, r.colourRepeat], [5, 10, null, [], { smile: 1, fire: 2 }, true]);
        assert('unknown keys are dropped', 'evil' in r, false);
        const d = bare();
        const m = clone(SPLIT);
        m.model.rules = { coreBuckets: [], maxDepth: 3, renamable: false, splitEditable: false, junk: 1 };
        useModel(d, m, {});
        assert('what lands in the data', [d.savingModel.rules.renamable, d.savingModel.rules.splitEditable, 'junk' in d.savingModel.rules], [true, true, false]);
    } },
    { name: 'DB15.13 a setup that differs from the defaults is replaced only when asked; bucket pointers are remapped and Undo restores them', fn(assert) {
        const d = bare();
        assert('a fresh setup is the default', [allocationDiffersFromDefault(d), replacesSetup(d)], [false, false]);
        d.allocation[0].name = 'Everyday';
        assert('a renamed bucket counts', [allocationDiffersFromDefault(d), useModel(d, SPLIT, {}).code], [true, 'would-replace']);
        const e = bare();
        e.allocation[3].bankLabel = 'Fire account';
        assert('a bank label counts', replacesSetup(e), true);
        const f = bare();
        f.savingModel.transfers.bankSetTo[f.allocation[1].id] = 5000;
        assert('a ticked transfer counts', replacesSetup(f), true);
        const g = bare();
        g.allocation[0].percentage = 55; g.allocation[3].percentage = 25;
        assert('a custom split counts', replacesSetup(g), true);
        const h = bare();
        h.categories = [{ id: 'groceries', bucketId: 'b-daily' }, { id: 'fun', bucketId: 'b-splurge' }, { id: 'x', bucketId: 'b-smile' }, { id: 'y', bucketId: null }];
        h.plan = [{ id: 'p', bucketId: 'b-fire' }];
        h.rules = [{ key: 'k', categoryId: 'fun', bucketId: 'b-daily' }];
        const before = JSON.stringify(h);
        const res = useModel(h, SPLIT, { replaceBuckets: true });
        const ids = new Set(h.allocation.map((r) => r.id));
        assert('same-role pointers remap, others clear, none dangle', [h.categories.map((c) => (c.bucketId === null ? null : ids.has(c.bucketId))), h.plan[0].bucketId, ids.has(h.rules[0].bucketId)], [[true, true, null, null], null, true]);
        res.onUndo();
        assert('Undo restores buckets, pointers and the model', JSON.stringify(h), before);
        const k = bare();
        useModel(k, SPLIT, {});
        assert('the Plan line can name the model it came from', k.savingModel.basedOnName, 'Test split');
    } },
    { name: 'DB15.14 Today: applying a fixed model gives a sane "Left this pay"', fn(assert) {
        const d = bare();
        d.incomeSources = [{ incomeType: 'salaried', paySchedule: 'fortnightly', payAnchor: '2026-10-31' }];
        d.primaryIncomeIndex = 0;
        d.categories = [{ id: 'groceries', essential: true }, { id: 'rent', essential: true }, { id: 'dining', essential: false }, { id: 'income', essential: false }];
        d.plan = [];
        const row = (date, categoryId, dollars) => ({ id: `${date}-${categoryId}`, date, categoryId, amountCents: Math.round(-dollars * 100) });
        const rows = [row('2026-11-01', 'groceries', 142.3), row('2026-11-02', 'rent', 1120), row('2026-11-03', 'dining', 24), { id: 'pay', date: '2026-10-31', categoryId: 'income', amountCents: 343843 }];
        assert('applied', useModel(d, SPLIT, {}).ok, true);
        const r = leftThisPay({ data: d, totals: { netCents: 343843 }, txns: rows, today: '2026-11-04' });
        const daily = r.buckets.find((b) => b.role === 'daily');
        assert('the Daily pool is its 50%', [daily.poolCents, r.poolCents], [171921, 171921]);
        assert('the pools add up to the pay', sum(r.buckets.map((b) => b.poolCents)), 343843);
        assert('essentials come off Daily, the non-essential off Wants', [daily.spentCents, r.buckets.find((b) => b.role === 'splurge').spentCents], [126230, 2400]);
        assert('left is the pool less spending, and not negative', [r.leftCents, r.leftCents >= 0, Number.isFinite(r.perDayCents)], [171921 - 126230, true, true]);
    } },
];
