// Plan screen (A9a): the shell and the money lists. Order (FT-R-88): Pay, Essentials,
// Non-essentials, Bills, Debts, Assets, the bucket section (E6 fills #plan-buckets), then
// Categories last. Every section is a collapsible <details> built once, so open and closed
// state survives re-renders; only the section bodies are redrawn. A9b fills the Debts,
// Assets and Categories mounts (#plan-debts, #plan-assets, #plan-categories).

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { getSpendCache } from '../state/spend-cache.js';
import { esc } from './html.js';
import { formatCurrency } from '../utils.js';
import { openSheet } from './sheet.js';
import { showUndoToast, showToast } from './toast.js';
import { openIncomeSheet } from './income-layout.js';
import { openOtherIncomeSheet } from './income-other.js';
import { mountBuckets } from './plan-buckets.js';
import { mountReview } from './review.js';
import { updateDataAndUI } from './render.js';
import { getBuckets } from '../state/saving-model.js';
import { listTransactions, updateTransaction } from '../state/transactions.js';
import { refreshSpendCache } from '../state/spend-cache.js';
import { iconSvgHtml } from './icon-paths.js';
import { checkItems, checkCardHtml, confirmSuggestion } from './plan-assets-debts.js';
import {
    planListsModel, listBodyHtml, payBodyHtml, capsHtml, reviewCardHtml, countText, planItemSheetSpec,
    savePlanItem, deletePlanItem, newIncomeSource, clearReview, markReviewed,
    debtAssetModel, debtAssetBodyHtml, debtAssetCount, debtAssetSheetSpec, saveDebtAsset, deleteDebtAsset,
    categoriesModel, categoriesBodyHtml, categoryCount, categorySheetSpec, saveCategory, deleteCategory, moveTargets,
} from './plan-lists.js';

// id, step number, string key
const SECTIONS = [
    ['pay', 1, 'pay'], ['essential', 2, 'essential'], ['non', 3, 'non'], ['bills', 4, 'bills'],
    ['debts', 5, 'debts'], ['assets', 6, 'assets'], ['model', 7, 'model'], ['cats', 8, 'cats'],
];
const MOUNT_ID = { debts: 'plan-debts', assets: 'plan-assets', cats: 'plan-categories' };

const localIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let query = '';
let wired = false;

function sectionHtml([id, step, key]) {
    let body = `<div class="p-body" data-body="${id}"></div>`;
    if (id === 'model') body = '';
    else if (MOUNT_ID[id]) body = `<div id="${MOUNT_ID[id]}" class="p-body" data-body="${id}"></div>`;
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

const todayIso = () => getSpendCache().today || localIso();

function openDebtAsset(kind, index, carry = null) {
    const data = store.financeData;
    const key = kind === 'debt' ? 'liabilities' : 'assets';
    const row = index == null ? null : (data[key] || [])[index];
    if (index != null && !row) return;
    const spec = debtAssetSheetSpec(kind, row, { today: todayIso(), carry });
    const handle = openSheet({
        title: spec.title, fields: spec.fields, values: spec.values, validate: spec.validate, plausibility: spec.plausibility,
        onSave(values) {
            const res = saveDebtAsset(data, kind, index, values);
            if (!res.ok) return false;
            updateDataAndUI();
            undoToast(res);
            return undefined;
        },
        onDelete: row ? () => {
            const res = deleteDebtAsset(data, kind, index);
            if (!res.ok) return;
            updateDataAndUI();
            undoToast(res);
        } : undefined,
    });
    // F5: the questions depend on the kind (or the interest type), so the sheet reopens with what was typed so far.
    if (spec.reopenOn && spec.reopenOn.length) {
        handle.layer.addEventListener('change', (e) => {
            const k = e.target && e.target.dataset ? e.target.dataset.key : null;
            if (k && spec.reopenOn.includes(k)) openDebtAsset(kind, index, handle.getValues());
        });
    }
}

/** "Check these N" card: confirm one or all (only the flag clears), or open the row to change it. */
function checkAct(b) {
    const data = store.financeData;
    if (b.dataset.checkOpen) {
        const [type, i] = b.dataset.checkOpen.split(':');
        openDebtAsset(type === 'debt' ? 'debt' : 'asset', Number(i));
        return;
    }
    const res = confirmSuggestion(data, b.dataset.checkAll ? 'all' : b.dataset.checkConfirm);
    if (!res.ok) return;
    updateDataAndUI();
    undoToast(res);
}

function bucketList(data) {
    try { return getBuckets(data, todayIso()); } catch (_) { return []; }
}

function openCategory(id) {
    const data = store.financeData;
    const cat = id ? (data.categories || []).find((c) => c && c.id === id) : null;
    if (id && !cat) return;
    const spec = categorySheetSpec(data, { category: cat, buckets: bucketList(data) });
    const preview = document.createElement('div');
    preview.className = 'cat-preview';
    const setPreview = (name) => { preview.innerHTML = `<span class="cat-preview-ico">${iconSvgHtml(name)}</span>`; };
    setPreview(spec.values.icon);
    const canDelete = cat && !['other', 'income', 'other-essential'].includes(cat.id) && cat.kind !== 'transfer';
    const sheet = openSheet({
        title: spec.title, fields: spec.fields, values: spec.values, validate: spec.validate, content: [preview],
        onSave(values) {
            const res = saveCategory(data, cat, values);
            if (!res.ok) { showToast(t('a.plan.cat.errBucket')); return false; }
            updateDataAndUI();
            undoToast(res);
            return undefined;
        },
        onDelete: canDelete ? () => { deleteCategoryFlow(cat.id); } : undefined,
    });
    const form = sheet && sheet.el;
    if (form) form.addEventListener('change', (e) => { if (e.target && e.target.closest && e.target.closest('[data-field="icon"]')) setPreview(e.target.value); });
}

/** Delete a category: straight away when nothing uses it, else block and offer a move (the delete guard). */
async function deleteCategoryFlow(id) {
    const data = store.financeData;
    let rows = [];
    try { rows = await listTransactions({ categoryId: id }); } catch (_) { rows = []; }
    const res = deleteCategory(data, id, { txns: rows.length });
    if (res.ok) { updateDataAndUI(); undoToast(res); return; }
    if (res.code !== 'used') return;
    const cat = (data.categories || []).find((c) => c && c.id === id);
    const targets = moveTargets(data, id);
    const body = document.createElement('p');
    body.className = 'muted';
    body.textContent = t('a.plan.cat.usedBody', { count: res.use.total, plan: res.use.plan, txns: res.use.txns, rules: res.use.rules, bills: res.use.bills });
    openSheet({
        title: t('a.plan.cat.usedTitle', { name: cat ? cat.name : id }),
        fields: [{ key: 'moveTo', label: t('a.plan.cat.moveLabel'), type: 'select', required: true, options: targets }],
        values: { moveTo: (targets.find((o) => o.value === 'other') || targets[0] || { value: '' }).value },
        content: [body], saveLabel: t('a.plan.cat.moveSave'),
        validate: (v) => (v.moveTo ? {} : { moveTo: t('d.sheet.required') }),
        onSave(values) { moveAndDelete(id, values.moveTo, rows); return undefined; },
    });
}

async function moveAndDelete(id, moveTo, rows) {
    const data = store.financeData;
    const originals = rows.map((r) => ({ ...r }));
    try { for (const r of rows) await updateTransaction({ ...r, categoryId: moveTo }); } catch (err) { console.error('move failed', err); }
    const res = deleteCategory(data, id, { moveTo, txns: rows.length });
    if (!res.ok) return;
    try { await refreshSpendCache({ data }); } catch (_) { /* the cache refreshes on the next load */ }
    updateDataAndUI();
    showUndoToast({
        message: res.message,
        onUndo: async () => {
            res.onUndo();
            try { for (const r of originals) await updateTransaction(r); await refreshSpendCache({ data }); } catch (_) { /* rows keep the moved category */ }
            updateDataAndUI();
        },
        onExpire: res.onExpire,
    });
}

function openIncome(index) {
    let opened = false;
    try { opened = openIncomeSheet(index) !== false; } catch (err) { console.error('income sheet failed', err); }
    // Self-employed and Variable sources use the plain sheet (A12b); the old modal editor is gone.
    if (!opened) opened = openOtherIncomeSheet(index);
}

function addIncome() {
    const data = store.financeData;
    data.incomeSources.push(newIncomeSource(data.incomeSources));
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
        else if (b.dataset.debtOpen !== undefined) openDebtAsset('debt', Number(b.dataset.debtOpen));
        else if (b.dataset.debtAdd) openDebtAsset('debt', null);
        else if (b.dataset.assetOpen !== undefined) openDebtAsset('asset', Number(b.dataset.assetOpen));
        else if (b.dataset.assetAdd) openDebtAsset('asset', null);
        else if (b.dataset.catOpen) openCategory(b.dataset.catOpen);
        else if (b.dataset.catAdd) openCategory(null);
        else if (b.dataset.checkConfirm || b.dataset.checkOpen || b.dataset.checkAll) checkAct(b);
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
    const debts = debtAssetModel(store.financeData, 'debt');
    const assets = debtAssetModel(store.financeData, 'asset');
    const cats = categoriesModel(store.financeData, { buckets: bucketList(store.financeData) });
    put('debts', debtAssetBodyHtml(debts));
    put('assets', debtAssetBodyHtml(assets));
    put('cats', categoriesBodyHtml(cats));
    const review = document.getElementById('plan-review');
    if (review) review.innerHTML = reviewCardHtml(model.review) + checkCardHtml(checkItems(store.financeData));
    const cur = (n) => formatCurrency(Math.round(n * 100) / 100);
    setFig('pay', cur(model.pay.takeHome), t('a.plan.takeHome'));
    setFig('essential', cur(model.essentials.perPay), countText('essential', model.essentials.count));
    setFig('non', cur(model.nonEssentials.perPay), countText('non', model.nonEssentials.count));
    setFig('bills', cur(model.bills.perPay), countText('bills', model.bills.count));
    setFig('debts', cur(debts.total), debtAssetCount('debt', debts.count));
    setFig('assets', cur(assets.total), debtAssetCount('asset', assets.count));
    setFig('cats', String(cats.count), categoryCount(cats.count));
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
