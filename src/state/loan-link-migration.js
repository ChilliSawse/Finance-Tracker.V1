// Loan link migration (FT-0032 DB11, FT-R-128 3). Chain step after the asset scope step. Core chunk, so kept small.
//
// Adds, only where absent, on each liability:
//   forAssetId        the id of the property this loan is for, or null (unlinked).
//   forAssetSuggested true while the link is only a guess from the names, false when it is the person's own or there is none.
// A suggested link has no effect on the FI figure until confirmed (FT-R-117, FT-R-128 3; see `loanScope` in assets-debts.js).
// The suggestion is deliberately cautious: a home loan or mortgage goes to the only property, or to the one property whose
// name shares a word with the loan's name; anything unclear stays unlinked. Car loans, cards, personal loans and HELP never
// get a suggestion. Balances, names, rates and ids are never touched.
// Idempotent behind data.loanLinkVersion >= 1, and a field that is already there (a backup that has links) is kept.

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);

// Words that say a loan buys a property, and words that never do.
const HOME_WORDS = ['mortgage', 'home', 'house', 'property', 'investment', 'unit', 'apartment'];
const NOT_HOME_WORDS = ['car', 'credit', 'card', 'help', 'hecs', 'personal', 'student', 'vehicle', 'ute', 'bike', 'motorbike', 'boat', 'caravan', 'afterpay', 'zip', 'overdraft', 'tax', 'ato', 'business', 'margin', 'finance', 'lease', 'novated',
    'toyota', 'mazda', 'ford', 'holden', 'honda', 'hyundai', 'kia', 'nissan', 'mitsubishi', 'subaru', 'volkswagen', 'vw', 'bmw', 'mercedes', 'audi', 'tesla', 'suzuki', 'isuzu', 'jeep', 'lexus', 'volvo', 'mg', 'ram', 'landcruiser', 'hilux', 'ranger'];
// Words that say nothing about WHICH property.
const GENERIC = new Set(['loan', 'mortgage', 'home', 'house', 'property', 'investment', 'ip', 'the', 'my', 'our', 'a', 'of', 'at', 'on', 'for', 'and', 'to', 'in', 'new', 'old', 'first', 'second', 'fixed', 'variable', 'unit', 'apartment', 'flat', 'land', 'st', 'rd', 'ave']);

/** Does the loan's name say it is for a home or property? A link suggested without this (a single property and no other clue) is a weak guess. */
export const hasHomeWord = (name) => words(name).some((w) => HOME_WORDS.includes(w));

/** The properties a loan could be for: assets of kind appreciating that have an id. */
const propertiesOf = (assets) => (Array.isArray(assets) ? assets : []).filter((a) => isObj(a) && a.kind === 'appreciating' && a.id != null && a.id !== '');

/**
 * The id of the property a loan is probably for, or null when the match is unclear.
 * Pure; the asset screen can call it again when a loan is added or renamed.
 */
export function suggestLoanLink(loan, assets) {
    if (!isObj(loan)) return null;
    const lw = words(loan.name);
    if (lw.some((w) => NOT_HOME_WORDS.includes(w))) return null;
    const props = propertiesOf(assets);
    if (!props.length) return null;
    if (props.length === 1) return props[0].id; // the one case that needs no home word: a single property and nothing that says "not a home"
    // Several properties: the loan must say it is a home or property loan, and a name match then picks one. A shared word alone never links.
    if (!lw.some((w) => HOME_WORDS.includes(w))) return null;
    const distinct = lw.filter((w) => !GENERIC.has(w));
    const named = props.filter((p) => {
        const pw = words(p.name);
        return distinct.some((w) => pw.includes(w));
    });
    return named.length === 1 ? named[0].id : null;
}

export const needsLoanLinkMigration = (d) => isObj(d) && !(d.loanLinkVersion >= 1);

export function migrateLoanLinks(d) {
    if (!needsLoanLinkMigration(d)) return false;
    if (Array.isArray(d.liabilities)) {
        for (const l of d.liabilities) {
            if (!isObj(l)) continue;
            if (l.forAssetId === undefined) {
                const id = suggestLoanLink(l, d.assets);
                l.forAssetId = id;
            }
            // A link with no flag is a guess until confirmed (FT-R-117): never read it as the person's own.
            if (l.forAssetSuggested === undefined) l.forAssetSuggested = l.forAssetId != null && l.forAssetId !== '';
        }
    }
    d.loanLinkVersion = 1;
    return true;
}

/** The chain entry. No backup gate: only adds fields, never touches a balance, name or rate. */
export const loanLinkStep = { name: 'migrateLoanLinks', needs: needsLoanLinkMigration, migrate: migrateLoanLinks, afterImport: () => false };
