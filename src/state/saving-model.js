// Saving model state API (owner: E5). M0 stub: getBuckets maps the legacy
// allocation[] rows with no roles, so consumers can be built before E5 lands.

const MAX_SLOT = 10;

/**
 * Buckets for a data object. Tolerant: missing or malformed allocation gives [].
 * @param {object} data - financeData.
 * @param {string} [today] - ISO date; unused by the stub.
 * @returns {Array<{id:string, slot:number, shade:number, name:string, role:null,
 *   kind:string, parentId:null, pct:number, perPayCents:number, balanceCents:number}>}
 */
export function getBuckets(data, today) {
    const rows = data && Array.isArray(data.allocation) ? data.allocation : [];
    return rows.map((row, i) => {
        const r = row && typeof row === 'object' ? row : {};
        const pct = Number(r.percentage);
        const bal = Number(r.currentBalance);
        return {
            id: r.id != null ? String(r.id) : `alloc-${i + 1}`,
            slot: Math.min(i + 1, MAX_SLOT),
            shade: 0,
            name: typeof r.name === 'string' ? r.name : '',
            role: null,
            kind: 'bucket',
            parentId: null,
            pct: Number.isFinite(pct) ? pct : 0,
            perPayCents: 0,
            balanceCents: Number.isFinite(bal) ? Math.round(bal * 100) : 0,
        };
    });
}
