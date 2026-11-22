// Reference merchant matcher for the fixture round-trip (D5 section 7, FT-0032 DB5).
// Pure, offline. The semantics are the ones D5 writes in the merchants file note:
//   text = lowercase, every run of non-letters/digits becomes one space.
//   patterns         whole word or whole phrase on that text.
//   guardedPatterns  a pattern that counts only when one requireContext word is also on the line ("#digits" = any token with a digit).
//   tokenPatterns    one token equal to the pattern followed only by digits (joined store numbers).
//   excludePatterns  the entry does not match when any is present.
//   requireContext   entry level: at least one of these words must be on the line.
//   direction        credit-only or debit-only entries need the amount's sign.
// Longest matching pattern wins; a tie goes to the entry listed first (ids sorted). The key is not a pattern.
// This mirrors what the app will do when the reference matcher is wired in; it does not touch src/.

export const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const hasPhrase = (norm, phrase) => {
    const p = normText(phrase);
    return p !== '' && (` ${norm} `).includes(` ${p} `);
};

const contextOk = (tokens, words) => (words || []).some((w) => (w === '#digits' ? tokens.some((t) => /\d/.test(t)) : tokens.includes(normText(w))));

/** Best hit of one merchant entry on a description: the length of its longest matching pattern, or 0. */
export function merchantHit(m, description, direction = 'debit') {
    const norm = normText(description);
    if (!norm) return 0;
    if (m.direction === 'credit' && direction !== 'credit') return 0;
    if (m.direction === 'debit' && direction !== 'debit') return 0;
    const tokens = norm.split(' ');
    if (m.requireContext && m.requireContext.length && !contextOk(tokens, m.requireContext)) return 0;
    if ((m.excludePatterns || []).some((x) => hasPhrase(norm, x))) return 0;
    let best = 0;
    const take = (n) => { if (n > best) best = n; };
    for (const p of m.patterns || []) if (hasPhrase(norm, p)) take(normText(p).length);
    for (const g of m.guardedPatterns || []) if (hasPhrase(norm, g.pattern) && contextOk(tokens, g.requireContext)) take(normText(g.pattern).length);
    for (const t of m.tokenPatterns || []) { const p = normText(t); if (tokens.some((x) => x.startsWith(p) && /^\d*$/.test(x.slice(p.length)))) take(p.length); }
    return best;
}

/** The reference merchant for a description (the entry with the longest hit), or null. `merchants` must be in a fixed order. */
export function matchMerchant(merchants, description, direction = 'debit') {
    let best = null;
    let bestLen = 0;
    for (const m of merchants) {
        const n = merchantHit(m, description, direction);
        if (n > bestLen) { best = m; bestLen = n; }
    }
    return best;
}
