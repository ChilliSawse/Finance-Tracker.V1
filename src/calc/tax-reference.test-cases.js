// Test cases for the "tax-reference" group (registered in src/test-registry.js).
// FT-0032 DB14 (FT-R-124, FT-R-113, FT-R-117): the tax figures in reference/src/tax.json against the built-in tables,
// the fallback rules, and the legislated-only rule. Shape: { name, fn(assert) }, assert(label, actual, expected).

import taxFile from '../../reference/src/tax.json' with { type: 'json' };
import { TAX_TABLES, setReferenceTaxTables, tablesForFy, resolveTablesForDate, getTablesForDate } from './tax-tables/index.js';
import { buildYearTable, tablesFromReference } from './tax-tables/reference-tables.js';
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
            assert('malformed table holds that year', [r.used, r.held['2026-27'].reason], [['2025-26'], 'malformed']);
            same('a malformed year falls back to the built-in table');
            const nanRate = clone(taxFile); nanRate.years['2026-27'].medicare.levyRate.value = 'two percent';
            assert('non-numeric figure is held', applyReferenceTax(nanRate).held['2026-27'].reason, 'malformed');
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
];
