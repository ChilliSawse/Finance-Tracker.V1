// Test cases for the "plan-buckets" group (E6, registered in src/test-registry.js).
// The sample is the legacy sample household piped through the migration chain, as sample-data.js does
// until B5 rebuilds it: its stored split is still 60 / 10 / 10 / 20, so the tiles show those and the
// suggestion (and the nudge) carries the expenses-first figures 60.3 / 10.7 / 9.7 / 19.3.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { legacySampleFinanceData } from '../state/sample-data.js';
import { runMigrationChain } from '../state/migration-chain.js';
import { getBuckets } from '../state/saving-model.js';
import { buildBucketsModel, buildBucketsHtml, dispatchBucketAction, splitSheetSpec } from './plan-buckets.js';

const TODAY = '2026-11-21';
const sample = () => {
    const d = legacySampleFinanceData();
    runMigrationChain(d, { raw: null, source: 'load', storage: null });
    return d;
};
const html = (d, ui) => buildBucketsHtml(buildBucketsModel(d, TODAY, {}), ui || {});
const has = (s, part) => s.includes(part);
const topPcts = (d) => getBuckets(d, TODAY).filter((b) => !b.parentId && b.role !== 'mojo').map((b) => b.pct);

export const PLAN_BUCKETS_TEST_CASES = [
    { name: 'E6.1 sample tiles and the suggested split', fn(assert) {
        const d = sample();
        const m = buildBucketsModel(d, TODAY, {});
        assert('tiles are what getBuckets gives', m.tiles.map((t) => t.pct), topPcts(d));
        assert('the suggestion is the dagger figures', [m.suggestion.daily, m.suggestion.splurge, m.suggestion.smile, m.suggestion.fire], [60.3, 10.7, 9.7, 19.3]);
        assert('the nudge offers the suggestion', m.nudge, { daily: 60.3, splurge: 10.7, smile: 9.7, fire: 19.3 });
        const h = html(d);
        assert('nudge text carries the figures', [has(h, '60.3%'), has(h, '10.7%'), has(h, '9.7%'), has(h, '19.3%')], [true, true, true, true]);
        const applied = dispatchBucketAction(d, 'use-suggested');
        assert('Use these writes the suggestion', [applied.res.ok, ...topPcts(d)], [true, 60.3, 10.7, 9.7, 19.3]);
        const h2 = html(d);
        assert('tiles now show the suggested figures', [has(h2, '>60.3%<'), has(h2, '>10.7%<'), has(h2, '>9.7%<'), has(h2, '>19.3%<')], [true, true, true, true]);
        assert('the nudge is gone once applied', buildBucketsModel(d, TODAY, {}).nudge, null);
    } },
    { name: 'E6.2 no literal figures, slot colours only', fn(assert) {
        const d = sample();
        const h = html(d);
        assert('classes are slot classes', has(h, 'class="pb-tile k1"') && has(h, 'class="pb-tile k4"'), true);
        assert('no colour literal in markup', /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(h.replace(/&#\d+;/g, '')), false);
        const d2 = sample();
        d2.allocation.find((r) => r.role === 'daily').percentage = 50;
        d2.allocation.find((r) => r.role === 'splurge').percentage = 20;
        assert('changing the data changes the tiles', has(html(d2), '>50%<') && has(html(d2), '>20%<'), true);
    } },
    { name: 'E6.3 escaping', fn(assert) {
        const d = sample();
        d.allocation.find((r) => r.role === 'daily').name = '<img src=x onerror=alert(1)>';
        d.categories[0].name = '"><script>x</script>';
        const h = html(d, { moving: d.categories[0].id });
        assert('no raw tag from a bucket or category name', [has(h, '<img'), has(h, '<script>'), has(h, '&lt;img')], [false, false, true]);
    } },
    { name: 'E6.4 first-run card, auto-credit question, My template', fn(assert) {
        const d = sample();
        const m = buildBucketsModel(d, TODAY, {});
        assert('migrated data shows the first-run card with auto-credit off', [!!m.firstRun, m.firstRun && m.firstRun.autoOn], [true, false]);
        const yes = dispatchBucketAction(d, 'auto-yes');
        assert('Yes turns auto-credit on and closes the card', [yes.res.ok, d.savingModel.autoCredit.on, buildBucketsModel(d, TODAY, {}).firstRun], [true, true, null]);
        const no = sample();
        dispatchBucketAction(no, 'auto-no');
        assert('No keeps it off and closes the card', [no.savingModel.autoCredit.on, buildBucketsModel(no, TODAY, {}).firstRun], [false, null]);
        const own = sample();
        const offer = dispatchBucketAction(own, 'make-mine');
        assert('Make it mine forks', [offer.res.ok, buildBucketsModel(own, TODAY, {}).template.custom], [true, true]);
        const h = html(own);
        assert('My template card shows, with a path back while the data fits', [has(h, 'pb-owncard'), has(h, 'data-pb="switch-back"')], [true, true]);
        own.allocation.push({ id: 'b-x', name: 'Holiday', percentage: 0, currentBalance: 0, role: null, kind: 'save', slot: 7 });
        const h2 = html(own);
        assert('an extra bucket explains why switching back is off', [has(h2, 'data-pb="switch-back"'), has(h2, 'an extra bucket')], [false, true]);
        const sb = dispatchBucketAction(own, 'switch-back');
        assert('a refused switch back changes nothing', [sb.res.ok, buildBucketsModel(own, TODAY, {}).template.custom], [false, true]);
    } },
    { name: 'E6.5 template data: out-of-template add is offered, not blocked', fn(assert) {
        const d = sample();
        const m = buildBucketsModel(d, TODAY, {});
        assert('template mode has the offer box', has(html(d), 'Make this your own template?'), true);
        assert('five buckets, named from the rules', m.template.coreCount, 5);
        assert('the offer has a Make it mine button', has(html(d), 'data-pb="make-mine"'), true);
    } },
    { name: 'E6.6 category chips and Move to', fn(assert) {
        const d = sample();
        const m = buildBucketsModel(d, TODAY, {});
        const daily = m.tiles.find((t) => t.role === 'daily');
        const splurge = m.tiles.find((t) => t.role === 'splurge');
        assert('essentials sit on Daily, the rest on Splurge', [daily.cats.some((c) => c.id === 'groceries'), splurge.cats.some((c) => c.id === 'dining'), daily.cats.some((c) => c.id === 'income')], [true, true, false]);
        const h = html(d, { moving: 'dining' });
        assert('the chip opens a Move to row with the other buckets', has(h, 'data-pb="move-cat" data-cat="dining"'), true);
        const smileId = d.allocation.find((x) => x.role === 'smile').id;
        const r = dispatchBucketAction(d, 'move-cat', { cat: 'dining', bucket: smileId });
        assert('moving relinks the category', [r.res.ok, d.categories.find((c) => c.id === 'dining').bucketId], [true, smileId]);
        const m2 = buildBucketsModel(d, TODAY, {});
        assert('the chip follows it, marked as linked', m2.tiles.find((t) => t.role === 'smile').cats.map((c) => [c.id, c.explicit]), [['dining', true]]);
        const back = dispatchBucketAction(d, 'move-cat', { cat: 'dining', bucket: '' });
        assert('following the Essential tick again clears it', [back.res.ok, d.categories.find((c) => c.id === 'dining').bucketId], [true, null]);
        assert('Mojo is not a place to move to', buildBucketsModel(d, TODAY, {}).linkable.some((b) => b.name === 'Mojo'), false);
    } },
    { name: 'E6.7 Fire list: order, move, skip, add, Mojo note', fn(assert) {
        const d = sample();
        const f = buildBucketsModel(d, TODAY, {}).fire;
        assert('list order: pot, debts smallest first, Mojo, Home, Super', f.rows.map((r) => r.type), ['saver', 'debt', 'debt', 'mojo', 'home', 'super']);
        assert('one active target', f.rows.filter((r) => r.state === 'active').length, 1);
        assert('Mojo under the starter shows the note', [f.note, has(html(d), 'Mojo is under')], ['mojo-under-starter', true]);
        const id = f.rows[1].id;
        assert('move up swaps', [dispatchBucketAction(d, 'fire-up', { id }).res.ok, buildBucketsModel(d, TODAY, {}).fire.rows[0].id], [true, id]);
        assert('skip skips', [dispatchBucketAction(d, 'fire-skip', { id, skip: '1' }).res.ok, buildBucketsModel(d, TODAY, {}).fire.rows[0].state], [true, 'skipped']);
        assert('add opens a sheet', dispatchBucketAction(d, 'fire-add-pot').sheet.kind, 'target-pot');
        const h = html(d);
        assert('controls are labelled', has(h, 'aria-label="Move Credit card down"') && has(h, 'aria-label="Skip Car loan"'), true);
        const d2 = sample();
        d2.allocation.find((r) => r.role === 'mojo').currentBalance = 2500;
        assert('no note at or over the starter', buildBucketsModel(d2, TODAY, {}).fire.note, null);
    } },
    { name: 'E6.8 transfers card', fn(assert) {
        const d = sample();
        assert('seeded to today: card hidden', buildBucketsModel(d, TODAY, {}).transfers.length, 0);
        dispatchBucketAction(d, 'use-suggested');
        const m = buildBucketsModel(d, TODAY, {});
        assert('a split change lists the changed buckets', m.transfers.length > 0 && has(html(d), 'Bank transfers to update'), true);
        const one = m.transfers.find((r) => !r.informational);
        dispatchBucketAction(d, 'tick', { id: one.bucketId });
        assert('ticking removes that row', buildBucketsModel(d, TODAY, {}).transfers.some((r) => r.bucketId === one.bucketId), false);
        dispatchBucketAction(d, 'tick-all');
        assert('Done, hide this clears the card', buildBucketsModel(d, TODAY, {}).transfers.length, 0);
    } },
    { name: 'E6.9 Mojo ladder and Housing check (neutral)', fn(assert) {
        const d = sample();
        const m = buildBucketsModel(d, TODAY, {});
        assert('ladder: starter then months, one active step', [m.mojo.steps.map((s) => s.kind), m.mojo.steps.filter((s) => s.active).length], [['starter', 'months'], 1]);
        assert('housing reads the plan: 32.6% of take-home', [m.housing.pctOfTakeHome, m.housing.tone], [32.6, 'neutral']);
        const h = html(d);
        const house = h.slice(h.indexOf('pb-house'));
        assert('housing is never red or warned', /warn|neg|late|danger/.test(house.slice(0, house.indexOf('</section>'))), false);
        d.plan = d.plan.filter((p) => p.categoryId !== 'housing');
        assert('no housing item, no card', has(html(d), 'Housing check'), false);
    } },
    { name: 'E6.10 Smile goals, families and the one-tap hint', fn(assert) {
        const d = sample();
        d.incomeSources[0].paySchedule = 'fortnightly';
        d.incomeSources[0].payAnchor = '2025-11-14';
        d.bucketGoals = [
            { id: 'g-c', parentId: 'smile-holiday-fund', name: 'Concert', share: 15, cost: 500, saved: 380, due: '2025-12-13', order: 0, done: false },
            { id: 'g-b', parentId: 'smile-holiday-fund', name: 'New bike', share: 15, cost: 1000, saved: 420, due: '2026-03-28', order: 1, done: false },
            { id: 'g-j', parentId: 'smile-holiday-fund', name: 'Japan', share: 70, cost: 2500, saved: 0, due: '2026-06-30', order: 2, done: false },
            { id: 'g-jf', parentId: 'g-j', name: 'Flights', share: 50, cost: 1400, saved: 420, due: null, order: 0, done: false },
            { id: 'g-jh', parentId: 'g-j', name: 'Hotels', share: 50, cost: 1100, saved: 323.84, due: null, order: 1, done: false },
        ];
        d.allocation.find((r) => r.role === 'smile').currentBalance = 0;
        const m = buildBucketsModel(d, '2025-11-13', {});
        const g = m.groups.find((x) => x.role === 'smile');
        assert('three goals, Japan holds two kids', [g.items.map((i) => i.name), g.items[2].kids.map((k) => k.name)], [['Concert', 'New bike', 'Japan'], ['Japan › Flights', 'Japan › Hotels']]);
        assert('the kids use the family shades', has(buildBucketsHtml(m, {}), 'k3-s1') && has(buildBucketsHtml(m, {}), 'k3-s2'), true);
        assert('a goal has a smilePlan status', typeof g.items[0].plan.status, 'string');
        if (g.hint && g.hint.kind === 'move') {
            const r = dispatchBucketAction(d, 'hint-apply', { parent: g.id }, { today: '2025-11-13' });
            assert('the hint is one tap and the shares still total 100', [r.res.ok, Math.round(d.bucketGoals.filter((x) => x.parentId === g.id).reduce((a, x) => a + x.share, 0))], [true, 100]);
        } else {
            assert('no move hint without a late goal', !g.hint || g.hint.kind === 'raise', true);
        }
    } },
    { name: 'E6.11 split sheet spec and no model', fn(assert) {
        const d = sample();
        const spec = splitSheetSpec(d, TODAY);
        assert('one percent field per bucket that can hold a share', spec.fields.length, 4);
        assert('values total 100', spec.fields.reduce((s, f) => s + spec.values[f.key], 0), 100);
        assert('no saving model renders nothing', buildBucketsHtml(buildBucketsModel({ allocation: [] }, TODAY, {}), {}), '');
    } },
];
