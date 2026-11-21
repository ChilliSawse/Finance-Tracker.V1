// Today's tax slot (C8, FT-R-66). Two states, both driven by taxTablesStatus (C1):
//   July card  - from 1 July until a payslip is checked ("New tax year: check one payslip"); with no check ever made,
//                only for a payslip-job source and only July to September.
//                Stored as data.taxCheck = { fy, done }; Dismiss is explicit (adds dismissed:true).
//   Stale      - the shipped tables are older than today's income year: one quiet label.
// The builders are pure (now, data in; HTML out). Data is escaped; colours are tokens (today.css).

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { taxTablesStatus } from '../calc/tax-tables/index.js';
import { esc } from './html.js';
import { layoutFor, openIncomeSheet } from './income-layout.js';

/** null | {kind:'stale'|'july', fy}. A dismissed card stays hidden for that year; stale never hides. */
export function taxCardModel(now, data) {
    const s = taxTablesStatus(now, data);
    if (s.stale) return { kind: 'stale', fy: s.activeFy };
    const tc = data && data.taxCheck;
    if (s.checkDue && !(tc && tc.fy === s.activeFy && tc.dismissed === true)) return { kind: 'july', fy: s.activeFy };
    return null;
}

/** Explicit dismiss: the card stays away for this income year. The Settings row still says Check due. */
export function dismissTaxCheck(data, now = new Date()) {
    if (!data) return false;
    const fy = taxTablesStatus(now, data).activeFy;
    data.taxCheck = { fy, done: false, dismissed: true };
    return true;
}

export function buildTaxCardHtml(model) {
    if (!model) return '';
    if (model.kind === 'stale') {
        return `<p class="muted tax-stale">${t('c.tax.stale', { fy: esc(model.fy) })}</p>`;
    }
    return `
      <section class="card today-nudge tax-july" aria-labelledby="h-taxcheck">
        <div><h2 id="h-taxcheck">${t('c.tax.july.title', { fy: esc(model.fy) })}</h2><p class="muted">${t('c.tax.july.body')}</p></div>
        <div class="tax-july-acts">
          <button type="button" class="btn" data-tax-check>${t('c.tax.july.check')}</button>
          <button type="button" class="btn btn-secondary" data-tax-dismiss>${t('c.tax.july.dismiss')}</button>
        </div>
      </section>`;
}

let wired = false;
function wire(slot) {
    if (wired) return;
    wired = true;
    slot.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-tax-dismiss')) {
            dismissTaxCheck(store.financeData);
            if (store.autoSave) store.autoSave.onDataChange();
            renderTaxCard();
        } else if (b.hasAttribute('data-tax-check')) {
            const i = (store.financeData.incomeSources || []).findIndex((s) => layoutFor(s));
            if (i >= 0) openIncomeSheet(i);
        }
    });
}

export function renderTaxCard(now = new Date()) {
    const slot = document.getElementById('today-tax-slot');
    if (!slot) return;
    wire(slot);
    slot.innerHTML = buildTaxCardHtml(taxCardModel(now, store.financeData));
}
