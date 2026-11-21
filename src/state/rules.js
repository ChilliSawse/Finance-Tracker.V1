// Learned rules and categorisation (owner: B8). M0 stub: categorise delegates to
// the keyword matcher, so callers can adopt the final signature now.

import { categoriseDescription } from './categories.js';

/**
 * @param {string} description
 * @param {Array} categories - financeData.categories.
 * @param {Array} [rules] - learned rules (ignored by the stub).
 * @returns {string} category id.
 */
export function categorise(description, categories, rules = []) {
    return categoriseDescription(description, categories);
}
