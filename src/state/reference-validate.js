// R4 (FT-0032): a small structural validator for the shared reference database. Pure: no DOM, no imports, no
// dependencies, so the browser client (reference.js) and CI can both run it. It checks shape and sizes, not content
// quality (sources and review dates are CI's job). Every function returns { ok: true } or { ok: false, error: '...' }.

export const SUPPORTED_SCHEMA = 1;
export const REFERENCE_KINDS = ['categories', 'merchants', 'assetTypes', 'models'];

// The array key inside each kind's file, and a ceiling on how many entries it may hold.
const KIND_SHAPE = {
    categories: { key: 'categories', max: 200 },
    merchants: { key: 'merchants', max: 20000 },
    assetTypes: { key: 'types', max: 200 },
    models: { key: 'models', max: 200 },
};

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
// Ceilings on the text fields. Each is at least DB1's schema limit (reference/schemas), so anything CI accepts the
// client accepts too.
export const REF_LIMITS = { id: 80, name: 1000, keyword: 200, key: 200, alias: 200, kind: 64, engine: 64, text: 1000 };
const MAX_DEPTH = 8;
const MAX_STRING = 2000;
const HEX64 = /^[0-9a-f]{64}$/;
const VERSION = /^\d{1,4}(\.\d{1,6}){0,2}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const bad = (error) => ({ ok: false, error });
const OK = { ok: true };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v) && v >= 0;
const isStr = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;

// Walks any value once: depth cap, string-length cap, no prototype-pollution keys.
function guardTree(v, depth = 0) {
    if (depth > MAX_DEPTH) return 'nested too deep';
    if (typeof v === 'string') return v.length > MAX_STRING ? 'a string is too long' : null;
    if (Array.isArray(v)) {
        for (const x of v) { const e = guardTree(x, depth + 1); if (e) return e; }
        return null;
    }
    if (isObj(v)) {
        for (const k of Object.keys(v)) {
            if (BAD_KEYS.has(k)) return 'forbidden key ' + k;
            const e = guardTree(v[k], depth + 1); if (e) return e;
        }
    }
    return null;
}

// "1.2.3" style compare; missing parts are 0. Returns -1, 0 or 1; an unparseable side compares as lowest.
export function compareVersions(a, b) {
    const parse = (s) => (VERSION.test(String(s)) ? String(s).split('.').map(Number) : null);
    const pa = parse(a); const pb = parse(b);
    if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d < 0 ? -1 : 1;
    }
    return 0;
}

// A manifest path must be a plain relative file path: no scheme, no leading slash, no dot segments, no query or fragment.
export function isSafeRefPath(p) {
    if (!isStr(p, 200)) return false;
    if (p.startsWith('/') || /(^|\/)\.\.?(\/|$)/.test(p)) return false;
    return /^[A-Za-z0-9._\-/]+$/.test(p);
}

export function validateManifest(m) {
    if (!isObj(m)) return bad('manifest is not an object');
    const g = guardTree(m); if (g) return bad('manifest: ' + g);
    if (!Number.isInteger(m.schema)) return bad('manifest.schema must be an integer');
    if (!isStr(m.dataVersion, 40)) return bad('manifest.dataVersion must be a string');
    if (typeof m.minApp !== 'string' || !VERSION.test(m.minApp)) return bad('manifest.minApp must be a version like 2.0.0');
    if (!isObj(m.files)) return bad('manifest.files must be an object');
    for (const [kind, f] of Object.entries(m.files)) {
        if (!isObj(f)) return bad(`manifest.files.${kind} must be an object`);
        if (!isSafeRefPath(f.path)) return bad(`manifest.files.${kind}.path is not a plain relative path`);
        if (typeof f.sha256 !== 'string' || !HEX64.test(f.sha256)) return bad(`manifest.files.${kind}.sha256 must be 64 hex characters`);
        if (!Number.isInteger(f.bytes) || f.bytes < 1 || f.bytes > MAX_FILE_BYTES) return bad(`manifest.files.${kind}.bytes is out of range`);
        if (!isInt(f.rev)) return bad(`manifest.files.${kind}.rev must be a whole number`);
        if (f.minApp !== undefined && !(typeof f.minApp === 'string' && VERSION.test(f.minApp))) return bad(`manifest.files.${kind}.minApp must be a version`);
    }
    if (m.disabled !== undefined && !(Array.isArray(m.disabled) && m.disabled.every((k) => typeof k === 'string'))) return bad('manifest.disabled must be a list of names');
    return OK;
}

const entryChecks = {
    categories(e, at) {
        if (!isStr(e.id, REF_LIMITS.id)) return bad(`${at}.id must be a non-empty string`);
        if (!isStr(e.name, REF_LIMITS.name)) return bad(`${at}.name must be a non-empty string`);
        if (!Array.isArray(e.keywords) || !e.keywords.every((k) => isStr(k, REF_LIMITS.keyword))) return bad(`${at}.keywords must be a list of strings`);
        if (e.essential !== undefined && typeof e.essential !== 'boolean') return bad(`${at}.essential must be true or false`);
        return OK;
    },
    merchants(e, at) {
        if (!isStr(e.id, REF_LIMITS.id)) return bad(`${at}.id must be a non-empty string`);
        if (!isStr(e.key, REF_LIMITS.key)) return bad(`${at}.key must be a non-empty string`);
        if (!isStr(e.categoryId, REF_LIMITS.id)) return bad(`${at}.categoryId must be a non-empty string`);
        if (!['key', 'keyword', 'word'].includes(e.match)) return bad(`${at}.match must be key, keyword or word`);
        if (!['high', 'medium', 'low'].includes(e.confidence)) return bad(`${at}.confidence must be high, medium or low`);
        if (e.aliases !== undefined && !(Array.isArray(e.aliases) && e.aliases.every((k) => isStr(k, REF_LIMITS.alias)))) return bad(`${at}.aliases must be a list of strings`);
        return OK;
    },
    assetTypes(e, at) {
        if (!isStr(e.id, REF_LIMITS.id)) return bad(`${at}.id must be a non-empty string`);
        if (!isStr(e.name, REF_LIMITS.name) && !isStr(e.label, REF_LIMITS.name)) return bad(`${at}.name or ${at}.label must be a non-empty string`);
        if (!isStr(e.kind, REF_LIMITS.kind)) return bad(`${at}.kind must be a non-empty string`);
        if (e.match !== undefined && !(Array.isArray(e.match) && e.match.every((k) => isStr(k, REF_LIMITS.keyword)))) return bad(`${at}.match must be a list of strings`);
        if (e.defaults !== undefined && !isObj(e.defaults)) return bad(`${at}.defaults must be an object`);
        return OK;
    },
    models(e, at) {
        if (!isStr(e.id, REF_LIMITS.id)) return bad(`${at}.id must be a non-empty string`);
        if (!isStr(e.name, REF_LIMITS.name)) return bad(`${at}.name must be a non-empty string`);
        if (!isStr(e.engine, REF_LIMITS.engine)) return bad(`${at}.engine must be a non-empty string`);
        if (!isSafeRefPath(e.path)) return bad(`${at}.path is not a plain relative path`);
        if (typeof e.sha256 !== 'string' || !HEX64.test(e.sha256)) return bad(`${at}.sha256 must be 64 hex characters`);
        if (e.bytes !== undefined && !(Number.isInteger(e.bytes) && e.bytes > 0)) return bad(`${at}.bytes must be a whole number`);
        return OK;
    },
};

// A kind's parsed file: { schema, rev, <list key>: [...] }. Duplicate ids are rejected.
export function validateReferenceFile(kind, doc) {
    const shape = KIND_SHAPE[kind];
    if (!shape) return bad('unknown kind ' + String(kind));
    if (!isObj(doc)) return bad(`${kind}: file is not an object`);
    const g = guardTree(doc); if (g) return bad(`${kind}: ${g}`);
    if (doc.schema !== SUPPORTED_SCHEMA) return bad(`${kind}: unknown schema ${String(doc.schema)}`);
    if (!isInt(doc.rev)) return bad(`${kind}: rev must be a whole number`);
    const list = doc[shape.key];
    if (!Array.isArray(list)) return bad(`${kind}: ${shape.key} must be a list`);
    if (list.length > shape.max) return bad(`${kind}: more than ${shape.max} entries`);
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
        const at = `${shape.key}[${i}]`;
        if (!isObj(list[i])) return bad(`${kind}: ${at} must be an object`);
        const r = entryChecks[kind](list[i], `${kind}: ${at}`);
        if (!r.ok) return r;
        if (seen.has(list[i].id)) return bad(`${kind}: duplicate id ${list[i].id}`);
        seen.add(list[i].id);
    }
    return OK;
}

// The list inside a validated file.
export function referenceList(kind, doc) {
    return doc[KIND_SHAPE[kind].key];
}
