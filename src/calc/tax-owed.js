// Annual tax owed, LITO, and refund-or-bill for one income year. Pure and DOM-free.
// The tax year is picked by DATE from the shipped tables (FT-R-66, FT-R-86). The saved
// `taxBrackets` copy and any stored year are never read (FT-R-97): this is what makes
// the A$627 stale-brackets trap impossible. It is an estimate: single resident, no MLS,
// no offsets beyond LITO, and the pay count is cycles per year (26 fortnights, but a
// year can hold 27 pays).

import { resolveTablesForDate } from './tax-tables/index.js';
import { incomeAfterDeduction, yearEndLevies } from './tax-au.js';
import { expectedPay } from './withholding.js';

const cents = (n) => Math.round((Number(n) || 0) * 100 + 1e-9) / 100;
const CYCLES_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 };

/** Tax on a taxable income from a table's brackets, before offsets. */
function bracketTax(income, brackets) {
    let tax = 0;
    for (const b of brackets) {
        const max = b.max == null ? Infinity : b.max;
        const inBand = Math.min(income, max) - b.min;
        if (inBand > 0) tax += inBand * b.rate;
    }
    return tax;
}

/** Low income tax offset for a taxable income (dated table data in each year file). */
export function litoFor(taxableIncome, date) {
    const l = resolveTablesForDate(date || new Date()).tables.lito;
    const inc = Number(taxableIncome) || 0;
    if (!l || inc <= 0) return 0;
    let off;
    if (inc <= l.fullUntil) off = l.maxOffset;
    else if (inc <= l.step1Until) off = l.maxOffset - (inc - l.fullUntil) * l.rate1;
    else if (inc < l.endsAt) off = l.base2 - (inc - l.step1Until) * l.rate2;
    else off = 0;
    return cents(Math.max(0, off));
}

/**
 * Working Australians tax offset (FT-R-131): the lesser of the table's maximum and the tax still payable after LITO,
 * and only when the year's table carries it (a held year never does). Never refundable.
 */
export function watoFor(taxAfterLito, tables) {
    const w = tables && tables.wato;
    if (!w || !(w.max > 0)) return 0;
    return cents(Math.min(w.max, Math.max(0, Number(taxAfterLito) || 0)));
}

/**
 * Annual owed for one income year picked by `date`. Extra input fields (such as a saved
 * `taxBrackets`) are ignored by design.
 * From 2026-27 the year's standard deduction comes off first (the lesser of it and the income), unless
 * `workDeductions` is higher; the deduction is the lesser of it and `labourIncome` (employee sources, default all of
 * the income). `privateCover: false` adds the Medicare levy surcharge on the income after the deduction.
 * @param {{taxableIncome:number, date?:Date|string, hasStudyDebt?:boolean, repaymentIncome?:number,
 *   workDeductions?:number, privateCover?:boolean, labourIncome?:number}} p
 * @returns {{fy:string, stale:boolean, taxableIncome:number, deduction:number, deductionKind:string, tax:number, lito:number,
 *   wato:number, medicare:number, mls:number, help:number, total:number, estimate:true}}
 */
export function annualOwed({ taxableIncome, date, hasStudyDebt = false, repaymentIncome, workDeductions = 0, privateCover, labourIncome }) {
    const { tables, fy, stale } = resolveTablesForDate(date || new Date());
    const gross = Math.max(0, Number(taxableIncome) || 0);
    const ded = incomeAfterDeduction(gross, tables, { labourIncome, workDeductions });
    const income = ded.income;
    const lito = litoFor(income, date);
    const afterLito = Math.max(0, bracketTax(income, tables.brackets) - lito);
    // The offset is capped at the tax on labour income alone (employee income after the deduction).
    const labour = labourIncome == null ? gross : Math.min(gross, Math.max(0, Number(labourIncome) || 0));
    const wato = watoFor(Math.min(afterLito, bracketTax(Math.max(0, labour - ded.deduction), tables.brackets)), tables);
    const tax = cents(Math.max(0, afterLito - wato));
    const lv = yearEndLevies(income, tables, { privateCover, help: hasStudyDebt, helpIncome: repaymentIncome });
    const medicare = cents(lv.medicare), mls = cents(lv.mls), help = cents(lv.help);
    return { fy, stale, taxableIncome: cents(income), deduction: cents(ded.deduction), deductionKind: ded.kind, tax, lito, wato, medicare, mls, help, total: cents(tax + medicare + mls + help), estimate: true };
}

/**
 * Refund or bill = withheld (per pay x cycles, or a given total) minus owed.
 * A withheld surplus is a refund. Always an estimate.
 * @returns {{withheld:number, owed:number, amount:number, kind:'refund'|'bill'|'even', estimate:true, label:string}}
 */
export function refundOrBill({ withheldPerPay, cycles, withheld, owed }) {
    const w = withheld != null ? cents(withheld) : cents((Number(withheldPerPay) || 0) * (Number(cycles) || 0));
    const o = cents(owed);
    const diff = cents(w - o);
    const kind = diff > 0 ? 'refund' : diff < 0 ? 'bill' : 'even';
    const label = kind === 'refund' ? 'Estimated refund' : kind === 'bill' ? 'Estimated bill' : 'Estimated break-even';
    return { withheld: w, owed: o, amount: Math.abs(diff), kind, estimate: true, label };
}

/**
 * Annual estimate across income sources. Taxable income and withholding are summed;
 * HELP applies on the TOTAL repayment income when any source declares study debt
 * (FT-R-75 D10). The optional third argument (a saved data object) is ignored. The fourth carries the person's
 * private hospital cover answer and any work deductions they have entered.
 * @param {object[]} sources - { paySchedule, grossAnnual, hasStudyDebt, claimsTaxFree, extraPerPay, withheldPerPay? }
 */
export function annualEstimateForSources(sources, date, _data, { privateCover, workDeductions } = {}) {
    const list = Array.isArray(sources) ? sources : [];
    const { fy } = resolveTablesForDate(date || new Date());
    let taxableIncome = 0, withheld = 0, anyDebt = false, labourIncome = 0;
    for (const s of list) {
        const ep = expectedPay(s, fy);
        const cycles = CYCLES_PER_YEAR[ep.cycle] || 26;
        taxableIncome += ep.gross * cycles;
        if (s.incomeType !== 'selfEmployed' && s.incomeType !== 'variable') labourIncome += ep.gross * cycles;
        const perPay = s.withheldPerPay != null ? Number(s.withheldPerPay) || 0 : ep.total;
        withheld += perPay * cycles;
        if (s.hasStudyDebt) anyDebt = true;
    }
    taxableIncome = cents(taxableIncome);
    const owed = annualOwed({ taxableIncome, date, hasStudyDebt: anyDebt, privateCover, workDeductions, labourIncome: cents(labourIncome) });
    const rb = refundOrBill({ withheld, owed: owed.total });
    return { fy, taxableIncome, owed, withheld: rb.withheld, amount: rb.amount, kind: rb.kind, label: rb.label, withheldTotal: cents(withheld), estimate: true };
}
