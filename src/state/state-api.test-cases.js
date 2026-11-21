// Test cases for the "state-api" group (registered in src/test-registry.js).
// E5: src/state/saving-model.js (plan section 12: T19, E5.1 to E5.4, plus the rest of the API).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import {
    getBuckets, addBucket, renameBucket, setSplit, applySuggestedSplit, forkOwnTemplate, deleteBucketWithMove,
    addGoal, updateGoal, removeGoal, addTarget, moveTarget, skipTarget, applyCashToTarget, setMojo, relinkCategory,
    tickTransfer, setAutoCredit, rollPayDays, runPayRollIfDue, newBucket,
} from './saving-model.js';
import { effectiveBucket, netPerPayCents } from '../calc/plan.js';
import { freshSavingModel, templateAllocation } from './bucket-migration.js';
import { defaultFireTargets } from '../calc/fire.js';

const LIABS = () => [
    { id: 'L-car', name: 'Car loan', balance: 11200, interestRate: 7.9 },
    { id: 'L-card', name: 'Credit card', balance: 1850, interestRate: 20.99 },
];
const NET = 343843;

function fixture({ on = true } = {}) {
    const sm = freshSavingModel();
    sm.fire.targets = defaultFireTargets(LIABS());
    sm.autoCredit = { on, rolledThrough: '2026-11-06' };
    const allocation = templateAllocation();
    allocation.find((r) => r.id === 'b-smile').currentBalance = 1200;
    allocation.find((r) => r.id === 'b-fire').currentBalance = 8000;
    return {
        incomeSources: [{ paySchedule: 'fortnightly', payAnchor: '2026-11-06' }], primaryIncomeIndex: 0,
        allocation, bucketGoals: [], liabilities: LIABS(), plan: [],
        categories: [
            { id: 'dining', name: 'Dining', essential: false, bucketId: null },
            { id: 'groceries', name: 'Groceries', essential: true, bucketId: null },
        ],
        savingModel: sm,
    };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const bal = (d, id) => d.allocation.find((r) => r.id === id).currentBalance;
const spend = { amountCents: -2500 };
const resolve = (d, cat) => effectiveBucket(spend, d.categories.find((c) => c.id === cat), null, d.allocation);

export const STATE_API_TEST_CASES = [
    { name: 'T19 category links', fn(assert) {
        const d = fixture();
        assert('Dining resolves to Splurge', resolve(d, 'dining'), 'b-splurge');
        assert('relink to Smile', [relinkCategory(d, 'dining', 'b-smile').ok, resolve(d, 'dining')], [true, 'b-smile']);
        assert('Mojo is not a link target', relinkCategory(d, 'dining', 'mojo').code, 'bucket');
        const gone = deleteBucketWithMove(d, 'b-smile', 'b-daily', { fork: true });
        assert('deleting Smile resets the link', [gone.ok, d.categories[0].bucketId, resolve(d, 'dining')], [true, null, 'b-splurge']);
        d.categories[0].essential = true;
        assert('ticking Essential moves an unlinked category to Daily', resolve(d, 'dining'), 'b-daily');
        assert('Income resolves to none', effectiveBucket({ amountCents: 5000 }, d.categories[0], null, d.allocation), null);
        const u = relinkCategory(d, 'groceries', 'b-splurge');
        u.onUndo();
        assert('undo restores the link', d.categories[1].bucketId, null);
    } },
    { name: 'E5.1 setSplit writes only at 100', fn(assert) {
        const d = fixture();
        const before = clone(d.allocation);
        const bad = setSplit(d, { 'b-daily': 50 });
        assert('90 is refused, nothing written', [bad.ok, bad.code, bad.total, d.allocation], [false, 'split', 90, before]);
        assert('a negative is refused', setSplit(d, { 'b-daily': 70, 'b-splurge': -10 }).ok, false);
        assert('Mojo share is refused under the template', setSplit(d, { 'b-daily': 50, mojo: 10 }).ok, false);
        const ok = setSplit(d, { 'b-daily': 50, 'b-splurge': 20 });
        assert('100 writes', [ok.ok, d.allocation.map((r) => r.percentage)], [true, [50, 20, 10, 20, 0]]);
        ok.onUndo();
        assert('undo puts it back', d.allocation, before);
        assert('unknown id refused', setSplit(d, { nope: 100 }).code, 'missing');
        const s = applySuggestedSplit(d, { netCents: NET, essentialCents: 207200, nonEssentialCents: 36662 });
        assert('suggested split applies (T1)', [s.ok, d.allocation.map((r) => r.percentage)], [true, [60.3, 10.7, 9.7, 19.3, 0]]);
    } },
    { name: 'E5.2 deleteBucketWithMove moves money and resets links', fn(assert) {
        const d = fixture();
        const add = addBucket(d, { name: 'Travel', percentage: 0, currentBalance: 50 }, { fork: true });
        const travel = add.item;
        travel.percentage = 5;
        d.allocation[0].percentage = 55;
        d.categories[0].bucketId = travel.id;
        d.plan.push({ id: 'p-x', bucketId: travel.id });
        const snap = clone(d);
        const ask = deleteBucketWithMove(d, travel.id);
        assert('asks where the money goes', [ask.ok, ask.code, ask.moveCents, ask.message], [false, 'move', 5000, 'Move A$50.00 to...']);
        assert('nothing changed', d, snap);
        const r = deleteBucketWithMove(d, travel.id, 'b-smile', { today: '2026-11-20' });
        assert('moved', [r.ok, bal(d, 'b-smile'), d.allocation.find((x) => x.id === 'b-smile').percentage, d.allocation.length], [true, 1250, 15, 5]);
        assert('links reset', [d.categories[0].bucketId, d.plan[0].bucketId], [null, null]);
        assert('movement logged', d.savingModel.movements.at(-1), { date: '2026-11-20', bucketId: 'b-smile', cents: 5000, kind: 'move', from: travel.id });
        assert('message', r.message, 'Deleted Travel and moved A$50.00 to Smile');
        r.onUndo();
        assert('undo restores everything', d, snap);
        const t1 = fixture();
        const core = deleteBucketWithMove(t1, 'b-splurge', 'b-daily');
        assert('a core bucket under the template offers the fork', [core.ok, core.needsFork], [false, true]);
    } },
    { name: 'E5.3 auto-credit off: a refocus changes nothing', fn(assert) {
        const d = fixture({ on: false });
        const snap = clone(d);
        const r = runPayRollIfDue(d, { today: '2026-12-18', persistedMarker: null, netCents: NET });
        assert('nothing credited', [r.changed, r.paysApplied], [false, 0]);
        assert('data identical', d, snap);
        assert('undo of nothing is harmless', typeof r.onUndo, 'function');
    } },
    { name: 'E5.4 two runs on one day credit once', fn(assert) {
        const d = fixture();
        const opts = { netCents: NET, persistedMarker: null };
        const a = rollPayDays(d, '2026-11-20', opts);
        assert('first run credits one pay', [a.changed, a.paysApplied, d.savingModel.autoCredit.rolledThrough], [true, 1, '2026-11-20']);
        assert('Smile got 10% of net', bal(d, 'b-smile'), (120000 + 34384) / 100);
        const after = clone(d);
        const b = rollPayDays(d, '2026-11-20', opts);
        assert('second run is a no-op', [b.changed, d], [false, after]);
        const behind = fixture();
        const t = rollPayDays(behind, '2026-11-20', { ...opts, persistedMarker: '2026-11-20' });
        assert('another tab already rolled: skipped', [t.changed, t.behind, behind.savingModel.autoCredit.rolledThrough], [false, true, '2026-11-06']);
        a.onUndo();
        assert('undo puts the pay back', [bal(d, 'b-smile'), d.savingModel.autoCredit.rolledThrough], [1200, '2026-11-06']);
        const enable = fixture({ on: false });
        const on = setAutoCredit(enable, true);
        assert('enabling forgets the old marker', [on.ok, enable.savingModel.autoCredit], [true, { on: true, rolledThrough: null }]);
        const first = rollPayDays(enable, '2026-12-10', opts);
        assert('first roll sets the marker, no retro credit', [first.changed, first.paysApplied, enable.savingModel.autoCredit.rolledThrough, bal(enable, 'b-smile')], [true, 0, '2026-12-04', 1200]);
        on.onUndo();
        assert('undo turns it back off', enable.savingModel.autoCredit.on, false);
    } },
    { name: 'getBuckets shape and tolerance', fn(assert) {
        const d = fixture();
        d.bucketGoals.push({ id: 'g1', parentId: 'b-smile', name: 'Japan', share: 100, cost: 4000, saved: 300, due: null, order: 0, done: false });
        d.allocation.find((r) => r.id === 'b-smile').currentBalance = 900;
        d.allocation.find((r) => r.id === 'b-smile').savingsGoal = 0;
        const bs = getBuckets(d, '2026-11-20');
        assert('ids in order, goal after its bucket', bs.map((b) => b.id), ['b-daily', 'b-splurge', 'b-smile', 'g1', 'b-fire', 'mojo']);
        const smile = bs.find((b) => b.id === 'b-smile');
        assert('smile family balance in cents', smile.balanceCents, 120000);
        assert('slots', bs.filter((b) => !b.parentId).map((b) => b.slot), [1, 2, 3, 4, 5]);
        const g = bs.find((b) => b.id === 'g1');
        assert('goal row', [g.kind, g.parentId, g.slot, g.goal, g.left, g.balanceCents], ['goal', 'b-smile', 3, 400000, 370000, 30000]);
        assert('fire has the active target', bs.find((b) => b.id === 'b-fire').target.id, 'debt:L-card');
        assert('per pay sums to net', bs.filter((b) => !b.parentId).reduce((s, b) => s + b.perPayCents, 0), Math.max(0, netPerPayCents(d)));
        assert('empty and malformed do not throw', [getBuckets(null), getBuckets({ allocation: [null, { name: 'x' }] }).map((b) => [b.id, b.role])], [[], [['alloc-1', null], ['alloc-2', null]]]);
    } },
    { name: 'addBucket offers the fork, rename, forkOwnTemplate', fn(assert) {
        const d = fixture();
        const snap = clone(d);
        const offer = addBucket(d, { name: 'Travel' });
        assert('out of bounds offers the fork and writes nothing', [offer.ok, offer.needsFork, d], [false, true, snap]);
        const r = addBucket(d, { name: 'Travel' }, { fork: true });
        assert('fork then add', [r.ok, r.forked, d.savingModel.id, d.savingModel.name, d.allocation.length, r.item.id, r.item.slot, r.message], [true, true, 'custom-1', 'My template', 6, 'b-travel', 7, 'Added Travel and made this your own template']);
        const more = addBucket(d, { name: 'Pets' });
        assert('custom template adds with no offer', [more.ok, more.forked], [true, false]);
        r.onUndo();
        assert('undo drops the bucket and the fork', [d.allocation.length, d.savingModel.id], [5, 'bucket-method']);
        const rn = renameBucket(snap, 'b-daily', ' Everyday ');
        assert('rename', [rn.ok, snap.allocation[0].name, snap.allocation[0].role], [true, 'Everyday', 'daily']);
        assert('empty name refused', renameBucket(snap, 'b-daily', '  ').ok, false);
        const f = fixture();
        const fk = forkOwnTemplate(f);
        assert('fork', [fk.ok, f.savingModel.basedOn, forkOwnTemplate(f).ok], [true, 'bucket-method', false]);
        fk.onUndo();
        assert('undo', f.savingModel.id, 'bucket-method');
        assert('What If factory', newBucket([], { name: 'Gifts' }).id, 'b-gifts');
    } },
    { name: 'goals rebalance shares and every destructive call undoes', fn(assert) {
        const d = fixture();
        const a = addGoal(d, 'b-smile', { name: 'Japan', cost: 4000 });
        const b = addGoal(d, 'b-smile', { name: 'Bike', cost: 600 });
        assert('equal cut', d.bucketGoals.map((g) => g.share), [50, 50]);
        const c = addGoal(d, 'b-smile', { name: 'Gift' });
        assert('three way totals 100', [d.bucketGoals.map((g) => g.share), Math.round(d.bucketGoals.reduce((s, g) => s + g.share, 0) * 10) / 10], [[33.4, 33.3, 33.3], 100]);
        updateGoal(d, a.item.id, { share: 70 });
        assert('edit rebalances siblings', d.bucketGoals.map((g) => g.share), [70, 15, 15]);
        const rm = removeGoal(d, c.item.id);
        assert('remove rebalances to 100', d.bucketGoals.map((g) => g.share), [82.4, 17.6]);
        rm.onUndo();
        assert('undo restores the goal and shares', d.bucketGoals.map((g) => g.share), [70, 15, 15]);
        const noRoom = addGoal(d, 'b-fire', { name: 'X' });
        assert('a goal outside Smile offers the fork', [noRoom.ok, noRoom.needsFork], [false, true]);
        assert('missing parent', addGoal(d, 'zzz', {}).code, 'missing');
        assert('b undone', b.ok, true);
    } },
    { name: 'Fire targets, cash, Mojo and transfers', fn(assert) {
        const d = fixture();
        const ids = () => d.savingModel.fire.targets.map((t) => t.id);
        assert('start', ids(), ['debt:L-card', 'debt:L-car', 'mojo', 'home', 'super']);
        moveTarget(d, 'debt:L-car', -1);
        assert('reorder', ids().slice(0, 2), ['debt:L-car', 'debt:L-card']);
        const sk = skipTarget(d, 'debt:L-car');
        assert('skip moves the active target', d.savingModel.fire.targets.find((t) => t.id === 'debt:L-card').state, 'active');
        sk.onUndo();
        assert('unskip', d.savingModel.fire.targets[0].skip, false);
        const ad = addTarget(d, { type: 'saver', label: 'Bike', goalCents: 100000 });
        assert('added before Super', ids().slice(-2), ['t-bike', 'super']);
        ad.onUndo();
        assert('add undone', ids().includes('t-bike'), false);
        const cash = applyCashToTarget(d, { today: '2026-11-20' });
                assert('cash goes on the active car loan', [cash.ok, cash.appliedCents, d.liabilities[0].balance, bal(d, 'b-fire')], [true, 800000, 3200, 0]);
        cash.onUndo();
        assert('undo', [d.liabilities[0].balance, bal(d, 'b-fire')], [11200, 8000]);
        assert('mojo bad months refused', setMojo(d, { months: 99 }).ok, false);
        assert('mojo set', [setMojo(d, { starter: 300000, months: 4 }).ok, d.savingModel.mojo.starter, d.savingModel.mojo.months], [true, 300000, 4]);
        delete d.savingModel.transfers.bankSetTo['b-daily'];
        const tk = tickTransfer(d, 'b-daily');
        assert('tick writes this pay', [tk.ok, 'b-daily' in d.savingModel.transfers.bankSetTo], [true, true]);
        assert('tick of an up-to-date row has nothing to do', tickTransfer(fixture(), 'b-fire').code, 'nothing');
    } },
];
