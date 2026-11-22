// The saving-model catalogue (FT-0032 DB15, R3 step R8). Lazy: only the model picker and the setup model step import it.
//
// Pure and DOM-free apart from `loadEnvelope`, which takes its fetch from the caller. No strings: the picker owns the wording
// (src/i18n/en-lazy-models.js). Everything here answers with codes.
//
//   catalogueFromIndex(models)    the picker's entries from the reference view (always holds the Bucket method, in code)
//   entryState(entry, data)       what the person can do with an entry: current | switch-back | stays | use | replaces | needs-newer
//   validateEnvelope(env)         the one gate for a model from anywhere (the catalogue, a file): shape, text-only, validateModelDef
//   parseModelFile(text)          a file from outside: size cap, JSON, then validateEnvelope. UNTRUSTED input (R3 5.4, G6)
//   useModel(data, env, opts)     "Use this": validate, copy into data.savingModel with basedOn and basedOnVersion; undoable
//   exportModel(data)             the same envelope as a file (names and percentages only, never an amount)
//
// The Bucket method is never fetched: it is BUCKET_METHOD in code (R3 5.4), so the picker works with no data at all.

import {
    BUCKET_METHOD, CUSTOM_RULES, ENGINES, validateModelDef, validateSplit, canReturnToBase,
} from '../calc/saving-model.js';
import { compareVersions } from './reference-validate.js';
import { newBucket, snapshot, done, failed } from './saving-model.js';

export const MODEL_SCHEMA = 1;
/** The newest `schemaVersion` of the envelope this app reads. A file with a higher one needs a newer Ledger. */
export const MODEL_SCHEMA_VERSION = 1;
/** An imported model is a few hundred bytes. Anything over this is refused before it is parsed. */
export const MODEL_FILE_MAX_BYTES = 32 * 1024;
/** The version of the in-code Bucket method, the baseline a user's copy compares an upstream version with. */
export const BUCKET_METHOD_VERSION = '1.0.0';
export const BUCKET_ID = BUCKET_METHOD.id;
/** The id the picker uses for "make this your own template" (a choice, never a catalogue id: ids cannot start with an underscore). */
export const OWN_CHOICE = '_own';

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ROLES = ['daily', 'splurge', 'smile', 'fire', 'mojo', 'grow'];
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 8;
const MAX_STRING = 1000;
const MAX_BUCKETS = 12;

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const slug = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ---------- the gate ----------

// Text that is markup or a script scheme. Ledger renders model text only through textContent, so this is a second lock:
// a file carrying it is refused, not cleaned.
const HOSTILE_TEXT = /[<>]|javascript\s*:|data\s*:\s*text\/html|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/i;

// Walks any value once: depth cap, string cap, no prototype keys, no markup or script text, finite numbers only.
function hostile(v, depth = 0) {
    if (depth > MAX_DEPTH) return 'depth';
    if (typeof v === 'string') return v.length > MAX_STRING ? 'string-length' : HOSTILE_TEXT.test(v) ? 'script-text' : null;
    if (typeof v === 'number') return Number.isFinite(v) ? null : 'number';
    if (v === null || typeof v === 'boolean') return null;
    if (Array.isArray(v)) {
        if (v.length > 200) return 'array-length';
        for (const x of v) { const e = hostile(x, depth + 1); if (e) return e; }
        return null;
    }
    if (isObj(v)) {
        for (const k of Object.keys(v)) {
            if (BAD_KEYS.has(k) || HOSTILE_TEXT.test(k) || k.length > 64) return 'key';
            const e = hostile(v[k], depth + 1); if (e) return e;
        }
        return null;
    }
    return 'type'; // a function, undefined, a symbol or a bigint cannot come out of JSON
}

const only = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const text = (v, max = MAX_STRING) => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Is this a saving model Ledger can use? Returns {ok:true} or {ok:false, code, detail?}.
 * Codes: not-object, hostile (detail says what), field (detail names it), needs-newer (an engine or a format this app does not know),
 * id-mismatch, model (validateModelDef said no; detail is its error list). The model itself is run through
 * validateModelDef unchanged.
 */
export function validateEnvelope(env) {
    if (!isObj(env)) return { ok: false, code: 'not-object' };
    const h = hostile(env);
    if (h) return { ok: false, code: 'hostile', detail: h };
    const bad = (detail) => ({ ok: false, code: 'field', detail });
    if (!only(env, ['schema', 'schemaVersion', 'id', 'version', 'meta', 'model'])) return bad('envelope');
    if (!Number.isInteger(env.schema)) return bad('schema');
    if (env.schema !== MODEL_SCHEMA) return { ok: false, code: 'needs-newer', detail: 'schema' };
    if (env.schemaVersion !== undefined && !(Number.isInteger(env.schemaVersion) && env.schemaVersion >= 1)) return bad('schemaVersion');
    if ((env.schemaVersion || 1) > MODEL_SCHEMA_VERSION) return { ok: false, code: 'needs-newer', detail: 'schemaVersion' };
    if (!text(env.id, 64) || !ID_RE.test(env.id)) return bad('id');
    if (typeof env.version !== 'string' || !SEMVER_RE.test(env.version)) return bad('version');
    const meta = env.meta;
    if (!isObj(meta)) return bad('meta');
    if (!only(meta, ['title', 'blurb', 'after', 'source', 'sourceKind', 'retrieved', 'licence', 'reviewed', 'status', 'checks', 'requires'])) return bad('meta');
    for (const k of ['title', 'blurb', 'source']) if (!text(meta[k])) return bad(`meta.${k}`);
    if (!text(meta.licence, 100)) return bad('meta.licence');
    if (meta.after !== undefined && typeof meta.after !== 'string') return bad('meta.after');
    if (meta.reviewed !== null && !(typeof meta.reviewed === 'string' && DATE_RE.test(meta.reviewed))) return bad('meta.reviewed');
    if (meta.retrieved !== undefined && !(typeof meta.retrieved === 'string' && DATE_RE.test(meta.retrieved))) return bad('meta.retrieved');
    if (!isObj(meta.requires) || !text(meta.requires.engine, 64)) return bad('meta.requires');
    const def = env.model;
    if (!isObj(def)) return bad('model');
    if (!only(def, ['id', 'name', 'after', 'basis', 'engine', 'guide', 'buckets', 'virtual', 'rules'])) return bad('model');
    if (Array.isArray(def.buckets)) {
        if (def.buckets.length > MAX_BUCKETS) return bad('buckets');
        for (const b of def.buckets) {
            if (!isObj(b) || !only(b, ['role', 'name', 'slot', 'kind', 'pct', 'target', 'fundedBy'])) return bad('bucket');
            if (b.name !== undefined && (typeof b.name !== 'string' || b.name.length > 200)) return bad('bucket-name');
        }
    }
    // An engine this Ledger does not run is "Needs a newer Ledger", not a broken file.
    if (!ENGINES.includes(meta.requires.engine) || !ENGINES.includes(def.engine)) return { ok: false, code: 'needs-newer', detail: 'engine' };
    if (meta.requires.engine !== def.engine) return bad('engine-differs');
    if (def.id !== env.id) return { ok: false, code: 'id-mismatch' };
    const m = validateModelDef(def);
    if (!m.ok) return { ok: false, code: 'model', detail: m.errors };
    return { ok: true };
}

/** A file from outside. `text` is the file's text. Never throws. {ok:true, envelope} or {ok:false, code}. Codes add too-big and not-json. */
export function parseModelFile(fileText) {
    if (typeof fileText !== 'string') return { ok: false, code: 'not-json' };
    // A character is at most three bytes in UTF-8: refuse by length first so a huge file is never encoded or parsed.
    if (fileText.length > MODEL_FILE_MAX_BYTES) return { ok: false, code: 'too-big' };
    const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(fileText).length : fileText.length;
    if (bytes > MODEL_FILE_MAX_BYTES) return { ok: false, code: 'too-big' };
    let env;
    try { env = JSON.parse(fileText.replace(/^﻿/, '')); } catch (_) { return { ok: false, code: 'not-json' }; }
    const v = validateEnvelope(env);
    return v.ok ? { ok: true, envelope: env } : v;
}

// ---------- the in-code entry ----------

/** The Bucket method as an envelope, built from BUCKET_METHOD (the same shape reference/src/models/bucket-method.json is generated in). */
export function builtinEnvelope() {
    const def = clone(BUCKET_METHOD);
    return {
        schema: MODEL_SCHEMA, schemaVersion: MODEL_SCHEMA_VERSION, id: BUCKET_ID, version: BUCKET_METHOD_VERSION,
        meta: { title: def.name, blurb: def.name, after: def.after, source: 'built in', licence: 'app-default', reviewed: null, requires: { engine: def.engine } },
        model: def,
    };
}

// ---------- the entries ----------

/**
 * The picker's entries. `models` is the reference view's `models` list (the catalogue index) or nothing. The Bucket method is
 * always first and always the in-code definition, whatever the index says: with no data the list is just that one entry.
 * Entry: {id, name, blurb, version, engine, path, sha256, bytes, builtin}.
 */
export function catalogueFromIndex(models) {
    const bucket = {
        id: BUCKET_ID, name: BUCKET_METHOD.name, blurb: '', version: BUCKET_METHOD_VERSION, engine: BUCKET_METHOD.engine,
        path: null, sha256: null, bytes: 0, builtin: true,
    };
    const out = [bucket];
    const seen = new Set([BUCKET_ID]);
    for (const m of Array.isArray(models) ? models : []) {
        if (!isObj(m) || typeof m.id !== 'string' || !ID_RE.test(m.id) || m.id.length > 64) continue;
        if (m.id === BUCKET_ID) { if (text(m.blurb, 500) && !HOSTILE_TEXT.test(m.blurb)) bucket.blurb = m.blurb; continue; }
        if (seen.has(m.id)) continue;
        if (!text(m.name, 200) || HOSTILE_TEXT.test(m.name) || !text(m.engine, 64)) continue;
        if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) continue;
        if (typeof m.path !== 'string' || typeof m.sha256 !== 'string') continue;
        seen.add(m.id);
        out.push({
            id: m.id, name: m.name, blurb: text(m.blurb, 500) && !HOSTILE_TEXT.test(m.blurb) ? m.blurb : '', version: m.version, engine: m.engine,
            path: m.path, sha256: m.sha256, bytes: Number.isInteger(m.bytes) ? m.bytes : 0, builtin: false,
        });
    }
    return [out[0], ...out.slice(1).sort((a, b) => a.name.localeCompare(b.name))];
}

/** Read the catalogue through getReference() (cache, then baseline, then in-code defaults). Never throws; failing gives the Bucket method alone. */
export async function loadCatalogue(opts = {}) {
    try {
        const ref = await (opts.loadRef ? opts.loadRef() : import('./reference.js').then((m) => m.getReference()));
        return catalogueFromIndex(ref && ref.models);
    } catch (_) {
        return catalogueFromIndex([]);
    }
}

const isCustom = (sm) => !!(sm && typeof sm.id === 'string' && sm.id.startsWith('custom-'));

/** True when taking a model that rebuilds the buckets would lose something the person typed: a balance, a goal or a target amount. */
export function wouldLoseBuckets(data) {
    const rows = data && Array.isArray(data.allocation) ? data.allocation.filter(isObj) : [];
    if (rows.some((r) => num(r.currentBalance) !== 0 || num(r.savingsGoal) !== 0)) return true;
    return !!(data && Array.isArray(data.bucketGoals) && data.bucketGoals.length);
}

/**
 * What a person can do with an entry, given their data:
 *   needs-newer  the entry's engine is not one this Ledger runs: shown, never chosen
 *   current      this is the model in use
 *   switch-back  an own template that again fits the Bucket method (canReturnToBase)
 *   stays        an own template that does not fit yet: shown, not chosen
 *   use          choosable
 *   replaces     taking it would replace buckets that hold balances or goals: not offered here
 */
export function entryState(entry, data) {
    if (!entry || !ENGINES.includes(entry.engine)) return 'needs-newer';
    const sm = data && data.savingModel;
    if (entry.id === BUCKET_ID) {
        if (!sm) return 'use';
        if (!isCustom(sm)) return sm.id === BUCKET_ID ? 'current' : 'replaces';
        if (sm.basedOn !== BUCKET_ID) return 'replaces';
        return canReturnToBase(sm, data.allocation, data.bucketGoals) ? 'switch-back' : 'stays';
    }
    if (sm && sm.basedOn === entry.id) return 'current';
    if (entry.engine !== 'fixed') return 'replaces';
    return wouldLoseBuckets(data) ? 'replaces' : 'use';
}

/** Does the catalogue hold a newer version of the model this copy was taken from? Never swaps anything in. */
export function updateAvailable(data, entry) {
    const sm = data && data.savingModel;
    if (!sm || !entry || entry.id === BUCKET_ID) return false; // the Bucket method is the code itself
    return sm.basedOn === entry.id && typeof sm.basedOnVersion === 'string' && compareVersions(entry.version, sm.basedOnVersion) > 0;
}

// ---------- fetching a model's file ----------

/**
 * The full envelope for an entry. The Bucket method comes from code. Any other is fetched (the pinned baseline first, then the
 * release), checked against the index's length and SHA-256, then run through the same gate as a file. `env` is the seam:
 * { fetch, base, sha256 }. Resolves to {ok:true, envelope} or {ok:false, code}. Never throws.
 */
export async function loadEnvelope(entry, env = {}) {
    if (!entry) return { ok: false, code: 'missing' };
    if (entry.id === BUCKET_ID) return { ok: true, envelope: builtinEnvelope() };
    try {
        const doFetch = env.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        if (!doFetch || typeof entry.path !== 'string' || !/^models\/[a-z0-9][a-z0-9_-]*\.[0-9a-f]{8}\.json$/.test(entry.path)) return { ok: false, code: 'unavailable' };
        let base = env.base;
        if (base == null) { try { base = import.meta.env && import.meta.env.BASE_URL; } catch (_) { base = null; } }
        base = (typeof base === 'string' && base ? base : './').replace(/\/?$/, '/');
        const sha256 = env.sha256 || (await import('./reference.js')).sha256Hex;
        for (const url of [`${base}ref/baseline/${entry.path}`, `${base}ref/${entry.path}`]) {
            let res;
            try { res = await doFetch(url, { method: 'GET' }); } catch (_) { continue; }
            if (!res || !res.ok) continue;
            const buf = new Uint8Array(await res.arrayBuffer());
            if (buf.byteLength > MODEL_FILE_MAX_BYTES) return { ok: false, code: 'too-big' };
            if ((entry.bytes && buf.byteLength !== entry.bytes) || (await sha256(buf)) !== entry.sha256) continue;
            const parsed = parseModelFile(new TextDecoder().decode(buf));
            if (!parsed.ok) return parsed;
            if (parsed.envelope.id !== entry.id) return { ok: false, code: 'id-mismatch' };
            return parsed;
        }
        return { ok: false, code: 'unavailable' };
    } catch (_) {
        return { ok: false, code: 'unavailable' };
    }
}

// ---------- "Use this" ----------

/** Rows for a fixed model: names, shares and kinds from the file; every balance and goal at zero. */
export function modelRows(def) {
    const rows = [];
    def.buckets.forEach((b) => {
        const row = newBucket(rows, { name: b.name, percentage: b.pct, kind: b.kind });
        row.slot = b.slot;
        row.role = b.role && !rows.some((r) => r.role === b.role) ? b.role : null;
        if (row.role === 'mojo') { row.id = 'mojo'; row.autoCreated = false; }
        rows.push(row);
    });
    return rows;
}

/**
 * "Use this": validate the envelope, then copy it into data.savingModel with `basedOn` and `basedOnVersion`. After that the
 * catalogue can change without touching the person's model; a newer upstream version only ever shows as a line in the picker.
 * Writes nothing unless it returns ok; the result carries onUndo like the other E5 calls.
 *   Bucket method          from a custom template that fits, this is "Switch back" (canReturnToBase). Already on it: code 'current'.
 *   fixed models           the buckets become the model's buckets. That would drop balances and goals, so it needs
 *                          opts.replaceBuckets === true when there are any (code 'would-replace' otherwise).
 */
export function useModel(data, envelope, opts = {}) {
    if (!data || typeof data !== 'object' || !isObj(data.savingModel)) return failed('no-model');
    const v = validateEnvelope(envelope);
    if (!v.ok) return failed(v.code, { detail: v.detail });
    const def = envelope.model;
    const sm = data.savingModel;
    if (def.id === BUCKET_ID) {
        if (!isCustom(sm)) return failed(sm.id === BUCKET_ID ? 'current' : 'would-replace');
        if (sm.basedOn !== BUCKET_ID || !canReturnToBase(sm, data.allocation, data.bucketGoals)) return failed('bounds');
        const before = snapshot(data, ['savingModel']);
        Object.assign(sm, { id: BUCKET_ID, name: BUCKET_METHOD.name, after: BUCKET_METHOD.after, basedOn: null, rules: clone(BUCKET_METHOD.rules) });
        delete sm.basedOnVersion;
        return done(data, before, '', { used: BUCKET_ID });
    }
    if (def.engine !== 'fixed') return failed('would-replace');
    if (wouldLoseBuckets(data) && opts.replaceBuckets !== true) return failed('would-replace');
    const rows = modelRows(def);
    const split = validateSplit(rows.map((r) => ({ id: r.id, role: r.role, pct: r.percentage })), { ...CUSTOM_RULES, ...def.rules });
    if (!split.ok) return failed('split', { total: split.total });
    const before = snapshot(data, ['allocation', 'bucketGoals', 'savingModel']);
    if (!Array.isArray(data.allocation)) data.allocation = [];
    data.allocation.length = 0;
    data.allocation.push(...rows);
    if (Array.isArray(data.bucketGoals)) data.bucketGoals.length = 0;
    Object.assign(sm, {
        id: 'custom-1', name: def.name, after: typeof def.after === 'string' && def.after ? def.after : (envelope.meta.after || null),
        basedOn: envelope.id, basedOnVersion: envelope.version, basis: def.basis,
        rules: { ...clone(CUSTOM_RULES), ...clone(def.rules), topLevelAddAllowed: true },
        transfers: { ...(isObj(sm.transfers) ? sm.transfers : {}), bankSetTo: {} },
    });
    return done(data, before, '', { used: envelope.id, total: split.total });
}

// ---------- export ----------

/**
 * The person's own setup as a model file: bucket names, kinds, slots, roles and percentages. Never a balance, a goal, an
 * amount or anything else they typed. {ok:true, envelope, text} or {ok:false, code} ('no-model', 'split' when the shares do not
 * total 100, or whatever validateEnvelope says). The result is a valid reference model, so the same file imports back.
 */
export function exportModel(data) {
    const sm = data && data.savingModel;
    const rows = data && Array.isArray(data.allocation) ? data.allocation.filter((r) => isObj(r) && typeof r.name === 'string' && r.name) : [];
    if (!isObj(sm) || !rows.length) return { ok: false, code: 'no-model' };
    const name = text(sm.name, 200) ? sm.name : BUCKET_METHOD.name;
    const id = `own-${slug(name) || 'model'}`;
    const roles = new Set();
    const buckets = rows.slice(0, MAX_BUCKETS).map((r, i) => {
        const b = { name: r.name.slice(0, 200), slot: Number.isInteger(r.slot) && r.slot >= 1 && r.slot <= 10 ? r.slot : Math.min(10, i + 1), kind: r.kind === 'spend' ? 'spend' : 'save', pct: Math.max(0, Math.round(num(r.percentage) * 10) / 10) };
        if (ROLES.includes(r.role) && !roles.has(r.role)) { roles.add(r.role); b.role = r.role; }
        return b;
    });
    const total = Math.round(buckets.reduce((a, b) => a + b.pct, 0) * 1000) / 1000;
    if (Math.abs(total - 100) > 0.05) return { ok: false, code: 'split', total };
    const rules = isObj(sm.rules) ? clone(sm.rules) : clone(CUSTOM_RULES);
    const envelope = {
        schema: MODEL_SCHEMA, schemaVersion: MODEL_SCHEMA_VERSION, id, version: '1.0.0',
        meta: {
            title: name, blurb: 'A saving model exported from Ledger.', source: 'exported from Ledger', licence: 'user-exported', reviewed: null,
            requires: { engine: 'fixed' },
            ...(typeof sm.after === 'string' && sm.after ? { after: sm.after.slice(0, 500) } : {}),
        },
        model: { id, name, basis: 'net', engine: 'fixed', buckets, rules },
    };
    const v = validateEnvelope(envelope);
    if (!v.ok) return { ok: false, code: v.code, detail: v.detail };
    return { ok: true, envelope, text: JSON.stringify(envelope, null, 2) + '\n' };
}
