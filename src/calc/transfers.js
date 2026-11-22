// Transfers (H9, owner ruling FT-R-119). Pure: no DOM, no storage.
//
// A transfer row is money moved between the person's own accounts: categoryId 'transfer' (or a category with
// kind 'transfer'). It is not spending. `bucketId` on a transfer row means "this went to that bucket" (H8 counts
// it as saving when the bucket is a save bucket or a goal under one). `bucketSuggested: true` means the app filled
// that in from a bucket's bank label on import and the person has not confirmed it yet (FT-R-117).

export const TRANSFER_CATEGORY = 'transfer';

/** Shortest bank label (letters and digits, spaces ignored) that is allowed to match. Shorter ones match too much. */
export const MIN_LABEL_LENGTH = 3;

/** True for a transfer row (by its own category id, or by the category it points to). */
export function isTransferRow(row, category) {
    if (!row) return false;
    return row.categoryId === TRANSFER_CATEGORY || !!(category && (category.kind === 'transfer' || category.id === TRANSFER_CATEGORY));
}

/** Lowercase, letters and digits only, single spaces, no accents. 'Fire  Fund!' gives 'fire fund'. */
export function normaliseLabelText(text) {
    return String(text == null ? '' : text)
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
