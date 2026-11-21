// Settings screen model (D2). Pure: no DOM, no storage. The screen renders what this returns.
// Five groups, one list, search on top. Plan holds money; Settings is housekeeping only.

import { t } from '../i18n/strings.js';
import { taxTablesStatus } from '../calc/tax-tables/index.js';

export const GROUP_IDS = ['data', 'look', 'tax', 'setup', 'about'];

export const TEXT_SIZES = [
    { id: 'standard', px: 16 },
    { id: 'large', px: 18 },
    { id: 'larger', px: 20 },
];

export const CURRENCIES = [
    ['AUD', 'Australian dollar'], ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'],
    ['CAD', 'Canadian dollar'], ['NZD', 'New Zealand dollar'], ['JPY', 'Japanese yen'],
    ['CHF', 'Swiss franc'], ['CNY', 'Chinese yuan'], ['INR', 'Indian rupee'],
];

export const FAIR_WORK_URL = 'https://calculate.fairwork.gov.au/';

/** The size id closest to a stored base font size (px, number or string). */
export function textSizeId(px) {
    const n = parseInt(px, 10);
    const v = Number.isFinite(n) ? n : 16;
    let best = TEXT_SIZES[0];
    for (const s of TEXT_SIZES) if (Math.abs(s.px - v) < Math.abs(best.px - v)) best = s;
    return best.id;
}

export function textSizePx(id) {
    const s = TEXT_SIZES.find((x) => x.id === id);
    return s ? s.px : 16;
}

/** Number of category keywords across all categories (for the Import rules row). */
export function keywordCount(financeData) {
    const cats = (financeData && financeData.categories) || [];
    return cats.reduce((n, c) => n + (Array.isArray(c && c.keywords) ? c.keywords.filter(Boolean).length : 0), 0);
}

/** Keyword text edits -> arrays (comma separated, trimmed, empties and repeats removed). */
export function parseKeywords(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text == null ? '' : text).split(',')) {
        const w = raw.trim();
        const k = w.toLowerCase();
        if (w && !seen.has(k)) { seen.add(k); out.push(w); }
    }
    return out;
}

/** The read-only tax tables row (FT-R-66, FT-R-86): no setting, only a status. */
export function taxTablesRow(now, data) {
    const s = taxTablesStatus(now, data);
    return {
        title: t('d.settings.tax', { fy: s.activeFy }),
        detail: t('d.settings.tax.detail'),
        status: s.stale ? 'stale' : (s.checkDue ? 'check' : 'ok'),
        statusLabel: s.stale ? t('d.settings.tax.stale') : (s.checkDue ? t('d.settings.tax.check') : t('d.settings.tax.ok')),
        activeFy: s.activeFy,
    };
}

/**
 * The rows, grouped. kind: action | theme | mode | size | currency | link | info.
 * `search` is extra words the search field also matches.
 * @param {{financeData?:object, now?:Date, installAvailable?:boolean, version?:string}} ctx
 */
export function buildSettings(ctx = {}) {
    const fd = ctx.financeData || {};
    const tax = taxTablesRow(ctx.now || new Date(), fd);
    const version = ctx.version || '';
    const g = (id, rows) => ({ id, title: t(`d.settings.g.${id}`), hint: t(`d.settings.g.${id}.hint`), rows });

    const about = [];
    if (ctx.installAvailable) {
        about.push({ id: 'install', kind: 'action', label: t('d.settings.install'), value: t('d.settings.install.value'), search: 'install app home screen' });
    }
    about.push(
        { id: 'privacy', kind: 'info', label: t('d.settings.privacy'), value: t('d.settings.privacy.value'), detail: t('d.settings.privacy.detail'), search: 'private data device' },
        { id: 'licence', kind: 'info', label: t('d.settings.licence'), value: t('d.settings.licence.value'), search: 'licence license rights' },
        { id: 'version', kind: 'info', label: t('d.settings.version'), value: version, search: 'version build' },
        { id: 'fairwork', kind: 'link', label: t('d.settings.fairwork'), value: t('d.settings.fairwork.value'), href: FAIR_WORK_URL, search: 'award pay rates wages' },
    );

    return [
        g('data', [
            { id: 'backup', kind: 'action', label: t('d.settings.backup'), hint: t('d.settings.backup.hint'), value: t('d.settings.backup.value'), search: 'backup export save json file' },
            { id: 'restore', kind: 'action', label: t('d.settings.restore'), value: t('d.settings.restore.value'), search: 'import backup load json' },
            { id: 'export', kind: 'action', label: t('d.settings.export'), value: t('d.settings.export.value'), search: 'csv spreadsheet transactions' },
            { id: 'rules', kind: 'action', label: t('d.settings.rules'), hint: t('d.settings.rules.hint'), value: t('d.settings.rules.value', { count: keywordCount(fd) }), search: 'keywords categories sort' },
            { id: 'erase', kind: 'action', quiet: true, label: t('d.settings.erase'), value: t('d.settings.erase.value'), search: 'reset delete clear wipe factory' },
        ]),
        g('look', [
            { id: 'theme', kind: 'theme', label: t('d.settings.theme'), hint: t('d.settings.theme.hint'), search: 'colour color palette sunrise eucalypt harbour bucket' },
            { id: 'mode', kind: 'mode', label: t('d.settings.mode'), hint: t('d.settings.mode.hint'), search: 'dark light auto night' },
            { id: 'size', kind: 'size', label: t('d.settings.size'), hint: t('d.settings.size.hint'), search: 'font bigger larger text' },
        ]),
        g('tax', [
            { id: 'currency', kind: 'currency', label: t('d.settings.currency'), hint: t('d.settings.currency.hint'), search: 'money aud dollars region' },
            { id: 'taxtables', kind: 'info', label: tax.title, hint: tax.detail, value: tax.statusLabel, status: tax.status, search: 'tax year ato rates withholding medicare help' },
            { id: 'taxdetails', kind: 'action', label: t('a12b.tax.title'), hint: t('a12b.tax.helpHint'), search: 'medicare levy help balance hecs estimate' },
        ]),
        g('setup', [
            { id: 'setup', kind: 'action', label: t('d.settings.setup'), hint: t('d.settings.setup.hint'), search: 'wizard start again onboarding quiz' },
            { id: 'model', kind: 'action', label: t('d.settings.model'), value: t('d.settings.model.value'), search: 'buckets plan allocation' },
        ]),
        g('about', about),
    ];
}

const norm = (s) => String(s == null ? '' : s).toLowerCase();

/** Rows whose label, hint, value or search words contain every word typed. Empty groups are dropped. */
export function filterSettings(groups, query) {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return groups;
    const out = [];
    for (const grp of groups) {
        const groupText = norm(grp.title);
        const rows = grp.rows.filter((r) => {
            const hay = `${norm(r.label)} ${norm(r.hint)} ${norm(r.value)} ${norm(r.search)} ${groupText}`;
            return words.every((w) => hay.includes(w));
        });
        if (rows.length) out.push({ ...grp, rows });
    }
    return out;
}

export const countRows = (groups) => groups.reduce((n, g) => n + g.rows.length, 0);
