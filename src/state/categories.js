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

/**
 * Auto-categorise a transaction description: first category (in array order)
 * with a keyword contained in the lowercased description wins; 'other' otherwise.
 * @param {string} description
 * @param {Array} categories - financeData.categories (or the defaults).
 * @returns {string} category id.
 */
export function categoriseDescription(description, categories) {
    const d = (description || '').toLowerCase();
    if (d) {
        for (const cat of categories) {
            for (const kw of (cat.keywords || [])) {
                if (kw && d.includes(kw)) return cat.id;
            }
        }
    }
    return 'other';
}
