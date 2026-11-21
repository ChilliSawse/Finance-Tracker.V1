// Settings initialisation. A12b deleted the eleven legacy grid renderers (income sources, tax
// brackets, tax details, assets, liabilities, expenses, categories, bills, FI) and the What If
// scenario editors: Plan's lists open `openSheet` sheets instead, and the Settings screen lives
// in ui/settings-screen.js.

import { store } from '../state/store.js';
import { setValue } from '../utils.js';
import { applyStoredAppearance } from '../theme/theme.js';

export function initializeSettingsUI() {
    setValue('dashboard-view-period', store.financeData.dashboardViewPeriod || 'fortnightly');
    applyStoredAppearance(); // palette, mode and text size from the saved settings
}
