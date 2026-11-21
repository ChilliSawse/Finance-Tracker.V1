// G6W12-3 and G6W12-8: node checks for tools/dry-run.mjs --no-amounts and tools/static-server.mjs.
//   node tools/tools-check.mjs        (exits 1 on a failure)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { serveDir } from './static-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`); if (!cond) failed++; };

// ---- dry-run: a synthetic file whose plan totals check failed ----
const dir = mkdtempSync(join(tmpdir(), 'ft-tools-'));
const file = join(dir, 'synthetic.json');
writeFileSync(file, JSON.stringify({ financeData: {
    incomeSources: [{ name: 'Job', amount: 1000, frequency: 'fortnightly' }],
    essentialExpenses: [{ name: 'Rent', amount: 432.10, frequency: 'weekly' }], nonEssentialExpenses: [],
    allocation: [], assets: [], liabilities: [], dataVersion: 2, plan: [], categories: [],
    planMigration: { at: '2026-01-01', error: 'Totals check failed: essential 432.1 vs 987.65, non-essential 0 vs 0' },
}, guiSettings: {} }));
const run = (extra) => spawnSync(process.execPath, [join(here, 'dry-run.mjs'), file, ...extra], { encoding: 'utf8' });
const hidden = run(['--no-amounts']);
const full = run([]);
ok('G6W12-3 failing file exits 1', hidden.status === 1, String(hidden.status));
ok('G6W12-3 --no-amounts output names the failed check', /FAIL\s+plan model written/.test(hidden.stdout));
ok('G6W12-3 --no-amounts has no weekly totals or dollar amounts', !/432|987|\$\s*\d|\d+\.\d\d/.test(hidden.stdout + hidden.stderr), hidden.stdout);
ok('G6W12-3 --no-amounts shows the fixed hidden text', hidden.stdout.includes('detail hidden by --no-amounts'));
ok('G6W12-3 full output keeps the detail', full.stdout.includes('432.1 vs 987.65'));
rmSync(dir, { recursive: true, force: true });

// ---- static server: malformed URL, traversal ----
const root = mkdtempSync(join(tmpdir(), 'ft-srv-'));
writeFileSync(join(root, 'index.html'), '<p>x</p>');
const srv = await serveDir(root);
const raw = (path) => new Promise((resolve, reject) => {
    const s = net.connect(srv.port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.0\r\nHost: x\r\n\r\n`));
    let buf = '';
    s.on('data', (d) => { buf += d; }); s.on('end', () => resolve(+buf.split(' ')[1])); s.on('error', reject);
});
ok('G6W12-8 malformed % answers 400', (await raw('/%')) === 400);
ok('G6W12-8 server still alive after it', (await raw('/')) === 200);
ok('G6W12-8 ../ traversal refused', [403, 404].includes(await raw('/../../etc/passwd')));
ok('G6W12-8 encoded ..%2f traversal refused', [403, 404].includes(await raw('/..%2f..%2fsecret')));
ok('G6W12-8 encoded backslash traversal refused', [403, 404].includes(await raw('/..%5c..%5csecret')));
srv.close();
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall tools checks passed');
process.exit(failed ? 1 : 0);
