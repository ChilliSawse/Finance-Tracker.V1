// Test cases for the "bucket-sheets" group (E7). Pure: the sheet builders and the state calls they drive.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { legacySampleFinanceData } from '../state/sample-data.js';
import { runMigrationChain } from '../state/migration-chain.js';
import { getBuckets } from '../state/saving-model.js';
import { createSheetModel } from './sheet.js';
import {
    categoryBucketField, bucketIdFromField, bucketSplitSpec, splitValidate, splitPlausibility, splitSaveOk, splitTotal,
    goalReadout, setTaxPot, applyBucketEdit, deletePlan, deleteBucketMoving, bucketSheetSpec,
} from './bucket-sheets.js';

const TODAY = '2026-11-21';
const sample = () => {
    const d = legacySampleFinanceData();
    runMigrationChain(d, { raw: null, source: 'load', storage: null });
    return d;
};
const byRole = (d, role) => d.allocation.find((r) => r.role === role);

export const BUCKET_SHEETS_TEST_CASES = [
    { name: 'E7.1 a split of 98 blocks Save and offers the difference to Smile', fn(assert) {
        const d = sample();
        const spec = bucketSplitSpec(d);
        const smile = spec.smileKey;
        const dailyKey = String(byRole(d, 'daily').id);
        assert('the sample starts at 100', splitTotal(spec, spec.values), 100);
        const values = { ...spec.values, [dailyKey]: spec.values[dailyKey] - 2 };
        assert('98 is not saveable', [splitTotal(spec, values), splitSaveOk(spec, values)], [98, false]);
        const model = createSheetModel({ fields: spec.fields, values, validate: splitValidate(spec), plausibility: splitPlausibility(spec) });
        assert('validate stops the save', model.save().ok, false);
        const notes = model.notes();
        assert('one note, on Smile, with a fix', [notes.length, notes[0].field, typeof notes[0].fix.apply], [1, smile, 'function']);
        assert('the fix says Smile', notes[0].fix.label, 'Put the difference into Smile');
        model.applyFix(0);
        assert('after the fix it saves at 100', [model.save().ok, splitSaveOk(spec, model.current())], [true, true]);
        const over = { ...spec.values, [dailyKey]: -1 };
        assert('a negative share is not saveable', splitSaveOk(spec, over), false);
    } },
    { name: 'E7.2 each bucket carries the engine suggestion; Mojo is not edited', fn(assert) {
        const d = sample();
        const spec = bucketSplitSpec(d);
        assert('no Mojo field', spec.fields.some((f) => f.key === String(byRole(d, 'mojo').id)), false);
        const daily = spec.fields.find((f) => f.key === String(byRole(d, 'daily').id));
        assert('the hint shows the dagger figure', daily.hint, 'Your spending suggests 60.3%');
    } },
    { name: 'E7.3 deleting a bucket with money always asks where it goes', fn(assert) {
        const d = sample();
        const fire = byRole(d, 'fire');
        fire.currentBalance = 250;
        const plan = deletePlan(d, fire.id);
        assert('it asks, with the amount', [plan.ask, plan.moveCents], [true, 25000]);
        assert('Mojo is not offered', plan.options.some((o) => o.value === String(byRole(d, 'mojo').id)), false);
        const res = deleteBucketMoving(d, fire.id, null, { fork: true });
        assert('no destination: nothing deleted, the move question comes back', [res.ok, res.code, d.allocation.includes(fire)], [false, 'move', true]);
        const smile = byRole(d, 'smile');
        const before = smile.currentBalance;
        const ok = deleteBucketMoving(d, fire.id, smile.id, { fork: true });
        assert('moved on a pick', [ok.ok, smile.currentBalance, d.allocation.some((r) => r.id === fire.id)], [true, before + 250, false]);
        ok.onUndo();
        assert('undo puts it back', [d.allocation.some((r) => r.id === fire.id), byRole(d, 'smile').currentBalance], [true, before]);
    } },
    { name: 'E7.4 an empty bucket with no share deletes without a destination', fn(assert) {
        const d = sample();
        d.allocation.push({ id: 'x1', name: 'Extra', percentage: 0, currentBalance: 0, savingsGoal: 0, isTaxProvision: false, role: null, kind: 'save', slot: 6 });
        const plan = deletePlan(d, 'x1');
        assert('no ask', plan.ask, false);
        const res = deleteBucketMoving(d, 'x1', null, { fork: true });
        assert('deleted', [res.ok, d.allocation.some((r) => r.id === 'x1')], [true, false]);
    } },
    { name: 'E7.5 the tax-pot tag moves or asks', fn(assert) {
        const d = sample();
        const smile = byRole(d, 'smile');
        const fire = byRole(d, 'fire');
        smile.isTaxProvision = true;
        const ask = setTaxPot(d, fire.id, true);
        assert('held elsewhere: asks, writes nothing', [ask.ok, ask.code, ask.holder, smile.isTaxProvision, !!fire.isTaxProvision], [false, 'holds', smile.name, true, false]);
        const moved = setTaxPot(d, fire.id, true, { move: true });
        assert('moves with consent', [moved.ok, !!smile.isTaxProvision, fire.isTaxProvision], [true, false, true]);
        moved.onUndo();
        assert('undo puts it back', [byRole(d, 'smile').isTaxProvision, !!byRole(d, 'fire').isTaxProvision], [true, false]);
        const edit = applyBucketEdit(d, fire.id, { name: fire.name, tax: true });
        assert('the sheet save asks too', edit.code, 'holds');
        const del = sample();
        const tagged = byRole(del, 'splurge');
        tagged.isTaxProvision = true;
        assert('a tagged bucket must pick a destination', deletePlan(del, tagged.id).ask, true);
        const dest = byRole(del, 'daily');
        const r = deleteBucketMoving(del, tagged.id, dest.id, { fork: true });
        assert('the tag moves with the money', [r.ok, dest.isTaxProvision], [true, true]);
        r.onUndo();
        assert('undo restores the tag', [byRole(del, 'splurge').isTaxProvision, !!byRole(del, 'daily').isTaxProvision], [true, false]);
    } },
    { name: 'E7.6 bucket edit: rename, bank note, kind, one undo', fn(assert) {
        const d = sample();
        d.allocation.push({ id: 'x2', name: 'Pets', percentage: 0, currentBalance: 0, savingsGoal: 0, isTaxProvision: false, role: null, kind: 'save', slot: 6 });
        const spec = bucketSheetSpec(d, 'x2');
        assert('custom bucket offers the spend or save pick', spec.fields.map((f) => f.key), ['name', 'bankLabel', 'kind', 'tax']);
        assert('a core bucket does not', bucketSheetSpec(d, byRole(d, 'daily').id).fields.map((f) => f.key), ['name', 'bankLabel', 'tax']);
        const res = applyBucketEdit(d, 'x2', { name: ' Pet fund ', bankLabel: 'Pets acct', kind: 'spend', tax: false });
        const row = d.allocation.find((r) => r.id === 'x2');
        assert('written', [res.ok, row.name, row.bankLabel, row.kind], [true, 'Pet fund', 'Pets acct', 'spend']);
        res.onUndo();
        const back = d.allocation.find((r) => r.id === 'x2');
        assert('undone', [back.name, back.bankLabel, back.kind], ['Pets', undefined, 'save']);
        assert('a blank name is refused', applyBucketEdit(d, 'x2', { name: '  ' }).code, 'name');
    } },
    { name: 'E7.7 the goal readout comes from smilePlan', fn(assert) {
        const dates = ['2026-12-05', '2026-12-19', '2027-01-02', '2027-01-16'];
        const base = { costCents: 100000, savedCents: 0, perPayCents: 50000, sharePct: 100, payDates: dates, today: TODAY };
        assert('no cost, no readout', goalReadout({ ...base, costCents: 0 }), null);
        assert('no date: a ready date', goalReadout(base).status, 'no-date');
        assert('on time', goalReadout({ ...base, due: '2027-01-02' }).status, 'on-track');
        assert('late', goalReadout({ ...base, perPayCents: 10000, due: '2026-12-19' }).status, 'late');
        assert('no pay left', goalReadout({ ...base, due: '2026-11-25' }).status, 'impossible');
        assert('saved up', goalReadout({ ...base, savedCents: 100000 }).status, 'done');
        assert('the late line says not by the date', goalReadout({ ...base, perPayCents: 10000, due: '2026-12-19' }).text.startsWith('Not by'), true);
    } },
    { name: 'E7.8 categoryBucketField: tick first, spend and save buckets, no Mojo', fn(assert) {
        const d = sample();
        const buckets = getBuckets(d, TODAY);
        const cat = { id: 'c1', name: 'Pets', bucketId: byRole(d, 'splurge').id };
        const f = categoryBucketField(cat, buckets);
        assert('first option follows the tick', f.options[0], { value: '', label: 'Follows essential tick' });
        assert('the four spend and save buckets', f.options.slice(1).map((o) => o.label), ['daily', 'splurge', 'smile', 'fire'].map((r) => byRole(d, r).name));
        assert('current link is the value', f.value, String(byRole(d, 'splurge').id));
        assert('a gone bucket reads as the tick', categoryBucketField({ bucketId: 'gone' }, buckets).value, '');
        assert('no link reads as the tick', categoryBucketField({ bucketId: null }, buckets).value, '');
        assert('the empty pick saves as null', [bucketIdFromField(''), bucketIdFromField('smile')], [null, 'smile']);
    } },
];
