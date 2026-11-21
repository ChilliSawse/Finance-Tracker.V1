// Pure row pickers shared by the Today setup checklist and the Setup money steps. Kept apart so the checklist
// (always on Today) does not pull in the Setup sheets and plan lists (P3b). Re-exported from steps-money.js.

export const PLACEHOLDER_DEBT_ID = 'l-new-liability';

const catMap = (data) => new Map((data.categories || []).filter(Boolean).map((c) => [c.id, c]));

/** Plan lines in the essential (kind 'essential') or non-essential (kind 'non') list, by the category flag. */
export function moneyRows(data, kind) {
    const cats = catMap(data);
    const wantEssential = kind === 'essential';
    return (data.plan || []).filter((p) => {
        if (!p || p.inTotals === false) return false;
        const c = cats.get(p.categoryId);
        return !!(c ? c.essential : p.essential) === wantEssential;
    });
}

export function debtRows(data) {
    return (data.liabilities || []).filter((l) => l && !(l.id === PLACEHOLDER_DEBT_ID && l.name === 'New Liability' && !Number(l.balance) && !Number(l.interestRate)));
}
