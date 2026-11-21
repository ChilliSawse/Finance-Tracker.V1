// Payslip check (C5): line one payslip up against what Ledger expects to be withheld, and
// name the likely cause of a gap with a one-tap fix descriptor (data only; UI comes later).
// Pure and DOM-free. Display figure = the component sum (tax + HELP + extra), FT-R-68.
// The tax year is the payslip's own date (FT-R-86). A payslip dated before the 24 Sep 2025
// HELP-scale change is not checked: "payslip is the truth" (FT-R-75 D6).

import { withholdingForPay } from './withholding.js';
import { t } from '../i18n/strings.js';

/** First day the 2025-26 study-loan scale is trusted (FT-R-75 D6). */
export const PAYSLIP_TRUTH_BEFORE = '2025-09-24';

const WEEKS_PER_PAY = { weekly: 52 / 52, fortnightly: 2, monthly: 52 / 12, quarterly: 13 };
const cycleOf = (c) => (WEEKS_PER_PAY[c] ? c : 'fortnightly');

/** Match tolerance in whole dollars: one dollar per weekly step = ceil(weeks per pay). */
export function toleranceFor(cycle) {
    return Math.ceil(WEEKS_PER_PAY[cycleOf(cycle)] - 1e-9);
}

const CYCLES_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4 };
const money = (n) => Math.abs(Math.round(n)).toLocaleString('en-AU');
const fix = (action, field, value, labelKey, params) => ({ action, field, value, labelKey, params: params || {} });

/**
 * @param {{tax:number, gross?:?number, date?:string}} payslip  plain dollars; date ISO (its own date)
 * @param {object} source  income source: paySchedule, grossAnnual, withholding {claimsTaxFree,
 *        hasStudyDebt, medicareExemption, extraPerPay}
 * @param {{today?:string}} [opts]
 * @returns {{matches:boolean, expected:?number, diff:?number, tolerance:?number, likelyCause:?string,
 *            message:?string, fix:?object, useActuals:boolean, unexplainedPerPay:?number,
 *            payslipIsTruth:boolean, grossProposal:?object, breakdown:?object}}
 */
export function checkPayslip(payslip, source, opts = {}) {
    const p = payslip || {};
    const s = source || {};
    const w = s.withholding || {};
    const out = {
        matches: false, expected: null, diff: null, tolerance: null, likelyCause: null, message: null,
        fix: null, useActuals: true, unexplainedPerPay: null, payslipIsTruth: false, grossProposal: null, breakdown: null,
    };
    const tax = Number(p.tax);
    if (!Number.isFinite(tax)) return out;

    const date = p.date || opts.today || new Date().toISOString().slice(0, 10);
    if (date < PAYSLIP_TRUTH_BEFORE) {
        out.payslipIsTruth = true;
        out.message = t('c.payslip.truth');
        return out;
    }

    const cycle = cycleOf(s.paySchedule);
    const tol = toleranceFor(cycle);
    const storedGross = Number(s.grossAnnual) > 0
        ? Math.round((Number(s.grossAnnual) / CYCLES_PER_YEAR[cycle]) * 100) / 100 : null;
    const slipGross = Number(p.gross) > 0 ? Number(p.gross) : null;
    const gross = storedGross ?? slipGross;
    if (gross == null) return out;

    const base = {
        cycle, fy: date, claimsTaxFree: w.claimsTaxFree !== false,
        hasStudyDebt: !!w.hasStudyDebt, extraPerPay: w.extraPerPay,
    };
    const calc = (over) => withholdingForPay({ gross, ...base, ...over });
    const exp = calc({});
    const diff = Math.round((tax - exp.total) * 100) / 100;
    out.expected = exp.total;
    out.diff = diff;
    out.tolerance = tol;
    out.breakdown = { tax: exp.tax, help: exp.help, extra: exp.total - exp.tax - exp.help };
    // A payslip gross that differs from the stored one is only ever proposed, never applied.
    if (slipGross != null && storedGross != null && Math.abs(slipGross - storedGross) > 0.5) {
        out.grossProposal = { current: storedGross, proposed: slipGross, needsConfirm: true };
    }
    if (Math.abs(diff) <= tol) {
        out.matches = true;
        out.useActuals = false;
        return out;
    }
    const near = (a) => Math.abs(tax - a) <= tol;
    const set = (cause, key, params, f) => {
        out.likelyCause = cause;
        out.message = t(key, params);
        out.fix = f;
        out.useActuals = false;
        return out;
    };

    // 1. HELP / no HELP, 2. tax-free threshold, (both toggled counts as the threshold)
    const helpOn = calc({ hasStudyDebt: true });
    const helpOff = calc({ hasStudyDebt: false });
    if (!base.hasStudyDebt && near(helpOn.total)) {
        return set('help', 'c.payslip.cause.help', { amount: money(helpOn.help) },
            fix('set-withholding', 'hasStudyDebt', true, 'c.payslip.fix.help'));
    }
    if (base.hasStudyDebt && near(helpOff.total)) {
        return set('no-help', 'c.payslip.cause.noHelp', { amount: money(exp.help) },
            fix('set-withholding', 'hasStudyDebt', false, 'c.payslip.fix.noHelp'));
    }
    const flipTft = !base.claimsTaxFree ? true : false;
    for (const hd of [base.hasStudyDebt, !base.hasStudyDebt]) {
        const alt = calc({ claimsTaxFree: flipTft, hasStudyDebt: hd });
        if (near(alt.total)) {
            const fixes = [fix('set-withholding', 'claimsTaxFree', flipTft, 'c.payslip.fix.tft')];
            if (hd !== base.hasStudyDebt) fixes.push(fix('set-withholding', 'hasStudyDebt', hd, hd ? 'c.payslip.fix.help' : 'c.payslip.fix.noHelp'));
            return set('tft-claimed', flipTft ? 'c.payslip.cause.tftOn' : 'c.payslip.cause.tftOff',
                { amount: money(diff) }, { ...fixes[0], also: fixes.slice(1) });
        }
    }

    // 3. Salary sacrifice (a lower taxable pay explains a lower tax), overtime or allowances
    // (a higher gross on the payslip explains a higher tax), extra withholding, Medicare.
    if (diff < 0) {
        const levy = Math.round(gross * 0.02);
        if (!w.medicareExemption && Math.abs(diff + levy) <= tol + 1) {
            return set('medicare-exemption', 'c.payslip.cause.medicare', { amount: money(levy) },
                fix('set-withholding', 'medicareExemption', true, 'c.payslip.fix.medicare'));
        }
        for (let sac = 1; sac < gross / 2; sac++) {
            if (near(withholdingForPay({ gross: gross - sac, ...base }).total)) {
                return set('salary-sacrifice', 'c.payslip.cause.sacrifice', { amount: money(sac) },
                    fix('set-salary-sacrifice', 'salarySacrificePerPay', sac, 'c.payslip.fix.sacrifice'));
            }
        }
    } else {
        if (slipGross != null && slipGross > gross + tol) {
            const atSlip = withholdingForPay({ gross: slipGross, ...base });
            if (Math.abs(tax - atSlip.total) <= tol) {
                return set('overtime', 'c.payslip.cause.overtime', { amount: money(slipGross - gross) },
                    fix('use-payslip-gross', 'gross', slipGross, 'c.payslip.fix.overtime'));
            }
        }
        const extra = Math.round(Number(w.extraPerPay) || 0) + Math.round(diff);
        if (diff <= exp.tax) return set('extra-withholding', 'c.payslip.cause.extra', { amount: money(diff) },
            fix('set-withholding', 'extraPerPay', extra, 'c.payslip.fix.extra'));
    }

    // 4. Nothing explains it: the payslip is the truth, the gap carries forward.
    out.unexplainedPerPay = diff;
    out.useActuals = true;
    out.message = t('c.payslip.unexplained', { amount: money(diff) });
    return out;
}
