// Saving-model maths (E1). Pure and DOM-free: no storage, no globals mutated.
// The Bucket method as data (BUCKET_METHOD), the expenses-first split, whole-cent
// allocation, split rules, role detection, template bounds, families and tones.
// Money is integer cents; percentages are plain numbers (60 means 60%), one decimal.

const clone = (x) => JSON.parse(JSON.stringify(x));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const nonNeg = (x) => Math.max(0, num(x));
const SPLIT_TOLERANCE = 0.05;

function deepFreeze(o) {
    Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(o);
}

/** Static definition of the method (plan section 2.1). */
export const BUCKET_METHOD = deepFreeze({
    id: 'bucket-method', name: 'Bucket method', after: 'Scott Pape', basis: 'net',
    engine: 'expenses-first',
    guide: { daily: 60, splurge: 10, smile: 10, fire: 20 },
    buckets: [
        { role: 'daily', name: 'Daily expenses', slot: 1, kind: 'spend', pct: 'expenses-first:essential' },
        { role: 'splurge', name: 'Splurge', slot: 2, kind: 'spend', pct: 'expenses-first:nonessential' },
        { role: 'smile', name: 'Smile', slot: 3, kind: 'save', pct: 'remainder', target: 'goals' },
        { role: 'fire', name: 'Fire extinguisher', slot: 4, kind: 'save', pct: 'remainder', target: 'list' },
        { role: 'mojo', name: 'Mojo', slot: 5, kind: 'save', pct: 0, target: 'ladder', fundedBy: 'fire' },
    ],
    virtual: [{ role: 'grow', name: 'Grow', slot: 6, note: 'super and investments, tracked in Future' }],
    rules: {
        coreBuckets: ['daily', 'splurge', 'smile', 'fire', 'mojo'], renamable: true, splitEditable: true,
        mojoShare: 0, childrenAllowedIn: ['smile'], maxDepth: 3, remainderRatio: { smile: 1, fire: 2 },
        targetList: 'fire', topLevelAddAllowed: false, slotCount: 10, colourRepeat: false,
    },
});

/** Rules of an own (forked) template: everything allowed, total still 100. */
export const CUSTOM_RULES = deepFreeze({
    coreBuckets: [], renamable: true, splitEditable: true, mojoShare: null,
    childrenAllowedIn: null, maxDepth: 5, remainderRatio: { smile: 1, fire: 2 },
    targetList: 'fire', topLevelAddAllowed: true, slotCount: 10, colourRepeat: true,
});

const ROLES = ['daily', 'splurge', 'smile', 'fire', 'mojo', 'grow'];
const BASES = ['net', 'gross', 'realRevenue'];
const ENGINES = ['expenses-first', 'fixed'];

/** Shape check for a model definition (so other methods can be imported later). */
export function validateModelDef(def) {
    const errors = [];
    const err = (code, detail) => errors.push(detail ? { code, detail } : { code });
    if (!def || typeof def !== 'object' || Array.isArray(def)) return { ok: false, errors: [{ code: 'not-object' }] };
    if (typeof def.id !== 'string' || !def.id) err('id');
    if (typeof def.name !== 'string' || !def.name) err('name');
    if (!BASES.includes(def.basis)) err('basis');
    if (!ENGINES.includes(def.engine)) err('engine');
    if (!Array.isArray(def.buckets) || !def.buckets.length) err('buckets');
    else {
        const seen = new Set();
        let fixedTotal = 0;
        def.buckets.forEach((b, i) => {
            if (!b || typeof b !== 'object') { err('bucket', i); return; }
            if (typeof b.name !== 'string' || !b.name) err('bucket-name', i);
            if (b.role != null) {
                if (!ROLES.includes(b.role)) err('bucket-role', i);
                if (seen.has(b.role)) err('role-duplicate', b.role);
                seen.add(b.role);
            }
            if (!Number.isInteger(b.slot) || b.slot < 1 || b.slot > 10) err('bucket-slot', i);
            if (b.kind !== 'spend' && b.kind !== 'save') err('bucket-kind', i);
            const pctOk = (typeof b.pct === 'number' && Number.isFinite(b.pct) && b.pct >= 0)
                || (typeof b.pct === 'string' && (b.pct === 'remainder' || b.pct.startsWith('expenses-first:')));
            if (!pctOk) err('bucket-pct', i);
            if (typeof b.pct === 'number') fixedTotal += b.pct;
            if (def.engine === 'fixed' && typeof b.pct !== 'number') err('fixed-needs-numbers', i);
        });
        if (def.engine === 'fixed' && Math.abs(fixedTotal - 100) > SPLIT_TOLERANCE) err('fixed-total', fixedTotal);
    }
    if (!def.rules || typeof def.rules !== 'object') err('rules');
    else {
        if (!Array.isArray(def.rules.coreBuckets)) err('rules-core');
        if (!Number.isInteger(def.rules.maxDepth) || def.rules.maxDepth < 1) err('rules-depth');
    }
    return { ok: errors.length === 0, errors };
}

// ---------- Roles ----------

// Whole-word matchers, tried in this order. First match per role only.
const ROLE_MATCHERS = [
    ['daily', /\bdaily\b|\beveryday\b|\bevery day\b|\bday[ -]to[ -]day\b|\bimportant\b/],
    ['splurge', /\bsplurge\b/],
    ['smile', /\bsmile\b/],
    ['fire', /\bfire\b/],
    ['mojo', /\bmojo\b|\bemergency\b/],
    ['grow', /\bgrow\b|\binvest(?:ing|ment|ments|s)?\b|\bsuperannuation\b|\bsuper fund\b/],
];

/**
 * Role for a bucket name, or null. `taken` lists roles already given to an earlier
 * bucket; a name whose role is taken gets null (first match per role only).
 */
export function detectRole(name, taken = []) {
    if (typeof name !== 'string') return null;
    const n = name.toLowerCase();
    const used = taken instanceof Set ? taken : new Set(taken || []);
    for (const [role, re] of ROLE_MATCHERS) {
        if (re.test(n)) return used.has(role) ? null : role;
    }
    return null;
}

/** Roles for a list of names in order, first match per role only. */
export function detectRoles(names) {
    const taken = new Set();
    return (Array.isArray(names) ? names : []).map((nm) => {
        const r = detectRole(nm, taken);
        if (r) taken.add(r);
        return r;
    });
}

/** The allocation row holding a role, or null. */
export function bucketByRole(data, role) {
    const rows = data && Array.isArray(data.allocation) ? data.allocation : [];
    return rows.find((r) => r && r.role === role) || null;
}

// ---------- Expenses-first split and cents ----------

/**
 * Expenses-first suggestion (plan section 2.5), percentages to one decimal summing to 100.0.
 * Returns null when net is not positive. Never returns a negative percentage.
 */
export function suggestSplit({ netCents, essentialCents, nonEssentialCents, rules } = {}) {
    const net = num(netCents);
    if (net <= 0) return null;
    const ess = nonNeg(essentialCents);
    const non = nonNeg(nonEssentialCents);
    const ratio = (rules && rules.remainderRatio) || BUCKET_METHOD.rules.remainderRatio;
    let rs = nonNeg(ratio.smile);
    let rf = nonNeg(ratio.fire);
    if (rs + rf <= 0) { rs = 1; rf = 2; }
    const rawDaily = (ess / net) * 100;
    const rawSplurge = (non / net) * 100;
    let d10 = Math.round(rawDaily * 10);
    let s10 = Math.round(rawSplurge * 10);
    const shortfallCents = Math.max(0, Math.round(ess + non - net));
    let smile10 = 0;
    let fire10 = 0;
    const rest10 = 1000 - d10 - s10;
    if (rest10 > 0) {
        smile10 = Math.round((rest10 * rs) / (rs + rf));
        fire10 = rest10 - smile10;
    } else {
        d10 = Math.min(d10, 1000);
        s10 = Math.min(s10, 1000 - d10);
    }
    return {
        daily: d10 / 10, splurge: s10 / 10, smile: smile10 / 10, fire: fire10 / 10,
        rawDaily, rawSplurge,
        overspent: rest10 < 0 || shortfallCents > 0,
        shortfallCents,
    };
}

/**
 * Whole cents per percentage, largest remainder, ties to the earlier row. The result
 * always sums to netCents exactly: shares are taken against the total of the given
 * percentages (so 99.9 or 100.04 still lands every cent). Negative percentages count
 * as 0. All-zero percentages return all zeros (nothing to split by).
 */
export function allocateCents(netCents, pcts) {
    const list = Array.isArray(pcts) ? pcts : [];
    const out = list.map(() => 0);
    const net = Math.max(0, Math.round(num(netCents)));
    const w = list.map((p) => Math.round(nonNeg(p) * 1000));
    const total = w.reduce((a, b) => a + b, 0);
    if (!net || !total) return out;
    const rem = [];
    let used = 0;
    w.forEach((x, i) => {
        const prod = net * x;
        const r = prod % total;
        out[i] = (prod - r) / total;
        used += out[i];
        rem.push([r, i]);
    });
    rem.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; k < net - used; k++) out[rem[k][1]] += 1;
    return out;
}

// ---------- Split rules ----------

/**
 * Check a split. rows: [{id, role, pct}]. Errors: 'negative' (id), 'not-number' (id),
 * 'total' (when the total is more than 0.05 from 100), 'mojo-share' (when rules.mojoShare is 0).
 */
export function validateSplit(rows, rules = BUCKET_METHOD.rules) {
    const list = Array.isArray(rows) ? rows : [];
    const errors = [];
    let total = 0;
    list.forEach((r) => {
        const p = r && r.pct;
        if (typeof p !== 'number' || !Number.isFinite(p)) { errors.push({ code: 'not-number', id: r && r.id }); return; }
        if (p < 0) errors.push({ code: 'negative', id: r.id });
        total += p;
        if (r.role === 'mojo' && p > 0 && rules && rules.mojoShare === 0) errors.push({ code: 'mojo-share', id: r.id });
    });
    total = Math.round(total * 1000) / 1000;
    if (Math.abs(total - 100) > SPLIT_TOLERANCE + 1e-9) errors.unshift({ code: 'total', total });
    return { ok: errors.length === 0, total, errors };
}

/**
 * The percentage `key` (an id, else a role) would need for the split to total 100,
 * to one decimal. null when that would be negative or the key is not found.
 */
export function fixToHundred(rows, key) {
    const list = Array.isArray(rows) ? rows : [];
    let idx = list.findIndex((r) => r && r.id === key);
    if (idx < 0) idx = list.findIndex((r) => r && r.role === key);
    if (idx < 0) return null;
    const others = list.reduce((s, r, i) => (i === idx ? s : s + num(r && r.pct)), 0);
    const v = Math.round((100 - others) * 10) / 10;
    return v < 0 ? null : v;
}

/** Sibling goal shares must total 100 (within 0.05) under each parent. */
export function validateShares(goals) {
    const by = new Map();
    (Array.isArray(goals) ? goals : []).forEach((g) => {
        if (!g) return;
        by.set(g.parentId, (by.get(g.parentId) || 0) + num(g.share));
    });
    const errors = [];
    by.forEach((total, parentId) => {
        const t = Math.round(total * 1000) / 1000;
        if (Math.abs(t - 100) > SPLIT_TOLERANCE + 1e-9) errors.push({ code: 'shares-total', parentId, total: t });
    });
    return { ok: errors.length === 0, errors };
}

// ---------- Families and tones ----------

/**
 * Tree of top-level buckets and their goals. Slots: core roles 1 to 5, grow 6, other
 * buckets take 7 to 10 in row order, then repeat from slot 1 (shade 2, repeat:true)
 * only when rules.colourRepeat is on, else slot null. Goals sort by `order`, else array order.
 * Nodes: {id, kind:'bucket'|'goal', depth, parentId, slot, shade, repeat, siblingIndex,
 * ownCents, saved, children, row?, goal?}.
 */
export function buildTree(allocation, goals, rules = BUCKET_METHOD.rules) {
    const rows = Array.isArray(allocation) ? allocation.filter((r) => r && typeof r === 'object') : [];
    const gl = Array.isArray(goals) ? goals.filter((g) => g && typeof g === 'object') : [];
    const fixedSlot = { daily: 1, splurge: 2, smile: 3, fire: 4, mojo: 5, grow: 6 };
    const usedRoles = new Set();
    let extra = 0;
    const roots = rows.map((row) => {
        let slot = null;
        let shade = 0;
        let repeat = false;
        const r = fixedSlot[row.role] && !usedRoles.has(row.role) ? row.role : null;
        if (r) { usedRoles.add(r); slot = fixedSlot[r]; }
        else {
            const k = extra++;
            if (k < 4) slot = 7 + k;
            else if (rules && rules.colourRepeat) { slot = (k - 4) % 10 + 1; shade = 2; repeat = true; }
        }
        return { id: String(row.id), kind: 'bucket', depth: 0, parentId: null, slot, shade, repeat,
            siblingIndex: 0, ownCents: Math.round(num(row.currentBalance) * 100), saved: 0, children: [], row };
    });
    const nodes = new Map(roots.map((n) => [n.id, n]));
    const goalNodes = gl.map((g) => ({ id: String(g.id), kind: 'goal', depth: 0, parentId: String(g.parentId),
        slot: null, shade: 0, repeat: false, siblingIndex: 0, ownCents: Math.round(num(g.saved) * 100),
        saved: num(g.saved), children: [], goal: g }));
    goalNodes.forEach((n) => nodes.set(n.id, n));
    const order = (a, b) => (num(a.goal && a.goal.order) - num(b.goal && b.goal.order));
    goalNodes.forEach((n) => { const p = nodes.get(n.parentId); if (p && p !== n) p.children.push(n); });
    const place = (n, depth, root, idx, guard) => {
        if (guard.has(n.id)) return;
        guard.add(n.id);
        n.depth = depth;
        n.siblingIndex = idx;
        n.slot = root.slot; n.repeat = root.repeat;
        n.shade = depth === 1 ? root.shade : depth >= 2 ? (idx % 3) + 1 : n.shade;
        if (n.children.some((c) => c.goal && c.goal.order != null)) n.children.sort(order);
        n.children.forEach((c, i) => place(c, depth + 1, root, i, guard));
    };
    roots.forEach((root) => root.children.forEach((c, i) => place(c, 1, root, i, new Set([root.id]))));
    return roots;
}

function findNode(tree, id) {
    const stack = [...(Array.isArray(tree) ? tree : [])];
    while (stack.length) {
        const n = stack.shift();
        if (n.id === String(id)) return n;
        stack.push(...n.children);
    }
    return null;
}

/** {slot, shade, repeat} for a node id, or null. Depth 1 inherits its bucket; depth 2+ cycle shades 1 to 3. */
export function bucketTone(id, tree) {
    const n = findNode(tree, id);
    return n ? { slot: n.slot, shade: n.shade, repeat: n.repeat } : null;
}

/**
 * Balance in cents: a bucket's own balance plus the saved amounts of its leaf descendants.
 * A goal counts only its leaves (its own saved is ignored once it has sub-buckets).
 */
export function bucketBalanceCents(id, tree) {
    const walk = (n) => {
        if (n.kind === 'goal') return n.children.length ? n.children.reduce((s, c) => s + walk(c), 0) : n.ownCents;
        return n.ownCents + n.children.reduce((s, c) => s + walk(c), 0);
    };
    const n = findNode(tree, id);
    return n ? walk(n) : 0;
}

/**
 * Split a credit down a family to its leaves by share (largest remainder at each level).
 * A bucket with no goals credits itself. Returns null when any sibling shares do not total 100.
 */
export function creditFamily(cents, id, tree) {
    const n = findNode(tree, id);
    if (!n) return null;
    const out = [];
    const go = (node, amount) => {
        if (!node.children.length) { out.push({ id: node.id, cents: amount }); return true; }
        const shares = node.children.map((c) => num(c.goal && c.goal.share));
        if (Math.abs(shares.reduce((a, b) => a + b, 0) - 100) > SPLIT_TOLERANCE + 1e-9) return false;
        const parts = allocateCents(amount, shares);
        return node.children.every((c, i) => go(c, parts[i]));
    };
    return go(n, Math.max(0, Math.round(num(cents)))) ? out : null;
}

// ---------- Template bounds ----------

/**
 * Does the data stay inside a template? rules = savingModel.rules. Violations:
 * extra-top-level, core-removed, mojo-share, child-not-allowed, depth. Renames,
 * percentage edits, Fire/Mojo edits and the tax-pot tick are never violations.
 */
export function checkTemplateBounds(rules, allocation, goals) {
    const r = rules || BUCKET_METHOD.rules;
    const rows = Array.isArray(allocation) ? allocation.filter((x) => x && typeof x === 'object') : [];
    const gl = Array.isArray(goals) ? goals.filter((g) => g && typeof g === 'object') : [];
    const violations = [];
    const core = Array.isArray(r.coreBuckets) ? r.coreBuckets : [];
    if (!r.topLevelAddAllowed) {
        rows.forEach((row) => { if (!core.includes(row.role)) violations.push({ code: 'extra-top-level', bucketId: row.id }); });
    }
    core.forEach((role) => {
        if (!rows.some((row) => row.role === role)) violations.push({ code: 'core-removed', role });
    });
    if (r.mojoShare === 0) {
        rows.forEach((row) => { if (row.role === 'mojo' && num(row.percentage) > 0) violations.push({ code: 'mojo-share', bucketId: row.id }); });
    }
    const goalById = new Map(gl.map((g) => [String(g.id), g]));
    const rowById = new Map(rows.map((x) => [String(x.id), x]));
    gl.forEach((g) => {
        let depth = 1;
        let p = goalById.get(String(g.parentId));
        const seen = new Set([String(g.id)]);
        while (p && !seen.has(String(p.id))) { seen.add(String(p.id)); depth++; p = goalById.get(String(p.parentId)); }
        const rootId = p ? null : String(rowFor(g, goalById));
        const root = rootId != null ? rowById.get(rootId) : null;
        if (Array.isArray(r.childrenAllowedIn) && !(root && r.childrenAllowedIn.includes(root.role))) {
            violations.push({ code: 'child-not-allowed', bucketId: g.id });
        }
        if (depth > num(r.maxDepth)) violations.push({ code: 'depth', bucketId: g.id });
    });
    return { inBounds: violations.length === 0, violations };
}

// Walk up from a goal to its top-level parent id.
function rowFor(g, goalById) {
    let cur = g;
    const seen = new Set();
    while (cur && goalById.has(String(cur.parentId)) && !seen.has(String(cur.id))) {
        seen.add(String(cur.id));
        cur = goalById.get(String(cur.parentId));
    }
    return cur ? cur.parentId : null;
}

/**
 * Make this your own template: a new savingModel with id custom-<n>, basedOn the method,
 * relaxed rules. Only identity and rules change; fire, mojo, transfers and the rest
 * are copied as they are. Already custom: returns an equal copy (idempotent).
 */
export function forkToCustom(model, n = 1) {
    const m = clone(model && typeof model === 'object' ? model : {});
    if (typeof m.id === 'string' && m.id.startsWith('custom-')) return m;
    m.id = `custom-${n}`;
    m.name = 'My template';
    m.after = null;
    m.basedOn = 'bucket-method';
    m.rules = clone(CUSTOM_RULES);
    return m;
}

/** A custom template that again fits the Bucket method may offer "Switch back". */
export function canReturnToBase(model, allocation, goals) {
    if (!model || model.basedOn !== 'bucket-method') return false;
    return checkTemplateBounds(BUCKET_METHOD.rules, allocation, goals).inBounds;
}
