// The asset types the asset sheet offers (FT-0032 DB12, R3 step R7). Lazy: only the Plan and Future chunks import it.
//
// `loadAssetTypes(overrides)` reads the shared reference database (cache, then the pinned baseline, then nothing), applies the
// person's own hides and patches (ref-overrides.js) and returns the types the sheet can use: the ones that map to an app kind.
// It never throws and never waits on the network: with no types the sheet falls back to `suggestKind`.
// `loadRef` is the test seam; the default reads `getReference()` from reference.js.

import { appKindOf } from '../calc/asset-types.js';

/** The types a person can pick: has an id and a name and maps to one of the four app kinds (a "setting" does not). */
export function pickableTypes(types) {
    return (Array.isArray(types) ? types : []).filter((x) => x && typeof x.id === 'string' && x.id && typeof x.name === 'string' && appKindOf(x));
}

export async function loadAssetTypes(overrides, loadRef) {
    try {
        const ref = await (loadRef ? loadRef() : import('./reference.js').then((m) => m.getReference()));
        const { applyRefOverrides } = await import('./ref-overrides.js');
        const view = applyRefOverrides(ref, overrides);
        return pickableTypes(view && view.assetTypes);
    } catch (err) {
        console.warn('asset types could not be loaded; the kind is guessed from the name instead', err);
        return [];
    }
}

let cached = null; // { key, list }: the sheet reopens on every type or kind change, so the list is read once per overrides state

/** `loadAssetTypes`, remembered for the page's life (until the person's overrides change). */
export async function assetTypesFor(data) {
    const overrides = data && data.refOverrides;
    const key = JSON.stringify(overrides || null);
    if (cached && cached.key === key && cached.list.length) return cached.list;
    const list = await loadAssetTypes(overrides);
    cached = { key, list };
    return list;
}
