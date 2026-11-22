// FT-0032 DB10 (R3 step R7): asset types, value curves, and the FT-R-125 net worth and FI scope.
// Spread into the "assets-debts" group (ASSET_TYPE_TEST_CASES) and the "fi" group (FI_SCOPE_TEST_CASES).
// The types here are small made-up ones in the real file's shape; the real 65 types are checked by `npm run ref:check`.

import { matchAssetType, appKindOf, suggestFromName, typeFill, applyTypeSuggestion, confirmType } from '../calc/asset-types.js';
import { curvePct, factorAt } from '../calc/value-curve.js';
import { assetValueAt, valueDetail, assetScope, depreciatedValue, effectiveAsset, claimField } from '../calc/assets-debts.js';
import { runPlan, projectNetWorth, fiNumber, fiAge } from '../calc/fi.js';
import { calculateTotals } from '../calc/calculations.js';
import { migrateAssetScope, needsAssetScopeMigration } from './asset-scope-migration.js';
import { runMigrationChain } from './migration-chain.js';
import { buildSampleHousehold } from './sample-data.js';
import { migrateAssetDebtDetail } from './asset-debt-migration.js';

const TODAY = '2026-11-21';
const r2 = (x) => Math.round(x * 100) / 100;

const CAR = {
    id: 'car', kind: 'depreciating', match: ['car', 'family car'], exclude: ['car park'],
    defaults: { depreciation: { method: 'diminishing', ratePct: 8.9, residual: 0 } },
    curve: [{ year: 0, pctOfPricePaid: 100 }, { year: 1, pctOfPricePaid: 80 }, { year: 2, pctOfPricePaid: 60 }, { year: 3, pctOfPricePaid: 50 }],
    powertrainFactor: { petrol: 1, diesel: 1, ev: [{ year: 1, factor: 0.8 }, { year: 3, factor: 0.6 }, { year: 10, factor: 0.5 }] },
    counts: { netWorth: 'resale', fi: false },
};
const TYPES = [
    CAR,
    { id: 'big_car', kind: 'depreciating', match: ['family car'], exclude: [], defaults: { depreciation: null }, curve: null, counts: { fi: false } },
    { id: 'motorhome', kind: 'depreciating', match: ['motorhome'], defaults: { depreciation: null }, counts: { fi: false } },
    { id: 'watch', kind: 'stable', legacyKind: 'depreciating', match: ['rolex'], defaults: { depreciation: { method: 'diminishing', ratePct: 0, residual: 0 } }, curve: [{ year: 0, pctOfNew: 100 }, { year: 5, pctOfNew: 100 }], counts: { fi: false } },
    { id: 'house', kind: 'appreciating', match: ['house', 'home'], defaults: { growthRate: 5 }, counts: { fi: 'useSwitch' } },
    { id: 'etf', kind: 'invested', match: ['etf'], defaults: { expectedReturn: 8 }, counts: { fi: true } },
    { id: 'crypto', kind: 'invested', match: ['crypto', 'bitcoin'], defaults: { expectedReturn: null }, counts: { fi: true, rateMode: 'noReliableRate' } },
    { id: 'super_growth', kind: 'invested', isSuper: true, match: ['super'], defaults: { expectedReturn: 6.5 }, counts: { fi: true, fiFromAge: 60 } },
    { id: 'offset', kind: 'cash', match: ['offset', 'offset account'], defaults: { interestRate: null }, counts: { showAs: 'cash', loanShownInFull: true } },
    { id: 'cpi', kind: 'setting', legacyKind: null, match: [], defaults: { inflationPct: 2.5 } },
];

const flat = (o) => () => ({ dateIso: TODAY, inflationPct: 0, expectedReturnPct: 7, fiNumber: 0, fireYear: 0, superYear: 0, ...o });

export const ASSET_TYPE_TEST_CASES = [
    {
        name: 'DB10.1 the app matcher: longest phrase wins, exclude vetoes, a tie goes to the first type, no match falls back to suggestKind',
        fn(assert) {
            assert('"Family car" picks the two-word phrase (first type on the tie)', matchAssetType('Family car', TYPES).type.id, 'car');
            assert('"Car park" is vetoed', matchAssetType('Car park', TYPES), null);
            assert('whole words only: "carpet" is not a car', matchAssetType('Carpet', TYPES), null);
            assert('case and punctuation do not matter', matchAssetType('MY  car!', TYPES).type.id, 'car');
            assert('a setting has no app kind', appKindOf(TYPES[9]), null);
            assert('stable maps to depreciating through legacyKind', appKindOf(TYPES[3]), 'depreciating');
            assert('a name no type matches uses the old suggestKind', suggestFromName('Savings account', TYPES), { kind: 'cash', isSuper: false, typeId: null, type: null, source: 'fallback' });
            assert('no types at all (offline): the fallback', suggestFromName('Ute', []).source, 'fallback');
            assert('a matched type gives its kind and super flag', [suggestFromName('Super', TYPES).kind, suggestFromName('Super', TYPES).isSuper, suggestFromName('Super', TYPES).typeId], ['invested', true, 'super_growth']);
        },
    },
    {
        name: 'DB10.2 curves: straight lines between the listed years, the last value held; powertrain factor 1 at year 0 and the last factor held',
        fn(assert) {
            const pts = [{ year: 0, pct: 100 }, { year: 1, pct: 80 }, { year: 3, pct: 50 }];
            assert('at a listed year', curvePct(pts, 1), 80);
            assert('halfway between year 1 and 3 (year 2): 65', curvePct(pts, 2), 65);
            assert('0.5 years: 90', curvePct(pts, 0.5), 90);
            assert('past the last year the last value is held', curvePct(pts, 12), 50);
            assert('no points: null', curvePct([], 1), null);
            const ev = [{ year: 1, factor: 0.8 }, { year: 3, factor: 0.6 }, { year: 10, factor: 0.5 }];
            assert('factor at year 0 is 1', factorAt(ev, 0), 1);
            assert('factor at year 2 is 0.7', r2(factorAt(ev, 2)), 0.7);
            assert('factor at year 6.5 is halfway 3 to 10', r2(factorAt(ev, 6.5)), 0.55);
            assert('the year-10 factor is held after year 10', factorAt(ev, 25), 0.5);
            assert('petrol (no list) is 1', factorAt(null, 5), 1);
        },
    },
    {
        name: 'DB10.3 value from a curve moves the entered balance by the curve ratio; the powertrain factor rides on it',
        fn(assert) {
            const fill = typeFill(CAR, { powertrain: 'ev' });
            const car = { name: 'Car', balance: 12000, kind: 'depreciating', kindSuggested: false, ...fill.fields, typeSuggested: false,
                depreciation: { method: 'diminishing', ratePct: 8.9, purchasePrice: 20000, purchaseDate: '2024-11-21' } };
            // age 2: curve 60% x factor 0.7 = 0.42; age 3: 50% x 0.6 = 0.30 -> 12,000 x 0.30 / 0.42
            const d = valueDetail(car, 1, { asOf: TODAY });
            assert('balance x curve(3) / curve(2) with the EV factor', d.value, r2(12000 * 0.3 / 0.42));
            assert('from a curve, not the fallback', [d.source, d.fallback], ['curve', false]);
            assert('petrol: 12,000 x 50 / 60', assetValueAt({ ...car, valueCurve: { ...car.valueCurve, factors: null } }, 1, { asOf: TODAY }), 10000);
            assert('now is the entered balance', assetValueAt(car, 0, { asOf: TODAY }), 12000);
            assert('the offer beside the balance: price x curve(2) x factor(2) = 20,000 x 0.42', depreciatedValue(car, TODAY), 8400);
            assert('the entered balance is never rewritten', car.balance, 12000);
        },
    },
    {
        name: 'DB10.4 a null curve falls back to the type rate, then the app default, and says so; stable is flat',
        fn(assert) {
            const dep = { method: 'diminishing', ratePct: 10, purchasePrice: null, purchaseDate: null };
            const withRate = { name: 'X', balance: 10000, kind: 'depreciating', kindSuggested: false, assetType: 'x', typeSuggested: false, depreciation: dep, valueCurve: null };
            const a = valueDetail(withRate, 2);
            assert('the type rate: 10,000 x 0.9^2, marked fallback', [a.value, a.source, a.fallback], [8100, 'rate', true]);
            const none = { ...withRate, depreciation: null };
            const b = valueDetail(none, 1);
            assert('no curve, no rate: the app default 25% a year, marked fallback', [b.value, b.source, b.fallback], [7500, 'appDefault', true]);
            const hasCurveNoDate = { ...withRate, valueCurve: { points: [{ year: 0, pct: 100 }, { year: 5, pct: 50 }], factors: null } };
            assert('a curve with no purchase date cannot place the balance: the rate, marked fallback', valueDetail(hasCurveNoDate, 1).source, 'rate');
            const fill = typeFill(TYPES[3]);
            assert('stable types are marked flat', fill.fields.valueStable, true);
            const watch = { name: 'Watch', balance: 9000, kind: 'depreciating', kindSuggested: false, ...fill.fields, typeSuggested: false };
            assert('stable is flat for 20 years', [assetValueAt(watch, 20, { asOf: TODAY }), valueDetail(watch, 20).source], [9000, 'stable']);
            assert('stable never counts toward FI, but is not suggested lost value', assetScope(watch), { fi: 'no', reason: 'stable' });
            assert('a motorhome type with no rate and no curve fills no rule', typeFill(TYPES[2]).filled, []);
        },
    },
    {
        name: 'DB10.5 crypto is flat and never takes the 7% default return (FT-R-125)',
        fn(assert) {
            const crypto = { name: 'Bitcoin', balance: 10000, kind: 'invested', kindSuggested: false, ...typeFill(TYPES[6]).fields, typeSuggested: false };
            assert('the type gives no return and the no-reliable-rate mode', [crypto.expectedReturn, crypto.rateMode], [undefined, 'noReliableRate']);
            assert('assetValueAt: flat', assetValueAt(crypto, 10), 10000);
            const other = { name: 'ETF', balance: 10000, kind: 'invested', kindSuggested: false, expectedReturn: null };
            const run = (a) => runPlan({ assets: [a] }, flat({ fiNumber: 1e9 }), { years: 2, untilFI: false }).path;
            assert('in the plan an ordinary invested asset with no return takes the 7% default', r2(run(other)[2].invested), r2(10000 * 1.07 * 1.07));
            assert('crypto stays flat in the plan', run(crypto).map((p) => p.invested), [10000, 10000, 10000]);
            assert('even a typed return does not move it (the person did not give one)', run({ ...crypto, expectedReturn: 12 })[1].invested, 10000);
        },
    },
    {
        name: 'DB10.6 a type\'s rate and curve stay suggested until confirmed, and never feed the maths (FT-R-117, FT-R-126)',
        fn(assert) {
            const etf = { name: 'ETF', balance: 10000, kind: 'invested', kindSuggested: false };
            assert('applied: suggested, kind kept', [applyTypeSuggestion(etf, TYPES[5]), etf.typeSuggested, etf.expectedReturn, etf.typeFilled], [true, true, 8, ['expectedReturn']]);
            assert('a suggested rate is held out: flat', assetValueAt(etf, 1), 10000);
            assert('and in the plan the suggested rate is not read: the plan default applies, not 8%', r2(runPlan({ assets: [etf] }, flat({ fiNumber: 1e9 }), { years: 1, untilFI: false }).path[1].invested), 10700);
            confirmType(etf);
            assert('confirmed: 8% feeds the maths', assetValueAt(etf, 1), 10800);
            assert('a confirmed type is never re-applied by an update', applyTypeSuggestion(etf, { ...TYPES[5], defaults: { expectedReturn: 3 } }), false);
            const typed = { name: 'ETF', balance: 10000, kind: 'invested', kindSuggested: false, expectedReturn: 9 };
            applyTypeSuggestion(typed, TYPES[5]);
            assert('a rate the person typed is never replaced', typed.expectedReturn, 9);
            const car = { name: 'Car', balance: 10000, kind: 'depreciating', kindSuggested: false, depreciation: { method: 'diminishing', ratePct: 25, lifeYears: 8, residual: 0, purchasePrice: 30000, purchaseDate: '2024-11-21' } };
            applyTypeSuggestion(car, CAR);
            assert('a suggested car type: its curve is held out; the person own 25% rule still runs (10,000 x 0.75^3)', assetValueAt(car, 3, { asOf: TODAY }), 4218.75);
            const bare = { name: 'Van', balance: 10000, kind: 'depreciating', kindSuggested: false, assetType: 'x', typeSuggested: true, typeFilled: ['depreciation'], depreciation: { method: 'diminishing', ratePct: 20 } };
            assert('a rule only the type filled is flat on the future path, not the app default', [assetValueAt(bare, 5), valueDetail(bare, 5).source], [10000, 'suggested']);
            assert('the purchase price and date already entered are kept', [car.depreciation.purchasePrice, car.depreciation.purchaseDate], [30000, '2024-11-21']);
            confirmType(car);
            assert('confirmed: the curve feeds the value (age 2 to 3: 10,000 x 50 / 60)', assetValueAt(car, 1, { asOf: TODAY }), 8333.33);
            const conflict = { name: 'Savings', balance: 1, kind: 'cash', kindSuggested: false };
            assert('a type of another kind than the confirmed kind is refused', applyTypeSuggestion(conflict, CAR), false);
        },
    },
    {
        name: 'DB10.7 offset account: cash, the loan in full (FT-R-125)',
        fn(assert) {
            assert('the name is cash by the old fallback too', suggestFromName('Offset account', []).kind, 'cash');
            const fill = typeFill(TYPES[8]);
            assert('the type shows as cash, with no interest rate invented', [fill.fields.kind, fill.fields.isOffset, fill.fields.interestRate], ['cash', true, undefined]);
            const d = { assets: [{ name: 'Offset', balance: 50000, kind: 'cash' }], liabilities: [{ name: 'Home loan', balance: 400000 }], incomeSources: [] };
            const t = calculateTotals(d);
            assert('net worth: 50,000 less the whole 400,000 loan, not netted into 350,000 of debt', [t.currentAssets, t.currentLiabilities, t.netWorth], [50000, 400000, -350000]);
        },
    },
    {
        name: 'DB10.8 migration: a property defaults to live-in and suggested; idempotent; round-trips a backup; the multiple is kept or repaired',
        fn(assert) {
            const d = { assets: [{ name: 'Home', balance: 1, kind: 'appreciating' }, { name: 'Cash', balance: 1, kind: 'cash' }, { name: 'Flat', balance: 1, kind: 'appreciating', use: 'investment', useSuggested: false }], fiSettings: { multiple: 30 } };
            assert('pending before', needsAssetScopeMigration(d), true);
            assert('changed', migrateAssetScope(d), true);
            assert('home: live-in, suggested', [d.assets[0].use, d.assets[0].useSuggested], ['liveIn', true]);
            assert('cash gets no field', 'use' in d.assets[1], false);
            assert('a person\'s own answer is kept', [d.assets[2].use, d.assets[2].useSuggested], ['investment', false]);
            assert('their multiple is kept, the version is set', [d.fiSettings.multiple, d.assetScopeVersion], [30, 1]);
            const snap = JSON.stringify(d);
            assert('second run: nothing', [migrateAssetScope(d), JSON.stringify(d)], [false, snap]);
            const back = JSON.parse(JSON.stringify(d));
            assert('a backup round trip keeps the fields and needs nothing', [needsAssetScopeMigration(back), back.assets[0].use, back.assets[0].useSuggested], [false, 'liveIn', true]);
            const bad = { assets: [], fiSettings: { multiple: 0 } };
            migrateAssetScope(bad);
            assert('an unusable multiple becomes 25', bad.fiSettings.multiple, 25);
            const through = { dataVersion: 2, savingModel: { version: 1 }, assetDebtVersion: 1, assets: [{ name: 'House', balance: 5, kind: 'appreciating' }], incomeSources: [], allocation: [] };
            runMigrationChain(through, { storage: null });
            assert('through the chain', [through.assetScopeVersion, through.assets[0].use], [1, 'liveIn']);
        },
    },
    {
        name: 'DB10.14 a type never overrides what the person chose; super and rate mode are suggested too and undone while suggested; an edit makes a field theirs',
        fn(assert) {
            const SUP = TYPES[7];
            const chosen = { name: 'Fund', balance: 300000, kind: 'invested', kindSuggested: false, isSuper: false, expectedReturn: null };
            assert('a kind the person confirmed as not super: the super flag is not put over it', [applyTypeSuggestion(chosen, SUP), chosen.isSuper], [true, false]);
            const fiOf = (a) => runPlan({ assets: [a] }, flat({ fiNumber: 1e12 }), { years: 0, untilFI: false }).path[0].fiNetWorth;
            assert('so its 300,000 still counts toward FI at 40', runPlan({ assets: [chosen] }, flat({ fiNumber: 1e12, age: 40 }), { years: 0, untilFI: false }).path[0].fiNetWorth, 300000);
            const open = { name: 'Fund', balance: 300000, kind: 'invested', kindSuggested: true, isSuper: false };
            applyTypeSuggestion(open, SUP);
            assert('a suggested super flag is recorded as type-filled', [open.isSuper, open.typeFilled.includes('isSuper')], [true, true]);
            // DB11, FT-R-128 1: a suggested kind is held out of FI whatever it is (it was counted as cash: 'yes', 300,000).
            assert('and held out of the maths: no super lock while only suggested; the kind itself is held out until confirmed (FT-R-128 1)', [effectiveAsset(open).isSuper, assetScope(effectiveAsset(open)).fi, fiOf(open)], [false, 'no', 0]);
            assert('with the kind confirmed and the super flag still only suggested, it counts with no lock', fiOf({ ...open, kindSuggested: false }), 300000);
            const crypto = { name: 'BTC', balance: 1, kind: 'invested', kindSuggested: false };
            applyTypeSuggestion(crypto, TYPES[6]);
            assert('rateMode is tracked as type-filled and undone while suggested', [crypto.rateMode, crypto.typeFilled.includes('rateMode'), effectiveAsset(crypto).rateMode], ['noReliableRate', true, null]);
            const etf = { name: 'ETF', balance: 10000, kind: 'invested', kindSuggested: false };
            applyTypeSuggestion(etf, TYPES[5]);
            claimField(etf, 'expectedReturn');
            etf.expectedReturn = 6;
            assert('an edited field leaves typeFilled and feeds the maths while the type stays suggested', [etf.typeFilled, etf.typeSuggested, assetValueAt(etf, 1)], [[], true, 10600]);
            const k = { name: 'x', balance: 1, kind: 'cash', kindSuggested: true };
            claimField(k, 'kind');
            assert('editing the kind confirms it', k.kindSuggested, false);
        },
    },
    {
        name: 'DB10.15 a percent-of-new curve on a second-hand item needs its age and new price; both bases are handled',
        fn(assert) {
            const curve = { points: [{ year: 0, pct: 100 }, { year: 1, pct: 80 }, { year: 2, pct: 60 }, { year: 4, pct: 20 }], factors: null };
            const mk = (basis, dep) => ({ name: 'Phone', balance: 300, kind: 'depreciating', kindSuggested: false, valueCurve: { ...curve, basis }, depreciation: { method: 'diminishing', ratePct: 30, ...dep } });
            const paid = mk('pricePaid', { purchasePrice: 1000, purchaseDate: '2025-11-21' });
            assert('price paid, 1 year held: 1,000 x 80%', depreciatedValue(paid, TODAY), 800);
            const bnew = mk('new', { purchasePrice: 1000, purchaseDate: '2025-11-21', boughtNew: true });
            assert('percent of new, bought new: the same as price paid', depreciatedValue(bnew, TODAY), 800);
            const second = mk('new', { purchasePrice: 400, purchaseDate: '2025-11-21', newPrice: 1000, ageAtPurchase: 1 });
            assert('second-hand: 1,000 new x curve(1 + 1 years) = 600, not 400 x 80%', depreciatedValue(second, TODAY), 600);
            const unknown = mk('new', { purchasePrice: 400, purchaseDate: '2025-11-21' });
            assert('second-hand with no age or new price: no offer (the data is missing)', depreciatedValue(unknown, TODAY), null);
            assert('projection from the balance reads the item age (2 to 3 years: 300 x 40 / 60)', valueDetail(second, 1, { asOf: TODAY }).value, 200);
            const u = valueDetail(unknown, 1, { asOf: TODAY });
            assert('with the age unknown the balance projection falls back to the rate, marked', [u.source, u.fallback], ['rate', true]);
        },
    },
];

// ---- FI scope ----
const car = { id: 'a-car', name: 'Car', balance: 20000, kind: 'depreciating', kindSuggested: false, depreciation: { method: 'declining', ratePct: 25 } };
const homeLive = { id: 'a-home', name: 'Home', balance: 600000, kind: 'appreciating', kindSuggested: false, use: 'liveIn', useSuggested: false, growthRate: null };
const homeInv = { id: 'a-inv', name: 'Rental', balance: 400000, kind: 'appreciating', kindSuggested: false, use: 'investment', useSuggested: false };
const cashA = { id: 'a-cash', name: 'Savings', balance: 10000, kind: 'cash', kindSuggested: false };

export const FI_SCOPE_TEST_CASES = [
    {
        name: 'DB10.16 a Fire super top-up target puts the money in super (locked until 60); with no super target the rest goes to invested',
        fn(assert) {
            const run = (sinks, age) => runPlan({ sinks }, flat({ fiNumber: 1e12, fireYear: 10000, expectedReturnPct: 0, age }), { years: 1, untilFI: false }).path[1];
            const a = run([{ type: 'super' }], 40);
            assert('10,000 of top-up lands in super, locked at 40', [a.superBal, a.superLocked, a.fiNetWorth, a.netWorth], [10000, 10000, 0, 10000]);
            const b = run([{ type: 'super' }], 61);
            assert('at 61 the same money counts', [b.superBal, b.fiNetWorth], [10000, 10000]);
            const c = run([], 40);
            assert('no super target: invested, counted', [c.superBal, c.invested, c.fiNetWorth], [0, 10000, 10000]);
            const d = run([{ type: 'home', capacity: 4000 }, { type: 'super' }], 40);
            assert('a target before it takes its share first: 4,000 to the home pot, 6,000 to super', [d.cash, d.superBal], [4000, 6000]);
        },
    },
    {
        name: 'DB10.17 one birth-year source for the FI age and the super unlock, and the age moves each year',
        fn(assert) {
            const d = { assets: [{ id: 'a-s', name: 'Super', balance: 100000, kind: 'invested', kindSuggested: false, isSuper: true }], liabilities: [], incomeSources: [], fiSettings: { multiple: 25, inflation: 2.5, expectedReturn: 7, birthYears: [1990] } };
            assert('birthYears only: fiAge sees it (it used to read people only)', fiAge(d, 10, { today: TODAY }).ages, [{ name: '', age: 46 }]);
            const withPeople = { ...d, people: [{ name: 'Sam', birthYear: 1970 }] };
            assert('people given: the same list feeds both', [fiAge(withPeople, 0, { today: TODAY }).ages, projectNetWorth(withPeople, { today: TODAY, years: 0 }).path[0].superCounted], [[{ name: 'Sam', age: 56 }], false]);
            const sm = buildSampleHousehold(TODAY).data;
            migrateAssetDebtDetail(sm);
            sm.fiSettings.birthYears = [1970];
            const path = projectNetWorth(sm, { today: TODAY, years: 6 }).path;
            assert('age 56 now: locked, then counted from age 60 as the years pass', path.map((p) => p.superCounted), [false, false, false, false, true, true, true]);
        },
    },
    {
        name: 'DB10.9 scope: things that lose value and live-in homes are in net worth, not in FI; an investment property is in both (FT-R-125)',
        fn(assert) {
            const p = runPlan({ assets: [car, homeLive, homeInv, cashA] }, flat({ fiNumber: 1e12 }), { years: 0, untilFI: false }).path[0];
            assert('FI counts the rental and the cash only', p.fiNetWorth, 410000);
            assert('net worth adds the car and the home you live in', p.netWorth, 1030000);
            assert('the lines', [p.depreciating, p.liveIn, p.appreciating], [20000, 600000, 400000]);
            const sug = { ...car, kindSuggested: true };
            const q = runPlan({ assets: [sug, cashA] }, flat({ fiNumber: 1e12 }), { years: 0, untilFI: false }).path[0];
            assert('a kind only suggested to lose value is held out of FI but in net worth', [q.fiNetWorth, q.netWorth], [10000, 30000]);
            const unconfirmedHome = { ...homeInv, use: 'investment', useSuggested: true };
            assert('a suggested "investment" is held out until confirmed', assetScope(unconfirmedHome), { fi: 'no', reason: 'suggested' });
            assert('a home with no answer at all is live-in', assetScope({ kind: 'appreciating', balance: 1 }), { fi: 'no', reason: 'liveIn' });
            const loseValue = runPlan({ assets: [car] }, flat({ fiNumber: 1e12 }), { years: 2, untilFI: false }).path;
            assert('the car loses value in net worth, FI untouched', [loseValue[2].depreciating, loseValue[2].fiNetWorth], [11250, 0]);
        },
    },
    {
        name: 'DB10.10 super counts toward FI from 60 and money outside super must last until then (the bridge)',
        fn(assert) {
            const sup = { id: 'a-s', name: 'Super', balance: 500000, kind: 'invested', kindSuggested: false, isSuper: true, expectedReturn: 7 };
            const outside = { id: 'a-o', name: 'ETF', balance: 100000, kind: 'invested', kindSuggested: false, expectedReturn: 7 };
            const at = (age) => runPlan({ assets: [sup, outside] }, flat({ fiNumber: 1000000, spendYear: 40000, age }), { years: 0, untilFI: false }).path[0];
            const u = at(50);
            assert('under 60 super is locked, not in the FI total', [u.fiNetWorth, u.superLocked, u.superCounted], [100000, 500000, false]);
            const n = 10, annuity = ((1 - Math.pow(1.07, -n)) / 0.07) * 1.07; // each year spending at the start of the year
            const bridge = 40000 * annuity;
            assert('the bridge is ten years of spending at 7%, each year paid at its start: 40,000 x 7.5152', u.bridge, r2(bridge));
            assert('hand check of the factor', Math.round(annuity * 1e4) / 1e4, 7.5152);
            assert('the outside money needed: bridge plus the FI number brought back to today, less the locked super', u.fiNeeded, r2(bridge + 1000000 / Math.pow(1.07, n) - 500000));
            assert('net worth still has the locked super', u.netWorth, 600000);
            const s = at(60);
            assert('at 60 super counts in full and the target is the plain number', [s.fiNetWorth, s.fiNeeded, s.superLocked], [600000, 1000000, 0]);
            assert('with no birth year known super counts as it did before', at(null).fiNetWorth, 600000);
            const rich = runPlan({ assets: [{ ...outside, balance: 2000000 }, sup] }, flat({ fiNumber: 1000000, spendYear: 40000, age: 50 }), { years: 0, untilFI: false });
            assert('plenty outside super and the bridge covered: FI now', rich.yearsToFI, 0);
            const short = runPlan({ assets: [{ ...outside, balance: 200000 }, { ...sup, balance: 5000000 }] }, flat({ fiNumber: 1000000, spendYear: 40000, age: 50 }), { years: 0, untilFI: false });
            assert('huge super does not help if the outside money cannot bridge to 60', short.path[0].fiNeeded >= short.path[0].bridge && short.path[0].fiNetWorth < short.path[0].fiNeeded, true);
        },
    },
    {
        name: 'DB10.11 data: the youngest known birth year sets the age (fiSettings.birthYears or people)',
        fn(assert) {
            const base = { assets: [{ id: 'a-s', name: 'Super', balance: 100000, kind: 'invested', kindSuggested: false, isSuper: true }], liabilities: [], incomeSources: [], fiSettings: { multiple: 25, inflation: 2.5, expectedReturn: 7, birthYears: [1990] } };
            const young = projectNetWorth(base, { today: TODAY, years: 0 }).path[0];
            assert('born 1990: super locked at today', [young.superCounted, young.superLocked], [false, 100000]);
            const old = projectNetWorth({ ...base, fiSettings: { ...base.fiSettings, birthYears: [1950, 1990] } }, { today: TODAY, years: 0 }).path[0];
            assert('a couple: the younger one sets it (no owner on an asset)', old.superCounted, false);
            const sixty = projectNetWorth({ ...base, fiSettings: { ...base.fiSettings, birthYears: [1960] } }, { today: TODAY, years: 0 }).path[0];
            assert('born 1960: 66, super counts', sixty.superCounted, true);
        },
    },
    {
        name: 'DB10.12 one net worth: calculateTotals and the Future path agree, HELP included (FT-R-125)',
        fn(assert) {
            const d = {
                assets: [car, homeLive, homeInv, cashA, { id: 'a-x', name: 'Boat', balance: 5000, kind: 'depreciating', kindSuggested: true }],
                liabilities: [{ id: 'l1', name: 'Home loan', balance: 300000, interestRate: 6 }],
                incomeSources: [], taxSettings: { helpBalance: 20000 }, fiSettings: { multiple: 25, inflation: 2.5, expectedReturn: 7 },
            };
            const totals = calculateTotals(structuredClone(d));
            const path0 = projectNetWorth(d, { today: TODAY, years: 0 }).path[0];
            assert('assets 1,035,000 less loan 300,000 less HELP 20,000', totals.netWorth, 715000);
            assert('the Future path says the same', path0.netWorth, totals.netWorth);
            assert('HELP is its own line, and the listed debts do not include it', [totals.helpBalance, totals.currentLiabilities], [20000, 300000]);
            const noHelp = structuredClone(d); noHelp.taxSettings.helpBalance = 0;
            assert('without HELP they still agree', [calculateTotals(noHelp).netWorth, projectNetWorth(noHelp, { today: TODAY, years: 0 }).path[0].netWorth], [735000, 735000]);
        },
    },
    {
        name: 'DB10.13 the FI multiple is the user\'s choice, default 25',
        fn(assert) {
            const d = buildSampleHousehold(TODAY).data;
            migrateAssetDebtDetail(d);
            const w = (m) => { const x = structuredClone(d); x.fiSettings.multiple = m; return fiNumber(x, { today: TODAY }); };
            assert('the sample at 25 (existing figure)', w(25), 1586832);
            assert('no usable multiple: 25', [w(0), w('x'), w(-3), w(undefined)], [1586832, 1586832, 1586832, 1586832]);
            assert('the user chose 30: 1,586,832 x 30 / 25', w(30), 1904198.4);
            assert('the migration leaves a chosen multiple alone and supplies 25 when missing', [migrateAssetScope({ assets: [], fiSettings: { multiple: 30 } }), 1], [true, 1]);
        },
    },
];
