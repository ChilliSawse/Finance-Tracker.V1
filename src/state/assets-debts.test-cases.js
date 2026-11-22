// Test cases for the "assets-debts" group (registered in src/test-registry.js).
// F2: asset and debt detail (plan section 12, F2.1 to F2.5). Shape: { name, fn(assert) }, assert(label, actual, expected).
// The dagger figures were each recomputed independently (see docs/phase1-changelog/F2.md) and all agree with the plan.

import {
    effectiveAnnualRate, interestEarned, dividendsFor, depreciatedValue, depreciationDiffers, assetValueAt,
    debtStep, debtSchedule, suggestKind, suggestLabel, VEHICLE_DEPRECIATION,
} from '../calc/assets-debts.js';
import { needsAssetDebtMigration, migrateAssetDebtDetail } from './asset-debt-migration.js';
import { runMigrationChain, BACKUP_KEY } from './migration-chain.js';
import { buildSampleHousehold, legacySampleFinanceData } from './sample-data.js';
import { calculateTotals } from '../calc/calculations.js';
import { ASSET_TYPE_TEST_CASES } from './asset-types.test-cases.js';

const SAMPLE_DAY = '2026-11-21';
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
// The sample as it was before step 5b ran on it (the live sample has 5b applied; G6W12-2).
const sample = () => buildSampleHousehold(SAMPLE_DAY, { beforeAssetDebt: true }).data;
const memStorage = () => {
    const m = new Map();
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};
const netWorth = (d) => Math.round(calculateTotals(structuredClone(d)).netWorth * 100);

export const ASSETS_DEBTS_TEST_CASES = [
    ...ASSET_TYPE_TEST_CASES, // DB10: asset types, curves, suggested held out
    { name: 'F2.1 migration on the sample', fn(assert) {
        const d = legacySampleFinanceData();
        const nwBefore = netWorth(d);
        assert('sample net worth is 82,050 (after HELP, FT-R-125) before', nwBefore, 8205000);
        assert('needs the migration', needsAssetDebtMigration(d), true);
        assert('first run changes the data', migrateAssetDebtDetail(d), true);
        assert('net worth 82,050 after', netWorth(d), 8205000);
        assert('asset ids', d.assets.map((a) => a.id), ['a-savings-account', 'a-superannuation', 'a-etf-portfolio']);
        assert('asset kinds', d.assets.map((a) => a.kind), ['cash', 'invested', 'invested']);
        assert('only super is flagged super', d.assets.map((a) => a.isSuper), [false, true, false]);
        assert('kinds are flagged as suggested', d.assets.every((a) => a.kindSuggested === true), true);
        assert('debt labels', d.liabilities.map((l) => l.label), ['bad', 'bad']);
        assert('labels are flagged as suggested', d.liabilities.every((l) => l.labelSuggested === true), true);
        assert('liability ids are added', d.liabilities.map((l) => l.id), ['l-car-loan', 'l-credit-card']);
        assert('income sources get ids', d.incomeSources.map((s) => s.id), ['inc-alex-marketing-coordinator', 'inc-sam-freelance-design']);
        assert('inflation backfilled to 2.5', d.fiSettings.inflation, 2.5);
        assert('version written', d.assetDebtVersion, 1);
        const snap = JSON.stringify(d);
        assert('second run returns false', migrateAssetDebtDetail(d), false);
        assert('second run changes nothing', JSON.stringify(d), snap);
        assert('guard now says nothing pending', needsAssetDebtMigration(d), false);
    } },
    { name: 'F2.1a2 the live sample already has step 5b applied and never takes the backup slot (G6W12-2)', fn(assert) {
        const d = sample();
        assert('sample rate fields are kept by the migration', (() => { migrateAssetDebtDetail(d); return [d.assets[0].interestRate, d.assets[0].interestFrequency, d.assets[2].dividendYield, d.assets[2].dividendFrequency]; })(), [4.8, 'monthly', 3.5, 'quarterly']);
        const live = buildSampleHousehold(SAMPLE_DAY).data;
        assert('live sample: nothing pending, version 1, net worth 82,050', [needsAssetDebtMigration(live), live.assetDebtVersion, netWorth(live)], [false, 1, 8205000]);
        assert('live sample has asset ids and the inflation default', [live.assets.map((a) => a.id), live.fiSettings.inflation], [['a-savings-account', 'a-superannuation', 'a-etf-portfolio'], 2.5]);
        assert('live sample is the pre-5b sample after the migration (same data)', JSON.stringify(live.assets), JSON.stringify(d.assets));
        const st = memStorage();
        const res = runMigrationChain(live, { raw: JSON.stringify(live), source: 'load', storage: st });
        assert('chain over the live sample writes no backup', [res.backedUp, st.m.has(BACKUP_KEY)], [false, false]);
    } },
    { name: 'F2.1g step 5b ignores rows that are not objects, the same before and after (G6W12-9)', fn(assert) {
        for (const [label, odd] of [['null', null], ['a number', 3], ['a string', 'x'], ['an array', [1, 2]]]) {
            const d = sample();
            d.assets.splice(1, 0, odd);
            d.liabilities.push(odd);
            const nw = netWorth({ ...d, assets: d.assets.filter((r) => r && typeof r === 'object' && !Array.isArray(r)), liabilities: d.liabilities.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) });
            let result;
            try { result = migrateAssetDebtDetail(d); } catch (err) { result = 'threw ' + err.message; }
            assert(label + ': migration completes', result, true);
            assert(label + ': version written', d.assetDebtVersion, 1);
            assert(label + ': the odd rows are left exactly where they were', [d.assets[1], d.liabilities[d.liabilities.length - 1]], [odd, odd]);
            assert(label + ': real rows migrated, names and balances kept', [d.assets.filter((r) => r && typeof r === 'object' && !Array.isArray(r)).map((a) => [a.name, a.balance, a.id !== undefined]), d.liabilities[0].balance], [[['Savings account', 16500, true], ['Superannuation', 78400, true], ['ETF portfolio', 24800, true]], 11200]);
            assert(label + ': net worth unchanged', netWorth({ ...d, assets: d.assets.filter((r) => r && typeof r === 'object' && !Array.isArray(r)), liabilities: d.liabilities.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) }), nw);
        }
    } },
    { name: 'F2.1b migration never touches names, balances or rates, adds only absent fields', fn(assert) {
        const d = sample();
        d.assets[0].kind = 'cash';
        d.assets[0].interestRate = 2.25;
        d.assets.push({ name: 'Savings account', balance: 5, id: 'a-custom', kind: 'invested', isSuper: false });
        d.assets.push({ name: 'Savings account', balance: 7 });
        d.liabilities[0].minRepayment = 310;
        d.liabilities[0].label = 'good';
        d.liabilities[1].id = undefined;
        d.liabilities[1].interestType = 'fixed';
        d.incomeSources[1].id = 'mine';
        const before = structuredClone(d);
        migrateAssetDebtDetail(d);
        const same = (rows, ro) => rows.every((r, i) => r.name === ro[i].name && r.balance === ro[i].balance && r.interestRate === ro[i].interestRate);
        assert('names, balances and rates unchanged (assets)', d.assets.every((a, i) => a.name === before.assets[i].name && a.balance === before.assets[i].balance), true);
        assert('names, balances and rates unchanged (debts)', same(d.liabilities, before.liabilities), true);
        assert('a set kind is not overwritten or flagged', [d.assets[0].kind, d.assets[0].kindSuggested, d.assets[0].interestRate], ['cash', false, 2.25]);
        assert('an existing id is kept', d.assets[3].id, 'a-custom');
        assert('a collision gets -2 (the first free slug)', d.assets[4].id, 'a-savings-account-2');
        assert('an existing minimum and label are kept', [d.liabilities[0].minRepayment, d.liabilities[0].label, d.liabilities[0].labelSuggested], [310, 'good', false]);
        assert('a missing liability id is added', d.liabilities[1].id, 'l-credit-card');
        assert('a set interest type is kept', d.liabilities[1].interestType, 'fixed');
        assert('an existing income id is kept', d.incomeSources[1].id, 'mine');
    } },
    { name: 'F2.1c chain: byte-exact backup first, abort writes nothing', fn(assert) {
        const d = sample();
        const raw = JSON.stringify(d);
        const st = memStorage();
        let saves = 0;
        const res = runMigrationChain(d, { raw, source: 'load', storage: st, forceSave: () => { saves++; } });
        assert('chain changed and did not abort', [res.changed, res.aborted, res.backedUp], [true, false, true]);
        assert('backup is the old save byte for byte', st.m.get(BACKUP_KEY), raw);
        assert('one forced save', saves, 1);
        assert('migrated through the chain', d.assetDebtVersion, 1);
        const second = runMigrationChain(d, { raw: JSON.stringify(d), source: 'load', storage: st });
        assert('second chain run changes nothing', [second.changed, second.aborted], [false, false]);

        // The totals check: a balance that moves aborts without writing the version.
        const bad = sample();
        const orig = structuredClone(bad);
        let threw = '';
        try { migrateAssetDebtDetail(bad, { afterApply: (x) => { x.assets[0].balance += 1; } }); } catch (err) { threw = err.message; }
        assert('abort throws a readable message', threw.startsWith('Asset and debt check failed'), true);
        assert('abort does not write the version', bad.assetDebtVersion, undefined);
        const bad2 = structuredClone(orig);
        const st2 = memStorage();
        const modules = [{
            name: 'migrateAssetDebtDetail', needs: needsAssetDebtMigration, backupGate: true, afterImport: () => false,
            migrate: (x) => migrateAssetDebtDetail(x, { afterApply: (y) => { y.liabilities[0].balance += 5; } }),
        }];
        const aborted = runMigrationChain(bad2, { raw: JSON.stringify(orig), source: 'load', storage: st2, modules });
        assert('chain reports aborted', aborted.aborted, true);
        assert('data is left exactly as it was', JSON.stringify(bad2), JSON.stringify(orig));
    } },
    { name: 'F2.1e an old-shape sample goes through the whole chain', fn(assert) {
        const d = legacySampleFinanceData();
        const raw = JSON.stringify(d);
        const st = memStorage();
        const nw = netWorth(d);
        const res = runMigrationChain(d, { raw, source: 'load', storage: st });
        assert('chain ran clean with a backup', [res.aborted, res.backedUp, res.errors], [false, true, []]);
        assert('backup is the old save byte for byte', st.m.get(BACKUP_KEY) === raw, true);
        assert('asset ids', d.assets.map((a) => a.id), ['a-savings-account', 'a-superannuation', 'a-etf-portfolio']);
        assert('net worth unchanged by the chain (82,050)', [nw, netWorth(d)], [8205000, 8205000]);
        assert('inflation backfilled', d.fiSettings.inflation, 2.5);
        const again = runMigrationChain(d, { raw: JSON.stringify(d), source: 'load', storage: st });
        assert('second chain run is a no-op', [again.changed, again.aborted], [false, false]);
    } },
    { name: 'F2.1d suggestions', fn(assert) {
        const k = (n) => suggestKind(n);
        assert('Super', k('Superannuation'), { kind: 'invested', isSuper: true });
        assert('ETF, shares, fund', [k('ETF portfolio').kind, k('Vanguard shares').kind, k('Index fund').kind], ['invested', 'invested', 'invested']);
        assert('Savings, Offset, Cash', [k('Savings account').kind, k('Mortgage offset').kind, k('Cash').kind], ['cash', 'cash', 'cash']);
        assert('Car and vehicle', [k('Car').kind, k('Work vehicle').kind], ['depreciating', 'depreciating']);
        assert('House and property', [k('House').kind, k('Investment property').kind], ['appreciating', 'appreciating']);
        assert('unmatched is cash', k('Raiz').kind, 'cash');
        assert('empty name is cash', k('').kind, 'cash');
        const l = suggestLabel;
        assert('good labels', [l('Home loan'), l('Mortgage'), l('Investment loan'), l('Study loan'), l('HECS')], ['good', 'good', 'good', 'good', 'good']);
        assert('bad labels', [l('Credit card'), l('Car loan'), l('Personal loan'), l('Afterpay')], ['bad', 'bad', 'bad', 'bad']);
        assert('else null', l('Loan from Dad'), null);
    } },
    { name: 'F2.2 rates', fn(assert) {
        assert('4.8% paid monthly is (1+0.004)^12 - 1', near(effectiveAnnualRate(4.8, 'monthly'), Math.pow(1.004, 12) - 1), true);
        assert('effective rate is above nominal', effectiveAnnualRate(4.8, 'monthly') > 0.048, true);
        assert('yearly compounding is the nominal rate', near(effectiveAnnualRate(5, 'yearly'), 0.05), true);
        assert('unset rate is 0', effectiveAnnualRate(null, 'monthly'), 0);
        assert('16,500 for 12 months earns 809.66', interestEarned(16500, 4.8, 'monthly', 1), 809.66);
        assert('half a year is less than half the year (compounding)', interestEarned(16500, 4.8, 'monthly', 0.5) < 809.66 / 2 + 0.5, true);
        const div = dividendsFor(24800, 3.5, 'quarterly');
        assert('dividends 868.00 a year', div.annual, 868);
        assert('217.00 a quarter', div.perPeriod, 217);
        assert('monthly dividends', dividendsFor(24800, 3.5, 'monthly').perPeriod, 72.33);
    } },
    { name: 'F2.3 debt schedule', fn(assert) {
        const debt = { balance: 10000, interestRate: 12, compounding: 'monthly', repaymentFrequency: 'monthly', minRepayment: 500 };
        const s = debtSchedule(debt);
        const identity = 10000 * Math.pow(1.01, 12) - 500 * (Math.pow(1.01, 12) - 1) / 0.01;
        // The plan's 4,927.00 is the closed form (4,926.9988). The schedule rounds each month's interest to the cent,
        // so its balance is 4,927.01: a one-cent rounding difference, explained here, not edited away.
        assert('the closed form is 4,927.00', Math.round(identity * 100), 492700);
        assert('balance after 12 months, cent by cent, is 4,927.01', s.balanceAfter(12), 492701);
        assert('the schedule is within one cent of the closed form', Math.abs(s.balanceAfter(12) / 100 - identity) < 0.0125, true);
        assert('clears in 23 months', s.periodsToClear, 23);
        assert('total interest is 1,213.48', s.totalInterestCents, 121348);
        assert('paid = principal + interest, to the cent', s.totalPaidCents, 1000000 + s.totalInterestCents);
        assert('last payment is smaller than 500', s.rows[22].paidCents < 50000, true);
        assert('balance after it clears is 0', s.balanceAfter(40), 0);
        assert('balance at 0 is the start', s.balanceAfter(0), 1000000);
        const step = debtStep({ balanceCents: 1000000, ratePct: 12, compounding: 'monthly', repaymentFrequency: 'monthly', paymentCents: 50000 });
        assert('one step', step, { balanceCents: 950000 + 10000, interestCents: 10000, paidCents: 50000 });
        const stuck = debtSchedule({ ...debt, minRepayment: 100 });
        assert('payment equal to interest never clears', [stuck.cleared, stuck.periodsToClear], [false, Infinity]);
        const none = debtSchedule({ ...debt, minRepayment: null }, { maxPeriods: 12 });
        assert('unknown minimum never clears and stops at the cap', [none.cleared, none.rows.length], [false, 12]);
        const weekly = debtSchedule({ balance: 1000, interestRate: 0, repaymentFrequency: 'weekly', minRepayment: 250 });
        assert('0% weekly clears in 4', weekly.periodsToClear, 4);
        const fixed = debtSchedule({ balance: 10000, interestRate: 4, interestType: 'fixed', fixedUntil: '2027-02-15', rateAfterFixed: 8, repaymentFrequency: 'monthly', minRepayment: 500 }, { startDate: '2027-01-01', maxPeriods: 3 });
        assert('4% to 15 Feb (33.33), then 8% from the 1 Mar repayment (63.56, then 60.65)', fixed.rows.map((r) => r.interestCents), [3333, 6356, 6065]);
    } },
    { name: 'F2.4 depreciation', fn(assert) {
        const car = (extra) => ({ balance: 20000, kind: 'depreciating', depreciation: { method: 'declining', ratePct: 15, lifeYears: 10, residual: 0, purchasePrice: 30000, purchaseDate: '2021-11-21', ...extra } });
        assert('30,000 declining 15% for 5 years = 13,311.16', depreciatedValue(car(), '2026-11-21'), 13311.16);
        assert('straight line, 10 year life, 5 years = 15,000.00', depreciatedValue(car({ method: 'straight' }), '2026-11-21'), 15000);
        assert('straight line stops at the residual', depreciatedValue(car({ method: 'straight', residual: 4000 }), '2040-11-21'), 4000);
        assert('declining never drops below the residual', depreciatedValue(car({ residual: 9000 }), '2040-11-21'), 9000);
        assert('before purchase it is the price', depreciatedValue(car(), '2020-01-01'), 30000);
        assert('no purchase detail gives null (balance stays the truth)', depreciatedValue({ balance: 5, depreciation: { method: 'declining', ratePct: 15 } }, '2026-11-21'), null);
        assert('no depreciation record gives null', depreciatedValue({ balance: 5 }, '2026-11-21'), null);
        assert('20,000 entered vs 13,311.16 worked out differs by more than 5%', depreciationDiffers(car(), '2026-11-21'), true);
        assert('close to the balance does not', depreciationDiffers({ ...car(), balance: 13500 }, '2026-11-21'), false);
        assert('vehicle defaults are the ATO shape', VEHICLE_DEPRECIATION, { lifeYears: 8, decliningRatePct: 25, straightRatePct: 12.5 });
        assert('25% x 8 years and 12.5% x 8 years are 200% and 100%', [VEHICLE_DEPRECIATION.decliningRatePct * 8, VEHICLE_DEPRECIATION.straightRatePct * 8], [200, 100]);
        const fromBalance = assetValueAt({ balance: 30000, kind: 'depreciating', kindSuggested: false, depreciation: { method: 'declining', ratePct: 15, residual: 0 } }, 5);
        assert('assetValueAt decays the entered balance', fromBalance, 13311.16);
        const migrated = sample();
        migrated.assets.push({ name: 'Family car', balance: 18000 });
        migrateAssetDebtDetail(migrated);
        const fc = migrated.assets[3];
        assert('a migrated car is a suggested depreciating asset with the vehicle defaults', [fc.kind, fc.kindSuggested, fc.depreciation.ratePct, fc.depreciation.lifeYears], ['depreciating', true, 25, 8]);
        assert('until confirmed it is flat', assetValueAt(fc, 5), 18000);
    } },
    { name: 'F2.5 appreciating and the other kinds', fn(assert) {
        const house = { balance: 600000, kind: 'appreciating', kindSuggested: false, growthRate: 1.5 };
        assert('600,000 at 1.5% real for 10 years = 696,324.50', assetValueAt(house, 10), 696324.5);
        assert('blank growth is flat in today\'s dollars', assetValueAt({ ...house, growthRate: null }, 10), 600000);
        assert('inflation turns a nominal rate real', near(assetValueAt({ ...house, growthRate: 4 }, 10, { inflationPct: 2.5 }), Math.round(600000 * Math.pow(1.04 / 1.025, 10) * 100) / 100, 0.011), true);
        assert('years 0 is the balance', assetValueAt(house, 0), 600000);
        const cash = { balance: 16500, kind: 'cash', kindSuggested: false, interestRate: 4.8, interestFrequency: 'monthly' };
        assert('cash earns the effective rate', assetValueAt(cash, 1), 17309.66);
        assert('unconfirmed kind is flat', assetValueAt({ ...cash, kindSuggested: true }, 10), 16500);
        assert('unset cash rate is flat', assetValueAt({ ...cash, interestRate: null }, 10), 16500);
        const etf = { balance: 24800, kind: 'invested', kindSuggested: false, expectedReturn: 7 };
        assert('invested grows at the total return', assetValueAt(etf, 1), 26536);
        assert('reinvesting dividends does not change the total', assetValueAt({ ...etf, dividendYield: 3.5, reinvestDividends: false }, 1), 26536);
        assert('missing asset is 0', assetValueAt(null, 3), 0);
    } },
];
