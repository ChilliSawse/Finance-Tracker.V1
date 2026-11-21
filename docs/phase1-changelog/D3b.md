# D3b pdf.js bundled, offline precache

- `pdfjs-dist` 6.5.438 pinned exactly (`--save-exact`); `src/import/pdfjs-loader.js` now imports the library lazily from node_modules and the minified worker as a hashed same-origin `?url` asset (`isEvalSupported:false` kept). No CDN, no fake worker.
- `vite.config.js`: precache globs gain `mjs`, so the pdf.js worker (about 1.27 MB) is precached; PDF import works offline after first load. Size limit unchanged.
- `index.html` CSP: `https://cdn.jsdelivr.net` dropped from `script-src` (grep: no other user). `worker-src 'self' blob:` kept.
- Not covered: the wasm decoders (JPX/JBIG2) for image-heavy PDFs are out of scope; text statements and payslips are unaffected.
- `vite-plugin-pwa` bump to ^2.0.0 is a separate commit.
- pdf.js 6.x removed `PDFDocumentProxy.destroy()` (P0 missed it; found by the offline import run: "destroy is not a function"). `openPdfDocument` now bridges `pdf.destroy()` to the loading task so `pdf-ui.js` is unchanged.
- `index.html` hint text: "needs internet" removed (reader is built in). `pdf.loadFailed` in `en.js` still mentions the internet connection; left for its owner.
- Checked: built app makes zero external requests (full load and offline PDF import); precache has the Manrope woff2 and the pdf.js worker (35 entries, about 3.0 MiB). Offline import of a synthetic text PDF read 3 transactions. tests.html 1169/1169, run-cases 887 passed.
