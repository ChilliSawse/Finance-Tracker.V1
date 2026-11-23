// FT-0032 DB12 (R3 step R7, FT-R-125, FT-R-126, FT-R-128): the asset screen for the reference database.
// Spread into the "asset-debt-sheets" group. Model and row tests: pure, made-up data only, made-up types in the real file's shape
// (the real 65 types are checked by `npm run ref:check`). The browser pass is separate (tools/ in the step's report).

import {
    assetSheetSpec, debtSheetSpec, applyAssetValues, applyDebtValues, newAsset, newDebt, assetChipsHtml, checkItems, checkCardHtml, checkCardFor,
    confirmSuggestion, depreciationFromValues, propertiesOf,
} from './plan-assets-debts.js';
import { saveDebtAsset } from './plan-lists.js';
import { createSheetModel } from './sheet.js';
import { wireSheetReopen } from './asset-sheet-wire.js';
import { suggestKind, assetScope, valueDetail, depreciatedValue, effectiveAsset, loanScope, heldOutAssets, pendingLoanLinks } from '../calc/assets-debts.js';
import { fiSummary } from '../calc/fi.js';
import { explainFi } from '../calc/fi-explain.js';
import { suggestLoanLink } from '../state/loan-link-migration.js';
import { buildSampleHousehold } from '../state/sample-data.js';
import { migrateAssetDebtDetail } from '../state/asset-debt-migration.js';
import { t } from '../i18n/strings.js';
import { futureModel, fiTarget } from './future/model.js';
import { buildFutureHtml } from './future/view.js';
import { heldOutText } from './scenario/results.js';
import '../i18n/en-lazy-future.js';
import '../i18n/en-lazy-results.js';

const TODAY = '2026-11-21';
const HOSTILE = '<img src=x onerror=1>';

const CAR = {
    id: 'car', name: 'Medium car', kind: 'depreciating', match: ['car', 'corolla'], confidence: 'medium',
    defaults: { depreciation: { method: 'diminishing', ratePct: 8.9, residual: 0 } },
    curve: [{ year: 0, pctOfPricePaid: 100 }, { year: 1, pctOfPricePaid: 80 }, { year: 2, pctOfPricePaid: 60 }, { year: 3, pctOfPricePaid: 50 }],
    powertrainFactor: { petrol: 1, diesel: 1, ev: [{ year: 1, factor: 0.8 }, { year: 3, factor: 0.6 }, { year: 10, factor: 0.5 }] },
    counts: { netWorth: 'resale', fi: false },
};
const PHONE = {
    id: 'phone', name: 'Phone', kind: 'depreciating', legacyKind: 'depreciating', match: ['iphone', 'phone'], confidence: 'low',
    defaults: { depreciation: { method: 'diminishing', ratePct: 30, residual: 0 } },
    curve: [{ year: 0, pctOfNew: 100 }, { year: 1, pctOfNew: 60 }, { year: 2, pctOfNew: 40 }, { year: 3, pctOfNew: 30 }],
    counts: { netWorth: 'resale', fi: false },
};
const HOUSE = { id: 'house', name: 'House', kind: 'appreciating', match: ['house', 'home', 'unit'], defaults: { growthRate: 5 }, counts: { fi: 'useSwitch' } };
const ETF = { id: 'etf', name: 'ETF', kind: 'invested', match: ['etf'], defaults: { expectedReturn: 8 }, counts: { fi: true } };
const CRYPTO = { id: 'crypto', name: 'Crypto', kind: 'invested', match: ['crypto', 'bitcoin'], defaults: { expectedReturn: null }, counts: { fi: true, rateMode: 'noReliableRate' } };
const TYPES = [CAR, PHONE, HOUSE, ETF, CRYPTO];

const sample = () => {
    const d = buildSampleHousehold(TODAY).data;
    migrateAssetDebtDetail(d);
    for (const a of d.assets) a.kindSuggested = false;
    return d;
};
const notesOf = (spec, values) => createSheetModel({ fields: spec.fields, values, plausibility: spec.plausibility }).notes();
const sheetValues = (spec, over = {}) => ({ ...spec.values, ...over });

export const DB12_TEST_CASES = [
    {
        name: 'DB12.1 the name suggests a type as it is typed; taking it, or picking one from the list, confirms it',
        fn(assert) {
            const spec = assetSheetSpec(null, { types: TYPES });
            assert('a Type row is offered when types are loaded', spec.fields.map((f) => f.key).includes('assetType'), true);
            const none = assetSheetSpec(null, { types: [] });
            assert('no types loaded (offline): no Type row, no type note', [none.fields.map((f) => f.key).includes('assetType'), notesOf(none, sheetValues(none, { name: 'Corolla' })).length], [false, 0]);
            const typed = notesOf(spec, sheetValues(spec, { name: 'Toyota Corolla' }));
            assert('typing a name makes a suggestion on the Type row', [typed[0].field, typed[0].message], ['assetType', t('f.ad.type.suggest', { type: 'Medium car' })]);
            assert('with a one-tap fix that takes it and confirms it', typed[0].fix.apply({}), { assetType: 'car', confirmed: true });
            assert('a name with no match suggests nothing', notesOf(spec, sheetValues(spec, { name: 'Mystery thing' })).filter((n) => n.field === 'assetType').length, 0);
            const row = newAsset([], { name: 'Toyota Corolla', balance: 20000 });
            applyAssetValues(row, { name: 'Toyota Corolla', balance: 20000, kind: 'depreciating', assetType: 'car', powertrain: 'petrol', confirmed: true }, { types: TYPES, isNew: true });
            assert('accepting it: type set, confirmed, kind confirmed', [row.assetType, row.typeSuggested, row.kindSuggested, row.kind], ['car', false, false, 'depreciating']);
            assert('its curve now feeds the maths (not held out)', effectiveAsset(row).valueCurve !== null && effectiveAsset(row).valueCurve.typeId === 'car', true);
            const reopened = assetSheetSpec(null, { types: TYPES, carry: { name: 'x', assetType: 'etf', kind: 'depreciating' }, changed: 'assetType' });
            assert('picking a type from the list: the kind follows it and the type\'s rate shows', [reopened.values.kind, reopened.values.expectedReturn, reopened.fields.map((f) => f.key).includes('expectedReturn')], ['invested', 8, true]);
            const dropped = assetSheetSpec(null, { types: TYPES, carry: { name: 'x', assetType: 'car', kind: 'cash' }, changed: 'kind' });
            assert('picking a kind the type does not fit drops the type', [dropped.values.assetType, dropped.values.kind], ['', 'cash']);
        },
    },
    {
        name: 'DB12.2 a saved name with no pick keeps the suggestion as a suggestion (held out); a pick, or any edit, makes it theirs (claimField)',
        fn(assert) {
            const d = { assets: [], liabilities: [] };
            const res = saveDebtAsset(d, 'asset', null, { name: 'Corolla', balance: 18000 }, { types: TYPES });
            const row = d.assets[0];
            assert('saved with the type suggested, not confirmed', [res.ok, row.assetType, row.typeSuggested, row.kindSuggested, row.typeConfidence], [true, 'car', true, true, 'medium']);
            assert('held out of the FI figure and flat until confirmed', [assetScope(row).fi, valueDetail(row, 5).source], ['no', 'suggested']);
            const fb = { assets: [], liabilities: [] };
            saveDebtAsset(fb, 'asset', null, { name: 'Family car', balance: 9000 }, { types: [] });
            assert('offline fallback: the old suggestKind guess, flagged', [fb.assets[0].kind, fb.assets[0].kindSuggested, fb.assets[0].assetType], ['depreciating', true, undefined]);
            const own = { assets: [], liabilities: [] };
            saveDebtAsset(own, 'asset', null, { name: 'Bitcoin', balance: 500, kind: 'invested' }, { types: TYPES });
            assert('a kind the person picked is theirs: no type pushed onto it', [own.assets[0].kindSuggested, own.assets[0].assetType], [false, undefined]);
            const etf = newAsset([], { name: 'My ETF', balance: 1000 });
            applyAssetValues(etf, { name: 'My ETF', balance: 1000, kind: 'invested', assetType: 'etf', expectedReturn: 8 }, { types: TYPES, isNew: true });
            assert('a type picked: its return is filled and still listed as the type\'s', [etf.expectedReturn, etf.typeFilled.includes('expectedReturn')], [8, true]);
            applyAssetValues(etf, { name: 'My ETF', balance: 1000, kind: 'invested', assetType: 'etf', expectedReturn: 6 }, { types: TYPES });
            assert('an edited return is theirs: out of typeFilled, and kept', [etf.expectedReturn, etf.typeFilled.includes('expectedReturn')], [6, false]);
            const untouched = newAsset([], { name: 'ETF two', balance: 1000 });
            applyAssetValues(untouched, { name: 'ETF two', balance: 1000, kind: 'invested', assetType: 'etf', expectedReturn: 8 }, { types: TYPES, isNew: true });
            applyAssetValues(untouched, { name: 'ETF two renamed', balance: 1500, kind: 'invested', assetType: 'etf', expectedReturn: 8 }, { types: TYPES });
            assert('a field left alone stays the type\'s (a later update may refresh it)', untouched.typeFilled.includes('expectedReturn'), true);
            applyAssetValues(untouched, { name: 'x', balance: 1, kind: 'invested', assetType: '' }, { types: TYPES });
            assert('removing the type clears what it governed', [untouched.assetType, untouched.typeFilled, untouched.valueCurve], [undefined, undefined, undefined]);
        },
    },
    {
        name: 'DB12.3 cars: the powertrain feeds the curve factor',
        fn(assert) {
            const spec = assetSheetSpec(null, { types: TYPES, carry: { name: 'Tesla', assetType: 'car' }, changed: 'assetType' });
            assert('a car type shows the powertrain choice (petrol or diesel, hybrid, plug-in hybrid, EV)', [spec.fields.map((f) => f.key).includes('powertrain'), spec.fields.find((f) => f.key === 'powertrain').options.map((o) => o.value)], [true, ['petrol', 'hybrid', 'phev', 'ev']]);
            assert('a non-car depreciating type has none', assetSheetSpec(null, { types: TYPES, carry: { assetType: 'phone' }, changed: 'assetType' }).fields.map((f) => f.key).includes('powertrain'), false);
            const make = (powertrain) => {
                const r = newAsset([], { name: 'Car', balance: 30000 });
                applyAssetValues(r, { name: 'Car', balance: 30000, kind: 'depreciating', assetType: 'car', powertrain, depMethod: 'declining', depRatePct: 8.9, depPurchasePrice: 40000, depPurchaseDate: '2023-11-21' }, { types: TYPES, isNew: true });
                return r;
            };
            const petrol = make('petrol');
            const ev = make('ev');
            assert('the choice is stored on the curve', [petrol.valueCurve.powertrain, ev.valueCurve.powertrain, ev.valueCurve.factors.length], ['petrol', 'ev', 3]);
            assert('an EV is worth less than petrol on the same price and date', depreciatedValue(ev, TODAY) < depreciatedValue(petrol, TODAY), true);
            const back = make('petrol');
            applyAssetValues(back, { name: 'Car', balance: 30000, kind: 'depreciating', assetType: 'car', powertrain: 'ev', depMethod: 'declining', depRatePct: 8.9 }, { types: TYPES });
            assert('changing it later changes the factor', back.valueCurve.factors.length, 3);
            assert('the edited asset opens with its powertrain', assetSheetSpec(ev, { types: TYPES }).values.powertrain, 'ev');
        },
    },
    {
        name: 'DB12.4 second-hand items: the curve based on % of new asks what the maths needs, and says so when it is missing',
        fn(assert) {
            const base = { name: 'iPhone', assetType: 'phone', kind: 'depreciating', balance: 500 };
            const open = assetSheetSpec(null, { types: TYPES, carry: base, changed: 'assetType' });
            const keys = (s) => s.fields.map((f) => f.key);
            assert('asks whether it was bought new', keys(open).includes('depBoughtNew'), true);
            assert('and nothing more until the answer is no', keys(open).includes('depNewPrice'), false);
            const no = assetSheetSpec(null, { types: TYPES, carry: { ...base, depBoughtNew: 'no' }, changed: 'depBoughtNew' });
            assert('second-hand: new price and age at purchase', [keys(no).includes('depNewPrice'), keys(no).includes('depAgeAtPurchase')], [true, true]);
            const fall = (v) => notesOf(no, sheetValues(no, v)).filter((n) => n.field === 'depBoughtNew').map((n) => n.message);
            assert('missing data shows the fallback note (the rate does the work)', fall({ depBoughtNew: '' }), [t('f.ad.dep.fallbackNote')]);
            assert('second-hand without the age: the note stays', fall({ depBoughtNew: 'no', depNewPrice: 1000, depAgeAtPurchase: null }), [t('f.ad.dep.fallbackNote')]);
            assert('with new price and age: no note', fall({ depBoughtNew: 'no', depNewPrice: 1000, depAgeAtPurchase: 1 }), []);
            assert('bought new: no note', fall({ depBoughtNew: 'yes' }), []);
            const row = newAsset([], { name: 'iPhone', balance: 500 });
            applyAssetValues(row, { name: 'iPhone', balance: 500, kind: 'depreciating', assetType: 'phone', depMethod: 'declining', depRatePct: 30, depBoughtNew: 'no', depNewPrice: 1000, depAgeAtPurchase: 1, depPurchasePrice: 600, depPurchaseDate: '2025-11-21' }, { types: TYPES, isNew: true });
            assert('stored where the maths reads it', [row.depreciation.boughtNew, row.depreciation.newPrice, row.depreciation.ageAtPurchase], [false, 1000, 1]);
            assert('the worked-out value comes from the curve now', depreciatedValue(row, TODAY), 400);
            assert('the maths says when it fell back to the rate', valueDetail({ ...row, depreciation: { ...row.depreciation, ageAtPurchase: null } }, 1, { asOf: TODAY }).fallback, true);
            assert('the dep record carries no second-hand keys unless the sheet asked for them', 'boughtNew' in depreciationFromValues({ depMethod: 'declining' }), false);
        },
    },
    {
        name: 'DB12.5 property: the "I live here" or "Investment" switch, suggested until confirmed',
        fn(assert) {
            const spec = assetSheetSpec(null, { types: TYPES, kind: 'appreciating' });
            const use = spec.fields.find((f) => f.key === 'use');
            assert('a property gets the switch with both answers', [use.type, use.options.map((o) => o.value), spec.values.use], ['select', ['liveIn', 'investment'], 'liveIn']);
            assert('other kinds do not', assetSheetSpec(null, { kind: 'cash' }).fields.map((f) => f.key).includes('use'), false);
            const note = notesOf(spec, sheetValues(spec)).find((n) => n.field === 'use');
            assert('the default is shown as suggested, with a Confirm on the sheet', [!!note, note.fix.label], [true, t('f.ad.confirm')]);
            const row = newAsset([], { name: 'Home', balance: 700000, kind: 'appreciating' });
            applyAssetValues(row, { name: 'Home', balance: 700000, kind: 'appreciating', use: 'liveIn' }, { isNew: true });
            assert('saved without confirming: still suggested', [row.use, row.useSuggested, assetScope(row).fi], ['liveIn', true, 'no']);
            applyAssetValues(row, { name: 'Home', balance: 700000, kind: 'appreciating', use: 'liveIn', useConfirmed: true });
            assert('the Confirm tap makes it theirs', [row.use, row.useSuggested], ['liveIn', false]);
            const inv = newAsset([], { name: 'Rental', balance: 500000, kind: 'appreciating' });
            applyAssetValues(inv, { name: 'Rental', balance: 500000, kind: 'appreciating', use: 'investment' }, { isNew: true });
            assert('picking Investment confirms it and it counts toward FI', [inv.use, inv.useSuggested, assetScope(inv).fi], ['investment', false, 'yes']);
            const edit = assetSheetSpec(row, {});
            assert('a confirmed use shows no suggestion', notesOf(edit, sheetValues(edit)).filter((n) => n.field === 'use').length, 0);
        },
    },
    {
        name: 'DB12.6 loans: "This loan is for" lists only properties; a link is suggested on add or rename and confirmed by a pick or a tap',
        fn(assert) {
            const assets = [
                { id: 'a-home', name: 'Family home', kind: 'appreciating', balance: 800000, kindSuggested: true },
                { id: 'a-car', name: 'Corolla', kind: 'depreciating', balance: 9000, kindSuggested: false },
                { id: 'a-cash', name: 'Savings', kind: 'cash', balance: 100, kindSuggested: false },
            ];
            assert('only properties', propertiesOf(assets).map((a) => a.id), ['a-home']);
            const spec = debtSheetSpec(null, { assets });
            const f = spec.fields.find((x) => x.key === 'forAssetId');
            assert('the choice lists none and the properties only', f.options.map((o) => o.value), ['', 'a-home']);
            assert('no properties: no row', debtSheetSpec(null, { assets: [assets[1]] }).fields.some((x) => x.key === 'forAssetId'), false);
            assert('no assets given (What If): no row', debtSheetSpec(null).fields.some((x) => x.key === 'forAssetId'), false);
            const note = notesOf(spec, sheetValues(spec, { name: 'Home loan' })).find((n) => n.field === 'forAssetId');
            assert('typing a home loan name offers the link', [!!note, note.fix.apply({})], [true, { forAssetId: 'a-home', forAssetConfirmed: true }]);
            assert('a car loan is never offered one', notesOf(spec, sheetValues(spec, { name: 'Car loan' })).length, 0);
            const row = newDebt([], { name: 'Mortgage', balance: 500000 });
            assert('newDebt carries the link fields, unlinked by default', [row.forAssetId, row.forAssetSuggested], [null, false]);
            assert('newDebt can suggest from the assets', (({ forAssetId, forAssetSuggested }) => [forAssetId, forAssetSuggested])(newDebt([], { name: 'Home loan', balance: 1 }, assets)), ['a-home', true]);
            assert('and an explicit link is kept', newDebt([], { name: 'Home loan', forAssetId: null }, assets).forAssetId, null);

            const data = { assets: assets.map((a) => ({ ...a })), liabilities: [] };
            const res = saveDebtAsset(data, 'debt', null, { name: 'Home loan', balance: 400000, interestRate: 6 });
            const l = data.liabilities[0];
            assert('a new home loan gets the suggested link, left suggested', [l.forAssetId, l.forAssetSuggested, data.assets[0].kindSuggested], ['a-home', true, true]);
            assert('a suggested link changes nothing in the maths', loanScope(l, data.assets).reason, 'suggestedLink');
            res.onUndo();
            assert('undo removes the loan and leaves the home as it was', [data.liabilities.length, data.assets[0].kindSuggested], [0, true]);
            const again = saveDebtAsset(data, 'debt', null, { name: 'Mortgage', balance: 400000, forAssetId: 'a-home', forAssetConfirmed: true });
            const m = data.liabilities[0];
            assert('confirming a link confirms the property\'s kind too', [m.forAssetSuggested, data.assets[0].kindSuggested, loanScope(m, data.assets).reason], [false, false, 'liveIn']);
            again.onUndo();
            assert('undo puts the property\'s flag back', [data.liabilities.length, data.assets[0].kindSuggested], [0, true]);
            saveDebtAsset(data, 'debt', null, { name: 'Mortgage', balance: 400000, forAssetId: 'a-home' });
            assert('picking a property from the list confirms it', data.liabilities[0].forAssetSuggested, false);
            saveDebtAsset(data, 'debt', 0, { name: 'Mortgage', balance: 390000, forAssetId: '' });
            assert('clearing the link unlinks it', [data.liabilities[0].forAssetId, data.liabilities[0].forAssetSuggested], [null, false]);
            const renamed = { assets: assets.map((a) => ({ ...a })), liabilities: [{ id: 'l-x', name: 'Loan', balance: 10, forAssetId: null, forAssetSuggested: false }] };
            saveDebtAsset(renamed, 'debt', 0, { name: 'Home loan', balance: 10 });
            assert('renaming an unlinked loan to a home loan offers (suggests) the link', [renamed.liabilities[0].forAssetId, renamed.liabilities[0].forAssetSuggested], ['a-home', true]);
            const hostile = debtSheetSpec(null, { assets: [{ id: 'a-h', name: HOSTILE, kind: 'appreciating' }] });
            assert('property names are option labels (set as text by the sheet)', hostile.fields.find((x) => x.key === 'forAssetId').options[1].label, HOSTILE);
            assert('suggestLoanLink agrees with the sheet', suggestLoanLink({ name: 'Home loan' }, assets), 'a-home');
        },
    },
    {
        name: 'DB12.7 the Check card lists pending loan links with suggested kinds; Confirm all confirms the sure ones and says so',
        fn(assert) {
            const mk = () => ({
                assets: [
                    { id: 'a-home', name: 'Home', kind: 'appreciating', balance: 800000, kindSuggested: true, use: 'liveIn', useSuggested: true },
                    { id: 'a-car', name: 'Corolla', kind: 'depreciating', balance: 9000, kindSuggested: true, assetType: 'car', typeSuggested: true, typeConfidence: 'medium' },
                    { id: 'a-phone', name: 'iPhone', kind: 'depreciating', balance: 500, kindSuggested: true, assetType: 'phone', typeSuggested: true, typeConfidence: 'low' },
                ],
                liabilities: [
                    { id: 'l-mort', name: 'Mortgage', balance: 400000, forAssetId: 'a-home', forAssetSuggested: true, label: 'good', labelSuggested: true },
                    { id: 'l-gone', name: 'Cleared', balance: 0, forAssetId: 'a-home', forAssetSuggested: true },
                ],
            });
            const d = mk();
            const items = checkItems(d);
            assert('assets, then labels, then links', items.map((i) => `${i.type}:${i.index}`), ['asset:0', 'asset:1', 'asset:2', 'debt:0', 'link:0']);
            assert('a cleared loan is not a pending link (same as the maths)', [pendingLoanLinks(d.liabilities).count, items.filter((i) => i.type === 'link').length], [1, 1]);
            assert('the less sure reference type is marked', items.map((i) => i.unsure), [false, false, true, false, false]);
            const html = checkCardFor(d);
            assert('the count wording', html.includes('id="p-check-h" tabindex="-1">5 details to check</h2>'), true);
            assert('the held-out line wording', html.includes('3 items not counted in FI'), true);
            assert('the link row names the property', html.includes('Mortgage: looks like it is for Home'), true);
            assert('Confirm all becomes "the sure ones" while some are less sure', [html.includes(t('f.ad.check.allSure')), html.includes('(less sure)')], [true, true]);
            assert('one detail: singular', checkCardHtml(items.slice(0, 1)).includes('1 detail to check'), true);
            assert('every name is escaped', checkCardHtml(checkItems({ assets: [{ id: 'a', name: HOSTILE, kind: 'cash', kindSuggested: true }], liabilities: [] })).includes('<img'), false);
            assert('the held-out count is the maths\' own count', heldOutAssets(d.assets).count, items.filter((i) => i.type === 'asset').length);
            const snap = JSON.stringify(d);
            const res = confirmSuggestion(d, 'all');
            assert('only the sure ones were confirmed, and it says so', [res.count, res.left, res.message], [4, 1, t('f.ad.check.confirmedSure', { count: 4, left: 1 })]);
            assert('the less sure one is left', checkItems(d).map((i) => `${i.type}:${i.index}`), ['asset:2']);
            assert('confirming an asset also confirms its type; a link confirmed the home', [d.assets[1].typeSuggested, d.assets[0].kindSuggested, d.liabilities[0].forAssetSuggested], [false, false, false]);
            assert('no figure changed', [d.assets[0].balance, d.liabilities[0].balance, d.liabilities[0].label], [800000, 400000, 'good']);
            res.onUndo();
            assert('undo restores everything', JSON.stringify(d), snap);
            const one = confirmSuggestion(d, 'link:0');
            assert('one link: its message and its home\'s kind', [one.message, d.assets[0].kindSuggested, d.assets[2].kindSuggested], [t('f.ad.check.confirmed', { name: 'Mortgage' }), false, true]);
            const clean = { assets: [{ id: 'a', name: 'Savings account', kind: 'cash', kindSuggested: true }, { id: 'b', name: 'Everyday account', kind: 'cash', kindSuggested: true }], liabilities: [] };
            assert('with no less sure item the button says Confirm all and the toast says so', [checkCardFor(clean).includes(`>${t('f.ad.check.all')}<`), confirmSuggestion(clean, 'all').message], [true, t('f.ad.check.confirmedAll', { count: 2 })]);
            assert('nothing left to confirm: refused', confirmSuggestion(clean, 'all').ok, false);
        },
    },
    {
        name: 'DB12.8 crypto shows "no reliable rate" and is held flat',
        fn(assert) {
            const spec = assetSheetSpec(null, { types: TYPES, carry: { name: 'Bitcoin', assetType: 'crypto' }, changed: 'assetType' });
            const keys = spec.fields.map((f) => f.key);
            assert('no return row to fill in, and the sheet says why', [keys.includes('expectedReturn'), spec.fields.find((x) => x.key === 'balance').hint], [false, t('f.ad.noRate.hint')]);
            const row = newAsset([], { name: 'Bitcoin', balance: 1000 });
            applyAssetValues(row, { name: 'Bitcoin', balance: 1000, kind: 'invested', assetType: 'crypto' }, { types: TYPES, isNew: true });
            assert('the row says no reliable rate, and the chip shows it', [row.rateMode, assetChipsHtml(row).includes('No reliable rate')], ['noReliableRate', true]);
            assert('held flat in the future value (no default return)', [valueDetail(row, 10).value, valueDetail(row, 10).source], [1000, 'noReliableRate']);
            assert('a chip for an ordinary asset has none', assetChipsHtml({ kind: 'cash', balance: 1 }).includes('No reliable rate'), false);
        },
    },
    {
        name: 'DB12.9 Future: the bridge target is on screen and is what the line crosses; no birth year says super counts now; the held-out line opens the Check card',
        fn(assert) {
            const d = sample();
            d.assets[0].balance = 900000;
            d.assets[2].balance = 500000;
            d.fiSettings.birthYears = [1980];
            const m = futureModel(d, { today: TODAY });
            const s = m.summary;
            const k = Math.ceil(s.yearsToFI);
            const kk = Math.floor(s.yearsToFI);
            const wantT = s.path[kk].fiNeeded + (s.path[kk + 1].fiNeeded - s.path[kk].fiNeeded) * (s.yearsToFI - kk);
            assert('under 60 the target is the bridge target at the moment FI is reached (read along the line the date was solved on)', [m.target.bridge, Math.abs(m.target.amount - wantT) < 1e-6, m.target.year], [true, true, k]);
            assert('it is not the plain FI number', m.target.amount !== s.fiNumber, true);
            assert('the net worth line reaches the target in the crossing year, not before', [s.path[k].fiNetWorth >= m.target.amount, s.path[k - 1].fiNetWorth < m.target.amount], [true, true]);
            const html = buildFutureHtml(m, { loaded: true });
            assert('the chart line says the target, the card says why', [html.includes('class="fu-fi-line"'), html.includes(t('f.future.fi.bridge', { amount: html.match(/Super is locked until 60, so the target at that date is ([^.]*)\./)[1], age: 60 }))], [true, true]);
            const geo = m.geometry;
            assert('the chart\'s FI line sits at the target', Math.abs(geo.fiPct - (((geo.yMax - m.target.amount) / (geo.yMax - geo.yMin)) * 100)) < 0.01, true);
            d.fiSettings.birthYears = [1960];
            assert('60 or over: the plain FI number, no bridge line', [futureModel(d, { today: TODAY }).target.bridge, buildFutureHtml(futureModel(d, { today: TODAY }), {}).includes('Super is locked until')], [false, false]);

            const nb = sample();
            const mn = futureModel(nb, { today: TODAY });
            assert('no birth year: super is counted now, with a prompt', [mn.summary.superNoBirth, buildFutureHtml(mn, {}).includes(t('f.future.fi.noBirth')), buildFutureHtml(mn, {}).includes('data-fu-assume')], [true, true, true]);
            nb.fiSettings.birthYears = [1990];
            assert('with a birth year the note is gone', futureModel(nb, { today: TODAY }).summary.superNoBirth, false);

            const h = sample();
            h.assets[2].kindSuggested = true;
            const mh = futureModel(h, { today: TODAY });
            const line = buildFutureHtml(mh, {});
            assert('held out: one item worth its value, a button that opens the Check card', [mh.heldOut.count, line.includes('data-fu-check="1"'), line.includes(`1 item worth`), /isn.{1,6}t counted toward FI until you confirm/.test(line)], [1, true, true, true]);
            assert('none held out: no line', buildFutureHtml(futureModel(sample(), { today: TODAY }), {}).includes('data-fu-check'), false);
            h.assets[0].kindSuggested = true;
            assert('two items: plural wording', buildFutureHtml(futureModel(h, { today: TODAY }), {}).includes('2 items worth'), true);
            assert('What If says the same of the same figures', heldOutText({ now: { summary: fiSummary(h, { today: TODAY }) } }).includes('2 items worth'), true);
            assert('What If: nothing held out, no line', heldOutText({ now: { summary: fiSummary(sample(), { today: TODAY }) } }), null);
        },
    },
    {
        name: 'DB12.10 Explain: the "less debts" line is true with a loan out of FI; home loan left out, Fire money paying it, held-out and birth-year lines',
        fn(assert) {
            const d = sample();
            d.assets.push({ id: 'a-home', name: 'Home', kind: 'appreciating', balance: 800000, kindSuggested: false, use: 'liveIn', useSuggested: false, growthRate: null });
            d.liabilities.push({ id: 'l-home', name: 'Mortgage', balance: 400000, interestRate: 6, interestType: 'variable', compounding: 'monthly', repaymentFrequency: 'monthly', minRepayment: 2500, forAssetId: 'a-home', forAssetSuggested: false, label: 'good', labelSuggested: false });
            const ids = (opts) => explainFi(d, { today: TODAY, ...opts }).map((l) => l.id);
            const lines = explainFi(d, { today: TODAY });
            const text = (id) => (lines.find((l) => l.id === id) || {}).text;
            assert('a loan left out with the home: its line, and the "now" line no longer claims all debts', [ids().includes('homeLoanOut'), text('now').includes('except the home loan left out')], [true, true]);
            assert('the home loan line says it still counts in net worth', text('homeLoanOut').includes('still count in your net worth'), true);
            d.savingModel = d.savingModel || {};
            const s = fiSummary(d, { today: TODAY });
            assert('the summary carries the left-out loan', [s.loansOut.count, s.loansOut.balance], [1, 400000]);
            assert('Fire money not aimed at it: no Fire line', ids().includes('fireHomeLoan'), false);
            const fire = JSON.parse(JSON.stringify(d));
            fire.savingModel = { ...(fire.savingModel || {}), fire: { targets: [{ type: 'debt', liabilityId: 'l-home' }] } };
            const sf = fiSummary(fire, { today: TODAY });
            assert('Fire money paying the home loan: the equity line', [sf.fireToHomeLoan, explainFi(fire, { today: TODAY, summary: sf }).some((l) => l.id === 'fireHomeLoan' && l.text.includes('home equity'))], [true, true]);
            const plain = sample();
            assert('without a loan out, the old line stands', [explainFi(plain, { today: TODAY }).find((l) => l.id === 'now').text.includes('less debts'), explainFi(plain, { today: TODAY }).some((l) => l.id === 'homeLoanOut')], [true, false]);
            plain.assets[2].kindSuggested = true;
            assert('held out: a line with the count and value', explainFi(plain, { today: TODAY }).find((l) => l.id === 'heldOut').text.startsWith('1 item worth'), true);
            assert('no birth year: super counted now line', explainFi(plain, { today: TODAY }).some((l) => l.id === 'noBirth'), true);
        },
    },
    {
        name: 'DB12.11 "Confirm all the sure ones" leaves guesses alone: a name that matched nothing, a loan that only shares a single property, a low-rated type',
        fn(assert) {
            const d = {
                assets: [
                    { id: 'a-ring', name: "Grandma's ring", kind: 'cash', kindSuggested: true, balance: 30000 },
                    { id: 'a-sav', name: 'Savings account', kind: 'cash', kindSuggested: true, balance: 100 },
                    { id: 'a-etf', name: 'ETF', kind: 'invested', kindSuggested: true, assetType: 'etf', typeSuggested: true, typeConfidence: null, balance: 100 },
                    { id: 'a-phone', name: 'iPhone', kind: 'depreciating', kindSuggested: true, assetType: 'phone', typeSuggested: true, typeConfidence: 'low', balance: 100 },
                    { id: 'a-house', name: 'House', kind: 'appreciating', kindSuggested: true, balance: 500000 },
                ],
                liabilities: [
                    { id: 'l-ski', name: 'Jet ski loan', balance: 15000, forAssetId: 'a-house', forAssetSuggested: true },
                    { id: 'l-home', name: 'Home loan', balance: 400000, forAssetId: 'a-house', forAssetSuggested: true, label: 'good', labelSuggested: true },
                ],
            };
            const by = Object.fromEntries(checkItems(d).map((i) => [i.name, i.unsure]));
            assert('a name that matched nothing is the cash default, not a finding', by["Grandma's ring"], true);
            assert('a keyword hit is sure', by['Savings account'], false);
            assert('a reference type with no concern, and a debt label, are sure', [by.ETF, by['Home loan']], [false, false]);
            assert('a type the reference rates low is not', by.iPhone, true);
            assert('a loan with no home word that only shares the one property is not', by['Jet ski loan'], true);
            const res = confirmSuggestion(d, 'all');
            assert('confirm all leaves exactly those three', checkItems(d).map((i) => i.name).sort(), ['Jet ski loan', 'iPhone', "Grandma's ring"].sort());
            assert('the ring still counts nowhere toward FI, the jet ski loan stays a suggestion', [assetScope(d.assets[0]).fi, loanScope(d.liabilities[0], d.assets).reason], ['no', 'suggestedLink']);
            assert('the toast says how many were left', res.message, t('f.ad.check.confirmedSure', { count: res.count, left: 3 }));
            const one = { assets: [{ id: 'a-x', name: 'Savings account', kind: 'cash', kindSuggested: true }, { id: 'a-y', name: "Grandma's ring", kind: 'cash', kindSuggested: true }], liabilities: [] };
            assert('singular wording when one was confirmed', confirmSuggestion(one, 'all').message, t('f.ad.check.confirmedSure.one', { count: 1, left: 1 }));
            assert('the ring row says less sure, and one sure item has no Confirm all button', [checkCardFor(one).includes('(less sure)'), checkCardFor(one).includes('data-check-all')], [true, false]);
            assert('the repeated buttons point at their row text', checkCardFor(one).includes('aria-describedby="p-check-t-asset-1"'), true);
            assert('suggestKind marks only its default', [suggestKind("Grandma's ring").fallback, suggestKind('Savings account').fallback], [true, undefined]);
            const open = newAsset([], { name: "Grandma's ring", balance: 1 });
            assert('a ring saved by name is flagged for the person to check', [open.kindSuggested, checkItems({ assets: [open], liabilities: [] })[0].unsure], [true, true]);
        },
    },
    {
        name: 'DB12.12 the FI date is solved against the need the bridge leaves that year: the clamped case, and the drawn line crosses where the card says',
        fn(assert) {
            const d = sample();
            d.fiSettings.birthYears = [1996];
            const m = futureModel(d, { today: TODAY });
            const s = m.summary;
            assert('birth year 1996 on the sample: FI is reached inside year 28, not at the start of it', [s.yearsToFI > 27.5 && s.yearsToFI < 28.2, s.yearsToFI > 27.5], [true, true]);
            let bad = 0, n = 0, worst = 0;
            for (const by of [1972, 1976, 1980, 1984, 1988, 1992, 1996]) for (const a0 of [0, 200000, 500000, 900000]) for (const a2 of [0, 200000, 500000]) {
                const g = sample();
                g.assets[0].balance += a0;
                g.assets[2].balance += a2;
                g.fiSettings.birthYears = [by];
                const mm = futureModel(g, { today: TODAY, horizon: 30 });
                const p = mm.summary.path;
                if (!mm.target.bridge || !Number.isFinite(mm.summary.yearsToFI) || mm.summary.yearsToFI > 30) continue;
                n += 1;
                const T = mm.target.amount;
                let x = p[0].fiNetWorth >= T ? 0 : null;
                for (let i = 1; x === null && i < p.length; i += 1) if (p[i - 1].fiNetWorth < T && p[i].fiNetWorth >= T) x = i - 1 + (T - p[i - 1].fiNetWorth) / (p[i].fiNetWorth - p[i - 1].fiNetWorth);
                const off = x === null ? 99 : Math.abs(x - mm.summary.yearsToFI);
                worst = Math.max(worst, off);
                if (off > 0.25) bad += 1;
            }
            assert('a grid of bridge cases exists', n > 20, true);
            assert('no bridge case is out by more than a quarter of a year (worst ' + worst.toFixed(2) + ')', bad, 0);
        },
    },
    {
        name: 'DB12.13 changing the type never overwrites a figure the person typed',
        fn(assert) {
            const FUND = { id: 'fund', name: 'Managed fund', kind: 'invested', match: ['fund'], defaults: { expectedReturn: 6 }, counts: { fi: true } };
            const types = [ETF, FUND];
            let spec = assetSheetSpec(null, { types, carry: { name: 'Shares', assetType: 'etf', kind: '' }, changed: 'assetType' });
            assert('pick ETF: its return shows', spec.values.expectedReturn, 8);
            const typed = { ...spec.values, expectedReturn: 5 };
            spec = assetSheetSpec(null, { types, carry: { ...typed, assetType: 'fund' }, changed: 'assetType' });
            assert('change to Managed fund: the typed 5 stays', spec.values.expectedReturn, 5);
            const untouched = assetSheetSpec(null, { types, carry: { ...assetSheetSpec(null, { types, carry: { name: 'Shares', assetType: 'etf', kind: '' }, changed: 'assetType' }).values, assetType: 'fund' }, changed: 'assetType' });
            assert('a return still equal to the first type\'s moves to the new type\'s', untouched.values.expectedReturn, 6);
            const row = newAsset([], { name: 'Shares', balance: 100 });
            applyAssetValues(row, { ...typed, balance: 100, kind: 'invested', assetType: 'etf' }, { types, isNew: true });
            const stored = assetSheetSpec(row, { types, carry: { ...assetSheetSpec(row, { types }).values, assetType: 'fund' }, changed: 'assetType' });
            assert('a saved row that was edited keeps its figure when the type changes', stored.values.expectedReturn, 5);
            applyAssetValues(row, { ...stored.values, balance: 100 }, { types });
            assert('and saves it', [row.assetType, row.expectedReturn, row.typeFilled.includes('expectedReturn')], ['fund', 5, false]);
            const blank = assetSheetSpec(null, { types, carry: { name: 'x', assetType: 'fund', kind: 'invested', expectedReturn: null }, changed: 'assetType' });
            assert('a blank return is filled', blank.values.expectedReturn, 6);
        },
    },
    {
        name: 'DB12.14 notes and wording: Confirm leaves a polite note, the date note covers a "% of new" curve answered Yes new, an empty type list is remembered',
        async fn(assert) {
            const car = { ...newAsset([], { name: 'Corolla', balance: 20000 }), kind: 'depreciating', kindSuggested: true, assetType: 'car', typeSuggested: true };
            const spec = assetSheetSpec(car, { types: TYPES });
            const before = notesOf(spec, sheetValues(spec)).find((n) => n.field === 'assetType');
            assert('a suggested type has its Confirm', before.fix.label, t('f.ad.confirm'));
            const after = notesOf(spec, sheetValues(spec, { confirmed: true })).find((n) => n.field === 'assetType');
            assert('after the tap the same row says so, politely, with no button', [after.message, !!after.fix], [t('f.ad.confirmedNote'), false]);
            assert('the wording', t('f.ad.confirmedNote'), 'Confirmed. Save to keep it.');
            assert('the type note matches the suggested note meaning', t('f.ad.type.suggested', { type: 'X' }), 'Suggested type: X. Its rate and curve are not used until you confirm.');
            assert('the powertrain hint', t('f.ad.powertrain.hint'), 'Hybrids hold their value better than petrol or diesel cars, plug-in hybrids a little worse, and electric cars lose it fastest.');
            const ph = assetSheetSpec(null, { types: TYPES, carry: { name: 'iPhone', assetType: 'phone', kind: 'depreciating', depBoughtNew: 'yes', depPurchaseDate: null }, changed: 'assetType' });
            const msgs = notesOf(ph, sheetValues(ph)).map((n) => n.field + ':' + n.message);
            assert('Yes, new with no purchase date: the date note shows', msgs.includes('depPurchaseDate:' + t('f.ad.dep.fallbackDate')), true);
            assert('Yes, new with a date: no note', notesOf(ph, sheetValues(ph, { depPurchaseDate: '2025-01-01' })).length, 0);
            const loan = debtSheetSpec(null, { assets: [{ id: 'h', name: 'House', kind: 'appreciating' }] });
            assert('a loan link tap leaves the same note', notesOf(loan, sheetValues(loan, { name: 'Home loan', forAssetId: 'h', forAssetConfirmed: true }))[0].message, t('f.ad.confirmedNote'));
            let calls = 0;
            const loadRef = async () => { calls += 1; return { assetTypes: [] }; };
            const { loadAssetTypes, assetTypesFor } = await import('../state/asset-type-list.js');
            assert('an empty list loads as empty', (await loadAssetTypes(undefined, loadRef)).length, 0);
            const first = await assetTypesFor({});
            assert('the list (empty when offline) is remembered, not asked for again on every reopen', (await assetTypesFor({})) === first, true);
        },
    },
    {
        name: 'DB12.15 keyboard: stepping through a type list does not rebuild the sheet; it reopens when the select is left, with focus on a field',
        fn(assert) {
            const listeners = {};
            const layer = { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, contains: () => true };
            const values = { assetType: '', kind: '' };
            const handle = { layer, getValues: () => ({ ...values }) };
            const calls = [];
            wireSheetReopen(handle, { reopenOn: ['kind', 'assetType'] }, (carry, changed, focus) => calls.push([carry.assetType, changed, focus]));
            const fire = (n, e) => (listeners[n] || []).forEach((f) => f(e));
            const sel = { tagName: 'SELECT', dataset: { key: 'assetType' } };
            fire('keydown', { target: sel, key: 'ArrowDown' });
            values.assetType = 'a';
            fire('change', { target: sel });
            values.assetType = 'b';
            fire('change', { target: sel });
            values.assetType = 'c';
            fire('change', { target: sel });
            assert('three arrow presses rebuild nothing', calls.length, 0);
            fire('focusout', { target: sel, relatedTarget: { dataset: { key: 'balance' } } });
            assert('leaving the select reopens once, on the last choice, with focus on the field it moved to', calls, [['c', 'assetType', 'balance']]);
            fire('change', { target: { tagName: 'SELECT', dataset: { key: 'kind' } } });
            assert('a mouse pick reopens at once, focus on the field changed', calls[1], ['c', 'kind', 'kind']);
        },
    },
];
