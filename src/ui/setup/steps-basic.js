// The closing `first` step (Phase 1 step C7). The `model`, `split` and `transfers` steps are E8's, in steps-buckets.js.

import { t } from '../../i18n/strings.js';
import { esc } from '../html.js';
import { registerSetupStep, STEP_ORDER } from './registry.js';

// ---------- the closing step ----------

export const firstStep = {
    id: 'first', order: STEP_ORDER.first, title: t('c.setup.first.title'), nextLabel: t('c.setup.first.done'), skippable: false,
    render() {
        return `<p class="su-lead">${esc(t('c.setup.first.lead'))}</p>
            <div class="su-choices">
            <button type="button" class="su-btn" data-su-act="logExpense" data-su-focus="first-log">${esc(t('c.setup.first.log'))}</button>
            <button type="button" class="su-btn su-btn-ghost" data-su-act="importStatement" data-su-focus="first-import">${esc(t('c.setup.first.import'))}</button></div>
            <p class="su-fine">${esc(t('c.setup.first.later'))}</p>`;
    },
    actions: {
        logExpense(ctx) { ctx.finish({ then: 'quick-add' }); },
        importStatement(ctx) { ctx.finish({ then: 'import' }); },
    },
    onNext(ctx) { ctx.finish({ then: 'today' }); return false; },
};

export function registerBasicSteps() {
    registerSetupStep(firstStep);
}
