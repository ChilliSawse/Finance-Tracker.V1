// The Settings screen (D2): five groups and a search field, rendered into #settings-root.
//   Your data - Back up, Restore, Export transactions CSV, Import rules, Erase all data
//   Appearance - four themes, Auto / Light / Dark, Text size
//   Region and tax - Currency and a read-only tax tables row (no Tax year setting, FT-R-86)
//   Setup - Run setup again, Saving model (opens Plan)
//   About - Install, Privacy, Licence, Version, Fair Work pay calculator
// Plan holds money; this is housekeeping only. Every string comes from en-d.js and goes in as
// textContent. The rows themselves come from settings-model.js (pure, tested).

import { store } from '../state/store.js';
import { t } from '../i18n/strings.js';
import { showToast } from './toast.js';
import { openSheet } from './sheet.js';
import { showTab } from './tabs.js';
import { updateDataAndUI } from './render.js';
import {
    buildSettings, filterSettings, countRows, textSizeId, textSizePx, parseKeywords, CURRENCIES,
} from './settings-model.js';
import { readAppearance, applyAppearance, applyTextSize, applyStoredAppearance, renderPaletteSwatches } from '../theme/theme.js';
import { MODES } from '../theme/palettes.js';
import { actionExportDataJSON, actionExportTransactionsCSV, handleJSONImport, undoRestoreNow } from '../events/import-export.js';
import { confirmDialog } from './confirm.js';
import { restoreCopyInfo } from '../state/backup.js';
import { addUndoRestoreRow } from './restore-copy-row.js';
import { eraseAllData } from '../events/settings-events.js';
import { openTaxDetailsSheet } from './income-other.js';
import { canInstall, promptInstall } from '../pwa.js';
import { mountHelpButton } from './help.js'; // A11

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

let root = null;
let query = '';
let restoreCopy = null; // U3: {id, timestamp} while a pre-restore copy exists, else null

function save() { if (store.autoSave) store.autoSave.onDataChange(); }

// Tiny DOM helper: every string is textContent, never innerHTML.
function el(tag, cls, text, attrs) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
    return n;
}

function icon(id, cls = 'i') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
}

// ---------- the actions ----------

function runSetupAgain() {
    // C7 listens for this and opens the full-screen setup in #setup-root (FT-R-69).
    const ev = new CustomEvent('ledger:run-setup', { cancelable: true });
    document.dispatchEvent(ev);
    if (!ev.defaultPrevented) showToast(t('d.settings.setup.soon'), 'info');
}

function openRulesSheet() {
    const cats = Array.isArray(store.financeData.categories) ? store.financeData.categories : [];
    if (!cats.length) { showToast(t('d.settings.rules.empty'), 'info'); return; }
    const fields = cats.map((c, i) => ({
        key: 'kw' + i, label: String(c.name || c.id || ''), type: 'text', hint: i === 0 ? t('d.settings.rules.fieldHint') : undefined,
    }));
    const values = {};
    cats.forEach((c, i) => { values['kw' + i] = Array.isArray(c.keywords) ? c.keywords.join(', ') : ''; });
    openSheet({
        title: t('d.settings.rules.title'), fields, values,
        onSave(v) {
            cats.forEach((c, i) => { c.keywords = parseKeywords(v['kw' + i]); });
            updateDataAndUI();
            renderList();
            showToast(t('d.settings.rules.saved'), 'success');
        },
    });
}

function chooseAppearance(change) {
    const g = store.guiSettingsData;
    const a = applyAppearance({ ...readAppearance(g), ...change });
    g.theme = a.palette;
    g.colorMode = a.mode;
    save();
    renderList();
}

function chooseTextSize(id) {
    store.guiSettingsData.baseFontSize = String(textSizePx(id));
    applyTextSize(store.guiSettingsData);
    save();
    renderList();
}

function chooseCurrency(code) {
    store.financeData.currency = code;
    updateDataAndUI();
    showToast(t('d.settings.currency.changed', { code }), 'success');
}

// U3: look for the pre-restore copy; the row shows only while one exists.
async function refreshRestoreCopy() {
    const info = await restoreCopyInfo({ storage: localStorage });
    const changed = (info && info.id) !== (restoreCopy && restoreCopy.id);
    restoreCopy = info;
    if (changed) renderList();
}

async function undoRestoreFromRow() {
    const yes = await confirmDialog({
        title: t('d.undo.confirmTitle'), body: t('d.undo.confirmBody'), confirmLabel: t('d.undo.confirmLabel'), danger: true,
    });
    if (!yes) return;
    await undoRestoreNow();
    await refreshRestoreCopy();
}

const ACTIONS = {
    undorestore: undoRestoreFromRow,
    backup: () => actionExportDataJSON(),
    restore: () => { const f = root && root.querySelector('#json-import-gui'); if (f) f.click(); },
    export: () => actionExportTransactionsCSV(),
    rules: openRulesSheet,
    erase: () => eraseAllData(),
    setup: runSetupAgain,
    model: () => showTab('plan'),
    taxdetails: () => openTaxDetailsSheet(),
    install: () => promptInstall(),
};

// ---------- rendering ----------

function rowBody(r) {
    const left = el('span', 'n-wrap');
    left.appendChild(el('span', 'n', r.label));
    if (r.hint) left.appendChild(el('span', 'd', ' · ' + r.hint));
    return left;
}

function valueCell(r) {
    if (!r.value) return null;
    const v = el('span', 'v' + (r.status === 'ok' ? ' ok' : (r.status ? ' warn' : '')), r.value);
    if (r.status === 'ok') v.prepend(icon('i-check'));
    return v;
}

function buildRow(r) {
    const li = el('li');
    li.dataset.row = r.id;
    if (r.kind === 'action' || (r.kind === 'info' && r.detail)) {
        const b = el('button', 's-row' + (r.quiet ? ' quiet' : ''));
        b.type = 'button';
        b.dataset.sAct = r.id;
        b.append(rowBody(r));
        const v = valueCell(r);
        if (v) b.appendChild(v);
        b.appendChild(icon('i-chev', 'i chev'));
        if (r.detail) {
            b.setAttribute('aria-expanded', 'false');
            const d = el('p', 's-detail', r.detail);
            d.id = 's-detail-' + r.id;
            d.hidden = true;
            b.setAttribute('aria-controls', d.id);
            li.append(b, d);
        } else {
            li.appendChild(b);
        }
    } else if (r.kind === 'link') {
        const a = el('a', 's-row', null, { href: r.href, target: '_blank', rel: 'noopener noreferrer' });
        a.append(rowBody(r));
        const v = valueCell(r);
        if (v) a.appendChild(v);
        a.appendChild(icon('i-chev', 'i chev'));
        li.appendChild(a);
    } else if (r.kind === 'currency') {
        const wrap = el('div', 's-row s-static');
        const id = 's-currency';
        const lab = el('label', 'n-wrap', null, { for: id });
        lab.append(el('span', 'n', r.label), el('span', 'd', ' · ' + r.hint));
        const sel = el('select', 's-select', null, { id, 'aria-label': r.label });
        const cur = store.financeData.currency || 'AUD';
        for (const [code, name] of CURRENCIES) {
            const o = el('option', '', `${code} - ${name}`);
            o.value = code;
            if (code === cur) o.selected = true;
            sel.appendChild(o);
        }
        wrap.append(lab, sel);
        li.appendChild(wrap);
    } else {
        const wrap = el('div', 's-row s-static');
        wrap.appendChild(rowBody(r));
        const v = valueCell(r);
        if (v) wrap.appendChild(v);
        li.appendChild(wrap);
    }
    return li;
}

function buildThemeBlock(r) {
    const a = readAppearance(store.guiSettingsData);
    const box = el('div', 's-set');
    const hd = el('div', 'hd');
    hd.append(el('span', 'n', r.label), el('span', 'd', r.hint));
    const sw = el('div', 'theme-switcher', null, { 'aria-label': r.label });
    renderPaletteSwatches(sw, a);
    box.append(hd, sw);
    return box;
}

function segBlock(r, options, current, kind) {
    const wrap = el('div', 's-inline');
    const lab = el('div');
    const labId = 's-l-' + r.id;
    const n = el('div', 'n', r.label);
    n.id = labId;
    lab.append(n, el('div', 'd', r.hint));
    const seg = el('div', 'seg', null, { role: 'group', 'aria-labelledby': labId });
    for (const o of options) {
        const b = el('button');
        b.type = 'button';
        b.dataset[kind] = o.value;
        b.setAttribute('aria-pressed', o.value === current ? 'true' : 'false');
        if (o.aa) {
            b.append(el('span', 's-size s-size-' + o.value, 'Aa'), el('span', 'sr', ' ' + o.label));
        } else {
            b.textContent = o.label;
        }
        seg.appendChild(b);
    }
    wrap.append(lab, seg);
    return wrap;
}

function buildAppearanceRows(grp) {
    const nodes = [];
    const a = readAppearance(store.guiSettingsData);
    for (const r of grp.rows) {
        if (r.kind === 'theme') nodes.push(buildThemeBlock(r));
        else if (r.kind === 'mode') {
            nodes.push(segBlock(r, MODES.map((m) => ({ value: m, label: t('d.settings.mode.' + m) })), a.mode, 'mode'));
        } else if (r.kind === 'size') {
            const sizes = ['standard', 'large', 'larger'].map((id) => ({ value: id, label: t('d.settings.size.' + id), aa: true }));
            nodes.push(segBlock(r, sizes, textSizeId(store.guiSettingsData.baseFontSize), 'size'));
        }
    }
    return nodes;
}

function renderList() {
    const host = root && root.querySelector('#settings-list');
    if (!host) return;
    const all = addUndoRestoreRow(buildSettings({
        financeData: store.financeData, now: new Date(), installAvailable: canInstall(), version: VERSION,
    }), restoreCopy);
    const groups = filterSettings(all, query);
    // Keep focus on the same control across a re-render.
    const active = document.activeElement;
    const keep = active && host.contains(active)
        ? (active.dataset.sAct ? `[data-s-act="${active.dataset.sAct}"]` : (active.dataset.mode ? `[data-mode="${active.dataset.mode}"]` : (active.dataset.size ? `[data-size="${active.dataset.size}"]` : (active.dataset.palette ? `[data-palette="${active.dataset.palette}"]` : null))))
        : null;
    host.replaceChildren();
    for (const grp of groups) {
        const sec = el('section', 's-group', null, { 'aria-labelledby': 'g-' + grp.id });
        const label = el('div', 's-label');
        const h = el('h2', '', grp.title);
        h.id = 'g-' + grp.id;
        label.append(h, el('p', '', grp.hint));
        const card = el('div', 'card s-card');
        if (grp.id === 'look') {
            buildAppearanceRows(grp).forEach((n) => card.appendChild(n));
        } else {
            const ul = el('ul', 's-list');
            grp.rows.forEach((r) => ul.appendChild(buildRow(r)));
            card.appendChild(ul);
        }
        sec.append(label, card);
        host.appendChild(sec);
    }
    const status = root.querySelector('#settings-status');
    if (status) {
        status.textContent = query.trim()
            ? (groups.length ? t('d.settings.found', { count: countRows(groups) }) : t('d.settings.noMatch', { query: query.trim() }))
            : '';
        status.classList.toggle('s-empty', !!query.trim() && !groups.length);
    }
    if (keep) { const n = host.querySelector(keep); if (n) n.focus(); }
}

function buildShell() {
    root.replaceChildren();
    const title = el('div', 'title-row');
    const left = el('div');
    const h1 = el('h1', '', t('d.settings.title'));
    h1.id = 'settings-title';
    h1.tabIndex = -1;
    left.append(h1, el('p', '', t('d.settings.lede')));
    title.appendChild(left);
    mountHelpButton('settings', title); // A11

    const wrap = el('div', 's-wrap');
    const find = el('label', 's-find');
    find.append(icon('i-search'), el('span', 'sr', t('d.settings.searchLabel')));
    const input = el('input', '', null, { type: 'search', placeholder: t('d.settings.searchPlaceholder'), autocomplete: 'off', enterkeyhint: 'search' });
    input.id = 'settings-search';
    find.appendChild(input);
    const status = el('p', 's-status', null, { role: 'status', 'aria-live': 'polite' });
    status.id = 'settings-status';
    const list = el('div');
    list.id = 'settings-list';
    const file = el('input', '', null, { type: 'file', accept: '.json,application/json', hidden: '' });
    file.id = 'json-import-gui';
    wrap.append(find, status, list, file);
    root.append(title, wrap);
}

// ---------- open / close ----------

/** Settings is not a tab: mark its sidebar link current while open, clear it when any tab is shown. */
function markSettingsCurrent(on) {
    document.querySelectorAll('.side-settings').forEach((b) => {
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
}

export function isSettingsOpen() { return !!root && root.classList.contains('active'); }

/** Show the Settings screen in place of the current tab. Any tab tap shows that tab again (showTab). */
export function openSettings() {
    if (!root) return;
    query = '';
    refreshRestoreCopy();
    const input = root.querySelector('#settings-search');
    if (input) input.value = '';
    renderList();
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s === root));
    document.querySelectorAll('[role="tablist"] [role="tab"]').forEach((tab) => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
        tab.removeAttribute('aria-current');
    });
    markSettingsCurrent(true);
    window.scrollTo({ top: 0 });
    const h1 = root.querySelector('#settings-title');
    if (h1) h1.focus();
}

export function setupSettingsScreen() {
    root = document.getElementById('settings-root');
    if (!root) return;
    applyStoredAppearance();
    buildShell();
    renderList();

    root.addEventListener('input', (e) => {
        if (e.target.id !== 'settings-search') return;
        query = e.target.value;
        renderList();
    });
    root.addEventListener('change', (e) => {
        if (e.target.id === 's-currency') chooseCurrency(e.target.value);
        else if (e.target.id === 'json-import-gui') handleJSONImport(e);
    });
    root.addEventListener('click', (e) => {
        const act = e.target.closest('[data-s-act]');
        if (act) {
            const id = act.dataset.sAct;
            if (ACTIONS[id]) { ACTIONS[id](); return; }
            // an info row with detail: open or close it
            const d = root.querySelector('#s-detail-' + id);
            if (d) {
                const open = act.getAttribute('aria-expanded') === 'true';
                act.setAttribute('aria-expanded', open ? 'false' : 'true');
                d.hidden = open;
            }
            return;
        }
        const sw = e.target.closest('.theme-swatch');
        if (sw) { chooseAppearance({ palette: sw.dataset.palette }); return; }
        const mode = e.target.closest('.seg [data-mode]'); // not bare [data-mode]: <html> carries that attribute
        if (mode && MODES.includes(mode.dataset.mode)) { chooseAppearance({ mode: mode.dataset.mode }); return; }
        const size = e.target.closest('[data-size]');
        if (size) chooseTextSize(size.dataset.size);
    });
    // Escape in the search field clears it.
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && e.target.id === 'settings-search' && e.target.value) {
            e.target.value = ''; query = ''; renderList();
        }
    });

    // Re-render when the data changed under us (restore, erase) or the install prompt arrived.
    document.addEventListener('ledger:data-swapped', () => { applyStoredAppearance(); renderList(); });
    document.addEventListener('ledger:install-availability', () => renderList());
    document.addEventListener('ledger:restore-copy-changed', () => { refreshRestoreCopy(); });
    refreshRestoreCopy();
}
