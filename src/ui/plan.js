// Plan screen (A9a): the shell and the money lists. Order (FT-R-88): Pay, Essentials,
// Non-essentials, Bills, Debts, Assets, the bucket section (E6 fills #plan-buckets), then
// Categories last. Every section is a collapsible <details> built once, so open and closed
// state survives re-renders; only the section bodies are redrawn. A9b fills the Debts,
// Assets and Categories mounts (#plan-debts, #plan-assets, #plan-categories) and replaces
// the placeholder text.

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { getSpendCache } from '../state/spend-cache.js';
import { esc } from './html.js';
import { formatCurrency } from '../utils.js';
import { openSheet } from './sheet.js';
import { showUndoToast } from './toast.js';
import { openIncomeSheet } from './income-layout.js';
import { mountBuckets } from './plan-buckets.js';
import { mountReview } from './review.js';
import { updateDataAndUI } from './render.js';
import {
    planListsModel, listBodyHtml, payBodyHtml, capsHtml, reviewCardHtml, countText, planItemSheetSpec,
    savePlanItem, deletePlanItem, newIncomeSource, clearReview, markReviewed,
} from './plan-lists.js';

// id, step number, string key
const SECTIONS = [
    ['pay', 1, 'pay'], ['essential', 2, 'essential'], ['non', 3, 'non'], ['bills', 4, 'bills'],
    ['debts', 5, 'debts'], ['assets', 6, 'assets'], ['model', 7, 'model'], ['cats', 8, 'cats'],
];
const SLOT_TEXT = { debts: 'a.plan.slotDebts', assets: 'a.plan.slotAssets', cats: 'a.plan.slotCats' };
const MOUNT_ID = { debts: 'plan-debts', assets: 'plan-assets', cats: 'plan-categories' };

const localIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let query = '';
let wired = false;

// A11: the placeholder slots offer one action until A9b fills them.
function slotActionHtml(id) {
    const label = t(`a.plan.slotGo.${id}`);
    return id === 'cats'
        ? `<button type="button" class="btn ghost p-add" data-open-settings>${esc(label)}</button>`
        : `<button type="button" class="btn ghost p-add" data-plan-go="future">${esc(label)}</button>`;
}

function sectionHtml([id, step, key]) {
    let body = `<div class="p-body" data-body="${id}"></div>`;
    if (id === 'model') body = '';
    else if (MOUNT_ID[id]) body = `<div id="${MOUNT_ID[id]}" class="p-slot"><p class="muted p-empty">${esc(t(SLOT_TEXT[id]))}</p>${slotActionHtml(id)}</div>`;
    return `<details class="p-sec" id="plan-sec-${id}" open><summary class="p-sec-head">`
        + `<span class="l"><span class="step" aria-hidden="true">${step}</span><h2>${esc(t(`a.plan.sec.${key}`))}</h2><p>${esc(t(`a.plan.sec.${key}Note`))}</p></span>`
        + `<span class="fig" data-fig="${id}"></span><span class="p-chev" aria-hidden="true"></span></summary>${body}</details>`;
}

function ensureShell() {
    const root = document.getElementById('plan');
    if (!root || root.querySelector('#plan-lists')) return root;
    const buckets = document.getElementById('plan-buckets');
    const wrap = document.createElement('div');
    wrap.id = 'plan-lists';
    wrap.innerHTML = '<div id="plan-review"></div>'
        + `<div class="p-tools"><label class="sr" for="plan-search">${esc(t('a.plan.search'))}</label>`
        + `<input type="search" id="plan-search" class="form-input" placeholder="${esc(t('a.plan.searchPlaceholder'))}" autocomplete="off"></div>`
        + SECTIONS.map(sectionHtml).join('');
    const title = root.querySelector('.title-row');
    if (title) title.after(wrap); else root.prepend(wrap);
    // The bucket section keeps E6's mount point; it moves inside its collapsible section.
    const modelSec = wrap.querySelector('#plan-sec-model');
    if (buckets) modelSec.appendChild(buckets);
    else { const m = document.createElement('div'); m.id = 'plan-buckets'; modelSec.appendChild(m); }
    const top = document.createElement('button');
    top.type = 'button'; top.className = 'p-top'; top.id = 'p-top';
    top.textContent = t('a.plan.backToTop');
    root.appendChild(top);
    return root;
}

function setFig(id, value, sub) {
    const el = document.querySelector(`[data-fig="${id}"]`);
    if (el) el.innerHTML = `<span class="v money">${esc(value)}</span><span class="s">${esc(sub)}</span>`;
}

function undoToast(res) {
    showUndoToast({
        message: res.message,
        onUndo: () => { res.onUndo(); updateDataAndUI(); },
        onExpire: res.onExpire,
    });
}

function openItem(id, kind) {
    const data = store.financeData;
    const item = id ? (data.plan || []).find((p) => p && p.id === id) : null;
    if (id && !item) return;
    const spec = planItemSheetSpec(data, { kind, item });
    openSheet({
        title: spec.title, fields: spec.fields, values: spec.values, validate: spec.validate, plausibility: spec.plausibility,
        onSave(values) {
            const res = savePlanItem(data, item, values, { kind });
            if (!res.ok) return false;
            if (item) markReviewed(data, item.id);
            updateDataAndUI();
            undoToast(res);
            return undefined;
        },
        onDelete: item ? () => {
            const res = deletePlanItem(data, item.id);
            if (!res.ok) return;
            updateDataAndUI();
            undoToast(res);
        } : undefined,
    });
}

function openIncome(index) {
    let opened = false;
    try { opened = openIncomeSheet(index) !== false; } catch (err) { console.error('income sheet failed', err); }
    // Until C6 lands the sheet, the old income editor still works.
    if (!opened) { const legacy = document.getElementById('open-income-settings'); if (legacy) legacy.click(); }
}

function addIncome() {
    const data = store.financeData;
    data.incomeSources.push(newIncomeSource());
    updateDataAndUI();
    openIncome(data.incomeSources.length - 1);
}

function wire(root) {
    if (wired) return;
    wired = true;
    root.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || !root.contains(b)) return;
        if (b.dataset.planOpen) {
            const row = (store.financeData.plan || []).find((p) => p && p.id === b.dataset.planOpen);
            openItem(b.dataset.planOpen, row && row.anchorDue ? 'bills' : 'essential');
        } else if (b.dataset.planAdd) openItem(null, b.dataset.planAdd);
        else if (b.dataset.incomeOpen !== undefined) openIncome(Number(b.dataset.incomeOpen));
        else if (b.dataset.incomeAdd) addIncome();
        else if (b.dataset.planGo) { const tab = document.querySelector(`[data-tab-target="${b.dataset.planGo}"]`); if (tab) tab.click(); }
        else if (b.dataset.planReviewDone) { clearReview(store.financeData); updateDataAndUI(); }
        else if (b.id === 'p-top') {
            const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
            const h1 = root.querySelector('h1');
            if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
        }
    });
    root.addEventListener('input', (e) => {
        if (e.target.id !== 'plan-search') return;
        query = e.target.value;
        fillLists();
    });
    window.addEventListener('scroll', () => {
        const top = document.getElementById('p-top');
        if (top) top.classList.toggle('show', window.scrollY > 480);
    }, { passive: true });
}

function fillLists() {
    const cache = getSpendCache();
    const model = planListsModel(store.financeData, { today: cache.today || localIso(), monthByCategory: cache.monthByCategory, query });
    const q = model.query;
    const put = (id, html) => { const el = document.querySelector(`[data-body="${id}"]`); if (el) el.innerHTML = html; };
    put('pay', payBodyHtml(model.pay));
    put('essential', listBodyHtml('essential', model.essentials, q));
    put('non', listBodyHtml('non', model.nonEssentials, q) + capsHtml(model.caps, cache.ready && cache.count > 0));
    put('bills', listBodyHtml('bills', model.bills, q));
    const review = document.getElementById('plan-review');
    if (review) review.innerHTML = reviewCardHtml(model.review);
    const cur = (n) => formatCurrency(Math.round(n * 100) / 100);
    setFig('pay', cur(model.pay.takeHome), t('a.plan.takeHome'));
    setFig('essential', cur(model.essentials.perPay), countText('essential', model.essentials.count));
    setFig('non', cur(model.nonEssentials.perPay), countText('non', model.nonEssentials.count));
    setFig('bills', cur(model.bills.perPay), countText('bills', model.bills.count));
}

export function renderPlan(totals) {
    const sub = document.getElementById('plan-sub');
    if (sub) sub.textContent = t('a.plan.sub');
    const root = ensureShell();
    if (!root) return;
    wire(root);
    fillLists();
    const mount = document.getElementById('plan-buckets');
    if (mount) mountBuckets(mount);
    mountReview();
}
