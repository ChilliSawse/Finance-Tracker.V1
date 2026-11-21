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

// Card-network and wallet prefixes stripped before a merchant key is built.
const KEY_PREFIX = /^(?:(?:sq|sp|pp|paypal|tyro|zlr|zip|ls)\s*\*\s*|eftpos\s+|visa\s+purchase\s+|card\s+purchase\s+|purchase\s+)+/;

/**
 * Stable merchant key for a bank description (learned rules): lowercase, card prefixes removed,
 * the first one or two alphabetic words kept, stopping at the first word with a digit (store
 * numbers, and the suburb after them). 'WOOLWORTHS 1234 NEWTOWN' gives 'woolworths'.
 * @param {string} description
 * @returns {string} the key, '' when nothing usable is left.
 */
export function merchantKey(description) {
    const d = String(description || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(KEY_PREFIX, '').replace(/\*/g, ' ');
    const words = [];
    for (const tok of d.split(/\s+/)) {
        if (/\d/.test(tok)) break;
        const w = tok.replace(/[^a-z]/g, '');
        if (w.length < 2) continue;
        words.push(w);
        if (words.length === 2) break;
    }
    return words.join(' ');
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
                if (kw && d.includes(kw)) return { categoryId: cat.id, by: 'keyword' };
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
