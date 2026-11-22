// The saving-model picker (FT-0032 DB15, R3 step R8). Lazy: imported only when the person opens "Change" on Plan or
// reaches the setup model step. The list is the catalogue (state/model-catalogue.js), which reads getReference() and falls
// back to the in-code Bucket method with no data. Every model text is set with textContent.

import '../i18n/en-lazy-models.js';
import { t } from '../i18n/strings.js';
import { BUCKET_METHOD } from '../calc/saving-model.js';
import { entryState, updateAvailable, loadCatalogue, loadEnvelope, useModel, OWN_CHOICE } from '../state/model-catalogue.js';
import { openSheet } from './sheet.js';
import { confirmDialog } from './confirm.js';
import { showToast } from './toast.js';

/** The line for an entry's state (empty when there is none to say). */
export function stateLabel(row) {
    if (row.state === 'needs-newer') return t('m.pick.needsNewer');
    if (row.state === 'current') return t('m.pick.current');
    if (row.state === 'stays') return t('e.plan.tplStays', { name: BUCKET_METHOD.name });
    if (row.state === 'replaces') return t('m.pick.replaces');
    return '';
}

/** Rows for the picker, from catalogue entries and the person's data. Pure. choosable: can be picked. */
export function pickerRows(entries, data) {
    return (Array.isArray(entries) ? entries : []).map((e) => {
        const state = entryState(e, data);
        return {
            id: e.id, name: e.name, version: e.version, engine: e.engine, state,
            blurb: e.blurb || (e.id === BUCKET_METHOD.id ? t('m.pick.bucketBlurb') : ''),
            update: updateAvailable(data, e), choosable: state === 'use' || state === 'switch-back', entry: e,
        };
    });
}

/** Read-only blocks for the sheet: one per entry, all text through textContent. */
export function pickerNodes(rows) {
    return rows.map((r) => {
        const box = document.createElement('div');
        box.className = 'su-fine';
        box.dataset.modelId = r.id;
        box.dataset.modelState = r.state;
        const b = document.createElement('b');
        b.textContent = r.name;
        box.appendChild(b);
        const lines = [r.blurb, stateLabel(r), r.update ? t('m.pick.updateAvailable') : ''].filter(Boolean);
        for (const l of lines) { const p = document.createElement('div'); p.textContent = l; box.appendChild(p); }
        return box;
    });
}

/**
 * Plan's "Change". `deps`: { data, onResult(res), loadRef, fetch, entries } where onResult takes an E5-style payload
 * ({ok, message, onUndo}); `entries` skips the catalogue read (tests). Choices: "Use this" on an entry, "Switch back"
 * (the Bucket method from an own template that fits), or "Make this your own template" (the fork, as before).
 */
export async function openModelPicker(deps) {
    const { data, onResult } = deps;
    const sm = data && data.savingModel;
    if (!sm) return false;
    const entries = deps.entries || await loadCatalogue({ loadRef: deps.loadRef });
    const rows = pickerRows(entries, data);
    const custom = typeof sm.id === 'string' && sm.id.startsWith('custom-');
    const options = rows.filter((r) => r.choosable).map((r) => ({ value: r.id, label: r.state === 'switch-back' ? t('m.pick.switchBack', { name: r.name }) : r.name }));
    if (!custom) options.push({ value: OWN_CHOICE, label: t('m.pick.own') });
    return openSheet({
        title: t('m.pick.title'), content: pickerNodes(rows), readOnly: !options.length, saveLabel: t('m.pick.useThis'),
        fields: options.length ? [{ key: 'choice', label: t('m.pick.choose'), type: 'select', options, required: true }] : [],
        values: { choice: options.length ? options[0].value : '' },
        onSave: async (v) => {
            if (v.choice === OWN_CHOICE) {
                if (deps.onOwn) { setTimeout(deps.onOwn, 0); return true; } // the caller's own sheet (it asks for a name)
                if (!(await confirmDialog({ title: t('m.pick.ownTitle'), body: t('m.pick.ownAsk'), confirmLabel: t('m.pick.ownYes') }))) return false;
                const { forkOwnTemplate } = await import('../state/saving-model.js');
                onResult(forkOwnTemplate(data));
                return true;
            }
            const row = rows.find((r) => r.id === v.choice);
            if (!row || !row.choosable) return false;
            if (row.state === 'switch-back' && !(await confirmDialog({ title: t('e.plan.tplBackAsk', { name: row.name }), confirmLabel: t('e.plan.switchBack') }))) return false;
            const loaded = await loadEnvelope(row.entry, { fetch: deps.fetch });
            if (!loaded.ok) { showToast(t(loaded.code === 'unavailable' ? 'm.pick.unavailable' : 'm.pick.failed'), 'error'); return false; }
            const res = useModel(data, loaded.envelope, {});
            if (!res.ok) { showToast(t('m.pick.failed'), 'error'); return false; }
            onResult({ ...res, message: t('m.pick.used', { name: row.name }) });
            return true;
        },
    });
}
