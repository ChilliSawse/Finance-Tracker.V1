# D3a XLSX statement reader and import hardening

- New `src/import/xlsx.js` (FT-R-65): in-house reader, no dependency, offline. Zip central
  directory parsed by hand; stored and deflate entries (`DecompressionStream('deflate-raw')`);
  `DOMParser` for workbook, rels, shared strings, styles and the first worksheet (chosen via
  `workbook.xml` and its rels). Handles shared and inline strings, 1900 serial dates (with the
  leap-year bug) and the 1904 system, date detection from cell styles, numbers stored as text,
  float noise, sparse cells, and leading title or merged banner rows (skipped so the header is
  row 1; `row.line` keeps the sheet row number).
- Limits (G6): file 15 MB, 200 entries, 20 MB per entry, 40 MB total, 100:1 ratio guard (entries
  over 1 MB), 100,000 rows, 256 columns, 1,000,000 cells. Inflate streams and stops at the
  declared size; CRC32 is verified. Any DOCTYPE or ENTITY is rejected before parsing.
- Failures (corrupt, truncated, bad CRC, password-protected OLE2 container, encrypted entry,
  unsupported method, zip64, over a limit, unsafe XML) all reject with `XlsxError` and the UI shows
  one message, "Could not read this workbook. Export it as CSV ...". No rows are ever returned
  from a failed read.
- `import-ui.js`: `.xlsx` routed by extension or MIME type and lazy-loaded; CSV path unchanged
  (intake split into `startDraft`, same behaviour). `index.html`: accept list and drop text.
  String `import.xlsxFailed` in `en.js`.
- Tests: group `xlsx` (D3a.1 to D3a.5, env browser) on workbooks generated at test time by
  `tools/make-xlsx.mjs` (fake data, no committed bytes); two synthetic AU CSV layouts added to
  `csv.test-cases.js`. tests.html 1082/1082.
