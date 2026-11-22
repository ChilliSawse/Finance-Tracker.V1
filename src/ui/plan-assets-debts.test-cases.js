// Test cases for the "asset-debt-sheets" group (F5, registered in src/test-registry.js).
// F5.1 factories carry ids and the F2 fields (assets, debts, income sources at every creation site),
// F5.2 sheet specs by kind, F5.3 the "use A$X" offer never changes the balance without a tap,
// F5.4 add, edit, delete and undo, suggested kind or label flags, F5.5 the "Check these N" card, F5.6 chips.
// Shape: { name, fn(assert) }, assert(label, actual, expected). Synthetic fixtures only.

import {
    newAsset, newDebt, newIncomeSourceRow, assetSheetSpec, debtSheetSpec, applyAssetValues, applyDebtValues,
    checkItems, checkCardHtml, confirmSuggestion, assetChipsHtml, debtChipsHtml, rateBand, depreciationFromValues,
} from './plan-assets-debts.js';
import {
    saveDebtAsset, deleteDebtAsset, debtAssetModel, debtAssetBodyHtml, debtAssetSheetSpec, newIncomeSource as listIncomeSource,
} from './plan-lists.js';
import { createSheetModel } from './sheet.js';
import { depreciatedValue } from '../calc/assets-debts.js';
import { defaultFinanceData } from '../state/defaults.js';
import { makeDebt } from './setup/steps-money.js';
import { applyQuiz } from './setup/quiz.js';
import { DB12_TEST_CASES } from './asset-sheet-db12.test-cases.js';

const HOSTILE = '<img src=x onerror=1>';
const TODAY = '2026-11-21';
const ASSET_FIELDS = ['id', 'name', 'balance', 'kind', 'kindSuggested', 'isSuper', 'interestFrequency', 'expectedReturn', 'dividendYield', 'dividendFrequency', 'reinvestDividends', 'growthRate', 'depreciation'];
const DEBT_FIELDS = ['id', 'name', 'balance', 'interestRate', 'interestType', 'fixedUntil', 'rateAfterFixed', 'compounding', 'repaymentFrequency', 'minRepayment', 'label', 'labelSuggested'];
const has = (row, keys) => keys.every((k) => k in row);
const mk = () => ({
    assets: [
        { id: 'a-savings', name: 'Everyday', balance: 5000, kind: 'cash', kindSuggested: false, isSuper: false, interestFrequency: 'monthly', interestRate: 4.5 },
        { id: 'a-car', name: 'Car', balance: 20000, kind: 'depreciating', kindSuggested: true, isSuper: false, interestFrequency: 'monthly',
            depreciation: { method: 'declining', ratePct: 25, lifeYears: 8, residual: 0, purchasePrice: 30000, purchaseDate: '2021-11-21' } },
    ],
    liabilities: [
        { id: 'l-card', name: 'Credit card', balance: 1200, interestRate: 21.99, interestType: 'variable', label: 'bad', labelSuggested: true },
        { id: 'l-mortgage', name: 'Mortgage', balance: 400000, interestRate: 6.1, interestType: 'fixed', label: 'good', labelSuggested: false },
    ],
});

export const ASSET_DEBT_SHEETS_TEST_CASES = [
    {
        name: 'F5.1 every creation site gives a new row its id and the F2 fields',
        fn(assert) {
            const list = [];
            const a = newAsset(list, { name: 'Raiz' });
            list.push(a);
            const a2 = newAsset(list, { name: 'Raiz' });
            assert('asset has the id and every F2 field', [has(a, ASSET_FIELDS), a.id], [true, 'a-raiz']);
            assert('same name gets a -2 id', a2.id, 'a-raiz-2');
            assert('a bare new asset is plain cash, not flagged', [newAsset([]).kind, newAsset([]).kindSuggested, newAsset([]).id], ['cash', false, 'a-new-asset']);
            assert('a named asset with no kind is suggested and flagged', [newAsset([], { name: 'Family car' }).kind, newAsset([], { name: 'Family car' }).kindSuggested], ['depreciating', true]);
            assert('a depreciating asset carries the vehicle defaults', [newAsset([], { name: 'Ute' }).depreciation.ratePct, newAsset([], { name: 'Ute' }).depreciation.lifeYears], [25, 8]);
            assert('a chosen kind is not flagged', [newAsset([], { name: 'Car', kind: 'cash' }).kind, newAsset([], { name: 'Car', kind: 'cash' }).kindSuggested], ['cash', false]);
            assert('no interestRate key is invented (S1.8)', 'interestRate' in newAsset([]), false);

            const dl = [];
            const d = newDebt(dl, { name: 'Store card', balance: 300 });
            dl.push(d);
            assert('debt has the id and every F2 field', [has(d, DEBT_FIELDS), d.id, d.balance], [true, 'l-store-card', 300]);
            assert('label is suggested and flagged', [d.label, d.labelSuggested], ['bad', true]);
            assert('a bare new debt has no label guess', [newDebt([]).label, newDebt([]).labelSuggested, newDebt([]).id], [null, false, 'l-new-liability']);
            assert('debt ids stay unique', newDebt(dl, { name: 'Store card' }).id, 'l-store-card-2');

            const src = [];
            const s1 = newIncomeSourceRow(src);
            src.push(s1);
            assert('income source has an id', [s1.id, newIncomeSourceRow(src).id], ['inc-new-income', 'inc-new-income-2']);
            assert('plan-lists newIncomeSource routes through the factory', listIncomeSource([]).id, 'inc-new-income');

            const d0 = { liabilities: [], incomeSources: [] };
            const made = makeDebt(d0, { name: 'Credit card', balance: 100, interestRate: 20 });
            assert('setup debt step uses the factory (id, detail, label)', [has(made, DEBT_FIELDS), made.label, made.minRepayment], [true, 'bad', null]);
            const q = { incomeSources: [] };
            applyQuiz(q, { jobs: 'many', how0: 'payslip', same0: 'yes', how1: 'invoice' });
            assert('quiz jobs get ids', q.incomeSources.map((s) => typeof s.id), ['string', 'string']);
            assert('quiz ids are unique', new Set(q.incomeSources.map((s) => s.id)).size, 2);
            assert('default data income source has an id', typeof defaultFinanceData.incomeSources[0].id, 'string');

            const data = { assets: [], liabilities: [] };
            saveDebtAsset(data, 'asset', null, { name: 'Savings', kind: 'cash', balance: 10 });
            saveDebtAsset(data, 'debt', null, { name: 'Loan', balance: 10, interestRate: 5 });
            assert('rows added from the Plan sheet carry the fields', [has(data.assets[0], ASSET_FIELDS), has(data.liabilities[0], DEBT_FIELDS)], [true, true]);
        },
    },
    {
        name: 'F5.2 sheet specs follow the kind and the interest type',
        fn(assert) {
            const keys = (spec) => spec.fields.filter((f) => !f.hidden).map((f) => f.key); // DB12: hidden confirm toggles carry a tap and have no row
            assert('add: only the common fields until a kind is chosen', keys(assetSheetSpec(null)), ['name', 'kind', 'balance']);
            assert('cash fields', keys(assetSheetSpec(null, { kind: 'cash' })), ['name', 'kind', 'balance', 'interestRate', 'interestFrequency']);
            assert('invested fields', keys(assetSheetSpec(null, { kind: 'invested' })),
                ['name', 'kind', 'balance', 'isSuper', 'expectedReturn', 'dividendYield', 'dividendFrequency', 'reinvestDividends']);
            assert('appreciating fields', keys(assetSheetSpec(null, { kind: 'appreciating' })), ['name', 'kind', 'balance', 'use', 'growthRate']);
            assert('depreciating fields', keys(assetSheetSpec(null, { kind: 'depreciating' })),
                ['name', 'kind', 'balance', 'depPurchasePrice', 'depPurchaseDate', 'depMethod', 'depRatePct', 'depLifeYears', 'depResidual']);
            assert('kind is a select that reopens the sheet', [assetSheetSpec(null).fields[1].type, assetSheetSpec(null).reopenOn.includes('kind')], ['select', true]);
            assert('a blank kind offers a "Choose" option; a set kind does not', [assetSheetSpec(null).fields[1].options.length, assetSheetSpec(null, { kind: 'cash' }).fields[1].options.length], [5, 4]);
            const d = mk();
            assert('variable debt has no fixed fields', keys(debtSheetSpec(d.liabilities[0])).includes('fixedUntil'), false);
            assert('fixed debt shows fixed until and the rate after', keys(debtSheetSpec(d.liabilities[1])).filter((k) => k === 'fixedUntil' || k === 'rateAfterFixed'), ['fixedUntil', 'rateAfterFixed']);
            assert('the debt sheet has interest type, compounding, repayment frequency, minimum and label',
                ['interestType', 'compounding', 'repaymentFrequency', 'minRepayment', 'label'].every((k) => keys(debtSheetSpec(null)).includes(k)), true);
            assert('A9b composition passes the F5 spec through', [debtAssetSheetSpec('asset', d.assets[1], { today: TODAY }).fields.length > 5, typeof debtAssetSheetSpec('asset', null).plausibility], [true, 'function']);
            assert('validation: name, amount and rates', Object.keys(assetSheetSpec(null, { kind: 'cash' }).validate({ name: '', balance: -1, interestRate: -2 })).sort(), ['balance', 'interestRate', 'name']);
            assert('validation: a bad date', Object.keys(debtSheetSpec(null).validate({ name: 'x', balance: 1, fixedUntil: '12/11' })), ['fixedUntil']);
            const spec = assetSheetSpec({ ...mk().assets[1] }, { today: TODAY });
            assert('an edited car shows its purchase detail', [spec.values.depPurchasePrice, spec.values.depPurchaseDate, spec.values.depMethod], [30000, '2021-11-21', 'declining']);
            assert('a hostile name stays in the title as plain text (the sheet sets textContent)', assetSheetSpec({ name: HOSTILE, balance: 1, kind: 'cash' }).title.includes(HOSTILE), true);
        },
    },
    {
        name: 'F5.3 the "use A$X" offer is a tap, never automatic',
        fn(assert) {
            const car = mk().assets[1];
            const spec = assetSheetSpec(car, { today: TODAY });
            const model = createSheetModel({ fields: spec.fields, values: spec.values, validate: spec.validate, plausibility: spec.plausibility });
            const worked = depreciatedValue({ depreciation: car.depreciation }, TODAY);
            const notes = model.notes().filter((n) => n.field === 'balance'); // DB12: a suggested kind also has its own Confirm note
            assert('one offer on the balance, more than 5% apart', [notes.length, notes[0].field], [1, 'balance']);
            assert('the fix is labelled with the worked-out amount', notes[0].fix.label.includes('7,119'), true);
            assert('nothing changed yet: the entered balance is untouched', [model.current().balance, car.balance], [20000, 20000]);
            model.applyFix(model.notes().findIndex((n) => n.field === 'balance'));
            assert('only the tap writes the balance', model.current().balance, worked);
            assert('and the offer goes away once they agree', model.notes().filter((n) => n.field === 'balance').length, 0);
            const close = { ...car, balance: 7200 };
            const s2 = assetSheetSpec(close, { today: TODAY });
            assert('within 5%: no offer', createSheetModel({ fields: s2.fields, values: s2.values, plausibility: s2.plausibility }).notes().filter((n) => n.field === 'balance').length, 0);
            const noDate = assetSheetSpec({ ...car, depreciation: { ...car.depreciation, purchaseDate: null } }, { today: TODAY });
            assert('no purchase date: no offer', createSheetModel({ fields: noDate.fields, values: noDate.values, plausibility: noDate.plausibility }).notes().filter((n) => n.field === 'balance').length, 0);
            assert('saving the sheet without the tap keeps the entered balance', applyAssetValues({ ...car }, { ...spec.values }).balance, 20000);
            assert('values to record', depreciationFromValues({ depMethod: 'straight', depPurchasePrice: 1000, depPurchaseDate: '2024-01-01' }).ratePct, 12.5);
        },
    },
    {
        name: 'F5.4 add, edit, delete and undo on assets and debts; flags stay until confirmed',
        fn(assert) {
            const d = mk();
            const before = JSON.stringify(d);
            const add = saveDebtAsset(d, 'asset', null, { name: 'Boat', balance: 9000 });
            const boat = d.assets[2];
            assert('blank kind: guessed from the name and flagged', [boat.kind, boat.kindSuggested, typeof boat.id], ['depreciating', true, 'string']);
            add.onUndo();
            assert('add undone', JSON.stringify(d), before);
            const picked = saveDebtAsset(d, 'asset', null, { name: 'Boat', kind: 'cash', balance: 9000 });
            assert('a kind picked on the sheet is not flagged', [d.assets[2].kind, d.assets[2].kindSuggested], ['cash', false]);
            picked.onUndo();
            const keep = saveDebtAsset(d, 'asset', 1, { ...assetSheetSpec(d.assets[1], { today: TODAY }).values, balance: 19000 });
            assert('editing the balance keeps the kind flagged', [d.assets[1].balance, d.assets[1].kind, d.assets[1].kindSuggested], [19000, 'depreciating', true]);
            keep.onUndo();
            const changed = saveDebtAsset(d, 'asset', 1, { ...assetSheetSpec(d.assets[1], { today: TODAY }).values, kind: 'appreciating' });
            assert('choosing a kind confirms it', [d.assets[1].kind, d.assets[1].kindSuggested], ['appreciating', false]);
            changed.onUndo();
            assert('edit undone', JSON.stringify(d), before);
            saveDebtAsset(d, 'asset', 0, { ...assetSheetSpec(d.assets[0]).values, interestRate: null });
            assert('an unset rate is removed, never null', 'interestRate' in d.assets[0], false);
            const rt = JSON.stringify(mk().assets[0]);
            d.assets[0] = JSON.parse(rt);
            const lab = saveDebtAsset(d, 'debt', 0, { ...debtSheetSpec(d.liabilities[0]).values, minRepayment: 35, label: 'bad' });
            assert('same label keeps the flag; the minimum is saved', [d.liabilities[0].labelSuggested, d.liabilities[0].minRepayment], [true, 35]);
            lab.onUndo();
            saveDebtAsset(d, 'debt', 0, { ...debtSheetSpec(d.liabilities[0]).values, label: 'good' });
            assert('a changed label confirms it', [d.liabilities[0].label, d.liabilities[0].labelSuggested], ['good', false]);
            saveDebtAsset(d, 'debt', 1, { ...debtSheetSpec(d.liabilities[1]).values, interestType: 'variable', fixedUntil: null });
            assert('debt id never changes on edit', d.liabilities.map((l) => l.id), ['l-card', 'l-mortgage']);
            const fresh = mk();
            const dd = deleteDebtAsset(fresh, 'debt', 0);
            assert('delete', fresh.liabilities.length, 1);
            dd.onUndo();
            const da = deleteDebtAsset(fresh, 'asset', 1);
            assert('delete asset and undo', [fresh.assets.length, (da.onUndo(), fresh.assets.length)], [1, 2]);
            const ad = saveDebtAsset(fresh, 'debt', null, { name: 'Phone plan', balance: 50, interestRate: 0, interestType: 'variable' });
            assert('a debt with no guess is unlabelled', [fresh.liabilities[2].label, fresh.liabilities[2].labelSuggested], [null, false]);
            ad.onUndo();
        },
    },
    {
        name: 'F5.5 the "Check these N" card confirms a flag and nothing else',
        fn(assert) {
            const d = mk();
            const items = checkItems(d);
            assert('flagged asset and debt are listed', items.map((i) => `${i.type}:${i.index}`), ['asset:1', 'debt:0']);
            const html = checkCardHtml(items);
            assert('title counts them', html.includes('2 details to check'), true);
            assert('nothing flagged: no card', checkCardHtml(checkItems({ assets: [], liabilities: [] })), '');
            assert('one item: singular title', checkCardHtml(items.slice(0, 1)).includes('1 detail to check'), true);
            const hostile = { assets: [{ id: 'a-x', name: HOSTILE, balance: 1, kind: 'cash', kindSuggested: true }], liabilities: [] };
            const h = checkCardHtml(checkItems(hostile));
            assert('names are escaped', [h.includes('<img'), h.includes('&lt;img')], [false, true]);
            const snap = JSON.stringify(d);
            const one = confirmSuggestion(d, 'asset:1');
            assert('confirm clears only that flag', [d.assets[1].kindSuggested, d.assets[1].kind, d.assets[1].balance, d.liabilities[0].labelSuggested], [false, 'depreciating', 20000, true]);
            one.onUndo();
            assert('undo restores', JSON.stringify(d), snap);
            const all = confirmSuggestion(d, 'all');
            assert('confirm all', [all.count, checkItems(d).length], [2, 0]);
            assert('balances and labels untouched', [d.assets[1].balance, d.liabilities[0].label, d.liabilities[0].balance], [20000, 'bad', 1200]);
            all.onUndo();
            assert('undo all', JSON.stringify(d), snap);
            assert('unknown target is refused', confirmSuggestion(d, 'asset:9').ok, false);
        },
    },
    {
        name: 'F5.6 Plan rows show kind and label chips, escaped',
        fn(assert) {
            const d = mk();
            const am = debtAssetModel(d, 'asset');
            const html = debtAssetBodyHtml(am);
            assert('suggested kind chip is marked', html.includes('Loses value (suggested)'), true);
            assert('a confirmed kind has a plain chip', html.includes('>Cash<'), true);
            const dh = debtAssetBodyHtml(debtAssetModel(d, 'debt'));
            assert('label chip and rate badge sit together', [dh.includes('Bad debt (suggested)'), dh.includes('High interest'), dh.includes('Good debt'), dh.includes('Moderate interest')], [true, true, true, true]);
            assert('rate bands', [rateBand(10.5), rateBand(10), rateBand(5), rateBand(4.99)], ['high', 'moderate', 'moderate', 'low']);
            assert('super reads as Super', assetChipsHtml({ kind: 'invested', isSuper: true }).includes('Super'), true);
            const bad = debtAssetBodyHtml(debtAssetModel({ assets: [{ name: HOSTILE, balance: 1, kind: 'cash' }] }, 'asset'));
            assert('hostile names escaped', [bad.includes('<img'), bad.includes('&lt;img')], [false, true]);
            assert('an old row with no kind has no chip', assetChipsHtml({ name: 'x', balance: 1 }), '');
            assert('an old debt still gets its rate badge', debtChipsHtml({ interestRate: 3 }).includes('Low interest'), true);
        },
    },
];

ASSET_DEBT_SHEETS_TEST_CASES.push(...DB12_TEST_CASES); // FT-0032 DB12: the asset screen for the reference database
