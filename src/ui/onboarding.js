// Setup shell (Phase 1 step C7; replaces the first-run onboarding modal). Full-screen setup in
// #setup-root (FT-R-69), driven by the step registry (src/ui/setup/registry.js): model, quiz, layout,
// pay, essentials, non-essentials, debts, split, transfers, first expense. Every step can be skipped.
// First run (no saved data, `ft-onboarded` not set) opens it with a welcome screen that keeps the
// "explore with sample data" path. Settings > Run setup again fires `ledger:run-setup`.
// `ft-onboarded` is still read, so nobody who finished or skipped the old onboarding sees setup again.

import { store } from '../state/store.js';
import { t } from '../i18n/strings.js';
import { esc } from './html.js';
import { toIso } from '../calc/pay-cycle.js';
import { updateAllUI } from './render.js';
import { initializeSettingsUI } from './settings-forms.js';
import { loadSampleData } from '../state/sample-data.js';
import { showToast } from './toast.js';
import { getSetupSteps } from './setup/registry.js';
import { registerQuizStep } from './setup/quiz.js';
import { registerPaySteps } from './setup/steps-pay.js';
import { registerMoneySteps } from './setup/steps-money.js';
import { registerBasicSteps } from './setup/steps-basic.js';
import { markStep, startSetupState, readSetupState, writeSetupState, renderSetupChecklist } from './setup/checklist.js';

const ONBOARDED_KEY = 'ft-onboarded';

let session = null;
let wired = false;
let registered = false;

function storage() {
    try { return window.localStorage; } catch (e) { return null; }
}
function markOnboarded() {
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch (e) { return false; }
    return true;
}
function alreadyOnboarded() {
    try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch (e) { return false; }
}

/** C7's own steps plus the default model, split and transfers (E8 replaces those three). */
export function registerCoreSteps() {
    if (registered) return;
    registered = true;
    registerQuizStep();
    registerPaySteps();
    registerMoneySteps();
    registerBasicSteps();
}

const rootEl = () => document.getElementById('setup-root');
const todayIso = () => toIso(new Date());

function save() {
    initializeSettingsUI();
    updateAllUI();
    if (store.autoSave) store.autoSave.onDataChange();
}

function makeCtx() {
    return {
        state: {},
        get data() { return store.financeData; },
        get today() { return todayIso(); },
        save,
        refresh(opts) { render(opts); },
        finish(opts) { finishSetup(opts); },
    };
}

// ---------- markup ----------

function welcomeHtml(canSample) {
    return `<div class="su-welcome">
        <h1 id="su-title" class="su-h" tabindex="-1">${esc(t('c.setup.welcome.title'))}</h1>
        <p class="su-lead">${esc(t('c.setup.welcome.lead'))}</p>
        <div class="su-choices">
            <button type="button" class="su-btn" data-su="start" data-su-focus="start">${esc(t('c.setup.welcome.start'))}</button>
            ${canSample ? `<button type="button" class="su-btn su-btn-ghost" data-su="sample" data-su-focus="sample">${esc(t('c.setup.welcome.sample'))}</button>` : ''}
        </div>
        <button type="button" class="su-link su-skipall" data-su="skipAll">${esc(t('c.setup.welcome.skip'))}</button>
    </div>`;
}

function shellHtml(body, head, foot) {
    return `<section class="su-screen" role="dialog" aria-modal="true" aria-labelledby="su-title">
        <header class="su-top"><span class="su-brand">${esc(t('c.setup.brand'))}</span>${head}
        <button type="button" class="su-link su-close" data-su="close" aria-label="${esc(t('c.setup.close.label'))}">${esc(t('c.setup.close'))}</button></header>
        <div class="su-body">${body}</div>${foot}
        <div class="su-live" aria-live="polite" role="status"></div></section>`;
}

function render({ focus = false } = {}) {
    const el = rootEl();
    if (!el || !session) return;
    const keep = !focus && document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.suFocus : null;
    const list = getSetupSteps();
    let html;
    let live = '';
    if (session.index < 0) {
        html = shellHtml(welcomeHtml(session.canSample), '', '');
    } else {
        const step = list[session.index];
        const n = session.index + 1;
        const dots = list.map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
        const last = session.index === list.length - 1;
        const head = `<span class="su-kick">${esc(t('c.setup.stepOf', { n, total: list.length, title: step.title }))}</span>`;
        const body = `<div class="su-steps" aria-hidden="true">${dots}</div>
            <h1 id="su-title" class="su-h" tabindex="-1">${esc(step.title)}</h1>
            <div class="su-stepbody">${step.render(session.ctx)}</div>
            <p class="su-err" id="su-err" role="alert" hidden></p>`;
        const foot = `<footer class="su-foot">
            <button type="button" class="su-btn su-btn-ghost" data-su="back"${session.index === 0 && !session.welcome ? ' disabled' : ''}>${esc(t('c.setup.back'))}</button>
            ${step.skippable !== false && !last ? `<button type="button" class="su-link" data-su="skip">${esc(t('c.setup.skip'))}</button>` : ''}
            <button type="button" class="su-btn" data-su="next">${esc(step.nextLabel || t('c.setup.next'))}</button></footer>`;
        html = shellHtml(body, head, foot);
        live = t('c.setup.stepOf', { n, total: list.length, title: step.title });
    }
    el.innerHTML = html;
    const liveEl = el.querySelector('.su-live');
    if (liveEl && focus) liveEl.textContent = live;
    if (focus) {
        const h = el.querySelector('#su-title');
        if (h) h.focus({ preventScroll: true });
        const body = el.querySelector('.su-body');
        if (body) body.scrollTop = 0;
    } else if (keep) {
        const again = [...el.querySelectorAll('[data-su-focus]')].find((x) => x.dataset.suFocus === keep);
        if (again) again.focus({ preventScroll: true });
    }
}

function showError(message) {
    const el = document.getElementById('su-err');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
}

// ---------- navigation ----------

function currentStep() {
    return session && session.index >= 0 ? getSetupSteps()[session.index] : null;
}

function goTo(index) {
    const list = getSetupSteps();
    session.index = Math.max(0, Math.min(index, list.length - 1));
    render({ focus: true });
}

function next() {
    const step = currentStep();
    if (!step) return;
    const msg = step.validate ? step.validate(session.ctx) : null;
    if (msg) { showError(msg); return; }
    showError('');
    if (step.onNext && step.onNext(session.ctx) === false) return;
    markStep(storage(), step.id, 'completed');
    const list = getSetupSteps();
    if (session.index >= list.length - 1) { finishSetup({ then: 'today' }); return; }
    goTo(session.index + 1);
}

function skip() {
    const step = currentStep();
    if (!step) return;
    markStep(storage(), step.id, 'skipped');
    const list = getSetupSteps();
    if (session.index >= list.length - 1) { finishSetup({ then: 'today' }); return; }
    goTo(session.index + 1);
}

function back() {
    const step = currentStep();
    if (!step) return;
    if (step.onBack && step.onBack(session.ctx) === false) return;
    if (session.index > 0) { goTo(session.index - 1); return; }
    if (session.welcome) { session.index = -1; render({ focus: true }); }
}

// ---------- open and close ----------

export function isSetupOpen() {
    return !!session;
}

/**
 * Open setup. `welcome` shows the first-run welcome (with sample data); `stepId` jumps to a step
 * (the Today checklist does this).
 */
export function openSetup({ welcome = false, stepId = null } = {}) {
    registerCoreSteps();
    const el = rootEl();
    if (!el) return false;
    if (session) return true;
    const list = getSetupSteps();
    const at = stepId ? list.findIndex((s) => s.id === stepId) : -1;
    session = {
        ctx: makeCtx(), welcome, canSample: welcome, index: welcome ? -1 : Math.max(0, at),
        returnFocus: document.activeElement,
    };
    if (!welcome) startSetupState(storage());
    const app = document.querySelector('.app');
    if (app) app.setAttribute('inert', '');
    document.body.classList.add('has-setup');
    render({ focus: true });
    return true;
}

export function closeSetup() {
    const el = rootEl();
    const back = session && session.returnFocus;
    session = null;
    if (el) el.innerHTML = '';
    const app = document.querySelector('.app');
    if (app) app.removeAttribute('inert');
    document.body.classList.remove('has-setup');
    markOnboarded();
    if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    updateAllUI();
}

async function openTab(name) {
    const { showTab } = await import('./tabs.js');
    showTab(name);
}

function finishSetup({ then = 'today' } = {}) {
    closeSetup();
    if (then === 'quick-add') {
        import('./quick-add.js').then((m) => m.openQuickAdd());
    } else if (then === 'import') {
        const openImport = document.getElementById('open-import');
        if (openImport) openImport.click();
    } else {
        openTab('today');
        showToast(t('c.setup.done.toast'));
    }
}

async function exploreWithSample() {
    const btn = rootEl() && rootEl().querySelector('[data-su="sample"]');
    if (btn) { btn.disabled = true; btn.textContent = t('c.setup.welcome.sampleLoading'); }
    const count = await loadSampleData();
    initializeSettingsUI();
    const { generateBillDueEvents } = await import('../state/bills.js');
    generateBillDueEvents(store.financeData); // announce the demo's due-soon bills now, not next boot
    const { refreshSpendCache } = await import('../state/spend-cache.js');
    await refreshSpendCache();
    const st = readSetupState(storage()) || startSetupState(storage());
    st.dismissed = true; // nobody needs a "finish setting up" list on a demo household
    writeSetupState(storage(), st);
    closeSetup();
    showToast(count > 0 ? t('toast.sample.loaded', { count }) : t('toast.sample.loadedNoTxns'));
}

// ---------- events (delegated, wired once) ----------

function onClick(e) {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const resume = target.closest('[data-su-resume]');
    if (resume) { e.preventDefault(); openSetup({ stepId: resume.dataset.suResume }); return; }
    const notNeeded = target.closest('[data-su-notneeded]');
    if (notNeeded) {
        const st = readSetupState(storage()) || startSetupState(storage());
        st.notNeeded = [...new Set([...st.notNeeded, notNeeded.dataset.suNotneeded])];
        writeSetupState(storage(), st);
        renderSetupChecklist();
        return;
    }
    if (target.closest('[data-su-hidelist]')) {
        const st = readSetupState(storage()) || startSetupState(storage());
        st.dismissed = true;
        writeSetupState(storage(), st);
        renderSetupChecklist();
        return;
    }
    const root = rootEl();
    if (!session || !root || !root.contains(target)) return;
    const shell = target.closest('[data-su]');
    if (shell) {
        const act = shell.dataset.su;
        if (act === 'close') closeSetup();
        else if (act === 'start') goTo(0);
        else if (act === 'sample') exploreWithSample();
        else if (act === 'skipAll') { startSetupState(storage()); closeSetup(); }
        else if (act === 'next') next();
        else if (act === 'skip') skip();
        else if (act === 'back') back();
        return;
    }
    const stepAct = target.closest('[data-su-act]');
    const step = currentStep();
    if (stepAct && step && step.actions && typeof step.actions[stepAct.dataset.suAct] === 'function') {
        e.preventDefault();
        step.actions[stepAct.dataset.suAct](session.ctx, stepAct, e);
    }
}

function onChange(e) {
    const target = e.target instanceof Element ? e.target.closest('[data-su-change]') : null;
    const step = currentStep();
    if (!session || !target || !step || !step.actions) return;
    const fn = step.actions[target.dataset.suChange];
    if (typeof fn === 'function') fn(session.ctx, target, e);
}

function onKeydown(e) {
    if (!session || e.key !== 'Escape') return;
    if (document.querySelector('.sheet-layer, .ledger-dialog')) return; // the sheet or dialog on top closes first
    const modal = document.getElementById('income-settings-modal');
    if (modal && !modal.hidden) return;
    closeSetup();
}

/**
 * Wire setup once at boot (after loadData). Opens it for a first run.
 * @param {boolean} hadSavedData - loadData() found an existing save.
 */
export function setupOnboarding(hadSavedData) {
    registerCoreSteps();
    if (!wired) {
        wired = true;
        document.addEventListener('click', onClick);
        document.addEventListener('change', onChange);
        document.addEventListener('keydown', onKeydown);
        document.addEventListener('ledger:run-setup', (e) => {
            if (openSetup({ welcome: false })) e.preventDefault();
        });
    }
    if (hadSavedData || alreadyOnboarded()) return;
    openSetup({ welcome: true });
}
