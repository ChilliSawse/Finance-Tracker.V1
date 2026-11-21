// Test cases for the "tax-tables" group (registered in src/test-registry.js).
// C1: date-keyed tax tables. Shape: { name, fn(assert) }, assert(label, actual, expected).

import { TAX_TABLES, taxYearKeyForDate, getTablesForDate, taxTablesStatus, resolveTablesForDate } from './tax-tables/index.js';
import { AU_TAX_YEARS, CURRENT_TAX_YEAR, getTaxYear } from './tax-au.js';

const ascending = (arr, key) => arr.every((r, i) => i === 0 || r[key] > arr[i - 1][key]);

export const TAX_TABLES_TEST_CASES = [
    { name: 'C1.1 year by date (1 July rule)', fn(assert) {
        assert('30 Jun 2026', taxYearKeyForDate('2026-06-30'), '2025-26');
        assert('1 Jul 2026', taxYearKeyForDate('2026-07-01'), '2026-27');
        assert('30 Jun 2027', taxYearKeyForDate('2027-06-30'), '2026-27');
        assert('1 Jul 2027', taxYearKeyForDate('2027-07-01'), '2027-28');
        assert('Date object', taxYearKeyForDate(new Date(2026, 5, 30)), '2025-26');
        assert('Date object 1 Jul', taxYearKeyForDate(new Date(2026, 6, 1)), '2026-27');
        assert('century wrap', taxYearKeyForDate('2099-07-01'), '2099-00');
        assert('bad input', taxYearKeyForDate('nope'), null);
        assert('table for 2026-07-15', getTablesForDate('2026-07-15').fy, '2026-27');
        assert('table for 2026-06-15', getTablesForDate('2026-06-15').fy, '2025-26');
    } },
    { name: 'C1.2 stale', fn(assert) {
        assert('no table for 2027-07-01', getTablesForDate('2027-07-01'), undefined);
        const s = taxTablesStatus('2027-07-01', {});
        assert('status stale', s, { activeFy: '2026-27', stale: true, checkDue: false });
        const r = resolveTablesForDate('2030-01-01');
        assert('future resolves to the latest, stale', [r.fy, r.stale], ['2026-27', true]);
        assert('current year not stale', taxTablesStatus('2026-11-21', {}).stale, false);
        assert('before the first table is not stale', resolveTablesForDate('2020-01-01').fy, '2025-26');
    } },
    { name: 'C1.2b check due', fn(assert) {
        assert('no taxCheck record', taxTablesStatus('2026-07-02', {}).checkDue, false);
        assert('previous year confirmed only', taxTablesStatus('2026-07-02', { taxCheck: { fy: '2025-26', done: true } }).checkDue, true);
        assert('this year confirmed', taxTablesStatus('2026-07-02', { taxCheck: { fy: '2026-27', done: true } }).checkDue, false);
        assert('this year not done', taxTablesStatus('2026-07-02', { taxCheck: { fy: '2026-27', done: false } }).checkDue, true);
        assert('no data', taxTablesStatus('2026-07-02').activeFy, '2026-27');
    } },
    { name: 'C1.3 table sanity', fn(assert) {
        const keys = Object.keys(TAX_TABLES);
        assert('two years ship', keys.sort(), ['2025-26', '2026-27']);
        for (const [key, t] of Object.entries(TAX_TABLES)) {
            assert(`${key} fy matches key`, t.fy, key);
            assert(`${key} effective from is 1 July`, t.effective.from.slice(5), '07-01');
            assert(`${key} effective to is 30 June`, t.effective.to.slice(5), '06-30');
            assert(`${key} sources`, t.sources.length > 0 && t.sources.every((u) => u.startsWith('https://')), true);
            const lists = { scale1: t.scale1, scale2: t.scale2, stslTft: t.stsl.tftClaimed, stslNot: t.stsl.notClaimed };
            for (const [n, rows] of Object.entries(lists)) {
                assert(`${key} ${n} ascending`, ascending(rows, 'lt'), true);
                assert(`${key} ${n} last is Infinity`, rows[rows.length - 1].lt, Infinity);
            }
            assert(`${key} brackets ascending`, ascending(t.brackets, 'min'), true);
            assert(`${key} brackets contiguous`, t.brackets.every((b, i) => i === 0 || b.min === t.brackets[i - 1].max), true);
            assert(`${key} brackets last is Infinity`, t.brackets[t.brackets.length - 1].max, Infinity);
            assert(`${key} help bands last is Infinity`, t.help.bands[t.help.bands.length - 1].max, Infinity);
        }
        assert('2026-27 starts the day after 2025-26 ends', TAX_TABLES['2026-27'].effective.from, '2026-07-01');
    } },
    { name: 'C1.4 unchanged figures (P0.5 confirmed)', fn(assert) {
        const t = AU_TAX_YEARS['2026-27'];
        assert('brackets', t.brackets.map((b) => [b.min, b.max, b.rate]),
            [[0, 18200, 0], [18200, 45000, 0.15], [45000, 135000, 0.30], [135000, 190000, 0.37], [190000, Infinity, 0.45]]);
        assert('medicare', [t.medicare.rate, t.medicare.singleLowerThreshold, t.medicare.taperRate], [0.02, 28011, 0.10]);
        assert('help', [t.help.minThreshold, t.help.bands.map((b) => [b.min, b.rate]), t.help.capRate, t.help.indexationPercentDefault],
            [69528, [[69528, 0.15], [129717, 0.17]], 0.10, 2.8]);
        const p = AU_TAX_YEARS['2025-26'];
        assert('2025-26 bottom rate 16%', p.brackets[1].rate, 0.16);
        assert('2025-26 help', [p.help.minThreshold, p.help.bands.map((b) => [b.min, b.rate])], [67000, [[67000, 0.15], [125000, 0.17]]]);
        assert('2025-26 medicare annual threshold', p.medicare.singleLowerThreshold, 28011);
        assert('CURRENT_TAX_YEAR still exported', CURRENT_TAX_YEAR, '2026-27');
        assert('known key', getTaxYear('2025-26').fy, '2025-26');
        assert('unknown key falls back to a shipped table', Object.keys(TAX_TABLES).includes(getTaxYear('nope').fy), true);
        assert('absent key falls back to a shipped table', Object.keys(TAX_TABLES).includes(getTaxYear().fy), true);
    } },
    { name: 'C1.6 withholding rows and LITO spot checks', fn(assert) {
        const a = TAX_TABLES['2025-26'];
        const b = TAX_TABLES['2026-27'];
        assert('row counts 25-26', [a.scale2.length, a.scale1.length, a.stsl.tftClaimed.length, a.stsl.notClaimed.length], [9, 7, 4, 4]);
        assert('row counts 26-27', [b.scale2.length, b.scale1.length, b.stsl.tftClaimed.length, b.stsl.notClaimed.length], [9, 7, 4, 4]);
        // Diagnosed payslip: A$3,057.69 fortnight, weekly x = 1528.99.
        const x = 1528.99;
        const w = (rows) => { const r = rows.find((q) => x < q.lt); return r.a * x - r.b; };
        assert('2025-26 scale 2 = 626/fortnight', Math.round(w(a.scale2)) * 2, 626);
        assert('2025-26 STSL = 72/fortnight', Math.round(w(a.stsl.tftClaimed)) * 2, 72);
        assert('2026-27 scale 2 = 616/fortnight', Math.round(w(b.scale2)) * 2, 616);
        assert('2026-27 STSL = 58/fortnight', Math.round(w(b.stsl.tftClaimed)) * 2, 58);
        assert('STSL gates 25-26', [a.stsl.tftClaimed[0].lt, a.stsl.notClaimed[0].lt, b.stsl.tftClaimed[0].lt, b.stsl.notClaimed[0].lt], [1288, 938, 1337, 987]);
        assert('lito', b.lito, { maxOffset: 700, fullUntil: 37500, rate1: 0.05, step1Until: 45000, base2: 325, rate2: 0.015, endsAt: 66667 });
        assert('lito same both years', a.lito, b.lito);
    } },
];
