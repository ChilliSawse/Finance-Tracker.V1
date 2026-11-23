// Transfer suggestions at import (H9, FT-R-119, and DB2 wording guesses). Pure: no DOM, no storage.
// Kept out of transfers.js so the always-loaded core only carries isTransferRow and the constants (cold-load budget).

import { TRANSFER_CATEGORY, MIN_LABEL_LENGTH, normaliseLabelText } from './transfers.js';

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

// Wording guesses (D5 5.2, FT-R-126). Money out only. These never change the category: the row keeps what it would have had
// and only carries transferSuggested, so it still counts as spending until the person confirms it (FT-R-117).
const STRONG = / (?:internal transfer|own account|between accounts|transfer between) /;
const WEAK = / (?:transfer to|internet transfer|funds tfer|funds transfer|tfr|osko|payid|npp) /;
const EVIDENCE = / (?:own|self|myself|internal|savings|saver) /;
const INVEST = / (?:commsec|raiz|spaceship|stake au|superannuation|super contributions?|australian ?super|australiansuper) /;

/**
 * True when an outgoing description reads as a move to the person's own account, or an investment or super contribution
 * (FT-R-126). 'Transfer to <name>', 'internet transfer', Osko and PayID need own-account evidence in the line
 * (own, self, savings, internal ...): a transfer to a person, or an Osko payment to a landlord, is not a guess.
 */
export function looksLikeOwnTransfer(description, amountCents) {
    if (!(amountCents < 0)) return false;
    const h = ` ${normaliseLabelText(description)} `;
    return STRONG.test(h) || INVEST.test(h) || (WEAK.test(h) && EVIDENCE.test(h));
}
