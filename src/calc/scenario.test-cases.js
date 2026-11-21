// Test cases for the "scenario" group (registered in src/test-registry.js).
// F1.1 to F1.5 and F1.7 are pure. F1.6 (the store) needs IndexedDB, so it runs in tests.html and is a
// no-op in the Node runner. Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    resolveAt, segments, breakpoints, resolveSegments, conflictFor, missingTargets, makeRealPlan, scenarioHeadline,
    changeProblems, isActiveOn, applyOp,
} from './scenario.js';
import { buildSampleHousehold } from '../state/sample-data.js';
import {
    saveScenario, listScenarios, duplicateScenario, archiveScenario, pinScenario, renameScenario, newScenario,
    sanitizeScenarioRows, applyMakeReal, getScenario,
} from '../state/scenarios.js';
import { configureDb, deleteDb, openDb } from '../state/db.js';
import {
    BACKUP_PARTS, prepareBackup, collectParts, buildBackupBundle, commitBackup, commitErase, carriesParts,
} from '../state/backup.js';
import { getBuckets } from '../state/saving-model.js';
import { migrateAssetDebtDetail } from '../state/asset-debt-migration.js';

const TODAY = '2026-11-21';
// The sample is built unmigrated for step 5b; run it so income sources and assets carry ids.
const base = () => { const d = buildSampleHousehold(TODAY).data; migrateAssetDebtDetail(d); return d; };
const ch = (o) => ({ id: 'c1', kind: 'expense', target: null, field: null, op: 'set', value: null, baseValue: null, from: null, until: null, note: '', ...o });
const rentChange = (o = {}) => ch({ id: 'c-rent', kind: 'expense', target: { collection: 'plan', id: 'p-rent' }, field: 'amount', op: 'set', value: 610, baseValue: 1120, ...o });
const planRent = (d) => d.plan.find((p) => p.id === 'p-rent').amount;
const hasIdb = typeof indexedDB !== 'undefined';

export const SCENARIO_TEST_CASES = [
    {
        name: 'F1.1 resolve basics',
        fn(assert) {
            const data = base();
            const before = JSON.stringify(data);
            const changes = [rentChange({ from: '2026-12-01', until: '2027-01-01' })];
            const out = resolveAt(data, changes, '2026-12-15');
            assert('input untouched', JSON.stringify(data), before);
            assert('result is a new object', out === data, false);
            assert('takes effect on from', planRent(resolveAt(data, changes, '2026-12-01')), 610);
            assert('not before from', planRent(resolveAt(data, changes, '2026-11-30')), 1120);
            assert('active inside', planRent(out), 610);
            assert('ends at until (until is exclusive)', planRent(resolveAt(data, changes, '2027-01-01')), 1120);
            assert('last day inside', planRent(resolveAt(data, changes, '2026-12-31')), 610);
            assert('open ends: from null and until null', planRent(resolveAt(data, [rentChange()], '2000-01-01')), 610);
            const missing = [rentChange({ id: 'c-x', target: { collection: 'plan', id: 'p-gone' } })];
            assert('missing target skipped, not thrown', JSON.stringify(resolveAt(data, missing, TODAY)), before);
            assert('missing target listed', missingTargets(data, missing).map((c) => c.id), ['c-x']);
            assert('a Date works as the date', planRent(resolveAt(data, changes, new Date(2026, 11, 15))), 610);
            assert('no data in, no throw', resolveAt(undefined, changes, TODAY), null);
            assert('Infinity in the tax bands survives', resolveAt({ taxBrackets: [{ min: 0, max: Infinity }] }, [], TODAY).taxBrackets[0].max, Infinity);
        },
    },
    {
        name: 'F1.1b ops and kinds',
        fn(assert) {
            const data = base();
            const income = data.incomeSources[0];
            const gross = income.grossAnnual;
            const scale = resolveAt(data, [ch({ id: 'i1', kind: 'income', target: { collection: 'incomeSources', id: income.id }, field: 'grossAnnual', op: 'scale', value: 1.1 })], TODAY);
            assert('scale is a factor', Math.round(scale.incomeSources[0].grossAnnual * 100) / 100, Math.round(gross * 1.1 * 100) / 100);
            const add = resolveAt(data, [rentChange({ op: 'add', value: 50 })], TODAY);
            assert('add on a number', planRent(add), 1170);
            const rm = resolveAt(data, [rentChange({ op: 'remove', value: null })], TODAY);
            assert('remove deletes the row', rm.plan.some((p) => p.id === 'p-rent'), false);
            const newSrc = { name: 'Side gig', grossAnnual: 12000 };
            const inc = resolveAt(data, [ch({ id: 'ia', kind: 'incomeAdd', target: { collection: 'incomeSources', id: null }, op: 'add', value: newSrc })], TODAY);
            assert('incomeAdd appends with an id', inc.incomeSources.length, data.incomeSources.length + 1);
            assert('incomeAdd id from the change', inc.incomeSources[inc.incomeSources.length - 1].id, 'sc-ia');
            assert('incomeAdd does not alias the change value', inc.incomeSources[inc.incomeSources.length - 1] === newSrc, false);
            const debt = resolveAt(data, [ch({ id: 'da', kind: 'debtAdd', target: { collection: 'liabilities', id: null }, op: 'add', value: { id: 'l-car', name: 'Car', balance: 9000 } })], TODAY);
            assert('debtAdd appends', debt.liabilities.some((l) => l.id === 'l-car'), true);
            const asm = resolveAt(data, [ch({ id: 'as', kind: 'assumption', target: { collection: 'fiSettings', id: null }, field: 'multiple', op: 'set', value: 30 })], TODAY);
            assert('assumption sets fiSettings', asm.fiSettings.multiple, 30);
            const one = resolveAt(data, [ch({ id: 'oo', kind: 'oneOff', op: 'add', value: { amount: -6000 }, from: '2026-12-01', note: 'move' })], '2026-12-02');
            assert('oneOff listed', one.scenarioOneOffs, [{ id: 'oo', amount: -6000, date: '2026-12-01', note: 'move' }]);
            const assetId = data.assets[0].id;
            const gf = resolveAt(data, [ch({ id: 'gf', kind: 'goalFund', target: { collection: 'assets', id: assetId }, op: 'add', value: 1 })], TODAY);
            assert('goalFund ticks a balance', gf.scenarioGoalFunds, [{ collection: 'assets', id: assetId }]);
            const off = (o) => resolveAt(data, [ch({ id: 'gf', kind: 'goalFund', target: { collection: 'assets', id: assetId }, ...o })], TODAY).scenarioGoalFunds;
            assert('goalFund off: op remove, or value false (F4 shape)', [off({ op: 'remove', value: false }), off({ op: 'set', value: false })], [undefined, undefined]);
            assert('goalFund on a missing asset ignored', resolveAt(data, [ch({ id: 'g2', kind: 'goalFund', target: { collection: 'assets', id: 'nope' }, op: 'add', value: 1 })], TODAY).scenarioGoalFunds, undefined);
            const split = resolveAt(data, [ch({ id: 'sp', kind: 'split', target: { collection: 'allocation', id: data.allocation[0].id }, field: 'percentage', op: 'set', value: 55 })], TODAY);
            assert('split sets an allocation percentage', split.allocation[0].percentage, 55);
            assert('proto field rejected', changeProblems(rentChange({ field: '__proto__' })).includes('field'), true);
            assert('unknown collection rejected', changeProblems(rentChange({ target: { collection: 'categories', id: 'x' } })).includes('collection'), true);
            assert('kind and collection must agree', changeProblems(rentChange({ kind: 'income' })).includes('collection'), true);
            assert('scale needs a number', changeProblems(rentChange({ op: 'scale', value: 'x' })).includes('value'), true);
            assert('bad date rejected', changeProblems(rentChange({ from: '2026-02-30' })).includes('from'), true);
            assert('until before from rejected', changeProblems(rentChange({ from: '2026-03-01', until: '2026-02-01' })).includes('until'), true);
            assert('a bad change is ignored by resolveAt', planRent(resolveAt(data, [rentChange({ field: '__proto__' })], TODAY)), 1120);
            assert('isActiveOn', [isActiveOn(rentChange({ from: '2026-12-01' }), '2026-11-30'), isActiveOn(rentChange({ from: '2026-12-01' }), '2026-12-01')], [false, true]);
            assert('applyOp scale on a non-number leaves it', applyOp('x', { op: 'scale', value: 2 }), 'x');
        },
    },
    {
        name: 'F1.2 never stale',
        fn(assert) {
            const data = base();
            const salary = data.incomeSources[0];
            const changes = [ch({ id: 's1', kind: 'income', target: { collection: 'incomeSources', id: salary.id }, field: 'grossAnnual', op: 'set', value: 130000 })];
            data.plan.find((p) => p.id === 'p-rent').amount = 1300; // the real rent changes after the scenario was saved
            const out = resolveAt(data, changes, TODAY);
            assert('new real rent shows', planRent(out), 1300);
            assert('scenario salary shows', out.incomeSources[0].grossAnnual, 130000);
            assert('real salary untouched', data.incomeSources[0].grossAnnual === 130000, false);
        },
    },
    {
        name: 'F1.3 conflict',
        fn(assert) {
            const data = base();
            const c = rentChange({ field: 'amount', value: 610, baseValue: 560 });
            data.plan.find((p) => p.id === 'p-rent').amount = 520;
            assert('baseValue 560, live 520, scenario 610', conflictFor(data, c), { conflict: true, live: 520, scenario: 610 });
            data.plan.find((p) => p.id === 'p-rent').amount = 560;
            assert('live still the base: no conflict', conflictFor(data, c), { conflict: false, live: 560, scenario: 610 });
            assert('no baseValue: no conflict', conflictFor(data, rentChange({ baseValue: null })).conflict, false);
            assert('a scale never conflicts', conflictFor(data, rentChange({ op: 'scale', value: 1.1, baseValue: 1 })).conflict, false);
            assert('missing target gives nulls', conflictFor(data, rentChange({ target: { collection: 'plan', id: 'gone' } })), { conflict: false, live: null, scenario: 610 });
        },
    },
    {
        name: 'F1.4 segments',
        fn(assert) {
            const A = '2026-12-01'; const B = '2027-03-01'; const C = '2027-06-01';
            const changes = [rentChange({ id: 'a', from: A, until: B }), rentChange({ id: 'b', from: C, target: { collection: 'plan', id: 'p-rent' } })];
            assert('breakpoints sorted and unique', breakpoints([...changes, rentChange({ id: 'dup', from: A })], '2026-11-21', '2028-01-01'), [A, B, C]);
            assert('breakpoints outside the range are left out', breakpoints(changes, '2026-12-15', '2027-04-01'), [B]);
            const segs = segments(changes, '2026-11-21', '2028-01-01');
            assert('one segment per gap', segs.map((s) => [s.from, s.to]), [['2026-11-21', A], [A, B], [B, C], [C, '2028-01-01']]);
            assert('active ids per segment', segs.map((s) => s.key), ['', 'a', '', 'b']);
            let calls = 0;
            const res = resolveSegments(base(), changes, '2026-11-21', '2028-01-01', { resolve: (...args) => { calls++; return resolveAt(...args); } });
            assert('segments resolved', res.length, 4);
            assert('same active set resolves once (cached by key)', calls, 3);
            const distinct = segments([rentChange({ id: 'a', from: A, until: B })], '2026-11-21', '2027-12-01');
            let n = 0;
            resolveSegments(base(), [rentChange({ id: 'a', from: A, until: B })], '2026-11-21', '2027-12-01', { resolve: () => { n++; return {}; } });
            assert('resolution count equals segment count when sets differ', n, distinct.length - 1);
            assert('no changes: one segment', segments([], '2026-01-01', '2026-02-01').length, 1);
            assert('bad range', segments(changes, '2027-01-01', '2026-01-01'), []);
        },
    },
    {
        name: 'F1.5 bucket without id or role',
        fn(assert) {
            const data = base();
            data.allocation.push({ name: 'Mystery', percentage: 0 }, null, 'x');
            data.bucketGoals = [{ name: 'No id' }];
            let threw = false;
            let out;
            try {
                out = resolveAt(data, [
                    ch({ id: 'sp', kind: 'split', target: { collection: 'allocation', id: data.allocation[0].id }, field: 'percentage', op: 'set', value: 50 }),
                    ch({ id: 'g', kind: 'goal', target: { collection: 'bucketGoals', id: 'nope' }, field: 'cost', op: 'set', value: 1 }),
                ], TODAY);
            } catch (e) { threw = true; }
            assert('does not throw', threw, false);
            assert('the real row still resolved', out.allocation[0].percentage, 50);
            assert('rows without ids survive', out.allocation.length, data.allocation.length);
            let threw2 = false;
            try { getBuckets(out, TODAY); } catch (e) { threw2 = true; }
            assert('getBuckets on the resolved data does not throw', threw2, false);
        },
    },
    {
        name: 'F1.6 store',
        async fn(assert) {
            if (!hasIdb) return; // browser only
            configureDb('ledger-test-db');
            await deleteDb();
            // a version 1 database upgrades to 2 and keeps its transactions
            await new Promise((resolve, reject) => {
                const req = indexedDB.open('ledger-test-db', 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    db.createObjectStore('transactions', { keyPath: 'id' });
                    db.createObjectStore('events', { keyPath: 'id' });
                };
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('transactions', 'readwrite');
                    tx.objectStore('transactions').put({ id: 'tx1', date: '2026-11-01', amountCents: -450, description: 'Coffee', hash: 'h' });
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                };
                req.onerror = () => reject(req.error);
            });
            const db = await openDb();
            assert('version is 2', db.version, 2);
            assert('scenarios store exists', db.objectStoreNames.contains('scenarios'), true);
            const kept = await new Promise((res) => { const r = db.transaction('transactions').objectStore('transactions').getAll(); r.onsuccess = () => res(r.result.map((x) => x.id)); });
            assert('transactions kept', kept, ['tx1']);

            // 300 saved, none refused
            const t0 = Date.parse('2026-11-01T00:00:00Z');
            for (let i = 0; i < 300; i++) {
                const s = newScenario({ name: `S${i}` }, new Date(t0 + i * 1000));
                const r = await saveScenario(s, { now: new Date(t0 + i * 1000) });
                if (!r.ok) assert('save refused', i, 'none');
            }
            let list = await listScenarios();
            assert('300 kept', list.length, 300);
            assert('newest first', list[0].name, 'S299');
            const s5 = list.find((s) => s.name === 'S5');
            await pinScenario(s5.id, true, { now: new Date(t0 + 1000) });
            list = await listScenarios();
            assert('pinned first', list[0].name, 'S5');
            assert('then updatedAt descending', list[1].name, 'S299');
            const s7 = list.find((s) => s.name === 'S7');
            await archiveScenario(s7.id, true);
            assert('archived hidden', (await listScenarios()).length, 299);
            assert('archived kept', (await listScenarios({ includeArchived: true })).length, 300);
            await archiveScenario(s7.id, false);
            await renameScenario(s7.id, '  Seven  ');
            assert('rename trims', (await getScenario(s7.id)).name, 'Seven');
            await saveScenario({ ...(await getScenario(s7.id)), changes: [rentChange()] });
            const dup = (await duplicateScenario(s7.id)).scenario;
            assert('duplicate new id', dup.id !== s7.id, true);
            assert('duplicate name plus copy', dup.name, 'Seven copy');
            assert('duplicate changes get new ids', dup.changes.length === 1 && dup.changes[0].id !== 'c-rent', true);
            assert('duplicate is unpinned', dup.pinned, false);
            assert('301 now', (await listScenarios()).length, 301);

            // the bundle: a version 2 bundle restores its scenarios; an old bundle restores with none
            const { rows } = await collectParts();
            assert('scenarios part registered', BACKUP_PARTS.some((p) => p.key === 'scenarios'), true);
            assert('export carries them', rows.scenarios.length, 301);
            const bundle = buildBackupBundle({ financeData: base(), guiSettings: {}, partRows: rows });
            const prepared = prepareBackup(JSON.stringify(bundle));
            assert('restore prepared', prepared.ok, true);
            assert('restore carries scenarios', prepared.parts.scenarios.length, 301);
            const old = prepareBackup(JSON.stringify({ financeData: base(), guiSettings: {} }));
            assert('an old bundle carries none', [old.ok, carriesParts(old), old.parts.scenarios], [true, false, undefined]);
            const fakeStore = { financeData: base(), guiSettingsData: {} };
            const mem = new Map();
            const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
            await saveScenario(newScenario({ name: 'Extra' }));
            const done = await commitBackup(fakeStore, prepared, { storage, render() {}, save() {} });
            assert('restore ok', done.ok, true);
            assert('restore replaced the rows', (await listScenarios({ includeArchived: true })).length, 301);
            const gone = await commitErase(fakeStore, { financeData: base(), guiSettings: {} }, { storage, render() {}, save() {} });
            assert('erase ok', gone.ok, true);
            assert('erase-all clears the store', (await listScenarios({ includeArchived: true })).length, 0);
            await deleteDb();
        },
    },
    {
        name: 'F1.6b restore is untrusted (G6)',
        fn(assert) {
            const good = { id: 's1', name: 'Good', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', pinned: true, archived: false, presetId: null, startedFrom: null, changes: [rentChange()] };
            const evil = JSON.parse('{"id":"s2","name":"' + 'x'.repeat(9000) + '","pinned":"yes","changes":[{"id":"c","kind":"expense","target":{"collection":"plan","id":"p-rent"},"field":"amount","op":"set","value":{"__proto__":{"polluted":1},"a":1e999},"from":null,"until":null},{"id":"c2","kind":"evil"},{"id":"c3","kind":"expense","target":{"collection":"plan","id":"p"},"field":"constructor","op":"set","value":1},null,5]}');
            const { rows, skipped } = sanitizeScenarioRows([good, evil, null, 'x', { name: 'no id' }, { ...good }, [], { id: 'big', changes: new Array(2000).fill(rentChange()) }]);
            assert('kept: good, evil (cleaned), big (trimmed)', rows.map((r) => r.id), ['s1', 's2', 'big']);
            const s2 = rows[1];
            assert('name capped', s2.name.length, 120);
            assert('pinned must be a true boolean', s2.pinned, false);
            assert('only the clean change kept', s2.changes.map((c) => c.id), ['c']);
            assert('prototype key stripped', Object.prototype.hasOwnProperty.call(s2.changes[0].value, '__proto__'), false);
            assert('no pollution', ({}).polluted, undefined);
            assert('huge number bounded', Number.isFinite(s2.changes[0].value.a), true);
            assert('change duplicates cut and capped to 500', rows[2].changes.length, 1);
            assert('rows skipped are counted', skipped >= 5, true);
            assert('not an array', sanitizeScenarioRows('x'), { rows: [], skipped: 0 });
        },
    },
    {
        name: 'F1.7 Make this real',
        fn(assert) {
            const data = base();
            const alloc = data.allocation;
            const changes = [
                rentChange({ id: 'now', from: '2026-11-01', until: '2027-06-01' }),
                ch({ id: 'later', kind: 'expense', target: { collection: 'plan', id: data.plan[1].id }, field: 'amount', op: 'set', value: 99, from: '2027-01-15' }),
                ch({ id: 'later2', kind: 'expense', target: { collection: 'plan', id: data.plan[2].id }, field: 'amount', op: 'set', value: 98, from: '2027-01-01' }),
                ch({ id: 'inc', kind: 'income', target: { collection: 'incomeSources', id: data.incomeSources[0].id }, field: 'grossAnnual', op: 'set', value: 120000 }),
                ch({ id: 'oo', kind: 'oneOff', op: 'add', value: { amount: -6000 }, from: '2026-11-21' }),
                ch({ id: 'gone', kind: 'expense', target: { collection: 'plan', id: 'p-gone' }, field: 'amount', op: 'set', value: 1 }),
                ch({ id: 'fi', kind: 'assumption', target: { collection: 'fiSettings', id: null }, field: 'multiple', op: 'set', value: 28 }),
                ch({ id: 'sp1', kind: 'split', target: { collection: 'allocation', id: alloc[0].id }, field: 'percentage', op: 'set', value: alloc[0].percentage - 10 }),
                ch({ id: 'sp2', kind: 'split', target: { collection: 'allocation', id: alloc[1].id }, field: 'percentage', op: 'set', value: alloc[1].percentage + 10 }),
            ];
            const timers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
            let made = 0;
            globalThis.setTimeout = (...a) => { made++; return timers.setTimeout(...a); };
            globalThis.setInterval = (...a) => { made++; return timers.setInterval(...a); };
            let plan;
            try { plan = makeRealPlan(data, changes, TODAY); } finally { Object.assign(globalThis, timers); }
            assert('no timer is created', made, 0);
            assert('active today, together', plan.now.map((s) => s.id), ['now', 'inc', 'oo', 'fi', 'sp1+sp2']);
            assert('future ones one at a time, earliest first', plan.later.map((s) => s.id), ['later2', 'later']);
            assert('until dates dropped, named', plan.droppedUntil, ['now']);
            assert('missing target listed, not offered', [plan.missing.map((c) => c.id), plan.now.concat(plan.later).some((s) => s.id === 'gone')], [['gone'], false]);
            assert('routes', plan.now.map((s) => s.route), ['plan', 'income', 'virtual', 'fi', 'split']);

            const rentBefore = planRent(data);
            const res = applyMakeReal(data, plan.now);
            assert('applied through the owners', res.applied, ['now', 'fi', 'sp1+sp2']);
            assert('rent changed', planRent(data), 610);
            assert('future change not applied', data.plan[1].amount === 99, false);
            assert('assumption applied', data.fiSettings.multiple, 28);
            assert('split applied', data.allocation[0].percentage, alloc[0].percentage);
            assert('income handed to its sheet', res.sheets.map((s) => s.id), ['inc']);
            assert('one-off shown, not applied', res.skipped.map((s) => s.id), ['oo']);
            assert('nothing failed', res.failed, []);
            assert('undo payload shape', [res.ok, typeof res.onUndo, typeof res.message], [true, 'function', 'string']);
            res.onUndo();
            assert('undo puts rent back', planRent(data), rentBefore);
            assert('undo puts the assumption back', data.fiSettings.multiple, 25);
            const one = applyMakeReal(data, plan.later.slice(0, 1));
            assert('a future change applies on its own, with its own undo', [one.applied, data.plan[2].amount], [['later2'], 98]);
            one.onUndo();
            assert('and undoes', data.plan[2].amount === 98, false);
            const bad = applyMakeReal(data, makeRealPlan(data, [ch({ id: 'sp', kind: 'split', target: { collection: 'allocation', id: alloc[0].id }, field: 'percentage', op: 'set', value: 99 })], TODAY).now);
            assert('a split that does not total 100 fails and writes nothing', [bad.ok, bad.failed.length, data.allocation[0].percentage], [false, 1, alloc[0].percentage]);
        },
    },
    {
        name: 'F1.8 headline',
        fn(assert) {
            assert('goals win', scenarioHeadline({ goals: { verdict: 'short', shortPerPayCents: -28658 }, fiYears: { now: 25, scenario: 20 } }), { kind: 'goal', key: 'f.scenario.headline.goal.short', params: { cents: 28658 } });
            assert('fi next', scenarioHeadline({ fiYears: { now: 25.09, scenario: 22.04 } }).key, 'f.scenario.headline.fi.sooner');
            assert('fi years difference', scenarioHeadline({ fiYears: { now: 25.09, scenario: 22.04 } }).params, { years: 3.1 });
            assert('fi later', scenarioHeadline({ fiYears: { now: 20, scenario: 22 } }).key, 'f.scenario.headline.fi.later');
            assert('never', scenarioHeadline({ fiYears: { now: 20, scenario: Infinity } }).key, 'f.scenario.headline.fi.never');
            assert('left per pay', scenarioHeadline({ leftPerPayCents: { now: 10000, scenario: 12500 } }), { kind: 'left', key: 'f.scenario.headline.left.more', params: { cents: 2500 } });
            assert('nothing', scenarioHeadline({}).kind, 'none');
            assert('junk in', scenarioHeadline(null).kind, 'none');
        },
    },
];
