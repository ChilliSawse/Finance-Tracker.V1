// Test cases for the "scenario-answer-top" group (registered in src/test-registry.js), owner F8a.
// F8a.1 verdict follows the option, F8a.2 timeline labels, F8a.3 Plan for this. Pure, except F8a.4 (needs a document).
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { buildSampleHousehold } from '../../state/sample-data.js';
import { computeAnswer, defaultState, verdictFor, renderAnswer, customOption } from './answer-top.js';
import { placeLabels, landingDates, rowCount, timelineModel } from './timeline.js';
import {
    optionChanges, pushDate, fundInOrder, dropGoal, shrinkGoal, planScenario, goalsFromPlan, splitOffer,
} from './plan-for-this.js';
import { earningsThreeWays, planGoalsFromData } from '../../calc/goal-planner.js';
import { resolveAt, changeProblems } from '../../calc/scenario.js';
import { sanitizeScenario } from '../../state/scenarios.js';
import { netPerPayCents } from '../../calc/plan.js';

const TODAY = '2026-11-21';
const hasDom = typeof document !== 'undefined';

/** The mock's shape on the sample household: a concert, a bike and Japan, short of money on today's split. */
export function shortfallData() {
    const d = buildSampleHousehold(TODAY).data;
    d.bucketGoals = [
        { id: 'g-concert', parentId: 'b-smile', name: 'Concert', share: 0, cost: 500, saved: 500, due: '2026-12-13', order: 0, done: false },
        { id: 'g-bike', parentId: 'b-smile', name: 'New bike', share: 0, cost: 3000, saved: 0, due: '2027-03-01', order: 1, done: false },
        { id: 'g-japan', parentId: 'b-smile', name: 'Japan', share: 0, cost: 7500, saved: 0, due: '2027-06-01', order: 2, done: false },
    ];
    return d;
}

/** The same goals made small enough that the current split is already enough. */
export function onTrackData() {
    const d = shortfallData();
    d.bucketGoals = d.bucketGoals.map((g) => (g.id === 'g-japan' ? { ...g, cost: 800 } : g.id === 'g-bike' ? { ...g, cost: 400 } : g));
    return d;
}

/** A shortfall the Splurge cut alone can cover (so Cut, Mix and Earn it all differ). */
export function cuttableData() {
    const d = shortfallData();
    d.bucketGoals = d.bucketGoals.map((g) => (g.id === 'g-japan' ? { ...g, cost: 4500 } : g));
    return d;
}

const scenario = (changes = []) => ({ id: 'sc-test', name: 'Trip', changes, presetId: null });
const model = (d, optionId = 'mix', extra = {}) => {
    const st = { ...defaultState(), optionId, ...extra };
    return computeAnswer({ scenario: scenario(), data: d, today: TODAY }, st);
};

export const SCENARIO_ANSWER_TOP_TEST_CASES = [
    {
        name: 'F8a.1 the verdict follows the option card',
        fn(assert) {
            const d = cuttableData();
            const m = model(d, 'mix');
            assert('there is a shortfall to close', m.needs, true);
            const heads = ['cut', 'mix', 'earn'].map((id) => verdictFor(id, m).headline);
            assert('three different headlines', new Set(heads).size, 3);
            for (const id of ['cut', 'mix', 'earn']) {
                const mm = model(d, id);
                assert(`${id}: the top verdict is for the selected option`, mm.verdict.optionId, mm.selected.id);
                assert(`${id}: the selected option is the card's option`, mm.selected, mm.options[id]);
                assert(`${id}: the headline is verdictFor's`, mm.verdict.headline, verdictFor(id, mm).headline);
                assert(`${id}: green when it closes the gap`, mm.verdict.ok, true);
            }
            assert('Earn it says nothing about Splurge in its sentence', model(d, 'earn').verdict.say.key, 'f.wa.v.say.earn');
            assert('Cut says nothing about earning in its sentence', model(d, 'cut').verdict.say.key, 'f.wa.v.say.cut');
            assert('Mix says both', model(d, 'mix').verdict.say.key, 'f.wa.v.say.both');
            const c = model(d, 'custom', { cutCents: 5000 });
            assert('a slider cut is its own option', [c.selected.id, c.selected.cutCents], ['custom', 5000]);
            assert('custom matches the planner shape', c.selected, customOption(c.plan, 5000));
            const never = model(d, 'cut').plan;
            assert('the options all close exactly the gap', ['cut', 'mix', 'earn'].map((id) => m.options[id].cutCents + m.options[id].earnedCents), [never.gapAfterUnallocatedCents, never.gapAfterUnallocatedCents, never.gapAfterUnallocatedCents]);
        },
    },
    {
        name: 'F8a.1b on track, the first box says yes and no plan is needed',
        fn(assert) {
            const m = model(onTrackData(), 'mix');
            assert('no shortfall', [m.needs, m.plan.onTrack], [false, true]);
            assert('current split is fine', m.verdictNow.ok, true);
            assert('headline is the fits line', m.verdict.key, 'f.wa.v.fits');
            const s = model(shortfallData(), 'mix');
            assert('shortfall: current split is not yet', s.verdictNow.ok, false);
            assert('shortfall: the gap is named', s.verdictNow.headline.startsWith('Not yet: A$'), true);
        },
    },
    {
        name: 'F8a.2 timeline labels do not collide',
        fn(assert) {
            // two dates 4 days apart on a 400 day axis, 330 px wide
            const pts = [{ id: 'a', at: 100 / 400, widthPx: 44 }, { id: 'b', at: 104 / 400, widthPx: 44 }];
            const placed = placeLabels(pts, 330, 6);
            assert('different rows', placed[0].row !== placed[1].row, true);
            assert('the order of the points is kept', placed.map((p) => p.id), ['a', 'b']);
            // far apart labels share a row
            const far = placeLabels([{ id: 'a', at: 0.1 }, { id: 'b', at: 0.9 }], 330, 6);
            assert('far apart share row 0', far.map((p) => p.row), [0, 0]);
            // random inputs: no two labels in one row overlap (including the gap), all inside the axis
            let seed = 12345;
            const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
            let bad = 0; let outside = 0;
            for (let trial = 0; trial < 300; trial++) {
                const n = 2 + Math.floor(rnd() * 12);
                const axis = 200 + Math.floor(rnd() * 800);
                const gap = Math.floor(rnd() * 10);
                const list = Array.from({ length: n }, (_, i) => ({ id: i, at: rnd(), widthPx: 20 + Math.floor(rnd() * 60) }));
                const out = placeLabels(list, axis, gap);
                for (const p of out) if (p.left < -1e-9 || p.right > axis + 1e-9) outside++;
                for (let i = 0; i < out.length; i++) {
                    for (let j = i + 1; j < out.length; j++) {
                        if (out[i].row !== out[j].row) continue;
                        const apart = Math.max(out[i].left, out[j].left) - Math.min(out[i].right, out[j].right);
                        if (apart < gap - 1e-9) bad++;
                    }
                }
            }
            assert('no overlap in any row over 300 random sets', bad, 0);
            assert('every label stays inside the axis', outside, 0);
            assert('rowCount counts rows', rowCount(placed), 2);
            // landing dates
            const pays = Array.from({ length: 20 }, (_, i) => `2026-12-${String(1 + i).padStart(2, '0')}`).filter((x) => x <= '2026-12-31');
            const land = landingDates({
                goals: [{ id: 'g2', name: 'B', costCents: 1000, due: '2026-12-20' }, { id: 'g1', name: 'A', costCents: 500, due: '2026-12-10' }],
                fundsCents: 100, perPayCents: 200, payDates: pays,
            });
            assert('goals come back in due-date order', land.map((r) => r.id), ['g1', 'g2']);
            assert('A needs 400 at 200 a pay: the second pay', [land[0].state, land[0].date, land[0].late], ['lands', '2026-12-02', false]);
            assert('B needs 1400 at 200 a pay: the seventh pay', [land[1].date, land[1].late], ['2026-12-07', false]);
            const tl = timelineModel({ today: TODAY, now: land, plan: land });
            assert('the axis is at least 30 days', tl.span >= 30, true);
        },
    },
    {
        name: 'F8a.3 the three ways come from F4',
        fn(assert) {
            const d = shortfallData();
            for (const id of ['cut', 'mix', 'earn']) {
                const m = model(d, id);
                assert(`${id}: three ways are F4's`, m.threeWays, earningsThreeWays(m.plan.resolved, m.selected.earnedCents));
            }
            const m = model(d, 'earn');
            assert('before tax is more than take-home (tax, Medicare, HELP count)', m.threeWays.beforeTaxPerPayCents > m.threeWays.takeHomePerPayCents, true);
        },
    },
    {
        name: 'F8a.3b Plan for this saves the option and reopens with the same figures',
        fn(assert) {
            const real = JSON.parse(JSON.stringify(shortfallData()));
            for (const [fixture, id] of [['shortfall', 'cut'], ['shortfall', 'mix'], ['shortfall', 'earn'], ['cuttable', 'cut'], ['cuttable', 'mix'], ['cuttable', 'earn']]) {
                const d = fixture === 'shortfall' ? shortfallData() : cuttableData();
                const m = model(d, id);
                const o = m.selected;
                const oc = optionChanges({
                    data: d, resolved: m.plan.resolved, existing: [], option: o, threeWays: m.threeWays, items: m.splurgeItems, today: TODAY,
                    until: m.lastDue, neededPerPayCents: m.plan.requiredPerPayCents, withSplit: false,
                });
                assert(`${id}: every change is valid`, oc.changes.map((c) => changeProblems(c).length), oc.changes.map(() => 0));
                const after = resolveAt(d, oc.changes, TODAY);
                if (o.earnedCents > 0) {
                    const rise = netPerPayCents(after) - netPerPayCents(d);
                    assert(`${id}: the resolved income rises by the three-ways before-tax figure`,
                        Math.round((after.incomeSources[0].grossAnnual - d.incomeSources[0].grossAnnual) * 100), m.threeWays.beforeTaxPerYearCents);
                    assert(`${id}: and take-home rises by the option's earned figure (within a few cents)`, rise >= o.earnedCents && rise <= o.earnedCents + 5, true);
                } else {
                    assert(`${id}: no pay change when nothing is earned`, after.incomeSources[0].grossAnnual, d.incomeSources[0].grossAnnual);
                }
                if (o.cutCents > 0) {
                    const zeroed = oc.changes.filter((c) => c.kind === 'expense');
                    const cutSum = zeroed.reduce((s, c) => s + Math.round(c.baseValue * 100), 0);
                    assert(`${id}: the Splurge items given up cover the cut`, cutSum > 0, true);
                    assert(`${id}: expense changes only touch Splurge items`, zeroed.every((c) => m.splurgeItems.some((i) => i.id === c.target.id)), true);
                }
                // with the split, the saved scenario closes the gap on its own: the same figures come back
                const full = optionChanges({
                    data: d, resolved: m.plan.resolved, existing: [], option: o, threeWays: m.threeWays, items: m.splurgeItems, today: TODAY,
                    until: m.lastDue, neededPerPayCents: m.plan.requiredPerPayCents, withSplit: true,
                });
                const tag = `${fixture}/${id}`;
                assert(`${tag}: a split is offered only when nothing has to be earned`, full.split !== null, o.earnedCents <= 0);
                const sc = planScenario({ scenario: scenario(), changes: full.changes, label: 'Mix', today: TODAY });
                const saved = sanitizeScenario(sc);
                assert(`${tag}: saveScenario's sanitizer keeps every change`, [saved.dropped, saved.scenario.changes.length], [0, full.changes.length]);
                const again = planGoalsFromData(d, { today: TODAY, changes: saved.scenario.changes });
                if (o.earnedCents <= 0) assert(`${tag}: reopened, the goals are on time`, [again.gapCents, again.onTrack], [0, true]);
                else assert(`${tag}: reopened, the gap is smaller than before (the split waits for the rise)`, again.gapCents < m.plan.gapCents, true);
                const targets = saved.scenario.changes.map((c) => c.target && c.target.id);
                assert(`${tag}: nothing targets Daily or Fire extinguisher`, targets.includes('b-daily') || targets.includes('b-fire'), false);
                assert(`${tag}: the split moves only Smile and Splurge`, saved.scenario.changes.filter((c) => c.kind === 'split').map((c) => c.target.id).sort(), full.split ? ['b-smile', 'b-splurge'] : []);
            }
            const d = shortfallData();
            assert('the real data was not changed', d, real);
            const m = model(d, 'mix');
            const noMoney = splitOffer({ data: d, changes: [], neededPerPayCents: 1, today: TODAY });
            assert('no split when Smile already gets enough', noMoney, null);
            assert('a split that Splurge cannot pay for is not offered', splitOffer({ data: d, changes: [], neededPerPayCents: 99999999, today: TODAY }), null);
            assert('the saved scenario name carries the base name', planScenario({ scenario: scenario(), changes: [], label: 'Mix', today: TODAY }).name, 'Trip - Mix');
            assert('ids of the copied changes stay unique', new Set(planScenario({ scenario: scenario(m.changes), changes: [], label: 'x', today: TODAY }).changes.map((c) => c.id)).size, m.changes.length);
        },
    },
    {
        name: 'F8a.3c the one-tap options change the goal plan only through planGoals',
        fn(assert) {
            const d = shortfallData();
            const m = model(d, 'mix');
            const cut = m.options.mix.cutCents;
            const ctx = { plan: m.plan, payDates: m.payDates, today: TODAY };
            const goals = goalsFromPlan(m.plan);
            // push a date: only that goal's due moves
            const p = pushDate({ ...ctx, goalId: 'g-japan', cutCents: cut });
            assert('a later date is found', !!p && p.to > p.from, true);
            assert('it is a goal change on that goal alone', [p.spec.kind, p.spec.target.id, p.spec.field], ['goal', 'g-japan', 'due']);
            assert('the preview needs nothing extra after the cut', p.preview.gapCents <= cut, true);
            const moved = resolveAt(d, [{ ...p.spec, id: 'x1' }], TODAY);
            const dueNow = (data) => Object.fromEntries(data.bucketGoals.map((g) => [g.id, g.due]));
            assert('only that goal due moved', Object.entries(dueNow(moved)).filter(([k, v]) => v !== dueNow(d)[k]).map(([k]) => k), ['g-japan']);
            assert('the preview is the planner on the moved goals (same figures through planGoalsFromData)',
                planGoalsFromData(d, { today: TODAY, changes: [{ ...p.spec, id: 'x1' }] }).requiredPerPayCents, p.preview.requiredPerPayCents);
            assert('an earlier-than-needed date is refused: nothing found for the Earn option with a tiny horizon', pushDate({ ...ctx, payDates: [], goalId: 'g-japan', cutCents: 0 }), null);
            // drop a goal: only that goal leaves planGoals
            const dr = dropGoal({ ...ctx, goalId: 'g-bike' });
            assert('drop: a remove change on that goal', [dr.spec.kind, dr.spec.op, dr.spec.target.id], ['goal', 'remove', 'g-bike']);
            assert('drop: the others are all that is planned', dr.preview.perGoal.map((g) => g.id), goals.filter((g) => g.id !== 'g-bike').map((g) => g.id));
            const dropped = resolveAt(d, [{ ...dr.spec, id: 'x2' }], TODAY);
            assert('drop: only that goal is gone from the data', dropped.bucketGoals.map((g) => g.id), d.bucketGoals.filter((g) => g.id !== 'g-bike').map((g) => g.id));
            // shrink
            const sh = shrinkGoal({ ...ctx, goalId: 'g-japan', cutCents: cut });
            assert('shrink: a smaller cost that fits', !!sh && sh.toCents < sh.fromCents && sh.preview.gapCents <= cut, true);
            assert('shrink: sets only that goal cost', [sh.spec.target.id, sh.spec.field], ['g-japan', 'cost']);
            // fund in order
            const fo = fundInOrder({ ...ctx, cutCents: cut });
            assert('fund in order: a goalFund list in due-date order', fo.goalFund.map((r) => r.goalId), ['g-concert', 'g-bike', 'g-japan']);
            assert('fund in order: dues ascend', fo.goalFund.map((r) => r.due), fo.goalFund.map((r) => r.due).slice().sort());
            assert('fund in order: only late goals get a new date', fo.specs.map((s) => s.target.id), fo.goalFund.filter((r) => r.late).map((r) => r.goalId));
            assert('fund in order: nothing extra needed after the cut', fo.preview.gapCents <= cut, true);
            // none of them touches Daily or Fire
            const all = [p.spec, dr.spec, sh.spec, ...fo.specs];
            assert('no one-tap change targets an allocation row', all.every((s) => s.target.collection === 'bucketGoals'), true);
        },
    },
    {
        name: 'F8a.4 empty states and escaping',
        fn(assert) {
            const none = buildSampleHousehold(TODAY).data;
            none.bucketGoals = [];
            assert('no dated goal: nothing to plan', model(none).empty, 'noGoals');
            if (!hasDom) return;
            const d = shortfallData();
            d.bucketGoals[2].name = '<img src=x onerror="window.__f8a=1"> Japan';
            const box = document.createElement('div');
            document.body.appendChild(box);
            renderAnswer(box, { scenario: scenario(), data: d, today: TODAY });
            assert('no element was made from a goal name', box.querySelector('img'), null);
            assert('the name shows as text', box.textContent.includes('<img src=x'), true);
            assert('no script ran', window.__f8a, undefined);
            assert('the verdict is drawn', !!box.querySelector('.wa-verdict'), true);
            assert('three option cards', box.querySelectorAll('input.wa-radio').length, 3);
            box.querySelector('input.wa-radio[value="earn"]').click();
            assert('picking Earn it changes the top verdict', box.querySelector('.wa-verdict[data-verdict]').dataset.verdict, 'earn');
            box.remove();
        },
    },
];
