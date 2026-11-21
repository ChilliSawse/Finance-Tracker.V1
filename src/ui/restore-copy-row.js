// U3: the Settings row that puts back what was here before the last restore. Pure: it only adds a row to
// the groups from settings-model.js, and only when a pre-restore copy exists (info is null otherwise).

import { t } from '../i18n/strings.js';

/** "21 Nov, 3:42 pm" in Australian English; '' when the stamp is not a date. */
export function formatCopyDate(stamp) {
    const d = new Date(stamp);
    if (Number.isNaN(d.getTime())) return '';
    try {
        return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    } catch (err) {
        console.error('Could not format the copy date', err);
        return '';
    }
}

export function addUndoRestoreRow(groups, info) {
    if (!info) return groups;
    const data = groups.find((g) => g.id === 'data');
    if (!data) return groups;
    const when = formatCopyDate(info.timestamp);
    const at = data.rows.findIndex((r) => r.id === 'restore');
    const row = {
        id: 'undorestore', kind: 'action',
        label: when ? t('d.settings.undoRestore', { date: when }) : t('d.settings.undoRestore.noDate'),
        value: t('d.settings.undoRestore.value'),
        search: 'undo restore put back earlier copy',
    };
    data.rows.splice(at < 0 ? data.rows.length : at + 1, 0, row);
    return groups;
}
