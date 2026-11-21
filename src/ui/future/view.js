// Future screen view (F6): pure string builders over the model in model.js. Every data value goes through
// esc / escNum; every figure is formatted from the model, none is typed in. Colours come from theme tokens
// (future.css). Interaction is wired in index.js through data-fu-* attributes.

import { t } from '../../i18n/strings.js';
import { formatCurrency } from '../../utils.js';
import { esc, escNum } from '../html.js';
import { HORIZONS, MAX_ON_CHART } from './model.js';

const whole = (n) => formatCurrency(Math.round(Number(n) || 0), undefined, 0);
const cents = (c) => formatCurrency((Number(c) || 0) / 100);
const moneyHtml = (text) => `<span class="money">${esc(text)}</span>`;
const localDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
const dayLong = (iso) => localDate(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
const dayShort = (iso) => localDate(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const editedOn = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); };

/** A short axis figure: A$500k, A$1.5M. The currency symbol comes from the same formatter as every other figure. */
export function axisMoney(n) {
    const sym = formatCurrency(0, undefined, 0).replace(/[0-9.,\s ]/g, '');
    const a = Math.abs(n);
    const neg = n < 0 ? '-' : '';
    if (a >= 1e6) return `${neg}${sym}${Number((a / 1e6).toFixed(2))}M`;
    if (a >= 1e3) return `${neg}${sym}${Number((a / 1e3).toFixed(1))}k`;
    return `${neg}${sym}${Math.round(a)}`;
}

/** "28.6 years", "less than a year", or "Not at this pace". */
export function yearsText(years) {
    if (years === 0) return t('f.future.fi.reached');
    if (!Number.isFinite(years)) return t('f.future.fi.never');
    return t('f.future.fi.about', { years: (Math.round(years * 10) / 10).toString() });
}

// ---------- path card ----------

function chartHtml(m) {
    const g = m.geometry;
    const fi = m.summary.fiNumber;
    const grid = g.grid.map((l) => `<span class="fu-gl" style="top:${escNum(l.pct)}%"><b>${esc(axisMoney(l.value))}</b></span>`).join('');
    const lines = g.lines.map((l) => {
        const idx = Math.max(0, m.drawn.findIndex((d) => d.id === l.id));
        return `<path class="${l.kind === 'now' ? 'fu-ln-now' : `fu-ln-scen d${idx % MAX_ON_CHART}`}" d="${esc(l.d)}"/>`;
    }).join('');
    const dots = g.fiDot ? `<span class="fu-dot-fi" style="left:${escNum(g.fiDot.left)}%;top:${escNum(g.fiDot.top)}%"></span>`
        + `<span class="fu-fi-tag" style="left:${escNum(g.fiDot.left)}%;top:${escNum(g.fiDot.top)}%">${esc(t('f.future.chart.fiIn', { years: yearsText(m.summary.yearsToFI) }))}</span>` : '';
    const ticks = g.ticks.map((k, i) => `<span style="left:${escNum(k.pct)}%"${i === g.ticks.length - 1 ? ' class="last"' : ''}>${esc(k.year === 0 ? t('f.future.chart.now') : i === g.ticks.length - 1 ? t('f.future.chart.yrs', { n: k.year }) : String(k.year))}</span>`).join('');
    return `<figure class="fu-chart" aria-labelledby="fu-chart-cap"><div class="fu-plot">${grid}`
        + `<span class="fu-fi-line" style="top:${escNum(g.fiPct)}%"><b>${esc(t('f.future.chart.fiLine', { amount: axisMoney(fi) }))}</b></span>`
        + `<svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`
        + `<span class="fu-dot-now" style="left:0;top:${escNum(g.nowTop)}%"></span>${dots}</div>`
        + `<div class="fu-x" aria-hidden="true">${ticks}</div>`
        + `<figcaption id="fu-chart-cap" class="fu-sr">${esc(chartCaption(m))}</figcaption></figure>`;
}

/** The text alternative: the figures the chart shows. */
export function chartCaption(m) {
    const f = m.figures;
    let s = t('f.future.chart.cap', { years: m.horizon, now: whole(f.now), end: whole(m.summary.path[Math.min(m.horizon, m.summary.path.length - 1)].fiNetWorth), fi: whole(f.fiNumber), when: yearsText(m.summary.yearsToFI) });
    for (const d of m.drawn) s += ` ${t('f.future.chart.capScen', { name: d.name, when: yearsText(d.yearsToFI) })}`;
    return s;
}

export function pathCardHtml(m) {
    const f = m.figures;
    const seg = HORIZONS.map((h) => `<button type="button" data-fu-horizon="${h}" aria-pressed="${h === m.horizon}">${esc(t('f.future.horizon', { n: h }))}</button>`).join('');
    const legend = m.drawn.map((d, i) => `<li><i class="fu-sw d${i % MAX_ON_CHART}"></i>${esc(d.name)} <span class="muted">· ${esc(t(d.headline.key, headlineParams(d.headline)))}</span></li>`).join('');
    return `<section class="card fu-path" aria-labelledby="fu-h-path"><div class="card-head"><h2 id="fu-h-path">${esc(t('f.future.path.title'))}</h2>`
        + `<div class="seg" role="group" aria-label="${esc(t('f.future.horizon.aria'))}">${seg}</div></div>`
        + `<ul class="fu-figs"><li><span class="k">${esc(t('f.future.fig.now'))}</span><span class="v money">${esc(whole(f.now))}</span></li>`
        + `<li><span class="k">${esc(t('f.future.fig.in', { n: HORIZONS[0] }))}</span><span class="v money">${esc(whole(f.in10))}</span></li>`
        + `<li><span class="k">${esc(t('f.future.fig.in', { n: HORIZONS[1] }))}</span><span class="v money">${esc(whole(f.in20))}</span></li>`
        + `<li><span class="k">${esc(t('f.future.fig.fi'))}</span><span class="v money">${esc(whole(f.fiNumber))}</span></li></ul>`
        + chartHtml(m)
        + `<ul class="fu-legend"><li><i class="fu-sw now"></i>${esc(t('f.future.legend.now'))}</li>${legend}</ul>`
        + `<p class="fine">${esc(t('f.future.path.fine', { max: MAX_ON_CHART }))}</p></section>`;
}

/** Headline params: `cents` are formatted here, `years` pass through. */
export function headlineParams(h) {
    const p = { ...h.params };
    if (p.cents != null) p.cents = cents(p.cents);
    return p;
}

// ---------- FI card ----------

const SPARK = '<svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2 2M10.2 10.2l2 2M3.8 12.2l2-2M10.2 5.8l2-2"/></svg>';

/** The What if button (title row and promo card): opens a new scenario through data-fu-new. */
export function whatIfButtonHtml() {
    return `<button type="button" class="btn btn-primary fu-whatif" data-fu-new="1">${SPARK}${esc(t('f.future.wi.button'))}</button>`;
}

export function fiCardHtml(m) {
    const s = m.summary;
    const ages = s.fiAge ? s.fiAge.ages.map((a) => (a.name ? `${a.name} ${a.age}` : String(a.age))).join(', ') : '';
    const notes = [];
    if (s.fiAge && s.fiAge.superNote) notes.push(t('f.fi.explain.superPreservation', { age: 60 }));
    if (s.notes.includes('spendingBias')) notes.push(t('f.fi.explain.spendingBias'));
    notes.push(t('f.fi.explain.notModelled'));
    const nudges = s.nudges.map((n) => `<li>${esc(t('f.fi.explain.minRepayment', { name: n.name }))}</li>`).join('');
    return `<section class="card fu-fi" aria-labelledby="fu-h-fi"><div class="card-head"><h2 id="fu-h-fi">${esc(t('f.future.fi.title'))}</h2></div>`
        + `<p class="fu-fi-big">${esc(yearsText(s.yearsToFI))}</p>`
        + (ages ? `<p class="muted">${esc(t('f.future.fi.ages', { list: ages }))}</p>` : '')
        + `<dl class="fu-kv"><div><dt>${esc(t('f.future.fi.number'))}</dt><dd class="money">${esc(whole(s.fiNumber))}</dd></div>`
        + `<div class="sub"><dt>${esc(t('f.future.fi.numberSub', { multiple: escNum(s.multiple), spend: whole(s.spendYear) }))}</dt></div>`
        + `<div><dt>${esc(t('f.future.fi.rate'))}</dt><dd class="num">${esc(t('f.future.pct', { n: s.savingsRate }))}</dd></div>`
        + `<div class="sub"><dt>${esc(t('f.future.fi.rateSub'))}</dt></div>`
        + `<div><dt>${esc(t('f.future.fi.going'))}</dt><dd class="money">${esc(whole(s.going.total))}</dd></div>`
        + `<div class="sub"><dt>${esc(t('f.future.fi.goingSub', { fire: whole(s.going.fire), super: whole(s.going.super) }))}</dt></div></dl>`
        + `<p class="fine">${esc(t('f.future.assume', { real: s.realReturnPct, inflation: s.inflationPct }))}</p>`
        + `<ul class="fu-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}${nudges}</ul>`
        + `<div class="fu-actions"><button type="button" class="btn" data-fu-explain="1">${esc(t('f.future.fi.explain'))}</button>`
        + `<button type="button" class="btn" data-fu-assume="1">${esc(t('f.future.assumptions'))}</button></div>`
        + `<div class="wi-entry"><p><b>${esc(t('f.future.wi.promoTitle'))}</b> ${esc(t('f.future.wi.promoBody'))}</p>${whatIfButtonHtml()}</div></section>`;
}

// ---------- saved scenarios ----------

function scenarioRowHtml(s, ctx) {
    const drawn = ctx.drawn.find((d) => d.id === s.id);
    const idx = ctx.drawn.findIndex((d) => d.id === s.id);
    const sum = drawn ? `<span class="sc-sum">${esc(t(drawn.headline.key, headlineParams(drawn.headline)))}</span>` : '';
    const meta = [t(s.changes === 1 ? 'f.future.scen.change1' : 'f.future.scen.changes', { n: s.changes }), s.pinned ? t('f.future.scen.pinned') : '', t('f.future.scen.edited', { date: editedOn(s.updatedAt) })].filter(Boolean).join(' · ');
    const toggle = s.archived ? '' : `<button type="button" class="btn sm" data-fu-chart="${esc(s.id)}" aria-pressed="${s.onChart}">${s.onChart ? `<i class="fu-sw d${idx % MAX_ON_CHART}"></i>` : ''}${esc(t('f.future.scen.onChart'))}</button>`;
    return `<li><button type="button" class="sc-main" data-fu-open="${esc(s.id)}"><span class="sc-name">${s.pinned ? '<span class="fu-pin" aria-hidden="true"></span>' : ''}${esc(s.name || t('f.future.scen.unnamed'))}</span>${sum}<span class="sc-meta">${esc(meta)}</span></button>${toggle}</li>`;
}

export function scenariosCardHtml(m, state = {}) {
    const { live, archived } = m.list;
    const loaded = state.loaded !== false;
    const showArch = !!state.showArchived;
    const rows = live.map((s) => scenarioRowHtml(s, { drawn: m.drawn })).join('')
        + (showArch ? archived.map((s) => scenarioRowHtml({ ...s, archived: true }, { drawn: m.drawn }).replace('<span class="sc-name">', `<span class="sc-name"><span class="pill">${esc(t('f.future.scen.archivedPill'))}</span>`)).join('') : '');
    const aside = loaded ? `${esc(t('f.future.scen.saved', { n: live.length }))}${archived.length ? ` · <button type="button" class="link" data-fu-archived="1">${esc(t(showArch ? 'f.future.scen.hideArchived' : 'f.future.scen.showArchived', { n: archived.length }))}</button>` : ''}` : '';
    const body = !loaded ? `<p class="muted">${esc(t('f.future.scen.loading'))}</p>` : rows ? `<ul class="rows fu-scen-list">${rows}</ul>` : `<p class="muted">${esc(t('f.future.scen.empty'))}</p>`;
    return `<section class="card fu-scen" aria-labelledby="fu-h-scen"><div class="card-head"><h2 id="fu-h-scen">${esc(t('f.future.scen.title'))}</h2><span class="aside">${aside}</span></div>${body}`
        + `<div class="card-foot fu-foot"><span class="muted">${esc(t('f.future.scen.order'))}</span><button type="button" class="link" data-fu-new="1">${esc(t('f.future.scen.new'))}</button></div></section>`;
}

// ---------- goals ----------

export function goalsCardHtml(m) {
  const g = m.goals;
  if (!g) return '';
  const head = `<div class="card-head"><h2 id="fu-h-goals">${esc(t('f.future.goals.title'))}</h2>${g.rows.length ? `<span class="aside">${esc(t('f.future.goals.aside', { total: cents(g.totalCents) }))}</span>` : ''}</div>`;
  if (!g.rows.length) return `<section class="card fu-goals" aria-labelledby="fu-h-goals">${head}<p class="muted">${esc(g.undated ? t(g.undated === 1 ? 'f.future.goals.undatedOnly.one' : 'f.future.goals.undatedOnly', { n: g.undated }) : t('f.future.goals.empty'))}</p></section>`;
  const dots = g.positions.map((p) => `<span class="fu-tl-dot" style="left:${escNum(p)}%"></span>`).join('');
  const aria = t('f.future.goals.aria', { from: dayShort(g.start), to: dayShort(g.end), list: g.rows.map((r) => `${r.name} ${dayShort(r.due)}`).join(', ') });
  const list = g.rows.map((r) => {
    const pill = r.state === 'covered' ? `<span class="pill ok">${esc(t('f.future.goals.covered'))}</span>`
      : r.state === 'onTime' ? `<span class="pill ok">${esc(t('f.future.goals.onTime'))}</span>`
      : r.state === 'short' ? `<span class="pill due">${esc(t('f.future.goals.short', { amount: cents(r.perPayCents) }))}</span>`
      : `<span class="pill due">${esc(t('f.future.goals.impossible'))}</span>`;
    return `<li><span class="fu-g-n"><b>${esc(r.name)}</b>${moneyHtml(cents(r.costCents))} ${esc(t('f.future.goals.by', { date: dayLong(r.due) }))}</span>${pill}</li>`;
  }).join('');
  return `<section class="card fu-goals" aria-labelledby="fu-h-goals">${head}<div class="fu-tl" role="img" aria-label="${esc(aria)}"><span class="fu-tl-today"></span>${dots}</div>`
    + `<div class="fu-tl-cap" aria-hidden="true"><span>${esc(t('f.future.goals.today'))}</span><span>${esc(dayShort(g.end))}</span></div><ul class="rows fu-goal-list">${list}</ul>`
    + `<p class="fine">${esc(t('f.future.goals.fine', { funds: cents(g.smileFundsCents), perPay: cents(g.smilePerPayCents) }))}${g.undated ? ` ${esc(t(g.undated === 1 ? 'f.future.goals.undated.one' : 'f.future.goals.undated', { n: g.undated }))}` : ''}</p></section>`;
}

// ---------- things that lose value, and HELP ----------

export function loseCardHtml(m) {
    const l = m.lose;
    if (!l) return '';
    const rows = l.assets.map((a) => `<li><span>${esc(a.name)}</span>${moneyHtml(whole(a.balance))}</li>`).join('');
    return `<section class="card fu-lose" aria-labelledby="fu-h-lose"><div class="card-head"><h2 id="fu-h-lose">${esc(t('f.future.lose.title'))}</h2></div>`
        + (rows ? `<ul class="rows fu-plain">${rows}</ul><p class="fine">${esc(t('f.fi.explain.losesValue', { amount: whole(l.total) }))}</p>` : '')
        + (l.help > 0 ? `<p class="fu-help-line">${esc(t('f.fi.explain.help', { amount: whole(l.help) }))}</p>` : '')
        + `</section>`;
}

// ---------- the Debts card (carried from the old Liabilities panel) ----------

export function debtsCardHtml(m) {
    const d = m.debts;
    const head = `<div class="card-head"><h2 id="fu-h-debts">${esc(t('f.future.debts.title'))}</h2></div>`;
    if (!d.rows.length) return `<section class="card fu-debts" aria-labelledby="fu-h-debts">${head}<p class="fu-good">${esc(t('f.future.debts.none'))}</p></section>`;
    const cards = d.rows.map((r) => {
        const chip = r.label ? `<span class="pill ${r.label === 'good' ? 'ok' : 'due'}">${esc(t(`f.ad.debt.label.${r.label}`))}${r.labelSuggested ? ` (${esc(t('f.ad.suggested'))})` : ''}</span>` : '';
        const band = `<span class="pill${r.band === 'high' ? ' due' : r.band === 'low' ? ' ok' : ''}">${esc(t(`f.ad.rate.${r.band}`))}</span>`;
        return `<li><button type="button" class="fu-debt" data-fu-debt="${escNum(r.index)}"><span class="fu-debt-top"><span class="fu-debt-name">${esc(r.name)}</span>${chip}${band}</span>`
            + `<span class="fu-debt-bal">${moneyHtml(whole(r.balance))}</span>`
            + `<span class="fu-debt-sub">${esc(t('f.future.debts.rate', { rate: escNum(r.rate) }))} · ${esc(t('f.future.debts.interest', { yearly: formatCurrency(r.yearlyInterest), monthly: formatCurrency(r.monthlyInterest) }))}</span></button></li>`;
    }).join('');
    return `<section class="card fu-debts" aria-labelledby="fu-h-debts">${head}<ul class="fu-debt-list">${cards}</ul>`
        + `<dl class="fu-kv"><div><dt>${esc(t('f.future.debts.total'))}</dt><dd class="money">${esc(formatCurrency(d.totalLiabilities))}</dd></div>`
        + `<div><dt>${esc(t('f.future.debts.interestCost'))}</dt><dd class="money">${esc(formatCurrency(d.annualInterest))}</dd></div>`
        + `<div><dt>${esc(t('f.future.debts.avg'))}</dt><dd class="num">${esc(t('f.future.pct', { n: (Math.round(d.averageRate * 100) / 100).toString() }))}</dd></div>`
        + `<div class="strong"><dt>${esc(t('f.future.debts.free'))}</dt><dd class="money">${esc(formatCurrency(d.netWorthDebtFree))}</dd></div></dl></section>`;
}

// ---------- the HELP payoff card ----------

export function helpCardHtml(m) {
    const h = m.help;
    if (!h) return '';
    const line = (k, v) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
    let body;
    if (h.kind === 'none') {
        body = line(t('f.future.help.compulsory'), t('f.future.help.none', { threshold: whole(h.threshold) })) + `</dl><p class="fine">${esc(t('f.future.help.noneNote', { index: h.indexationPct }))}</p>`;
    } else if (h.kind === 'never') {
        body = line(t('f.future.help.annual'), whole(h.annualRepayment)) + line(t('f.future.help.years'), t('f.future.help.never')) + '</dl>';
    } else {
        body = line(t('f.future.help.years'), t('f.future.help.yearsValue', { years: h.years, year: h.debtFreeYear }))
            + line(t('f.future.help.fromPay'), t('f.future.help.fromPayValue', { year: whole(h.annualRepayment), fortnight: whole(h.perFortnight) }))
            + line(t('f.future.help.indexation'), whole(h.totalIndexation))
            + `</dl><p class="fine">${esc(t('f.future.help.note', { index: h.indexationPct }))}</p>`;
    }
    return `<section class="card fu-helpcard" aria-labelledby="fu-h-help"><div class="card-head"><h2 id="fu-h-help">${esc(t('f.future.help.title'))}</h2></div>`
        + `<p class="muted">${esc(t('f.future.help.sub', { balance: whole(h.balance), income: whole(h.income) }))}</p><dl class="fu-kv">${body}</section>`;
}

// ---------- the tax-provision card ----------

export function taxCardHtml(m) {
    const x = m.tax;
    if (!x) return '';
    const head = (fy) => `<div class="card-head"><h2 id="fu-h-tax">${esc(fy ? t('f.future.tax.title', { fy }) : t('f.future.tax.titlePlain'))}</h2></div>`;
    if (x.kind === 'noEstimate') return `<section class="card fu-tax" aria-labelledby="fu-h-tax">${head()}<p class="muted">${esc(t('taxpot.noEstimate'))}</p></section>`;
    const p = x.prov;
    const body = t(x.covered ? 'varInc.provision.bodyCovered' : 'varInc.provision.body', {
        projGross: esc(whole(p.projectedAnnualGross)), projTax: esc(whole(p.projectedAnnualTax)), toDate: esc(whole(p.provisionToDate)),
        withheld: esc(whole(p.ytdWithheld)), still: `<strong>${esc(whole(p.stillToSetAside))}</strong>`,
    });
    let pot;
    if (x.pot) {
        const onTrack = x.pot.balance >= p.provisionToDate;
        const pct = p.provisionToDate > 0 ? Math.min(100, (x.pot.balance / p.provisionToDate) * 100) : 100;
        pot = `<p>${t(onTrack ? 'taxpot.onTrack' : 'taxpot.behind', { name: `<strong>${esc(x.pot.name)}</strong>`, balance: esc(whole(x.pot.balance)), target: esc(whole(p.provisionToDate)), gap: `<strong>${esc(whole(Math.max(0, p.provisionToDate - x.pot.balance)))}</strong>` })}</p>`
            + `<div class="fu-bar" role="img" aria-label="${esc(t('f.future.tax.barAria', { pct: Math.round(pct) }))}"><span class="${onTrack ? 'ok' : 'warn'}" style="width:${escNum(Math.round(pct * 10) / 10)}%"></span></div>`;
    } else pot = `<p class="muted">${esc(t('f.future.tax.noPot'))}</p>`;
    return `<section class="card fu-tax" aria-labelledby="fu-h-tax">${head(x.fy)}<p>${body}</p>${pot}</section>`;
}

// ---------- the screen ----------

/** The whole Future body (not the title row, not the Income pattern slot, which C8 owns). */
export function buildFutureHtml(m, state = {}) {
    return `<div class="grid fu">${pathCardHtml(m)}${fiCardHtml(m)}${scenariosCardHtml(m, state)}${goalsCardHtml(m)}${debtsCardHtml(m)}${loseCardHtml(m)}${helpCardHtml(m)}${taxCardHtml(m)}</div>`;
}
