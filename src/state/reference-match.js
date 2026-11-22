// Reference-database matching for the import screens (DB4, FT-0032 R3 step R5; FT-R-117, FT-R-126).
// Lazy: imported only by import-rows.js, so it is not in the core chunk. The reference view (getReference's result) is passed
// in by the caller; nothing here imports reference.js, and with no view the result is exactly categoriseDetailed's.
//
// Order (R3 5.2, D5 6.1): learned rules, user category keywords, reference merchants, reference category keywords, other.
// Every reference hit is by:'reference' and status 'review' (FT-R-126 item 3), so a guess never silently feeds totals;
// its confidence is carried as refConfidence.

import { categoriseDetailed, resolveCategory, merchantKey, DEFAULT_CATEGORIES } from './categories.js';

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Whole word or whole phrase on the normalised text. `hay` is ' text ' (space padded).
const hasWord = (hay, p) => { const n = norm(p); return !!n && hay.includes(' ' + n + ' '); };

function contextOk(list, hay, tokens) {
    return (list || []).some((w) => (w === '#digits' ? tokens.some((t) => /\d/.test(t)) : hasWord(hay, w)));
}

// Score of the best match of one merchant entry on the description, or 0 for none (score = length of what matched).
function merchantScore(m, d, k, hay, tokens, amountCents) {
    if (m.direction === 'credit' && !(amountCents > 0)) return 0;
    if (m.direction === 'debit' && !(amountCents < 0)) return 0;
    if ((m.excludePatterns || []).some((p) => hasWord(hay, p))) return 0;
    if (m.requireContext && m.requireContext.length && !contextOk(m.requireContext, hay, tokens)) return 0;
    let best = 0;
    const note = (n) => { if (n > best) best = n; };
    if (m.match === 'key') {
        for (const x of [m.key, ...(m.aliases || [])]) {
            const c = merchantKey(x) || norm(x);
            if (c && k && (k === c || k.startsWith(c + ' '))) note(c.length);
        }
    } else if (m.match === 'keyword') {
        for (const x of [m.key, ...(m.aliases || []), ...(m.patterns || [])]) {
            const c = String(x || '').toLowerCase();
            if (c && d.includes(c)) note(c.length);
        }
    } else if (m.match === 'word') {
        for (const p of m.patterns || []) if (hasWord(hay, p)) note(norm(p).length);
        for (const g of m.guardedPatterns || []) if (hasWord(hay, g.pattern) && contextOk(g.requireContext, hay, tokens)) note(norm(g.pattern).length);
        for (const p of m.tokenPatterns || []) {
            const n = norm(p);
            if (n && tokens.some((t) => t.startsWith(n) && /^\d*$/.test(t.slice(n.length)))) note(n.length);
        }
    }
    return best;
}

// A reference category id as the person's own id: the same id, or the reference category's legacyCategoryId. null when the
// person has no such category (the hit is dropped: nothing is ever filed under a category they do not have).
function localId(refId, ref, ids) {
    if (ids.has(refId)) return refId;
    const c = (ref.categories || []).find((x) => x && x.id === refId);
    return c && c.legacyCategoryId && ids.has(c.legacyCategoryId) ? c.legacyCategoryId : null;
}


/**
 * The reference hit for a description, or null: { categoryId, confidence, refId, via: 'merchant' | 'keyword' }.
 * `categories` are the person's own, `ref` is the view from getReference().
 */
export function referenceHit(description, amountCents, categories, ref) {
    if (!ref) return null;
    const d = String(description || '').toLowerCase();
    if (!d.trim()) return null;
    const ids = new Set((categories || []).map((c) => c.id));
    const hay = ' ' + norm(d) + ' ';
    const tokens = norm(d).split(' ').filter(Boolean);
    const k = merchantKey(description);
    let best = null;
    let bestScore = 0;
    for (const m of ref.merchants || []) {
        if (!m || !m.key) continue;
        const id = localId(m.categoryId, ref, ids);
        if (!id) continue;
        const s = merchantScore(m, d, k, hay, tokens, amountCents);
        if (s > bestScore) { best = { categoryId: id, confidence: m.confidence, refId: m.id, via: 'merchant' }; bestScore = s; }
    }
    if (best) return best;
    // Category keywords only come from real reference data: the in-code default list is the person's own list already.
    if (!ref.sources || ref.sources.categories === 'default') return null;
    const word = ref.keywordMatch !== 'substring';
    for (const c of ref.categories || []) {
        const id = c && localId(c.id, ref, ids);
        if (!id) continue;
        for (const kw of c.keywords || []) {
            if (kw && (word ? hasWord(hay, kw) : d.includes(String(kw).toLowerCase()))) {
                return { categoryId: id, confidence: 'low', refId: c.id, via: 'keyword' };
            }
        }
    }
    return null;
}

// The person's categories with every unchanged shipped default keyword removed: what is left is theirs (added or edited).
function withoutShippedKeywords(categories) {
    return (categories || []).map((c) => {
        const d = DEFAULT_CATEGORIES.find((x) => x.id === c.id);
        const shipped = new Set(d ? d.keywords : []);
        return { ...c, keywords: (c.keywords || []).filter((k) => !shipped.has(k)) };
    });
}

/**
 * categoriseDetailed with the reference layers below the person's own: { categoryId, by: 'rule' | 'keyword' | 'reference' | 'none',
 * rule?, reference? }. With no `ref`, or no reference hit, the answer is categoriseDetailed's own.
 */
export function categoriseWithReference(description, amountCents, categories, rules, ref) {
    const det = categoriseDetailed(description, categories, rules);
    if (!ref || (det.by !== 'none' && det.by !== 'keyword')) return det;
    if (det.by === 'keyword') {
        // D5 6.1: only a keyword the person added or edited ends the reference steps. An unchanged shipped default keyword is
        // reference level, so a more specific reference merchant beats it (coles-express over coles).
        if (categoriseDetailed(description, withoutShippedKeywords(categories), []).by === 'keyword') return det;
        const m = referenceHit(description, amountCents, categories, { ...ref, categories: [] });
        return m && m.via === 'merchant' ? { categoryId: m.categoryId, by: 'reference', reference: m } : det;
    }
    const hit = referenceHit(description, amountCents, categories, ref);
    return hit ? { categoryId: hit.categoryId, by: 'reference', reference: hit } : det;
}

/**
 * resolveCategory with the reference layers. A category the person picked wins. Every reference hit is 'review' and
 * referenceSuggested, whatever its confidence (FT-R-117, FT-R-126 item 3); `refConfidence` ('high' | 'medium' | 'low') is
 * carried so a later "confirm all the sure ones" action can use it. It never skips the suggested mark.
 * @returns {{categoryId:string, status:'ok'|'review', referenceSuggested?:true, refConfidence?:string, refId?:string}}
 */
export function resolveWithReference(description, amountCents, chosenId, categories, rules, ref) {
    if (chosenId || !ref) return resolveCategory(description, chosenId, categories, rules);
    const det = categoriseWithReference(description, amountCents, categories, rules, ref);
    if (det.by !== 'reference') return resolveCategory(description, chosenId, categories, rules);
    const h = det.reference;
    return { categoryId: det.categoryId, status: 'review', referenceSuggested: true, refConfidence: h.confidence, refId: h.refId };
}
