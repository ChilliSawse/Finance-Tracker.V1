// --- START OF: utils.js ---

/**
 * Returns the number of pay cycles per year based on the schedule.
 * @param {string} schedule - 'weekly', 'fortnightly', 'monthly', 'yearly'.
 * @returns {number} Number of cycles per year.
 */
function getPayCyclesPerYear(schedule) {
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
function getWeeklyAmount(amount, frequency) {
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
 * Formats a number as currency according to the global settings.
 * @param {number} amount - The number to format.
 * @param {string} [currencyCode=financeData.currency] - The currency code.
 * @param {number} [decimalPlaces=2] - Number of decimal places.
 * @returns {string} The formatted currency string.
 */
function formatCurrency(amount, currencyCode = financeData.currency, decimalPlaces = 2) {
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
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
function debounce(func, wait) {
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

/**
 * Updates the data via a callback and then dispatches an event
 * to signal that the UI should be updated.
 * @param {Function} [callback] - A function to execute to modify the data.
 */
function updateDataAndUI(callback) {
    if (callback) {
        callback(); // Execute the data-modifying function
    }

    if (autoSave) {
        autoSave.onDataChange(); // Trigger the auto-save mechanism
    }

    // Dispatch a custom event to signal that data has changed
    // main.js will listen for this event and trigger the UI update.
    console.log("Dispatching 'dataChanged' event.");
    document.dispatchEvent(new CustomEvent('dataChanged'));
}


// --- DOM Helper Functions ---

/**
 * Safely gets an element by its ID.
 * @param {string} id - The ID of the element.
 * @returns {HTMLElement|null} The element or null if not found.
 */
function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element with ID '${id}' not found.`);
    }
    return element;
}

/**
 * Safely sets the text content of an element.
 * @param {string} elementId - The ID of the element.
 * @param {string} text - The text to set.
 */
function setText(elementId, text) {
    const element = getElement(elementId);
    if (element) {
        element.textContent = text;
    }
}

/**
 * Safely sets the HTML content of an element.
 * @param {string} elementId - The ID of the element.
 * @param {string} html - The HTML string to set.
 */
function setHTML(elementId, html) {
    const element = getElement(elementId);
    if (element) {
        element.innerHTML = html;
    }
}

/**
 * Safely sets the value of an input or select element.
 * @param {string} elementId - The ID of the element.
 * @param {string|number} value - The value to set.
 */
function setValue(elementId, value) {
    const element = getElement(elementId);
    if (element) {
        element.value = value;
    }
}

/**
 * Safely gets the value of an input or select element.
 * @param {string} elementId - The ID of the element.
 * @param {boolean} [isNumeric=false] - Whether to parse the value as a float.
 * @returns {string|number} The value.
 */
function getValue(elementId, isNumeric = false) {
    const element = getElement(elementId);
    if (element) {
        const val = element.value;
        return isNumeric ? parseFloat(val) : val;
    }
    return isNumeric ? 0 : "";
}