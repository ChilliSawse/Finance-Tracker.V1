// Spending categories — the shared vocabulary for CSV import auto-categorisation,
// budget envelopes, and spending analytics.
//
// Stored on financeData.categories (localStorage) so they're user-editable and
// travel with JSON backups. `keywords` are lowercase substrings matched against
// transaction descriptions (first matching category in array order wins).
// `monthlyBudget` (dollars) is the optional envelope cap; 0 = no envelope.

export const DEFAULT_CATEGORIES = [
    { id: 'groceries', name: 'Groceries', essential: true, monthlyBudget: 0,
      keywords: ['woolworths', 'coles', 'aldi', 'iga ', 'foodland', 'harris farm', 'costco', 'spudshed'] },
    { id: 'housing', name: 'Rent & Mortgage', essential: true, monthlyBudget: 0,
      keywords: ['rent', 'mortgage', 'ray white', 'lj hooker', 'body corporate', 'strata'] },
    { id: 'utilities', name: 'Utilities & Internet', essential: true, monthlyBudget: 0,
      keywords: ['agl', 'origin energy', 'energyaustralia', 'red energy', 'alinta', 'synergy', 'ergon',
                 'telstra', 'optus', 'vodafone', 'tpg', 'aussie broadband', 'iinet', 'belong', 'nbn',
                 'water corp', 'sydney water', 'yarra valley water', 'urban utilities'] },
    { id: 'transport', name: 'Transport & Fuel', essential: true, monthlyBudget: 0,
      keywords: ['opal', 'myki', 'translink', 'transperth', 'metro trains', 'uber trip', 'didi', 'ola',
                 'bp ', 'shell', 'caltex', 'ampol', 'united petroleum', '7-eleven fuel', 'linkt', 'eastlink',
                 'e-toll', 'rego', 'vicroads', 'service nsw'] },
    { id: 'health', name: 'Health & Medical', essential: true, monthlyBudget: 0,
      keywords: ['chemist warehouse', 'priceline', 'terrywhite', 'pharmacy', 'medical', 'dental', 'dentist',
                 'physio', 'medicare', 'bupa', 'medibank', 'hcf', 'nib ', 'ahm '] },
    { id: 'insurance', name: 'Insurance', essential: true, monthlyBudget: 0,
      keywords: ['aami', 'nrma', 'allianz', 'budget direct', 'youi', 'qbe', 'suncorp insurance', 'racv', 'racq', 'rac '] },
    { id: 'dining', name: 'Dining & Takeaway', essential: false, monthlyBudget: 0,
      keywords: ["mcdonald", 'kfc', 'hungry jack', 'subway', "domino", 'uber eats', 'menulog', 'doordash',
                 'grill', 'cafe', 'coffee', 'restaurant', 'sushi', 'kebab', 'bakery', 'zambrero', 'guzman'] },
    { id: 'entertainment', name: 'Entertainment', essential: false, monthlyBudget: 0,
      keywords: ['netflix', 'spotify', 'stan ', 'binge', 'kayo', 'disney', 'prime video', 'youtube premium',
                 'paramount', 'steam', 'playstation', 'xbox', 'nintendo', 'hoyts', 'event cinemas', 'village cinemas', 'ticketek', 'ticketmaster'] },
    { id: 'subscriptions', name: 'Subscriptions & Software', essential: false, monthlyBudget: 0,
      keywords: ['adobe', 'icloud', 'google one', 'google storage', 'dropbox', 'openai', 'chatgpt', 'anthropic',
                 'patreon', 'github', 'microsoft 365', 'canva'] },
    { id: 'shopping', name: 'Shopping', essential: false, monthlyBudget: 0,
      keywords: ['kmart', 'target', 'big w', 'myer', 'david jones', 'amazon', 'ebay', 'jb hi-fi', 'harvey norman',
                 'officeworks', 'bunnings', 'ikea', 'the iconic', 'cotton on', 'uniqlo', 'rebel', 'bcf', 'temu', 'shein'] },
    { id: 'travel', name: 'Travel', essential: false, monthlyBudget: 0,
      keywords: ['qantas', 'jetstar', 'virgin australia', 'rex ', 'airbnb', 'booking.com', 'expedia', 'hotel', 'motel', 'wotif'] },
    { id: 'income', name: 'Income', essential: false, monthlyBudget: 0,
      keywords: ['salary', 'payroll', 'pay run', 'centrelink', 'ato ', 'tax refund', 'dividend', 'distribution'] },
    { id: 'other', name: 'Other', essential: false, monthlyBudget: 0, keywords: [] },
];

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
