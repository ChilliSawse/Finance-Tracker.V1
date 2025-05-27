// --- START OF: calculations.js ---

function calculateTotals(currentData = financeData) {
    let totalGrossAnnualIncome = 0;
    let totalNetAnnualIncome = 0;
    let totalAnnualTaxFromSources = 0;

    currentData.incomeSources.forEach(source => {
        const grossAnnual = source.grossAnnual || 0;
        totalGrossAnnualIncome += grossAnnual;
        const payCycles = getPayCyclesPerYear(source.paySchedule);
        let sourceAnnualNet = grossAnnual; // Default to gross if no tax info
        let sourceAnnualTax = 0;

        const invoicedPay = parseFloat(source.invoicedPayPostTax);
        const taxRemovedPerCycle = parseFloat(source.taxRemoved);

        if (!isNaN(invoicedPay) && source.invoicedPayPostTax !== null && source.invoicedPayPostTax !== '') {
            sourceAnnualNet = invoicedPay * payCycles;
            sourceAnnualTax = Math.max(0, grossAnnual - sourceAnnualNet); // Tax cannot be negative
        } else if (!isNaN(taxRemovedPerCycle) && source.taxRemoved !== null && source.taxRemoved !== '') {
            sourceAnnualTax = taxRemovedPerCycle * payCycles;
            sourceAnnualNet = Math.max(0, grossAnnual - sourceAnnualTax); // Net income cannot be negative
        }
        // If neither, net is gross and tax is 0 (already initialized)

        totalNetAnnualIncome += sourceAnnualNet;
        totalAnnualTaxFromSources += sourceAnnualTax;

        // Store calculated values back on the source object for reference
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
        savingsRate: Math.max(0, savingsRate) // Savings rate cannot be negative for this metric
    };
}

function calculateYearsToFI(annualSavings, currentAssets, fiTarget, expectedReturnRate) {
    if (annualSavings <= 0 && currentAssets < fiTarget) {
        return Infinity; // Cannot reach FI if not saving and not already there
    }
    if (currentAssets >= fiTarget) {
        return 0; // Already at FI
    }

    const r = expectedReturnRate / 100; // Annual return rate as decimal

    if (r === 0) { // Simple calculation if no return
        return (fiTarget - currentAssets) / annualSavings;
    }

    // Formula: n = log((FV*r + A) / (P*r + A)) / log(1+r)
    // FV = fiTarget, P = currentAssets, A = annualSavings
    const numerator = fiTarget * r + annualSavings;
    const denominator = currentAssets * r + annualSavings;

    if (numerator <= 0 || denominator <= 0 || numerator < denominator) {
        // This can happen if current assets are very high, or savings are negative and large
        // or if the target is somehow less than current + one year saving with return.
        // Fallback to simple calculation or indicate an issue.
        return (fiTarget - currentAssets) / annualSavings; // Could still be Infinity if annualSavings is negative
    }

    let years = Math.log(numerator / denominator) / Math.log(1 + r);
    return Math.max(0, years); // Years cannot be negative
}


// --- END OF: calculations.js ---