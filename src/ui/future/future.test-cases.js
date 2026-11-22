// Test cases for the "future" group (F6). The model and the view are pure, so they run under Node on the sample
// household. The plan gives F6 no tests of its own: these check that every figure comes from F1, F3 or F4 and
// that none is a literal (U33), that only scenarios on the chart are computed, the carried cards, and escaping.

import { buildSampleHousehold } from '../../state/sample-data.js';
import { migrateAssetDebtDetail } from '../../state/asset-debt-migration.js';
import { yearsToFI, fiNumber, projectNetWorth } from '../../calc/fi.js';
import { enF } from '../../i18n/en-f.js';
import { t, plural } from '../../i18n/strings.js';
import {
    futureModel, chartGeometry, chartIds, scenarioList, peopleSlots, withPeople, assumptionValues, validateAssumptions,
    applyAssumptions, restoreAssumptions, MAX_ON_CHART, HORIZONS, niceStep, MIN_LAST_TICK_GAP_PCT,
} from './model.js';
import { buildFutureHtml, yearsText, axisMoney } from './view.js';

// A source file as text under Node (null in the browser runner, where the check is skipped).
async function srcText(rel) {
    try {
        if (typeof process === 'undefined' || !process.versions || !process.versions.node) return null;
        const nodeFs = 'node:fs', nodeUrl = 'node:url', nodePath = 'node:path';
        const [fs, { fileURLToPath }, path] = await Promise.all([import(/* @vite-ignore */ nodeFs), import(/* @vite-ignore */ nodeUrl), import(/* @vite-ignore */ nodePath)]);
        return fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', rel), 'utf8');
    } catch (_) { return null; }
}

const TODAY = '2026-11-21';
const sample = () => {
    const d = buildSampleHousehold(TODAY).data;
    migrateAssetDebtDetail(d);
    return d;
};
const sc = (id, over = {}) => ({ id, name: `Scenario ${id}`, pinned: false, archived: false, updatedAt: `2026-11-${10 + id.length}T00:00:00.000Z`, changes: [], ...over });
const countIn = (s, needle) => s.split(needle).length - 1;

export const FUTURE_TEST_CASES = [
    {
        name: 'K4.1 Future shows the What if button and the promo card, both opening a new scenario',
        fn(assert) {
            const html = buildFutureHtml(futureModel(sample(), { today: TODAY }), { loaded: true });
            assert('promo card present', html.includes('class="wi-entry"'), true);
            assert('promo heading', html.includes('Try a change without touching your plan.'), true);
            assert('button label', html.includes('What if…?'), true);
            assert('button opens a new scenario', /class="btn btn-primary fu-whatif" data-fu-new="1"/.test(html), true);
            assert('button is not icon-only: icon hidden from readers', html.includes('aria-hidden="true" focusable="false"'), true);
            assert('promo sits in the FI card', html.indexOf('fu-fi') < html.indexOf('wi-entry') && html.indexOf('wi-entry') < html.indexOf('fu-scen'), true);
        },
    },
    {
        name: 'K4.2 count strings read right for exactly one (no "1 changes", "1 goals")',
        fn(assert) {
            const bad = /1 (changes|goals|details|of these are)/;
            const one = (k) => t(k, { count: 1, n: 1 });
            const lines = [
                plural(1, 'f.wi.step.adjust.sub.one', 'f.wi.step.adjust.sub'), plural(1, 'f.wi.dropped.one', 'f.wi.dropped'),
                plural(1, 'f.wi.adjust.gone.one', 'f.wi.adjust.gone'), plural(1, 'f.res.mr.missing.one', 'f.res.mr.missing'),
                plural(1, 'f.res.mr.conflicts.one', 'f.res.mr.conflicts'), plural(1, 'f.res.mr.virtual.one', 'f.res.mr.virtual'),
                plural(1, 'f.res.mr.failed.one', 'f.res.mr.failed'), one('f.future.goals.undated.one'), one('f.future.goals.undatedOnly.one'),
            ];
            for (const s of lines) assert(`singular: ${s}`, bad.test(s), false);
            assert('adjust tile', lines[0], 'Your 1 change');
            assert('many still plural', plural(3, 'f.wi.step.adjust.sub.one', 'f.wi.step.adjust.sub'), 'Your 3 changes');
        },
    },
    {
        name: 'F6.1 every figure is what F3 computes (years to FI, FI number, the path), not the mock',
        fn(assert) {
            const d = sample();
            const m = futureModel(d, { today: TODAY });
            assert('years to FI = F3', m.summary.yearsToFI, yearsToFI(d, { today: TODAY }));
            assert('FI number = F3', m.summary.fiNumber, fiNumber(d, { today: TODAY }));
            assert('now = F3 path[0]', m.figures.now, projectNetWorth(d, { today: TODAY, years: 30 }).path[0].fiNetWorth);
            assert('not the mock\'s 25.09', Math.abs(m.summary.yearsToFI - 25.09) > 1, true);
            const html = buildFutureHtml(m);
            assert('the years text is F3\'s figure', html.includes(yearsText(m.summary.yearsToFI)), true);
            assert('no hard-coded "about 25 years"', /about 25 years/i.test(html), false);
            assert('no mock FI number', html.includes('1.56M') || html.includes('27,720'), false);
            assert('the FI number is shown', html.includes(Math.round(m.summary.fiNumber).toLocaleString('en-AU')) || html.includes(Math.round(m.summary.fiNumber).toLocaleString('en-US')), true);
        },
    },
    {
        name: 'F6.2 changing the data changes the screen (nothing is a literal)',
        fn(assert) {
            const d = sample();
            const a = futureModel(d, { today: TODAY });
            d.fiSettings.multiple = 30;
            const b = futureModel(d, { today: TODAY });
            assert('FI number moves', b.summary.fiNumber > a.summary.fiNumber, true);
            assert('years move', b.summary.yearsToFI !== a.summary.yearsToFI, true);
            assert('html differs', buildFutureHtml(a) !== buildFutureHtml(b), true);
            d.fiSettings.multiple = 25;
            d.fiSettings.expectedReturn = 9;
            const c = futureModel(d, { today: TODAY });
            assert('return moves the path', c.figures.in20 > a.figures.in20, true);
            assert('assumption line follows', buildFutureHtml(c).includes('6.5%'), true);
        },
    },
    {
        name: 'F6.3 the copy has no figure of its own (no digits outside placeholders in f.future.*)',
        fn(assert) {
            const bad = Object.entries(enF).filter(([k, v]) => k.startsWith('f.future.') && /\d/.test(v.replace(/\{\w+\}/g, '')));
            assert('keys with a digit', bad.map(([k]) => k), []);
        },
    },
    {
        name: 'F6.4 only scenarios switched On chart are computed and drawn (at most three; archived never)',
        fn(assert) {
            const d = sample();
            const rows = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map((id) => sc(id, { changes: [{ id: `c${id}`, kind: 'assumption', target: { collection: 'fiSettings', id: null }, field: 'expectedReturn', op: 'add', value: 1, from: TODAY }] }));
            rows.push(sc('arch', { archived: true }));
            const m = futureModel(d, { today: TODAY, scenarios: rows, onChart: ['a', 'bb', 'ccc', 'dddd', 'arch'] });
            assert('three drawn', m.drawn.map((x) => x.id), ['a', 'bb', 'ccc']);
            assert('lines: now + three', m.geometry.lines.length, 1 + MAX_ON_CHART);
            assert('a better return gets there sooner', m.drawn[0].yearsToFI < m.summary.yearsToFI, true);
            const none = futureModel(d, { today: TODAY, scenarios: rows, onChart: [] });
            assert('none switched on: only the plan line', none.geometry.lines.length, 1);
            assert('ids filtered', chartIds(rows, ['arch', 'zzz', 'a']), ['a']);
            const html = buildFutureHtml(m);
            assert('three switches pressed', countIn(html, 'data-fu-chart') >= 5 && countIn(html, 'aria-pressed="true"') >= 4, true);
        },
    },
    {
        name: 'F6.5 the scenario list: pinned first, archived hidden, counts',
        fn(assert) {
            const rows = [sc('a', { updatedAt: '2026-11-03T00:00:00.000Z' }), sc('b', { pinned: true, updatedAt: '2026-11-01T00:00:00.000Z' }), sc('c', { archived: true })];
            const l = scenarioList(rows, ['a']);
            assert('pinned first', l.live.map((r) => r.id), ['b', 'a']);
            assert('archived apart', l.archived.map((r) => r.id), ['c']);
            assert('on chart flag', l.live.map((r) => r.onChart), [false, true]);
            const m = futureModel(sample(), { today: TODAY, scenarios: rows });
            const closed = buildFutureHtml(m, { loaded: true, showArchived: false });
            const open = buildFutureHtml(m, { loaded: true, showArchived: true });
            assert('archived hidden by default', closed.includes('Scenario c'), false);
            assert('archived shown on ask', open.includes('Scenario c'), true);
            assert('not loaded yet', buildFutureHtml(m, { loaded: false }).includes('data-fu-new'), true);
        },
    },
    {
        name: 'F6.6 the carried cards render: Debts (chips, interest cost, debt-free net worth), HELP payoff, things that lose value',
        fn(assert) {
            const d = sample();
            const m = futureModel(d, { today: TODAY });
            const html = buildFutureHtml(m);
            assert('debts card', html.includes('fu-debts') && html.includes('Net worth if debt-free'), true);
            assert('one card a debt', countIn(html, 'data-fu-debt='), d.liabilities.length);
            assert('good or bad chip from F2\'s label', html.includes('Bad debt') || html.includes('Good debt'), true);
            assert('interest cost = sum of balance x rate', Math.abs(m.debts.annualInterest - d.liabilities.reduce((s, l) => s + l.balance * l.interestRate / 100, 0)) < 0.005, true);
            assert('debt-free = assets', m.debts.netWorthDebtFree, d.assets.reduce((s, a) => s + a.balance, 0));
            assert('HELP payoff card', html.includes('fu-helpcard') && m.help !== null, true);
            assert('HELP years from projectHelpPayoff', ['years', 'never', 'none'].includes(m.help.kind), true);
            assert('HELP counted line in the lose-value card', html.includes('fu-lose'), true);
            d.taxSettings.helpBalance = 0;
            assert('no HELP balance: no card', buildFutureHtml(futureModel(d, { today: TODAY })).includes('fu-helpcard'), false);
            d.liabilities = [];
            assert('no debts: kind words', buildFutureHtml(futureModel(d, { today: TODAY })).includes('fu-good'), true);
        },
    },
    {
        name: 'F6.7 the tax-provision card shows with variable income only',
        fn(assert) {
            const d = sample();
            const has = futureModel(d, { today: TODAY }).tax;
            const html = buildFutureHtml(futureModel(d, { today: TODAY }));
            assert('card matches the model', html.includes('fu-tax'), has !== null);
            const none = structuredClone(d);
            none.incomeSources = none.incomeSources.map((s) => ({ ...s, incomeType: 'salaried' }));
            assert('no variable income: no card', futureModel(none, { today: TODAY }).tax, null);
        },
    },
    {
        name: 'F6.8 assumptions: birth years feed F3\'s FI age; saving and Undo; an untouched save adds no key',
        fn(assert) {
            const d = sample();
            assert('no ages without years', futureModel(d, { today: TODAY }).summary.fiAge, null);
            const slots = peopleSlots(d);
            assert('a slot a person', slots.length, d.incomeSources.length);
            const v = assumptionValues(d);
            assert('defaults', [v.multiple, v.expectedReturn, v.inflation], [25, 7, 2.5]);
            assert('untouched save adds nothing', (applyAssumptions(d, v), 'birthYears' in d.fiSettings), false);
            const before = structuredClone(d.fiSettings);
            const { before: snap } = applyAssumptions(d, { ...v, expectedReturn: 8, birthYear0: 1985, birthYear1: '' });
            assert('stored', d.fiSettings.birthYears, [1985, null]);
            assert('return stored', d.fiSettings.expectedReturn, 8);
            const m = futureModel(d, { today: TODAY });
            assert('F3 gives an age', m.summary.fiAge !== null && m.summary.fiAge.ages.length, 1);
            assert('age = year now - birth + ceil(years)', m.summary.fiAge.ages[0].age, 2026 - 1985 + Math.ceil(m.summary.yearsToFI));
            assert('shown', buildFutureHtml(m).includes('Ages then'), true);
            assert('withPeople does not touch the data', 'people' in d, false);
            assert('withPeople', withPeople(d).people.length, 1);
            restoreAssumptions(d, snap);
            assert('Undo restores', d.fiSettings, before);
            assert('validation', validateAssumptions({ multiple: 0, expectedReturn: -1, inflation: 50, birthYear0: 1800 }, 2026), {
                multiple: 'f.future.err.multiple', expectedReturn: 'f.future.err.return', inflation: 'f.future.err.inflation', birthYear0: 'f.future.err.birth',
            });
            assert('valid', validateAssumptions({ multiple: 25, expectedReturn: 7, inflation: 2.5, birthYear0: 1990, birthYear1: null }, 2026), {});
        },
    },
    {
        name: 'H3.1 x ticks: the "N yrs" label never touches the tick before it, at every horizon',
        fn(assert) {
            for (const years of HORIZONS) {
                const g = chartGeometry({ series: [{ id: 'now', kind: 'now', values: [0, 10, 20] }], fiNumber: 15, yearsToFI: 1, years });
                const n = g.ticks.length;
                assert(`${years} yrs: first tick is Now, last is the horizon`, [g.ticks[0].year, g.ticks[n - 1].year], [0, years]);
                assert(`${years} yrs: gap before the last tick >= ${MIN_LAST_TICK_GAP_PCT}%`, g.ticks[n - 1].pct - g.ticks[n - 2].pct >= MIN_LAST_TICK_GAP_PCT, true);
            }
            const g30 = chartGeometry({ series: [{ id: 'now', kind: 'now', values: [0, 1] }], fiNumber: 1, yearsToFI: 1, years: 30 });
            assert('30 yrs drops the crowded 25', g30.ticks.map((t) => t.year), [0, 5, 10, 15, 20, 30]);
        },
    },
    {
        name: 'H3.2 the FI marker label sits a full row above the FI line label (own row, no overlap)',
        async fn(assert) {
            const css = await srcText('ui/future/future.css');
            if (css === null) return;
            const tags = css.match(/\.fu-fi-tag\s*\{[^}]*\}/g) || [];
            assert('every .fu-fi-tag rule lifts it above the dot by >= 22px', tags.length >= 2 && tags.every((r) => /-100% - 22px/.test(r)), true);
        },
    },
    {
        name: 'H3.3 phone top bar clears the iPhone status bar (viewport-fit=cover + black-translucent)',
        async fn(assert) {
            const css = await srcText('styles/base.css');
            const html = await srcText('../index.html');
            if (css === null || html === null) return;
            const rule = (css.match(/\.topbar\s*\{[^}]*\}/g) || []).find((r) => r.includes('sticky')) || '';
            assert('topbar pads by the top safe-area inset', /padding:\s*env\(safe-area-inset-top, 0px\)/.test(rule), true);
            assert('topbar grows by the same inset', /height:\s*calc\(56px \+ env\(safe-area-inset-top, 0px\)\)/.test(rule), true);
            assert('still sticky', rule.includes('position: sticky'), true);
            assert('the page draws under the status bar', html.includes('viewport-fit=cover') && html.includes('black-translucent'), true);
        },
    },
    {
        name: 'F6.9 chart geometry: gridlines, FI dot, horizon ticks, round steps',
        fn(assert) {
            const g = chartGeometry({ series: [{ id: 'now', kind: 'now', values: [0, 50, 100, 150] }], fiNumber: 120, yearsToFI: 2.5, years: 3 });
            assert('one line', g.lines.length, 1);
            assert('FI dot at 2.5 / 3', g.fiDot.left, 83.33);
            assert('ticks', g.ticks.map((t) => t.year), [0, 2]);
            assert('the top gridline is above the max', Math.max(...g.grid.map((l) => l.value)) >= 150, true);
            assert('no dot when never', chartGeometry({ series: [{ id: 'now', kind: 'now', values: [1, 2] }], fiNumber: 9, yearsToFI: Infinity, years: 1 }).fiDot, null);
            assert('steps are 1, 2 or 5 times a power of ten', [niceStep(2350000), niceStep(97), niceStep(0)], [500000, 20, 1]);
            assert('horizons', HORIZONS, [10, 20, 30]);
            assert('short axis words', [axisMoney(500000), axisMoney(1500000), axisMoney(0)].map((s) => s.replace(/^\D+/, '')), ['500k', '1.5M', '0']);
        },
    },
    {
        name: 'F6.10 data is escaped in every card',
        fn(assert) {
            const d = sample();
            d.liabilities[0].name = '<img src=x onerror=alert(1)>';
            const rows = [sc('x', { name: '<script>boom</script>' })];
            const html = buildFutureHtml(futureModel(d, { today: TODAY, scenarios: rows, onChart: ['x'] }), { loaded: true });
            assert('no raw tags', /<img src=x|<script>boom/.test(html), false);
            assert('text kept as text', html.includes('&lt;script&gt;boom'), true);
        },
    },
    {
        name: 'F6.11 the goal timeline comes from F4 (dated Smile goals, none from the mock)',
        fn(assert) {
            const d = sample();
            const m = futureModel(d, { today: TODAY });
            assert('undated goals: no rows, they are counted', [m.goals.rows.length, m.goals.undated > 0], [0, true]);
            const leaves = d.bucketGoals.filter((x) => !d.bucketGoals.some((y) => String(y.parentId) === String(x.id)));
            leaves.forEach((x, i) => { x.due = `2027-0${i + 3}-01`; });
            const g = futureModel(d, { today: TODAY }).goals;
            assert('dated goals give rows', g.rows.length > 0, true);
            assert('goals html', buildFutureHtml(futureModel(d, { today: TODAY })).includes('fu-tl-dot'), true);
            assert('rows are F4\'s dated goals', g.rows.every((r) => r.due && ['covered', 'onTime', 'short', 'impossible'].includes(r.state)), true);
            assert('costs add up', g.totalCents, g.rows.reduce((s, r) => s + r.costCents, 0));
            assert('dots match rows', g.positions.length, g.rows.length);
            assert('dots on the line', g.positions.every((p) => p >= 0 && p <= 100), true);
            d.bucketGoals = [];
            assert('no goals: empty note', buildFutureHtml(futureModel(d, { today: TODAY })).includes('No dated Smile goals'), true);
        },
    },
];
