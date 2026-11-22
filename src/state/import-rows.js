// What an imported row is stored as, and the transfer notes the import screens show (H9, FT-R-117/119, DB2).
// Kept out of rules.js so the always-loaded core does not carry import-only code (cold-load budget).

import { categoriseDetailed, resolveCategory } from './categories.js';
import { transferSuggestion, looksLikeOwnTransfer } from '../calc/transfer-suggest.js';
import { plural } from '../i18n/strings.js';

/**
 * What an imported row is stored as: its category and review status (resolveCategory), unless it is an outgoing row whose
 * description names a bucket's bank label, which becomes a transfer to that bucket, marked suggested and left in To review
 * until the person confirms it (H9, FT-R-117/119). A category the person picked in the preview, or a learned rule, wins.
 * Own-account wording alone (looksLikeOwnTransfer) never changes the category: a row with no rule and no keyword hit keeps its
 * category, stays in To review and carries `transferSuggested: true`, so it still counts until the person confirms it.
 * @returns {{categoryId:string, status:'ok'|'review', bucketId?:string, bucketSuggested?:true, transferSuggested?:true}}
 */
export function resolveImportRow(description, amountCents, chosenId, data) {
    const d = data || {};
    const base = resolveCategory(description, chosenId, d.categories || [], d.rules || []);
    const by = categoriseDetailed(description, d.categories || [], d.rules || []).by;
    const sug = transferSuggestion({ description, amountCents }, { allocation: d.allocation, categoryBy: by, chosenCategoryId: chosenId });
    if (sug) return sug;
    if (!chosenId && by === 'none' && looksLikeOwnTransfer(description, amountCents)) return { ...base, status: 'review', transferSuggested: true };
    return base;
}

/** The bucket name an import row would be suggested as a transfer to (H9), or ''. `pickedId` is a category the person chose. */
export function suggestedTransferName(description, amountCents, pickedId, data) {
    const r = resolveImportRow(description, amountCents, pickedId, data);
    if (!r.bucketSuggested) return '';
    const b = ((data && data.allocation) || []).find((a) => a && String(a.id) === String(r.bucketId));
    return b && b.name ? b.name : '';
}

/** The import summary line about suggested transfers (H9), or '' when none were suggested. Counts only, nothing from the file. */
export function suggestedTransfersLine(rows) {
    const n = (rows || []).filter((r) => r && r.bucketSuggested).length;
    return n ? plural(n, 'a.import.transfers.one', 'a.import.transfers.many') : '';
}
