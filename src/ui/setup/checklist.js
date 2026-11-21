// The Today setup checklist (Phase 1 step C7): lives in A6's reserved #today-setup-slot and stays
// until each item is done or marked not needed. It only exists for people who started setup in
// this version (the saved state below), so a long-time user never sees it appear.
//
// State: localStorage `ft-setup-state` = {completed: [stepId], skipped: [stepId], notNeeded: [stepId], dismissed: bool}.
// Pure functions take the storage as a parameter so tests need no browser.

import { t } from '../../i18n/strings.js';
import { esc } from '../html.js';
import { store } from '../../state/store.js';
import { getSpendCache } from '../../state/spend-cache.js';
import { sampleDataActive } from '../../state/sample-data.js';
import { moneyRows, debtRows } from './steps-money.js';

export const SETUP_STATE_KEY = 'ft-setup-state';

const EMPTY = () => ({ completed: [], skipped: [], notNeeded: [], dismissed: false });

export function readSetupState(storage) {
    try {
        const raw = storage && storage.getItem(SETUP_STATE_KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || typeof o !== 'object') return null;
        const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
        return { completed: list(o.completed), skipped: list(o.skipped), notNeeded: list(o.notNeeded), dismissed: o.dismissed === true };
    } catch (e) {
        return null;
    }
}

export function writeSetupState(storage, state) {
    try {
        if (storage) storage.setItem(SETUP_STATE_KEY, JSON.stringify(state));
        return true;
    } catch (e) {
        return false;
    }
}

/** Record a step as completed or skipped (and the other list loses it). Starts the state when none. */
export function markStep(storage, stepId, how) {
    const s = readSetupState(storage) || EMPTY();
    const drop = (arr) => arr.filter((x) => x !== stepId);
    s.completed = drop(s.completed); s.skipped = drop(s.skipped);
    if (how === 'completed') s.completed.push(stepId);
    else if (how === 'skipped') s.skipped.push(stepId);
    writeSetupState(storage, s);
    return s;
}

/** Make sure a state exists (setup started, or skipped at the welcome). */
export function startSetupState(storage) {
    const s = readSetupState(storage);
    if (s) return s;
    const fresh = EMPTY();
    writeSetupState(storage, fresh);
    return fresh;
}

const ITEMS = ['pay', 'essentials', 'nonEssentials', 'debts', 'split', 'transfers', 'first'];

/** Derived "done" from the data where the data can say so, else from the saved steps. */
function derivedDone(id, data, hasTxns) {
    switch (id) {
    case 'pay': return (data.incomeSources || []).some((s) => s && Number(s.grossAnnual) > 0);
    case 'essentials': return moneyRows(data, 'essential').length > 0;
    case 'nonEssentials': return moneyRows(data, 'non').length > 0;
    case 'debts': return debtRows(data).length > 0;
    case 'first': return !!hasTxns;
    default: return false;
    }
}

/** Checklist rows: {id, label, done, skipped, notNeeded}. */
export function checklistItems(data, state, { hasTxns = false } = {}) {
    const st = state || EMPTY();
    return ITEMS.map((id) => {
        const notNeeded = st.notNeeded.includes(id);
        const done = derivedDone(id, data, hasTxns) || (id !== 'first' && st.completed.includes(id));
        return { id, label: t(`c.setup.list.${id}`), done, skipped: !done && st.skipped.includes(id), notNeeded };
    });
}

/** Shown while a started setup has anything left and nobody hid it. */
export function checklistVisible(state, items, { sample = false } = {}) {
    if (!state || state.dismissed || sample) return false;
    return items.some((i) => !i.done && !i.notNeeded);
}

export function checklistHtml(items) {
    const left = items.filter((i) => !i.done && !i.notNeeded).length;
    const rows = items.map((i) => {
        const mark = i.done ? t('c.setup.list.doneMark') : i.skipped ? t('c.setup.list.skippedMark') : '';
        const body = i.done || i.notNeeded
            ? `<span class="su-cl-text${i.done ? ' is-done' : ''}">${esc(i.label)}${mark ? ` <span class="su-tag">${esc(mark)}</span>` : ''}</span>`
            : `<button type="button" class="su-link" data-su-resume="${esc(i.id)}">${esc(i.label)}</button>${i.skipped ? ` <span class="su-tag">${esc(t('c.setup.list.skippedMark'))}</span>` : ''}
               <button type="button" class="su-link su-cl-dismiss" data-su-notneeded="${esc(i.id)}">${esc(t('c.setup.list.notNeeded'))}</button>`;
        return `<li>${body}</li>`;
    }).join('');
    return `<section class="card su-checklist" aria-labelledby="su-cl-h">
        <div class="card-head"><h2 id="su-cl-h">${esc(t('c.setup.list.title'))}</h2><span class="aside">${esc(t('c.setup.list.left', { n: left }))}</span></div>
        <ul class="su-cl">${rows}</ul>
        <button type="button" class="su-link" data-su-hidelist="1">${esc(t('c.setup.list.hide'))}</button></section>`;
}

/** Fill Today's reserved slot. Called at the end of renderToday; a no-op without the slot. */
export function renderSetupChecklist() {
    if (typeof document === 'undefined') return;
    const slot = document.getElementById('today-setup-slot');
    if (!slot) return;
    let el = document.getElementById('today-setup-checklist');
    if (!el) { el = document.createElement('div'); el.id = 'today-setup-checklist'; slot.appendChild(el); }
    let storage = null;
    try { storage = window.localStorage; } catch (e) { storage = null; }
    const state = readSetupState(storage);
    const cache = getSpendCache();
    const items = checklistItems(store.financeData || {}, state, { hasTxns: !!(cache && cache.rows && cache.rows.length) });
    el.innerHTML = checklistVisible(state, items, { sample: sampleDataActive() }) ? checklistHtml(items) : '';
}
