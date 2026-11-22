// What an imported row is stored as, and the transfer notes the import screens show (H9, FT-R-117/119, DB2).
// Kept out of rules.js so the always-loaded core does not carry import-only code (cold-load budget).

import { categoriseWithReference, resolveWithReference } from './reference-match.js';
import { transferSuggestion, looksLikeOwnTransfer } from '../calc/transfer-suggest.js';
import { plural } from '../i18n/strings.js';

/**
 * What an imported row is stored as: its category and review status (resolveCategory), unless it is an outgoing row whose
 * description names a bucket's bank label, which becomes a transfer to that bucket, marked suggested and left in To review
 * until the person confirms it (H9, FT-R-117/119). A category the person picked in the preview, or a learned rule, wins.
 * Own-account wording alone (looksLikeOwnTransfer) never changes the category: a row with no rule and no keyword hit keeps its
 * category, stays in To review and carries `transferSuggested: true`, so it still counts until the person confirms it.
 * `ref` is the reference view from loadImportReference() (DB4): it adds the reference layers below the person's own, a hit
 * is always stored 'review', with its confidence carried as refConfidence. Without it the result is what it was before.
 * @returns {{categoryId:string, status:'ok'|'review', referenceSuggested?:true, refConfidence?:string, refId?:string, bucketId?:string, bucketSuggested?:true, transferSuggested?:true}}
 */
export function resolveImportRow(description, amountCents, chosenId, data, ref) {
    const d = data || {};
    const base = resolveWithReference(description, amountCents, chosenId, d.categories || [], d.rules || [], ref, d.refOverrides);
    const by = categoriseWithReference(description, amountCents, d.categories || [], d.rules || [], ref, d.refOverrides).by;
    const sug = transferSuggestion({ description, amountCents }, { allocation: d.allocation, categoryBy: by, chosenCategoryId: chosenId });
    if (sug) return sug;
    if (!chosenId && by === 'none' && looksLikeOwnTransfer(description, amountCents)) return { ...base, status: 'review', transferSuggested: true };
    return base;
}

let refPromise = null;
/** The reference view for the import screens (cache, then baseline, then nothing), loaded once. Resolves to null when it cannot load. */
export function loadImportReference() {
    if (!refPromise) {
        refPromise = import('./reference.js').then((m) => m.getReference()).catch(() => null)
            .then((v) => { if (!v) refPromise = null; return v; });
    }
    return refPromise;
}

/**
 * The category the import preview shows for a row nobody has picked yet, and whether it is only a reference suggestion
 * (shown with the existing "suggested" mark).
 * @returns {{categoryId:string, suggested:boolean}}
 */
export function previewCategory(description, amountCents, data, ref) {
    const d = data || {};
    const det = categoriseWithReference(description, amountCents, d.categories || [], d.rules || [], ref, d.refOverrides);
    const r = resolveWithReference(description, amountCents, undefined, d.categories || [], d.rules || [], ref, d.refOverrides);
    return { categoryId: det.categoryId, suggested: !!r.referenceSuggested };
}

/** The bucket name an import row would be suggested as a transfer to (H9), or ''. `pickedId` is a category the person chose. */
export function suggestedTransferName(description, amountCents, pickedId, data, ref) {
    const r = resolveImportRow(description, amountCents, pickedId, data, ref);
    if (!r.bucketSuggested) return '';
    const b = ((data && data.allocation) || []).find((a) => a && String(a.id) === String(r.bucketId));
    return b && b.name ? b.name : '';
}

/** The import summary line about suggested transfers (H9), or '' when none were suggested. Counts only, nothing from the file. */
export function suggestedTransfersLine(rows) {
    const n = (rows || []).filter((r) => r && r.bucketSuggested).length;
    return n ? plural(n, 'a.import.transfers.one', 'a.import.transfers.many') : '';
}
