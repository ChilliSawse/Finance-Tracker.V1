// The edit sheet: one declarative form that opens as a bottom sheet below
// 768 px and a right-hand panel above. Replaces the grid editors and modals.
//
//   openSheet({title, fields, values, onSave, onDelete, validate, plausibility, saveLabel, content, readOnly})
//     -> { close(), setError(field, message), setNote(field, message, fixes), getValues(), el }
//
// fields:       [{key, label, type: text|money|number|select|date|percent|toggle, options, hint, required, unit, hidden}]
//               money is returned in the collection's own unit (dollars; `unit:'cents'` gives integer cents).
// validate:     (values) => {field: message}. Any message blocks Save, and the rejected value is put back.
// plausibility: (values) => [{field, message, fix?: {label, apply(values) -> patch}}]. A quiet note, never blocks.
//
// Everything user-visible goes in as textContent, never innerHTML (G6).
// The pure parts (coerce, plausibility rules, the model, undo snapshots) have no DOM.

import { t } from '../i18n/strings.js';
import { trapTab, rememberFocus, getFocusables } from './focus.js';
import { showUndoToast, dismissToastTagged } from './toast.js';

// ── Pure: value coercion ────────────────────────────────────────────────────
const NUMERIC = new Set(['money', 'number', 'percent']);

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** Raw input -> {ok, value} or {ok:false, error}. */
export function coerceFieldValue(field, raw) {
    const type = field.type || 'text';
    if (type === 'toggle') return { ok: true, value: !!raw };
    const text = raw == null ? '' : String(raw).trim();
    if (NUMERIC.has(type)) {
        if (text === '') {
            return field.required ? { ok: false, error: t('d.sheet.required') } : { ok: true, value: null };
        }
        const cleaned = text.replace(/[^0-9.\-+]/g, '');
        if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { ok: false, error: t('d.sheet.notNumber') };
        const n = Number(cleaned);
        if (!Number.isFinite(n)) return { ok: false, error: t('d.sheet.notNumber') };
        if (type === 'money') return { ok: true, value: field.unit === 'cents' ? Math.round(n * 100) : round2(n) };
        return { ok: true, value: type === 'percent' ? round2(n) : n };
    }
    if (text === '') return field.required ? { ok: false, error: t('d.sheet.required') } : { ok: true, value: type === 'text' ? '' : null };
    if (type === 'select' && Array.isArray(field.options)) {
        const opt = field.options.map(normaliseOption).find((o) => String(o.value) === text);
        return { ok: true, value: opt ? opt.value : text };
    }
    return { ok: true, value: text };
}

export function normaliseOption(o) {
    return o && typeof o === 'object' ? { value: o.value, label: o.label != null ? o.label : String(o.value) } : { value: o, label: String(o) };
}

/** A value -> the text shown in its input. */
export function displayValue(field, value) {
    const type = field.type || 'text';
    if (type === 'toggle') return !!value;
    if (value == null) return '';
    if (type === 'money') return (field.unit === 'cents' ? value / 100 : Number(value)).toFixed(2);
    return String(value);
}

// ── Pure: plausibility rules ────────────────────────────────────────────────
const WEEKS_PER = { weekly: 1, fortnightly: 2, fourweekly: 4, monthly: 52 / 12, quarterly: 13, halfyearly: 26, yearly: 52, annually: 52 };

const dollars = (n) => 'A$' + Math.round(n).toLocaleString('en-AU');

/** Flags an amount that works out above a threshold per week (default A$5,000). */
export function weeklyAmountRule({ field, frequencyField, thresholdDollars = 5000 }) {
    return (values) => {
        const amount = Number(values[field]);
        if (!Number.isFinite(amount)) return [];
        const freq = frequencyField ? WEEKS_PER[values[frequencyField]] : 1;
        if (!freq) return [];
        const perWeek = amount / freq;
        return perWeek > thresholdDollars ? [{ field, message: t('d.plaus.weekly', { amount: dollars(perWeek) }) }] : [];
    };
}

/** Flags hours over a limit per week (default 80). */
export function hoursRule({ field, maxPerWeek = 80 }) {
    return (values) => {
        const h = Number(values[field]);
        return Number.isFinite(h) && h > maxPerWeek ? [{ field, message: t('d.plaus.hours', { hours: h }) }] : [];
    };
}

/** Flags bucket percentages that do not add to 100 and offers the difference to Smile. */
export function bucketTotalRule({ fields, smileField }) {
    return (values) => {
        const total = round2(fields.reduce((s, k) => s + (Number(values[k]) || 0), 0));
        if (Math.abs(total - 100) < 0.005) return [];
        const note = { field: smileField, message: t('d.plaus.buckets', { total }) };
        const newSmile = round2((Number(values[smileField]) || 0) + (100 - total));
        if (newSmile >= 0) note.fix = { label: t('d.plaus.fixSmile'), apply: () => ({ [smileField]: newSmile }) };
        return [note];
    };
}

export function runPlausibility(rules, values) {
    const out = [];
    for (const rule of rules) out.push(...(rule(values) || []));
    return out;
}

// ── Pure: the sheet model ───────────────────────────────────────────────────
export function createSheetModel({ fields, values = {}, validate, plausibility }) {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const accepted = {};
    const raw = {};
    for (const f of fields) {
        const v = values[f.key];
        accepted[f.key] = v === undefined ? (f.type === 'toggle' ? false : null) : v;
        raw[f.key] = displayValue(f, accepted[f.key]);
    }
    const extras = { ...values }; // keys with no field (ids and so on) travel through untouched
    for (const f of fields) delete extras[f.key];

    // Best-effort values: a field whose text does not parse keeps its last accepted value.
    function current() {
        const out = { ...extras };
        for (const f of fields) {
            const c = coerceFieldValue(f, raw[f.key]);
            out[f.key] = c.ok ? c.value : accepted[f.key];
        }
        return out;
    }

    const model = {
        raw,
        errors: {},
        current,
        set(key, value) { if (byKey.has(key)) raw[key] = value; },
        notes() { return plausibility ? (plausibility(current()) || []) : []; },
        applyFix(i) {
            const note = model.notes()[i];
            if (!note || !note.fix) return null;
            const patch = note.fix.apply(current()) || {};
            for (const [k, v] of Object.entries(patch)) {
                const f = byKey.get(k);
                if (f) raw[k] = displayValue(f, v);
            }
            return patch;
        },
        /** Validate. On error nothing is saved and rejected fields go back to their last accepted value. */
        save() {
            const errors = {};
            const out = { ...extras };
            for (const f of fields) {
                const c = coerceFieldValue(f, raw[f.key]);
                if (c.ok) out[f.key] = c.value; else errors[f.key] = c.error;
            }
            if (validate) {
                const bag = validate({ ...out, ...Object.fromEntries(Object.keys(errors).map((k) => [k, accepted[k]])) }) || {};
                for (const [k, msg] of Object.entries(bag)) if (msg) errors[k] = String(msg);
            }
            model.errors = errors;
            const bad = Object.keys(errors);
            if (bad.length) {
                for (const k of bad) {
                    const f = byKey.get(k);
                    if (f) raw[k] = displayValue(f, accepted[k]); // the rejected value is not kept
                }
                return { ok: false, errors, values: null };
            }
            for (const f of fields) accepted[f.key] = out[f.key];
            return { ok: true, errors: {}, values: out };
        },
    };
    return model;
}

// ── Pure: delete with undo ──────────────────────────────────────────────────
/** Remove collection[index] in place; undo() puts the item back at its index (clamped). */
export function removeAt(collection, index) {
    if (!Array.isArray(collection) || index < 0 || index >= collection.length) return null;
    const [item] = collection.splice(index, 1);
    let restored = false;
    return {
        item, index,
        undo() {
            if (restored) return;
            restored = true;
            collection.splice(Math.min(index, collection.length), 0, item);
        },
    };
}

/**
 * Delete at once, tell the caller to render and save (onChange), and raise an Undo
 * toast. Undo reinserts and calls onChange again. `toast` is injectable for tests.
 */
export function deleteWithUndo(collection, index, { message, onChange, onExpire, toast = showUndoToast } = {}) {
    const removed = removeAt(collection, index);
    if (!removed) return null;
    if (onChange) onChange();
    toast({
        message,
        onUndo: () => { removed.undo(); if (onChange) onChange(); },
        onExpire,
    });
    return removed;
}

// ── DOM ─────────────────────────────────────────────────────────────────────
let active = null; // the open sheet, if any
let uid = 0;

function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
}

function buildField(f, model, id) {
    const wrap = el('div', `sheet-field type-${f.type || 'text'}`);
    wrap.dataset.field = f.key;
    const inputId = `${id}-${f.key}`;
    const type = f.type || 'text';
    let control;
    if (type === 'select') {
        control = el('select', 'sheet-input');
        for (const o of (f.options || []).map(normaliseOption)) {
            const opt = el('option', '', o.label);
            opt.value = String(o.value);
            control.appendChild(opt);
        }
        control.value = String(model.raw[f.key] ?? '');
    } else if (type === 'toggle') {
        control = el('input', 'sheet-check');
        control.type = 'checkbox';
        control.checked = !!model.raw[f.key];
    } else {
        control = el('input', 'sheet-input');
        control.type = type === 'date' ? 'date' : 'text';
        if (type === 'money' || type === 'percent' || type === 'number') control.inputMode = 'decimal';
        control.value = model.raw[f.key] ?? '';
        control.autocomplete = 'off';
    }
    control.id = inputId;
    control.name = f.key;
    control.dataset.key = f.key;
    const label = el('label', 'sheet-label', f.label || f.key);
    label.htmlFor = inputId;

    const describedBy = [];
    const hint = f.hint ? el('div', 'sheet-hint', f.hint) : null;
    if (hint) { hint.id = `${inputId}-hint`; describedBy.push(hint.id); }
    const err = el('div', 'sheet-error');
    err.id = `${inputId}-err`;
    err.setAttribute('role', 'alert');
    err.dataset.errorFor = f.key;
    err.hidden = true;
    const note = el('div', 'sheet-note');
    note.id = `${inputId}-note`;
    note.dataset.noteFor = f.key;
    note.setAttribute('aria-live', 'polite'); // a note that changes after a tap ("Confirmed. Save to keep it.") is read out
    note.hidden = true;
    describedBy.push(err.id, note.id);
    control.setAttribute('aria-describedby', describedBy.join(' '));

    if (type === 'toggle') {
        const row = el('div', 'sheet-toggle');
        row.append(control, label);
        wrap.appendChild(row);
    } else {
        wrap.appendChild(label);
        if (type === 'money' || type === 'percent') {
            const box = el('div', 'sheet-affix');
            if (type === 'money') box.appendChild(el('span', 'sheet-affix-sym', '$'));
            box.appendChild(control);
            if (type === 'percent') box.appendChild(el('span', 'sheet-affix-sym', '%'));
            wrap.appendChild(box);
        } else {
            wrap.appendChild(control);
        }
    }
    if (hint) wrap.appendChild(hint);
    wrap.append(err, note);
    return wrap;
}

/** A note's identity: its message and fix labels. setNote keeps the DOM node while this is unchanged (T3). */
export function noteSig(message, fixes = []) {
    return message ? JSON.stringify([message, (fixes || []).map((fx) => fx.label)]) : '';
}

export function openSheet({ title, fields = [], values = {}, onSave, onDelete, validate, plausibility, saveLabel, content, readOnly = false } = {}) {
    if (active) active.close(); // one sheet at a time
    const restoreFocus = rememberFocus();
    const model = createSheetModel({ fields, values, validate, plausibility });
    const id = `sheet-${++uid}`;

    const layer = el('div', 'sheet-layer');
    const backdrop = el('div', 'sheet-backdrop');
    backdrop.dataset.sheetAction = 'close';
    const sheet = el('section', 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', `${id}-title`);

    const head = el('div', 'sheet-head');
    const h = el('h2', '', title || '');
    h.id = `${id}-title`;
    const closeBtn = el('button', 'sheet-icon-btn', '×');
    closeBtn.type = 'button';
    closeBtn.dataset.sheetAction = 'close';
    closeBtn.setAttribute('aria-label', t('d.sheet.close'));
    head.append(h, closeBtn);

    const form = el('form', 'sheet-body');
    form.noValidate = true;
    if (Array.isArray(content)) for (const n of content) if (n) form.appendChild(n); // A11: read-only blocks (help text), built with textContent
    for (const f of fields) if (!f.hidden) form.appendChild(buildField(f, model, id)); // a hidden field has no row: its value only travels (a confirm tap on a note sets it)
    const formError = el('div', 'sheet-error sheet-form-error');
    formError.setAttribute('role', 'alert');
    formError.hidden = true;
    form.appendChild(formError);

    const foot = el('div', 'sheet-foot');
    let delBtn = null;
    if (typeof onDelete === 'function') {
        delBtn = el('button', 'sheet-btn is-danger sheet-delete', t('d.sheet.delete'));
        delBtn.type = 'button';
        delBtn.dataset.sheetAction = 'delete';
        foot.appendChild(delBtn);
    }
    const spacer = el('span', 'sheet-spacer');
    const cancelBtn = el('button', 'sheet-btn', readOnly ? t('d.sheet.close') : t('d.sheet.cancel'));
    cancelBtn.type = 'button';
    cancelBtn.dataset.sheetAction = 'close';
    const saveBtn = el('button', 'sheet-btn is-primary', saveLabel || t('d.sheet.save'));
    saveBtn.type = 'submit';
    saveBtn.dataset.sheetAction = 'save';
    saveBtn.setAttribute('form', `${id}-form`);
    form.id = `${id}-form`;
    if (readOnly) foot.append(spacer, cancelBtn); else foot.append(spacer, cancelBtn, saveBtn);

    sheet.append(head, form, foot);
    layer.append(backdrop, sheet);

    const q = (sel) => layer.querySelector(sel);
    const fieldEl = (key) => layer.querySelector(`[data-field="${CSS.escape(key)}"]`);
    const inputEl = (key) => layer.querySelector(`[data-key="${CSS.escape(key)}"]`);

    function syncInputs() {
        for (const f of fields) {
            const c = inputEl(f.key);
            if (!c) continue;
            if (f.type === 'toggle') c.checked = !!model.raw[f.key]; else c.value = model.raw[f.key] ?? '';
        }
    }

    function setError(key, message) {
        const box = layer.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
        const c = inputEl(key);
        if (!box) { if (key === '_form') { formError.textContent = message || ''; formError.hidden = !message; } return; }
        box.textContent = message || '';
        box.hidden = !message;
        if (c) { if (message) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid'); }
    }

    function setNote(key, message, fixes = []) {
        const box = layer.querySelector(`[data-note-for="${CSS.escape(key)}"]`);
        if (!box) return;
        // Update in place: rebuilding the fix button on a blur-triggered change eats a real mouse click (T3).
        const sig = noteSig(message, fixes);
        if (box.dataset.noteSig === sig) return;
        box.dataset.noteSig = sig;
        box.textContent = '';
        if (!message) { box.hidden = true; return; }
        box.appendChild(el('span', 'sheet-note-text', message));
        fixes.forEach((fx, i) => {
            const b = el('button', 'sheet-fix', fx.label);
            b.type = 'button';
            b.dataset.sheetAction = 'fix';
            b.dataset.fixIndex = String(i);
            b.dataset.fixField = key;
            box.appendChild(b);
        });
        box.hidden = false;
    }

    function renderNotes() {
        const notes = model.notes();
        const seen = new Set();
        notes.forEach((n, i) => {
            if (seen.has(n.field)) return; // one note per field keeps it quiet
            seen.add(n.field);
            const box = layer.querySelector(`[data-note-for="${CSS.escape(n.field)}"]`);
            setNote(n.field, n.message, n.fix ? [n.fix] : []);
            if (box && n.fix) { box.querySelector('[data-sheet-action="fix"]').dataset.noteIndex = String(i); }
        });
        for (const f of fields) if (!seen.has(f.key)) setNote(f.key, '');
    }

    function close() {
        if (!active || active.layer !== layer) return;
        active = null;
        document.removeEventListener('keydown', onDocKey, true);
        layer.remove();
        document.body.classList.remove('has-sheet');
        restoreFocus();
    }

    let saving = false;
    async function save() {
        if (saving) return;
        const res = model.save();
        for (const f of fields) setError(f.key, '');
        setError('_form', '');
        if (!res.ok) {
            syncInputs(); // rejected values go back on screen as the last good ones
            for (const [k, msg] of Object.entries(res.errors)) setError(k, msg);
            renderNotes();
            const first = fields.find((f) => res.errors[f.key]);
            if (first && inputEl(first.key)) inputEl(first.key).focus();
            return;
        }
        saving = true;
        saveBtn.disabled = true;
        saveBtn.textContent = t('d.sheet.saving');
        try {
            const r = typeof onSave === 'function' ? await onSave(res.values) : undefined;
            if (r === false) { saving = false; saveBtn.disabled = false; saveBtn.textContent = saveLabel || t('d.sheet.save'); return; }
            close();
        } catch (err) {
            // H4: log what failed and where, never the values: error type, a short message, the top stack frames, field keys.
            const stack = String(err && err.stack || '').split('\n').slice(0, 5).map((l) => l.trim()).join(' | ');
            console.error('sheet save failed', JSON.stringify({
                type: err && err.name, message: String(err && err.message || err).slice(0, 160), stack: stack.slice(0, 600),
                fields: fields.map((f) => f.key),
            }));
            saving = false;
            saveBtn.disabled = false;
            saveBtn.textContent = saveLabel || t('d.sheet.save');
            setError('_form', t('d.sheet.saveFailed'));
        }
    }

    // Delegated events on the layer.
    layer.addEventListener('click', (e) => {
        const a = e.target.closest('[data-sheet-action]');
        if (!a) return;
        const act = a.dataset.sheetAction;
        if (act === 'close') { e.preventDefault(); close(); }
        else if (act === 'delete') { e.preventDefault(); close(); onDelete(); }
        else if (act === 'fix') {
            e.preventDefault();
            model.applyFix(Number(a.dataset.noteIndex));
            syncInputs();
            renderNotes();
            // the button that was tapped may be gone: keep focus on the note that replaced it, else on the field
            const fk = a.dataset.fixField;
            const box = fk ? layer.querySelector(`[data-note-for="${CSS.escape(fk)}"]`) : null;
            if (box && !box.hidden) { box.tabIndex = -1; box.focus(); } else if (fk && inputEl(fk)) inputEl(fk).focus();
        }
    });
    layer.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    const onInput = (e) => {
        const c = e.target.closest('[data-key]');
        if (!c) return;
        model.set(c.dataset.key, c.type === 'checkbox' ? c.checked : c.value);
        setError(c.dataset.key, '');
        renderNotes();
    };
    layer.addEventListener('input', onInput);
    layer.addEventListener('change', onInput);

    function onDocKey(e) {
        if (!active || active.layer !== layer) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        trapTab(e, sheet);
    }
    document.addEventListener('keydown', onDocKey, true);

    (document.getElementById('sheet-root') || document.body).appendChild(layer);
    dismissToastTagged('sample-welcome');
    document.body.classList.add('has-sheet');
    renderNotes();
    const firstInput = getFocusables(form)[0] || getFocusables(sheet)[0];
    if (firstInput) firstInput.focus();

    const handle = {
        el: sheet, layer, close, setError, setNote,
        getValues: () => model.current(),
    };
    active = handle;
    return handle;
}
