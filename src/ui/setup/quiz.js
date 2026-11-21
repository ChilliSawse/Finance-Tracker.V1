// The about-you quiz (Phase 1 step C7; FT-R-30, survey 03c section 2). Pure model plus the step.
// Tap-only questions, one a screen, each with a "why we ask" line. The answers choose a pay layout:
// they never become fields of their own. Other income (government support and the rest) is never
// a quiz question. Layouts that need phase 2 (Shifts & casual, Business) land in the existing
// editors with a "full layout coming" note (FT-R-68). GST is not asked here: nothing in phase 1
// would store the answer.

import { t } from '../../i18n/strings.js';
import { esc } from '../html.js';
import { registerSetupStep, STEP_ORDER } from './registry.js';

const KNOWN_NAMES = new Set(['', 'New Income Source', 'New Income']);

// ---------- pure: the question list ----------

/** Questions that apply given the answers so far, in order. */
export function quizQuestions(answers = {}) {
    const qs = [{ id: 'jobs', kind: 'jobs', job: null }];
    const n = answers.jobs === 'many' ? 2 : answers.jobs === 'one' ? 1 : 0;
    for (let i = 0; i < n; i++) {
        qs.push({ id: `how${i}`, kind: 'how', job: i });
        if (answers[`how${i}`] !== 'payslip') continue;
        qs.push({ id: `same${i}`, kind: 'same', job: i });
        if (answers[`same${i}`] === 'no') qs.push({ id: `hours${i}`, kind: 'hours', job: i });
    }
    return qs;
}

/** The options of a question kind: [value, label key, optional why key]. */
export function quizOptions(kind) {
    return {
        jobs: [['one', 'c.setup.q.jobs.one'], ['many', 'c.setup.q.jobs.many']],
        how: [['payslip', 'c.setup.q.how.payslip', 'c.setup.q.how.payslip.why'], ['invoice', 'c.setup.q.how.invoice', 'c.setup.q.how.invoice.why'],
            ['app', 'c.setup.q.how.app', 'c.setup.q.how.app.why']],
        same: [['yes', 'c.setup.q.same.yes', 'c.setup.q.same.yes.why'], ['no', 'c.setup.q.same.no', 'c.setup.q.same.no.why']],
        hours: [['set', 'c.setup.q.hours.set'], ['change', 'c.setup.q.hours.change', 'c.setup.q.hours.change.why']],
    }[kind] || [];
}

export function quizComplete(answers = {}) {
    return quizQuestions(answers).every((q) => !!answers[q.id]);
}

/** 'salary' | 'hours' | 'shifts' | 'business' for job i, or null until answered. */
export function layoutForJob(answers = {}, i = 0) {
    const how = answers[`how${i}`];
    if (how === 'invoice' || how === 'app') return 'business';
    if (how !== 'payslip') return null;
    const same = answers[`same${i}`];
    if (same === 'yes') return 'salary';
    if (same !== 'no') return null;
    const hours = answers[`hours${i}`];
    return hours === 'set' ? 'hours' : hours === 'change' ? 'shifts' : null;
}

/** The layouts the answers choose, one per job. */
export function layoutsFromAnswers(answers = {}) {
    const n = answers.jobs === 'many' ? 2 : answers.jobs === 'one' ? 1 : 0;
    return Array.from({ length: n }, (_, i) => layoutForJob(answers, i));
}

/** Phase 2 layouts keep the existing editors. */
export const needsLaterLayout = (layout) => layout === 'shifts' || layout === 'business';

/** Quiz answers that describe what is already saved, so running setup again starts from the truth. */
export function answersFromData(data) {
    const all = (data && Array.isArray(data.incomeSources)) ? data.incomeSources : [];
    const a = {};
    if (!all.length) return a;
    a.jobs = all.length > 1 ? 'many' : 'one';
    all.slice(0, 2).forEach((s, i) => {
        if (!s) return;
        if (s.incomeType === 'selfEmployed') { a[`how${i}`] = 'invoice'; return; }
        a[`how${i}`] = 'payslip';
        if (s.incomeType === 'variable') { a[`same${i}`] = 'no'; a[`hours${i}`] = 'change'; return; }
        if (Number(s.hourlyRate) > 0 && Number(s.hoursPerWeek) > 0) { a[`same${i}`] = 'no'; a[`hours${i}`] = 'set'; return; }
        a[`same${i}`] = 'yes';
    });
    return a;
}

// ---------- pure: writing the answers ----------

function blankSource(name) {
    return {
        name, incomeType: 'salaried', grossAnnual: 0, paySchedule: 'fortnightly', hoursPerCycle: 0, taxRemoved: null, invoicedPayPostTax: null,
        hourlyRate: null, hoursPerWeek: null, superPct: null, basis: 'salary', taxCheck: null,
        withholding: { claimsTaxFree: true, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0 },
    };
}

/**
 * Make the income sources match the answers. Adds a source when there are fewer than the answers
 * name; never removes one; keeps every figure already entered. Returns the layouts per job.
 */
export function applyQuiz(data, answers) {
    if (!Array.isArray(data.incomeSources)) data.incomeSources = [];
    const layouts = layoutsFromAnswers(answers);
    layouts.forEach((layout, i) => {
        if (!layout) return;
        let s = data.incomeSources[i];
        const added = !s;
        if (!s) {
            s = blankSource(t('c.setup.job.n', { n: i + 1 }));
            data.incomeSources.push(s);
        }
        if (KNOWN_NAMES.has(String(s.name || ''))) s.name = i === 0 ? t('c.setup.job.first') : t('c.setup.job.n', { n: i + 1 });
        if (!s.withholding) s.withholding = { claimsTaxFree: i === 0, hasStudyDebt: null, medicareExemption: false, extraPerPay: 0 };
        if (layout === 'business') {
            s.incomeType = 'selfEmployed'; s.basis = 'selfEmployed';
        } else if (layout === 'shifts') {
            s.incomeType = 'variable'; s.basis = 'variable';
            if (!Array.isArray(s.incomeEvents)) s.incomeEvents = [];
        } else {
            s.incomeType = 'salaried'; s.basis = 'salary';
            if (layout === 'salary') { s.hourlyRate = null; s.hoursPerWeek = null; }
        }
        // the main job claims the tax-free threshold; a second job asks (survey 03c section 2)
        if (added && i > 0) s.withholding.claimsTaxFree = false;
    });
    if (layouts.length) data.primaryIncomeIndex = Math.min(data.primaryIncomeIndex || 0, data.incomeSources.length - 1);
    return layouts;
}

// ---------- the step ----------

function qState(ctx) {
    if (!ctx.state.quiz) ctx.state.quiz = { answers: answersFromData(ctx.data), qi: 0 };
    return ctx.state.quiz;
}

function jobKicker(ctx, q) {
    if (q.job === null) return '';
    const total = qState(ctx).answers.jobs === 'many' ? 2 : 1;
    const s = ctx.data.incomeSources && ctx.data.incomeSources[q.job];
    const name = s && !KNOWN_NAMES.has(String(s.name || '')) ? s.name : (q.job === 0 ? t('c.setup.job.first') : t('c.setup.job.n', { n: q.job + 1 }));
    return t('c.setup.q.kicker', { i: q.job + 1, n: total, name });
}

export function renderQuiz(ctx) {
    const st = qState(ctx);
    const qs = quizQuestions(st.answers);
    st.qi = Math.max(0, Math.min(st.qi, qs.length - 1));
    const q = qs[st.qi];
    const picked = st.answers[q.id];
    const opts = quizOptions(q.kind).map(([value, label, why]) => `
        <label class="su-opt${picked === value ? ' on' : ''}"><input type="radio" name="su-q" value="${esc(value)}"${picked === value ? ' checked' : ''} data-su-change="answer">
        <span class="o-body"><b>${esc(t(label))}</b>${why ? `<span class="o-why">${esc(t(why))}</span>` : ''}</span></label>`).join('');
    const kicker = jobKicker(ctx, q);
    const later = q.job !== null && picked && needsLaterLayout(layoutForJob(st.answers, q.job));
    return `${kicker ? `<p class="su-k">${esc(kicker)}</p>` : ''}
        <h2 class="su-q" id="su-q">${esc(t(`c.setup.q.${q.kind}`))}</h2>
        <div class="su-opts" role="radiogroup" aria-labelledby="su-q">${opts}</div>
        <p class="su-why"><b>${esc(t('c.setup.why'))}</b> ${esc(t(`c.setup.q.${q.kind}.why`))}</p>
        ${q.kind === 'jobs' ? `<p class="su-fine">${esc(t('c.setup.q.jobs.more'))}</p>` : ''}
        ${later ? `<p class="su-note" role="note">${esc(t('c.setup.q.later'))}</p>` : ''}`;
}

export const quizStep = {
    id: 'quiz',
    order: STEP_ORDER.quiz,
    title: t('c.setup.quiz.title'),
    render: renderQuiz,
    actions: {
        answer(ctx, el) {
            const st = qState(ctx);
            const q = quizQuestions(st.answers)[st.qi];
            st.answers[q.id] = el.value;
            ctx.refresh();
        },
    },
    validate(ctx) {
        const st = qState(ctx);
        const q = quizQuestions(st.answers)[st.qi];
        return st.answers[q.id] ? null : t('c.setup.q.pick');
    },
    onNext(ctx) {
        const st = qState(ctx);
        const qs = quizQuestions(st.answers);
        if (st.qi < qs.length - 1) { st.qi += 1; ctx.refresh({ focus: true }); return false; }
        if (!quizComplete(st.answers)) return false;
        st.layouts = applyQuiz(ctx.data, st.answers);
        ctx.save();
        return true;
    },
    onBack(ctx) {
        const st = qState(ctx);
        if (st.qi > 0) { st.qi -= 1; ctx.refresh({ focus: true }); return false; }
        return true;
    },
};

export function registerQuizStep() {
    registerSetupStep(quizStep);
}
