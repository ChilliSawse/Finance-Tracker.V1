// Spending categories — the shared vocabulary for CSV import auto-categorisation,
// budget envelopes, and spending analytics.
//
// Stored on financeData.categories (localStorage) so they're user-editable and
// travel with JSON backups. `keywords` are lowercase substrings matched against
// transaction descriptions (first matching category in array order wins).
// `monthlyBudget` (dollars) is the optional envelope cap; 0 = no envelope.

export const DEFAULT_CATEGORIES = [
    { id: 'groceries', icon: 'cart', name: 'Groceries', essential: true, monthlyBudget: 0,
      keywords: ['woolworths', 'coles', 'aldi', 'iga ', 'foodland', 'harris farm', 'costco', 'spudshed'] },
    { id: 'housing', icon: 'home', name: 'Rent & Mortgage', essential: true, monthlyBudget: 0,
      keywords: ['rent', 'mortgage', 'ray white', 'lj hooker', 'body corporate', 'strata'] },
    { id: 'utilities', icon: 'bolt', name: 'Utilities & Internet', essential: true, monthlyBudget: 0,
      keywords: ['agl', 'origin energy', 'energyaustralia', 'red energy', 'alinta', 'synergy', 'ergon',
                 'water corp', 'sydney water', 'yarra valley water', 'urban utilities'] },
    { id: 'phone-internet', icon: 'phone', name: 'Phone & Internet', essential: true, monthlyBudget: 0,
      keywords: ['telstra', 'optus', 'vodafone', 'tpg', 'aussie broadband', 'iinet', 'belong', 'nbn'] },
    { id: 'transport', icon: 'car', name: 'Transport & Fuel', essential: true, monthlyBudget: 0,
      keywords: ['opal', 'myki', 'translink', 'transperth', 'metro trains', 'uber trip', 'didi', 'ola',
                 'bp ', 'shell', 'caltex', 'ampol', 'united petroleum', '7-eleven fuel', 'linkt', 'eastlink',
                 'e-toll', 'rego', 'vicroads', 'service nsw'] },
    { id: 'health', icon: 'heart', name: 'Health & Medical', essential: true, monthlyBudget: 0,
      keywords: ['chemist warehouse', 'priceline', 'terrywhite', 'pharmacy', 'medical', 'dental', 'dentist',
                 'physio', 'medicare', 'bupa', 'medibank', 'hcf', 'nib ', 'ahm '] },
    { id: 'insurance', icon: 'shield', name: 'Insurance', essential: true, monthlyBudget: 0,
      keywords: ['aami', 'nrma', 'allianz', 'budget direct', 'youi', 'qbe', 'suncorp insurance', 'racv', 'racq', 'rac '] },
    { id: 'dining', icon: 'utensils', name: 'Dining & Takeaway', essential: false, monthlyBudget: 0,
      keywords: ["mcdonald", 'kfc', 'hungry jack', 'subway', "domino", 'uber eats', 'menulog', 'doordash',
                 'grill', 'cafe', 'coffee', 'restaurant', 'sushi', 'kebab', 'bakery', 'zambrero', 'guzman'] },
    { id: 'entertainment', icon: 'film', name: 'Entertainment', essential: false, monthlyBudget: 0,
      keywords: ['netflix', 'spotify', 'stan ', 'binge', 'kayo', 'disney', 'prime video', 'youtube premium',
                 'paramount', 'steam', 'playstation', 'xbox', 'nintendo', 'hoyts', 'event cinemas', 'village cinemas', 'ticketek', 'ticketmaster'] },
    { id: 'subscriptions', icon: 'repeat', name: 'Subscriptions & Software', essential: false, monthlyBudget: 0,
      keywords: ['adobe', 'icloud', 'google one', 'google storage', 'dropbox', 'openai', 'chatgpt', 'anthropic',
                 'patreon', 'github', 'microsoft 365', 'canva'] },
    { id: 'fitness', icon: 'dumbbell', name: 'Fitness & Wellbeing', essential: false, monthlyBudget: 0,
      keywords: ['anytime fitness', 'gym', 'f45', 'snap fitness', 'fitness first', 'plus fitness', 'crunch fitness', 'yoga', 'pilates'] },
    { id: 'shopping', icon: 'bag', name: 'Shopping', essential: false, monthlyBudget: 0,
      keywords: ['kmart', 'target', 'big w', 'myer', 'david jones', 'amazon', 'ebay', 'jb hi-fi', 'harvey norman',
                 'officeworks', 'bunnings', 'ikea', 'the iconic', 'cotton on', 'uniqlo', 'rebel', 'bcf', 'temu', 'shein'] },
    { id: 'travel', icon: 'plane', name: 'Travel', essential: false, monthlyBudget: 0,
      keywords: ['qantas', 'jetstar', 'virgin australia', 'rex ', 'airbnb', 'booking.com', 'expedia', 'hotel', 'motel', 'wotif'] },
    { id: 'income', icon: 'wallet', name: 'Income', essential: false, monthlyBudget: 0,
      keywords: ['salary', 'payroll', 'pay run', 'centrelink', 'ato ', 'tax refund', 'dividend', 'distribution'] },
    { id: 'other', icon: 'dots', name: 'Other', essential: false, monthlyBudget: 0, keywords: [] },
];

// Fallback icons for saved categories that carry none (FT-R-39). Fixed small set.
const ICON_BY_ID = Object.fromEntries(DEFAULT_CATEGORIES.map(d => [d.id, d.icon]));
ICON_BY_ID['other-essential'] = 'dots';
export const GENERIC_CATEGORY_ICON = 'tag';

export function categoryIcon(cat) {
    if (!cat) return GENERIC_CATEGORY_ICON;
    return cat.icon || ICON_BY_ID[cat.id] || GENERIC_CATEGORY_ICON;
}

// Copy of a saved list with a fallback icon on any category lacking one. Nothing else changes.
export function withFallbackIcons(categories) {
    return (categories || []).map(c => (c.icon ? { ...c } : { ...c, icon: categoryIcon(c) }));
}

export function cloneDefaultCategories() {
    return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}

// Wallet and processor prefixes. The `*` is what makes a short prefix safe, so these are stripped first,
// while it is still there, and only when it follows ('SQ *CAFE' loses 'SQ'; a bare leading 'SP' stays).
const KEY_PREFIX = /^(?:(?:sq|sp|pp|paypal|tyro|zlr|zip|ls|dd|lgc)\s*\*\s*)+/;

// Rail text (how the bank describes the payment, not who was paid), removed from the front, repeatedly.
// Named patterns only: arbitrary leading digit tokens are never skipped ('7-ELEVEN 123' stays empty).
// Alternatives: visa debit (purchase (card N)), visa purchase, debit card purchase, card purchase (with pin), eftpos (debit|purchase),
// pos, purchase, tap and pay, contactless, recurring payment, direct debit (N), a NAB 'V2878 06/11' lead, a leading date,
// a '~448813HJs' card reference, 'card xx1234'.
const RAIL_PREFIX = /^(?:visa\s+debit(?:\s+purchase(?:\s+card\s+\d+)?)?|visa\s+purchase|debit\s+card\s+purchase|card\s+purchase(?:\s+with\s+pin)?|eftpos(?:\s+(?:debit|purchase))?|pos|purchase|tap\s+and\s+pay|contactless|recurring\s+payment|direct\s+debit(?:\s+\d+)?|v\d{4}\s+\d{1,2}\/\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|~\d{6}[a-z]{0,3}|card\s+x*\d{4})\s+/;
// Trailing noise that would otherwise be read as part of the name.
const KEY_TRAILER = /\s+(?:card\s+x+\d+|value\s+date)\b.*$/;

/**
 * Stable merchant key for a bank description (learned rules): lowercase, wallet prefixes and bank rail text
 * removed (VISA DEBIT PURCHASE CARD 1234, EFTPOS, Direct Debit 123456, a NAB 'V2878 06/11' lead), the first
 * one or two alphabetic words kept, stopping at the first word with a digit (store numbers, and the suburb
 * after them). 'WOOLWORTHS 1234 NEWTOWN' gives 'woolworths'; 'VISA DEBIT PURCHASE CARD 1234 WOOLWORTHS 5522'
 * gives 'woolworths'. A one-letter second word is kept after a short first word ('BIG W 0119' gives 'big w').
 * Idempotent: the key of a key is itself (the rules migration relies on that). Changed in DB2 (D5 4.2).
 * @param {string} description
 * @returns {string} the key, '' when nothing usable is left.
 */
export function merchantKey(description) {
    let d = String(description || '').toLowerCase().replace(/\s+/g, ' ').trim();
    d = d.replace(KEY_PREFIX, '');
    for (let again = true; again;) {
        again = false;
        const next = d.replace(RAIL_PREFIX, '');
        if (next !== d) { d = next; again = true; }
    }
    d = d.replace(KEY_TRAILER, '').replace(/\*/g, ' ');
    const words = [];
    for (const tok of d.split(/\s+/)) {
        if (/\d/.test(tok)) break;
        const w = tok.replace(/[^a-z]/g, '');
        if (w.length < 2 && !(w.length === 1 && words.length === 1 && words[0].length <= 3)) continue;
        words.push(w);
        if (words.length === 2) break;
    }
    return words.join(' ');
}

// Boundary rules for the shipped default keywords (D5 6.4). A keyword not listed here stays a plain substring, as before.
//   WHOLE   whole word, no letter or digit touching either side ('s' plural accepted): ola, shell, agl, aldi, ...
//   START   starts a word only: 'coles' no longer hits NICOLES
//   'rent'  whole word plus RENTS / RENTAL / RENTALS (today's correct hits), never CURRENT or PARENT
//   'gym'   ends a word: PUREGYM and GYMS hit, GYMPIE does not
// Only a default category's own default keyword (exact stored text) gets a rule: a keyword the user typed or edited,
// and every keyword in a category the user made, keeps plain substring matching.
const WHOLE = new Set('iga |aldi|strata|agl|tpg|belong|nbn|ola|bp |shell|rego|nib |ahm |qbe|rac |kfc|stan |kayo|steam|target|big w|myer|ikea|bcf|temu|rex |ato '.split('|'));
const START = new Set(['coles', 'rebel', 'binge']);
const isDefaultKeyword = (catId, kw) => DEFAULT_CATEGORIES.some((c) => c.id === catId && c.keywords.includes(kw));
const BOUNDARY_RE = new Map();
const B = '(?:^|[^a-z0-9])';
const E = '(?![a-z0-9])';

/** Does keyword `kw` (stored text) hit the lowercased description `d`, for category `catId`? */
function keywordHits(d, kw, catId) {
    let re = BOUNDARY_RE.get(kw);
    if (re === undefined) {
        const w = kw.trim();
        const src = kw === 'rent' ? B + 'rent(?:s|als?)?' + E : kw === 'gym' ? 'gyms?' + E : WHOLE.has(kw) ? B + w + 's?' + E : START.has(kw) ? B + w : '';
        re = src ? new RegExp(src) : null;
        BOUNDARY_RE.set(kw, re);
    }
    return re && isDefaultKeyword(catId, kw) ? re.test(d) : d.includes(kw);
}

// The learned rule that applies to a description: same key, or the description's key starts with
// the rule's key plus a space. The longest key wins, then the later rule. A rule whose category
// no longer exists is ignored.
function ruleFor(description, categories, rules) {
    if (!Array.isArray(rules) || !rules.length) return null;
    const k = merchantKey(description);
    if (!k) return null;
    const ids = new Set((categories || []).map((c) => c.id));
    let best = null;
    for (const r of rules) {
        if (!r || !r.key || !ids.has(r.categoryId)) continue;
        if (k !== r.key && !k.startsWith(r.key + ' ')) continue;
        if (!best || r.key.length >= best.key.length) best = r;
    }
    return best;
}

/**
 * Categorise and say how: { categoryId, by: 'rule' | 'keyword' | 'none', rule? }.
 * Order: learned rules, then category keywords, then 'other' (by 'none').
 */
export function categoriseDetailed(description, categories, rules = []) {
    const rule = ruleFor(description, categories, rules);
    if (rule) return { categoryId: rule.categoryId, by: 'rule', rule };
    const d = (description || '').toLowerCase();
    if (d) {
        for (const cat of categories) {
            for (const kw of (cat.keywords || [])) {
                if (kw && keywordHits(d, kw, cat.id)) return { categoryId: cat.id, by: 'keyword' };
            }
        }
    }
    return { categoryId: 'other', by: 'none' };
}

/**
 * Auto-categorise a transaction description: learned rules first (optional third argument),
 * then the first category (in array order) with a keyword contained in the lowercased
 * description; 'other' otherwise.
 * @param {string} description
 * @param {Array} categories - financeData.categories (or the defaults).
 * @param {Array} [rules] - financeData.rules.
 * @returns {string} category id.
 */
export function categoriseDescription(description, categories, rules = []) {
    return categoriseDetailed(description, categories, rules).categoryId;
}

/**
 * Category and review status for a row about to be stored (FT-R-55). `chosenId` is a category
 * already picked (the import preview). status is 'review' only when the row is uncategorised,
 * meaning it ends up in 'other' and no learned rule put it there. A rule or keyword hit is 'ok'
 * even in a category like Health.
 * @returns {{categoryId:string, status:'ok'|'review'}}
 */
export function resolveCategory(description, chosenId, categories, rules = []) {
    const det = categoriseDetailed(description, categories, rules);
    const categoryId = chosenId || det.categoryId;
    const byRule = det.by === 'rule' && det.categoryId === categoryId;
    return { categoryId, status: categoryId === 'other' && !byRule ? 'review' : 'ok' };
}
