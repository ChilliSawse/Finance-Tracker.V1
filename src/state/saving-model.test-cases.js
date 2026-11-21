// Test cases for the "saving-model" group (registered in src/test-registry.js).
// E1: pure maths in src/calc/saving-model.js (plan section 12, T1 to T9).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    BUCKET_METHOD, CUSTOM_RULES, validateModelDef, detectRole, detectRoles, bucketByRole,
    suggestSplit, allocateCents, validateSplit, fixToHundred, validateShares,
    buildTree, bucketBalanceCents, bucketTone, creditFamily,
    checkTemplateBounds, forkToCustom, canReturnToBase,
} from '../calc/saving-model.js';

// Sample household, per fortnight, in cents (plan section 12 T1).
const NET = 343843;
const ESSENTIAL = 207200;
const NON_ESSENTIAL = 36662;
const sum = (a) => a.reduce((x, y) => x + y, 0);

const coreRows = () => [
    { id: 'daily', name: 'Daily expenses', role: 'daily', percentage: 60, currentBalance: 0 },
    { id: 'splurge', name: 'Splurge', role: 'splurge', percentage: 10, currentBalance: 0 },
    { id: 'smile', name: 'Smile', role: 'smile', percentage: 10, currentBalance: 1200 },
    { id: 'fire', name: 'Fire extinguisher', role: 'fire', percentage: 20, currentBalance: 8000 },
    { id: 'mojo', name: 'Mojo', role: 'mojo', percentage: 0, currentBalance: 0 },
];

export const SAVING_MODEL_TEST_CASES = [
    { name: 'T1 expenses-first split', fn(assert) {
        const s = suggestSplit({ netCents: NET, essentialCents: ESSENTIAL, nonEssentialCents: NON_ESSENTIAL });
        assert('rawDaily', Math.round(s.rawDaily * 10000) / 10000, 60.2601);
        assert('rawSplurge', Math.round(s.rawSplurge * 10000) / 10000, 10.6624);
        assert('pcts', [s.daily, s.splurge, s.smile, s.fire], [60.3, 10.7, 9.7, 19.3]);
        assert('total 100.0', Math.round((s.daily + s.splurge + s.smile + s.fire) * 10), 1000);
        assert('not overspent', [s.overspent, s.shortfallCents], [false, 0]);
        const c = allocateCents(NET, [s.daily, s.splurge, s.smile, s.fire]);
        assert('cents', c, [207337, 36791, 33353, 66362]);
        assert('sum = net', sum(c), NET);
        assert('ratio 1:1 shifts the rest', suggestSplit({ netCents: NET, essentialCents: ESSENTIAL,
            nonEssentialCents: NON_ESSENTIAL, rules: { remainderRatio: { smile: 1, fire: 1 } } }).smile, 14.5);
    } },
    { name: 'T2 guide split in dollars', fn(assert) {
        const c = allocateCents(NET, [60, 10, 10, 20]);
        assert('cents', c, [206306, 34384, 34384, 68769]);
        assert('sum', sum(c), NET);
        assert('guide in method', BUCKET_METHOD.guide, { daily: 60, splurge: 10, smile: 10, fire: 20 });
    } },
    { name: 'T3 overspent and empty', fn(assert) {
        const s = suggestSplit({ netCents: 100000, essentialCents: 80000, nonEssentialCents: 30000 });
        assert('split', [s.daily, s.splurge, s.smile, s.fire], [80, 20, 0, 0]);
        assert('flags', [s.overspent, s.shortfallCents], [true, 10000]);
        assert('net 0 is null', suggestSplit({ netCents: 0, essentialCents: 5, nonEssentialCents: 5 }), null);
        const big = suggestSplit({ netCents: 1000, essentialCents: 5000, nonEssentialCents: 500 });
        assert('capped', [big.daily, big.splurge, big.smile, big.fire], [100, 0, 0, 0]);
        let bad = 0;
        for (const net of [-5, 1, 99, 100000, 343843]) {
            for (const e of [-10, 0, 1, 50000, 400000, NaN, undefined]) {
                for (const n of [-10, 0, 7, 30000, 400000]) {
                    const r = suggestSplit({ netCents: net, essentialCents: e, nonEssentialCents: n });
                    if (r === null) continue;
                    const v = [r.daily, r.splurge, r.smile, r.fire];
                    if (v.some((x) => !Number.isFinite(x) || x < 0)) bad++;
                    if (Math.round(sum(v) * 10) !== 1000) bad++;
                    if (sum(allocateCents(net, v)) !== net) bad++;
                }
            }
        }
        assert('grid clean', bad, 0);
    } },
    { name: 'T4 split rules', fn(assert) {
        const rows = (smile) => [{ id: 'daily', role: 'daily', pct: 60 }, { id: 'splurge', role: 'splurge', pct: 10 },
            { id: 'smile', role: 'smile', pct: smile }, { id: 'fire', role: 'fire', pct: 20 }, { id: 'mojo', role: 'mojo', pct: 0 }];
        assert('100 ok', validateSplit(rows(10)).ok, true);
        assert('100.04 ok', validateSplit(rows(10.04)).ok, true);
        assert('100.06 fails', validateSplit(rows(10.06)).ok, false);
        const bad = validateSplit(rows(8));
        assert('98 fails', [bad.ok, bad.total, bad.errors[0].code], [false, 98, 'total']);
        assert('fix smile', fixToHundred(rows(8), 'smile'), 10);
        assert('fix smile from 98', fixToHundred(rows(10).map((r) => (r.id === 'splurge' ? { ...r, pct: 8 } : r)), 'smile'), 12);
        assert('fix by role', fixToHundred(rows(8), 'fire'), 22);
        assert('fix cannot go negative', fixToHundred(rows(8).map((r) => (r.id === 'daily' ? { ...r, pct: 95 } : r)), 'smile'), null);
        const neg = validateSplit([{ id: 'a', pct: 110 }, { id: 'b', pct: -10 }]);
        assert('negative rejected', [neg.ok, neg.errors.some((e) => e.code === 'negative' && e.id === 'b')], [false, true]);
        const mojo = validateSplit([{ id: 'a', role: 'daily', pct: 90 }, { id: 'm', role: 'mojo', pct: 10 }]);
        assert('mojo flagged', mojo.errors.map((e) => e.code), ['mojo-share']);
        assert('mojo ok in custom', validateSplit([{ id: 'm', role: 'mojo', pct: 100 }], CUSTOM_RULES).ok, true);
    } },
    { name: 'T5 role detection', fn(assert) {
        assert('daily', detectRole('Daily expenses'), 'daily');
        assert('smile', detectRole('Smile (holiday fund)'), 'smile');
        assert('fire', detectRole('Fire extinguisher'), 'fire');
        assert('splurge', detectRole('Splurge'), 'splurge');
        assert('mojo by name', detectRole('Mojo'), 'mojo');
        assert('emergency is mojo', detectRole('Emergency fund'), 'mojo');
        assert('grow', detectRole('Investments'), 'grow');
        assert('living', detectRole('Living'), null);
        assert('G1 important is daily', detectRole('Important'), 'daily');
        assert('G1 everyday spending is daily', detectRole('Everyday spending'), 'daily');
        assert('G1 every day / day to day / day-to-day', [detectRole('Every day'), detectRole('Day to day'), detectRole('Day-to-day')], ['daily', 'daily', 'daily']);
        assert('G1 whole words only', [detectRole('Unimportant'), detectRole('Everydays')], [null, null]);
        assert('G1 important does not take daily twice', detectRoles(['Daily', 'Important']), ['daily', null]);
        assert('G1 important taken when daily is free', detectRoles(['Important', 'Daily']), ['daily', null]);
        assert('empty and junk', [detectRole(''), detectRole(null), detectRole(42)], [null, null, null]);
        assert('second smile null', detectRole('Smile', ['smile']), null);
        assert('first match per role', detectRoles(['Smile', 'Smile 2', 'Living', 'Fire']), ['smile', null, null, 'fire']);
        const data = { allocation: coreRows() };
        assert('bucketByRole', bucketByRole(data, 'fire').id, 'fire');
        assert('bucketByRole none', [bucketByRole(data, 'grow'), bucketByRole({}, 'fire'), bucketByRole(null, 'fire')], [null, null, null]);
    } },
    { name: 'T6 template bounds', fn(assert) {
        const rules = BUCKET_METHOD.rules;
        const codes = (r) => r.violations.map((v) => v.code);
        const base = checkTemplateBounds(rules, coreRows(), []);
        assert('baseline in', [base.inBounds, base.violations], [true, []]);
        const edited = coreRows().map((r) => ({ ...r, name: r.name + ' x' }));
        edited[2].percentage = 12;
        assert('rename and pct edits in', checkTemplateBounds(rules, edited, []).inBounds, true);
        const six = [...coreRows(), { id: 'x', name: 'Holidays', role: null, percentage: 0 }];
        assert('sixth top-level', codes(checkTemplateBounds(rules, six, [])), ['extra-top-level']);
        assert('grow row is extra', codes(checkTemplateBounds(rules, [...coreRows(), { id: 'g', role: 'grow', percentage: 5 }], [])), ['extra-top-level']);
        const noSplurge = coreRows().filter((r) => r.role !== 'splurge');
        assert('core removed', codes(checkTemplateBounds(rules, noSplurge, [])), ['core-removed']);
        const mojo = coreRows(); mojo[4].percentage = 5;
        assert('mojo share', codes(checkTemplateBounds(rules, mojo, [])), ['mojo-share']);
        const goal = (id, parentId) => ({ id, parentId, name: id, share: 100 });
        assert('goal under smile in', checkTemplateBounds(rules, coreRows(), [goal('g1', 'smile')]).inBounds, true);
        assert('goal under splurge', codes(checkTemplateBounds(rules, coreRows(), [goal('g1', 'splurge')])), ['child-not-allowed']);
        const chain3 = [goal('g1', 'smile'), goal('g2', 'g1'), goal('g3', 'g2')];
        assert('depth 3 in', checkTemplateBounds(rules, coreRows(), chain3).inBounds, true);
        assert('depth 4', codes(checkTemplateBounds(rules, coreRows(), [...chain3, goal('g4', 'g3')])), ['depth']);
        const tax = coreRows().map((r) => ({ ...r, isTaxProvision: true }));
        assert('tax pot tick in', checkTemplateBounds(rules, tax, []).inBounds, true);
        assert('custom allows all', checkTemplateBounds(CUSTOM_RULES, six, [goal('g1', 'splurge')]).inBounds, true);
        assert('tolerates junk', checkTemplateBounds(undefined, null, null).violations.length, 5);
    } },
    { name: 'T7 fork to own template', fn(assert) {
        const model = { version: 1, id: 'bucket-method', name: 'Bucket method', after: 'Scott Pape', basedOn: null, basis: 'net',
            rules: { ...BUCKET_METHOD.rules }, fire: { targets: [{ id: 't1', name: 'Card', remainingCents: 185000 }] },
            mojo: { starter: 2000, months: 3, basis: 'auto', steps: [] }, autoCredit: { on: false, rolledThrough: null } };
        const data = { savingModel: model, allocation: coreRows(), bucketGoals: [{ id: 'g1', parentId: 'smile', name: 'Japan', share: 100 }],
            categories: [{ id: 'c1', name: 'Dining', bucketId: 'splurge' }] };
        const before = JSON.parse(JSON.stringify(data));
        const forked = forkToCustom(data.savingModel);
        const after = { ...data, savingModel: forked };
        assert('id and basedOn', [forked.id, forked.basedOn, forked.name, forked.after], ['custom-1', 'bucket-method', 'My template', null]);
        assert('rules relaxed', forked.rules, CUSTOM_RULES);
        assert('input not mutated', data, before);
        assert('buckets and categories untouched', [after.allocation, after.bucketGoals, after.categories], [before.allocation, before.bucketGoals, before.categories]);
        assert('fire and mojo untouched', [forked.fire, forked.mojo, forked.autoCredit], [model.fire, model.mojo, model.autoCredit]);
        assert('idempotent', forkToCustom(forked), forked);
        assert('base never returns', canReturnToBase(model, coreRows(), []), false);
        assert('in bounds again', canReturnToBase(forked, coreRows(), []), true);
        const six = [...coreRows(), { id: 'x', role: null, percentage: 0 }];
        assert('still out of bounds', canReturnToBase(forked, six, []), false);
    } },
    { name: 'T8 colour tones', fn(assert) {
        const rows = [...coreRows(), { id: 'grow', name: 'Grow', role: 'grow', percentage: 0 }];
        for (let i = 1; i <= 5; i++) rows.push({ id: 'x' + i, name: 'Extra ' + i, role: null, percentage: 0 });
        const goals = [
            { id: 'g1', parentId: 'smile', name: 'Concert', share: 15 },
            { id: 'g2', parentId: 'smile', name: 'Bike', share: 15 },
            { id: 'g3', parentId: 'smile', name: 'Japan', share: 70 },
            { id: 's1', parentId: 'g3', name: 'Flights', share: 25 },
            { id: 's2', parentId: 'g3', name: 'Hotels', share: 25 },
            { id: 's3', parentId: 'g3', name: 'Food', share: 25 },
            { id: 's4', parentId: 'g3', name: 'Tours', share: 25 },
        ];
        const on = buildTree(rows, goals, { ...CUSTOM_RULES, colourRepeat: true });
        const slot = (t, id) => { const x = bucketTone(id, t); return [x.slot, x.shade, x.repeat]; };
        assert('core 1 to 5', ['daily', 'splurge', 'smile', 'fire', 'mojo'].map((id) => bucketTone(id, on).slot), [1, 2, 3, 4, 5]);
        assert('grow 6', slot(on, 'grow'), [6, 0, false]);
        assert('added 7 to 10', ['x1', 'x2', 'x3', 'x4'].map((id) => bucketTone(id, on).slot), [7, 8, 9, 10]);
        assert('next repeats when on', slot(on, 'x5'), [1, 2, true]);
        const off = buildTree(rows, goals, { ...CUSTOM_RULES, colourRepeat: false });
        assert('no repeat when off', slot(off, 'x5'), [null, 0, false]);
        assert('depth-1 goal is shade 0', ['g1', 'g2', 'g3'].map((id) => slot(on, id)), [[3, 0, false], [3, 0, false], [3, 0, false]]);
        assert('depth-2 shades 1,2,3,1', ['s1', 's2', 's3', 's4'].map((id) => bucketTone(id, on).shade), [1, 2, 3, 1]);
        assert('depth-2 inherits slot', bucketTone('s1', on).slot, 3);
        assert('unknown id', bucketTone('nope', on), null);
    } },
    { name: 'T9 family balances', fn(assert) {
        const rows = coreRows();
        const goals = [
            { id: 'g1', parentId: 'smile', name: 'Concert', share: 15, saved: 100 },
            { id: 'g2', parentId: 'smile', name: 'Bike', share: 15, saved: 50.5 },
            { id: 'g3', parentId: 'smile', name: 'Japan', share: 70, saved: 0 },
            { id: 's1', parentId: 'g3', name: 'Flights', share: 60, saved: 300 },
            { id: 's2', parentId: 'g3', name: 'Hotels', share: 40, saved: 0 },
        ];
        const tree = buildTree(rows, goals, BUCKET_METHOD.rules);
        const credit = creditFamily(34384, 'smile', tree);
        assert('leaf credits', credit.filter((c) => c.id === 'g1' || c.id === 'g2').map((c) => [c.id, c.cents]), [['g1', 5158], ['g2', 5157]]);
        assert('japan splits to leaves', credit.filter((c) => c.id.startsWith('s')).map((c) => [c.id, c.cents]), [['s1', 14441], ['s2', 9628]]);
        assert('sum = credit', sum(credit.map((c) => c.cents)), 34384);
        const flat = buildTree(rows, goals.slice(0, 3), BUCKET_METHOD.rules);
        assert('15/15/70', creditFamily(34384, 'smile', flat).map((c) => c.cents), [5158, 5157, 24069]);
        assert('leaf bucket credits itself', creditFamily(500, 'fire', flat), [{ id: 'fire', cents: 500 }]);
        assert('balance = own + leaves', bucketBalanceCents('smile', tree), 120000 + 10000 + 5050 + 30000);
        assert('goal balance = leaves', bucketBalanceCents('g3', tree), 30000);
        assert('shares 100 ok', validateShares(goals).ok, true);
        const bad = validateShares(goals.map((g) => (g.id === 'g3' ? { ...g, share: 69 } : g)));
        assert('99 rejected', [bad.ok, bad.errors[0].code, bad.errors[0].parentId, bad.errors[0].total], [false, 'shares-total', 'smile', 99]);
        const badTree = buildTree(rows, goals.map((g) => (g.id === 'g3' ? { ...g, share: 69 } : g)), BUCKET_METHOD.rules);
        assert('credit refuses bad shares', creditFamily(34384, 'smile', badTree), null);
    } },
    { name: 'allocateCents edge cases and model definition', fn(assert) {
        assert('zero net', allocateCents(0, [60, 40]), [0, 0]);
        assert('empty', allocateCents(100, []), []);
        assert('all zero pcts', allocateCents(100, [0, 0]), [0, 0]);
        assert('negative pct treated as zero', allocateCents(100, [-5, 100]), [0, 100]);
        assert('ties go to earlier row', allocateCents(100, [33.3, 33.3, 33.4]), [33, 33, 34]);
        assert('thirds', allocateCents(100, [1, 1, 1]), [34, 33, 33]);
        let bad = 0;
        for (let net = 0; net < 400; net += 7) {
            for (const p of [[60, 10, 10, 20], [33.3, 33.3, 33.4], [99.9, 0.1], [12.5, 12.5, 25, 50], [0.1, 0.1, 99.8]]) {
                const c = allocateCents(net, p);
                if (sum(c) !== net || c.some((x) => x < 0 || !Number.isInteger(x))) bad++;
            }
        }
        assert('sum = net always', bad, 0);
        assert('built-in def valid', validateModelDef(BUCKET_METHOD).ok, true);
        assert('bad def', validateModelDef({ id: 'x' }).ok, false);
        const fixed = { id: 'f', name: '50/30/20', basis: 'net', engine: 'fixed', buckets: [
            { role: 'daily', name: 'Needs', slot: 1, kind: 'spend', pct: 50 }, { role: 'splurge', name: 'Wants', slot: 2, kind: 'spend', pct: 30 },
            { role: 'fire', name: 'Savings', slot: 4, kind: 'save', pct: 20 }], rules: { coreBuckets: ['daily', 'splurge', 'fire'], maxDepth: 3 } };
        assert('fixed def valid', validateModelDef(fixed).ok, true);
        const off = JSON.parse(JSON.stringify(fixed)); off.buckets[0].pct = 40;
        assert('fixed def must total 100', validateModelDef(off).ok, false);
        assert('not json', validateModelDef('x').ok, false);
    } },
];
