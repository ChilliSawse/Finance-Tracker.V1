// Dry run of the Phase 1 migration chain on a private copy of a backup (FT-R-79, plan M-12).
//   node tools/dry-run.mjs <backup.json> [--no-amounts]
// Reads the file once and runs the whole chain on an in-memory copy with an in-memory storage.
// Writes nothing: no files, no localStorage, no network. Prints to the terminal only.
//   Section (a): amount-free structure tables (buckets, categories to plan items, bills to
//                reminders, debts to the Fire list, the chain result).
//   Section (b): amounts (totals and balance sums before and after, with the check result).
//                --no-amounts leaves section (b) out completely.
// Exits 1 when any check fails, 2 on a usage or read error. Never commit a backup to the repo.

import fs from 'node:fs';
import { runMigrationChain, BACKUP_KEY } from '../src/state/migration-chain.js';
import { effectiveBucket, planTotals, netPerPayCents } from '../src/calc/plan.js';
import { getWeeklyAmount } from '../src/utils.js';

const args = process.argv.slice(2);
const noAmounts = args.includes('--no-amounts');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
    console.error('Usage: node tools/dry-run.mjs <backup.json> [--no-amounts]');
    process.exit(2);
}

let raw;
let parsed;
try {
    raw = fs.readFileSync(file, 'utf8');
    parsed = JSON.parse(raw);
} catch (err) {
    console.error(`Could not read ${file} as JSON: ${err.message}`);
    process.exit(2);
}
const data = parsed && parsed.financeData && typeof parsed.financeData === 'object' ? parsed.financeData : parsed;
if (!data || typeof data !== 'object' || !Array.isArray(data.incomeSources)) {
    console.error('This does not look like a Ledger backup (no financeData.incomeSources).');
    process.exit(2);
}

// ---------- helpers ----------

const clone = (v) => JSON.parse(JSON.stringify(v));
const arr = (x) => (Array.isArray(x) ? x : []);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const cents = (d) => Math.round(num(d) * 100);
const money = (c) => `${c < 0 ? '-' : ''}${(Math.abs(c) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const checks = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: !!ok, detail });

function table(title, headers, rows) {
    console.log(`\n${title}`);
    if (!rows.length) { console.log('  (none)'); return; }
    const all = [headers, ...rows.map((r) => r.map((c) => (c == null ? '' : String(c))))];
    const w = headers.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
    const line = (r) => '  ' + r.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd();
    console.log(line(headers));
    console.log('  ' + w.map((n) => '-'.repeat(n)).join('  '));
    rows.forEach((r) => console.log(line(r.map((c) => (c == null ? '' : c)))));
}

// ---------- run (in memory only) ----------

const before = clone(data);
const work = clone(data);
const store = new Map();
const memStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
let saves = 0;
const steps = [];
const warn = console.warn;
console.warn = () => {};
let result;
try {
    result = runMigrationChain(work, { raw, source: 'import', storage: memStorage, forceSave: () => { saves++; }, trace: (n) => steps.push(n) });
} finally { console.warn = warn; }

// A second run on the result must change nothing.
const afterJson = JSON.stringify(work);
const second = clone(work);
console.warn = () => {};
let result2;
try { result2 = runMigrationChain(second, { raw: afterJson, source: 'load', storage: memStorage }); } finally { console.warn = warn; }
const secondNoop = !result2.changed && !result2.aborted && JSON.stringify(second) === afterJson;

const sm = work.savingModel;
const alloc = arr(work.allocation).filter((r) => r && typeof r === 'object');

// ---------- checks ----------

check('chain finished without aborting', !result.aborted && result.errors.length === 0, result.errors.join(', '));
check('plan model written (dataVersion 2, no totals error)', work.dataVersion >= 2 && !(work.planMigration && work.planMigration.error), work.planMigration && work.planMigration.error);
check('bucket model written (savingModel.version 1)', !!(sm && sm.version >= 1));
check('auto-credit is off for migrated data', !sm || !sm.autoCredit || sm.autoCredit.on === false || before.savingModel);
check('legacyAllocation kept', !sm || before.savingModel || Array.isArray(sm.legacyAllocation));
check('backup written before any change', !result.changed || !!before.savingModel || before.dataVersion >= 2 || memStorage.getItem(BACKUP_KEY) === raw, 'ft-backup-pre-plan (in memory only)');
check('second run is a no-op', secondNoop);

const balAfter = alloc.reduce((a, r) => a + cents(r.currentBalance), 0)
    + arr(work.bucketGoals).reduce((a, g) => a + cents(g && g.saved), 0)
    + arr(sm && sm.fire && sm.fire.targets).filter((t) => t && t.type === 'saver').reduce((a, t) => a + num(t.savedCents), 0);
const balBefore = arr(before.allocation).filter((r) => r && typeof r === 'object').reduce((a, r) => a + cents(r.currentBalance), 0)
    + arr(before.bucketGoals).reduce((a, g) => a + cents(g && g.saved), 0)
    + arr(before.savingModel && before.savingModel.fire && before.savingModel.fire.targets).filter((t) => t && t.type === 'saver').reduce((a, t) => a + num(t.savedCents), 0);
check('balance sum before equals after', balBefore === balAfter);

const legacyWeekly = (rows) => arr(rows).reduce((s, r) => s + getWeeklyAmount(r && r.amount, r && r.frequency), 0);
let totals = null;
try { totals = planTotals(work); } catch (err) { totals = null; }
if (!before.dataVersion || before.dataVersion < 2) {
    check('plan totals equal the legacy lists (weekly)', totals
        && Math.abs(totals.essentialWeekly - legacyWeekly(before.essentialExpenses)) < 1e-6
        && Math.abs(totals.nonEssentialWeekly - legacyWeekly(before.nonEssentialExpenses)) < 1e-6);
}

// ---------- section (a): structure, no amounts ----------

console.log(`Ledger migration dry run (in memory only; nothing is written)`);
console.log(`File: ${file}`);
console.log(`Input: dataVersion ${before.dataVersion == null ? 'none' : before.dataVersion}, savingModel ${before.savingModel ? 'present' : 'none'}`);

console.log('\n(a) STRUCTURE (no amounts)');
console.log(`\nChain result: aborted=${result.aborted} changed=${result.changed} backedUp=${result.backedUp} errors=[${result.errors.join(', ')}] forceSave calls=${saves}`);
console.log(`Steps run: ${steps.join(' > ')}`);

if (sm) {
    const m = sm.migration;
    console.log(`\nOutcome: ${m ? m.outcome : '(new-format save, untouched)'}  model: ${sm.id} "${sm.name}"`
        + (m ? `  reasons: [${m.reasons.join(', ')}]  splitTotalOff: ${m.splitTotalOff}` : ''));
    if (m && m.unmapped.length) console.log(`Unmapped buckets (no role): ${m.unmapped.map((n) => `"${n}"`).join(', ')}`);
    console.log(`Auto-credit: ${sm.autoCredit && sm.autoCredit.on ? 'on' : 'off'}   goals moved: [${m ? m.goalsMoved.join(', ') : ''}]`);
}

table('Buckets', ['#', 'id', 'name', 'role', 'slot', 'kind', 'share %'],
    alloc.map((r, i) => [i + 1, r.id, r.name, r.role == null ? '-' : r.role, r.slot, r.kind, r.percentage]));
table('Smile and other goals', ['id', 'under', 'name', 'share %'],
    arr(work.bucketGoals).map((g) => [g.id, g.parentId, g.name, g.share]));

const cats = arr(work.categories).filter((c) => c && typeof c === 'object');
const items = arr(work.plan).filter((p) => p && typeof p === 'object');
const bucketRole = (id) => { const b = alloc.find((r) => r.id === id); return b ? (b.role || b.name) : (id || '-'); };
const rows = [];
for (const c of cats) {
    const mine = items.filter((p) => p.categoryId === c.id);
    if (!mine.length) continue;
    const buckets = new Set(mine.map((p) => { try { return bucketRole(effectiveBucket(null, c, p, alloc)); } catch (err) { return '?'; } }));
    rows.push([c.id, c.name, c.essential ? 'essential' : 'non-essential', mine.length, [...buckets].join(', ')]);
}
table('Categories with plan items', ['category', 'name', 'flag', 'plan items', 'bucket'], rows);
const catIds = new Set(cats.map((c) => c.id));
const stray = items.filter((p) => !catIds.has(p.categoryId));
console.log(`Plan items: ${items.length} total (${items.filter((p) => p.inTotals).length} in totals, ${items.filter((p) => !p.inTotals).length} bills); in no known category: ${stray.length}`);
const fallbacks = arr(work.planMigration && work.planMigration.fallbacks);
console.log(`Items placed in a catch-all category: ${fallbacks.length}`
    + (work.planMigration && arr(work.planMigration.reviewBills).length ? `; bills to review: ${work.planMigration.reviewBills.length}` : ''));

table('Bills to reminders', ['bill', 'frequency', 'due date set', 'category', 'in totals'],
    items.filter((p) => p.legacy && p.legacy.list === 'bill').map((p) => [p.name, p.frequency, p.anchorDue ? 'yes' : 'no', p.categoryId, p.inTotals ? 'yes' : 'no']));

table('Debts and the Fire list', ['order', 'target', 'type', 'state', 'debt id'],
    arr(sm && sm.fire && sm.fire.targets).map((t, i) => [i + 1, t.label, t.type, t.state, t.liabilityId || '-']));
const noId = arr(work.liabilities).filter((l) => l && typeof l === 'object' && !l.id).length;
console.log(`Liabilities: ${arr(work.liabilities).length}, without an id: ${noId}`);
check('every liability has an id', noId === 0);
const roleCounts = {};
alloc.forEach((r) => { if (r.role) roleCounts[r.role] = (roleCounts[r.role] || 0) + 1; });
check('each role used at most once', Object.values(roleCounts).every((n) => n === 1));

// ---------- section (b): amounts ----------

if (!noAmounts) {
    console.log('\n(b) AMOUNTS (A$, terminal only)');
    table('Bucket balances', ['bucket', 'before', 'after'],
        alloc.map((r) => {
            const was = arr(before.allocation).find((x) => x && (x.name === r.name));
            return [r.name, was ? money(cents(was.currentBalance)) : '(added)', money(cents(r.currentBalance))];
        }));
    console.log(`\nBalance sum (buckets + goals + saver targets): before ${money(balBefore)}, after ${money(balAfter)}  ${balBefore === balAfter ? 'PASS' : 'FAIL'}`);
    if (totals) {
        console.log(`Plan totals, weekly: essential ${money(cents(totals.essentialWeekly))}, non-essential ${money(cents(totals.nonEssentialWeekly))}`
            + (!before.dataVersion || before.dataVersion < 2
                ? ` (legacy lists: ${money(cents(legacyWeekly(before.essentialExpenses)))} and ${money(cents(legacyWeekly(before.nonEssentialExpenses)))})` : ''));
    }
    try { console.log(`Net pay per cycle: ${money(netPerPayCents(work))}`); } catch (err) { console.log('Net pay per cycle: not available'); }
    console.log(`Liabilities total: ${money(arr(before.liabilities).reduce((a, l) => a + cents(l && l.balance), 0))} before, ${money(arr(work.liabilities).reduce((a, l) => a + cents(l && l.balance), 0))} after`);
    console.log(`Percentages total: ${Math.round(alloc.reduce((s, r) => s + num(r.percentage), 0) * 10) / 10}`);
}

// ---------- verdict ----------

console.log('\nChecks');
checks.forEach((c) => console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${!c.ok && c.detail ? ` (${c.detail})` : ''}`));
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\nRESULT: ${failed.length} check(s) FAILED` : '\nRESULT: all checks passed');
process.exit(failed.length ? 1 : 0);
