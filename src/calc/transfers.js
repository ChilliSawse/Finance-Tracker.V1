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

/**
 * Which bucket's bank label a bank description names.
 * Rule: the label, cleaned the same way as the description, must appear in it as whole words (so 'Fire' matches
 * 'TRANSFER TO FIRE SAVINGS' and 'Osko to fire' but not 'FIRESTONE TYRES'), ignoring case, punctuation and extra spaces.
 * A label shorter than MIN_LABEL_LENGTH letters or digits is ignored. When more than one bucket matches, the one with
 * the longest label wins ('Fire fund' beats 'Fire'); two different buckets tied on length is ambiguous and gives none,
 * because guessing wrong would put money in the wrong pot.
 * @param {string} description
 * @param {Array<{id:string, bankLabel?:string}>} allocation top-level buckets
 * @returns {{bucketId: string|null, ambiguous: boolean}}
 */
export function matchBucketLabel(description, allocation) {
    const hay = ` ${normaliseLabelText(description)} `;
    if (hay.trim() === '') return { bucketId: null, ambiguous: false };
    let best = 0;
    let winners = new Set();
    for (const a of Array.isArray(allocation) ? allocation : []) {
        if (!a || a.id == null || typeof a.bankLabel !== 'string') continue;
        const label = normaliseLabelText(a.bankLabel);
        const size = label.replace(/ /g, '').length;
        if (size < MIN_LABEL_LENGTH || !hay.includes(` ${label} `)) continue;
        if (size > best) { best = size; winners = new Set([String(a.id)]); } else if (size === best) winners.add(String(a.id));
    }
    if (winners.size === 1) return { bucketId: [...winners][0], ambiguous: false };
    return { bucketId: null, ambiguous: winners.size > 1 };
}

/**
 * What an import should add to an outgoing row whose description names a bucket's bank label, or null.
 * Never overrides a category the person taught (a learned rule) or picked in the preview (`chosenCategoryId`).
 * The row becomes a transfer to that bucket, flagged suggested and left in To review until confirmed.
 * @param {{description:string, amountCents:number}} row
 * @param {{allocation?:Array, categoryBy?:string, chosenCategoryId?:string|null}} ctx categoryBy is 'rule' | 'keyword' | 'none'
 */
export function transferSuggestion(row, { allocation, categoryBy, chosenCategoryId } = {}) {
    if (!row || !(row.amountCents < 0) || chosenCategoryId || categoryBy === 'rule') return null;
    const m = matchBucketLabel(row.description, allocation);
    if (!m.bucketId) return null;
    return { categoryId: TRANSFER_CATEGORY, bucketId: m.bucketId, bucketSuggested: true, status: 'review' };
}
