// Asset and debt sheets (owner: F5, M-14). M0 stub: the factories return the legacy
// shape (defaults.js) and the sheet specs are empty, so callers can adopt the
// final signatures now.

/** A new asset row in the legacy shape. */
export function newAsset() {
    return { name: 'New Asset', balance: 0 };
}

/** A new liability row in the legacy shape. */
export function newDebt() {
    return { name: 'New Liability', balance: 0, interestRate: 0 };
}

/** Field spec for the asset sheet. The stub has no fields. */
export function assetSheetSpec(asset) {
    return { title: '', fields: [], values: asset ? { ...asset } : {} };
}

/** Field spec for the debt sheet. The stub has no fields. */
export function debtSheetSpec(debt) {
    return { title: '', fields: [], values: debt ? { ...debt } : {} };
}
