// Asset and debt sheets (owner: F5, M-14). Pure: no DOM, no storage. Fills M0's stub.
//
// - newAsset / newDebt: the one place a new row is built, with an id and every F2 detail field, so a
//   row added after the migration ran is not left bare (the assetDebtVersion guard would never fill it).
//   newIncomeSource is built beside them for the same reason (income source ids).
// - assetSheetSpec / debtSheetSpec: field specs for openSheet. The fields depend on the kind (assets) or
//   the interest type (debts), so the opener reopens the sheet when `reopenOn` fields change.
// - applyAssetValues / applyDebtValues: write the sheet values back. A suggested kind or label stays
//   flagged (kindSuggested / labelSuggested) until the user picks one or confirms it on the "Check these N"
//   card (FT-R-53 pattern). The entered balance is never changed here except by what the user typed.
// - checkItems / checkCardHtml / confirmSuggestion: the "Check these N" card.
// - rateBand: the High / Moderate / Low badge beside the good or bad label.
// Maths come from calc/assets-debts.js (F2), ids from state/asset-debt-migration.js and bucket-migration.js.

import '../i18n/en-lazy-plan-lists.js'; // the DB12 asset and loan strings (en-lazy)
import { t } from '../i18n/strings.js';
import { esc, escNum } from './html.js';
import { formatCurrency } from '../utils.js';
import { newLiabilityId } from '../state/bucket-migration.js';
import { newAssetId, newIncomeSourceId } from '../state/asset-debt-migration.js';
import { suggestKind, suggestLabel, depreciatedValue, depreciationDiffers, claimField, heldOutAssets, VEHICLE_DEPRECIATION } from '../calc/assets-debts.js';
import { suggestFromName, applyTypeSuggestion, confirmType, typeFill, appKindOf, powertrainFactors } from '../calc/asset-types.js';
import { suggestLoanLink, hasHomeWord } from '../state/loan-link-migration.js';

export const ASSET_KINDS = ['cash', 'invested', 'appreciating', 'depreciating'];
export { DEBT_LABELS, rateBand } from '../calc/assets-debts.js'; // they live in the core calc module so the Future model does not pull this whole file into the first load
import { DEBT_LABELS, rateBand } from '../calc/assets-debts.js';
export const POWERTRAINS = ['petrol', 'hybrid', 'phev', 'ev']; // "petrol" stands for petrol or diesel (the same factor)
export const USES = ['liveIn', 'investment'];
/** Reference confidence that is not a sure thing: "Confirm all" leaves these for the person (FT-R-126). */
export const UNSURE_CONFIDENCE = ['low-medium', 'low', 'very low'];
export const DEFAULT_ASSET_NAME = 'New Asset';
export const DEFAULT_DEBT_NAME = 'New Liability';
export const DEFAULT_INCOME_NAME = 'New Income';

const INTEREST_FREQS = ['daily', 'monthly', 'quarterly', 'yearly'];
const DIVIDEND_FREQS = ['monthly', 'quarterly', 'yearly'];
const REPAY_FREQS = ['weekly', 'fortnightly', 'monthly'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const blank = (x) => x === undefined || x === null || x === '';
const numOrNull = (x) => (blank(x) || !Number.isFinite(Number(x)) ? null : Number(x));
const freqOptions = (list) => list.map((f) => ({ value: f, label: t(`f.ad.freq.${f}`) }));
const isDefaultName = (name, dflt) => !String(name || '').trim() || String(name).trim() === dflt;

// ---------- factories ----------

/** A vehicle-shaped depreciation record (ATO effective-life defaults), purchase detail empty. */
export function newDepreciation(over = {}) {
    return {
        method: 'declining', ratePct: VEHICLE_DEPRECIATION.decliningRatePct, lifeYears: VEHICLE_DEPRECIATION.lifeYears,
        residual: 0, purchasePrice: null, purchaseDate: null, ...over,
    };
}

/**
 * A new asset row with an id and every detail field. `list` is the array it will join (ids stay unique);
 * `fields` overlays name, balance, kind and so on. With a name and no kind the kind is suggested from the
 * name and flagged (kindSuggested) so the "Check these N" card shows it; a blank or default name is plain cash.
 */
export function newAsset(list = [], fields = {}) {
    const name = fields.name == null ? DEFAULT_ASSET_NAME : String(fields.name);
    const row = {
        id: newAssetId(list, name), name, balance: 0,
        kind: 'cash', kindSuggested: false, isSuper: false,
        interestFrequency: 'monthly', expectedReturn: null, dividendYield: null, dividendFrequency: 'quarterly',
        reinvestDividends: true, growthRate: null, depreciation: null,
    };
    Object.assign(row, fields, { name, id: fields.id || row.id });
    if (!ASSET_KINDS.includes(fields.kind)) {
        if (!isDefaultName(name, DEFAULT_ASSET_NAME)) {
            const s = suggestKind(name);
            row.kind = s.kind; row.isSuper = s.isSuper; row.kindSuggested = true;
        } else { row.kind = 'cash'; row.kindSuggested = false; }
    }
    if (row.kind === 'depreciating' && !row.depreciation) row.depreciation = newDepreciation();
    return row;
}

/** A new debt row with an id (E4's shape) and every detail field. Label suggested from the name and flagged. */
export function newDebt(list = [], fields = {}, assets = null) {
    const name = fields.name == null ? DEFAULT_DEBT_NAME : String(fields.name);
    const row = {
        id: newLiabilityId(list, name), name, balance: 0, interestRate: 0,
        interestType: 'variable', fixedUntil: null, rateAfterFixed: null, compounding: 'monthly',
        repaymentFrequency: 'monthly', minRepayment: null, label: null, labelSuggested: false,
        forAssetId: null, forAssetSuggested: false, // FT-R-128 3: the property this loan is for; a guess stays suggested until confirmed
    };
    Object.assign(row, fields, { name, id: fields.id || row.id });
    if (!('label' in fields) && !isDefaultName(name, DEFAULT_DEBT_NAME)) {
        const s = suggestLabel(name);
        row.label = s; row.labelSuggested = s !== null;
    }
    if (!('forAssetId' in fields) && Array.isArray(assets) && !isDefaultName(name, DEFAULT_DEBT_NAME)) {
        const id = suggestLoanLink(row, assets);
        if (id) { row.forAssetId = id; row.forAssetSuggested = true; }
    }
    return row;
}

/** A new income source with an id (`inc-<slug>`). The pay detail is C6's sheet; this is the legacy shape plus the id. */
export function newIncomeSourceRow(list = [], fields = {}) {
    const name = fields.name == null ? DEFAULT_INCOME_NAME : String(fields.name);
    return {
        id: newIncomeSourceId(list, name), name, incomeType: 'salaried', grossAnnual: 0, paySchedule: 'fortnightly',
        hoursPerCycle: null, taxRemoved: null, invoicedPayPostTax: null, payAnchor: null, ...fields,
    };
}

/** Give an existing row any detail field it lacks (never touches what is there). Used when an old row is edited. */
export function ensureAssetDetail(row) {
    const base = newAsset([], { name: row.name, kind: ASSET_KINDS.includes(row.kind) ? row.kind : undefined });
    for (const k of Object.keys(base)) {
        if (k === 'interestRate' || k === 'id' || k === 'kindSuggested') continue;
        if (row[k] === undefined) row[k] = base[k];
    }
    if (row.kindSuggested === undefined) row.kindSuggested = false;
    return row;
}

export function ensureDebtDetail(row) {
    const base = newDebt([], { name: row.name, label: row.label === undefined ? null : row.label });
    for (const k of Object.keys(base)) {
        if (k === 'id' || k === 'labelSuggested') continue;
        if (row[k] === undefined) row[k] = base[k];
    }
    if (row.labelSuggested === undefined) row.labelSuggested = false;
    return row;
}

// ---------- the High / Moderate / Low badge ----------

// ---------- chips for the Plan rows ----------

const chip = (cls, text) => `<span class="pill${cls ? ` ${cls}` : ''}">${esc(text)}</span>`;

/** Kind chip for an asset row (and "suggested" when it is still a guess). */
export function assetChipsHtml(a) {
    const kind = ASSET_KINDS.includes(a.kind) ? a.kind : null;
    if (!kind) return '';
    const text = kind === 'invested' && a.isSuper ? t('f.ad.kind.super') : t(`f.ad.kind.short.${kind}`);
    const sug = a.kindSuggested ? `${text} (${t('f.ad.suggested')})` : text;
    return chip(a.kindSuggested ? 'review' : '', sug) + (a.rateMode === 'noReliableRate' ? chip('', t('f.ad.noRate.chip')) : '');
}

/** Good or bad chip plus the rate-band badge for a debt row. */
export function debtChipsHtml(l) {
    const band = rateBand(l.interestRate);
    const bandCls = band === 'high' ? 'due' : band === 'low' ? 'ok' : '';
    let out = '';
    if (DEBT_LABELS.includes(l.label)) {
        const text = t(`f.ad.debt.label.${l.label}`);
        out += chip(l.labelSuggested ? 'review' : (l.label === 'good' ? 'ok' : 'due'), l.labelSuggested ? `${text} (${t('f.ad.suggested')})` : text);
    }
    return out + chip(bandCls, t(`f.ad.rate.${band}`));
}

// ---------- sheet specs ----------

const dollars = (n) => formatCurrency(Math.round((Number(n) || 0) * 100) / 100);

/** The flat sheet keys for a depreciation record. */
function depKeys(dep) {
    const d = dep || {};
    return {
        depPurchasePrice: numOrNull(d.purchasePrice), depPurchaseDate: d.purchaseDate || null, depMethod: d.method === 'straight' ? 'straight' : 'declining',
        depRatePct: numOrNull(d.ratePct), depLifeYears: numOrNull(d.lifeYears), depResidual: numOrNull(d.residual) || 0,
        depBoughtNew: d.boughtNew === true ? 'yes' : d.boughtNew === false ? 'no' : '', depNewPrice: numOrNull(d.newPrice), depAgeAtPurchase: numOrNull(d.ageAtPurchase),
    };
}

/** A depreciation record from the flat sheet values. The second-hand keys are only written when the sheet asked for them. */
export function depreciationFromValues(v) {
    const method = v.depMethod === 'straight' ? 'straight' : 'declining';
    const dflt = method === 'straight' ? VEHICLE_DEPRECIATION.straightRatePct : VEHICLE_DEPRECIATION.decliningRatePct;
    const dep = {
        method,
        ratePct: numOrNull(v.depRatePct) == null ? dflt : numOrNull(v.depRatePct),
        lifeYears: numOrNull(v.depLifeYears) == null ? VEHICLE_DEPRECIATION.lifeYears : numOrNull(v.depLifeYears),
        residual: numOrNull(v.depResidual) || 0,
        purchasePrice: numOrNull(v.depPurchasePrice),
        purchaseDate: ISO.test(String(v.depPurchaseDate || '')) ? v.depPurchaseDate : null,
    };
    if (v.depBoughtNew === 'yes') dep.boughtNew = true;
    else if (v.depBoughtNew === 'no') dep.boughtNew = false;
    if ('depNewPrice' in v) dep.newPrice = numOrNull(v.depNewPrice);
    if ('depAgeAtPurchase' in v) dep.ageAtPurchase = numOrNull(v.depAgeAtPurchase);
    return dep;
}

function kindOf(asset, carry, opts) {
    const k = opts.kind != null ? opts.kind : (carry && carry.kind != null ? carry.kind : (asset ? asset.kind : ''));
    return ASSET_KINDS.includes(k) ? k : '';
}

/** How a type's curve is read: 'new' (a percent of the new price: a second-hand item needs its age), 'pricePaid', or null (no curve). */
export function curveBasisOf(type, asset) {
    const c = asset && asset.valueCurve;
    if (c && c.basis) return c.basis;
    const pts = type && Array.isArray(type.curve) && type.curve.length ? type.curve : null;
    return pts ? ('pctOfPricePaid' in pts[0] ? 'pricePaid' : 'new') : null;
}

const noRateOf = (type, asset) => (type && type.counts && type.counts.rateMode === 'noReliableRate') || (asset && asset.rateMode === 'noReliableRate');
const nonNeg = (x) => x != null && x !== '' && Number.isFinite(Number(x)) && Number(x) >= 0;
const same = (a, b) => (a || '') === (b || '');

/**
 * Field spec for the asset sheet. `asset` null = adding. opts: `today` (ISO, for the depreciation offer), `kind` (override),
 * `carry` (values entered so far), `types` (the reference asset types, [] when none loaded: the sheet then guesses the kind from
 * the name as before) and `changed` (the key whose change reopened the sheet: 'assetType' makes the kind follow the type, 'kind'
 * drops a type that no longer fits).
 * A suggestion from the matcher is a note under the Type row with a one-tap fix. Picking a type, or accepting it, confirms it
 * (FT-R-117, FT-R-126); the hidden toggles `confirmed` and `useConfirmed` carry a tap on a "Confirm" note to the save.
 * Returns { title, fields, values, validate, plausibility, reopenOn }.
 */
export function assetSheetSpec(asset, opts = {}) {
    const carry = opts.carry || null;
    const types = Array.isArray(opts.types) ? opts.types : [];
    let kind = kindOf(asset, carry, opts);
    const editing = !!asset;
    let typeId = carry && carry.assetType !== undefined ? (carry.assetType || '') : ((asset && asset.assetType) || '');
    let type = typeId ? types.find((x) => x.id === typeId) || null : null;
    if (type) {
        const tk = appKindOf(type);
        if (opts.changed === 'kind' && carry && carry.kind && carry.kind !== tk) { type = null; typeId = ''; }
        else if (opts.changed === 'assetType' || !kind) kind = tk;
    }
    const noRate = !!noRateOf(type, asset);
    const basis = kind === 'depreciating' ? curveBasisOf(type, asset) : null;
    const hasPowertrain = !!(type && type.powertrainFactor) || !!(asset && asset.valueCurve && asset.valueCurve.powertrain);
    const kindOptions = ASSET_KINDS.map((k) => ({ value: k, label: t(`f.ad.kind.${k}`) }));
    if (!kind) kindOptions.unshift({ value: '', label: t('f.ad.kind.blank') });
    const kindSuggestedNow = !!(asset && asset.kindSuggested && (!carry || (same(carry.kind, asset.kind) && same(carry.assetType, asset.assetType))) && !opts.kind);
    const typeSuggestedNow = !!(asset && asset.assetType && asset.typeSuggested && typeId === asset.assetType);

    const fields = [{ key: 'name', label: t('f.ad.name'), type: 'text', required: true }];
    if (types.length) {
        fields.push({
            key: 'assetType', label: t('f.ad.type'), type: 'select', hint: typeSuggestedNow ? t('f.ad.type.suggestedNote') : t('f.ad.type.hint'),
            options: [{ value: '', label: t('f.ad.type.none') }, ...types.map((x) => ({ value: x.id, label: x.name }))],
        });
    }
    fields.push(
        { key: 'kind', label: t('f.ad.kind'), type: 'select', options: kindOptions, hint: kindSuggestedNow ? t('f.ad.suggestedNote') : (kind ? undefined : t('f.ad.kind.hint')) },
        { key: 'balance', label: t('f.ad.balance.asset'), type: 'money', required: true, hint: noRate ? t('f.ad.noRate.hint') : undefined },
    );
    if (kind === 'cash') {
        fields.push(
            { key: 'interestRate', label: t('f.ad.interestRate'), type: 'percent', hint: t('f.ad.interestRate.hint') },
            { key: 'interestFrequency', label: t('f.ad.interestFrequency'), type: 'select', options: freqOptions(INTEREST_FREQS) },
        );
    } else if (kind === 'invested') {
        fields.push({ key: 'isSuper', label: t('f.ad.isSuper'), type: 'toggle' });
        if (!noRate) {
            fields.push(
                { key: 'expectedReturn', label: t('f.ad.expectedReturn'), type: 'percent', hint: t('f.ad.expectedReturn.hint') },
                { key: 'dividendYield', label: t('f.ad.dividendYield'), type: 'percent', hint: t('f.ad.dividendYield.hint') },
                { key: 'dividendFrequency', label: t('f.ad.dividendFrequency'), type: 'select', options: freqOptions(DIVIDEND_FREQS) },
                { key: 'reinvestDividends', label: t('f.ad.reinvest'), type: 'toggle' },
            );
        }
    } else if (kind === 'appreciating') {
        fields.push(
            { key: 'use', label: t('f.ad.use'), type: 'select', hint: t('f.ad.use.hint'), options: USES.map((u) => ({ value: u, label: t(`f.ad.use.${u}`) })) },
            { key: 'growthRate', label: t('f.ad.growthRate'), type: 'percent', hint: t('f.ad.growthRate.hint') },
        );
    } else if (kind === 'depreciating') {
        if (hasPowertrain) fields.push({ key: 'powertrain', label: t('f.ad.powertrain'), type: 'select', hint: t('f.ad.powertrain.hint'), options: POWERTRAINS.map((p) => ({ value: p, label: t(`f.ad.powertrain.${p}`) })) });
        fields.push(
            { key: 'depPurchasePrice', label: t('f.ad.dep.price'), type: 'money' },
            { key: 'depPurchaseDate', label: t('f.ad.dep.date'), type: 'date', hint: basis === 'pricePaid' ? t('f.ad.dep.dateHint') : undefined },
        );
        if (basis === 'new') {
            fields.push({ key: 'depBoughtNew', label: t('f.ad.dep.boughtNew'), type: 'select', options: [
                { value: '', label: t('f.ad.dep.boughtNew.blank') }, { value: 'yes', label: t('f.ad.dep.boughtNew.yes') }, { value: 'no', label: t('f.ad.dep.boughtNew.no') }] });
        }
        const boughtNo = ((carry && carry.depBoughtNew !== undefined) ? carry.depBoughtNew : depKeys(asset && asset.depreciation).depBoughtNew) === 'no';
        if (basis === 'new' && boughtNo) {
            fields.push(
                { key: 'depNewPrice', label: t('f.ad.dep.newPrice'), type: 'money' },
                { key: 'depAgeAtPurchase', label: t('f.ad.dep.age'), type: 'number', hint: t('f.ad.dep.age.hint') },
            );
        }
        fields.push(
            { key: 'depMethod', label: t('f.ad.dep.method'), type: 'select', options: [
                { value: 'declining', label: t('f.ad.dep.method.declining') }, { value: 'straight', label: t('f.ad.dep.method.straight') }] },
            { key: 'depRatePct', label: t('f.ad.dep.rate'), type: 'percent', hint: t('f.ad.dep.rate.hint') },
            { key: 'depLifeYears', label: t('f.ad.dep.life'), type: 'number' },
            { key: 'depResidual', label: t('f.ad.dep.residual'), type: 'money' },
        );
    }
    fields.push({ key: 'confirmed', type: 'toggle', hidden: true }, { key: 'useConfirmed', type: 'toggle', hidden: true }, { key: 'priorType', type: 'text', hidden: true });

    const base = asset
        ? { ...asset, ...depKeys(asset.depreciation) }
        : { name: '', balance: null, kind: '', isSuper: false, interestFrequency: 'monthly', dividendFrequency: 'quarterly', reinvestDividends: true, ...depKeys(null) };
    if (kind === 'depreciating' && !(asset && asset.depreciation)) {
        Object.assign(base, depKeys(newDepreciation()), { depPurchasePrice: null, depPurchaseDate: null });
    }
    base.assetType = (asset && asset.assetType) || '';
    base.powertrain = (asset && asset.valueCurve && asset.valueCurve.powertrain) || 'petrol';
    base.use = USES.includes(asset && asset.use) ? asset.use : 'liveIn';
    base.confirmed = false;
    base.useConfirmed = false;
    const values = { ...base, ...(carry || {}), kind };
    values.assetType = typeId;
    // The type whose figures the sheet is showing: what a change of type may replace, and nothing else.
    const priorId = carry && carry.priorType !== undefined ? carry.priorType : ((asset && asset.assetType) || '');
    const priorType = priorId ? types.find((x) => x.id === priorId) || null : null;
    values.priorType = typeId;
    if (type && opts.changed === 'assetType' && (!asset || asset.assetType !== type.id || priorId !== type.id)) {
        // a type just picked or accepted: its suggested figures show, and become the person's on Save (they are theirs once edited).
        // A figure the person typed is theirs already: only a blank one, or one still equal to the earlier type's, is filled.
        const f = typeFill(type, { powertrain: values.powertrain }).fields;
        const was = priorType ? typeFill(priorType, { powertrain: values.powertrain }).fields : {};
        const open = (v, k) => v == null || v === '' || v === was[k];
        for (const k of ['interestRate', 'expectedReturn', 'growthRate']) if (typeof f[k] === 'number' && open(values[k], k)) values[k] = f[k];
        if (f.isSuper) values.isSuper = true;
        if (f.depreciation) {
            const wd = was.depreciation || {};
            const norm = (m) => (m === 'straight' ? 'straight' : 'declining');
            const untouched = !priorType || (values.depRatePct === wd.ratePct && (values.depResidual || 0) === (wd.residual || 0) && norm(values.depMethod) === norm(wd.method));
            if (untouched || values.depRatePct == null) {
                values.depMethod = norm(f.depreciation.method);
                values.depRatePct = f.depreciation.ratePct;
                values.depResidual = f.depreciation.residual || 0;
                values.depLifeYears = null;
            }
        }
    }
    if (kind === 'depreciating') {
        const dflt = newDepreciation();
        if (!(asset && asset.depreciation) && !type) {
            // a new vehicle-shaped asset starts on the ATO defaults unless the user has typed something else
            if (values.depRatePct == null) values.depRatePct = values.depMethod === 'straight' ? VEHICLE_DEPRECIATION.straightRatePct : dflt.ratePct;
        }
        if (values.depLifeYears == null) values.depLifeYears = dflt.lifeYears;
    }
    if (!editing && values.balance === 0) values.balance = null;

    const title = editing ? t('f.ad.asset.title.edit', { name: asset.name || t('a.plan.list.unnamed') }) : t('f.ad.asset.title.add');
    return {
        title, fields, values, reopenOn: ['kind', 'assetType', 'depBoughtNew'],
        validate(v) {
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('a.plan.err.name');
            if (v.balance == null || !(Number(v.balance) >= 0)) errors.balance = t('f.ad.err.amount');
            for (const k of ['interestRate', 'expectedReturn', 'dividendYield', 'depRatePct', 'depLifeYears', 'depPurchasePrice', 'depResidual', 'depNewPrice', 'depAgeAtPurchase']) {
                if (v[k] != null && fields.some((f) => f.key === k) && !(Number(v[k]) >= 0)) errors[k] = t('f.ad.err.rate');
            }
            if (v.depPurchaseDate && !ISO.test(String(v.depPurchaseDate))) errors.depPurchaseDate = t('f.ad.err.date');
            return errors;
        },
        plausibility(v) {
            const notes = [];
            const chosen = v.assetType ? types.find((x) => x.id === v.assetType) || null : null;
            // the suggestion as the name is typed (with no types loaded there is none: the kind is guessed on Save)
            const sug = types.length && !v.assetType && String(v.name || '').trim() ? suggestFromName(v.name, types) : null;
            const typeSuggestedHere = !!(asset && asset.assetType && asset.typeSuggested && v.assetType === asset.assetType && !v.confirmed);
            if (sug && sug.source === 'type') {
                notes.push({ field: 'assetType', message: t('f.ad.type.suggest', { type: sug.type.name }), fix: { label: t('f.ad.type.use'), apply: () => ({ assetType: sug.typeId, confirmed: true }) } });
            } else if (typeSuggestedHere && chosen) {
                notes.push({ field: 'assetType', message: t('f.ad.type.suggested', { type: chosen.name }), fix: { label: t('f.ad.confirm'), apply: () => ({ confirmed: true }) } });
            } else if (asset && asset.kindSuggested && !v.confirmed && same(v.kind, asset.kind) && same(v.assetType, asset.assetType)) {
                notes.push({ field: 'kind', message: t('f.ad.kind.notCounted'), fix: { label: t('f.ad.confirm'), apply: () => ({ confirmed: true }) } });
            } else if (asset && asset.kindSuggested && v.confirmed) {
                notes.push({ field: asset.assetType && types.length ? 'assetType' : 'kind', message: t('f.ad.confirmedNote') });
            }
            if (v.kind === 'appreciating') {
                const stored = asset && USES.includes(asset.use) ? asset.use : 'liveIn';
                const sugUse = (!asset || asset.useSuggested !== false) && !v.useConfirmed && v.use === stored;
                if (sugUse) notes.push({ field: 'use', message: t('f.ad.use.suggested', { use: t(`f.ad.use.${v.use}`) }), fix: { label: t('f.ad.confirm'), apply: () => ({ useConfirmed: true }) } });
                else if (v.useConfirmed) notes.push({ field: 'use', message: t('f.ad.confirmedNote') });
            }
            if (v.kind === 'depreciating') {
                const b = curveBasisOf(chosen, asset);
                const probe = { balance: Number(v.balance) || 0, depreciation: depreciationFromValues(v) };
                if (b === 'new' && !(v.depBoughtNew === 'yes' || (v.depBoughtNew === 'no' && nonNeg(v.depAgeAtPurchase) && Number(v.depNewPrice) > 0))) {
                    notes.push({ field: 'depBoughtNew', message: t('f.ad.dep.fallbackNote') });
                }
                if (b && !(v.depPurchaseDate && ISO.test(String(v.depPurchaseDate)))) {
                    notes.push({ field: 'depPurchaseDate', message: t('f.ad.dep.fallbackDate') }); // either curve needs the date to know the age
                }
                if (opts.today && !(chosen && !(asset && asset.valueCurve)) && depreciationDiffers({ ...probe, ...(asset && asset.valueCurve ? { valueCurve: asset.valueCurve } : {}) }, opts.today)) {
                    const worked = depreciatedValue({ ...probe, ...(asset && asset.valueCurve ? { valueCurve: asset.valueCurve } : {}) }, opts.today);
                    notes.push({
                        field: 'balance',
                        message: t('f.ad.dep.offer', { worked: dollars(worked), entered: dollars(probe.balance) }),
                        fix: { label: t('f.ad.dep.use', { worked: dollars(worked) }), apply: () => ({ balance: worked }) },
                    });
                }
            }
            return notes;
        },
    };
}

/** The properties a loan can be for (FT-R-128 3): assets of kind appreciating that have an id. */
export const propertiesOf = (assets) => (Array.isArray(assets) ? assets : []).filter((a) => a && typeof a === 'object' && a.kind === 'appreciating' && a.id != null && a.id !== '');

/**
 * Field spec for the debt sheet. `debt` null = adding. opts: `carry` (values entered so far), `assets` (the person's assets:
 * when given and at least one is a property, the sheet asks "This loan is for", listing only properties).
 */
export function debtSheetSpec(debt, opts = {}) {
    const carry = opts.carry || null;
    const row = debt || null;
    const props = propertiesOf(opts.assets);
    const interestType = (carry && carry.interestType) || (row && row.interestType) || 'variable';
    const suggested = !!(row && row.labelSuggested && (!carry || (carry.label || null) === (row.label || null)));
    const fields = [
        { key: 'name', label: t('f.ad.name'), type: 'text', required: true },
        { key: 'balance', label: t('f.ad.balance.debt'), type: 'money', required: true },
        { key: 'interestRate', label: t('f.ad.debt.rate'), type: 'percent', hint: t('f.ad.debt.rate.hint') },
        { key: 'interestType', label: t('f.ad.debt.type'), type: 'select', options: [
            { value: 'variable', label: t('f.ad.debt.type.variable') }, { value: 'fixed', label: t('f.ad.debt.type.fixed') }] },
    ];
    if (interestType === 'fixed') {
        fields.push(
            { key: 'fixedUntil', label: t('f.ad.debt.fixedUntil'), type: 'date' },
            { key: 'rateAfterFixed', label: t('f.ad.debt.rateAfter'), type: 'percent', hint: t('f.ad.debt.rateAfter.hint') },
        );
    }
    fields.push(
        { key: 'compounding', label: t('f.ad.debt.compounding'), type: 'select', options: freqOptions(INTEREST_FREQS) },
        { key: 'repaymentFrequency', label: t('f.ad.debt.repayFreq'), type: 'select', options: freqOptions(REPAY_FREQS) },
        { key: 'minRepayment', label: t('f.ad.debt.min'), type: 'money', hint: t('f.ad.debt.min.hint') },
    );
    if (props.length) {
        fields.push({ key: 'forAssetId', label: t('f.ad.loan.for'), type: 'select', hint: t('f.ad.loan.for.hint'),
            options: [{ value: '', label: t('f.ad.loan.for.none') }, ...props.map((p) => ({ value: p.id, label: p.name || t('a.plan.list.unnamed') }))] });
        fields.push({ key: 'forAssetConfirmed', type: 'toggle', hidden: true });
    }
    fields.push(
        { key: 'label', label: t('f.ad.debt.label'), type: 'select', hint: suggested ? t('f.ad.debt.suggestedNote') : t('f.ad.debt.label.hint'), options: [
            { value: '', label: t('f.ad.debt.label.none') }, { value: 'good', label: t('f.ad.debt.label.good') }, { value: 'bad', label: t('f.ad.debt.label.bad') }] },
    );
    const base = row
        ? { ...row, label: row.label || '', minRepayment: row.minRepayment == null ? null : row.minRepayment, forAssetId: row.forAssetId == null ? '' : row.forAssetId }
        : { name: '', balance: null, interestRate: null, interestType: 'variable', fixedUntil: null, rateAfterFixed: null, compounding: 'monthly', repaymentFrequency: 'monthly', minRepayment: null, label: '', forAssetId: '' };
    base.forAssetConfirmed = false;
    const values = { ...base, ...(carry || {}), interestType };
    const title = row ? t('f.ad.debt.title.edit', { name: row.name || t('a.plan.list.unnamed') }) : t('f.ad.debt.title.add');
    const nameOf = (id) => { const p = props.find((x) => String(x.id) === String(id)); return p ? (p.name || t('a.plan.list.unnamed')) : ''; };
    return {
        title, fields, values, reopenOn: ['interestType'],
        validate(v) {
            const errors = {};
            if (!String(v.name || '').trim()) errors.name = t('a.plan.err.name');
            if (v.balance == null || !(Number(v.balance) >= 0)) errors.balance = t('f.ad.err.amount');
            if (v.interestRate != null && !(Number(v.interestRate) >= 0)) errors.interestRate = t('f.ad.err.rate');
            if (v.rateAfterFixed != null && !(Number(v.rateAfterFixed) >= 0)) errors.rateAfterFixed = t('f.ad.err.rate');
            if (v.minRepayment != null && !(Number(v.minRepayment) >= 0)) errors.minRepayment = t('f.ad.err.amount');
            if (v.fixedUntil && !ISO.test(String(v.fixedUntil))) errors.fixedUntil = t('f.ad.err.date');
            return errors;
        },
        plausibility(v) {
            if (!props.length) return [];
            const stored = row && row.forAssetId != null ? String(row.forAssetId) : '';
            if (!v.forAssetId) {
                const id = suggestLoanLink({ name: v.name }, opts.assets);
                return id ? [{ field: 'forAssetId', message: t('f.ad.loan.suggest', { home: nameOf(id) }), fix: { label: t('f.ad.loan.link'), apply: () => ({ forAssetId: id, forAssetConfirmed: true }) } }] : [];
            }
            if (v.forAssetConfirmed) return [{ field: 'forAssetId', message: t('f.ad.confirmedNote') }];
            if (row && row.forAssetSuggested !== false && stored === String(v.forAssetId)) {
                return [{ field: 'forAssetId', message: t('f.ad.loan.suggested', { home: nameOf(v.forAssetId) }), fix: { label: t('f.ad.confirm'), apply: () => ({ forAssetConfirmed: true }) } }];
            }
            return [];
        },
    };
}

// ---------- writing the sheet values back ----------

/** The fields a type wrote or governs: dropped together when the person removes the type or picks a kind it does not fit. */
const TYPE_KEYS = ['assetType', 'typeSuggested', 'typeFilled', 'typeConfidence', 'valueCurve', 'valueStable', 'rateMode', 'isOffset'];
const clearType = (row) => { for (const k of TYPE_KEYS) delete row[k]; };

/** Put a type's suggestion on an asset and leave it suggested (the person has not seen it yet). Remembers how sure the reference is. */
export function suggestTypeOnRow(row, types) {
    const s = suggestFromName(row.name, types);
    if (!s.type) return false;
    if (!applyTypeSuggestion(row, s.type)) return false;
    row.typeConfidence = s.type.confidence == null ? null : s.type.confidence;
    return true;
}

const sameDep = (a, b) => {
    if (!a || !b) return a === b;
    const m = (x) => (x.method === 'straight' ? 'straight' : 'declining');
    return m(a) === m(b) && (a.ratePct ?? null) === (b.ratePct ?? null) && (a.residual || 0) === (b.residual || 0) && (m(a) !== 'straight' || (a.lifeYears ?? null) === (b.lifeYears ?? null));
};

/**
 * Write sheet values onto an asset row (new or existing). Returns the row. A kind picked by the user confirms it.
 * opts: `types` (the reference asset types), `isNew` (a row just made by `newAsset`).
 * - A type picked or accepted on the sheet is applied and confirmed with its kind (FT-R-117, FT-R-126). The kind follows it.
 * - A new row saved with no kind and no type picked gets the matcher's suggestion, left suggested (held out of FI until confirmed).
 * - Any rate or rule the person changed becomes theirs (`claimField`); one they did not touch stays as the type left it.
 */
export function applyAssetValues(row, v, opts = {}) {
    const types = Array.isArray(opts.types) ? opts.types : [];
    const name = String(v.name || '').trim();
    const prevKind = ASSET_KINDS.includes(row.kind) ? row.kind : null;
    row.name = name;
    row.balance = Number(v.balance) || 0;
    const picked = ASSET_KINDS.includes(v.kind) ? v.kind : null;
    const typeId = typeof v.assetType === 'string' ? v.assetType : null; // null: the sheet had no Type row
    const type = typeId ? types.find((x) => x.id === typeId) || null : null;
    const typeChanged = typeId !== null && typeId !== (row.assetType || '');
    if (typeId === '' && row.assetType) clearType(row);
    else if (type && typeChanged) {
        clearType(row);
        row.kindSuggested = true; // the type's kind is taken while the kind is only suggested
        const ok = applyTypeSuggestion(row, type, { powertrain: v.powertrain });
        if (ok) { confirmType(row); row.kindSuggested = false; }
    } else if (picked && prevKind && picked !== prevKind && row.assetType) clearType(row);
    if (picked) {
        if (picked !== row.kind || !ASSET_KINDS.includes(row.kind)) { row.kind = picked; row.kindSuggested = false; }
        else if (row.kindSuggested === undefined) row.kindSuggested = false;
    } else if (!prevKind) {
        const s = suggestKind(name);
        row.kind = s.kind; row.isSuper = s.isSuper; row.kindSuggested = true;
    }
    if (v.confirmed) { row.kindSuggested = false; if (row.assetType) confirmType(row); }
    const before = { interestRate: row.interestRate, expectedReturn: row.expectedReturn, growthRate: row.growthRate, isSuper: row.isSuper, depreciation: row.depreciation ? { ...row.depreciation } : null };
    if (row.kind === 'invested') { if (picked) row.isSuper = !!v.isSuper; } else if (picked) row.isSuper = false;
    if (!blank(v.interestRate) && isNum(Number(v.interestRate))) row.interestRate = Number(v.interestRate);
    else if (row.kind === 'cash') delete row.interestRate; // unset stays absent, never null (S1.8)
    for (const k of ['expectedReturn', 'dividendYield', 'growthRate']) if (v[k] !== undefined) row[k] = numOrNull(v[k]);
    if (INTEREST_FREQS.includes(v.interestFrequency)) row.interestFrequency = v.interestFrequency;
    if (DIVIDEND_FREQS.includes(v.dividendFrequency)) row.dividendFrequency = v.dividendFrequency;
    if (v.reinvestDividends !== undefined) row.reinvestDividends = !!v.reinvestDividends;
    if (row.kind === 'depreciating' && 'depMethod' in v) {
        const priorSecondHand = row.depreciation || {};
        row.depreciation = depreciationFromValues(v);
        if (!('depBoughtNew' in v)) for (const k of ['boughtNew', 'newPrice', 'ageAtPurchase']) if (priorSecondHand[k] !== undefined) row.depreciation[k] = priorSecondHand[k];
    }
    // FT-R-117: what the person changed is theirs from now on, and a later reference update never touches it.
    for (const k of ['interestRate', 'expectedReturn', 'growthRate', 'isSuper']) if (row[k] !== before[k]) claimField(row, k);
    if (!sameDep(before.depreciation, row.depreciation) && before.depreciation) claimField(row, 'depreciation');
    // the powertrain feeds the curve's factor
    if (row.valueCurve && typeof v.powertrain === 'string' && POWERTRAINS.includes(v.powertrain)) {
        const tp = types.find((x) => x.id === row.assetType);
        row.valueCurve = { ...row.valueCurve, powertrain: v.powertrain, factors: tp ? powertrainFactors(tp, v.powertrain) : row.valueCurve.factors };
    }
    // a property: "I live here" is the default and stays suggested until the person picks or confirms it (FT-R-125)
    if (row.kind === 'appreciating') {
        const next = USES.includes(v.use) ? v.use : (USES.includes(row.use) ? row.use : 'liveIn');
        const changed = next !== (row.use === undefined ? 'liveIn' : row.use); // the default is "I live here": any other answer is a pick
        row.use = next;
        if (changed || v.useConfirmed) row.useSuggested = false;
        else if (row.useSuggested === undefined) row.useSuggested = true;
    } else if (picked && prevKind === 'appreciating' && picked !== 'appreciating') { delete row.use; delete row.useSuggested; }
    if (opts.isNew && !picked && !typeId && !row.assetType && row.kindSuggested && types.length) suggestTypeOnRow(row, types);
    ensureAssetDetail(row);
    if (row.kind === 'depreciating' && !row.depreciation) row.depreciation = newDepreciation();
    return row;
}

/** The linked property's own kind is confirmed with the link (review verdict: confirming a link confirms the home). */
function confirmLinkedKind(assets, id) {
    const home = (Array.isArray(assets) ? assets : []).find((a) => a && a.id != null && String(a.id) === String(id));
    if (!home) return;
    home.kindSuggested = false;
    if (home.assetType) confirmType(home);
}

/**
 * Write sheet values onto a debt row. Changing the label confirms it; leaving it keeps a suggestion flagged.
 * opts.assets (the person's assets, the same array the data holds) turns on the link: a property picked, or a Confirm tap,
 * confirms the link and the property's kind; a loan added (opts.isNew) or renamed with no link gets `suggestLoanLink`, left suggested.
 */
export function applyDebtValues(row, v, opts = {}) {
    const renamed = String(v.name || '').trim() !== String(row.name || '');
    row.name = String(v.name || '').trim();
    row.balance = Number(v.balance) || 0;
    row.interestRate = Number(v.interestRate) || 0;
    if (v.interestType === 'fixed' || v.interestType === 'variable') row.interestType = v.interestType;
    if ('fixedUntil' in v) row.fixedUntil = ISO.test(String(v.fixedUntil || '')) ? v.fixedUntil : null;
    if ('rateAfterFixed' in v) row.rateAfterFixed = numOrNull(v.rateAfterFixed);
    if (INTEREST_FREQS.includes(v.compounding)) row.compounding = v.compounding;
    if (REPAY_FREQS.includes(v.repaymentFrequency)) row.repaymentFrequency = v.repaymentFrequency;
    if ('minRepayment' in v) row.minRepayment = numOrNull(v.minRepayment);
    const prev = DEBT_LABELS.includes(row.label) ? row.label : null;
    const next = DEBT_LABELS.includes(v.label) ? v.label : null;
    if (next !== prev) { row.label = next; row.labelSuggested = false; }
    else if (!prev && row.label === undefined) {
        const s = suggestLabel(row.name);
        row.label = s; row.labelSuggested = s !== null;
    }
    if (Array.isArray(opts.assets)) {
        const link = blank(v.forAssetId) ? null : String(v.forAssetId);
        const prevLink = row.forAssetId == null || row.forAssetId === '' ? null : String(row.forAssetId);
        if (link) {
            const mine = !!v.forAssetConfirmed || link !== prevLink || row.forAssetSuggested === false;
            row.forAssetId = link;
            row.forAssetSuggested = !mine;
            if (mine) confirmLinkedKind(opts.assets, link);
        } else if (prevLink) { row.forAssetId = null; row.forAssetSuggested = false; }
        else if (renamed || opts.isNew || row.forAssetId === undefined) {
            const id = suggestLoanLink(row, opts.assets);
            row.forAssetId = id; row.forAssetSuggested = id != null;
        }
    }
    ensureDebtDetail(row);
    return row;
}

// ---------- the "Check these N" card ----------

/**
 * Is an asset's suggested kind a guess "Confirm all" should leave alone? A reference type matched by name is sure unless the
 * reference itself rates it low. A name that hit a `suggestKind` keyword is sure. A name that matched nothing and only
 * defaulted to cash is not a finding: it is left for the person.
 */
const unsureAsset = (a) => (a.assetType ? a.typeSuggested === true && UNSURE_CONFIDENCE.includes(a.typeConfidence) : suggestKind(a.name).fallback === true);

/**
 * Everything still a guess: [{type, index, id, name, ...}].
 * type 'asset': a kind still only suggested (`value` = the kind; `unsure` when the type is rated low or the name matched nothing).
 * type 'debt': a good or bad label still only suggested.
 * type 'link': a loan linked to a property by a guess (`forName` = the property), FT-R-128 3. These are the same loans
 * `pendingLoanLinks` counts (an unpaid loan is not listed), and the same assets `heldOutAssets` counts.
 */
export function checkItems(data) {
    const out = [];
    const assets = data.assets || [];
    assets.forEach((a, index) => {
        if (a && a.kindSuggested === true) out.push({ type: 'asset', index, id: a.id || '', name: a.name || '', value: a.kind, isSuper: !!a.isSuper, unsure: unsureAsset(a) });
    });
    (data.liabilities || []).forEach((l, index) => {
        if (l && l.labelSuggested === true && DEBT_LABELS.includes(l.label)) out.push({ type: 'debt', index, id: l.id || '', name: l.name || '', value: l.label, unsure: false });
    });
    (data.liabilities || []).forEach((l, index) => {
        if (!l || l.forAssetId == null || l.forAssetId === '' || l.forAssetSuggested === false || !(Number(l.balance) > 0)) return;
        const home = assets.find((a) => a && a.id != null && String(a.id) === String(l.forAssetId));
        // a link is sure only when the loan's own name says it is for a home; one property and no other clue is a weak guess
        const unsure = !hasHomeWord(l.name) || !!(home && home.kindSuggested === true && unsureAsset(home));
        out.push({ type: 'link', index, id: l.id || '', name: l.name || '', forName: home ? (home.name || '') : '', unsure });
    });
    return out;
}

/**
 * The card, or '' when nothing is flagged. Every name is escaped. The title counts the details to check; the held-out line
 * counts the assets the FI figure leaves out until they are confirmed (`heldOutAssets`). With some less certain items,
 * "Confirm all" becomes "Confirm all the sure ones" and leaves those for the person (FT-R-126).
 */
export function checkCardHtml(items, opts = {}) {
    if (!items.length) return '';
    const title = items.length === 1 ? t('f.ad.check.title1') : t('f.ad.check.title', { count: items.length });
    const rows = items.map((it) => {
        const nm = it.name || t('a.plan.list.unnamed');
        let what = it.type === 'asset'
            ? t('f.ad.check.asset', { name: nm, kind: it.isSuper ? t('f.ad.kind.super') : t(`f.ad.kind.short.${it.value}`) })
            : it.type === 'link'
                ? t('f.ad.check.link', { name: nm, home: it.forName || t('a.plan.list.unnamed') })
                : t('f.ad.check.debt', { name: nm, label: t(`f.ad.debt.label.${it.value}`) });
        if (it.unsure) what += ` ${t('f.ad.check.lessSure')}`;
        const key = `${it.type}:${escNum(it.index)}`;
        const tid = `p-check-t-${it.type}-${escNum(it.index)}`; // the repeated buttons are described by their row's text
        return `<li><span class="p-check-text" id="${tid}">${esc(what)}</span>`
            + `<button type="button" class="btn ghost" data-check-confirm="${key}" aria-describedby="${tid}">${esc(t('f.ad.check.confirm'))}</button>`
            + `<button type="button" class="link" data-check-open="${key}" aria-describedby="${tid}">${esc(t('f.ad.check.change'))}</button></li>`;
    }).join('');
    const sure = items.filter((it) => !it.unsure).length;
    const held = opts.heldOut && opts.heldOut.count > 0 ? `<p class="fine p-check-held">${esc(t('f.ad.check.heldOut', { count: opts.heldOut.count }))}</p>` : '';
    const all = sure > 1 ? `<button type="button" class="btn" data-check-all="1">${esc(t(sure < items.length ? 'f.ad.check.allSure' : 'f.ad.check.all'))}</button>` : '';
    return `<section class="card p-review p-check" id="plan-check" aria-labelledby="p-check-h"><h2 id="p-check-h" tabindex="-1">${esc(title)}</h2>`
        + `<p class="muted">${esc(t('f.ad.check.body'))}</p>${held}<ul class="p-review-list p-check-list">${rows}</ul>${all}</section>`;
}

/** The card with the held-out count taken from the data itself. */
export const checkCardFor = (data) => checkCardHtml(checkItems(data), { heldOut: heldOutAssets(data.assets) });

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Confirm one suggested kind, label or link (`which` = 'asset:3' / 'debt:0' / 'link:1') or all the sure ones (`which` = 'all':
 * every item except the ones the reference itself is less sure of, which stay for the person). Only the flag clears; the kind,
 * label and every figure stay as they were. Confirming a link also confirms the linked property's kind, and confirming an
 * asset's kind also confirms its suggested type (its rate and curve then feed the maths). Returns an undo payload.
 */
export function confirmSuggestion(data, which) {
    const before = { assets: clone(data.assets || []), liabilities: clone(data.liabilities || []) };
    const items = checkItems(data);
    const chosen = which === 'all' ? items.filter((it) => !it.unsure) : items.filter((it) => `${it.type}:${it.index}` === which);
    if (!chosen.length) return { ok: false, code: 'missing', message: '', onUndo() {}, onExpire: undefined };
    for (const it of chosen) {
        if (it.type === 'asset') {
            const a = data.assets[it.index];
            a.kindSuggested = false;
            if (a.assetType) confirmType(a);
        } else if (it.type === 'debt') data.liabilities[it.index].labelSuggested = false;
        else {
            const l = data.liabilities[it.index];
            l.forAssetSuggested = false;
            confirmLinkedKind(data.assets, l.forAssetId);
        }
    }
    const left = items.length - chosen.length;
    const message = chosen.length === 1 && which !== 'all' ? t('f.ad.check.confirmed', { name: chosen[0].name || t('a.plan.list.unnamed') })
        : left > 0 && which === 'all' ? t(chosen.length === 1 ? 'f.ad.check.confirmedSure.one' : 'f.ad.check.confirmedSure', { count: chosen.length, left })
            : t('f.ad.check.confirmedAll', { count: chosen.length });
    return {
        ok: true, count: chosen.length, left, message, onExpire: undefined,
        onUndo() {
            data.assets.splice(0, data.assets.length, ...before.assets);
            data.liabilities.splice(0, data.liabilities.length, ...before.liabilities);
        },
    };
}
