// Future screen (F6): the DOM side. Renders the model from model.js through view.js into #future-root, wires
// the horizon toggle, the "On chart" switches, the Assumptions and Explain sheets and the debt sheet, and loads
// the saved scenarios (IndexedDB, async) without holding the first paint back. Data edits go through openSheet
// with an Undo toast and `updateDataAndUI`.

import './future.css'; // F6 — Future screen
import '../scenario/results.js'; // F8b — registers the Answer bottom, Compare and Make this real views
import '../scenario/answer-top.js'; // F8a — registers the Answer view
import { t } from '../../i18n/strings.js';
import { store } from '../../state/store.js';
import { explainFi } from '../../calc/fi.js';
import { listScenarios, saveScenario, newScenario } from '../../state/scenarios.js';
import { openSheet } from '../sheet.js';
import { showToast, showUndoToast } from '../toast.js';
import { updateDataAndUI } from '../render.js';
import { openScenario } from '../scenario/index.js';
import { debtAssetSheetSpec, saveDebtAsset, deleteDebtAsset } from '../plan-lists.js';
import {
    futureModel, chartIds, withPeople, peopleSlots, assumptionValues, validateAssumptions, applyAssumptions, restoreAssumptions,
    HORIZONS, DEFAULT_HORIZON, MAX_ON_CHART,
} from './model.js';
import { buildFutureHtml, whatIfButtonHtml } from './view.js';

const HORIZON_KEY = 'ft-future-horizon';
const CHART_KEY = 'ft-future-chart';

const state = { horizon: null, onChart: null, scenarios: null, showArchived: false, lastModel: null, loadToken: 0, lastRows: '' };

const localIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- per-viewer conveniences (the horizon and which scenarios are drawn); the screen works without them ----------

function readPref(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
    } catch (err) {
        console.warn('future pref unreadable', key, err);
        return fallback;
    }
}

function writePref(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { console.warn('future pref not saved', key, err); }
}

function horizon() {
    if (state.horizon == null) { const h = readPref(HORIZON_KEY, DEFAULT_HORIZON); state.horizon = HORIZONS.includes(h) ? h : DEFAULT_HORIZON; }
    return state.horizon;
}

function onChart() {
    if (state.onChart == null) { const c = readPref(CHART_KEY, []); state.onChart = Array.isArray(c) ? c.filter((x) => typeof x === 'string').slice(0, MAX_ON_CHART) : []; }
    return state.onChart;
}

// ---------- painting ----------

function ensureRoot() {
    const screen = document.getElementById('future');
    if (!screen) return null;
    let root = document.getElementById('future-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'future-root';
        root.className = 'fu-root';
        const anchor = document.getElementById('future-income-pattern') || screen.querySelector('.title-row');
        if (anchor) anchor.insertAdjacentElement('afterend', root); else screen.prepend(root);
        root.addEventListener('click', onClick);
        const title = screen.querySelector('.title-row');
        if (title && !title.querySelector('.fu-whatif')) {
            title.insertAdjacentHTML('beforeend', whatIfButtonHtml());
            title.querySelector('.fu-whatif').addEventListener('click', () => startNewScenario());
        }
        // A tab that was not re-rendered (nothing dirty) still needs the latest saved scenarios when it is shown again.
        document.addEventListener('click', (e) => {
            if (e.target.closest && e.target.closest('[data-tab-target="future"]')) loadScenarios(root, undefined);
        });
    }
    return root;
}

function focusKey(el) {
    if (!el || !el.dataset) return null;
    for (const k of Object.keys(el.dataset)) if (k.startsWith('fu')) return `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}${el.dataset[k] !== '1' && el.dataset[k] !== '' ? `="${CSS.escape(el.dataset[k])}"` : ''}]`;
    return null;
}

function paint(root, totals) {
    const active = root.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    try {
        const model = futureModel(store.financeData, { today: localIso(), horizon: horizon(), scenarios: state.scenarios || [], onChart: onChart(), totals });
        state.lastModel = model;
        root.innerHTML = buildFutureHtml(model, { loaded: state.scenarios !== null, showArchived: state.showArchived });
        root.removeAttribute('data-error');
    } catch (err) {
        console.error('future render failed', err);
        state.lastModel = null;
        root.textContent = t('f.future.error');
        root.dataset.error = '1';
        return;
    }
    if (active) { const again = root.querySelector(active); if (again) again.focus(); }
}

async function loadScenarios(root, totals) {
    const token = ++state.loadToken;
    let rows;
    try {
        rows = await listScenarios({ includeArchived: true });
    } catch (err) {
        console.warn('saved scenarios could not be read', err);
        rows = [];
    }
    if (token !== state.loadToken) return;
    const sig = JSON.stringify(rows);
    const same = state.scenarios !== null && sig === state.lastRows;
    state.lastRows = sig;
    state.scenarios = rows;
    const kept = chartIds(rows, onChart());
    if (kept.length !== onChart().length) { state.onChart = kept; writePref(CHART_KEY, kept); }
    if (!same && root.isConnected) paint(root, totals);
}

/** Called by future.js on every render of the Future tab. */
export function mountFuture(totals) {
    const root = ensureRoot();
    if (!root) return;
    paint(root, totals);
    loadScenarios(root, totals);
}

// ---------- events ----------

function repaint() {
    const root = document.getElementById('future-root');
    if (root) paint(root, undefined);
}

function onClick(e) {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    const d = b.dataset;
    if (d.fuHorizon) { state.horizon = Number(d.fuHorizon); writePref(HORIZON_KEY, state.horizon); repaint(); return; }
    if (d.fuChart) { toggleChart(d.fuChart); return; }
    if (d.fuOpen) { openScenario(d.fuOpen); return; }
    if (d.fuNew) { startNewScenario(); return; }
    if (d.fuArchived) { state.showArchived = !state.showArchived; repaint(); return; }
    if (d.fuExplain) { openExplain(); return; }
    if (d.fuAssume) { openAssumptions(); return; }
    if (d.fuDebt != null) openDebt(Number(d.fuDebt));
}

function toggleChart(id) {
    const cur = onChart();
    if (cur.includes(id)) state.onChart = cur.filter((x) => x !== id);
    else if (cur.length >= MAX_ON_CHART) { showToast(t('f.future.scen.maxChart', { n: MAX_ON_CHART })); return; }
    else state.onChart = [...cur, id];
    writePref(CHART_KEY, state.onChart);
    repaint();
}

async function startNewScenario() {
    const res = await saveScenario(newScenario({ name: t('f.future.scen.newName'), startedFrom: localIso() }));
    if (!res || !res.ok) { showToast(t('f.future.scen.newFailed')); return; }
    state.scenarios = null;
    const opened = openScenario(res.scenario.id);
    if (!opened) showToast(t('f.future.scen.created', { name: res.scenario.name }));
    const root = document.getElementById('future-root');
    if (root) { paint(root, undefined); loadScenarios(root, undefined); }
}

// ---------- sheets ----------

function openExplain() {
    const data = store.financeData;
    const lines = state.lastModel ? explainFi(withPeople(data), { summary: state.lastModel.summary }) : [];
    const content = lines.map((l) => { const p = document.createElement('p'); p.textContent = l.text; return p; });
    openSheet({ title: t('f.future.fi.explain'), readOnly: true, content });
}

function openAssumptions() {
    const data = store.financeData;
    const slots = peopleSlots(data);
    const fields = [
        { key: 'multiple', label: t('f.future.assume.multiple'), type: 'number', required: true, hint: t('f.future.assume.multipleHint') },
        { key: 'expectedReturn', label: t('f.future.assume.return'), type: 'percent', required: true, hint: t('f.future.assume.returnHint') },
        { key: 'inflation', label: t('f.future.assume.inflation'), type: 'percent', required: true },
        ...slots.map((p) => ({ key: `birthYear${p.index}`, label: p.name ? t('f.future.assume.birthNamed', { name: p.name }) : t('f.future.assume.birthN', { n: p.index + 1 }), type: 'number', hint: p.index === 0 ? t('f.future.assume.birthHint') : undefined })),
    ];
    openSheet({
        title: t('f.future.assumptions'), fields, values: assumptionValues(data),
        validate(v) {
            const errs = validateAssumptions(v, new Date().getFullYear());
            return Object.fromEntries(Object.entries(errs).map(([k, key]) => [k, t(key)]));
        },
        onSave(values) {
            const { before } = applyAssumptions(data, values);
            updateDataAndUI();
            showUndoToast({ message: t('f.future.assume.saved'), onUndo: () => { restoreAssumptions(data, before); updateDataAndUI(); } });
            return undefined;
        },
    });
}

function openDebt(index, carry = null) {
    const data = store.financeData;
    const row = (data.liabilities || [])[index];
    if (!row) return;
    const spec = debtAssetSheetSpec('debt', row, { today: localIso(), carry });
    const undo = (res) => showUndoToast({ message: res.message, onUndo: () => { res.onUndo(); updateDataAndUI(); }, onExpire: res.onExpire });
    const handle = openSheet({
        title: spec.title, fields: spec.fields, values: spec.values, validate: spec.validate, plausibility: spec.plausibility,
        onSave(values) {
            const res = saveDebtAsset(data, 'debt', index, values);
            if (!res.ok) return false;
            updateDataAndUI();
            undo(res);
            return undefined;
        },
        onDelete() {
            const res = deleteDebtAsset(data, 'debt', index);
            if (!res.ok) return;
            updateDataAndUI();
            undo(res);
        },
    });
    if (spec.reopenOn && spec.reopenOn.length && handle && handle.layer) {
        handle.layer.addEventListener('change', (ev) => {
            const k = ev.target && ev.target.dataset ? ev.target.dataset.key : null;
            if (k && spec.reopenOn.includes(k)) openDebt(index, handle.getValues());
        });
    }
}
