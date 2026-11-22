// Asset-type matching and content checks (FT-0032 DB8, R3 5.3). Run by `npm run ref:check`.
// The matcher is the same definition of a match as the merchants' `match: 'word'` in src/state/reference-match.js
// (`norm` + `hasWord`: lowercase letters and digits, single spaces, whole word or whole phrase). No regular expressions, no plurals
// guessed (list "utes" as well as "ute"). Longest phrase wins (most words, then most characters); a tie goes to the type that comes
// first in asset-types.json. A type's `exclude` phrase vetoes that type. R7 will wire the app's own matcher to this definition;
// until then suggestKind (assets-debts.js:216) stays the baseline and offline fallback.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestKind } from '../../src/calc/assets-debts.js';

export const APP_KINDS = ['cash', 'invested', 'appreciating', 'depreciating'];

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hasWord = (hay, p) => { const n = norm(p); return !!n && hay.includes(' ' + n + ' '); };

/** The asset type for a name, or null: { type, phrase }. `types` is asset-types.json's `types` array. */
export function matchAssetType(name, types) {
    const hay = ' ' + norm(name) + ' ';
    let best = null;
    for (const t of types) {
        if ((t.exclude || []).some((x) => hasWord(hay, x))) continue;
        for (const p of t.match || []) {
            if (!hasWord(hay, p)) continue;
            const n = norm(p);
            const score = [n.split(' ').length, n.length];
            if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { type: t, phrase: p, score };
        }
    }
    return best ? { type: best.type, phrase: best.phrase } : null;
}

/** The kind the app knows for a type: its own, or its legacyKind. null when neither is an app kind. */
export const appKindOf = (t) => (APP_KINDS.includes(t.kind) ? t.kind : APP_KINDS.includes(t.legacyKind) ? t.legacyKind : null);

const CURVE_FIELDS = ['pctOfPricePaid', 'pctOfNew'];

export function assetTypeErrors(s, testsDir) {
    const errors = [];
    const types = s.assetTypes && Array.isArray(s.assetTypes.types) ? s.assetTypes.types : [];
    const seen = new Map();
    for (const t of types) {
        const at = `asset-types.json: '${t.id}'`;
        if (t.kind !== 'setting' && !appKindOf(t)) errors.push(`${at}: kind '${t.kind}' is not one the app knows and there is no legacyKind`);
        if (t.kind === 'setting' && t.legacyKind !== null) errors.push(`${at}: a setting has legacyKind null`);
        if (t.suggested !== true) errors.push(`${at}: suggested must be true (FT-R-117, FT-R-126: content can only make a value suggested)`);
        if (!('reviewed' in t)) errors.push(`${at}: reviewed is missing (a date, or null)`);
        if (t.kind === 'setting' && (t.match || []).length) errors.push(`${at}: a setting is never matched by name`);
        for (const [list, label] of [[t.match, 'match'], [t.exclude, 'exclude']]) {
            for (const p of list || []) {
                if (p !== norm(p)) errors.push(`${at}: ${label} phrase '${p}' must be normalised (lowercase letters and digits, single spaces)`);
            }
        }
        for (const p of t.match || []) {
            if (seen.has(p)) errors.push(`${at}: match phrase '${p}' is also used by '${seen.get(p)}'`);
            seen.set(p, t.id);
            if ((t.exclude || []).includes(p)) errors.push(`${at}: '${p}' is both a match and an exclude phrase`);
        }
        if (t.kind === 'depreciating' || t.kind === 'stable') {
            const dep = t.defaults && t.defaults.depreciation;
            if (!t.defaults || !('depreciation' in t.defaults)) errors.push(`${at}: defaults.depreciation is required (an object, or null when there is no sourced rate)`);
            if (dep && (dep.method !== 'diminishing' || typeof dep.ratePct !== 'number' || dep.ratePct < 0)) errors.push(`${at}: defaults.depreciation needs method 'diminishing' and a numeric ratePct`);
            if (dep === null && t.curve) errors.push(`${at}: has a curve but defaults.depreciation is null`);
            if (t.curve) {
                const f = CURVE_FIELDS.find((k) => k in t.curve[0]);
                if (t.curve[0].year !== 0 || t.curve[0][f] !== 100) errors.push(`${at}: the curve must start at year 0 = 100`);
                for (let i = 1; i < t.curve.length; i++) {
                    if (!(t.curve[i].year > t.curve[i - 1].year)) errors.push(`${at}: curve years must increase`);
                    if (!(t.curve[i][f] <= t.curve[i - 1][f])) errors.push(`${at}: curve rises at year ${t.curve[i].year}`);
                }
            }
            if (!t.effectiveLife || t.effectiveLife.taxOnly !== true) errors.push(`${at}: effectiveLife must be tagged taxOnly (FT-R-114)`);
            if (!t.counts || t.counts.fi !== false) errors.push(`${at}: depreciating items do not count toward FI (FT-R-125)`);
        }
        if (t.powertrainFactor) {
            const pf = t.powertrainFactor;
            for (const k of ['hybrid', 'phev', 'ev']) if (!Array.isArray(pf[k]) || !pf[k].length || pf[k].some((x) => !(x.year > 0) || !(x.factor > 0))) errors.push(`${at}: powertrainFactor.${k} must be a list of {year, factor}`);
            if (pf.petrol !== 1 || pf.diesel !== 1) errors.push(`${at}: powertrainFactor petrol and diesel are the baseline (1)`);
        }
        if (t.kind === 'appreciating' && !(t.counts && t.counts.fi === 'useSwitch')) errors.push(`${at}: a property needs the live-in or investment switch (FT-R-125)`);
        if (t.isSuper && !(t.counts && t.counts.fiFromAge === 60)) errors.push(`${at}: super counts toward FI from 60 (FT-R-125)`);
    }
    const crypto = types.find((t) => t.id === 'crypto');
    if (crypto && (crypto.defaults.expectedReturn !== null || !crypto.counts || crypto.counts.rateMode !== 'noReliableRate')) errors.push("asset-types.json: 'crypto' must be held as no reliable rate (FT-R-125)");

    const file = join(testsDir, 'asset-fixtures.json');
    const lines = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).lines : [];
    for (const l of lines) {
        const hit = matchAssetType(l.name, types);
        const got = hit ? hit.type.id : null;
        if (got !== l.expect) errors.push(`tests/asset-fixtures.json: '${l.name}': matched ${got}${hit ? ` via '${hit.phrase}'` : ''}, expected ${l.expect}`);
        if (l.appAgrees && hit) {
            const app = suggestKind(l.name).kind;
            if (appKindOf(hit.type) !== app) errors.push(`tests/asset-fixtures.json: '${l.name}': type kind ${appKindOf(hit.type)} differs from the app's suggestKind (${app})`);
        }
    }
    return { errors, lines: lines.length };
}
