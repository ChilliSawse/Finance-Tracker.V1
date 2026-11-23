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

// Wallet and processor prefixes. The `*` is what makes a short prefix safe, so these are stripped while it is still there,
// and only when it follows ('SQ *CAFE' loses 'SQ'; a bare leading 'SP' stays).
const WALLET = 'sq|sp|pp|paypal|tyro|zlr|zip|ls|dd|lgc';
const KEY_PREFIX = new RegExp('^(?:(?:' + WALLET + ')\\s*\\*\\s*)+');
// Only the two prefixes the old key function did not strip; the rest were removed before, so a stored key never carries them.
const BARE_WALLET = /^(?:dd|lgc)\s+/;

// Punctuation that separates words (D5 4.2 step 2). A dot, apostrophe or dash inside a word is not here: those are removed
// word by word below, so 'COCA-COLA' and "McDonald's" keep the keys they always had.
const SEPARATORS = /[,;:|()[\]{}"<>_\\]|(?:^|\s)[-–—](?=\s|$)/g;

// Rail text (how the bank describes the payment, not who was paid), removed from the front, repeatedly.
// Named patterns only: arbitrary leading digit tokens are never skipped ('7-ELEVEN 123' stays empty).
// visa debit (purchase (card N)), visa purchase, debit card purchase, card purchase (with pin), eftpos (debit|purchase), pos,
// purchase, tap and pay, contactless, recurring payment, direct debit (N), a NAB 'V2878 06/11' lead, a leading date,
// a '~448813HJs' card reference, 'card xx1234'.
const RAIL_PREFIX = /^(?:visa\s+debit(?:\s+purchase(?:\s+card\s+\d+)?)?|visa\s+purchase|debit\s+card\s+purchase|card\s+purchase(?:\s+with\s+pin)?|eftpos(?:\s+(?:debit|purchase))?|pos|purchase|tap\s+and\s+pay|contactless|recurring\s+payment|direct\s+debit(?:\s+\d+)?|v\d{4}\s+\d{1,2}\/\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|~\d{6}[a-z]{0,3}|card\s+x*\d{4})(?:\s+|$)/;
// Trailing noise that would otherwise be read as part of the name.
const KEY_TRAILER = /\s+(?:card\s+x+\d+|value\s+date)\b.*$/;

function stripRail(d) {
    for (let again = true; again;) {
        const next = d.replace(KEY_PREFIX, '').replace(RAIL_PREFIX, '').replace(/^\*+\s*/, '');
        again = next !== d;
        d = next;
    }
    return d;
}

/**
 * Stable merchant key for a bank description (learned rules): lowercase, wallet prefixes and bank rail text
 * removed (VISA DEBIT PURCHASE CARD 1234, EFTPOS, 'PURCHASE, X', Direct Debit 123456, a NAB 'V2878 06/11' lead), the first
 * one or two alphabetic words kept, stopping at the first word with a digit (store numbers, and the suburb
 * after them). 'WOOLWORTHS 1234 NEWTOWN' gives 'woolworths'; 'VISA DEBIT PURCHASE CARD 1234 WOOLWORTHS 5522'
 * gives 'woolworths'. 'BIG W 0119' keeps its one-letter word ('big w'); no other one-letter word is kept.
 * Idempotent: the key of a key is itself. Changed in DB2 (D5 4.2).
 * @param {string} description
 * @returns {string} the key, '' when nothing usable is left.
 */
export function merchantKey(description) {
    let d = stripRail(String(description || '').toLowerCase().replace(SEPARATORS, ' ').replace(/\s+/g, ' ').trim());
    d = stripRail(d.replace(KEY_TRAILER, '').replace(/\*/g, ' ').trim());
    const words = [];
    for (const tok of d.split(/\s+/)) {
        if (/\d/.test(tok)) break;
        const w = tok.replace(/[^a-z]/g, '');
        if (w.length < 2 && !(w === 'w' && words.length === 1 && words[0] === 'big')) continue;
        words.push(w);
        if (words.length === 2) break;
    }
    const key = words.join(' ');
    // Skipping a word can leave rail text at the front ('w purchase v1234'): clean it so the key of a key is itself.
    return key && stripRail(key) !== key ? merchantKey(key) : key;
}

// Boundary rules for the shipped default keywords (D5 6.4). A keyword not listed here stays a plain substring, as before.
//   WHOLE   whole word, no letter or digit touching either side (no plural): ola, shell, bp, ...
//   START   starts a word only: 'steam' hits STEAMGAMES but not MISTEAMS, 'agl' hits AGLENERGY but not EAGLE
//   'gym'   anywhere except GYMPIE
// Only a default category's own default keyword (exact stored text) gets a rule: a keyword the user typed or edited,
// and every keyword in a category the user made, keeps plain substring matching.
const WHOLE = new Set('iga |aldi|belong|ola|bp |shell|rego|nib |ahm |rac |stan |rex |ato |big w'.split('|'));
const START = new Set('rent|agl|steam|kayo|target|myer|ikea|kfc|qbe|tpg|nbn|bcf|temu|strata|coles|rebel|binge'.split('|'));
const isDefaultKeyword = (catId, kw) => DEFAULT_CATEGORIES.some((c) => c.id === catId && c.keywords.includes(kw));
const BOUNDARY_RE = new Map();
const B = '(?:^|[^a-z0-9])';

/** Does keyword `kw` (stored text) hit the lowercased description `d`, for category `catId`? */
function keywordHits(d, kw, catId) {
    let re = BOUNDARY_RE.get(kw);
    if (re === undefined) {
        const w = kw.trim();
        const src = kw === 'gym' ? 'gym(?!pie)' : WHOLE.has(kw) ? B + w + '(?![a-z0-9])' : START.has(kw) ? B + w : '';
        re = src ? new RegExp(src) : null;
        BOUNDARY_RE.set(kw, re);
    }
    return re && isDefaultKeyword(catId, kw) ? re.test(d) : d.includes(kw);
}

// What a stored rule key can match, at lookup time (nothing is rewritten). Rules learned under an older merchantKey may carry
// wallet or rail text in the key ('dd doordash', 'purchase woolworths'), so a rule matches under its own key, and under
// that key run through the current merchantKey with or without a leading wallet prefix.
const RULE_KEYS = new Map();
function ruleKeys(key) {
    let v = RULE_KEYS.get(key);
    if (!v) {
        v = [...new Set([key, merchantKey(key), merchantKey(key.replace(BARE_WALLET, ''))].filter(Boolean))];
        RULE_KEYS.set(key, v);
    }
    return v;
}

/** Length of the longest key of `rule` that matches the merchant key `k` (same, or k starts with it and a space); 0 for none. */
export function ruleMatchLength(rule, k) {
    let best = 0;
    if (rule && typeof rule.key === 'string' && k) {
        for (const c of ruleKeys(rule.key)) if ((k === c || k.startsWith(c + ' ')) && c.length > best) best = c.length;
    }
    return best;
}

// The learned rule that applies to a description. The longest matching key wins, then the later rule. A rule whose
// category no longer exists is ignored.
function ruleFor(description, categories, rules) {
    if (!Array.isArray(rules) || !rules.length) return null;
    const k = merchantKey(description);
    if (!k) return null;
    const ids = new Set((categories || []).map((c) => c.id));
    let best = null;
    let bestLen = 0;
    for (const r of rules) {
        if (!r || !r.key || !ids.has(r.categoryId)) continue;
        const len = ruleMatchLength(r, k);
        if (len && len >= bestLen) { best = r; bestLen = len; }
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
