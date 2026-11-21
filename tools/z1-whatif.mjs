// Z1 (AT-12): What If on the built app with the sample household plus three dated goals.
//   node tools/z1-whatif.mjs [--out dir]   (env W = viewport width, default 1440)
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serveDir } from './static-server.mjs';

const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'z1-shots');
await mkdir(out, { recursive: true });
const W = Number(process.env.W || 1440);
const served = await serveDir(resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist'));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const log = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage(); page.setDefaultTimeout(6000);
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await page.goto(`http://127.0.0.1:${served.port}/`); await page.waitForTimeout(1500);
    await page.locator('[data-su="sample"]').first().click(); await page.waitForTimeout(4000);
    await page.evaluate(() => {
        const o = JSON.parse(localStorage.getItem('financeTrackerData_v2'));
        const y = new Date().getFullYear() + 1;
        o.financeData.bucketGoals = [
            { id: 'g-concert', parentId: 'b-smile', name: 'Concert', share: 0, cost: 500, saved: 500, due: `${y}-01-13`, order: 0, done: false },
            { id: 'g-bike', parentId: 'b-smile', name: 'New bike', share: 0, cost: 3000, saved: 0, due: `${y}-03-01`, order: 1, done: false },
            { id: 'g-japan', parentId: 'b-smile', name: 'Japan', share: 0, cost: 7500, saved: 0, due: `${y}-06-01`, order: 2, done: false },
        ];
        localStorage.setItem('financeTrackerData_v2', JSON.stringify(o));
    });
    await page.reload(); await page.waitForTimeout(1500);
    await page.locator('[data-tab-target="future"]:visible').first().evaluate((el) => el.click()); await page.waitForTimeout(800);
    await page.locator('[data-fu-new]').first().click(); await page.waitForTimeout(500);
    await page.locator('[data-act="how-close"]').click().catch(() => {});
    log('ask step visible', await page.locator('[data-act="starter"]').count());
    await page.screenshot({ path: join(out, `ask-${W}.png`), fullPage: true });
    await page.locator('[data-act="step"][data-step="answer"]').first().click(); await page.waitForTimeout(1500);
    // headline of the top verdict per option card
    const heads = {};
    const verdict = () => page.evaluate(() => { const v = document.querySelector('[data-verdict]'); return v ? v.innerText.replace(/\s+/g, ' ').slice(0, 160) + ' [' + v.dataset.verdict + ']' : 'no [data-verdict]'; });
    for (const id of ['cut', 'mix', 'earn']) {
        await page.locator(`input[data-act="way"][value="${id}"]`).evaluate((el) => el.click());
        await page.waitForTimeout(500);
        heads[id] = await verdict();
    }
    log('verdict per option', heads);
    log('verdicts differ', new Set(Object.values(heads)).size);
    await page.screenshot({ path: join(out, `answer-${W}.png`), fullPage: true });
    // timeline labels: any two label boxes in the same row touching?
    const lab = await page.evaluate(() => {
        const root = document.getElementById('scenario-root');
        const cand = [...root.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^\d{1,2} [A-Z][a-z]{2}$/.test((e.textContent || '').trim()));
        const boxes = cand.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), l: Math.round(r.left), r: Math.round(r.right), top: Math.round(r.top), b: Math.round(r.bottom) }; });
        const hits = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; if (a.l < c.r && c.l < a.r && a.top < c.b && c.top < a.b) hits.push([a.t, c.t]); }
        return { n: boxes.length, boxes, overlaps: hits, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
    });
    log('timeline labels', lab);
    // Plan for this: one-tap options
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('financeTrackerData_v2')).financeData.bucketGoals.map((g) => g.id + ':' + g.due));
    await page.locator('[data-act="pft-save"]').click(); await page.waitForTimeout(1500);
    log('plan for this toast/text', (await page.locator('#ledger-toast, .toast').first().innerText().catch(() => 'no toast')).slice(0, 160));
    const rows = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('ledger-db'); q.onsuccess = () => { const db = q.result; const g = db.transaction('scenarios').objectStore('scenarios').getAll(); g.onsuccess = () => { db.close(); r(g.result.map((s) => ({ name: s.name, changes: s.changes.length }))); }; }; }));
    log('scenarios saved after Plan for this', rows);
    log('goals before', before);
    log('page errors', errs);
} finally { await browser.close(); served.close(); }
