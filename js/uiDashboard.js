// --- START OF: uiDashboard.js ---

function updateDashboardUI(totals) {
    const viewPeriod = financeData.dashboardViewPeriod || 'fortnightly';
    setValue('dashboard-view-period', viewPeriod);

    let incomeForPeriod = 0;
    let expensesForPeriod = 0;
    let savingsForPeriod = 0;
    let incomePeriodLabel = viewPeriod.charAt(0).toUpperCase() + viewPeriod.slice(1);
    if (incomePeriodLabel === 'Daily') incomePeriodLabel = "Daily (5-Day)";
    if (incomePeriodLabel === 'Yearly') incomePeriodLabel = "Annual";


    const workingDaysPerYear = 260; // 5 days/week * 52 weeks

    switch (viewPeriod) {
        case 'daily':
            incomeForPeriod = totals.totalNetAnnualIncome / workingDaysPerYear;
            expensesForPeriod = totals.totalWeeklyExpenses / 5; // 5 working days
            savingsForPeriod = totals.weeklySavings / 5;
            break;
        case 'weekly':
            incomeForPeriod = totals.totalNetAnnualIncome / 52;
            expensesForPeriod = totals.totalWeeklyExpenses;
            savingsForPeriod = totals.weeklySavings;
            break;
        case 'fortnightly':
            incomeForPeriod = totals.totalNetAnnualIncome / 26;
            expensesForPeriod = totals.totalWeeklyExpenses * 2;
            savingsForPeriod = totals.weeklySavings * 2;
            break;
        case 'monthly':
            incomeForPeriod = totals.totalNetAnnualIncome / 12;
            expensesForPeriod = totals.totalWeeklyExpenses * 52 / 12;
            savingsForPeriod = totals.weeklySavings * 52 / 12;
            break;
        case 'yearly':
            incomeForPeriod = totals.totalNetAnnualIncome;
            expensesForPeriod = totals.totalWeeklyExpenses * 52;
            savingsForPeriod = totals.weeklySavings * 52;
            break;
    }

    // Income Overview Card
    setText('dashboard-income-period-display', formatCurrency(incomeForPeriod));
    setText('dashboard-income-subtitle', `After Tax (${incomePeriodLabel})`);
    setText('dashboard-annual-income', formatCurrency(totals.totalNetAnnualIncome));
    setText('dashboard-weekly-income', formatCurrency(totals.totalNetAnnualIncome / 52));
    setText('dashboard-daily-income', formatCurrency(totals.totalNetAnnualIncome / workingDaysPerYear));

    // Outgoing vs Savings Card
    setText('dashboard-outgoing-savings-title', `${incomePeriodLabel} Overview`);
    setText('dashboard-period-expenses', formatCurrency(expensesForPeriod));
    setText('dashboard-period-savings', formatCurrency(savingsForPeriod));
    const savingsPercentageDisplay = totals.savingsRate; // Use calculated savingsRate
    const savingsProgressEl = getElement('savings-progress');
    if (savingsProgressEl) {
        savingsProgressEl.style.width = `${Math.max(0, Math.min(100, savingsPercentageDisplay))}%`;
    }


    // Net Worth Card
    setText('net-worth-display', formatCurrency(totals.netWorth));
    setText('total-assets-display', formatCurrency(totals.currentAssets));
    setText('total-liabilities-display', formatCurrency(totals.currentLiabilities));

    const assetsDisplayContainer = getElement('assets-display');
    if (assetsDisplayContainer) {
        assetsDisplayContainer.innerHTML = '';
        financeData.assets.forEach(asset => {
            const assetDiv = document.createElement('div');
            assetDiv.className = 'account-item asset';
            assetDiv.innerHTML = `<div class="account-name">${asset.name}</div><div class="account-balance">${formatCurrency(asset.balance)}</div>`;
            assetsDisplayContainer.appendChild(assetDiv);
        });
        if (financeData.assets.length === 0) {
            assetsDisplayContainer.innerHTML = `<p style="text-align:center; font-size:0.9em; color: var(--text-color-secondary);">No assets added yet.</p>`;
        }
    }

    const liabilitiesDisplayContainer = getElement('liabilities-display');
    if (liabilitiesDisplayContainer) {
        liabilitiesDisplayContainer.innerHTML = '';
        financeData.liabilities.forEach(liability => {
            const liabilityDiv = document.createElement('div');
            liabilityDiv.className = 'account-item liability';
            liabilityDiv.innerHTML = `<div class="account-name">${liability.name}</div><div class="account-balance">${formatCurrency(liability.balance)}</div>`;
            liabilitiesDisplayContainer.appendChild(liabilityDiv);
        });
         if (financeData.liabilities.length === 0) {
            liabilitiesDisplayContainer.innerHTML = `<p style="text-align:center; font-size:0.9em; color: var(--text-color-secondary);">No liabilities added yet.</p>`;
        }
    }


    // Income Allocation Strategy Card
    const allocationDisplayContainer = getElement('allocation-display');
    if (allocationDisplayContainer) {
        allocationDisplayContainer.innerHTML = '';
        setText('allocation-title', "Income Allocation Strategy");
        setText('allocation-period-subtitle', `Based on Net Income (${incomePeriodLabel})`);

        financeData.allocation.forEach(alloc => {
            const amountForPeriod = incomeForPeriod * (alloc.percentage / 100);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'savings-item';
            let periodSuffix = viewPeriod.replace('ly', '').replace('y', '');
            if (periodSuffix === 'dai') periodSuffix = 'day';
            itemDiv.innerHTML = `<div class="savings-label">${alloc.name} (${alloc.percentage}%)</div><div class="savings-amount">${formatCurrency(amountForPeriod)}/${periodSuffix}</div>`;
            allocationDisplayContainer.appendChild(itemDiv);
        });
        if (financeData.allocation.length === 0) {
             allocationDisplayContainer.innerHTML = `<p style="text-align:center; font-size:0.9em; color: var(--text-color-secondary);">No allocation categories defined.</p>`;
        }
    }
}

function updateIncomeTabUI(totals) {
    const incomeStreamsContainer = getElement('income-streams-display');
    if (incomeStreamsContainer) {
        incomeStreamsContainer.innerHTML = '';
        financeData.incomeSources.forEach((source, index) => {
            const payCycles = getPayCyclesPerYear(source.paySchedule);
            const payCycleGross = source.grossAnnual / payCycles;
            const payCycleNet = source._calculatedNetAnnual / payCycles; // Use pre-calculated net
            const isPrimary = index === financeData.primaryIncomeIndex;

            const card = document.createElement('div');
            card.className = 'card';
            card.style.marginBottom = '20px';
            card.innerHTML = `
                <div class="card-title">${source.name} ${isPrimary ? '(Primary)' : ''}</div>
                <div class="card-subtitle">Gross: ${formatCurrency(source.grossAnnual)}/year</div>
                <div class="time-periods">
                    <div class="time-item">
                        <div class="time-label">Gross / ${source.paySchedule}</div>
                        <div class="time-amount">${formatCurrency(payCycleGross)}</div>
                    </div>
                    <div class="time-item">
                        <div class="time-label">Net / ${source.paySchedule}</div>
                        <div class="time-amount">${formatCurrency(payCycleNet)}</div>
                    </div>
                    <div class="time-item">
                        <div class="time-label">Hours / Cycle</div>
                        <div class="time-amount">${source.hoursPerCycle || 'N/A'}</div>
                    </div>
                </div>`;
            incomeStreamsContainer.appendChild(card);
        });
    }

    setHTML('income-breakdown', `
        <div style="display: flex; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
            <span>Total Gross Income (All Sources):</span>
            <span style="font-weight: 600; color: var(--text-color-primary);">${formatCurrency(totals.totalGrossAnnualIncome)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
            <span>Total Tax Paid (All Sources):</span>
            <span style="font-weight: 600; color: #f44336;">${formatCurrency(totals.totalAnnualTax)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-top: 15px; border-top: 2px solid #e0e0e0; flex-wrap: wrap; gap: 10px;">
            <span style="font-weight: 600;">Total Net Income (All Sources):</span>
            <span style="font-weight: 700; color: #4CAF50; font-size: 1.2em;">${formatCurrency(totals.totalNetAnnualIncome)}</span>
        </div>`);

    const taxBreakdownRefEl = getElement('tax-breakdown-reference');
    if (taxBreakdownRefEl) {
        taxBreakdownRefEl.innerHTML = ''; // Clear previous
        const primaryIncomeSource = financeData.incomeSources[financeData.primaryIncomeIndex];
        if (primaryIncomeSource && primaryIncomeSource.grossAnnual > 0) {
            let taxBreakdownHTML = '';
            let remainingIncomeForBrackets = primaryIncomeSource.grossAnnual;
            let cumulativeTax = 0;
            const sortedBrackets = [...financeData.taxBrackets].sort((a, b) => a.min - b.min);

            for (const bracket of sortedBrackets) {
                if (remainingIncomeForBrackets <= 0) break; // No more income to tax

                const taxableInThisBracketMin = Math.max(0, primaryIncomeSource.grossAnnual - bracket.min);
                const bracketRange = (bracket.max === Infinity ? primaryIncomeSource.grossAnnual : bracket.max) - bracket.min;
                const taxableInThisBracket = Math.min(taxableInThisBracketMin, bracketRange);


                if (taxableInThisBracket > 0) {
                    const taxInBracket = taxableInThisBracket * bracket.rate;
                    cumulativeTax += taxInBracket;
                    taxBreakdownHTML += `
                        <div style="padding: 10px; margin-bottom: 10px; background: #f8f9fa; border-radius: 8px;">
                            <div style="font-weight: 600; margin-bottom: 5px;">
                                ${formatCurrency(bracket.min)} - ${bracket.max === Infinity ? 'Above' : formatCurrency(bracket.max)}
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.9em; flex-wrap: wrap; gap: 10px;">
                                <span>Rate: ${(bracket.rate * 100).toFixed(1)}% on income above ${formatCurrency(bracket.min)}</span>
                                <span style="color: #f44336;">Tax: ${formatCurrency(taxInBracket)}</span>
                            </div>
                        </div>`;
                    remainingIncomeForBrackets -= taxableInThisBracket;
                }
                 if (primaryIncomeSource.grossAnnual <= (bracket.max === Infinity ? Infinity : bracket.max) && bracket.max !== Infinity) break;
            }
            taxBreakdownRefEl.innerHTML = taxBreakdownHTML || "<p>Tax bracket details could not be calculated for the primary income.</p>";
        } else {
            taxBreakdownRefEl.innerHTML = "<p>Select a primary income source with gross annual income to see its reference tax breakdown.</p>";
        }
    }


    const fortnightlyGrossTotal = totals.totalGrossAnnualIncome / 26;
    const fortnightlyNetTotal = totals.totalNetAnnualIncome / 26;
    const monthlyNetTotal = totals.totalNetAnnualIncome / 12;
    const effectiveTaxRate = totals.totalGrossAnnualIncome > 0 ? (totals.totalAnnualTax / totals.totalGrossAnnualIncome) * 100 : 0;

    setHTML('income-stats', `
        <div class="stat-card"><div class="stat-value">${formatCurrency(fortnightlyGrossTotal)}</div><div class="stat-label">Avg Fortnightly Gross</div></div>
        <div class="stat-card"><div class="stat-value">${formatCurrency(fortnightlyNetTotal)}</div><div class="stat-label">Avg Fortnightly Net</div></div>
        <div class="stat-card"><div class="stat-value">${formatCurrency(monthlyNetTotal)}</div><div class="stat-label">Avg Monthly Net</div></div>
        <div class="stat-card"><div class="stat-value">${effectiveTaxRate.toFixed(1)}%</div><div class="stat-label">Effective Tax Rate</div></div>
    `);
}

function updateExpensesTabUI(totals) {
    const renderExpenseList = (containerId, expenses, typeClass) => {
        const container = getElement(containerId);
        if (!container) return;
        container.innerHTML = '';
        expenses.forEach(expense => {
            const weeklyAmount = getWeeklyAmount(expense.amount, expense.frequency);
            const monthlyAmount = weeklyAmount * 52 / 12;
            const fortnightlyAmount = weeklyAmount * 2;
            const expenseDiv = document.createElement('div');
            expenseDiv.className = `expense-item ${typeClass}`;
            expenseDiv.innerHTML = `
                <div>
                    <div class="expense-name">${expense.name}</div>
                    <div class="expense-category">${typeClass === 'essential' ? 'Essential' : 'Non-Essential'}</div>
                </div>
                <div>
                    <div class="expense-amount">${formatCurrency(expense.amount)}/${expense.frequency}</div>
                    <div class="expense-frequency">${formatCurrency(fortnightlyAmount)}/fortnight • ${formatCurrency(monthlyAmount)}/month</div>
                </div>`;
            container.appendChild(expenseDiv);
        });
        if (expenses.length === 0) {
            container.innerHTML = `<p style="text-align:center; padding: 20px 0; font-size:0.9em; color: var(--text-color-secondary);">No ${typeClass} expenses added yet.</p>`;
        }
    };

    renderExpenseList('essential-expenses', financeData.essentialExpenses, 'essential');
    renderExpenseList('non-essential-expenses', financeData.nonEssentialExpenses, 'non-essential');

    setText('essential-subtitle', `${formatCurrency(totals.essentialWeeklyTotal)}/week • ${formatCurrency(totals.essentialWeeklyTotal * 52)}/year`);
    setText('non-essential-subtitle', `${formatCurrency(totals.nonEssentialWeeklyTotal)}/week • ${formatCurrency(totals.nonEssentialWeeklyTotal * 52)}/year`);

    const essentialRatio = totals.totalWeeklyExpenses > 0 ? (totals.essentialWeeklyTotal / totals.totalWeeklyExpenses) * 100 : 0;
    const ofNetIncome = (totals.totalNetAnnualIncome / 52) > 0 ? (totals.totalWeeklyExpenses / (totals.totalNetAnnualIncome / 52)) * 100 : 0;

    setHTML('expense-stats', `
        <div class="stat-card" style="border-top-color: #f44336;"><div class="stat-value">${formatCurrency(totals.totalWeeklyExpenses)}</div><div class="stat-label">Total Weekly</div></div>
        <div class="stat-card" style="border-top-color: #f44336;"><div class="stat-value">${formatCurrency(totals.totalWeeklyExpenses * 52)}</div><div class="stat-label">Total Annual</div></div>
        <div class="stat-card" style="border-top-color: #4CAF50;"><div class="stat-value">${essentialRatio.toFixed(0)}%</div><div class="stat-label">Essential Ratio</div></div>
        <div class="stat-card" style="border-top-color: #2196F3;"><div class="stat-value">${ofNetIncome.toFixed(0)}%</div><div class="stat-label">Of Net Income</div></div>
    `);
}

function updateSavingsTabUI(totals) {
    const monthlySavings = totals.weeklySavings * (52 / 12);
    setHTML('savings-capacity', `
        <div class="time-item" style="background: rgba(76, 175, 80, 0.1);"><div class="time-label">Per Year</div><div class="time-amount" style="color: #4CAF50; font-size: 1.4em;">${formatCurrency(totals.weeklySavings * 52)}</div></div>
        <div class="time-item" style="background: rgba(76, 175, 80, 0.1);"><div class="time-label">Per Month</div><div class="time-amount" style="color: #4CAF50; font-size: 1.4em;">${formatCurrency(monthlySavings)}</div></div>
        <div class="time-item" style="background: rgba(76, 175, 80, 0.1);"><div class="time-label">Per Week</div><div class="time-amount" style="color: #4CAF50; font-size: 1.4em;">${formatCurrency(totals.weeklySavings)}</div></div>
    `);

    setText('savings-rate', `${totals.savingsRate.toFixed(1)}%`);
    const savingsRateProgressEl = getElement('savings-rate-progress');
    if (savingsRateProgressEl) {
        savingsRateProgressEl.style.width = `${Math.max(0, Math.min(100, totals.savingsRate))}%`;
    }


    let message = '';
    if (totals.savingsRate >= 70) message = "Outstanding!";
    else if (totals.savingsRate >= 50) message = "Excellent!";
    else if (totals.savingsRate >= 30) message = "Great job!";
    else if (totals.savingsRate >= 10) message = "Good work!";
    else if (totals.savingsRate > 0) message = "You're saving!";
    else message = "Consider strategies to increase savings...";
    setText('savings-message', message);

    // Financial Independence Stats
    const annualExpenses = totals.totalWeeklyExpenses * 52;
    const fiTarget = annualExpenses * financeData.fiSettings.multiple;
    const yearsToFIValue = calculateYearsToFI(totals.annualSavings, totals.currentAssets, fiTarget, financeData.fiSettings.expectedReturn);
    const currentProgress = fiTarget > 0 ? (totals.currentAssets / fiTarget) * 100 : (totals.currentAssets > 0 ? 100 : 0);

    setHTML('fi-stats', `
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <span>Years to FI (${financeData.fiSettings.multiple}x expenses):</span>
            <span style="font-weight: 600; color: #4CAF50;">${typeof yearsToFIValue === 'number' ? yearsToFIValue.toFixed(1) : '∞'} years</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <span>Target amount needed:</span>
            <span style="font-weight: 600; color: #2196F3;">${formatCurrency(fiTarget)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <span>Annual expenses:</span>
            <span style="font-weight: 600; color: #f44336;">${formatCurrency(annualExpenses)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-top: 10px; border-top: 1px solid #e0e0e0; flex-wrap: wrap; gap: 10px;">
            <span>Current progress:</span>
            <span style="font-weight: 600; color: #ff9800;">${currentProgress.toFixed(1)}%</span>
        </div>
    `);
}

function updateLiabilitiesTabUI(totals) {
    const summaryContainer = getElement('liability-summary-display');
    if (summaryContainer) {
        summaryContainer.innerHTML = '';
        if (financeData.liabilities.length === 0) {
            summaryContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: #4CAF50; font-size: 1.2em;">🎉 No liabilities tracked - Great job!</div>';
        } else {
            financeData.liabilities.forEach(debt => {
                const debtCard = document.createElement('div');
                debtCard.className = 'liability-card';
                const monthlyInterest = (debt.balance * (debt.interestRate / 100)) / 12;
                const yearlyInterest = debt.balance * (debt.interestRate / 100);
                debtCard.innerHTML = `
                    <div class="liability-card-title">${debt.name}</div>
                    <div class="liability-details">
                        <div class="liability-balance">${formatCurrency(debt.balance)}</div>
                        <div class="liability-rate">Interest Rate: ${debt.interestRate}% annually</div>
                        <div style="font-size: 0.85em; color: #666; margin-top: 8px;">
                            Monthly Interest: ~${formatCurrency(monthlyInterest)}<br>
                            Annual Interest: ~${formatCurrency(yearlyInterest)}
                        </div>
                    </div>`;
                summaryContainer.appendChild(debtCard);
            });
        }
    }

    const impactStatsContainer = getElement('debt-impact-stats');
    if (impactStatsContainer) {
        const totalLiabilities = totals.currentLiabilities;
        const totalAnnualInterest = financeData.liabilities.reduce((sum, debt) =>
            sum + (debt.balance * (debt.interestRate / 100)), 0);
        const averageInterestRate = totalLiabilities > 0 ? (totalAnnualInterest / totalLiabilities) * 100 : 0;
        const netWorthWithoutDebt = totals.currentAssets; // Assets remain, liabilities become 0

        impactStatsContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <span>Total Liabilities:</span>
                <span style="font-weight: 600; color: #f44336;">${formatCurrency(totalLiabilities)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <span>Annual Interest Cost:</span>
                <span style="font-weight: 600; color: #f44336;">${formatCurrency(totalAnnualInterest)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <span>Average Interest Rate:</span>
                <span style="font-weight: 600; color: #ff9800;">${averageInterestRate.toFixed(2)}%</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 15px; border-top: 2px solid #e0e0e0; flex-wrap: wrap; gap: 10px;">
                <span style="font-weight: 600;">Net Worth if Debt-Free:</span>
                <span style="font-weight: 700; color: #4CAF50; font-size: 1.2em;">${formatCurrency(netWorthWithoutDebt)}</span>
            </div>`;
    }
    setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
}


// --- END OF: uiDashboard.js ---