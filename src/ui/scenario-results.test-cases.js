// Test cases for the "scenario-results" group (registered in src/test-registry.js), owner F8b.
// F8b.1 to F8b.7 are pure (no DOM); F8b.8 and F8b.9 need a document and are no-ops in the Node runner.
// Shape: { name, fn(assert) }, assert(label, actual, expected).

import { t } from '../i18n/strings.js';
import { enF } from '../i18n/en-f.js';
import { starterSpec } from './scenario/starters.js';
import { buildResultSet, rowsForPreset, diffOf, bestOf, PRESETS, PRESET_ROWS, DEFAULT_PRESET } from './scenario/results.js';
import { columnsFor } from './scenario/compare.js';
import { explainLines } from './scenario/explain.js';
import { actionableSteps, incomeStepPlan, debtStepValues, isSheetStep } from './scenario/make-real.js';
import { resolveAt, makeRealPlan } from '../calc/scenario.js';
import { applyMakeReal } from '../state/scenarios.js';
import { fiSummary } from '../calc/fi.js';
import { planGoalsFromData } from '../calc/goal-planner.js';
import { netPerPayCents } from '../calc/plan.js';
import { buildSampleHousehold } from '../state/sample-data.js';
import { migrateAssetDebtDetail } from '../state/asset-debt-migration.js';

const TODAY = '2026-11-21';
const hasDom = typeof document !== 'undefined';
const base = () => { const d = buildSampleHousehold(TODAY).data; migrateAssetDebtDetail(d); return d; };
const smileOf = (d) => d.allocation.find((r) => r.role === 'smile');

function build(d, id, patch) {
    const spec = starterSpec(id, d, { changes: [] });
    return spec.build({ ...spec.values, ...patch });
}

/** A scenario touching pay (now), rent (later) and a new goal. */
function scenario(d) {
    const pay = build(d, 'pay', { sourceId: d.incomeSources[0].id, newGross: d.incomeSources[0].grossAnnual + 10000, pct: null, from: '' });
    const rent = build(d, 'expense', { target: 'item:p-rent', pct: 10, newAmount: null, from: '2027-02-01' });
    const goal = build(d, 'goal', { bucketId: smileOf(d).id, name: 'Japan', cost: 6000, due: '2027-06-01' });
    return [...pay, ...rent, ...goal];
}

export const SCENARIO_RESULTS_TEST_CASES = [
    {
        name: 'F8b.1 the result set comes from the engines',
        fn(assert) {
            const d = base();
            const changes = scenario(d);
            const set = buildResultSet(d, changes, TODAY);
            const row = (id) => set.rows.find((r) => r.id === id);
            assert('scenario date is the last start', set.date, '2027-02-01');
            const resolved = resolveAt(d, changes, set.date);
            assert('take-home now is the pay engine', row('takeHome').now.v, netPerPayCents(d));
            assert('take-home scenario is the pay engine on the resolved data', row('takeHome').scen.v, netPerPayCents(resolved));
            assert('pay rise lifts take-home', row('takeHome').scen.v > row('takeHome').now.v, true);
            const s = fiSummary(d, { today: TODAY, changes });
            assert('years to FI is F3', row('fiYears').scen.v, s.yearsToFI);
            const plan = planGoalsFromData(d, { today: TODAY, date: set.date, changes });
            assert('goals need each pay is F4', row('required').scen.v, plan.requiredPerPayCents);
            assert('short each pay is F4', row('short').scen.v, plan.gapCents);
            assert('the new goal has a row, absent on the Now side', [row(`goal:${changes[changes.length - 1].value.id}`).now.text, row(`goal:${changes[changes.length - 1].value.id}`).kind], ['Not in the plan', 'goal']);
            assert('cards: take-home is one', set.cards.some((c) => c.id === 'takeHome'), true);
            assert('card tints are bucket roles only', set.cards.every((c) => c.tint === null || ['daily', 'splurge', 'smile', 'fire'].includes(c.tint)), true);
            assert('no scenario, no change', diffOf(buildResultSet(d, [], TODAY).rows.find((r) => r.id === 'takeHome')).text, 'No change');
        },
    },
    {
        name: 'F8b.2 six presets, fixed',
        fn(assert) {
            const d = base();
            const set = buildResultSet(d, scenario(d), TODAY);
            assert('the six lenses in order', PRESETS, ['everyday', 'goals', 'safety', 'debt', 'decision', 'longRange']);
            assert('same six keys have rows listed', Object.keys(PRESET_ROWS), PRESETS);
            assert('default is Decision', DEFAULT_PRESET, 'decision');
            for (const p of PRESETS) assert(`${p}: chip word exists`, typeof t(`f.res.preset.${p}`) === 'string' && !t(`f.res.preset.${p}`).startsWith('f.res'), true);
            const ids = (p) => rowsForPreset(set, p).map((r) => r.id.split(':')[0]);
            assert('decision rows', ids('decision').filter((x, i, a) => a.indexOf(x) === i), ['takeHome', 'savingsRate', 'goal', 'fiYears', 'earnGap']);
            assert('long range has net worth in 1, 5, 10, 20 years', ids('longRange').filter((x) => x.startsWith('nw')), ['nw1', 'nw5', 'nw10', 'nw20']);
            assert('an unknown preset falls back to Decision', rowsForPreset(set, 'nope').length, rowsForPreset(set, 'decision').length);
        },
    },
    {
        name: 'F8b.3 Compare has two columns and Best is a word',
        fn(assert) {
            const d = base();
            const set = buildResultSet(d, scenario(d), TODAY);
            const cols = columnsFor(set, 'decision', true, 'Pay rise');
            assert('exactly two columns, Now and the scenario', cols.map((c) => [c.id, c.title]), [['now', 'Now'], ['scen', 'Pay rise']]);
            assert('same rows in both', cols[0].items.map((i) => i.rowId), cols[1].items.map((i) => i.rowId));
            const take = set.rows.find((r) => r.id === 'takeHome');
            assert('take-home: the higher side is Best', bestOf(take), 'scen');
            assert('Best flag follows the row', [cols[0].items.find((i) => i.rowId === 'takeHome').best, cols[1].items.find((i) => i.rowId === 'takeHome').best], [false, true]);
            const off = columnsFor(set, 'decision', false, 'x');
            assert('toggle off: no Best anywhere', off.flatMap((c) => c.items).some((i) => i.best), false);
            assert('a row with no better direction is never Best', set.rows.filter((r) => !r.better).every((r) => bestOf(r) === null), true);
            assert('the word is Best, not a colour', t('f.res.best.word'), 'Best');
            const keys = Object.keys(enF).filter((k) => k.startsWith('f.res.'));
            assert('no picker, saved columns or Advanced strings', keys.some((k) => /picker|saved|advanced|addScenario/i.test(k) || /add a scenario|advanced/i.test(enF[k])), false);
        },
    },
    {
        name: 'F8b.4 no figure is typed in',
        fn(assert) {
            const strings = Object.entries(enF).filter(([k]) => k.startsWith('f.res.'));
            assert('F8b catalogue is not empty', strings.length > 60, true);
            const bad = strings.filter(([, v]) => /\d/.test(String(v).replace(/\{[a-zA-Z]+\}/g, ''))).map(([k]) => k);
            assert('no digit in an F8b string outside a placeholder', bad, []);
            // Source scan (Node only): no A$ amount or four-digit year typed in the F8b modules.
            if (typeof process !== 'undefined' && process.versions && process.versions.node && !hasDom) {
                return Promise.all([import('node:fs'), import('node:url'), import('node:path')]).then(([fs, { fileURLToPath }, path]) => {
                    for (const f of ['results.js', 'explain.js', 'compare.js', 'make-real.js']) {
                        const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenario', f), 'utf8') // G6W15-8: not a URL glob, which Vite would bundle into dist/assets;
                        const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
                        assert(`${f}: no typed money`, /A\$\s?\d|\$\d/.test(code), false);
                        assert(`${f}: no typed date`, /['"`]20\d\d-\d\d-\d\d/.test(code), false);
                    }
                });
            }
            return undefined;
        },
    },
    {
        name: 'F8b.5 Explain this number',
        fn(assert) {
            const d = base();
            const set = buildResultSet(d, scenario(d), TODAY);
            for (const r of set.rows) assert(`${r.id}: has lines and no raw key`, explainLines(set, r.id).length >= 1 && explainLines(set, r.id).every((l) => !l.startsWith('f.res')), true);
            const req = explainLines(set, 'required');
            assert('goal figure carries F4 lines', req.some((l) => /still needed/.test(l)), true);
            assert('FI figure carries F3 lines', explainLines(set, 'fiYears').length > 3, true);
            assert('first line is Now against the scenario', explainLines(set, 'takeHome')[0].startsWith('Now: '), true);
            assert('unknown row', explainLines(set, 'nope'), []);
        },
    },
    {
        name: 'F8b.6 Make this real: now together, later one by one',
        fn(assert) {
            const d = base();
            const changes = scenario(d);
            const plan = makeRealPlan(d, changes, TODAY);
            const steps = actionableSteps(plan);
            assert('pay and goal start now', steps.now.map((s) => s.route).sort(), ['goal', 'income']);
            assert('rent starts later, alone', steps.later.map((s) => [s.route, s.changes.length]), [['plan', 1]]);
            assert('pay is a sheet step, goal is not', [isSheetStep(steps.now.find((s) => s.route === 'income')), isSheetStep(steps.now.find((s) => s.route === 'goal'))], [true, false]);
            const pay = incomeStepPlan(d, steps.now.find((s) => s.route === 'income'));
            const src = d.incomeSources[0];
            const hourly = Number(src.hourlyRate) > 0 && Number(src.hoursPerWeek) > 0;
            const gross = hourly ? pay.prefill.hourlyRate * src.hoursPerWeek * 52 : pay.prefill.amount;
            assert('pay sheet opens pre-filled with the new gross (a rate when paid by the hour)', [pay.index, Math.abs(gross - (src.grossAnnual + 10000)) <= src.hoursPerWeek * 52 * 0.005 + 1, pay.add], [0, true, null]);
            const flat = incomeStepPlan({ ...d, incomeSources: [{ ...src, hourlyRate: null, hoursPerWeek: null }] }, steps.now.find((s) => s.route === 'income'));
            assert('a salaried source is pre-filled with the amount', flat.prefill.amount, src.grossAnnual + 10000);
        },
    },
    {
        name: 'F8b.7 apply and Undo restore the data exactly',
        fn(assert) {
            const d = base();
            const before = JSON.stringify(d);
            const changes = scenario(d);
            const plan = makeRealPlan(d, changes, TODAY);
            const direct = plan.now.filter((s) => !isSheetStep(s));
            const res = applyMakeReal(d, direct);
            assert('the goal step applied, none failed', [res.applied.length, res.failed.length], [1, 0]);
            assert('data changed', JSON.stringify(d) === before, false);
            assert('one combined undo payload', typeof res.onUndo, 'function');
            res.onUndo();
            assert('Undo puts every byte back', JSON.stringify(d), before);
            const later = applyMakeReal(d, plan.later);
            const rent = d.plan.find((p) => p.id === 'p-rent');
            const wasRent = JSON.parse(before).plan.find((p) => p.id === 'p-rent');
            assert('a later step applies on its own', [later.applied.length, rent.amount > wasRent.amount], [1, true]);
            later.onUndo();
            assert('Undo of the later step restores too', JSON.stringify(d), before);
        },
    },
    {
        name: 'F8b.8 loan and new income steps',
        fn(assert) {
            const d = base();
            const loan = build(d, 'loan', { name: 'Bike loan', balance: 8000, interestRate: 9, interestType: 'variable', compounding: 'monthly', repaymentFrequency: 'monthly', minRepayment: 250, label: '' });
            const plan = makeRealPlan(d, loan, TODAY);
            assert('a loan is a sheet step', plan.now.map((s) => s.route), ['debt']);
            const v = debtStepValues({ values: { name: '' }, fields: [{ key: 'name' }, { key: 'balance' }, { key: 'zzz' }] }, loan[0].value);
            assert('loan sheet gets the change values for its own fields', [v.name, v.balance, 'zzz' in v], ['Bike loan', 8000, false]);
            const extra = build(d, 'extra', { name: 'Weekend market', gross: 6000, schedule: 'monthly' });
            const ip = incomeStepPlan(d, makeRealPlan(d, extra, TODAY).now[0]);
            assert('new income opens at the end of the list with its row', [ip.index, ip.add.name, ip.add.grossAnnual], [d.incomeSources.length, 'Weekend market', 6000]);
        },
    },
    {
        name: 'F8b.9 hostile text stays text (browser only)',
        fn(assert) {
            if (!hasDom) return undefined;
            return Promise.all([import('./scenario/results.js'), import('./scenario/compare.js')]).then(([res, cmp]) => {
                const d = base();
                d.bucketGoals = [{ id: 'g-x', parentId: smileOf(d).id, name: '<img src=x onerror=alert(1)>', cost: 500, due: '2027-03-01' }];
                const sc = { id: 's1', name: '<b id="pwn">x</b>', changes: scenario(d) };
                const box = document.createElement('div');
                res.renderAnswerBottom(box, { scenario: sc, data: d, today: TODAY });
                assert('answer: no element made from names', box.querySelector('img, #pwn'), null);
                const box2 = document.createElement('div');
                cmp.renderCompare(box2, { scenario: sc, data: d, today: TODAY });
                assert('compare: no element made from names', box2.querySelector('img, #pwn'), null);
                assert('compare shows two columns and six chips', [box2.querySelectorAll('.col').length, box2.querySelectorAll('.chip').length], [2, 6]);
                assert('toggle reads as a word', box2.querySelector('.toggle').textContent, 'Best on each row');
            });
        },
    },
];
