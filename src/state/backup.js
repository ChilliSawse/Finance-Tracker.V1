// The backup bundle, version 2 (D2, M-6, FT-R-74 D9). One file holds the saved settings
// (financeData, guiSettings) plus the rows that live in IndexedDB: transactions and events.
//
//   { version: 2, app: 'ledger', timestamp, financeData, guiSettings, transactions: [...], events: [...] }
//
// EXTENSION POINT (F1 adds `scenarios` here): a bundle part is
//   { key, read(): Promise<rows>, sanitize(rows): {rows, skipped}, replace(rows): Promise<void> }
// and `registerBackupPart(part)` adds it. Export reads every registered part, restore sanitizes and
// replaces every part the file carries, and erase-all clears every part. Nothing else changes.
//
// Old bundles (no `version`, no part keys) still restore: only the settings are replaced and the
// rows already on the device are left alone. A restore goes through S1's prepareImport (parse,
// validate, sanitize, migration chain on a clone) and commitImport (safety copy, swap, render, save).
// Pure apart from the default parts, which use IndexedDB only when called.

import {
    prepareImport, commitImport, snapshotBeforeRestore, quarantineCorruptSave, PRE_RESTORE_KEY, LEGACY_PARTS_KEY, SAVE_KEY, safeNumber, MAX_STRING_LENGTH,
} from './sanitize.js';
import { IDB_SAFETY } from './safety-db.js';
import { exportAllTransactions, importTransactions, isValidIsoDate } from './transactions.js';
import { withStore } from './db.js';

export const BACKUP_VERSION = 2;
// RETIRED (S9, G6W15-1/-2): the S8 rows copy sat in localStorage under this key. It now lives in the separate
// safety database (safety-db.js); a leftover key is removed on load and on every restore or erase.
export const PRE_RESTORE_PARTS_KEY = LEGACY_PARTS_KEY;
export const MAX_PART_ROWS = 500000;
// Keys the retired "Save as My Defaults" (ft-user-defaults) and the retired info-guide panels (ft-info-collapsed, A11) used.
// Never read or written now; Erase all removes them. Names are never changed.
export const RETIRED_KEYS = ['ft-user-defaults', 'ft-info-collapsed'];

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 8;

// Deep clean of one value from a file: prototype keys stripped, numbers finite and bounded,
// strings capped, functions and symbols dropped. Strings are not escaped (render time does that).
export function cleanValue(v, depth) {
    if (v === null) return null;
    switch (typeof v) {
        case 'string': return v.length > MAX_STRING_LENGTH ? v.slice(0, MAX_STRING_LENGTH) : v;
        case 'number': return safeNumber(v);
        case 'boolean': return v;
        case 'object': {
            if (depth >= MAX_DEPTH) return Array.isArray(v) ? [] : {};
            if (Array.isArray(v)) return v.map((x) => { const c = cleanValue(x, depth + 1); return c === undefined ? null : c; });
            const out = {};
            for (const k of Object.keys(v)) {
                if (BAD_KEYS.has(k)) continue;
                const c = cleanValue(v[k], depth + 1);
                if (c !== undefined) out[k] = c;
            }
            return out;
        }
        default: return undefined;
    }
}

const isPlainRow = (r) => r !== null && typeof r === 'object' && !Array.isArray(r);
const nonEmptyId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 200;

/** Transactions from a file: a row without a real id, date or whole-cents amount is left out. */
export function sanitizeTransactionRows(rows) {
    const out = [];
    let skipped = 0;
    const list = Array.isArray(rows) ? rows.slice(0, MAX_PART_ROWS) : [];
    skipped += Array.isArray(rows) ? Math.max(0, rows.length - list.length) : 0;
    for (const r of list) {
        if (!isPlainRow(r) || !nonEmptyId(r.id) || !isValidIsoDate(r.date)
            || typeof r.amountCents !== 'number' || !Number.isFinite(r.amountCents)) { skipped++; continue; }
        const c = cleanValue(r, 0);
        c.amountCents = Math.round(c.amountCents);
        if (typeof c.description !== 'string') c.description = '';
        if (typeof c.hash !== 'string' || !c.hash) c.hash = 'restored|' + c.id;
        out.push(c);
    }
    return { rows: out, skipped };
}

/** Events from a file: id, type and a finite seq are required. */
export function sanitizeEventRows(rows) {
    const out = [];
    let skipped = 0;
    const list = Array.isArray(rows) ? rows.slice(0, MAX_PART_ROWS) : [];
    skipped += Array.isArray(rows) ? Math.max(0, rows.length - list.length) : 0;
    for (const r of list) {
        if (!isPlainRow(r) || !nonEmptyId(r.id) || typeof r.type !== 'string' || !r.type
            || typeof r.seq !== 'number' || !Number.isFinite(r.seq)) { skipped++; continue; }
        const c = cleanValue(r, 0);
        if (!isPlainRow(c.data)) c.data = {};
        if (typeof c.ts !== 'string') c.ts = '';
        out.push(c);
    }
    return { rows: out, skipped };
}

// ---------- the registered parts (IndexedDB) ----------

async function replaceStoreRows(storeName, rows) {
    await withStore(storeName, 'readwrite', (s) => { s.clear(); });
    if (rows.length) {
        await withStore(storeName, 'readwrite', (s) => { rows.forEach((r) => s.put(r)); });
    }
}

export const TRANSACTIONS_PART = {
    key: 'transactions',
    read: () => exportAllTransactions(),
    sanitize: sanitizeTransactionRows,
    async replace(rows) {
        await withStore('transactions', 'readwrite', (s) => { s.clear(); });
        if (rows.length) await importTransactions(rows);
    },
};

export const EVENTS_PART = {
    key: 'events',
    read: () => withStore('events', 'readonly', (s) => s.getAll()),
    sanitize: sanitizeEventRows,
    replace: (rows) => replaceStoreRows('events', rows),
};

export const BACKUP_PARTS = [TRANSACTIONS_PART, EVENTS_PART];

/** F1 (and later steps) add a part here, for example scenarios. Replaces a part with the same key. */
export function registerBackupPart(part) {
    if (!part || typeof part.key !== 'string' || typeof part.read !== 'function'
        || typeof part.sanitize !== 'function' || typeof part.replace !== 'function') {
        throw new Error('A backup part needs key, read, sanitize and replace.');
    }
    const i = BACKUP_PARTS.findIndex((p) => p.key === part.key);
    if (i >= 0) BACKUP_PARTS[i] = part; else BACKUP_PARTS.push(part);
    return BACKUP_PARTS;
}

// ---------- export ----------

/**
 * Read every part. A part that cannot be read is listed in `failed` and left out of the file.
 * @returns {Promise<{rows:Object<string,Array>, failed:string[]}>}
 */
export async function collectParts(parts = BACKUP_PARTS) {
    const rows = {};
    const failed = [];
    for (const p of parts) {
        try {
            const list = await p.read();
            rows[p.key] = Array.isArray(list) ? list : [];
        } catch (err) {
            console.error(`Backup: could not read ${p.key}`, err);
            failed.push(p.key);
        }
    }
    return { rows, failed };
}

/** The v2 bundle object. `partRows` is `collectParts(...).rows`. */
export function buildBackupBundle({ financeData, guiSettings, partRows = {}, now = new Date() }) {
    const bundle = {
        version: BACKUP_VERSION,
        app: 'ledger',
        timestamp: now.toISOString(),
        financeData,
        guiSettings,
    };
    for (const key of Object.keys(partRows)) {
        if (!(key in bundle)) bundle[key] = partRows[key];
    }
    return bundle;
}

// ---------- restore ----------

/**
 * Parse, validate, sanitize and migrate a backup on a clone (S1 prepareImport), then clean the
 * part rows the file carries. Touches no store, no storage, no IndexedDB.
 * @returns {{ok:true, financeData, guiSettings, version:number, parts:Object<string,Array>,
 *            counts:Object<string,number>, skipped:number}|{ok:false, error:string}}
 */
export function prepareBackup(text, parts = BACKUP_PARTS) {
    const prepared = prepareImport(text);
    if (!prepared.ok) return prepared;
    let bundle;
    try { bundle = JSON.parse(text); } catch (e) { return { ok: false, error: 'File does not contain valid JSON.' }; }
    const out = { ...prepared, version: Number(bundle.version) || 1, parts: {}, counts: {}, skipped: 0 };
    for (const p of parts) {
        if (!Array.isArray(bundle[p.key])) continue; // an old bundle, or one without this part: leave the device's rows alone
        const { rows, skipped } = p.sanitize(bundle[p.key]);
        out.parts[p.key] = rows;
        out.counts[p.key] = rows.length;
        out.skipped += skipped;
    }
    return out;
}

/** True when the prepared file carries rows (a v2 file), so a restore replaces them. */
export const carriesParts = (prepared) => !!prepared && Object.keys(prepared.parts || {}).length > 0;

/** Put the old rows back. Returns the keys that could not be put back. */
async function rollbackParts(list, before) {
    const failed = [];
    for (const p of list) {
        try { await p.replace(before[p.key] || []); } catch (err) { console.error(`Backup: could not put back ${p.key}`, err); failed.push(p.key); }
    }
    return failed;
}

const newCopyId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/**
 * G6W12-4 / S9: keep ONE consistent safety copy of the device before a restore. The rows of EVERY registered
 * part go to the safety database (IndexedDB, `safety`), the settings to PRE_RESTORE_KEY, both marked with the
 * same id and timestamp. Returns true when both were stored, false otherwise (a half copy is removed).
 */
export async function takeSafetyCopy(store, storage, before, safety = IDB_SAFETY, now = new Date()) {
    const meta = { copyId: newCopyId(), timestamp: now.toISOString(), hasRows: true };
    try {
        await safety.put({ id: meta.copyId, timestamp: meta.timestamp, parts: before });
    } catch (err) {
        console.error('Backup: could not keep the rows copy', err);
        return false;
    }
    if (!snapshotBeforeRestore(store, storage, meta)) {
        try { await safety.remove(); } catch (err) { console.error('Backup: could not drop the unpaired rows copy', err); }
        return false;
    }
    return true;
}

/**
 * Replace the device's data with a prepared backup. BEFORE anything is replaced the current rows of
 * every registered part are read and kept on the device (takeSafetyCopy: rows in the safety database,
 * settings in localStorage, one moment); if that copy cannot be stored the restore is refused. The rows
 * are then swapped (the old rows are put back from memory on any failure), then S1's commitImport swaps
 * the settings, renders and saves. A main save that fails counts as a failed restore (G6W15-2).
 * `keepRowsCopy: false` (Erase all, G6W15-1) keeps only the settings copy and deletes any rows copy.
 * @returns {Promise<{ok:boolean, error?:string, detail?:*, counts?:object}>}
 */
export async function commitBackup(store, prepared, { storage, render, save, parts = BACKUP_PARTS, safety = IDB_SAFETY, keepRowsCopy = true } = {}) {
    const active = parts.filter((p) => prepared.parts && Array.isArray(prepared.parts[p.key]));
    const before = {};
    try {
        for (const p of parts) before[p.key] = await p.read();
    } catch (err) {
        return { ok: false, error: 'cantReadCurrent', detail: err };
    }
    // Copy first. Both halves must succeed before anything is replaced.
    if (keepRowsCopy) {
        if (!(await takeSafetyCopy(store, storage, before, safety))) return { ok: false, error: 'cantKeepCopy' };
    } else if (!snapshotBeforeRestore(store, storage, { copyId: newCopyId(), timestamp: new Date().toISOString(), hasRows: false })) {
        return { ok: false, error: 'cantKeepCopy' };
    }
    const touched = [];
    try {
        for (const p of active) {
            touched.push(p);
            await p.replace(prepared.parts[p.key]);
        }
    } catch (err) {
        const stuck = await rollbackParts(touched, before);
        return { ok: false, error: 'cantWrite', detail: err, notPutBack: stuck };
    }
    const result = commitImport(store, prepared, { storage, render, save, copyTaken: true });
    if (!result.ok) {
        const stuck = await rollbackParts(touched, before);
        return stuck.length ? { ...result, notPutBack: stuck } : result;
    }
    if (!keepRowsCopy) {
        // Erase all leaves no rows copy anywhere: the safety database and the retired localStorage key.
        try { await safety.remove(); } catch (err) { console.error('Backup: could not remove the rows copy after erase', err); }
        try { storage.removeItem(PRE_RESTORE_PARTS_KEY); } catch (err) { console.error('Backup: could not remove the old rows copy key', err); }
    }
    return { ok: true, counts: prepared.counts || {} };
}

/**
 * Undo the last restore: bring back the settings (PRE_RESTORE_KEY) and every part's rows (the safety
 * database) through the same commit (so it keeps a copy of the state it replaces, which makes it a redo
 * too, until it is spent: after a successful undo both copies are removed, U3). The two copies must carry the same id; a mismatched pair is refused ('copyMismatch'). Without a
 * rows copy (an erase, or an older settings-only copy) only the settings come back.
 * @returns {Promise<{ok:boolean, error?:string, detail?:*, counts?:object}>}
 */
export async function undoLastRestore(store, { storage, render, save, parts = BACKUP_PARTS, safety = IDB_SAFETY, spend = true } = {}) {
    let settings, copy;
    try {
        const rawSettings = storage.getItem(PRE_RESTORE_KEY);
        if (!rawSettings) return { ok: false, error: 'noCopy' };
        settings = JSON.parse(rawSettings);
    } catch (err) { return { ok: false, error: 'noCopy', detail: err }; }
    try { copy = await safety.get(); } catch (err) { return { ok: false, error: 'noCopy', detail: err }; }
    if (copy && (!settings.copyId || settings.copyId !== copy.id)) return { ok: false, error: 'copyMismatch' };
    if (!copy && settings.hasRows) return { ok: false, error: 'copyMismatch' };
    const rows = copy && copy.parts && typeof copy.parts === 'object' ? copy.parts : {};
    const text = JSON.stringify({ version: BACKUP_VERSION, app: 'ledger', financeData: settings.financeData, guiSettings: settings.guiSettings, ...rows });
    const prepared = prepareBackup(text, parts);
    if (!prepared.ok) return prepared;
    const result = await commitBackup(store, prepared, { storage, render, save, parts, safety });
    // U3: the copy is spent once it has been put back (the undo's own copy of what it replaced is dropped too).
    if (result.ok && spend) await discardRestoreCopy({ storage, safety });
    return result;
}

/** Erase-all: a fresh store and every registered part emptied, through the same commit (settings copy and rollback). No rows copy is kept (G6W15-1). */
export function commitErase(store, { financeData, guiSettings }, { storage, render, save, parts = BACKUP_PARTS, safety = IDB_SAFETY } = {}) {
    const empty = {};
    for (const p of parts) empty[p.key] = [];
    return commitBackup(store, { financeData, guiSettings, parts: empty, counts: {} }, { storage, render, save, parts, safety, keepRowsCopy: false });
}

// ---------- U3: the restore copy, undo toast, and the boot recovery bundle ----------

/**
 * Is there a restore copy to put back? Only a full pair counts: a settings copy that says it has rows AND a
 * matching rows copy in the safety database (an erase keeps settings only, so it gives null). The copy stays
 * until the next restore replaces it, an erase removes the rows copy, or an undo spends it. Never throws.
 * @returns {Promise<{id:string, timestamp:string|null}|null>}
 */
export async function restoreCopyInfo({ storage, safety = IDB_SAFETY } = {}) {
    try {
        const raw = storage.getItem(PRE_RESTORE_KEY);
        if (!raw) return null;
        const settings = JSON.parse(raw);
        if (!settings || !settings.copyId || !settings.hasRows) return null;
        const copy = await safety.get();
        if (!copy || copy.id !== settings.copyId) return null;
        return { id: copy.id, timestamp: copy.timestamp || settings.copyTimestamp || null };
    } catch (err) {
        console.error('Backup: could not check for a restore copy', err);
        return null;
    }
}

/** Remove both halves of the restore copy (settings and rows). Returns true when both are gone. */
export async function discardRestoreCopy({ storage, safety = IDB_SAFETY } = {}) {
    let ok = true;
    try { storage.removeItem(PRE_RESTORE_KEY); } catch (err) { console.error('Backup: could not remove the settings copy', err); ok = false; }
    try { await safety.remove(); } catch (err) { console.error('Backup: could not remove the rows copy', err); ok = false; }
    return ok;
}

/** The arguments for showUndoToast after a restore. `undo` runs when the person taps Undo; expiry leaves the restore alone. */
export function restoreUndoToast({ message, undo, duration = 12000 }) {
    return { message, duration, onUndo: () => { Promise.resolve().then(undo).catch((err) => console.error('Undo failed', err)); } };
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => reject(new Error('Reading took too long.')), ms);
        promise.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
    });
}

/**
 * The boot recovery export: a full v2 bundle read as defensively as possible. Settings come from the raw
 * saved text (or `fallbackRaw`, a save that was set aside); every part is read on its own with a time limit.
 * Whatever cannot be read is named in `unreadable` ('settings' or a part key) and left out; the rest is
 * still exported. Unreadable settings text is carried as `unreadableSettingsText` so nothing is lost.
 * @returns {Promise<{bundle:object, unreadable:string[], anything:boolean}>}
 */
export async function collectRecoveryBundle({ storage, parts = BACKUP_PARTS, fallbackRaw = null, now = new Date(), timeoutMs = 10000 } = {}) {
    const unreadable = [];
    let raw = null;
    try { raw = storage.getItem(SAVE_KEY); } catch (err) { console.error('Recovery: could not read the saved settings', err); unreadable.push('settings'); }
    if (raw == null && !unreadable.length) raw = fallbackRaw;
    let saved = null;
    let settingsText = null;
    if (typeof raw === 'string' && raw) {
        try {
            const parsed = JSON.parse(raw);
            if (isPlainRow(parsed) && isPlainRow(parsed.financeData)) saved = parsed;
        } catch (err) { console.error('Recovery: the saved settings are not readable', err); }
        if (!saved) { unreadable.push('settings'); settingsText = raw; }
    }
    const partRows = {};
    for (const p of parts) {
        try {
            const list = await withTimeout(Promise.resolve().then(() => p.read()), timeoutMs);
            if (!Array.isArray(list)) throw new Error('Not a list of rows.');
            partRows[p.key] = list;
        } catch (err) {
            console.error(`Recovery: could not read ${p.key}`, err);
            unreadable.push(p.key);
        }
    }
    const bundle = buildBackupBundle({
        financeData: saved ? saved.financeData : undefined,
        guiSettings: saved ? (isPlainRow(saved.guiSettings) ? saved.guiSettings : {}) : undefined,
        partRows, now,
    });
    if (!saved) { delete bundle.financeData; delete bundle.guiSettings; }
    if (settingsText !== null) bundle.unreadableSettingsText = settingsText;
    if (unreadable.length) bundle.unreadable = unreadable;
    const anything = !!saved || settingsText !== null || Object.values(partRows).some((r) => r.length > 0);
    return { bundle, unreadable, anything };
}

/**
 * The boot recovery import: the same safety copy and rollback as a normal restore (commitBackup), then the
 * settings are written to the main save for the next start. If the saved text is not even JSON it is set aside
 * (so it is not lost), removed for the duration (the copy step needs to read it), and put back if the restore fails.
 * @returns {Promise<{ok:boolean, error?:string, detail?:*, counts?:object, notPutBack?:string[]}>}
 */
export async function restoreFromRecovery(text, { store, storage, parts = BACKUP_PARTS, safety = IDB_SAFETY } = {}) {
    const prepared = prepareBackup(text, parts);
    if (!prepared.ok) return prepared;
    let raw = null;
    try { raw = storage.getItem(SAVE_KEY); } catch (err) { return { ok: false, error: 'cantKeepCopy', detail: err }; }
    let removedRaw = null;
    if (raw) {
        let readable = false;
        try { readable = isPlainRow(JSON.parse(raw)); } catch (err) { console.error('Recovery: the saved settings are not readable', err); }
        if (!readable) {
            quarantineCorruptSave(raw, storage);
            try { storage.removeItem(SAVE_KEY); removedRaw = raw; } catch (err) { return { ok: false, error: 'cantKeepCopy', detail: err }; }
        }
    }
    const result = await commitBackup(store, prepared, {
        storage, parts, safety,
        render: null,
        save: () => {
            try {
                storage.setItem(SAVE_KEY, JSON.stringify({ financeData: store.financeData, guiSettings: store.guiSettingsData, timestamp: new Date().toISOString() }));
                return true;
            } catch (err) {
                console.error('Recovery: could not save the restored settings', err);
                return false;
            }
        },
    });
    if (!result.ok && removedRaw !== null) {
        try { storage.setItem(SAVE_KEY, removedRaw); } catch (err) { console.error('Recovery: could not put the unreadable save back (a copy was set aside)', err); }
    }
    return result;
}
