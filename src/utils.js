// Shared helpers (moved from js/utils.js).
// updateDataAndUI moved to ui/render.js — it coordinates autosave + rendering,
// which isn't a leaf-utility concern.

import { store } from './state/store.js';

export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Returns the number of pay cycles per year based on the schedule.
 * @param {string} schedule - 'weekly', 'fortnightly', 'monthly', 'yearly'.
 * @returns {number} Number of cycles per year.
 */
export function getPayCyclesPerYear(schedule) {
    switch (schedule) {
        case 'weekly': return 52;
        case 'fortnightly': return 26;
        case 'monthly': return 12;
        case 'yearly': return 1;
        default: return 26; // Default to fortnightly
    }
}

/**
 * Converts an amount to its weekly equivalent.
 * @param {number} amount - The amount.
 * @param {string} frequency - The frequency of the amount.
 * @returns {number} The equivalent weekly amount.
 */
export function getWeeklyAmount(amount, frequency) {
    if (typeof amount !== 'number' || isNaN(amount)) amount = 0;
    switch (frequency) {
        case 'weekly': return amount;
        case 'fortnightly': return amount / 2;
        case 'monthly': return (amount * 12) / 52;
        case 'yearly': return amount / 52;
        default: return amount;
    }
}

/**
 * Human-readable time to reach a savings goal (Stage 0 — allocation bucket goals).
 * @param {number} years - decimal years until the goal is reached.
 * @returns {string}
 */
export function formatTimeToGoal(years) {
    if (!isFinite(years) || years < 0) return '—';
    const months = years * 12;
    if (months < 1) return '< 1 month';
    if (months < 24) {
        const m = Math.round(months);
        return `~${m} month${m === 1 ? '' : 's'}`;
    }
    return `~${years.toFixed(1)} years`;
}

/**
 * Formats a number as currency according to the global settings.
 * @param {number} amount - The number to format.
 * @param {string} [currencyCode] - The currency code (defaults to the app setting).
 * @param {number} [decimalPlaces=2] - Number of decimal places.
 * @returns {string} The formatted currency string.
 */
export function formatCurrency(amount, currencyCode = store.financeData.currency, decimalPlaces = 2) {
    if (typeof amount !== 'number' || isNaN(amount)) {
        amount = 0;
    }
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces
        }).format(amount);
    } catch (e) {
        const symbol = { USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', JPY: '¥', CHF: 'CHF', CNY: '¥', INR: '₹' }[currencyCode] || currencyCode + ' ';
        return symbol + amount.toFixed(decimalPlaces);
    }
}

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was invoked.
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// --- Auto-fit currency figures ---
// Large numbers or long suffixes ("/fortnight") can be wider than their card.
// Rather than wrap mid-number or clip, shrink the figure's font just enough to
// fit, down to a readable floor. Runs after every render + on resize. The figure
// classes are white-space:nowrap (style.css) so horizontal overflow is detectable.
const FIT_SELECTOR = '.amount, .stat-value, .time-amount, .savings-amount, ' +
    '.account-balance, .liability-balance, .expense-amount';
const FIT_MIN_PX = 11;

export function fitTextToWidth(el) {
    el.style.fontSize = '';                          // reset to the CSS-defined size
    if (el.clientWidth === 0) return;                // hidden (inactive tab) — skip
    if (el.scrollWidth <= el.clientWidth) return;    // already fits
    const base = parseFloat(getComputedStyle(el).fontSize);
    let size = Math.max(FIT_MIN_PX, Math.floor(base * el.clientWidth / el.scrollWidth));
    el.style.fontSize = size + 'px';
    // one corrective step for rounding
    if (el.scrollWidth > el.clientWidth && size > FIT_MIN_PX) {
        el.style.fontSize = (size - 1) + 'px';
    }
}

export function fitAllAmounts(root) {
    (root || document).querySelectorAll(FIT_SELECTOR).forEach(fitTextToWidth);
}

// --- Inline Field Validation ---

export function showFieldError(input, message) {
    clearFieldError(input);
    input.classList.add('field-error');
    const errEl = document.createElement('span');
    errEl.className = 'field-error-msg';
    errEl.textContent = message;
    errEl.setAttribute('role', 'alert');
    input.insertAdjacentElement('afterend', errEl);
}

export function clearFieldError(input) {
    input.classList.remove('field-error');
    const parent = input.closest('span') || input.parentElement;
    if (parent) {
        const existing = parent.querySelector('.field-error-msg');
        if (existing) existing.remove();
    }
}

// Returns an error string if invalid, or null if valid.
export function validateFieldValue(field, rawValue) {
    const str = rawValue == null ? '' : String(rawValue);
    const num = parseFloat(str);
    const empty = str.trim() === '';

    switch (field) {
        case 'name':
            if (empty) return 'Name cannot be empty';
            if (str.trim().length > 100) return 'Max 100 characters';
            return null;

        case 'grossAnnual':
        case 'balance':
        case 'amount':
        case 'taxRemoved':
            if (empty) return null;
            if (isNaN(num) || num < 0) return 'Must be 0 or greater';
            return null;

        case 'interestRate':
            if (isNaN(num) || num < 0 || num > 100) return 'Must be 0 – 100 %';
            return null;

        case 'percentage':
            if (isNaN(num) || num < 0 || num > 100) return 'Must be 0 – 100';
            return null;

        case 'rate':
            // Input is shown as % (0–100); stored as decimal after /100 conversion
            if (isNaN(num) || num < 0 || num > 100) return 'Must be 0 – 100 %';
            return null;

        case 'hoursPerCycle':
        case 'invoicedPayPostTax':
            if (empty) return null; // optional fields
            if (isNaN(num) || num < 0) return 'Must be 0 or greater';
            return null;

        case 'min':
            if (isNaN(num) || num < 0) return 'Must be 0 or greater';
            return null;

        case 'max':
            if (empty) return null; // empty = Infinity
            if (isNaN(num) || num < 0) return 'Must be 0 or greater';
            return null;

        default:
            return null;
    }
}

// --- DOM Helper Functions ---

/**
 * Safely gets an element by its ID.
 */
export function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element with ID '${id}' not found.`);
    }
    return element;
}

/**
 * Safely sets the text content of an element.
 */
export function setText(elementId, text) {
    const element = getElement(elementId);
    if (element) {
        element.textContent = text;
    }
}

/**
 * Safely sets the HTML content of an element.
 */
export function setHTML(elementId, html) {
    const element = getElement(elementId);
    if (element) {
        element.innerHTML = html;
    }
}

/**
 * Safely sets the value of an input or select element.
 */
export function setValue(elementId, value) {
    const element = getElement(elementId);
    if (element) {
        element.value = value;
    }
}

/**
 * Safely gets the value of an input or select element.
 */
export function getValue(elementId, isNumeric = false) {
    const element = getElement(elementId);
    if (element) {
        const val = element.value;
        return isNumeric ? parseFloat(val) : val;
    }
    return isNumeric ? 0 : "";
}
