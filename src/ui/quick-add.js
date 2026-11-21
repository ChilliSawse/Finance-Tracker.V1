// Quick-add (A8): one panel for adding spending or income, and for editing a row (FT-R-61).
//   openQuickAdd()              add (sidebar Add and the phone "+", wired by delegation in events/setup.js)
//   openQuickAdd({ txn })       edit mode for a stored transaction, with Delete and an Undo toast
// Docked at 1281 px and up, a side panel over a scrim from 1024, a bottom sheet on the phone.
// It is its own panel, not openSheet (plan X-12); focus helpers are shared with D1.
// Everything user-visible goes in through textContent or setAttribute, never innerHTML. The pure parts
// (guess, chip order, wording, what a save builds) are in quick-add-model.js.

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { formatCurrency } from '../utils.js';
import { getBuckets } from '../state/saving-model.js';
import { leftThisPay } from '../calc/pay-cycle.js';
import { getSpendCache, refreshSpendCache } from '../state/spend-cache.js';
import {
    makeTransaction, addTransactions, updateTransaction, deleteTransaction, importTransactions, isValidIsoDate,
} from '../state/transactions.js';
import { addPlanItem } from '../state/plan.js';
import { showToast, showUndoToast } from './toast.js';
import { rememberFocus, trapTab, getFocusables } from './focus.js';
import { updateAllUI } from './render.js';
import {
    REPEAT_FREQUENCIES, parseAmountCents, guessCategory, orderCategoryChips, categoryLine, resolveBucket,
    bucketLine, afterThisCents, buildTransactionFields, buildRepeatPlanItem,
} from './quick-add-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
    cart: 'M2 3h2l1.5 7h6.5l1.5-5H5M6.5 13.2v.1M11.5 13.2v.1',
    home: 'M2.5 8L8 3l5.5 5M4 7v6h8V7',
    bolt: 'M9 2L4 9h3.5L7 14l5-7H8.5z',
    phone: 'M5 2.5h6v11H5zM7.5 12h1',
    car: 'M3 10V8l1.5-3.5h7L13 8v2zM3 10v2.5M13 10v2.5M5 8.5h.1M11 8.5h.1',
    heart: 'M8 13.5S2.5 10 2.5 6.3A2.8 2.8 0 0 1 8 5a2.8 2.8 0 0 1 5.5 1.3C13.5 10 8 13.5 8 13.5z',
    shield: 'M8 2.5l5 2v4c0 2.5-2 4.3-5 5.5-3-1.2-5-3-5-5.5v-4z',
    utensils: 'M5 2.5v4M3.5 2.5v3a1.5 1.5 0 0 0 3 0v-3M5 8v5.5M11 13.5v-11c-1.5 1-2 3-2 5h2',
    film: 'M2.5 3.5h11v9h-11zM5.5 3.5v9M10.5 3.5v9M2.5 8h3M10.5 8h3',
    repeat: 'M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2',
    dumbbell: 'M2.5 6v4M4.5 4.5v7M11.5 4.5v7M13.5 6v4M4.5 8h7',
    bag: 'M3.5 5.5h9l-.8 8H4.3zM5.5 5.5V4.5a2.5 2.5 0 0 1 5 0v1',
    plane: 'M2 9l12-5-3 9-3-3.5L6 13l.5-3.5z',
    wallet: 'M2.5 4.5h10a1 1 0 0 1 1 1v7h-11zM2.5 4.5V4l9-1.5V4.5M10.5 9h1.5',
    dots: 'M4 8h.1M8 8h.1M12 8h.1',
    tag: 'M2.5 8.5V3h5.5l5.5 5.5-5.5 5.5zM5.5 5.5h.1',
    close: 'M4 4l8 8M12 4l-8 8',
    info: 'M8 7.2v3.6M8 5.2v.1M2.5 8a5.5 5.5 0 1 0 11 0 5.5 5.5 0 1 0-11 0',
};
const KNOWN_ROLES = new Set(['daily', 'splurge', 'smile', 'fire', 'mojo', 'grow']);

function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'i');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.tag);
    svg.appendChild(p);
    return svg;
}

/** Element builder. Text only ever goes in as textContent. */
function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v == null) continue;
        if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids) if (kid != null) node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    return node;
}

function localIso(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const money = (cents) => formatCurrency(cents / 100);

let active = null;

export function openQuickAdd(opts = {}) {
    if (typeof document === 'undefined') return false;
    if (active) {
        if (!opts.txn && !active.edit) { active.focusAmount(); return false; }
        active.close({ restore: false });
    }
    active = createPanel(opts);
    return false;
}

function createPanel({ txn = null, kind: startKind = null } = {}) {
    const data = store.financeData || {};
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const allocation = Array.isArray(data.allocation) ? data.allocation : [];
    const today = localIso();
    const edit = !!txn;
    const restoreFocus = rememberFocus();
    const catById = (id) => categories.find((c) => c && c.id === id) || null;

    const cache = getSpendCache();
    const counts = cache.cycleByCategory || new Map();
    const buckets = getBuckets(data, today).filter((b) => b && !b.parentId && b.kind !== 'goal');
    const bucketById = (id) => buckets.find((b) => b.id === id) || null;

    // ---- state ----
    const s = {
        kind: edit ? (txn.amountCents > 0 ? 'income' : 'spending') : (startKind === 'income' ? 'income' : 'spending'),
        amountText: edit ? (Math.abs(txn.amountCents) / 100).toFixed(2) : '',
        categoryId: edit ? txn.categoryId : null,
        guessed: false,
        manual: edit,
        choiceId: edit && txn.bucketId ? txn.bucketId : null,
        note: edit ? (txn.note || '') : '',
        date: edit ? txn.date : today,
        repeat: false,
        freq: 'fortnightly',
        moreOpen: false,
        orderId: edit ? txn.categoryId : null,
        busy: false,
    };
    if (s.kind === 'income' && !s.categoryId) s.categoryId = catById('income') ? 'income' : null;

    // ---- figures: what is left in each bucket, without this row when editing ----
    function leftFigures() {
        const out = new Map();
        let lb = null;
        try {
            const rows = (cache.rows || []).filter((r) => !edit || r.id !== txn.id);
            lb = leftThisPay({ data, txns: rows, today });
        } catch (_) { lb = null; }
        for (const b of buckets) {
            const row = lb && lb.buckets.find((x) => x.id === b.id);
            out.set(b.id, b.kind === 'spend' && row ? row.leftCents : b.balanceCents);
        }
        return out;
    }
    const figures = leftFigures();

    // ---- DOM ----
    const titleId = 'qa-title';
    const amountInput = el('input', { id: 'qa-amount', class: 'qa-amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-describedby': 'qa-effect' });
    amountInput.value = s.amountText;
    const noteInput = el('input', { id: 'qa-note', type: 'text', autocomplete: 'off', maxlength: '120' });
    noteInput.value = s.note;
    const dateInput = el('input', { id: 'qa-date', type: 'date', required: true });
    dateInput.value = s.date;

    const heading = el('h2', { id: titleId });
    const closeBtn = el('button', { type: 'button', class: 'icon-btn', 'data-qa': 'close', 'aria-label': t('a.quickAdd.close') }, icon('close'));
    const segBtn = (kind, label) => el('button', { type: 'button', 'data-qa': 'kind', 'data-kind': kind, text: label });
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': t('a.quickAdd.kind') },
        segBtn('spending', t('a.quickAdd.spending')), segBtn('income', t('a.quickAdd.income')));
    const effect = el('p', { class: 'effect', id: 'qa-effect', 'aria-live': 'polite' });
    const chips = el('div', { class: 'cats', role: 'group', 'aria-label': t('a.quickAdd.category') });
    const catNote = el('p', { class: 'cat-note', id: 'qa-cat-note', 'aria-live': 'polite' });
    const bkNow = el('span', { class: 'now' });
    const bkWord = el('span', { class: 'act-word' });
    const bkGrid = el('div', { class: 'bk-grid' });
    const bkLegend = el('legend');
    const bucketRow = el('details', { class: 'bucket-row' },
        el('summary', null, el('span', { class: 'lbl', text: t('a.quickAdd.bucket') }), bkWord, bkNow),
        el('fieldset', { class: 'bucket-pick' }, bkLegend, bkGrid,
            el('p', { class: 'one-only' }, icon('info'), t('a.quickAdd.thisOneOnly'))));
    const repeatBox = el('input', { type: 'checkbox', id: 'qa-repeat', 'data-qa': 'repeat' });
    const freqSelect = el('select', { id: 'qa-freq', 'aria-label': t('a.quickAdd.repeatEvery') },
        ...REPEAT_FREQUENCIES.map((f) => el('option', { value: f, text: t(`a.quickAdd.freq.${f}`) })));
    freqSelect.value = s.freq;
    const repeatRow = el('div', { class: 'qa-repeat' },
        el('label', { class: 'qa-check', for: 'qa-repeat' }, repeatBox, el('span', { class: 'qa-check-text' },
            el('span', { class: 'qa-check-name', text: t('a.quickAdd.repeat') }),
            el('span', { class: 'muted', text: t('a.quickAdd.repeatHint') }))),
        el('div', { class: 'qa-freq input' }, freqSelect));
    const saveBtn = el('button', { type: 'button', class: 'save', 'data-qa': 'save' });
    const saveWhy = el('p', { class: 'save-why', id: 'qa-why', 'aria-live': 'polite' });
    const deleteBtn = edit ? el('button', { type: 'button', class: 'btn qa-delete', 'data-qa': 'delete', text: t('a.quickAdd.delete') }) : null;

    const panel = el('section', { class: 'qa-panel', role: 'dialog', 'aria-labelledby': titleId },
        el('span', { class: 'qa-handle', 'aria-hidden': 'true' }),
        el('div', { class: 'qa-head' }, heading, closeBtn),
        seg,
        el('div', { class: 'amount qa-amount' },
            el('label', { class: 'field-label-sm', for: 'qa-amount', text: t('a.quickAdd.amount') }), amountInput, effect),
        el('div', null, el('span', { class: 'field-label', id: 'qa-cat-label', text: t('a.quickAdd.category') }), chips, catNote),
        bucketRow,
        el('div', { class: 'two' },
            el('div', null, el('label', { class: 'field-label', for: 'qa-note' }, t('a.quickAdd.note') + ' ', el('span', { class: 'muted', text: t('a.quickAdd.optional') })),
                el('div', { class: 'input' }, noteInput)),
            el('div', null, el('label', { class: 'field-label', for: 'qa-date', text: t('a.quickAdd.date') }), el('div', { class: 'input' }, dateInput))),
        edit ? null : repeatRow,
        saveBtn, saveWhy, deleteBtn);
    const scrim = el('div', { class: 'qa-scrim', 'data-qa': 'close' });
    const layer = el('div', { class: 'qa-layer' }, scrim, panel);
    (document.getElementById('sheet-root') || document.body).appendChild(layer);
    document.body.classList.add('qa-open');

    // ---- derived ----
    const category = () => catById(s.categoryId);
    const amountCents = () => parseAmountCents(amountInput.value);
    const resolved = () => resolveBucket({ category: s.kind === 'income' ? null : category(), choiceId: s.choiceId, allocation });
    const bucketName = (id) => (bucketById(id) ? bucketById(id).name : '');

    function tint(node, b) {
        const role = b && KNOWN_ROLES.has(b.role) ? b.role : null;
        const key = role || `b${(b && b.slot) || 1}`;
        node.style.setProperty('--qa-bg', `var(--${key}-bg)`);
        node.style.setProperty('--qa-ink', `var(--${key}-ink)`);
    }

    // ---- renderers (each updates in place so focus survives) ----
    function renderChips() {
        const hadFocus = chips.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
        const { top, more } = orderCategoryChips(categories, { kind: s.kind, selectedId: s.orderId, counts });
        const open = s.moreOpen || more.includes(s.categoryId);
        const ids = open ? [...top, ...more] : top;
        chips.replaceChildren();
        for (const id of ids) {
            const c = catById(id);
            if (!c) continue;
            chips.appendChild(el('button', { type: 'button', class: 'chip', 'data-qa': 'cat', 'data-key': `cat:${id}`, 'data-id': id, 'aria-pressed': s.categoryId === id ? 'true' : 'false' },
                icon(c.icon || 'tag'), el('span', { text: c.name })));
        }
        if (more.length) {
            chips.appendChild(el('button', { type: 'button', class: 'chip', 'data-qa': 'more', 'data-key': 'more', 'aria-expanded': open ? 'true' : 'false', text: open ? t('a.quickAdd.less') : t('a.quickAdd.more') }));
        }
        if (hadFocus) { const n = chips.querySelector(`[data-key="${CSS.escape(hadFocus)}"]`); if (n) n.focus(); }
    }

    function renderCatNote() {
        const c = category();
        if (s.kind === 'income') { catNote.textContent = ''; return; }
        if (c) catNote.textContent = categoryLine(c, s.guessed);
        else catNote.textContent = s.note.trim() ? t('a.quickAdd.catNoMatch', { note: s.note.trim() }) : t('a.quickAdd.catNone');
    }

    function renderBucket() {
        const income = s.kind === 'income';
        bucketRow.hidden = income || buckets.length === 0;
        if (bucketRow.hidden) return;
        const r = resolved();
        const needs = !r.bucketId;
        bucketRow.classList.toggle('needs', needs);
        if (needs) bucketRow.open = bucketRow.open || !bucketRow.dataset.touched;
        bkWord.replaceChildren(el('span', { class: 'when-shut', text: needs ? t('a.quickAdd.bucketChoose') : t('a.quickAdd.bucketChange') }),
            el('span', { class: 'when-open', text: needs ? t('a.quickAdd.bucketNeededWord') : t('a.quickAdd.bucketDone') }));
        const chosen = r.bucketId ? bucketById(r.bucketId) : null;
        const line = bucketLine({ category: category(), chosenName: chosen ? chosen.name : '', usualName: bucketName(r.usualId), changed: r.changed });
        bkNow.replaceChildren();
        if (chosen) { const tag = el('span', { class: 'qa-tag', text: chosen.name }); tint(tag, chosen); bkNow.appendChild(tag); }
        bkNow.appendChild(document.createTextNode(line));
        bkLegend.textContent = needs ? t('a.quickAdd.comesOutOfNeeded') : t('a.quickAdd.comesOutOf');
        bkGrid.replaceChildren();
        for (const b of buckets) {
            const radio = el('input', { type: 'radio', name: 'qa-bucket', value: b.id, 'data-qa': 'bucket' });
            radio.checked = r.bucketId === b.id;
            const left = figures.get(b.id) || 0;
            const label = el('label', { class: 'bk' }, radio, el('span', { class: 'bn', text: b.name }),
                el('span', { class: 'bv money', text: t('a.quickAdd.left', { amount: money(left) }) }),
                (category() && b.id === r.usualId) ? el('span', { class: 'bw', text: t('a.quickAdd.bucketFrom', { category: category().name }) }) : null);
            tint(label, b);
            bkGrid.appendChild(label);
        }
    }

    function renderEffect() {
        const cents = amountCents();
        if (s.kind === 'income') { effect.textContent = t('a.quickAdd.effectIncome'); return; }
        const r = resolved();
        const b = r.bucketId ? bucketById(r.bucketId) : null;
        if (!b) { effect.textContent = buckets.length ? t('a.quickAdd.effectChoose') : ''; return; }
        const after = afterThisCents(figures.get(b.id), cents || 0);
        effect.textContent = b.role === 'daily'
            ? t('a.quickAdd.effectLeft', { amount: money(after) })
            : t('a.quickAdd.effectBucket', { bucket: b.name, amount: money(after) });
    }

    function renderSave() {
        const cents = amountCents();
        const r = resolved();
        const b = r.bucketId ? bucketById(r.bucketId) : null;
        const needBucket = s.kind === 'spending' && buckets.length > 0 && !r.bucketId;
        const dateOk = isValidIsoDate(dateInput.value);
        let label;
        if (edit) label = t('a.quickAdd.saveChanges');
        else if (s.kind === 'income') label = cents ? t('a.quickAdd.saveIncome', { amount: money(cents) }) : t('a.quickAdd.save', { amount: '' }).trim();
        else if (cents && b) label = t('a.quickAdd.saveFrom', { amount: money(cents), bucket: b.name });
        else label = cents ? t('a.quickAdd.save', { amount: money(cents) }) : t('a.quickAdd.save', { amount: '' }).trim();
        saveBtn.textContent = label;
        saveBtn.disabled = s.busy || !cents || needBucket || !dateOk;
        saveWhy.textContent = !cents ? t('a.quickAdd.saveWhyAmount') : (needBucket ? t('a.quickAdd.saveWhyBucket') : '');
        saveBtn.setAttribute('aria-describedby', saveWhy.textContent ? 'qa-why' : '');
        if (!saveWhy.textContent) saveBtn.removeAttribute('aria-describedby');
    }

    function renderKind() {
        heading.textContent = edit ? t('a.quickAdd.titleEdit') : t(s.kind === 'income' ? 'a.quickAdd.titleIncome' : 'a.quickAdd.titleAdd');
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.kind === s.kind ? 'true' : 'false'));
        if (!edit) repeatRow.hidden = s.kind === 'income';
    }

    function renderAll() { renderKind(); renderChips(); renderCatNote(); renderBucket(); renderEffect(); renderSave(); }
    const refreshLight = () => { renderCatNote(); renderBucket(); renderEffect(); renderSave(); };

    // ---- behaviour ----
    function applyGuess() {
        if (s.manual || s.kind === 'income') return;
        const g = guessCategory(s.note, categories, data.rules || []);
        const changedOrder = g.categoryId !== s.orderId;
        s.categoryId = g.categoryId; s.guessed = g.guessed; s.orderId = g.categoryId;
        if (changedOrder) renderChips(); else chips.querySelectorAll('[data-id]').forEach((n) => n.setAttribute('aria-pressed', n.dataset.id === s.categoryId ? 'true' : 'false'));
    }

    function setKind(kind) {
        if (kind === s.kind) return;
        s.kind = kind; s.manual = false; s.guessed = false; s.choiceId = null;
        s.categoryId = kind === 'income' && catById('income') ? 'income' : null;
        s.orderId = s.categoryId;
        if (kind === 'spending') applyGuess();
        renderAll();
    }

    let modal = false;
    const wide = window.matchMedia ? window.matchMedia('(min-width: 1281px)') : { matches: false };
    function syncModal() {
        modal = !wide.matches;
        if (modal) panel.setAttribute('aria-modal', 'true'); else panel.removeAttribute('aria-modal');
    }
    const onWide = () => syncModal();
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    syncModal();

    function close({ restore = true } = {}) {
        if (wide.removeEventListener) wide.removeEventListener('change', onWide);
        layer.remove();
        document.body.classList.remove('qa-open');
        if (active && active.layer === layer) active = null;
        if (restore) restoreFocus();
    }

    async function afterChange({ planChanged = false } = {}) {
        if (planChanged && store.autoSave) store.autoSave.onDataChange();
        await refreshSpendCache();
        updateAllUI();
    }

    async function save() {
        const cents = amountCents();
        if (saveBtn.disabled || !cents) return;
        s.busy = true; renderSave();
        const r = resolved();
        const cat = s.kind === 'income' ? catById(s.categoryId) : category();
        const date = dateInput.value;
        const note = noteInput.value;
        try {
            if (edit) {
                const f = buildTransactionFields({ kind: s.kind, amountCents: cents, category: cat, note, date, store: r.store });
                const textNote = f.note;
                const next = { ...txn, date, amountCents: f.amountCents, categoryId: f.categoryId, note: textNote, status: 'ok',
                    description: textNote && textNote !== (txn.note || '') ? f.description : txn.description };
                if (r.store) next.bucketId = r.store; else delete next.bucketId;
                const prev = txn;
                await updateTransaction(next);
                close();
                await afterChange();
                showUndoToast({
                    message: t('a.quickAdd.updated', { name: next.description || t('a.quickAdd.entryFallback') }),
                    onUndo: async () => { await updateTransaction(prev); await afterChange(); },
                });
                return;
            }
            const row = makeTransaction(buildTransactionFields({ kind: s.kind, amountCents: cents, category: cat, note, date, store: r.store }));
            const res = await addTransactions([row]);
            if (!res || !res.added) throw new Error('not added');
            let planRes = null;
            if (s.repeat && s.kind === 'spending') {
                planRes = addPlanItem(data, buildRepeatPlanItem({ note, category: cat, amountCents: cents, frequency: s.freq, date, store: r.store }));
            }
            close();
            await afterChange({ planChanged: !!planRes });
            showUndoToast({
                message: planRes ? t('a.quickAdd.savedRepeat', { amount: money(cents), frequency: t(`a.quickAdd.freq.${s.freq}`).toLowerCase() }) : t('a.quickAdd.saved', { amount: money(cents) }),
                onUndo: async () => {
                    await deleteTransaction(row.id);
                    if (planRes) planRes.onUndo();
                    await afterChange({ planChanged: !!planRes });
                },
            });
        } catch (_) {
            s.busy = false; renderSave();
            showToast(t('a.quickAdd.failed'), 'error');
        }
    }

    async function remove() {
        if (!edit) return;
        const prev = txn;
        try {
            await deleteTransaction(prev.id);
        } catch (_) { showToast(t('a.quickAdd.failed'), 'error'); return; }
        close();
        await afterChange();
        showUndoToast({
            message: t('a.quickAdd.deleted', { name: prev.description || t('a.quickAdd.entryFallback') }),
            onUndo: async () => { await importTransactions([prev]); await afterChange(); },
        });
    }

    // ---- delegated events, all on the layer ----
    layer.addEventListener('click', (e) => {
        const n = e.target.closest('[data-qa]');
        if (!n || !layer.contains(n)) return;
        const act = n.getAttribute('data-qa');
        if (act === 'close') close();
        else if (act === 'kind') setKind(n.dataset.kind);
        else if (act === 'cat') {
            s.categoryId = n.dataset.id; s.manual = true; s.guessed = false;
            chips.querySelectorAll('[data-id]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.id === s.categoryId ? 'true' : 'false'));
            refreshLight();
        } else if (act === 'more') { s.moreOpen = !s.moreOpen; renderChips(); }
        else if (act === 'save') save();
        else if (act === 'delete') remove();
    });
    layer.addEventListener('input', (e) => {
        if (e.target === amountInput) { renderEffect(); renderSave(); }
        else if (e.target === noteInput) { s.note = noteInput.value; applyGuess(); refreshLight(); }
        else if (e.target === dateInput) renderSave();
    });
    layer.addEventListener('change', (e) => {
        const n = e.target;
        if (n.matches && n.matches('[data-qa="bucket"]')) { s.choiceId = n.value; refreshLight(); }
        else if (n === repeatBox) { s.repeat = repeatBox.checked; repeatRow.classList.toggle('on', s.repeat); }
        else if (n === freqSelect) s.freq = freqSelect.value;
    });
    bucketRow.addEventListener('toggle', () => { bucketRow.dataset.touched = '1'; });
    layer.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Enter' && (e.target === amountInput || e.target === noteInput)) { e.preventDefault(); save(); return; }
        if (modal) trapTab(e, panel);
    });

    renderAll();
    const focusAmount = () => { try { amountInput.focus({ preventScroll: true }); } catch (_) { amountInput.focus(); } };
    focusAmount();
    if (!getFocusables(panel).length) panel.setAttribute('tabindex', '-1');
    return { layer, edit, close, focusAmount };
}
