// R4 (FT-0032 / R3 sections 6, 7, 9): the read-only browser client for the shared reference database.
// A lazy module: NOT in STARTUP_MODULES and imported by no startup module. Nothing consumes it yet and nothing calls
// it at startup. Nothing in the app waits on it; getReference() always has an answer (cache, then baseline, then
// in-code defaults).
//
// Requests are plain GETs of fixed relative URLs: no query string, no body, no user data, never a cookie.
// Cache Storage `ft-ref-v1` holds one state record plus file bodies keyed by their SHA-256, so a body shared by
// several data versions is stored once. The last two earlier data versions are kept for rollback.

import { DEFAULT_CATEGORIES } from './categories.js';
import {
    REFERENCE_KINDS, SUPPORTED_SCHEMA, compareVersions, validateManifest, validateReferenceFile, referenceList,
} from './reference-validate.js';

/* global __APP_VERSION__ */
export const REF_CACHE_NAME = 'ft-ref-v1';
export const REF_CHECKED_KEY = 'ft-ref-checked';
export const REF_ENABLED_KEY = 'ft-ref-enabled'; // '0' = the person turned the update check off (Settings, DB7)
export const REF_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_URL = '/__ft-ref__/state.json';
const bodyUrl = (sha) => '/__ft-ref__/f/' + sha;
const KEEP_PREVIOUS = 2;

// Test seam: every outside thing the client touches. Defaults are the real browser objects.
function resolveEnv(env = {}) {
    let base = './';
    try {
        const b = import.meta.env && import.meta.env.BASE_URL;
        if (typeof b === 'string' && b) base = b;
    } catch (_) { /* no import.meta.env outside Vite: keep the relative base */ }
    return {
        base: env.base || base,
        fetch: env.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
        caches: env.caches !== undefined ? env.caches : (typeof caches !== 'undefined' ? caches : null),
        storage: env.storage !== undefined ? env.storage : (typeof localStorage !== 'undefined' ? localStorage : null),
        now: env.now || (() => Date.now()),
        sha256: env.sha256 || sha256Hex,
        appVersion: env.appVersion !== undefined ? env.appVersion
            : (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''),
    };
}

export async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function storageGet(env, key) {
    try { return env.storage ? env.storage.getItem(key) : null; } catch (_) { return null; }
}
function storageSet(env, key, value) {
    try { if (env.storage) env.storage.setItem(key, String(value)); } catch (_) { /* private mode or full: the check just runs again */ }
}

const refUrl = (env, path) => env.base.replace(/\/?$/, '/') + 'ref/' + path;

// ---------- the stored state (Cache Storage) ----------
// { current: {dataVersion, files:{kind:{path,sha256,bytes,rev}}, at}, history:[same shape...], disabled:[kinds], skipVersion }

async function openStore(env) {
    if (!env.caches) return null;
    try { return await env.caches.open(REF_CACHE_NAME); } catch (_) { return null; }
}

async function readState(store) {
    if (!store) return null;
    try {
        const r = await store.match(STATE_URL);
        if (!r) return null;
        const s = JSON.parse(await r.text());
        return s && s.current && typeof s.current === 'object' ? s : null;
    } catch (_) { return null; }
}

async function writeState(store, state) {
    await store.put(STATE_URL, new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json' } }));
}

async function readBody(store, kind, entry) {
    try {
        const r = await store.match(bodyUrl(entry.sha256));
        if (!r) return null;
        const doc = JSON.parse(await r.text());
        return validateReferenceFile(kind, doc).ok ? doc : null;
    } catch (_) { return null; }
}

// Drop bodies no kept version points at.
async function pruneBodies(store, state) {
    const keep = new Set();
    for (const v of [state.current, ...state.history]) for (const f of Object.values(v.files)) keep.add(bodyUrl(f.sha256));
    try {
        for (const req of await store.keys()) {
            const u = typeof req === 'string' ? req : req.url;
            const path = u.slice(u.indexOf('/__ft-ref__/'));
            if (path.startsWith('/__ft-ref__/f/') && !keep.has(path)) await store.delete(path);
        }
    } catch (_) { /* pruning is housekeeping; a leftover body is harmless */ }
}

// ---------- the merged view ----------

const clone = (v) => JSON.parse(JSON.stringify(v));
const inCodeDefault = {
    categories: () => clone(DEFAULT_CATEGORIES),
    merchants: () => [],
    assetTypes: () => [],
    models: () => [],
    tax: () => null, // no tax file: the app's built-in tables stay in charge (FT-R-124)
};

async function baselineDoc(env, kind, baselineManifest) {
    const f = baselineManifest && baselineManifest.files && baselineManifest.files[kind];
    if (!f) return null;
    try {
        const res = await env.fetch(refUrl(env, 'baseline/' + f.path), { method: 'GET' });
        if (!res || !res.ok) return null;
        const doc = JSON.parse(await res.text());
        return validateReferenceFile(kind, doc).ok ? doc : null;
    } catch (_) { return null; }
}

async function loadBaselineManifest(env) {
    if (!env.fetch) return null;
    try {
        const res = await env.fetch(refUrl(env, 'baseline/manifest.json'), { method: 'GET' });
        if (!res || !res.ok) return null;
        const m = JSON.parse(await res.text());
        return validateManifest(m).ok && m.schema === SUPPORTED_SCHEMA ? m : null;
    } catch (_) { return null; }
}

// One kind: cache, then baseline. `ctx` carries the baseline manifest between kinds so it is fetched at most once.
async function loadKindDoc(env, store, state, kind, ctx) {
    const entry = state && state.current.files[kind];
    if (entry && !(state.disabled || []).includes(kind)) {
        const doc = await readBody(store, kind, entry);
        if (doc) return { doc, source: 'cache' };
    }
    if (!ctx.loaded) { ctx.manifest = await loadBaselineManifest(env); ctx.loaded = true; }
    const doc = await baselineDoc(env, kind, ctx.manifest);
    return doc ? { doc, source: 'baseline' } : { doc: null, source: 'default' };
}

/** One kind's validated file for code that needs only that kind (DB14: the tax tables). { doc, source, dataVersion } */
export async function getReferenceKind(kind, envIn) {
    const env = resolveEnv(envIn);
    const store = await openStore(env);
    const state = await readState(store);
    const ctx = {};
    const r = await loadKindDoc(env, store, state, kind, ctx);
    const dataVersion = r.source === 'cache' ? state.current.dataVersion : (ctx.manifest ? ctx.manifest.dataVersion : null);
    return { doc: r.doc, source: r.source, dataVersion };
}

// The merged view: { dataVersion, sources:{kind:'cache'|'baseline'|'default'}, revs:{kind}, categories, merchants, assetTypes, models, tax }.
// Load order per kind: cache, baseline, in-code defaults. A kind on the manifest's disabled list skips the cache.
// `tax` is the file's years object, or null when there is none (DB14).
export async function getReference(envIn) {
    const env = resolveEnv(envIn);
    const store = await openStore(env);
    const state = await readState(store);
    const out = { dataVersion: null, sources: {}, revs: {} };
    const ctx = {};
    for (const kind of REFERENCE_KINDS) {
        const { doc, source } = await loadKindDoc(env, store, state, kind, ctx);
        out.sources[kind] = source;
        out.revs[kind] = doc ? doc.rev : null;
        out[kind] = doc ? referenceList(kind, doc) : inCodeDefault[kind]();
    }
    if (Object.values(out.sources).includes('cache')) out.dataVersion = state.current.dataVersion;
    else if (ctx.manifest) out.dataVersion = ctx.manifest.dataVersion;
    return out;
}

// ---------- the update check ----------

// The versions the person rolled back from (skipVersions, plus the older single skipVersion field).
function pinnedVersions(state) {
    return [...(Array.isArray(state.skipVersions) ? state.skipVersions : []), ...(state.skipVersion ? [state.skipVersion] : [])];
}

/** The data version in the downloaded cache, or null (built-in). Reads local storage only: no request of any kind. */
export async function getStoredReferenceVersion(envIn) {
    const env = resolveEnv(envIn);
    const state = await readState(await openStore(env));
    return state && state.current && Object.keys(state.current.files || {}).length ? state.current.dataVersion : null;
}

/** Whether the person allows the update check (default on; only the stored value '0' turns it off). */
export function isReferenceCheckEnabled(envIn) {
    return storageGet(resolveEnv(envIn), REF_ENABLED_KEY) !== '0';
}

/** Turn the update check on or off for this device. */
export function setReferenceCheckEnabled(on, envIn) {
    const env = resolveEnv(envIn);
    // Returns true only when the value is really stored (blocked storage reads back as unset, which means on).
    try { env.storage.setItem(REF_ENABLED_KEY, on ? '1' : '0'); } catch (_) { return false; }
    return isReferenceCheckEnabled(envIn) === !!on;
}

let inFlight = null;

// options: { enabled: false } makes the check do nothing at all (the Settings toggle arrives in R9); { force: true }
// skips the 24 h limit; { env } is the test seam. Resolves to { status, ... } and never throws.
export function checkForReferenceUpdate(options = {}) {
    if (options.enabled === false || !isReferenceCheckEnabled(options.env)) return Promise.resolve({ status: 'off' });
    if (inFlight) return inFlight;
    inFlight = runCheck(options).catch((err) => ({ status: 'error', error: String(err && err.message || err) }))
        .finally(() => { inFlight = null; });
    return inFlight;
}

async function fetchVerified(env, kind, entry) {
    const res = await env.fetch(refUrl(env, entry.path), { method: 'GET' });
    if (!res || !res.ok) return { ok: false, error: `${kind}: HTTP ${res ? res.status : 'none'}` };
    // A declared length that disagrees is refused before the body is read. Skipped when the body is compressed, because
    // Content-Length then counts the encoded bytes, not the file's.
    const declared = res.headers && res.headers.get && res.headers.get('content-length');
    const encoded = res.headers && res.headers.get && res.headers.get('content-encoding');
    if (declared && !encoded && Number(declared) !== entry.bytes) return { ok: false, error: `${kind}: declared length ${declared} is not ${entry.bytes}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength !== entry.bytes) return { ok: false, error: `${kind}: size ${bytes.byteLength} is not ${entry.bytes}` };
    const sha = await env.sha256(bytes);
    if (sha !== entry.sha256) return { ok: false, error: `${kind}: hash mismatch` };
    let doc;
    try { doc = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { return { ok: false, error: `${kind}: not JSON` }; }
    const v = validateReferenceFile(kind, doc);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, bytes };
}

async function runCheck(options) {
    const env = resolveEnv(options.env);
    if (!env.fetch) return { status: 'unsupported' };
    const store = await openStore(env);
    if (!store) return { status: 'unsupported' };

    const last = Number(storageGet(env, REF_CHECKED_KEY));
    if (!options.force && Number.isFinite(last) && last > 0 && env.now() - last < REF_CHECK_INTERVAL_MS && env.now() >= last) {
        return { status: 'rate-limited' };
    }
    storageSet(env, REF_CHECKED_KEY, env.now()); // stamped on every attempt, so a failing server is not hammered

    let manifest;
    try {
        const res = await env.fetch(refUrl(env, 'manifest.json'), { method: 'GET' });
        if (!res || !res.ok) return { status: 'error', error: 'manifest: HTTP ' + (res ? res.status : 'none') };
        manifest = JSON.parse(await res.text());
    } catch (err) {
        return { status: 'error', error: 'manifest: ' + String(err && err.message || err) };
    }
    if (manifest && typeof manifest === 'object' && manifest.schema !== SUPPORTED_SCHEMA) return { status: 'unknown-schema' };
    const mv = validateManifest(manifest);
    if (!mv.ok) return { status: 'invalid-manifest', error: mv.error };
    if (compareVersions(env.appVersion, manifest.minApp) < 0) return { status: 'app-too-old' };

    const state = (await readState(store)) || { current: { dataVersion: null, files: {}, at: 0 }, history: [], disabled: [], skipVersion: null };
    const disabled = (manifest.disabled || []).filter((k) => REFERENCE_KINDS.includes(k));
    const disabledChanged = JSON.stringify(disabled) !== JSON.stringify(state.disabled || []);
    const pins = pinnedVersions(state);
    if (pins.includes(manifest.dataVersion)) {
        // The person rolled back from this version: do not re-install it. A release newer than every pin clears them.
        // The kill switch still applies while pinned.
        if (disabledChanged) await writeState(store, { ...state, disabled });
        return { status: 'unchanged', dataVersion: state.current.dataVersion };
    }

    const files = { ...state.current.files };
    const errors = [];
    const bodies = [];
    for (const kind of REFERENCE_KINDS) {
        const entry = manifest.files[kind];
        if (!entry || disabled.includes(kind)) continue;
        if (entry.minApp && compareVersions(env.appVersion, entry.minApp) < 0) continue;
        if (files[kind] && files[kind].path === entry.path && files[kind].sha256 === entry.sha256) continue;
        try {
            const r = await fetchVerified(env, kind, entry);
            if (!r.ok) { errors.push(r.error); continue; }
            bodies.push({ sha: entry.sha256, bytes: r.bytes });
            files[kind] = { path: entry.path, sha256: entry.sha256, bytes: entry.bytes, rev: entry.rev };
        } catch (err) {
            errors.push(`${kind}: ${String(err && err.message || err)}`);
        }
    }

    const changed = bodies.length > 0;
    if (!changed && !disabledChanged) {
        return errors.length ? { status: 'error', error: errors.join('; '), errors } : { status: 'unchanged', dataVersion: state.current.dataVersion };
    }
    // Swap: write the new bodies first, then the state record that points at them, so a crash never leaves a pointer to nothing.
    for (const b of bodies) await store.put(bodyUrl(b.sha), new Response(b.bytes, { headers: { 'content-type': 'application/json' } }));
    const next = { ...state, disabled };
    if (pins.length && pins.every((p) => compareVersions(manifest.dataVersion, p) > 0)) { next.skipVersion = null; next.skipVersions = []; }
    if (changed) {
        // A retry that completes the same release updates it in place; it does not add a second history entry.
        const sameRelease = state.current.dataVersion === manifest.dataVersion;
        next.history = state.current.dataVersion !== null && !sameRelease
            ? [state.current, ...state.history].slice(0, KEEP_PREVIOUS) : state.history;
        // A partial update (some file failed) still carries the release's own label, flagged so a rollback can tell.
        next.current = { dataVersion: manifest.dataVersion, files, at: env.now() };
        if (errors.length) next.current.partial = true;
    }
    await writeState(store, next);
    await pruneBodies(store, next);
    return { status: 'updated', dataVersion: next.current.dataVersion, errors };
}

// Idle scheduling. Not wired in at this step: nothing calls it. Returns a cancel function.
export function scheduleReferenceCheck(options = {}) {
    if (options.enabled === false || !isReferenceCheckEnabled(options.env)) return () => {};
    let done = false;
    const run = () => { if (!done) checkForReferenceUpdate(options); }; // checks the toggle again: it may be turned off while waiting
    if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(run, { timeout: 30000 });
        return () => { done = true; if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id); };
    }
    const id = setTimeout(run, 5000);
    return () => { done = true; clearTimeout(id); };
}

// Re-point to the previous good data version. The version rolled back from is pinned so the next check does not
// install it again; a newer release clears the pin. Resolves to { ok, dataVersion } or { ok: false }.
export async function rollbackReference(envIn) {
    const env = resolveEnv(envIn);
    const store = await openStore(env);
    const state = await readState(store);
    if (!state || !state.history.length) return { ok: false };
    const [previous, ...rest] = state.history;
    // Every version rolled back from stays pinned (a second rollback must not un-pin the first) until a newer release arrives.
    const skipVersions = [...new Set([state.current.dataVersion, ...pinnedVersions(state)])].filter(Boolean);
    const next = { ...state, current: previous, history: rest, skipVersion: state.current.dataVersion, skipVersions };
    await writeState(store, next);
    await pruneBodies(store, next);
    return { ok: true, dataVersion: previous.dataVersion };
}
