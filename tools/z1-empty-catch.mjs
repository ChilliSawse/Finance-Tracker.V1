import { execSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const RE = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let bad = 0, nowT = 0;
for (const f of walk('src').filter((f) => /\.js$/.test(f))) {
  const now = (fs.readFileSync(f, 'utf8').match(RE) || []).length; nowT += now;
  let before = 0; try { before = (execSync(`git show pre-phase1:${f.split(path.sep).join('/')}`, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1e8 }).toString().match(RE) || []).length; } catch (_) { before = 0; }
  if (now > before) { bad++; console.log('RISE', f, before, '->', now); }
}
console.log('files with a rise:', bad, 'total now', nowT);
