// What If screen: the shell, Ask and Adjust (owner: F7, M-14, FT-R-33, FT-R-43). Opens inside #future
// (F6's saved-scenarios list calls `openScenario(id)`), hides the Future content while open and gives
// it back on "Future". Two views, Simple and Compare; Simple has three steps, Ask, Adjust and Answer.
// Every view has step buttons so there is always a way back into the steps (FT-R-43).
//
// The Answer and Compare content belong to F8a and F8b: they call `registerScenarioView('answer' | 'compare', fn)`
// with fn(container, {scenario, data, today}); until then those regions show a short placeholder.
// Everything user-visible is set as text; scenario names, notes and target names are never markup.

import { t, plural } from '../../i18n/strings.js';
import { store } from '../../state/store.js';
import {
    getScenario, saveScenario, newScenario, duplicateScenario, renameScenario, pinScenario, archiveScenario,
} from '../../state/scenarios.js';
import { missingTargets } from '../../calc/scenario.js';
import { openSheet } from '../sheet.js';
import { showToast, showUndoToast } from '../toast.js';
import { showTab } from '../tabs.js';
import { refreshTab } from '../render.js';
import { STARTERS, starterSpec, starterTitle } from './starters.js';
import { renderChangeList, editSpecFor, resolveConflict, groupOf } from './change-list.js';

export const VIEWS = ['simple', 'compare'];
export const STEPS = ['ask', 'adjust', 'answer'];
const HOW_KEY = 'whatIfHowSeen';
const ROOT_ID = 'scenario-root';

let ui = null; // { root, scenario, saved, view, step }
const renderers = {};

/**
 * F8a and F8b fill the Answer and Compare regions through this. More than one view can fill a region (F8a draws the
 * top of the Answer, F8b the bottom): they draw in `order` (default 0, then registration order), each into its own box.
 * Registering the same function again replaces it; a null function clears the region.
 */
export function registerScenarioView(name, fn, { order = 0 } = {}) {
    if (name !== 'answer' && name !== 'compare' && name !== 'make-real') return; // 'make-real' is the slot in the Compare step bar (F8b)
    if (typeof fn !== 'function') renderers[name] = [];
    else {
        const list = (renderers[name] || []).filter((r) => r.fn !== fn);
        list.push({ fn, order });
        renderers[name] = list.map((r, i) => ({ ...r, i })).sort((a, b) => a.order - b.order || a.i - b.i);
    }
    if (ui) render();
}

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}
function btn(label, act, extra = {}) {
    const b = el('button', extra.cls || 'btn', label);
    b.type = 'button';
    b.dataset.act = act;
    for (const [k, v] of Object.entries(extra.data || {})) b.dataset[k] = v;
    if (extra.pressed !== undefined) b.setAttribute('aria-pressed', String(extra.pressed));
    return b;
}

// ---------- the how-it-works strip: the Got it is remembered in the settings store ----------

export function howSeen() {
    return !!(store.guiSettingsData && store.guiSettingsData[HOW_KEY]);
}
function rememberHow() {
    if (!store.guiSettingsData) return;
    store.guiSettingsData[HOW_KEY] = true;
    if (store.autoSave) store.autoSave.onDataChange();
}

// ---------- open and close ----------

function rootEl() {
    const future = document.getElementById('future');
    if (!future) return null;
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = el('div', 'wi');
        root.id = ROOT_ID;
        future.appendChild(root);
        root.addEventListener('click', onClick);
    }
    return root;
}

/**
 * Open the What If screen on a saved scenario, or a new one when `id` is empty.
 * `step` ('ask', 'adjust' or 'answer') picks the step to land on; Plan for this passes 'answer'.
 * @returns {boolean} true once the screen is showing (the scenario itself loads a moment later).
 */
export function openScenario(id, { step = null } = {}) {
    const root = rootEl();
    if (!root) return false;
    showTab('future');
    document.getElementById('future').classList.add('scenario-open');
    ui = { root, scenario: null, saved: false, view: 'simple', step: 'ask' };
    if (id == null || id === '' || id === 'new') {
        ui.scenario = newScenario({ name: '' });
        render();
        return true;
    }
    render();
    getScenario(String(id)).then((row) => {
        if (!ui || ui.root !== root) return;
        if (!row) { showToast(t('f.wi.notFound'), 'error'); closeScenario(); return; }
        ui.scenario = row;
        ui.saved = true;
        ui.step = STEPS.includes(step) ? step : (row.changes.length ? 'adjust' : 'ask');
        render();
    }).catch((err) => {
        console.error('scenario load failed', err);
        showToast(t('f.wi.loadFailed'), 'error');
        closeScenario();
    });
    return true;
}

export function closeScenario() {
    const future = document.getElementById('future');
    if (future) future.classList.remove('scenario-open');
    if (ui && ui.root) ui.root.textContent = '';
    ui = null;
    refreshTab('future');
}

export function isScenarioOpen() { return !!ui; }

// ---------- saving ----------

async function persist() {
    try {
        const res = await saveScenario(ui.scenario);
        if (res.ok) { ui.scenario = res.scenario; ui.saved = true; }
        if (res.dropped) showToast(plural(res.dropped, 'f.wi.dropped.one', 'f.wi.dropped'), 'error');
        return res.ok;
    } catch (err) {
        console.error('scenario save failed', err);
        showToast(t('f.wi.saveFailed'), 'error');
        return false;
    }
}

function setChanges(next) {
    // A change that is edited is a new thing to apply: its made-real mark goes (G6W15-5).
    const old = new Map(ui.scenario.changes.map((c) => [c.id, JSON.stringify(c)]));
    const marks = {};
    for (const c of next) if (ui.scenario.madeReal && ui.scenario.madeReal[c.id] && old.get(c.id) === JSON.stringify(c)) marks[c.id] = ui.scenario.madeReal[c.id];
    ui.scenario = { ...ui.scenario, changes: next, madeReal: marks };
}

/** Make this real records (or clears) its marks on the open scenario and saves it. Returns the scenario now open, or null. */
export async function updateOpenScenario(fn) {
    if (!ui || !ui.scenario) return null;
    ui.scenario = fn(ui.scenario);
    await persist();
    return ui ? ui.scenario : null;
}

// ---------- rendering ----------

const dataNow = () => store.financeData;

function render() {
    if (!ui) return;
    const { root } = ui;
    root.textContent = '';
    const sc = ui.scenario;
    if (!sc) { root.appendChild(el('p', 'muted', t('f.wi.loading'))); return; }

    const crumb = el('p', 'crumb');
    const back = btn(t('f.wi.back'), 'close', { cls: 'link wi-back' });
    crumb.appendChild(back);

    const head = el('div', 'title-row');
    const left = el('div');
    left.appendChild(el('h1', '', t('f.wi.title')));
    const line = el('p', 'scen-name');
    line.appendChild(el('i', 'scen-dot'));
    line.lastChild.setAttribute('aria-hidden', 'true');
    line.appendChild(el('b', '', sc.name || t('f.wi.untitled')));
    line.appendChild(document.createTextNode(` · ${ui.saved ? t('f.wi.saved') : t('f.wi.notSaved')} · ${t('f.wi.realStays')}`));
    left.appendChild(line);
    const seg = el('div', 'seg view-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', t('f.wi.view'));
    for (const v of VIEWS) seg.appendChild(btn(t(`f.wi.view.${v}`), 'view', { cls: '', data: { view: v }, pressed: ui.view === v }));
    head.append(left, seg);

    const tools = el('div', 'wi-tools');
    tools.append(
        btn(t('f.wi.rename'), 'rename', { cls: 'btn sm' }),
        btn(t('f.wi.duplicate'), 'duplicate', { cls: 'btn sm' }),
        btn(sc.pinned ? t('f.wi.pinned') : t('f.wi.pin'), 'pin', { cls: 'btn sm', pressed: !!sc.pinned }),
        btn(t('f.wi.archive'), 'archive', { cls: 'btn sm' }),
    );

    root.append(crumb, head, tools);
    if (!howSeen()) root.appendChild(howStrip());

    const body = el('div', 'wi-body');
    if (ui.view === 'simple') body.append(stepper(), stepPanel());
    else body.appendChild(comparePanel());
    root.appendChild(body);
}

function howStrip() {
    const s = el('section', 'how');
    s.setAttribute('aria-labelledby', 'wi-how-h');
    const d = el('div');
    const h = el('h2', '', t('f.wi.how.title'));
    h.id = 'wi-how-h';
    const ol = el('ol');
    for (const k of ['1', '2', '3']) ol.appendChild(el('li', '', t(`f.wi.how.${k}`)));
    d.append(h, ol);
    s.append(d, btn(t('f.wi.how.gotIt'), 'how-close', { cls: 'btn sm' }));
    return s;
}

function stepper() {
    const ol = el('ol', 'stepper');
    ol.setAttribute('aria-label', t('f.wi.steps'));
    const sub = { ask: t('f.wi.step.ask.sub'), adjust: plural(ui.scenario.changes.length, 'f.wi.step.adjust.sub.one', 'f.wi.step.adjust.sub'), answer: t('f.wi.step.answer.sub') };
    STEPS.forEach((s, i) => {
        const li = el('li');
        const b = el('button');
        b.type = 'button';
        b.dataset.act = 'step';
        b.dataset.step = s;
        b.setAttribute('aria-current', ui.step === s ? 'step' : 'false');
        const n = el('span', 'sn', String(i + 1));
        const txt = el('span');
        txt.append(el('b', '', t(`f.wi.step.${s}`)), el('span', '', sub[s]));
        b.append(n, txt);
        li.appendChild(b);
        ol.appendChild(li);
    });
    return ol;
}

function stepNav(prev, next, extra) {
    const nav = el('div', 'step-nav');
    if (prev) nav.appendChild(btn(`‹ ${t('f.wi.nav.back', { step: t(`f.wi.step.${prev}`) })}`, 'step', { data: { step: prev } }));
    else nav.appendChild(el('span', 'muted', extra || ''));
    if (next) nav.appendChild(btn(t('f.wi.nav.next', { step: t(`f.wi.step.${next}`) }), 'step', { cls: 'btn btn-primary', data: { step: next } }));
    return nav;
}

function stepPanel() {
    const sc = ui.scenario;
    const panel = el('section', 'step-panel');
    const card = el('div', 'card');
    if (ui.step === 'ask') {
        const h = el('h2', '', t('f.wi.ask.title'));
        h.tabIndex = -1; h.dataset.focus = '1';
        const hd = el('div', 'card-head'); hd.appendChild(h);
        card.append(hd, el('p', 'muted lead2', t('f.wi.ask.lead')));
        const ul = el('ul', 'starters');
        for (const s of STARTERS) {
            const li = el('li');
            const b = el('button');
            b.type = 'button'; b.dataset.act = 'starter'; b.dataset.starter = s.id;
            if (sc.presetId === s.id) b.setAttribute('aria-pressed', 'true');
            b.append(el('b', '', t(s.titleKey)), el('span', '', t(s.hintKey)));
            li.appendChild(b);
            ul.appendChild(li);
        }
        card.append(ul, el('p', 'muted wi-later', t('f.wi.ask.later')));
        card.appendChild(stepNav(null, 'adjust', sc.presetId ? t('f.wi.startedFrom', { name: starterTitle(sc.presetId) }) : ''));
    } else if (ui.step === 'adjust') {
        const h = el('h2', '', t('f.wi.adjust.title'));
        h.tabIndex = -1; h.dataset.focus = '1';
        const hd = el('div', 'card-head'); hd.appendChild(h);
        card.appendChild(hd);
        const data = dataNow();
        const problems = missingTargets(data, sc.changes).length;
        if (!sc.changes.length) card.appendChild(el('p', 'muted', t('f.wi.adjust.empty')));
        else {
            const ol = el('ol', 'changes wi-changes');
            ol.setAttribute('aria-label', t('f.wi.adjust.list'));
            renderChangeList(ol, data, sc.changes);
            card.appendChild(ol);
            if (problems) card.appendChild(el('p', 'muted', plural(problems, 'f.wi.adjust.gone.one', 'f.wi.adjust.gone')));
        }
        const add = btn(t('f.wi.adjust.add'), 'add', { cls: 'btn add-ch' });
        card.append(add, stepNav('ask', 'answer'));
    } else {
        const h = el('h2', 'sr', t('f.wi.step.answer'));
        h.tabIndex = -1; h.dataset.focus = '1';
        card.appendChild(h);
        card.appendChild(hookRegion('answer'));
        card.appendChild(stepNav('adjust', null));
        const nav = card.lastChild;
        nav.appendChild(btn(t('f.wi.nav.compare'), 'view', { cls: 'btn btn-primary', data: { view: 'compare' } }));
    }
    panel.appendChild(card);
    return panel;
}

function hookRegion(name) {
    const box = el('div', 'wi-hook');
    box.dataset.hook = name;
    const list = renderers[name] || [];
    if (list.length) {
        for (const { fn } of list) {
            const part = el('div', 'wi-part');
            box.appendChild(part);
            try { fn(part, { scenario: ui.scenario, data: dataNow(), today: todayIso() }); } catch (err) { console.error(`scenario ${name} view failed`, err); part.textContent = t('f.wi.viewFailed'); }
        }
    } else box.appendChild(el('p', 'muted', t(`f.wi.hook.${name}`)));
    return box;
}

function comparePanel() {
    const card = el('section', 'card wi-compare');
    const hd = el('div', 'card-head');
    const h = el('h2', '', t('f.wi.view.compare'));
    h.tabIndex = -1; h.dataset.focus = '1';
    hd.appendChild(h);
    card.append(hd, hookRegion('compare'));
    const nav = el('div', 'step-nav');
    nav.appendChild(btn(`‹ ${t('f.wi.nav.back', { step: t('f.wi.step.answer') })}`, 'back-answer'));
    const acts = el('span', 'sn-acts');
    acts.appendChild(btn(t('f.wi.nav.change'), 'back-adjust'));
    const slot = el('span');
    slot.dataset.hook = 'make-real'; // F8b's Make this real button
    for (const { fn } of renderers['make-real'] || []) {
        try { fn(slot, { scenario: ui.scenario, data: dataNow(), today: todayIso() }); } catch (err) { console.error('scenario make-real view failed', err); }
    }
    acts.appendChild(slot);
    nav.appendChild(acts);
    card.appendChild(nav);
    return card;
}

// ---------- actions ----------

function focusHeading() {
    const h = ui && ui.root.querySelector('[data-focus]');
    if (h) h.focus({ preventScroll: true });
}

function go(step) {
    ui.view = 'simple';
    ui.step = STEPS.includes(step) ? step : 'ask';
    render();
    focusHeading();
}

function onClick(e) {
    const a = e.target.closest('[data-act]');
    if (!a || !ui || !ui.root.contains(a)) return;
    const act = a.dataset.act;
    const id = a.dataset.id;
    switch (act) {
        case 'close': closeScenario(); break;
        case 'view': ui.view = VIEWS.includes(a.dataset.view) ? a.dataset.view : 'simple'; render(); focusHeading(); break;
        case 'step': go(a.dataset.step); break;
        case 'back-answer': go('answer'); break;
        case 'back-adjust': go('adjust'); break;
        case 'how-close': rememberHow(); render(); break;
        case 'starter': openStarter(a.dataset.starter); break;
        case 'add': go('ask'); break;
        case 'edit': editChange(id); break;
        case 'remove': removeChange(id); break;
        case 'keep': case 'update': fixConflict(id, act); break;
        case 'rename': renameDialog(); break;
        case 'duplicate': duplicate(); break;
        case 'pin': togglePin(); break;
        case 'archive': archive(); break;
        default: break;
    }
}

function selectsEmpty(spec) {
    return spec.fields.some((f) => f.type === 'select' && f.required && Array.isArray(f.options) && !f.options.length);
}

function openSpec(spec, { starterId = null } = {}) {
    openSheet({
        title: spec.title, fields: spec.fields, values: spec.values, validate: spec.validate,
        saveLabel: t('f.wi.sheet.save'),
        async onSave(values) {
            const built = spec.build(values);
            if (!built.length) return false;
            const replaces = new Set(spec.replaces || []);
            const cur = ui.scenario.changes;
            const at = cur.findIndex((c) => replaces.has(c.id));
            const kept = cur.filter((c) => !replaces.has(c.id));
            kept.splice(at < 0 ? kept.length : at, 0, ...built);
            const before = ui.scenario;
            setChanges(kept);
            if (starterId) {
                if (!ui.scenario.presetId) ui.scenario = { ...ui.scenario, presetId: starterId };
                if (!ui.scenario.name) ui.scenario = { ...ui.scenario, name: starterTitle(starterId) };
            }
            if (!(await persist())) { ui.scenario = before; return false; }
            ui.step = 'adjust';
            render();
            focusHeading();
            return true;
        },
    });
}

function openStarter(id) {
    const spec = starterSpec(id, dataNow(), { today: todayIso(), changes: ui.scenario.changes, existing: null });
    if (!spec) return;
    if (selectsEmpty(spec)) { showToast(t('f.wi.starter.empty'), 'info'); return; }
    openSpec(spec, { starterId: id });
}

function editChange(id) {
    const c = ui.scenario.changes.find((x) => x.id === id);
    if (!c) return;
    openSpec(editSpecFor(dataNow(), c, ui.scenario.changes, { today: todayIso() }));
}

function removeChange(id) {
    const cur = ui.scenario.changes;
    const c = cur.find((x) => x.id === id);
    if (!c) return;
    const group = groupOf(cur, c);
    const ids = new Set(group.map((g) => g.id));
    const index = cur.findIndex((x) => ids.has(x.id));
    const before = ui.scenario;
    setChanges(cur.filter((x) => !ids.has(x.id)));
    persist().then((ok) => {
        if (!ok) { ui.scenario = before; render(); return; }
        render();
        showUndoToast({
            message: t('f.wi.removed'),
            onUndo() {
                if (!ui || ui.scenario.id !== before.id) return;
                const next = ui.scenario.changes.slice();
                next.splice(Math.min(index, next.length), 0, ...group);
                setChanges(next);
                persist().then(() => { if (ui) render(); });
            },
        });
    });
}

function fixConflict(id, how) {
    const cur = ui.scenario.changes;
    const next = cur.map((c) => (c.id === id ? resolveConflict(dataNow(), c, how) : c));
    setChanges(next);
    persist().then(() => render());
}

// ---------- the header tools ----------

async function ensureSaved() {
    return ui.saved ? true : persist();
}

function renameDialog() {
    openSheet({
        title: t('f.wi.rename'),
        fields: [{ key: 'name', label: t('f.wi.rename.label'), type: 'text', required: true }],
        values: { name: ui.scenario.name || '' },
        validate: (v) => (String(v.name || '').trim() ? {} : { name: t('f.wi.err.name') }),
        async onSave(v) {
            const name = String(v.name).trim();
            ui.scenario = { ...ui.scenario, name };
            if (!(await ensureSaved())) return false;
            const res = await renameScenario(ui.scenario.id, name);
            if (res.ok) ui.scenario = res.scenario;
            render();
            return true;
        },
    });
}

async function duplicate() {
    if (!(await ensureSaved())) return;
    const res = await duplicateScenario(ui.scenario.id);
    if (!res.ok) { showToast(t('f.wi.saveFailed'), 'error'); return; }
    showToast(t('f.wi.duplicated', { name: res.scenario.name }), 'info');
    ui.scenario = res.scenario;
    ui.saved = true;
    render();
}

async function togglePin() {
    if (!(await ensureSaved())) return;
    const res = await pinScenario(ui.scenario.id, !ui.scenario.pinned);
    if (res.ok) ui.scenario = res.scenario;
    render();
}

async function archive() {
    if (!(await ensureSaved())) return;
    const id = ui.scenario.id;
    const res = await archiveScenario(id, true);
    if (!res.ok) { showToast(t('f.wi.saveFailed'), 'error'); return; }
    closeScenario();
    showUndoToast({ message: t('f.wi.archived'), onUndo() { archiveScenario(id, false).then(() => { const f = document.getElementById('future'); if (f) refreshTab('future'); }); } });
}
