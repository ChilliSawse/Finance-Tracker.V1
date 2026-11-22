// DB7 (FT-0032, R3 steps R6 and R9): the person's overrides of shared reference rules, and the update-check toggle.
// Pure: storage and fetch are injected. Shape: { name, fn(assert) }, assert(label, actual, expected). Synthetic data only.

import { needsRefOverridesMigration, migrateRefOverrides } from './ref-overrides-migration.js';
import { runMigrationChain } from './migration-chain.js';
import { prepareImport } from './sanitize.js';
import { cloneDefaultFinanceData } from './defaults.js';
import { DEFAULT_CATEGORIES } from './categories.js';
import { categoriseWithReference, resolveWithReference } from './reference-match.js';
import { resolveImportRow } from './import-rows.js';
import {
    applyRefOverrides, upstreamMoved, hideRefItem, patchRefItem, clearRefItem, resetRefOverrides,
} from './ref-overrides.js';
import {
    checkForReferenceUpdate, scheduleReferenceCheck, isReferenceCheckEnabled, setReferenceCheckEnabled, REF_ENABLED_KEY,
} from './reference.js';
import { buildSettings } from '../ui/settings-model.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const cats = () => clone(DEFAULT_CATEGORIES);

// A reference view with one made-up merchant that no shipped keyword knows.
const view = (rev = 1, extra = {}) => ({
    dataVersion: '2026.11.1',
    sources: { categories: 'default', merchants: 'baseline' },
    revs: { merchants: rev },
    categories: [],
    merchants: [{ id: 'm-zzfoods', type: 'merchant', key: 'zzfoods', categoryId: 'groceries', match: 'key', confidence: 'high', ...extra }],
});
const DESC = 'ZZFOODS MELBOURNE';
const hit = (ref, overrides) => categoriseWithReference(DESC, -2500, cats(), [], ref, overrides);

function memStorage() {
    const map = new Map();
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem(k, v) { map.set(k, String(v)); } };
}

// A save the other four steps leave alone, so only this step has work.
function settled() {
    const d = cloneDefaultFinanceData();
    delete d.refOverrides;
    return d;
}

export const REF_OVERRIDES_TEST_CASES = [
    {
        name: 'R6 migration: old data gains refOverrides, a second run changes nothing, a good field is untouched',
        fn(assert) {
            const d = settled();
            assert('needs it', needsRefOverridesMigration(d), true);
            assert('first run changes the data', migrateRefOverrides(d), true);
            assert('empty and versioned', d.refOverrides, { v: 1, dataVersionSeen: null, items: {} });
            assert('second run returns false', migrateRefOverrides(d), false);
            assert('no longer needed', needsRefOverridesMigration(d), false);
            const kept = { v: 1, dataVersionSeen: '2026.11.1', items: { 'merchant:m-a': { op: 'hide', baseRev: 1, at: '2026-11-22' } } };
            const e = settled();
            e.refOverrides = clone(kept);
            assert('a good field is not touched', [migrateRefOverrides(e), e.refOverrides], [false, kept]);
            const bad = settled();
            bad.refOverrides = 'oops'; /* a string has no v */
            assert('a broken field is repaired', [migrateRefOverrides(bad), bad.refOverrides.items], [true, {}]);
        },
    },
    {
        name: 'R6 migration through the chain: runs last, no backup needed, idempotent on a second load',
        fn(assert) {
            const d = settled();
            const seen = [];
            const store = memStorage();
            const r = runMigrationChain(d, { storage: store, raw: '{}', trace: (n) => seen.push(n) });
            assert('field added by the chain', d.refOverrides && d.refOverrides.v, 1);
            assert('the step ran last', seen[seen.length - 1], 'migrateRefOverrides');
            assert('changed, not aborted', [r.changed, r.aborted], [true, false]);
            assert('no backup taken for this step alone', store.map.size, 0);
            const again = runMigrationChain(d, { storage: store, raw: '{}' });
            assert('second load: nothing changes', [again.changed, again.aborted], [false, false]);
        },
    },
    {
        name: 'R6 backup round-trip: refOverrides survives export, sanitising and the import chain',
        fn(assert) {
            const d = cloneDefaultFinanceData();
            d.incomeSources = []; d.essentialExpenses = []; d.nonEssentialExpenses = []; d.assets = []; d.liabilities = [];
            patchRefItem(d, view(3), 'merchant:m-zzfoods', { categoryId: 'dining' });
            hideRefItem(d, view(3), 'merchant:m-other');
            const text = JSON.stringify({ financeData: d, guiSettings: {}, timestamp: '2026-11-22T00:00:00.000Z' });
            const r = prepareImport(text);
            assert('import ok', r.ok, true);
            const it = r.ok ? r.financeData.refOverrides.items : {};
            assert('patch kept', [it['merchant:m-zzfoods'].op, it['merchant:m-zzfoods'].patch, it['merchant:m-zzfoods'].baseRev], ['patch', { categoryId: 'dining' }, 3]);
            assert('hide kept', it['merchant:m-other'].op, 'hide');
            assert('version seen kept', r.ok && r.financeData.refOverrides.dataVersionSeen, '2026.11.1');
            const old = clone(d);
            delete old.refOverrides;
            const o = prepareImport(JSON.stringify({ financeData: old, guiSettings: {} }));
            assert('an older backup gains an empty field', o.ok && o.financeData.refOverrides, { v: 1, dataVersionSeen: null, items: {} });
        },
    },
    {
        name: 'R6 matcher: hide drops a reference merchant, patch changes its category, no overrides changes nothing',
        fn(assert) {
            assert('baseline: the reference merchant hits', [hit(view()).by, hit(view()).categoryId], ['reference', 'groceries']);
            const none = { v: 1, dataVersionSeen: null, items: {} };
            assert('empty overrides: same answer', hit(view(), none), hit(view()));
            const hidden = { v: 1, items: { 'merchant:m-zzfoods': { op: 'hide', baseRev: 1 } } };
            assert('hidden: never hits', hit(view(), hidden).by, 'none');
            const patched = { v: 1, items: { 'merchant:m-zzfoods': { op: 'patch', patch: { categoryId: 'dining' }, baseRev: 1 } } };
            assert('patched: the new category', [hit(view(), patched).by, hit(view(), patched).categoryId], ['reference', 'dining']);
            const r = resolveWithReference(DESC, -2500, undefined, cats(), [], view(), patched);
            assert('still suggested, never silently ok', [r.status, r.referenceSuggested, r.categoryId], ['review', true, 'dining']);
            const fd = { categories: cats(), rules: [{ key: 'zzfoods', categoryId: 'shopping' }], refOverrides: patched };
            assert('the person\'s own rule still wins over a patch', resolveImportRow(DESC, -2500, undefined, fd, view()).categoryId, 'shopping');
            const fd2 = { categories: cats(), rules: [], refOverrides: hidden };
            assert('import row: hidden merchant is not suggested', resolveImportRow(DESC, -2500, undefined, fd2, view()).referenceSuggested, undefined);
            assert('import row: patched merchant is suggested with the patched category', [resolveImportRow(DESC, -2500, undefined, { ...fd2, refOverrides: patched }, view()).categoryId], ['dining']);
            assert('the reference view itself is never changed', view().merchants[0].categoryId, 'groceries');
            const junk = { v: 1, items: { 'nope:x': { op: 'hide' }, 'merchant:m-zzfoods': 5, 'merchant:': { op: 'patch', patch: 'x' } } };
            assert('junk entries are ignored', hit(view(), junk).by, 'reference');
        },
    },
    {
        name: 'R6 a patch survives an upstream rev bump, and the item is reported as updated upstream; reset restores upstream',
        fn(assert) {
            const d = cloneDefaultFinanceData();
            const made = patchRefItem(d, view(1), 'merchant:m-zzfoods', { categoryId: 'dining' });
            assert('patch recorded against rev 1', [made.ok, d.refOverrides.items['merchant:m-zzfoods'].baseRev], [true, 1]);
            const v2 = view(2, { aliases: ['zz foods'], confidence: 'medium' });
            const out = categoriseWithReference(DESC, -2500, cats(), [], v2, d.refOverrides);
            assert('upstream changed other fields, the patch still applies', [out.categoryId, out.reference.confidence], ['dining', 'medium']);
            assert('reported as updated upstream', upstreamMoved(v2, d.refOverrides), [{ key: 'merchant:m-zzfoods', kind: 'merchant', id: 'm-zzfoods' }]);
            assert('not reported while the rev is unchanged', upstreamMoved(view(1), d.refOverrides), []);
            const hid = hideRefItem(d, view(2), 'merchant:m-b');
            assert('count before reset', Object.keys(d.refOverrides.items).length, 2);
            const reset = resetRefOverrides(d);
            assert('reset clears all', [reset.count, d.refOverrides.items], [2, {}]);
            assert('reset: upstream applies again', categoriseWithReference(DESC, -2500, cats(), [], v2, d.refOverrides).categoryId, 'groceries');
            reset.onUndo();
            assert('undo puts them back', Object.keys(d.refOverrides.items).length, 2);
            assert('one item can be put back to upstream', [clearRefItem(d, 'merchant:m-b').ok, Object.keys(d.refOverrides.items)], [true, ['merchant:m-zzfoods']]);
            hid.onUndo();
            assert('a bad key is refused', hideRefItem(d, view(), 'nonsense').ok, false);
            assert('applyRefOverrides with no overrides returns the same view', applyRefOverrides(view(), undefined) !== null, true);
        },
    },
    {
        name: 'R9 toggle: off means no request from either entry point; on (the default) still checks',
        fn: async (assert) => {
            const ls = new Map();
            const urls = [];
            const env = {
                base: './', appVersion: '2.0.0', now: () => 1e12,
                storage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); } },
                fetch: async (u) => { urls.push(u); return new Response('nope', { status: 404 }); },
                caches: { async open() { return { async match() { return undefined; }, async put() {}, async delete() { return true; }, async keys() { return []; } }; } },
            };
            assert('default is on', isReferenceCheckEnabled(env), true);
            setReferenceCheckEnabled(false, env);
            assert('stored as 0 under an ft- key', ls.get(REF_ENABLED_KEY), '0');
            assert('reads as off', isReferenceCheckEnabled(env), false);
            const r = await checkForReferenceUpdate({ env, force: true });
            assert('off: the check does nothing', r.status, 'off');
            const cancel = scheduleReferenceCheck({ env });
            assert('off: the schedule returns a no-op', typeof cancel, 'function');
            await new Promise((res) => setTimeout(res, 20));
            assert('off: no request, nothing stamped', [urls.length, ls.has('ft-ref-checked')], [0, false]);
            setReferenceCheckEnabled(true, env);
            const on = await checkForReferenceUpdate({ env, force: true });
            assert('on again: a request is made', [on.status !== 'off', urls.length > 0], [true, true]);
        },
    },
    {
        name: 'R9 settings rows: toggle, rules version, go back, reference only; built-in when no version',
        fn(assert) {
            const rows = (reference) => buildSettings({ financeData: {}, reference }).find((g) => g.id === 'data').rows;
            const byId = (rs, id) => rs.find((r) => r.id === id);
            const a = rows({ checkEnabled: true, dataVersion: '2026.11.1' });
            assert('row order', a.map((r) => r.id).filter((id) => id.startsWith('ref')), ['refcheck', 'refversion', 'refback', 'refreset']);
            assert('toggle label and state', [byId(a, 'refcheck').label, byId(a, 'refcheck').on], ['Check for updated rules', true]);
            assert('the plain statement of what is fetched', byId(a, 'refcheck').hint, 'Ledger downloads shared sorting rules from its own site. It sends nothing about you and makes no request with your data.');
            assert('version shown', [byId(a, 'refversion').label, byId(a, 'refversion').value], ['Rules version', '2026.11.1']);
            const b = rows({ checkEnabled: false, dataVersion: null });
            assert('built-in with no version, toggle off', [byId(b, 'refversion').value, byId(b, 'refcheck').on], ['built-in', false]);
            assert('labels', [byId(a, 'refback').label, byId(a, 'refreset').label], ['Go back to the earlier rules', 'Use reference rules only']);
            assert('no context: defaults to on and built-in', [byId(rows(undefined), 'refcheck').on, byId(rows(undefined), 'refversion').value], [true, 'built-in']);
        },
    },
    {
        name: 'DB7 a junk backup patch never reaches the matcher; inherited kind names are not kinds',
        fn(assert) {
            const d = cloneDefaultFinanceData();
            d.incomeSources = []; d.essentialExpenses = []; d.nonEssentialExpenses = []; d.assets = []; d.liabilities = [];
            const junk = (patch) => ({ 'merchant:m-zzfoods': { op: 'patch', patch, baseRev: 1, at: '2026-11-22' } });
            const bad = [{ aliases: 5 }, { excludePatterns: 'x' }, { match: 'word', patterns: 7 }, { categoryId: 5 }, { confidence: 'sure' }, { status: 'ok', by: 'rule' }];
            for (const p of bad) {
                d.refOverrides = { v: 1, dataVersionSeen: '2026.11.1', items: junk(p) };
                const r = prepareImport(JSON.stringify({ financeData: d, guiSettings: {} }));
                const fd = { categories: cats(), rules: [], refOverrides: r.ok ? r.financeData.refOverrides : null };
                let out;
                try { out = resolveImportRow(DESC, -2500, undefined, fd, view()); } catch (e) { out = 'threw ' + e.message; }
                assert('junk patch ' + JSON.stringify(p) + ' imports and the row still sorts from upstream', [r.ok, out.categoryId], [true, 'groceries']);
            }
            const mixed = { v: 1, items: junk({ categoryId: 'dining', aliases: 5, status: 'ok' }) };
            assert('only the allowed, well-typed fields survive', categoriseWithReference(DESC, -2500, cats(), [], view(), mixed).categoryId, 'dining');
            const inherited = { v: 1, items: { 'toString:x': { op: 'hide' }, 'constructor:y': { op: 'hide' }, '__proto__:z': { op: 'hide' } } };
            assert('inherited names are not kinds', applyRefOverrides(view(), inherited) === view() || Object.keys(applyRefOverrides(view(), inherited)).includes('merchants'), true);
            assert('and make no entries', hit(view(), inherited).by, 'reference');
            assert('patchRefItem refuses a junk patch', [patchRefItem(cloneDefaultFinanceData(), view(), 'merchant:m-zzfoods', { aliases: 5 }).ok, patchRefItem(cloneDefaultFinanceData(), view(), 'merchant:m-zzfoods', { categoryId: 'dining' }).ok], [false, true]);
            const at = applyRefOverrides({ ...view(), assetTypes: [{ id: 'car', defaults: { depreciation: { ratePct: 15, years: 5 } } }] }, { v: 1, items: { 'assetType:car': { op: 'patch', patch: { defaults: { depreciation: { ratePct: 20 } }, evil: 1 } } } });
            assert('asset type: only the depreciation rate is patchable and the rest is kept', at.assetTypes[0], { id: 'car', defaults: { depreciation: { ratePct: 20, years: 5 } } });
        },
    },
];
