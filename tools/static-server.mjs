// D4: a tiny static file server on 127.0.0.1 and a random free port, shared by tools/ci-tests.mjs and
// tools/sweep.mjs. Serves one directory, refuses paths outside it.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

/** @param {string} root absolute directory @returns {Promise<{port:number, close:()=>void}>} */
export async function serveDir(root) {
    const server = http.createServer(async (req, res) => {
        // G6W12-8: a malformed escape such as '%' answers 400 instead of crashing the server.
        let rel;
        try { rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, ''); } catch (_) { res.writeHead(400); res.end(); return; }
        const file = join(root, rel || 'index.html');
        if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
        try {
            const data = await readFile(file);
            res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
            res.end(data);
        } catch (_) {
            res.writeHead(404); res.end();
        }
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    return { port: server.address().port, close: () => server.close() };
}
