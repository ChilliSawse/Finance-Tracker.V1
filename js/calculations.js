// --- START OF: calculations.js ---

function calculateTotals(currentData = financeData) {
    let totalGrossAnnualIncome = 0;
    let totalNetAnnualIncome = 0;
    let totalAnnualTaxFromSources = 0;

    currentData.incomeSources.forEach(source => {
        const payCycles = getPayCyclesPerYear(source.paySchedule);
        const type = source.incomeType === 'selfEmployed' ? 'selfEmployed' : 'salaried';

        let sourceGrossAnnual, sourceAnnualNet, sourceAnnualTax;

        if (type === 'selfEmployed') {
            // Path B — enter net pay per cycle (+ optional tax per cycle); gross is back-calculated.
            const netPerCycle = parseFloat(source.invoicedPayPostTax);
            const taxPerCycle = parseFloat(source.taxRemoved);
            sourceAnnualNet = (!isNaN(netPerCycle) && source.invoicedPayPostTax !== null && source.invoicedPayPostTax !== '')
                ? netPerCycle * payCycles : 0;
            sourceAnnualTax = (!isNaN(taxPerCycle) && source.taxRemoved !== null && source.taxRemoved !== '')
                ? Math.max(0, taxPerCycle * payCycles) : 0;
            sourceGrossAnnual = sourceAnnualNet + sourceAnnualTax;
        } else {
            // Path A — salaried: enter gross, tax estimated from the progressive brackets, net derived.
            sourceGrossAnnual = source.grossAnnual || 0;
            sourceAnnualTax = calculateTaxFromBrackets(sourceGrossAnnual, currentData.taxBrackets);
            sourceAnnualNet = Math.max(0, sourceGrossAnnual - sourceAnnualTax);
        }

        totalGrossAnnualIncome += sourceGrossAnnual;
        totalNetAnnualIncome += sourceAnnualNet;
        totalAnnualTaxFromSources += sourceAnnualTax;

        // Store calculated values back on the source object for display (auditable per-source)
        source._calculatedGrossAnnual = sourceGrossAnnual;
        source._calculatedNetAnnual = sourceAnnualNet;
        source._calculatedAnnualTax = sourceAnnualTax;
    });

    const weeklyNet = totalNetAnnualIncome / 52;

    const essentialWeekly = (currentData.essentialExpenses || []).reduce((sum, exp) => {
        return sum + getWeeklyAmount(exp.amount, exp.frequency);
    }, 0);
    const nonEssentialWeekly = (currentData.nonEssentialExpenses || []).reduce((sum, exp) => {
        return sum + getWeeklyAmount(exp.amount, exp.frequency);
    }, 0);

    const totalWeeklyExpenses = essentialWeekly + nonEssentialWeekly;
    const weeklySavings = weeklyNet - totalWeeklyExpenses;

    const currentAssets = (currentData.assets || []).reduce((sum, asset) => sum + (asset.balance || 0), 0);
    const currentLiabilities = (currentData.liabilities || []).reduce((sum, liability) => sum + (liability.balance || 0), 0);
    const netWorth = currentAssets - currentLiabilities;

    const savingsRate = weeklyNet > 0 ? (weeklySavings / weeklyNet) * 100 : 0;

    return {
        totalGrossAnnualIncome,
        totalAnnualTax: totalAnnualTaxFromSources,
        totalNetAnnualIncome,
        essentialWeeklyTotal: essentialWeekly,
        nonEssentialWeeklyTotal: nonEssentialWeekly,
        totalWeeklyExpenses,
        weeklySavings,
        annualSavings: weeklySavings * 52,
        currentAssets,
        currentLiabilities,
        netWorth,
        savingsRate // May be negative when spending exceeds income
    };
}

/**
 * Progressive tax on a gross annual income using a bracket array.
 * Each bracket: { min, max, rate } where rate is a decimal (0.19 = 19%)
 * and max may be Infinity (or null) for the top band.
 * @returns {number} Estimated annual tax (0 if no brackets / no income).
 */
function calculateTaxFromBrackets(grossAnnual, brackets) {
    const gross = parseFloat(grossAnnual) || 0;
    if (gross <= 0 || !Array.isArray(brackets) || brackets.length === 0) return 0;

    const sorted = [...brackets].sort((a, b) => (a.min || 0) - (b.min || 0));
    let tax = 0;
    for (const bracket of sorted) {
        const min = bracket.min || 0;
        if (gross <= min) continue;
        const max = (bracket.max === Infinity || bracket.max == null) ? Infinity : bracket.max;
        const taxableInBand = Math.min(gross, max) - min;
        if (taxableInBand > 0) tax += taxableInBand * (bracket.rate || 0);
    }
    return tax;
}

/**
 * Per-band breakdown of the progressive tax calc, for an auditable display.
 * @returns {Array<{min,max,rate,taxable,tax}>} Only bands that the income reaches.
 */
function getTaxBracketBreakdown(grossAnnual, brackets) {
    const gross = parseFloat(grossAnnual) || 0;
    if (gross <= 0 || !Array.isArray(brackets) || brackets.length === 0) return [];

    const sorted = [...brackets].sort((a, b) => (a.min || 0) - (b.min || 0));
    const rows = [];
    for (const bracket of sorted) {
        const min = bracket.min || 0;
        if (gross <= min) continue;
        const max = (bracket.max === Infinity || bracket.max == null) ? Infinity : bracket.max;
        const taxable = Math.max(0, Math.min(gross, max) - min);
        if (taxable <= 0) continue;
        rows.push({ min, max, rate: bracket.rate || 0, taxable, tax: taxable * (bracket.rate || 0) });
    }
    return rows;
}

function calculateYearsToFI(annualSavings, currentAssets, fiTarget, expectedReturnRate) {
    if (fiTarget <= 0) return 0;
    if (currentAssets >= fiTarget) return 0;
    if (annualSavings <= 0) return Infinity;

    const r = expectedReturnRate / 100;

    if (r === 0) {
        return (fiTarget - currentAssets) / annualSavings;
    }

    // Shad Sloan / compound growth formula:
    // n = log((FV·r + A) / (P·r + A)) / log(1+r)
    const numerator   = fiTarget * r + annualSavings;
    const denominator = currentAssets * r + annualSavings;

    if (denominator <= 0 || numerator <= denominator) {
        const simple = (fiTarget - currentAssets) / annualSavings;
        return isNaN(simple) || simple < 0 ? Infinity : simple;
    }

    const years = Math.log(numerator / denominator) / Math.log(1 + r);
    return isNaN(years) ? Infinity : Math.max(0, years);
}


// --- END OF: calculations.js ---