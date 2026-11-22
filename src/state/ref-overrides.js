// Reference overrides (FT-0032 DB7, R3 step R6, FT-R-117). The person's own hide and patch of shared reference items,
// kept in data.refOverrides (see ref-overrides-migration.js for the shape). Reference data is read-only and global; this
// layer is applied on top of a getReference() view and never writes into it. Lazy module: not in the core chunk.
//
// Keys are '<kind>:<id>' with kind one of merchant, category, assetType, model. A patch is applied by id, so it survives
// an upstream rev bump; upstreamMoved() lists the patched items whose file has a newer rev than the one the patch was made on.

const KIND_LIST = { merchant: 'merchants', category: 'categories', assetType: 'assetTypes', model: 'models' };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype', 'id']);

function parseKey(key) {
    const i = String(key).indexOf(':');
    if (i <= 0) return null;
    const kind = key.slice(0, i);
    return Object.hasOwn(KIND_LIST, kind) ? { kind, list: KIND_LIST[kind], id: key.slice(i + 1) } : null;
}

// What a person may patch, with type checks (R3 section 8). A restored backup is untrusted: anything else is dropped, so a
// junk patch can never reach the matcher. Merchants: categoryId and confidence. Asset types: the depreciation rate only.
// Categories and models are not patchable (hide only). Returns the clean patch, or null when nothing usable is left.
export function cleanPatch(list, patch) {
    if (!isObj(patch)) return null;
    const out = {};
    if (list === 'merchants') {
        if (typeof patch.categoryId === 'string' && patch.categoryId && patch.categoryId.length <= 64) out.categoryId = patch.categoryId;
        if (['high', 'medium', 'low'].includes(patch.confidence)) out.confidence = patch.confidence;
    } else if (list === 'assetTypes') {
        const r = isObj(patch.defaults) && isObj(patch.defaults.depreciation) ? patch.defaults.depreciation.ratePct : undefined;
        if (typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 100) out.defaults = { depreciation: { ratePct: r } };
    }
    return Object.keys(out).length ? out : null;
}

function mergePatch(base, patch) {
    const out = { ...base };
    for (const k of Object.keys(patch)) {
        if (FORBIDDEN.has(k)) continue;
        out[k] = isObj(patch[k]) && isObj(out[k]) ? mergePatch(out[k], patch[k]) : patch[k];
    }
    return out;
}

/** The usable entries of an overrides object: [{key, kind, list, id, op, patch, baseRev}]. Junk is skipped. */
export function overrideEntries(overrides) {
    const items = overrides && isObj(overrides.items) ? overrides.items : {};
    const out = [];
    for (const key of Object.keys(items)) {
        const p = parseKey(key);
        const it = items[key];
        if (!p || !isObj(it)) continue;
        if (it.op === 'hide') out.push({ key, ...p, op: 'hide', baseRev: it.baseRev });
        else if (it.op === 'patch' && cleanPatch(p.list, it.patch)) out.push({ key, ...p, op: 'patch', patch: cleanPatch(p.list, it.patch), baseRev: it.baseRev });
    }
    return out;
}

/** The reference view with the person's hides and patches applied. With no overrides it returns `ref` itself. */
export function applyRefOverrides(ref, overrides) {
    if (!ref) return ref;
    const entries = overrideEntries(overrides);
    if (!entries.length) return ref;
    const out = { ...ref };
    for (const list of new Set(entries.map((e) => e.list))) {
        const mine = entries.filter((e) => e.list === list);
        out[list] = (ref[list] || []).filter((row) => !(row && mine.some((e) => e.op === 'hide' && e.id === row.id)))
            .map((row) => {
                const e = row && mine.find((x) => x.op === 'patch' && x.id === row.id);
                return e ? mergePatch(row, e.patch) : row;
            });
    }
    return out;
}

/** Patched items whose reference file has moved on since the patch was made: [{key, kind, id}] ("updated upstream, yours kept"). */
export function upstreamMoved(ref, overrides) {
    return overrideEntries(overrides).filter((e) => {
        const rev = ref && ref.revs ? ref.revs[e.list] : null;
        return e.op === 'patch' && typeof rev === 'number' && typeof e.baseRev === 'number' && rev > e.baseRev;
    }).map((e) => ({ key: e.key, kind: e.kind, id: e.id }));
}

function ensure(data) {
    if (!isObj(data.refOverrides) || !isObj(data.refOverrides.items)) data.refOverrides = { v: 1, dataVersionSeen: null, items: {} };
    return data.refOverrides;
}

function put(data, ref, key, entry) {
    const p = parseKey(key);
    if (!p) return { ok: false };
    const o = ensure(data);
    const prev = Object.prototype.hasOwnProperty.call(o.items, key) ? o.items[key] : undefined;
    const prevSeen = o.dataVersionSeen;
    const rev = ref && ref.revs && typeof ref.revs[p.list] === 'number' ? ref.revs[p.list] : null;
    o.items[key] = { ...entry, baseRev: rev, at: new Date().toISOString().slice(0, 10) };
    if (ref && ref.dataVersion) o.dataVersionSeen = ref.dataVersion;
    return { ok: true, onUndo() { if (prev === undefined) delete o.items[key]; else o.items[key] = prev; o.dataVersionSeen = prevSeen; } };
}

/** Hide one reference item for this person. Returns {ok, onUndo}. */
export function hideRefItem(data, ref, key) { return put(data, ref, key, { op: 'hide' }); }

/** Patch one reference item (for example {categoryId}) for this person. Returns {ok, onUndo}. */
export function patchRefItem(data, ref, key, patch) {
    const p = parseKey(key);
    const clean = p && cleanPatch(p.list, patch);
    return clean ? put(data, ref, key, { op: 'patch', patch: clean }) : { ok: false };
}

/** Put one item back to what the reference says. */
export function clearRefItem(data, key) {
    const o = ensure(data);
    const prev = o.items[key];
    if (prev === undefined) return { ok: false };
    delete o.items[key];
    return { ok: true, onUndo() { o.items[key] = prev; } };
}

/** "Use reference rules only": clears every override. Returns {ok, count, onUndo}. */
export function resetRefOverrides(data) {
    const o = ensure(data);
    const items = o.items;
    const seen = o.dataVersionSeen;
    const count = Object.keys(items).length;
    o.items = {};
    return { ok: true, count, onUndo() { o.items = items; o.dataVersionSeen = seen; } };
}
