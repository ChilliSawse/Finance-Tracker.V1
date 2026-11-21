// What If, the Compare view (owner: F8b, FT-R-89). Exactly two columns, Now and this scenario; the six preset chips;
// a "Best on each row" toggle that marks the leader with a word, not a colour. No picker, no saved scenarios as columns,
// no Advanced view (phase 3). The step buttons and the Make this real slot are F7's (index.js).

import { t } from '../../i18n/strings.js';
import { buildResultSet, rowsForPreset, bestOf, diffOf, PRESETS, DEFAULT_PRESET } from './results.js';

// Per-visit choices, not saved data.
const view = { preset: DEFAULT_PRESET, best: true };

export function compareState() { return { ...view }; }
export function setComparePreset(id) { if (PRESETS.includes(id)) view.preset = id; }
export function setBestOnEachRow(on) { view.best = !!on; }

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

/** The two columns as data: [{id:'now'|'scen', title, items:[{rowId,label,text,best:boolean}]}]. Pure given a set. */
export function columnsFor(set, preset, showBest, scenarioName) {
    const rows = rowsForPreset(set, preset);
    const col = (id, title) => ({
        id, title,
        items: rows.map((r) => ({ rowId: r.id, label: r.label, text: (id === 'now' ? r.now : r.scen).text || t('f.res.dash'), best: showBest && bestOf(r) === id })),
    });
    return [col('now', t('f.res.col.now')), col('scen', scenarioName || t('f.wi.untitled'))];
}

export function renderCompare(container, ctx) {
    const { scenario, data, today } = ctx;
    container.textContent = '';
    if (!scenario || !scenario.changes.length) { container.appendChild(el('p', 'muted', t('f.res.empty'))); return; }
    const set = buildResultSet(data, scenario.changes, today);

    const ctrls = el('div', 'cmp-ctrls');
    const toggle = el('button', 'toggle', '');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', String(view.best));
    const sw = el('span', 'sw');
    sw.setAttribute('aria-hidden', 'true');
    toggle.append(sw, document.createTextNode(t('f.res.best.toggle')));
    toggle.addEventListener('click', () => { setBestOnEachRow(!view.best); renderCompare(container, ctx); });
    const chips = el('div', 'chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('f.res.show'));
    for (const id of PRESETS) {
        const c = el('button', 'chip', t(`f.res.preset.${id}`));
        c.type = 'button';
        c.dataset.preset = id;
        c.setAttribute('aria-pressed', String(view.preset === id));
        c.addEventListener('click', () => { setComparePreset(id); renderCompare(container, ctx); });
        chips.appendChild(c);
    }
    ctrls.append(chips, toggle);
    container.appendChild(ctrls);
    container.appendChild(el('p', 'muted cmp-note', t('f.res.compare.note')));

    const cols = el('div', 'cols');
    const rows = rowsForPreset(set, view.preset);
    if (!rows.length) container.appendChild(el('p', 'muted', t('f.res.compare.noRows')));
    for (const col of columnsFor(set, view.preset, view.best, scenario.name)) {
        const box = el('div', `col ${col.id}`);
        const h = el('h3');
        const dot = el('i', `cd ${col.id}`);
        dot.setAttribute('aria-hidden', 'true');
        h.append(dot, document.createTextNode(col.title));
        const dl = el('dl');
        for (const item of col.items) {
            const row = el('div');
            const dt = el('dt', '', item.label);
            const dd = el('dd');
            dd.appendChild(document.createTextNode(item.text));
            if (item.best) dd.append(document.createTextNode(' '), el('span', 'best', t('f.res.best.word')));
            if (col.id === 'scen') {
                const r = rows.find((x) => x.id === item.rowId);
                const d = diffOf(r);
                if (d.text && d.dir !== 'same') dd.append(document.createTextNode(' '), el('span', 'muted cmp-diff', `(${d.text})`));
            }
            row.append(dt, dd);
            dl.appendChild(row);
        }
        box.append(h, dl);
        cols.appendChild(box);
    }
    container.appendChild(cols);
}
