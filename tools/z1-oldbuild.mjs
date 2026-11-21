// Z1 (U18): an OLD build (pre-phase1) opened over a save and ledger-db v2 written by the NEW build, same origin and profile.
//   node tools/z1-oldbuild.mjs <newDist> <oldDist> [--out dir]
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from 'playwright-core';
import { buildStatementPdf } from './accept-fixtures.mjs';

const [newDist, oldDist] = [resolve(process.argv[2]), resolve(process.argv[3])];
const out = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'z1-shots');
await mkdir(out, { recursive: true });
const PORT = 8761;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
function serve(root) {
    return new Promise((ok) => { const s = http.createServer(async (q, r) => { try { const p = decodeURIComponent(q.url.split('?')[0]); const d = await readFile(join(root, p === '/' ? 'index.html' : p)); r.writeHead(200, { 'content-type': TYPES[extname(p === '/' ? 'x.html' : p)] || 'application/octet-stream' }); r.end(d); } catch (_) { r.writeHead(404); r.end(); } }).listen(PORT, '127.0.0.1', () => ok(s)); });
}
const dump = () => new Promise((resolveP) => {
    const o = { ls: Object.fromEntries(Object.keys(localStorage).filter((k) => /financeTrackerData|ft-|ledger/i.test(k)).map((k) => [k, localStorage.getItem(k).length])), data: null };
    try { const d = JSON.parse(localStorage.getItem('financeTrackerData_v2')).financeData; const arr = {}; for (const k of Object.keys(d)) if (Array.isArray(d[k])) arr[k] = d[k].length; o.data = { topKeys: Object.keys(d).sort().join(','), plan: !!d.plan, planKeys: d.plan ? Object.keys(d.plan).sort().join(',') : null, planJsonLen: d.plan ? JSON.stringify(d.plan).length : 0, arrays: arr, essentialNames: (d.essentialExpenses || []).map((x) => x.name), bytes: JSON.stringify(d).length }; } catch (e) { o.data = String(e); }
    const req = indexedDB.open('ledger-db');
    req.onerror = () => { o.db = { error: String(req.error) }; resolveP(o); };
    req.onsuccess = () => { const db = req.result; o.db = { version: db.version, stores: [...db.objectStoreNames] }; const names = [...db.objectStoreNames]; let n = names.length; if (!n) { db.close(); return resolveP(o); } o.db.counts = {}; for (const s of names) { const c = db.transaction(s).objectStore(s).count(); c.onsuccess = () => { o.db.counts[s] = c.result; if (--n === 0) { db.close(); resolveP(o); } }; } };
});
const user = await mkdtemp(join(tmpdir(), 'z1-prof-'));
const log = (k, v) => console.log(k.padEnd(26), typeof v === 'string' ? v : JSON.stringify(v));
async function open(root, label, fn) {
    const srv = await serve(root);
    const ctx = await chromium.launchPersistentContext(user, { executablePath: process.env.CHROMIUM_PATH, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = ctx.pages()[0] || await ctx.newPage();
    const errs = []; const cons = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 220)));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) cons.push(m.type() + ': ' + m.text().slice(0, 220)); });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    try { await fn(page, { errs, cons }); } finally { await ctx.close(); srv.close(); }
}
try {
    let before;
    await open(newDist, 'new', async (page, e) => {
        const s = page.locator('[data-su="sample"]'); if (await s.count()) { await s.first().click(); await page.waitForTimeout(1500); }
        await page.locator('[data-tab-target="activity"]:visible').first().evaluate((el) => el.click());
        await page.locator('#open-pdf-import').click();
        await page.locator('#pdf-import-file').setInputFiles({ name: 's.pdf', mimeType: 'application/pdf', buffer: Buffer.from(buildStatementPdf()) });
        await page.waitForFunction(() => !document.getElementById('pdf-import-config').hidden, null, { timeout: 20000 });
        await page.locator('#pdf-import-actions button.btn-primary, #pdf-import-actions .btn').first().click().catch(() => {});
        await page.waitForTimeout(1500);
        // a scenario row, so the v2 store has data
        await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('ledger-db'); q.onsuccess = () => { const db = q.result; if (db.objectStoreNames.contains('scenarios')) { const t = db.transaction('scenarios', 'readwrite'); t.objectStore('scenarios').put({ id: 'z1-test', name: 'Z1 test', changes: [], createdAt: Date.now() }); t.oncomplete = () => { db.close(); r(); }; t.onerror = () => { db.close(); r(); }; } else { db.close(); r(); } }; q.onerror = () => r(); }));
        await page.waitForTimeout(500);
        before = await page.evaluate(dump);
        log('NEW build state', before);
        log('NEW build errors', e.errs);
    });
    await open(oldDist, 'old', async (page, e) => {
        const after1 = await page.evaluate(dump);
        log('OLD build, on load', after1);
        log('OLD title/main text', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300));
        await page.screenshot({ path: join(out, 'old-over-v2.png') });
        // an edit through the old build: Settings, add an essential expense
        await page.locator('#open-gui-settings').click().catch((e) => log('OLD settings click', String(e).slice(0, 80)));
        await page.waitForTimeout(600);
        await page.locator('#add-essential-expense-settings').evaluate((el) => el.click()).catch((e) => log('OLD add click', String(e).slice(0, 80)));
        await page.waitForTimeout(2500);
        log('OLD after edit', await page.evaluate(dump));
        // old CSV import (touches ledger-db at version 1 against a version-2 database)
        await page.keyboard.press('Escape');
        await page.locator('#import-file').setInputFiles({ name: 't.csv', mimeType: 'text/csv', buffer: Buffer.from(['Date,Description,Amount', '02/03/2026,TEST SHOP,-10.00'].join(String.fromCharCode(10))) }).catch((e) => log('OLD csv set', String(e).slice(0, 100)));
        await page.waitForTimeout(1500);
        log('OLD import modal text', (await page.locator('#import-modal').innerText().catch(() => 'n/a')).replace(/s+/g, ' ').slice(0, 300));
        await page.screenshot({ path: join(out, 'old-after-edit.png') });
        log('OLD direct open v1', await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('ledger-db', 1); q.onerror = () => r(String(q.error)); q.onsuccess = () => { q.result.close(); r('opened'); }; })));
        await page.waitForTimeout(500);
        log('OLD console errors', e.cons); log('OLD page errors', e.errs);
    });
    await open(newDist, 'new again', async (page, e) => {
        const after2 = await page.evaluate(dump);
        log('NEW build again', after2);
        log('NEW again errors', e.errs.concat(e.cons));
        await page.screenshot({ path: join(out, 'new-after-old.png') });
    });
} finally { await rm(user, { recursive: true, force: true }).catch((e) => console.log('cleanup', String(e).slice(0, 80))); }
