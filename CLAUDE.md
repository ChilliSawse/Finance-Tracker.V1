# Ledger (Finance-Tracker.V1)

Warm, offline-first personal finance tracker. Vanilla JS + ES modules, Vite build,
vite-plugin-pwa (generated service worker). No frameworks — keep it that way.

## Codebase context (from the Graphify call-graph, refreshed 2026-07-08 @ c53933a)

Graph: 322 nodes · 937 edges · 33 communities (`graphify-out/GRAPH_REPORT.md`).

Core abstractions (god nodes — changes here ripple widely):
`getElement()` (57 edges), `escapeHtml()` (36), `t()` i18n (28), `formatCurrency()` (26),
`handleSettingsClickEvents()` (23), `initializeSettingsUI()` (21), `setHTML()` (18), `store` (13).

Architecture map:
- **Entry/startup**: `src/main.js` — ordered boot: load data → theme → settings forms → events → render → restore tab. Order matters.
- **Events**: delegated, not per-element. `src/events/setup.js` (tabs, top-level), `src/events/settings-events.js` (all settings add/delete/change via document-level delegation), `src/ui/whatif.js` (What If scoped).
- **Navigation**: `src/ui/tabs.js` — `showTab()`, single `<nav role="tablist">` serves desktop sidebar AND ≤640px bottom bar (5 slots + More overflow sheet, `.nav-overflow` is display:contents on desktop). Do not duplicate nav DOM.
- **State**: `src/state/` — `store.js`, `autosave.js` (debounced 2.5s), IndexedDB (`db.js`, `transactions.js` in integer cents, `eventlog.js`), localStorage keys `financeTrackerData_v2`, `ft-*` (never rename).
- **Calculations**: `src/calc/` — pure, DOM-free; `tax-au.js` = AU brackets + Medicare + HELP. Tax math is verified — do not touch without tests.
- **Rendering**: `src/ui/render.js` (scoped: only visible tab re-renders), `render-tabs.js` (per-tab), `settings-forms.js` (modal form lists).
- **Theme**: `src/theme/theme.js` + `appearance.js` — single chokepoint `applyGuiStylesToPage` → `applyTheme`/`deriveTokens`, FOUC inline script + `ft-theme-fouc` cache. Fragile; verify themes visually after touching load order.
- **PWA**: `src/pwa.js` — `virtual:pwa-register` is dynamically imported with a catch so raw (unbuilt) hosting still boots. Keep it that way.
- **i18n**: `src/i18n/en.js` + `t()`. New user-facing strings go in the catalogue.

Testing: open `tests.html` (dev or dist) — pure-calc assertions, must stay green.
Dev history/decisions: `NOTES.md` (append-only log), `Implementation-Record.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
