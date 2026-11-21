// Income sheets (owner: C6): the Salary and Set-hours layouts, the four withholding
// questions, "what we work out", and the Check against a payslip panel.
//
// The pure parts (layoutFor, sheetValuesFor, draftSource, applyIncomeValues, readoutFor,
// describeCheck, patchForFix, payAnchorFromNext) have no DOM and no storage. Every figure
// comes from withholdingForPay, calculateTotals and checkPayslip: none is typed in here
// (FT-R-75 D2). The pay date is asked as "next pay day" and stored as payAnchor, the one
// field for it (X-9). Medicare exemption and salary sacrifice are asked and answered with
// "not modelled yet" (FT-R-67).

import { t } from '../i18n/strings.js';
import { openSheet, hoursRule } from './sheet.js';
import { confirmDialog } from './confirm.js';
import { store } from '../state/store.js';
import { getPayCyclesPerYear } from '../utils.js';
import { withholdingForPay } from '../calc/withholding.js';
import { checkPayslip } from '../calc/payslip-check.js';
import { calculateTotals } from '../calc/calculations.js';
import { getCycle, addDays, addMonthsClamped, toIso, parseIso } from '../calc/pay-cycle.js';
import { taxTablesStatus } from '../calc/tax-tables/index.js';
import { acceptPayslipJob } from '../state/income-migration.js';

/** Legal minimum super shown when nothing is stored yet (a rate, not a payslip figure). */
export const DEFAULT_SUPER_PCT = 12;
const CYCLES = ['weekly', 'fortnightly', 'monthly', 'quarterly'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const aud = (n) => 'A$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const yesNo = (b) => (b ? 'yes' : 'no');
const todayIso = () => toIso(new Date());

// ── Pure ────────────────────────────────────────────────────────────────────

/** 'salary' | 'hours' for an employee source; null for Variable and Self-employed (they keep their editors). */
export function layoutFor(source) {
    if (!source || source.incomeType === 'variable' || source.incomeType === 'selfEmployed') return null;
    return Number(source.hourlyRate) > 0 && Number(source.hoursPerWeek) > 0 ? 'hours' : 'salary';
}

/** The pay date before a "next pay day": same day of month where the month allows it. */
export function payAnchorFromNext(nextIso, schedule) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextIso || '')) return null;
    if (schedule === 'weekly') return addDays(nextIso, -7);
    if (schedule === 'fortnightly') return addDays(nextIso, -14);
    if (schedule === 'monthly') {
        const day = parseIso(nextIso).getDate();
        for (let k = 1; k <= 12; k++) {
            const a = addMonthsClamped(nextIso, -k);
            if (parseIso(a).getDate() === day) return a;
        }
        return addMonthsClamped(nextIso, -1);
    }
    return null;
}

const HELP_OF = { yes: true, no: false, unsure: null };
const helpValue = (b) => (b === true ? 'yes' : b === false ? 'no' : 'unsure');

/** Initial sheet values from a stored source. `carry` overlays shared keys when switching layout. */
export function sheetValuesFor(source, layout, today = todayIso(), carry = null) {
    const s = source || {};
    const w = s.withholding || {};
    const cyc = CYCLES.includes(s.paySchedule) || s.paySchedule === 'yearly' ? s.paySchedule : 'fortnightly';
    let nextPay = '';
    if (s.payAnchor && cyc !== 'yearly' && cyc !== 'quarterly') {
        const c = getCycle({ ...s, incomeType: 'salaried', paySchedule: cyc }, today);
        if (c.mode === 'cycle') nextPay = c.nextPay;
    }
    const v = {
        name: s.name || '',
        enterAs: 'year',
        amount: Number(s.grossAnnual) > 0 ? round2(s.grossAnnual) : null,
        hourlyRate: layout === 'hours' && s.hourlyRate != null ? Number(s.hourlyRate) : null,
        hoursPerWeek: layout === 'hours' && s.hoursPerWeek != null ? Number(s.hoursPerWeek) : null,
        paySchedule: cyc,
        nextPay,
        superPct: s.superPct == null ? DEFAULT_SUPER_PCT : Number(s.superPct),
        claimsTaxFree: yesNo(w.claimsTaxFree !== false),
        hasStudyDebt: helpValue(w.hasStudyDebt),
        medicareExemption: yesNo(w.medicareExemption === true),
        extraPerPay: Number(w.extraPerPay) || 0,
        salarySacrifice: yesNo(s.salarySacrifice === true),
    };
    if (carry) for (const k of ['name', 'paySchedule', 'nextPay', 'superPct', 'claimsTaxFree', 'hasStudyDebt', 'medicareExemption', 'extraPerPay', 'salarySacrifice']) {
        if (carry[k] !== undefined && carry[k] !== null) v[k] = carry[k];
    }
    return v;
}

/** Gross a year from the sheet values. Keeps the stored figure when a per-payslip entry is only its rounding. */
export function grossAnnualFrom(values, layout, initial = {}) {
    const cycles = getPayCyclesPerYear(values.paySchedule);
    if (layout === 'hours') return round2((Number(values.hourlyRate) || 0) * (Number(values.hoursPerWeek) || 0) * 52);
    const amount = Number(values.amount) || 0;
    if (values.enterAs !== 'pay') return amount;
    const annual = round2(amount * cycles);
    if (initial.grossAnnual && initial.paySchedule === values.paySchedule
        && Math.abs(annual - initial.grossAnnual) <= cycles * 0.005 + 0.01) return round2(initial.grossAnnual);
    return annual;
}

/** A transient employee source built from the sheet values, with no payslip overrides. */
export function draftSource(values, layout, initial = {}) {
    return {
        name: values.name, incomeType: 'salaried', basis: 'salary',
        paySchedule: values.paySchedule,
        grossAnnual: grossAnnualFrom(values, layout, initial),
        invoicedPayPostTax: null, taxRemoved: null,
        withholding: {
            claimsTaxFree: values.claimsTaxFree !== 'no',
            hasStudyDebt: HELP_OF[values.hasStudyDebt] === true ? true : (HELP_OF[values.hasStudyDebt] === false ? false : null),
            medicareExemption: values.medicareExemption === 'yes',
            extraPerPay: Number(values.extraPerPay) || 0,
        },
    };
}

/** Writes the sheet values onto a stored source. Returns the source. */
export function applyIncomeValues(source, values, layout, initial = {}) {
    const gross = grossAnnualFrom(values, layout, initial);
    const prev = source.withholding || {};
    source.name = values.name;
    source.incomeType = 'salaried';
    source.basis = 'salary';
    source.paySchedule = values.paySchedule;
    source.grossAnnual = gross;
    if (layout === 'hours') {
        source.hourlyRate = Number(values.hourlyRate);
        source.hoursPerWeek = Number(values.hoursPerWeek);
        source.hoursPerCycle = round2((source.hoursPerWeek * 52) / getPayCyclesPerYear(values.paySchedule));
    } else {
        source.hourlyRate = null;
        source.hoursPerWeek = null;
    }
    source.superPct = values.superPct == null ? null : Number(values.superPct);
    source.salarySacrifice = values.salarySacrifice === 'yes';
    source.withholding = {
        ...prev,
        claimsTaxFree: values.claimsTaxFree !== 'no',
        hasStudyDebt: HELP_OF[values.hasStudyDebt] === undefined ? null : HELP_OF[values.hasStudyDebt],
        medicareExemption: values.medicareExemption === 'yes',
        extraPerPay: Number(values.extraPerPay) || 0,
    };
    // X-9: one stored field. The question is "next pay day"; payAnchor is the pay before it.
    const next = values.nextPay || '';
    const unchanged = next === (initial.nextPay || '') && values.paySchedule === initial.paySchedule;
    if (!unchanged) {
        if (next) {
            const a = payAnchorFromNext(next, values.paySchedule);
            if (a) source.payAnchor = a;
        } else if (initial.nextPay) {
            source.payAnchor = null;
        }
    }
    return source;
}

/** The "what we work out" figures, from the withholding engine and calculateTotals. */
export function readoutFor(values, layout, data, today = todayIso(), initial = {}) {
    const ds = draftSource(values, layout, initial);
    const cycles = getPayCyclesPerYear(ds.paySchedule);
    const gross = round2(ds.grossAnnual / cycles);
    if (!(gross > 0)) return null;
    const w = withholdingForPay({
        gross, cycle: ds.paySchedule, fy: today, claimsTaxFree: ds.withholding.claimsTaxFree,
        hasStudyDebt: ds.withholding.hasStudyDebt === true, extraPerPay: ds.withholding.extraPerPay,
    });
    const scratch = {
        incomeSources: [ds], primaryIncomeIndex: 0, taxBrackets: (data && data.taxBrackets) || [],
        taxSettings: null, dataVersion: 2, plan: [], allocation: [],
    };
    const totals = calculateTotals(scratch, { today: parseIso(today) });
    const rb = totals._refundOrBill;
    const superPct = values.superPct == null ? 0 : Number(values.superPct);
    const parts = [t('c.income.part.tax', { amount: fmtN(w.tax) })];
    if (ds.withholding.hasStudyDebt === true) parts.push(t('c.income.part.help', { amount: fmtN(w.help) }));
    if (ds.withholding.extraPerPay > 0) parts.push(t('c.income.part.extra', { amount: fmtN(ds.withholding.extraPerPay) }));
    return {
        gross, cycles, tax: w.tax, help: w.help, total: w.total, parts: parts.join(' + '),
        net: ds[`_netPerCycleWithheld`] != null ? ds._netPerCycleWithheld : round2(gross - w.total),
        owed: totals._annualTaxOwed, refund: rb ? { kind: rb.kind, amount: rb.amount } : null,
        superAnnual: round2(ds.grossAnnual * superPct / 100),
        helpUnsure: ds.withholding.hasStudyDebt === null,
        fy: taxTablesStatus(parseIso(today)).activeFy,
    };
}
const fmtN = (n) => Number(n).toLocaleString('en-AU');

/**
 * Turns a checkPayslip result into what the panel shows.
 * @returns {{state:'idle'|'match'|'cause'|'unexplained'|'truth', lines:string[], message:?string,
 *            fixes:{label:string, fix:object}[], grossProposal:?object, result:?object}}
 */
export function describeCheck(slip, draft, today = todayIso()) {
    const out = { state: 'idle', lines: [], message: null, fixes: [], grossProposal: null, result: null };
    if (!slip || !Number.isFinite(Number(slip.tax)) || slip.tax === null || slip.tax === '') {
        out.message = t('c.income.check.idle');
        return out;
    }
    const r = checkPayslip({ ...slip, tax: Number(slip.tax) }, draft, { today });
    out.result = r;
    out.grossProposal = r.grossProposal;
    if (r.payslipIsTruth) { out.state = 'truth'; out.message = r.message; return out; }
    if (r.expected == null) { out.message = t('c.income.check.idle'); return out; }
    const b = r.breakdown;
    const parts = [t('c.income.part.tax', { amount: fmtN(b.tax) })];
    if (b.help > 0) parts.push(t('c.income.part.help', { amount: fmtN(b.help) }));
    if (b.extra > 0) parts.push(t('c.income.part.extra', { amount: fmtN(b.extra) }));
    out.lines = [
        t('c.income.check.expected', { parts: parts.join(' + '), total: fmtN(r.expected) }),
        t('c.income.check.yours', { amount: fmtN(Number(slip.tax)) }),
    ];
    if (r.matches) { out.state = 'match'; return out; }
    out.message = r.message;
    out.lines.push(t('c.income.check.apart', { amount: fmtN(Math.abs(r.diff)) }));
    if (r.fix) {
        out.state = 'cause';
        out.fixes = [{ label: t(r.fix.labelKey, r.fix.params), fix: r.fix }];
    } else out.state = 'unexplained';
    return out;
}

/** The sheet-field patch for a one-tap fix descriptor (checkPayslip's `fix`), or null. */
export function patchForFix(fix) {
    if (!fix) return null;
    const patch = {};
    const one = (f) => {
        if (f.action === 'set-withholding') {
            if (f.field === 'hasStudyDebt') patch.hasStudyDebt = yesNo(f.value === true);
            else if (f.field === 'claimsTaxFree') patch.claimsTaxFree = yesNo(f.value !== false);
            else if (f.field === 'medicareExemption') patch.medicareExemption = yesNo(f.value === true);
            else if (f.field === 'extraPerPay') patch.extraPerPay = Number(f.value) || 0;
        } else if (f.action === 'set-salary-sacrifice') patch.salarySacrifice = 'yes';
    };
    one(fix);
    for (const a of fix.also || []) one(a);
    return Object.keys(patch).length ? patch : null;
}

// ── Sheet fields ────────────────────────────────────────────────────────────

function fieldsFor(layout, currentCycle) {
    const cyc = [...CYCLES, ...(currentCycle === 'yearly' ? ['yearly'] : [])]
        .map((v) => ({ value: v, label: t(`c.income.cycle.${v}`) }));
    const yn = [{ value: 'yes', label: t('c.income.yes') }, { value: 'no', label: t('c.income.no') }];
    const pay = layout === 'hours'
        ? [
            { key: 'hourlyRate', label: t('c.income.hourlyRate'), type: 'money', required: true },
            { key: 'hoursPerWeek', label: t('c.income.hoursPerWeek'), type: 'number', required: true },
        ]
        : [
            { key: 'enterAs', label: t('c.income.enterAs'), type: 'select', options: [{ value: 'year', label: t('c.income.enterAs.year') }, { value: 'pay', label: t('c.income.enterAs.pay') }] },
            { key: 'amount', label: t('c.income.gross.year'), type: 'money', required: true },
        ];
    return [
        { key: 'name', label: t('c.income.name'), type: 'text' },
        ...pay,
        { key: 'paySchedule', label: t('c.income.paid'), type: 'select', options: cyc },
        { key: 'nextPay', label: t('c.income.nextPay'), type: 'date', hint: t('c.income.nextPay.hint') },
        { key: 'superPct', label: t('c.income.super'), type: 'percent', hint: t('c.income.super.hint') },
        { key: 'claimsTaxFree', label: t('c.income.q.claimsTaxFree'), type: 'select', options: yn },
        { key: 'hasStudyDebt', label: t('c.income.q.hasStudyDebt'), type: 'select', options: [...yn, { value: 'unsure', label: t('c.income.unsure') }], hint: t('c.income.q.unsureHint') },
        { key: 'medicareExemption', label: t('c.income.q.medicare'), type: 'select', options: yn },
        { key: 'extraPerPay', label: t('c.income.q.extra'), type: 'money' },
        { key: 'salarySacrifice', label: t('c.income.q.sacrifice'), type: 'select', options: yn },
    ];
}

function validateValues(layout) {
    return (v) => {
        const e = {};
        if (layout === 'hours') {
            if (!(Number(v.hourlyRate) > 0)) e.hourlyRate = t('c.income.err.amount');
            if (!(Number(v.hoursPerWeek) > 0)) e.hoursPerWeek = t('c.income.err.hours');
        } else if (!(Number(v.amount) > 0)) e.amount = t('c.income.err.amount');
        if (v.nextPay && (!/^\d{4}-\d{2}-\d{2}$/.test(v.nextPay) || toIso(parseIso(v.nextPay)) !== v.nextPay)) e.nextPay = t('c.income.err.date');
        if (v.superPct != null && !(v.superPct >= 0 && v.superPct <= 100)) e.superPct = t('c.income.err.percent');
        if (v.extraPerPay != null && v.extraPerPay < 0) e.extraPerPay = t('c.income.err.extra');
        return e;
    };
}

function plausibilityFor(layout) {
    const hours = layout === 'hours' ? hoursRule({ field: 'hoursPerWeek' }) : () => [];
    return (v) => {
        const notes = hours(v);
        if (v.medicareExemption === 'yes') notes.push({ field: 'medicareExemption', message: t('c.income.notModelled.medicare') });
        if (v.salarySacrifice === 'yes') notes.push({ field: 'salarySacrifice', message: t('c.income.notModelled.sacrifice') });
        return notes;
    };
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

async function persist() {
    const [{ updateDataAndUI }, { renderIncomeSourcesSettings }] = await Promise.all([
        import('./render.js'), import('./settings-forms.js'),
    ]);
    renderIncomeSourcesSettings();
    updateDataAndUI();
}

/**
 * Opens the Salary or Set-hours sheet for income source `index`.
 * @returns {boolean} true once a sheet opened; false for a missing, Variable or Self-employed source
 *   (those keep their editors).
 */
export function openIncomeSheet(index, opts = {}) {
    const data = store.financeData;
    const source = data && data.incomeSources && data.incomeSources[index];
    const layout = opts.layout || layoutFor(source);
    if (!source || !layout || typeof document === 'undefined') return false;

    const today = todayIso();
    const initialVals = sheetValuesFor(source, layout, today);
    const initial = { grossAnnual: Number(source.grossAnnual) || 0, paySchedule: initialVals.paySchedule, nextPay: initialVals.nextPay };
    const values = sheetValuesFor(source, layout, today, opts.carry);

    const handle = openSheet({
        title: t(layout === 'hours' ? 'c.income.title.hours' : 'c.income.title.salary', { name: source.name || '' }),
        fields: fieldsFor(layout, source.paySchedule),
        values,
        saveLabel: t('c.income.save'),
        validate: validateValues(layout),
        plausibility: plausibilityFor(layout),
        onSave: async (v) => {
            applyIncomeValues(source, v, layout, initial);
            await persist();
        },
    });
    decorate(handle, { index, layout, source, data, initial, today });
    return true;
}

function decorate(handle, ctx) {
    const { layout, today, data, initial } = ctx;
    const form = handle.el.querySelector('form.sheet-body');
    const field = (k) => handle.el.querySelector(`[data-field="${k}"]`);
    const control = (k) => handle.el.querySelector(`[data-key="${k}"]`);

    // Layout switch
    const sw = node('button', 'ils-link', t(layout === 'hours' ? 'c.income.switch.toSalary' : 'c.income.switch.toHours'));
    sw.type = 'button';
    sw.addEventListener('click', () => {
        const carry = handle.getValues();
        handle.close();
        openIncomeSheet(ctx.index, { layout: layout === 'hours' ? 'salary' : 'hours', carry });
    });
    form.insertBefore(sw, form.firstChild);

    const sec = node('h3', 'ils-sec', t('c.income.section.withholding'));
    field('claimsTaxFree').before(sec);

    // Readout
    const readout = node('section', 'ils-card');
    readout.setAttribute('aria-labelledby', 'ils-readout-title');
    const rt = node('h3', 'ils-card-title', t('c.income.readout.title'));
    rt.id = 'ils-readout-title';
    const rbody = node('dl', 'ils-kv');
    rbody.setAttribute('aria-live', 'polite');
    readout.append(rt, rbody);

    // Check panel
    const check = node('section', 'ils-card');
    check.setAttribute('aria-labelledby', 'ils-check-title');
    const ct = node('h3', 'ils-card-title', t('c.income.check.title'));
    ct.id = 'ils-check-title';
    const intro = node('p', 'ils-muted', t('c.income.check.intro'));
    const grid = node('div', 'ils-slip');
    const slipInputs = {};
    for (const [k, key, type] of [['gross', 'c.income.check.gross', 'text'], ['tax', 'c.income.check.tax', 'text'], ['net', 'c.income.check.net', 'text'], ['date', 'c.income.check.date', 'date']]) {
        const wrap = node('div', 'ils-slip-f');
        const id = `ils-slip-${k}`;
        const lab = node('label', 'sheet-label', t(key));
        lab.htmlFor = id;
        const inp = node('input', 'sheet-input');
        inp.id = id; inp.type = type; inp.autocomplete = 'off';
        if (type === 'text') inp.inputMode = 'decimal';
        if (k === 'date') inp.value = today;
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runCheck(); } });
        slipInputs[k] = inp;
        wrap.append(lab, inp);
        grid.appendChild(wrap);
    }
    const upload = node('button', 'sheet-fix', t('c.income.check.upload'));
    upload.type = 'button';
    const file = node('input');
    file.type = 'file'; file.accept = '.pdf,application/pdf'; file.hidden = true;
    upload.addEventListener('click', () => { file.value = ''; file.click(); });
    const result = node('div', 'ils-result');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    check.append(ct, intro, grid, upload, file, result);

    form.insertBefore(readout, form.querySelector('.sheet-form-error'));
    form.insertBefore(check, form.querySelector('.sheet-form-error'));

    const setField = (k, v) => {
        const c = control(k);
        if (!c) return;
        c.value = v == null ? '' : String(v);
        c.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const num = (el) => { const x = parseFloat(String(el.value).replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : null; };
    let acceptedThisPay = false;

    function refreshReadout() {
        const v = handle.getValues();
        const lab = field('amount') && field('amount').querySelector('label');
        if (lab) lab.textContent = t(v.enterAs === 'pay' ? 'c.income.gross.pay' : 'c.income.gross.year');
        rbody.textContent = '';
        const r = readoutFor(v, layout, data, today, initial);
        if (!r) return;
        const row = (k, val) => { const d = node('div'); d.append(node('dt', '', k), node('dd', '', val)); rbody.appendChild(d); };
        row(t('c.income.readout.gross'), aud(r.gross));
        row(t('c.income.readout.withheld'), `${r.parts} = ${aud(r.total)}`);
        row(t('c.income.readout.net'), aud(r.net));
        if (r.owed != null) row(t('c.income.readout.owed'), aud(r.owed));
        if (r.refund) row(t('c.income.readout.refund'), t(`c.income.readout.refund.${r.refund.kind}`, { amount: fmtN(r.refund.amount) }));
        row(t('c.income.readout.super'), aud(r.superAnnual));
        if (r.helpUnsure) rbody.appendChild(node('p', 'ils-muted', t('c.income.readout.noHelpYet')));
        rbody.appendChild(node('p', 'ils-muted', t('c.income.readout.note')));
        rbody.appendChild(node('p', 'ils-muted', t('c.income.readout.tables', { fy: r.fy })));
    }

    function runCheck() {
        const v = handle.getValues();
        const tax = num(slipInputs.tax);
        const slip = { tax, gross: num(slipInputs.gross), date: slipInputs.date.value || today };
        const d = describeCheck(tax == null ? null : slip, draftSource(v, layout, initial), today);
        result.textContent = '';
        result.dataset.state = d.state;
        if (acceptedThisPay && d.state !== 'match') {
            result.appendChild(node('p', 'ils-msg', t('c.income.check.acceptedPay')));
            return;
        }
        if (d.state === 'idle') { result.appendChild(node('p', 'ils-muted', d.message)); return; }
        for (const l of d.lines.slice(0, 2)) result.appendChild(node('p', 'ils-line', l));
        if (d.state === 'match') {
            result.appendChild(node('p', 'ils-ok', t('c.income.check.matches')));
        } else if (d.state === 'truth') {
            result.appendChild(node('p', 'ils-msg', d.message));
        } else {
            if (d.lines[2]) result.appendChild(node('p', 'ils-line', d.lines[2]));
            result.appendChild(node('p', 'ils-msg', d.message));
            if (d.state === 'cause') {
                const acts = node('div', 'ils-acts');
                for (const f of d.fixes) {
                    const b = node('button', 'sheet-fix', f.label);
                    b.type = 'button';
                    b.addEventListener('click', () => {
                        const patch = patchForFix(f.fix);
                        if (patch) {
                            for (const [k, val] of Object.entries(patch)) setField(k, val);
                            runCheck();
                            result.appendChild(node('p', 'ils-muted', t('c.income.check.fixed')));
                        } else {
                            acceptedThisPay = true; // overtime: this pay only, the stored gross is untouched
                            runCheck();
                        }
                    });
                    acts.appendChild(b);
                }
                const no = node('button', 'sheet-fix', t('c.income.check.notNow'));
                no.type = 'button';
                no.addEventListener('click', () => { acceptedThisPay = true; runCheck(); });
                acts.appendChild(no);
                result.appendChild(acts);
            }
            result.appendChild(node('p', 'ils-muted', t('c.income.check.others')));
        }
        const gp = d.grossProposal;
        if (gp && gp.needsConfirm && layout === 'salary') {
            result.appendChild(node('p', 'ils-line', t('c.income.check.grossDiff', { proposed: fmtN(gp.proposed), current: fmtN(gp.current) })));
            const b = node('button', 'sheet-fix', t('c.income.check.grossUse'));
            b.type = 'button';
            b.addEventListener('click', async () => {
                const cyc = getPayCyclesPerYear(handle.getValues().paySchedule);
                const ok = await confirmDialog({
                    title: t('c.income.check.grossTitle'),
                    body: t('c.income.check.grossBody', { proposed: fmtN(round2(gp.proposed * cyc)), current: fmtN(round2(gp.current * cyc)) }),
                    confirmLabel: t('c.income.check.grossConfirm'),
                });
                if (!ok) return;
                setField('enterAs', 'year');
                setField('amount', round2(gp.proposed * cyc));
                runCheck();
            });
            result.appendChild(b);
        }
    }

    file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        result.textContent = '';
        result.appendChild(node('p', 'ils-muted', t('c.income.check.reading')));
        try {
            const { readPayslip } = await import('../import/pdf-ui.js');
            const parsed = await readPayslip(f, () => {}, () => {});
            if (!parsed) { result.textContent = ''; result.appendChild(node('p', 'ils-msg', t('c.income.check.uploadFailed'))); return; }
            if (parsed.gross != null) slipInputs.gross.value = String(parsed.gross);
            if (parsed.tax != null) slipInputs.tax.value = String(parsed.tax);
            if (parsed.net != null) slipInputs.net.value = String(parsed.net);
            acceptedThisPay = false;
            runCheck();
        } catch (_) {
            result.textContent = '';
            result.appendChild(node('p', 'ils-msg', t('c.income.check.uploadFailed')));
        }
    });

    const refresh = () => { refreshReadout(); if (slipInputs.tax.value !== '') runCheck(); };
    handle.layer.addEventListener('input', (e) => {
        if (e.target.closest('.ils-slip')) { acceptedThisPay = false; runCheck(); return; }
        // A year and per-payslip entry swap the amount so the figure on screen stays true.
        if (e.target.dataset && e.target.dataset.key === 'enterAs') {
            const cyc = getPayCyclesPerYear(handle.getValues().paySchedule);
            const amt = Number(handle.getValues().amount);
            if (amt > 0) setField('amount', round2(e.target.value === 'pay' ? amt / cyc : amt * cyc));
            return;
        }
        refresh();
    });
    handle.layer.addEventListener('change', (e) => { if (e.target.closest('.ils-slip')) runCheck(); });
    refreshReadout();
    runCheck();
}

/** Offer for a source flagged `migrationPrompt:'payslip-job'` (C4). Accepting uses acceptPayslipJob. */
export function acceptPayslipJobOffer(index) {
    const source = store.financeData && store.financeData.incomeSources[index];
    if (!source || !acceptPayslipJob(source)) return false;
    persist().then(() => openIncomeSheet(index));
    return true;
}

/** "Not now": the prompt is removed and never comes back. */
export function dismissPayslipJobOffer(index) {
    const source = store.financeData && store.financeData.incomeSources[index];
    if (!source || source.migrationPrompt !== 'payslip-job') return false;
    delete source.migrationPrompt;
    persist();
    return true;
}
