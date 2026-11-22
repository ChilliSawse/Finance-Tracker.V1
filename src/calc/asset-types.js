// Asset types in the app (FT-0032 DB10, R3 step R7, section 5.3). Pure and lazy: nothing at startup imports it.
//
// Matching is the one definition of a word match the reference database uses (the merchants' `match: 'word'` in
// src/state/reference-match.js): lowercase letters and digits, single spaces, a whole word or a whole phrase, no
// regular expressions, no guessed plurals. Longest phrase wins (most words, then most characters); a tie goes to the
// type listed first; a type's `exclude` phrase vetoes it. `npm run ref:check` runs its name fixtures through this
// function. `suggestKind` (assets-debts.js) stays the offline fallback when no types are loaded or none match.
//
// Everything a type fills in is only suggested (FT-R-117, FT-R-126): `kindSuggested`, `useSuggested` and
// `typeSuggested` stay true until the person confirms, and the maths ignores a suggested rate or curve
// (see `effectiveAsset`, `assetScope` in assets-debts.js). The entered balance is always the truth.

import { suggestKind } from './assets-debts.js';

export const APP_KINDS = ['cash', 'invested', 'appreciating', 'depreciating'];

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hasWord = (hay, p) => { const n = norm(p); return !!n && hay.includes(' ' + n + ' '); };

/** The asset type for a name, or null: { type, phrase }. `types` is asset-types.json's `types` array. */
export function matchAssetType(name, types) {
    const hay = ' ' + norm(name) + ' ';
    let best = null;
    for (const t of Array.isArray(types) ? types : []) {
        if (!t || (t.exclude || []).some((x) => hasWord(hay, x))) continue;
        for (const p of t.match || []) {
            if (!hasWord(hay, p)) continue;
            const n = norm(p);
            const score = [n.split(' ').length, n.length];
            if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { type: t, phrase: p, score };
        }
    }
    return best ? { type: best.type, phrase: best.phrase } : null;
}

/** The kind the app knows for a type: its own, or its legacyKind. null when neither is an app kind (a setting). */
export const appKindOf = (t) => (t && APP_KINDS.includes(t.kind) ? t.kind : t && APP_KINDS.includes(t.legacyKind) ? t.legacyKind : null);

/** The kind and super flag for a name: the matched type when there is one, else the old `suggestKind` (the offline fallback). */
export function suggestFromName(name, types) {
    const hit = matchAssetType(name, types);
    const kind = hit ? appKindOf(hit.type) : null;
    if (hit && kind) return { kind, isSuper: !!hit.type.isSuper, typeId: hit.type.id, type: hit.type, source: 'type' };
    const s = suggestKind(name);
    return { kind: s.kind, isSuper: s.isSuper, typeId: null, type: null, source: 'fallback' };
}

const pointsOf = (curve) => {
    const field = curve && curve[0] && 'pctOfPricePaid' in curve[0] ? 'pctOfPricePaid' : 'pctOfNew';
    return { basis: field === 'pctOfPricePaid' ? 'pricePaid' : 'new', points: curve.map((p) => ({ year: p.year, pct: p[field] })) };
};

/** The powertrain's factor list from a type's `powertrainFactor`, or null for petrol, diesel or no list. */
export function powertrainFactors(type, powertrain) {
    const pf = type && type.powertrainFactor;
    const list = pf && powertrain && Array.isArray(pf[powertrain]) ? pf[powertrain] : null;
    return list && list.length ? list.map((x) => ({ year: x.year, factor: x.factor })) : null;
}

/**
 * The fields a type would put on an asset, all suggested: { fields, filled }. `fields` is a patch; `filled` is the list
 * of rate and curve fields it wrote (kept on the asset as `typeFilled`). A type's null curve means no `valueCurve`: the
 * maths falls back to `defaults.depreciation`, then the app default, and says so (`valueDetail` fallback).
 * opts.powertrain: 'petrol' | 'diesel' | 'hybrid' | 'phev' | 'ev' for the types that have a factor list.
 */
export function typeFill(type, opts = {}) {
    const kind = appKindOf(type);
    if (!type || !kind) return { fields: {}, filled: [] };
    const d = type.defaults || {};
    const fields = { assetType: type.id, kind, typeSuggested: true };
    const filled = [];
    const put = (k, v) => { fields[k] = v; filled.push(k); };
    if (type.isSuper) fields.isSuper = true;
    if (kind === 'cash' && typeof d.interestRate === 'number') put('interestRate', d.interestRate);
    if (kind === 'invested' && typeof d.expectedReturn === 'number') put('expectedReturn', d.expectedReturn);
    if (kind === 'appreciating') {
        if (typeof d.growthRate === 'number') put('growthRate', d.growthRate);
        fields.use = 'liveIn';
        fields.useSuggested = true;
    }
    if (type.counts && type.counts.rateMode === 'noReliableRate') fields.rateMode = 'noReliableRate';
    if (type.counts && type.counts.showAs === 'cash') fields.isOffset = true;
    if (kind === 'depreciating') {
        const dep = d.depreciation;
        if (dep) put('depreciation', { method: dep.method || 'diminishing', ratePct: dep.ratePct, lifeYears: null, residual: dep.residual || 0, purchasePrice: null, purchaseDate: null });
        if (Array.isArray(type.curve) && type.curve.length) {
            const c = pointsOf(type.curve);
            put('valueCurve', { typeId: type.id, basis: c.basis, points: c.points, powertrain: opts.powertrain || null, factors: powertrainFactors(type, opts.powertrain) });
        }
        if (type.kind === 'stable') put('valueStable', true);
    }
    return { fields, filled };
}

const isDefaultDep = (dep) => !dep || (dep.ratePct === 25 && dep.lifeYears === 8 && dep.purchasePrice == null && dep.purchaseDate == null);

/**
 * Put a type's suggestion on an asset. Returns false and changes nothing when the person already confirmed a type (it is
 * theirs; later updates never touch it). Never writes the name or balance, never replaces a rate the person typed, and
 * keeps a purchase price and date already entered. The kind is only taken while it is itself only suggested.
 */
export function applyTypeSuggestion(asset, type, opts = {}) {
    if (!asset || (asset.assetType && asset.typeSuggested !== true)) return false;
    const { fields, filled } = typeFill(type, opts);
    if (!filled.length && !fields.assetType) return false;
    const keepKind = !!asset.kind && asset.kindSuggested === false;
    if (keepKind && asset.kind !== fields.kind) return false; // the person's own kind wins: the type does not fit
    const done = [];
    const wasSuggested = asset.typeSuggested === true;
    for (const [k, v] of Object.entries(fields)) {
        if (k === 'kind' && keepKind) continue;
        if (k === 'depreciation') {
            if (!isDefaultDep(asset.depreciation) && !wasSuggested) continue;
            asset.depreciation = { ...v, purchasePrice: asset.depreciation ? asset.depreciation.purchasePrice : null, purchaseDate: asset.depreciation ? asset.depreciation.purchaseDate : null };
        } else if (['interestRate', 'expectedReturn', 'growthRate'].includes(k)) {
            if (typeof asset[k] === 'number' && !wasSuggested) continue;
            asset[k] = v;
        } else if ((k === 'use' || k === 'useSuggested') && asset.use && asset.useSuggested === false) {
            continue;
        } else asset[k] = v;
        if (filled.includes(k)) done.push(k);
    }
    if (!keepKind) asset.kindSuggested = true;
    asset.typeFilled = done;
    return true;
}

/** The person confirmed the type: its rate and curve now feed the maths (and no later update touches them). */
export function confirmType(asset) {
    if (!asset || !asset.assetType) return false;
    asset.typeSuggested = false;
    return true;
}
