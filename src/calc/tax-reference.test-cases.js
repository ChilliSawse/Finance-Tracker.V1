// Test cases for the "tax-reference" group (registered in src/test-registry.js).
// FT-0032 DB14 (FT-R-124, FT-R-113, FT-R-117): the tax figures in reference/src/tax.json against the built-in tables,
// the fallback rules, and the legislated-only rule. Shape: { name, fn(assert) }, assert(label, actual, expected).

import taxFile from '../../reference/src/tax.json' with { type: 'json' };
import { TAX_TABLES, setReferenceTaxTables, tablesForFy, resolveTablesForDate, getTablesForDate } from './tax-tables/index.js';
import { buildYearTable, tablesFromReference, taxFileProblems } from './tax-tables/reference-tables.js';
import { getTaxYear } from './tax-au.js';
import { annualOwed } from './tax-owed.js';
import { withholdingForPay } from './withholding.js';
import { applyReferenceTax, loadReferenceTax, heldReferenceYears } from '../state/reference-tax.js';
import { validateReferenceFile, REFERENCE_KINDS } from '../state/reference-validate.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
// Infinity does not survive JSON, so it is written out before the runner's JSON comparison.
const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x === Infinity ? 'Infinity' : x)));
const META = ['sources', 'updated', 'origin']; // how a table is documented, not a figure
const figuresOf = (t) => { const c = { ...t }; META.forEach((k) => delete c[k]); return norm(c); };
const tidy = (f) => {
    let r;
    try { r = f(); } catch (e) { setReferenceTaxTables({}); throw e; }
    if (r && typeof r.then === 'function') return r.finally(() => setReferenceTaxTables({}));
    setReferenceTaxTables({});
    return r;
};

// A grid of results spanning both built-in years, every cycle, with and without a study loan.
function resultGrid() {
    const out = [];
    for (const fy of ['2025-26', '2026-27']) {
        for (const cycle of ['weekly', 'fortnightly', 'monthly']) {
            for (const gross of [300, 1000, 1528.5, 3057.69, 6000, 12000]) {
                for (const hasStudyDebt of [false, true]) out.push(withholdingForPay({ gross, cycle, fy, hasStudyDebt }));
            }
        }
        const date = fy === '2025-26' ? '2026-03-01' : '2026-11-23';
        for (const taxableIncome of [0, 18200, 28011, 30000, 45000, 67000, 90000, 135000, 190000, 250000]) {
            out.push(annualOwed({ taxableIncome, date, hasStudyDebt: true }));
            out.push(annualOwed({ taxableIncome, date }));
        }
        const t = getTaxYear(fy);
        out.push([t.fy, t.brackets, t.medicare, t.help, t.lito]);
    }
    return norm(out);
}

const fakeEnv = ({ state, bodies = {}, baseline = false } = {}) => ({
    base: './',
    fetch: async () => (baseline ? { ok: false } : { ok: false, status: 404 }),
    caches: { open: async () => ({
        match: async (url) => {
            const text = url === '/__ft-ref__/state.json' ? (state && JSON.stringify(state)) : bodies[url.replace('/__ft-ref__/f/', '')];
            return text ? { text: async () => (typeof text === 'string' ? text : JSON.stringify(text)) } : undefined;
        },
    }) },
    storage: null,
    now: () => 0,
    appVersion: '2.0.0',
});
const stateFor = (disabled = []) => ({ current: { dataVersion: 'x', files: { tax: { path: 'tax.json', sha256: 'abc', bytes: 1, rev: 1 } }, at: 0 }, history: [], disabled });

export const TAX_REFERENCE_TEST_CASES = [
    { name: 'DB14.1 the tax file is valid and every figure is sourced', fn(assert) {
        assert('client validator accepts the file', validateReferenceFile('tax', taxFile).ok, true);
        assert('tax is a known kind', REFERENCE_KINDS.includes('tax'), true);
        const status = {};
        let all = true;
        for (const [y, groups] of Object.entries(taxFile.years)) {
            for (const figs of Object.values(groups)) {
                for (const f of Object.values(figs)) {
                    status[f.status] = (status[f.status] || 0) + 1;
                    all = all && typeof f.source === 'string' && f.source.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(f.retrieved)
                        && typeof f.quote === 'string' && f.quote.length > 0 && !!(f.fy || f.appliesFrom) && (f.fy === undefined || f.fy === y);
                }
            }
        }
        assert('every figure has status, year or date, https source, retrieved date and a quote', all, true);
        assert('three years', Object.keys(taxFile.years), ['2025-26', '2026-27', '2027-28']);
        assert('status counts', Object.entries(status).sort(), [['UNVERIFIED:derived', 1], ['UNVERIFIED:estimate', 13], ['guidance', 1], ['legislated', 96]]);
    } },
    { name: 'DB14.2 database 2025-26 and 2026-27 equal the code tables exactly', fn(assert) {
        for (const fy of ['2025-26', '2026-27']) {
            const r = buildYearTable(fy, taxFile.years[fy]);
            assert(`${fy} builds`, !!r.table, true);
            const built = figuresOf(r.table);
            const code = figuresOf(TAX_TABLES[fy]);
            for (const k of Object.keys(code)) assert(`${fy} ${k}`, built[k], code[k]);
            assert(`${fy} same keys`, Object.keys(built).sort(), Object.keys(code).sort());
            assert(`${fy} whole table`, built, code);
        }
    } },
    { name: 'DB14.3 results with the database applied equal results without it', fn(assert) {
        tidy(() => {
            setReferenceTaxTables({});
            const before = resultGrid();
            const applied = applyReferenceTax(taxFile);
            assert('both built-in years are used from the database', applied.used, ['2025-26', '2026-27']);
            assert('the tables really are the database ones', tablesForFy('2026-27').origin, 'reference');
            const after = resultGrid();
            assert('grid size', after.length, before.length);
            assert('every result is identical', after, before);
        });
        assert('override cleared afterwards', tablesForFy('2026-27'), TAX_TABLES['2026-27']);
    } },
    { name: 'DB14.4 a legislated database figure is used', fn(assert) {
        tidy(() => {
            const doc = clone(taxFile);
            doc.years['2026-27'].medicare.singleLowerThreshold.value = 30000;
            applyReferenceTax(doc);
            assert('Medicare lower threshold comes from the database', getTaxYear('2026-27').medicare.singleLowerThreshold, 30000);
            assert('2025-26 unchanged', getTaxYear('2025-26').medicare.singleLowerThreshold, 28011);
            assert('the built-in file itself is never edited', TAX_TABLES['2026-27'].medicare.singleLowerThreshold, 28011);
        });
    } },
    { name: 'DB14.5 announced and estimate figures never replace a legislated built-in table', fn(assert) {
        tidy(() => {
            const doc = clone(taxFile);
            doc.years['2026-27'].medicare.singleLowerThreshold.value = 30000;
            doc.years['2026-27'].medicare.singleLowerThreshold.status = 'announced';
            const r = applyReferenceTax(doc);
            assert('2026-27 is held, not used', [r.used, r.held['2026-27'].reason, r.held['2026-27'].statuses], [['2025-26'], 'not-legislated', ['announced']]);
            assert('built-in 2026-27 stays', getTaxYear('2026-27').medicare.singleLowerThreshold, 28011);
            assert('held years are reported', Object.keys(heldReferenceYears()).includes('2026-27'), true);
            for (const s of ['estimate', 'UNVERIFIED:estimate', 'derived', 'UNVERIFIED:derived', 'guidance', 'UNVERIFIED:legislated']) {
                const d2 = clone(taxFile);
                d2.years['2026-27'].incomeTax.resident.status = s;
                const x = tablesFromReference(d2.years);
                assert(`status ${s} holds the year`, [!!x.tables['2026-27'], !!x.tables['2025-26']], [false, true]);
            }
        });
    } },
    { name: 'DB14.6 a year that exists only as announced or incomplete is held and the app stays on the latest built-in', fn(assert) {
        tidy(() => {
            const r = applyReferenceTax(taxFile);
            assert('2027-28 is not used', r.used.includes('2027-28'), false);
            assert('2027-28 is held as incomplete (no withholding schedule, HELP bands or caps yet)', r.held['2027-28'].reason, 'incomplete');
            assert('the missing figures are named', r.held['2027-28'].figures.includes('payg.scale1_noTFT') && r.held['2027-28'].figures.includes('help.bands'), true);
            assert('no table for 1 Jul 2027', getTablesForDate('2027-07-01'), undefined);
            const res = resolveTablesForDate('2027-07-01');
            assert('still the latest built-in, marked stale', [res.fy, res.stale], ['2026-27', true]);
            // A complete copy of 2026-27 labelled as a later year: usable only while every figure is legislated.
            const later = clone(taxFile.years['2026-27']);
            const retag = (law) => {
                const y = clone(later);
                for (const g of Object.values(y)) for (const f of Object.values(g)) { f.fy = '2028-29'; if (f.appliesFrom) f.appliesFrom = f.appliesFrom.replace('2026', '2028').replace('2027', '2029'); if (!law && f.status === 'legislated') f.status = 'announced'; }
                return y;
            };
            const ann = tablesFromReference({ '2028-29': retag(false) });
            assert('an announced-only complete year is held', [Object.keys(ann.tables), ann.held['2028-29'].reason], [[], 'not-legislated']);
            const leg = tablesFromReference({ '2028-29': retag(true) });
            assert('the same year with legislated figures is built', Object.keys(leg.tables), ['2028-29']);
            setReferenceTaxTables(leg.tables);
            assert('a legislated-only database year then extends the dated lookup', [getTablesForDate('2028-08-01').fy, resolveTablesForDate('2028-08-01').stale], ['2028-29', false]);
        });
    } },
    { name: 'DB14.7 fallback: no data, invalid data, disabled kind, bad table', async fn(assert) {
        const base = resultGrid();
        const same = (label) => assert(label, resultGrid(), base);
        await tidy(async () => {
            applyReferenceTax(null); same('null file');
            applyReferenceTax({ schema: 1, rev: 1, years: 'nope' }); same('invalid file');
            applyReferenceTax({ schema: 2, rev: 1, years: {} }); same('unknown schema');
            const noStatus = clone(taxFile); delete noStatus.years['2026-27'].incomeTax.resident.status;
            applyReferenceTax(noStatus); same('a figure without status');
            const badRows = clone(taxFile); badRows.years['2026-27'].payg.scale2_TFT.value = [[100, 0, 0]]; // last band not open
            const r = applyReferenceTax(badRows);
            assert('malformed table holds that year', [r.used, r.held['2026-27'].reason], [['2025-26'], 'out-of-range']);
            same('a malformed year falls back to the built-in table');
            const nanRate = clone(taxFile); nanRate.years['2026-27'].medicare.levyRate.value = 'two percent';
            assert('non-numeric figure is held', applyReferenceTax(nanRate).held['2026-27'].reason, 'out-of-range');
            same('non-numeric figure');
            // The client: nothing stored and nothing on the network.
            assert('no cache, no baseline: nothing used', (await loadReferenceTax(fakeEnv())).used, []);
            same('after an empty load');
            // A cached tax file the manifest has switched off is ignored.
            const off = await loadReferenceTax(fakeEnv({ state: stateFor(['tax']), bodies: { abc: taxFile } }));
            assert('disabled kind is ignored', off.used, []);
            same('after a disabled load');
            // The same cache, not disabled, is used.
            const on = await loadReferenceTax(fakeEnv({ state: stateFor(), bodies: { abc: taxFile } }));
            assert('an enabled cached file is used', on.used, ['2025-26', '2026-27']);
            same('and its results still equal the built-in ones');
            // A cached body that is not valid is never used.
            const junk = await loadReferenceTax(fakeEnv({ state: stateFor(), bodies: { abc: { schema: 1, rev: 1, years: { bad: {} } } } }));
            assert('an invalid cached body is ignored', junk.used, []);
            same('after an invalid cached body');
        });
    } },
    { name: 'DB14.8 the client validator limits', fn(assert) {
        const ok = (mut) => { const d = clone(taxFile); mut(d); return validateReferenceFile('tax', d).ok; };
        assert('good file', ok(() => {}), true);
        assert('year key must look like 2026-27', ok((d) => { d.years['2026'] = {}; }), false);
        assert('unknown status refused', ok((d) => { d.years['2026-27'].medicare.levyRate.status = 'rumoured'; }), false);
        assert('UNVERIFIED: prefix allowed', ok((d) => { d.years['2026-27'].medicare.levyRate.status = 'UNVERIFIED:announced'; }), true);
        assert('retrieved must be a date', ok((d) => { d.years['2026-27'].medicare.levyRate.retrieved = 'yesterday'; }), false);
        assert('fy or appliesFrom needed', ok((d) => { delete d.years['2026-27'].medicare.levyRate.fy; delete d.years['2026-27'].medicare.levyRate.appliesFrom; }), false);
        assert('value must be present (null allowed)', ok((d) => { d.years['2026-27'].medicare.levyRate.value = null; }), true);
        assert('value missing refused', ok((d) => { delete d.years['2026-27'].medicare.levyRate.value; }), false);
        assert('2000-char quote allowed', ok((d) => { d.years['2026-27'].medicare.levyRate.quote = 'q'.repeat(2000); }), true);
        assert('1000-char unit and source allowed', ok((d) => { const f = d.years['2026-27'].medicare.levyRate; f.unit = 'u'.repeat(1000); f.source = 's'.repeat(1000); }), true);
        assert('prototype key refused', ok((d) => { d.years['2026-27'].medicare = JSON.parse('{"__proto__":{}}'); }), false);
        assert('rev must be a whole number', ok((d) => { d.rev = 1.5; }), false);
    } },
    { name: 'DB14.9 hostile figures hold the year (ranges, order, end-to-end bands, years)', fn(assert) {
        const hostile = {
            'a rate above 1': (y) => { y.incomeTax.resident.value[1][2] = 1.5; },
            'a negative rate': (y) => { y.medicare.levyRate.value = -0.02; },
            'a negative threshold': (y) => { y.medicare.singleLowerThreshold.value = -5; },
            'Medicare thresholds out of order': (y) => { y.medicare.singleLowerThreshold.value = 40000; },
            'tax bands that do not meet': (y) => { y.incomeTax.resident.value[2][0] = 46000; },
            'tax bands that do not start at 0': (y) => { y.incomeTax.resident.value[0][0] = 100; },
            'HELP bands with a gap': (y) => { y.help.bands.value[2][0] = 130000; },
            'HELP minimum disagreeing with the bands': (y) => { y.help.minimumRepaymentIncome.value = 70000; },
            'HELP second threshold disagreeing': (y) => { y.help.secondThreshold.value = 130000; },
            'HELP cap start disagreeing': (y) => { y.help.capStart.value = 190000; },
            'a scale a above 1': (y) => { y.payg.scale2_TFT.value[1][1] = 2; },
            'a scale b out of range': (y) => { y.payg.scale1_noTFT.value[1][2] = 1e9; },
            'a scale out of order': (y) => { y.payg.scale1_noTFT.value[1][0] = 100; },
            'a negative LITO value': (y) => { y.incomeTax.lito.value.max = -700; },
            'LITO thresholds out of order': (y) => { y.incomeTax.lito.value.fullUntil = 50000; },
            'indexation above 0.2': (y) => { y.help.indexationProjection.value = 0.5; },
            'a negative indexation': (y) => { y.help.indexationProjection.value = -0.01; },
            'a date outside the year': (y) => { y.incomeTax.resident.appliesFrom = '2025-07-01'; },
            'a figure for another year': (y) => { y.medicare.levyRate.fy = '2025-26'; },
        };
        for (const [label, mut] of Object.entries(hostile)) {
            const doc = clone(taxFile);
            mut(doc.years['2026-27']);
            const r = tablesFromReference(doc.years);
            assert(`${label}: the year is held, the other year is used`, [!!r.tables['2026-27'], !!r.tables['2025-26'], r.held['2026-27'] && r.held['2026-27'].reason], [false, true, 'out-of-range']);
            assert(`${label}: the build refuses the file`, taxFileProblems(doc).length > 0, true);
        }
        assert('the shipped file has no range problems', taxFileProblems(taxFile), []);
        const doc = clone(taxFile);
        doc.years['2027-28'].medicare.levyRate.value = 3;
        assert('an out-of-range figure is caught even in a year that is held anyway', taxFileProblems(doc).length, 1);
    } },
    { name: 'DB14.10 a gap between years never picks a future table', fn(assert) {
        tidy(() => {
            const t = clone(TAX_TABLES['2026-27']); t.fy = '2030-31';
            setReferenceTaxTables({ '2030-31': t });
            const g = resolveTablesForDate('2028-07-01');
            assert('2028-07-01 with a 2030-31-only file: the newest year at or before it, stale', [g.fy, g.stale], ['2026-27', true]);
            assert('2030-08-01 is the 2030-31 table', [resolveTablesForDate('2030-08-01').fy, resolveTablesForDate('2030-08-01').stale], ['2030-31', false]);
            assert('2032-01-01 is past it: the 2030-31 table, stale', [resolveTablesForDate('2032-01-01').fy, resolveTablesForDate('2032-01-01').stale], ['2030-31', true]);
            assert('before every year is the earliest, not stale', [resolveTablesForDate('2020-01-01').fy, resolveTablesForDate('2020-01-01').stale], ['2025-26', false]);
            assert('a bad date still resolves', resolveTablesForDate('nope').fy, '2030-31');
        });
        assert('without the file the old behaviour holds', [resolveTablesForDate('2028-07-01').fy, resolveTablesForDate('2028-07-01').stale], ['2026-27', true]);
    } },
    { name: 'DB14.11 the app is told when applied tables differ from the built-in ones', fn(assert) {
        tidy(() => {
            assert('the shipped file equals the built-in tables: nothing to redraw', applyReferenceTax(taxFile).changed, false);
            const d = clone(taxFile);
            d.years['2026-27'].medicare.singleLowerThreshold.value = 29000;
            assert('a different legislated figure: redraw', applyReferenceTax(d).changed, true);
            assert('nothing usable: no redraw', applyReferenceTax(null).changed, false);
            const x = clone(taxFile);
            x.years['2026-27'].medicare.singleLowerThreshold.status = 'announced';
            x.years['2026-27'].medicare.singleLowerThreshold.value = 29000;
            assert('a held year does not count', applyReferenceTax(x).changed, false);
        });
    } },
    { name: 'DB14.12 disabled tax skips the baseline too', async fn(assert) {
        const sha = 'a'.repeat(64);
        const manifest = { schema: 1, dataVersion: 'b', minApp: '2.0.0', files: { tax: { path: 'tax.json', sha256: sha, bytes: 10, rev: 1 } } };
        const env = (disabled) => ({
            ...fakeEnv({ state: { current: { dataVersion: 'x', files: {}, at: 0 }, history: [], disabled } }),
            fetch: async (url) => {
                const text = url.endsWith('baseline/manifest.json') ? JSON.stringify(manifest) : url.endsWith('baseline/tax.json') ? JSON.stringify(taxFile) : null;
                return text ? { ok: true, text: async () => text } : { ok: false, status: 404 };
            },
        });
        await tidy(async () => {
            assert('baseline is used when tax is not disabled', (await loadReferenceTax(env([]))).used, ['2025-26', '2026-27']);
            assert('disabled tax: no baseline, built-in tables only', (await loadReferenceTax(env(['tax']))).used, []);
            assert('and nothing is left applied', [tablesForFy('2026-27'), heldReferenceYears()], [TAX_TABLES['2026-27'], {}]);
        });
    } },
    { name: 'DB14.13 a legislated indexation is preferred; lookups ignore inherited keys', fn(assert) {
        const d = clone(taxFile);
        d.years['2026-27'].help.indexation = { ...clone(taxFile.years['2025-26'].help.indexation), value: 0.03, fy: '2026-27', appliesFrom: '2027-06-01' };
        assert('legislated 3% over the 2.8% projection', buildYearTable('2026-27', d.years['2026-27']).table.help.indexationPercentDefault, 3);
        assert('the shipped 2026-27 (null indexation) uses the projection', TAX_TABLES['2026-27'].help.indexationPercentDefault, 2.8);
        for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert(`tablesForFy(${k})`, tablesForFy(k), undefined);
        assert('getTaxYear with an inherited name falls back by date', typeof getTaxYear('constructor').fy, 'string');
        assert('a year object with an inherited group name is not read', buildYearTable('2026-27', Object.create({ incomeTax: {} })).held.reason, 'incomplete');
    } },
];
