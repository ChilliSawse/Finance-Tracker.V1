// Test cases for the "bucket-method" group (E10): the Bucket method's integration checks and the fixes found by earlier steps.
// Pure, except the cases that guard on HAS_DOM (they run in tests.html). Synthetic fixtures only.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import themes from '../theme/themes.json' with { type: 'json' };
import { buildTokenSets } from '../../scripts/build-themes.mjs';
import { store } from '../state/store.js';
import { buildSampleHousehold, legacySampleFinanceData } from '../state/sample-data.js';
import { runMigrationChain } from '../state/migration-chain.js';
import { getBuckets, addBucket, addTarget, updateTarget, removeTarget } from '../state/saving-model.js';
import { leftThisPay } from '../calc/pay-cycle.js';
import { reviewDue, buildMonthlyReview, bankSetToOf } from '../calc/review.js';
import { taxTablesStatus, hasPayslipJob } from '../calc/tax-tables/index.js';
import { taxProvisionModel } from './future/model.js';
import { reviewModel, reviewDueFor, markReviewOpened } from './review.js';
import { taxCardModel, dismissTaxCheck } from './tax-card.js';
import { confirmTaxCheck } from './income-layout.js';
import { buildBucketsModel, buildBucketsHtml, dispatchBucketAction, bucketSheetRoute } from './plan-buckets.js';
import { targetSheetSpec, applyTargetEdit, openBucketSheet } from './bucket-sheets.js';
import { createSheetModel } from './sheet.js';

const HAS_DOM = typeof document !== 'undefined';
const TODAY = '2026-11-21';
const house = () => buildSampleHousehold(TODAY).data;
const migrated = () => {
    const d = legacySampleFinanceData();
    runMigrationChain(d, { raw: null, source: 'load', storage: null });
    return d;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const addPot = (d, label = 'Holiday fund', goalCents = 50000) => addTarget(d, { type: 'saver', label, goalCents }).item.id;

export const BUCKET_METHOD_TEST_CASES = [
    { name: 'E10.1 the tax-pot comparison works on a bucket with the tax tag, and on one with no id or role (the Future model; A12a moved this from the deleted Savings card)', fn(assert) {
        // One pinned clock for every call: the model reads `now` to the millisecond (fyElapsedFraction), so separate new Date() calls made the equality below flaky (K5).
        const now = new Date(`${TODAY}T12:00:00`);
        const iso = TODAY;
        const base = () => ({
            incomeSources: [{ incomeType: 'variable', incomeEvents: [{ date: iso, netAmount: 8000, taxWithheld: 0 }] }],
            primaryIncomeIndex: 0,
        });
        const full = taxProvisionModel({ ...base(), allocation: [{ id: 'b-tax', name: 'Tax pot', role: null, isTaxProvision: true, currentBalance: 1000000 }] }, now);
        assert('the card shows', full !== null && full.kind, 'pot');
        assert('a full pot is shown by name and covers the provision', full.pot.name === 'Tax pot' && full.pot.balance >= full.prov.provisionToDate, true);
        const behind = taxProvisionModel({ ...base(), allocation: [{ id: 'b-tax', name: 'Tax pot', role: null, isTaxProvision: true, currentBalance: 0 }] }, now);
        let loose = null;
        let threw = false;
        try { loose = taxProvisionModel({ ...base(), allocation: [{ name: 'Loose pot', isTaxProvision: true, currentBalance: 0 }] }, now); } catch (e) { threw = true; }
        assert('a pot with no id and no role does not throw', threw, false);
        assert('and says the same as one with them', { ...loose, pot: { ...loose.pot, name: 'Tax pot' } }, behind);
        threw = false;
        let stray = null;
        try { stray = taxProvisionModel({ ...base(), allocation: [null, 'x', { name: 'No tag' }] }, now); } catch (e) { threw = true; }
        assert('stray rows in the list do not throw', threw, false);
        assert('and read as no tax pot', stray.kind, 'noPot');
    } },
    { name: 'E10.2 a bucket with no id or role does not throw in getBuckets or leftThisPay', fn(assert) {
        const d = house();
        d.allocation.push({ name: 'No id no role', percentage: 0, currentBalance: 12, savingsGoal: 0, isTaxProvision: true });
        d.allocation.push({ id: 'only-id', percentage: 0, currentBalance: 0 });
        d.allocation.push(null);
        d.allocation.push({});
        let list = null;
        let threw = '';
        try { list = getBuckets(d, TODAY); } catch (e) { threw = String(e); }
        assert('getBuckets does not throw', threw, '');
        const loose = list.find((b) => b.name === 'No id no role');
        assert('the loose bucket is listed with a fallback id and a null role', [typeof loose.id, loose.id.length > 0, loose.role], ['string', true, null]);
        assert('every listed id is a string and unique', [list.every((b) => typeof b.id === 'string'), new Set(list.map((b) => b.id)).size], [true, list.length]);
        let left = null;
        try { left = leftThisPay({ data: d, txns: [], today: TODAY }); } catch (e) { threw = String(e); }
        assert('leftThisPay does not throw', threw, '');
        assert('it still lists the buckets that have an id', left.buckets.some((b) => b.id === 'only-id'), true);
        assert('no figure is NaN', left.buckets.every((b) => Number.isFinite(b.poolCents) && Number.isFinite(b.leftCents)), true);
        let none = null;
        try { none = getBuckets({ allocation: [{ name: 'x' }] }, TODAY); } catch (e) { threw = String(e); }
        assert('a model with only a bare row is fine', [threw, none.length], ['', 1]);
    } },
    { name: 'E10.3 slots 5 to 10 and a repeat colour have tokens in all four palettes, light and dark', fn(assert) {
        const d = house();
        d.allocation.push({ id: 'b-grow', name: 'Grow', role: 'grow', kind: 'save', slot: 6, percentage: 0, currentBalance: 0, savingsGoal: 0, isTaxProvision: false });
        for (let n = 1; n <= 5; n++) addBucket(d, { name: `Extra ${n}` }, { fork: true });
        const list = getBuckets(d, TODAY).filter((b) => !b.parentId);
        assert('eleven top-level buckets', list.length, 11);
        assert('slots stay within 1 to 10', list.every((b) => b.slot >= 1 && b.slot <= 10), true);
        assert('slots 5 to 10 are all in use', [5, 6, 7, 8, 9, 10].every((s) => list.some((b) => b.slot === s)), true);
        const repeat = list.filter((b) => list.some((o) => o !== b && o.slot === b.slot));
        assert('the eleventh repeats a slot and takes a shade', repeat.length >= 2 && repeat.some((b) => b.shade > 0), true);
        const sets = buildTokenSets(themes);
        assert('eight sets: four palettes, light and dark', sets.length, 8);
        const missing = [];
        for (const s of sets) {
            for (const b of list) {
                const keys = [`--b${b.slot}-bg`, `--b${b.slot}-ink`, `--b${b.slot}-chart`];
                if (b.shade > 0) keys.push(`--b${b.slot}-shade${b.shade}`);
                for (const k of keys) if (!s.vars[k]) missing.push(`${s.id || s.palette} ${s.mode} ${k}`);
            }
        }
        assert('every bucket colour exists in every set', missing, []);
    } },
    { name: 'E10.4 reviewDue reads the real marker path on a migrated model', fn(assert) {
        const d = migrated();
        assert('the migrated marker is where reviewDue now looks', d.savingModel.review, { lastOpenedMonth: null });
        const opts = { hasTransactions: ['2026-10'] };
        assert('due on the 1st', reviewDue(d, '2026-11-01', opts), '2026-10');
        d.savingModel.review.lastOpenedMonth = '2026-10';
        assert('opened at savingModel.review: no longer due', reviewDue(d, '2026-11-01', opts), null);
        d.savingModel.review.lastOpenedMonth = '2026-09';
        assert('an older opened month leaves October due', reviewDue(d, '2026-11-01', opts), '2026-10');
        assert('a stale data.review is not what decides', reviewDue({ ...d, review: { lastOpenedMonth: '2026-10' } }, '2026-11-01', opts), '2026-10');
        assert('the old shape is still read when the model has no marker', reviewDue({ review: { lastOpenedMonth: '2026-10' }, savingModel: { movements: [] } }, '2026-11-01', opts), null);
        assert('E9 passes the data straight through', reviewDueFor(d, '2026-11-01', opts), reviewDue(d, '2026-11-01', opts));
        const h = house();
        assert('markReviewOpened then not due', [markReviewOpened(h, '2026-10'), reviewDue(h, '2026-11-01', opts)], [true, null]);
    } },
    { name: 'E10.5 buildMonthlyReview reads bankSetTo at savingModel.transfers', fn(assert) {
        const d = migrated();
        const bucket = d.allocation.find((r) => r.role === 'splurge');
        const was = d.savingModel.transfers.bankSetTo[String(bucket.id)];
        assert('the migrated model keeps bankSetTo under transfers', typeof was, 'number');
        assert('bankSetToOf finds it', bankSetToOf(d), d.savingModel.transfers.bankSetTo);
        d.savingModel.transfers.bankSetTo[String(bucket.id)] = 1;
        const r = buildMonthlyReview({ data: d, month: '2026-10', spendByCategory: new Map(), today: TODAY });
        const row = r.transfers.find((x) => x.bucketId === String(bucket.id));
        assert('the stale row is listed with its old amount', row && row.wasCents, 1);
        d.savingModel.transfers.bankSetTo = null;
        assert('no bankSetTo is an empty list', buildMonthlyReview({ data: d, month: '2026-10', spendByCategory: new Map(), today: TODAY }).transfers, []);
        assert('the old path is read only as a fallback', bankSetToOf({ savingModel: { bankSetTo: { a: 5 } } }), { a: 5 });
        assert('and the new path wins', bankSetToOf({ savingModel: { bankSetTo: { a: 5 }, transfers: { bankSetTo: { a: 9 } } } }), { a: 9 });
    } },
    { name: 'E10.6 the sample seeds bank transfers a little off the split', fn(assert) {
        const d = house();
        const seeded = d.savingModel.transfers.bankSetTo;
        const tops = getBuckets(d, TODAY).filter((b) => !b.parentId && b.role !== 'mojo' && b.role !== 'grow');
        assert('every spend and save bucket has a value above zero', tops.every((b) => seeded[b.id] > 0), true);
        assert('values are whole tens of dollars', Object.values(seeded).every((c) => c % 1000 === 0), true);
        const rows = reviewModel(d, '2026-10', new Map(), TODAY).transfers;
        assert('the review lists some rows to update', rows.length > 0, true);
        assert('and none says it was A$0.00', rows.every((r) => r.wasCents > 0), true);
        assert('the transfer card is not all of them (Daily is within a dollar or two)', rows.length <= tops.length, true);
    } },
    { name: 'E10.7 the Fire card offers Edit on a saver target only, and the sheet is the add form pre-filled', fn(assert) {
        const d = house();
        const id = addPot(d);
        const html = buildBucketsHtml(buildBucketsModel(d, TODAY, {}), {});
        assert('the saver row has an Edit button for it', html.includes(`data-pb="fire-edit" data-id="${id}"`), true);
        assert('a debt row has none', html.includes('data-pb="fire-edit" data-id="debt:'), false);
        assert('the click opens the target-edit sheet', dispatchBucketAction(d, 'fire-edit', { id }, { today: TODAY }), { sheet: { kind: 'target-edit', id } });
        assert('routed to the E7 sheets with its id', bucketSheetRoute({ kind: 'target-edit', id }), { kind: 'target-edit', id });
        const spec = targetSheetSpec(d, id);
        assert('same two fields as the add sheet', spec.fields.map((f) => [f.key, f.type, f.unit || null]), [['label', 'text', null], ['goalCents', 'money', 'cents']]);
        assert('pre-filled from the target', spec.values, { label: 'Holiday fund', goalCents: 50000 });
        assert('a debt, a missing id: nothing to edit', [targetSheetSpec(d, 'debt:l-credit-card'), targetSheetSpec(d, 'nope'), targetSheetSpec(null, id)], [null, null, null]);
    } },
    { name: 'E10.8 saving an edited target: through the state API, with undo; rejects an empty name', fn(assert) {
        const d = house();
        const id = addPot(d);
        const before = JSON.stringify(d.savingModel.fire.targets);
        const spec = targetSheetSpec(d, id);
        const model = createSheetModel({ fields: spec.fields, values: spec.values });
        model.set('label', '  Trip fund ');
        model.set('goalCents', '750');
        const v = model.save();
        assert('the sheet saves', v.ok, true);
        const res = applyTargetEdit(d, id, v.values);
        const tg = d.savingModel.fire.targets.find((x) => x.id === id);
        assert('label trimmed, goal in cents, id and place kept', [res.ok, tg.label, tg.goalCents, tg.id], [true, 'Trip fund', 75000, id]);
        assert('the message names it', res.message, 'Updated Trip fund');
        res.onUndo();
        assert('undo puts the list back exactly', JSON.stringify(d.savingModel.fire.targets), before);
        model.set('label', '   ');
        assert('an empty name does not save', model.save().ok, false);
        assert('the state call refuses it too', [updateTarget(d, id, { label: ' ' }).ok, updateTarget(d, id, { label: ' ' }).code], [false, 'name']);
        assert('a fixed target is refused', updateTarget(d, d.savingModel.fire.targets[0].id, { label: 'x' }).ok, false);
        assert('a missing target is refused', updateTarget(d, 'nope', { label: 'x' }).code, 'missing');
        const gone = removeTarget(d, id);
        assert('delete uses the existing removal and undoes', [gone.ok, d.savingModel.fire.targets.some((x) => x.id === id)], [true, false]);
        gone.onUndo();
        assert('undo brings it back', d.savingModel.fire.targets.some((x) => x.id === id), true);
    } },
    { name: 'E10.9 the edit sheet in the page: prefilled, cancel, Escape, save, delete, escaped', async fn(assert) {
        if (!HAS_DOM) return;
        const saved = store.financeData;
        const d = house();
        const id = addPot(d);
        store.financeData = d;
        const layer = () => document.querySelector('.sheet-layer');
        const input = (k) => document.querySelector(`.sheet-layer [data-key="${k}"]`);
        try {
            assert('it opens', openBucketSheet('target-edit', id), true);
            assert('titled Edit target', document.querySelector('.sheet-layer h2').textContent, 'Edit target');
            assert('the name is pre-filled', input('label').value, 'Holiday fund');
            assert('the goal is pre-filled', input('goalCents').value.includes('500'), true);
            assert('it has a Delete button', !!document.querySelector('.sheet-layer [data-sheet-action="delete"]'), true);
            input('label').value = 'Changed but cancelled';
            input('label').dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('.sheet-layer [data-sheet-action="close"]').click();
            assert('cancel closes it', layer(), null);
            assert('and writes nothing', d.savingModel.fire.targets.find((x) => x.id === id).label, 'Holiday fund');

            openBucketSheet('target-edit', id);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assert('Escape closes it', layer(), null);
            assert('and writes nothing', d.savingModel.fire.targets.find((x) => x.id === id).label, 'Holiday fund');

            openBucketSheet('target-edit', id);
            input('label').value = '<img src=x onerror=alert(1)>';
            input('label').dispatchEvent(new Event('input', { bubbles: true }));
            assert('markup in the name stays text inside the sheet', layer().querySelector('img'), null);
            document.querySelector('.sheet-layer [data-sheet-action="save"]').click();
            await tick();
            await tick();
            assert('save writes the name as text', d.savingModel.fire.targets.find((x) => x.id === id).label, '<img src=x onerror=alert(1)>');
            assert('and the sheet closed', layer(), null);
            const html = buildBucketsHtml(buildBucketsModel(d, TODAY, {}), {});
            assert('the Fire card shows it escaped', [html.includes('<img'), html.includes('&lt;img')], [false, true]);

            openBucketSheet('target-edit', id);
            document.querySelector('.sheet-layer [data-sheet-action="delete"]').click();
            await tick();
            assert('delete removes the target', d.savingModel.fire.targets.some((x) => x.id === id), false);
            assert('the sheet is gone', layer(), null);
            assert('a missing target opens nothing', [openBucketSheet('target-edit', id), layer()], [false, null]);
        } finally {
            const open = layer();
            if (open) open.remove();
            document.body.classList.remove('has-sheet');
            store.financeData = saved;
        }
    } },
    { name: 'E10.10 the July card shows for a payslip-job source with no check yet (30 Jun, 1 Jul, after the check)', fn(assert) {
        const job = () => ({ incomeSources: [{ incomeType: 'salaried', grossAnnual: 85000, paySchedule: 'fortnightly' }] });
        assert('30 June: nothing', taxCardModel('2026-06-30', job()), null);
        assert('1 July: the card', taxCardModel('2026-07-01', job()), { kind: 'july', fy: '2026-27' });
        assert('still there in September', taxCardModel('2026-09-30', job()), { kind: 'july', fy: '2026-27' });
        assert('quiet again in October (nothing ever checked)', taxCardModel('2026-10-01', job()), null);
        const d = job();
        assert('the status says check due', taxTablesStatus('2026-07-01', d), { activeFy: '2026-27', stale: false, checkDue: true });
        assert('a payslip check confirms it', confirmTaxCheck(d, '2026-07-10', '2026-07-12'), true);
        assert('the card hides once the year is checked', taxCardModel('2026-07-12', d), null);
        assert('and the status is settled', taxTablesStatus('2026-07-12', d).checkDue, false);
        const dismissed = job();
        dismissTaxCheck(dismissed, '2026-07-02');
        assert('Dismiss hides it for the year', taxCardModel('2026-07-02', dismissed), null);
        const hours = { incomeSources: [{ incomeType: 'salaried', grossAnnual: 0, hourlyRate: 40, hoursPerWeek: 30 }] };
        assert('a set-hours job counts', taxCardModel('2026-07-01', hours), { kind: 'july', fy: '2026-27' });
        const prev = { ...job(), taxCheck: { fy: '2025-26', done: true } };
        assert('a checked last year still shows on 1 July as before', taxCardModel('2026-07-01', prev), { kind: 'july', fy: '2026-27' });
        assert('and as before, nothing on 30 June', taxCardModel('2026-06-30', prev), null);
    } },
    { name: 'E10.11 the July card stays away with no payslip-job source', fn(assert) {
        const cases = {
            'self-employed': [{ incomeType: 'selfEmployed', grossAnnual: 0, invoicedPayPostTax: 940 }],
            variable: [{ incomeType: 'variable', incomeEvents: [] }],
            'salaried with no pay set': [{ incomeType: 'salaried', grossAnnual: 0 }],
        };
        for (const [name, incomeSources] of Object.entries(cases)) {
            assert(`${name}: no card on 1 July`, taxCardModel('2026-07-01', { incomeSources }), null);
            assert(`${name}: not a payslip job`, hasPayslipJob({ incomeSources }), false);
        }
        assert('no sources at all', [taxCardModel('2026-07-01', {}), taxCardModel('2026-07-01', null), hasPayslipJob(null)], [null, null, false]);
        assert('a payslip job among others counts', hasPayslipJob({ incomeSources: [null, { incomeType: 'variable' }, { incomeType: 'salaried', grossAnnual: 1 }] }), true);
        assert('the stale label is unchanged', taxCardModel('2027-08-01', { incomeSources: [{ incomeType: 'salaried', grossAnnual: 9 }] }).kind, 'stale');
    } },
];
