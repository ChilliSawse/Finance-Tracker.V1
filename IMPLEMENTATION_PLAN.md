# Finance-Tracker.V1 — Implementation Plan

Generated from combined AI review (security, accessibility, PWA, CSS architecture, mobile, design).
Phases are ordered by dependency — earlier steps unblock later ones. Each phase is independently shippable.

---

## Phase 1 — Security (do first, blocks everything else)

These are non-negotiable before any public use.

### Step 1.1 — Sanitize all innerHTML assignments
Replace every `element.innerHTML = user_text` with `element.textContent = user_text` for plain text.
For anything that genuinely needs HTML structure, build the string from safe template parts —
user-supplied strings (names, labels) go through a `sanitize(str)` helper that uses `textContent`
assignment to escape them.

Touch points:
- js/uiDashboard.js lines 74, 88, 110, 132, 233
- js/uiSettings.js lines 31, 82
- All other list-rendering functions across both files

### Step 1.2 — Remove inline onclick from injected HTML
In js/main.js lines 150 and 164, the update banner uses `onclick="applyUpdate()"` inside an
innerHTML string. Replace with `createElement`, set text content, then attach via
`addEventListener('click', applyUpdate)` after insertion.

### Step 1.3 — Add a Content-Security-Policy meta tag
Add to <head> in index.html:

    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">

### Step 1.4 — Add JSON import schema validation
In js/events.js around line 398, add a validate function that checks required top-level keys,
field types, and sane value ranges before assigning `financeData = importedBundle.financeData`.
Reject with a user-facing error message if validation fails.

---

## Phase 2 — Accessibility Foundations

### Step 2.1 — Convert tab divs to buttons
In index.html, every `<div class="tab" ...>` becomes `<button class="tab" type="button" ...>`.

Also add:
- `role="tablist"` on the container
- `role="tab"` and `aria-selected="true/false"` on each tab
- `aria-controls="panel-id"` on each tab linking to its panel
- `role="tabpanel"` + `id` + `aria-labelledby` on each panel div

Add keyboard handling in js/main.js:
- ArrowLeft / ArrowRight to move between tabs
- Home / End to jump to first / last tab

### Step 2.2 — Fix focus ring
In style.css line 544, replace `outline: none` with:

    .form-input:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

Remove the box-shadow-only replacement entirely.

### Step 2.3 — Add skip-to-content link
First child inside <body> in index.html:

    <a href="#main-content" class="skip-link">Skip to content</a>

Add `id="main-content"` to the tab panels container.
Style `.skip-link` as visually hidden until focused, then visible.

### Step 2.4 — Add aria-live regions
- Wrap the save-status indicator with `aria-live="polite"`
- Add `aria-live="polite" aria-atomic="true"` to dashboard key stat containers
  (total income, total expenses, net worth) so screen readers announce updates

### Step 2.5 — Add autocomplete attributes
Go through all <input> elements in index.html and add:
- `autocomplete="off"` for financial amount fields (prevents wrong autofill)
- `autocomplete="organization"` for source/expense name fields

### Step 2.6 — Restore beforeunload warning
In js/state.js line 210, uncomment `e.preventDefault()` and `e.returnValue = ''`
so users get a browser warning when navigating away with unsaved changes.

---

## Phase 3 — Theme System (Odysseus Architecture)

The goal is a fully token-driven theme system with preset themes, a runtime switcher,
and FOUC prevention — adapted from Odysseus but simplified for a finance app.

### Step 3.1 — Audit and tokenize the existing CSS
Go through style.css and map every hard-coded color to a semantic token:

    Hard-coded value    New token name          Semantic meaning
    ------------------------------------------------------------------
    #4CAF50             --color-positive        savings/positive amounts
    #f44336             --color-negative        expenses/negative amounts
    #2196F3             --color-neutral         income/neutral amounts
    #667eea / #764ba2   --accent / --accent-alt primary brand gradient
    #e3f2fd             --info-bg               info section backgrounds
    #bbdefb             --info-border           info section borders

Document the full list before touching any CSS.

### Step 3.2 — Create js/theme.js
New file. Adapted from Odysseus but finance-specific. Contains:

THEMES object with 7 preset themes:
- default    — current purple gradient (existing look, no disruption)
- dark       — dark charcoal with teal accents
- midnight   — near-black with amber/gold (financial instrument feel)
- light      — warm off-white, paper feel
- forest     — dark green, calm
- ocean      — deep navy, blue accents
- rose       — light warm pink

Each theme defines these 8 tokens:

    {
      bg:       '#...',   // page background
      fg:       '#...',   // primary text
      panel:    '#...',   // card/panel background
      border:   '#...',   // borders, dividers
      accent:   '#...',   // primary brand/action color
      positive: '#...',   // income/savings (green-family)
      negative: '#...',   // expenses/debt (red-family)
      neutral:  '#...'    // neutral amounts (blue-family)
    }

Functions to implement:
- applyTheme(colors)    — sets all CSS custom properties on document.documentElement.style
- saveTheme(name)       — persists to localStorage['finance-tracker-theme']
- loadTheme()           — reads from localStorage, returns theme object or null
- THEME_DISPLAY_NAMES   — human-readable names for the UI switcher

### Step 3.3 — Add early-load FOUC prevention script
Inside <head> in index.html, BEFORE any <link rel="stylesheet">, add an inline <script>:

    <script>
    (function(){
      try {
        var t = JSON.parse(localStorage.getItem('finance-tracker-theme'));
        if (t && t.colors) {
          var s = document.documentElement.style;
          s.setProperty('--bg', t.colors.bg);
          s.setProperty('--fg', t.colors.fg);
          s.setProperty('--panel', t.colors.panel);
          s.setProperty('--border', t.colors.border);
          s.setProperty('--accent', t.colors.accent);
          s.setProperty('--color-positive', t.colors.positive);
          s.setProperty('--color-negative', t.colors.negative);
          s.setProperty('--color-neutral', t.colors.neutral);
          var mt = document.querySelector('meta[name="theme-color"]');
          if (mt) mt.setAttribute('content', t.colors.bg);
        }
      } catch(e){}
    })();
    </script>

This prevents a flash of the default theme before JS loads (same pattern Odysseus uses).

### Step 3.4 — Rewrite style.css :root block
Replace the existing :root variables with the full token set from Step 3.1.
Every hard-coded color found in the audit becomes a reference to one of these tokens.
After this step, swapping a theme by changing 8 variables changes the entire app appearance.

### Step 3.5 — Build the theme switcher UI
In the GUI Settings tab in index.html, replace the existing color pickers with:
- A theme grid showing a colour swatch for each preset, active theme highlighted
- Below the grid, a collapsible "Customize" section with colour pickers for each of the 8 tokens
- A "Save as custom theme" button (max 3 custom themes stored in localStorage)
- A font selector: System (current) / Monospace / Serif
- A density selector: Compact / Default / Spacious (controls base font-size)

Wire up in js/uiSettings.js and js/theme.js.

### Step 3.6 — Apply tabular-nums to all financial figures
In style.css, add to selectors that render currency amounts:

    .amount, .currency, .stat-value, [data-currency] {
      font-variant-numeric: tabular-nums;
    }

One CSS line — makes all money values feel precise (digit columns don't shift width).

### Step 3.7 — Strip production console.log calls
In js/main.js, add a gated logger at the top:

    const DEBUG = false;
    const log = (...args) => DEBUG && console.log(...args);

Replace all console.log( calls with log( across all JS files.
The emoji-heavy debug logs in js/main.js lines 115–183 should be removed entirely.

---

## Phase 4 — Mobile Navigation

### Step 4.1 — Audit current mobile layout
Load the app at 375px viewport width and document every layout problem. Known issues:
- 8 tabs cramped horizontally
- Multi-column list grids overflowing on small screens
- Mobile @media override using blunt repeat(3, 1fr) for all sections

### Step 4.2 — Redesign tab navigation for mobile
On screens below 640px, convert the horizontal tab bar into a bottom navigation bar:
- Show the 5 most-used tabs with icon + short label
- A "More" button opens a drawer for the remaining tabs
- In style.css, add @media (max-width: 640px) block:
  - Hide existing .tabs-nav bar
  - Show .bottom-nav (position: fixed, bottom: 0)
  - Add padding-bottom: 60px to main content so nothing hides behind the bar
  - Add touch-action: manipulation to all interactive elements

### Step 4.3 — Fix per-section mobile grids
Each list section has a different column count (income=8, expenses=4, liabilities=4, assets=3,
tax brackets=4). Fix @media overrides so each section has its own responsive breakpoint rather
than a shared blunt override.

For mobile:
- Most sections collapse to a 2-column layout or single-column card stack
- Income section (8 columns) shows only name + amount as primary on mobile,
  with remaining columns accessible via an expand/details toggle

### Step 4.4 — Add safe-area insets
On the bottom nav and any fixed elements:

    padding-bottom: calc(16px + env(safe-area-inset-bottom));

Prevents content being hidden behind the home bar on iOS.

### Step 4.5 — Add prefers-reduced-motion
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }

---

## Phase 5 — CSS Cleanup

### Step 5.1 — Fix transition: all
In style.css lines 119 and 558, replace transition: all with explicit properties:

    /* line 119 */
    transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;

    /* line 558 (.btn) */
    transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.1s ease;

### Step 5.2 — Fix !important on .btn-install
In style.css lines 1020/1027, fix the specificity root cause rather than overriding
with !important. Increase the .btn-install selector specificity or restructure rule order.

### Step 5.3 — Remove dead CSS
Remove .scenario-card — never used in HTML (.settings-section is used instead).

### Step 5.4 — Add typography tokens
    :root {
      --font-body:    system-ui, -apple-system, 'Segoe UI', sans-serif;
      --font-mono:    'Fira Code', 'Consolas', monospace;
      --font-display: var(--font-body); /* overridden per theme */
    }

---

## Phase 6 — PWA & Service Worker

### Step 6.1 — Fix service worker HTML caching strategy
In sw.js, change the fetch handler to use network-first for HTML, cache-first for assets:

    if (request.mode === 'navigate') {
      return fetch(request).catch(() => caches.match('./index.html'));
    }
    // Cache-first for all other assets (CSS, JS, images)

### Step 6.2 — Add offline fallback response
In sw.js line 79, replace the silent catch with a proper fallback:

    .catch(() => new Response('Offline — check your connection.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    }))

### Step 6.3 — Remove duplicate service worker registration
In js/main.js, consolidate the two SW registration calls into one location.

### Step 6.4 — Add manifest enhancements
In manifest.json, add:

    "categories": ["finance"],
    "screenshots": []

---

## Phase 7 — Input Validation & Edge Cases

### Step 7.1 — Add form input validation
Before any state update in js/events.js, validate:
- Amount fields: non-negative finite number
- Percentage fields: 0–100
- Name fields: non-empty, max 100 chars
- Frequency fields: must match a supported enum value

Show inline validation errors (not alert()).

### Step 7.2 — Fix FI calculation edge case
In js/calculations.js lines 85–96, guard against annualSavings <= 0.
Return a meaningful object with an error flag rather than Infinity/NaN.
Display a user-facing message in the FI tab:
"Cannot calculate — annual savings must be positive."

### Step 7.3 — Wrap global state in a namespace
Replace bare globals with a single AppState object:

    const AppState = {
      financeData: null,
      guiSettingsData: null,
      whatIfEssential: [],
      whatIfNonEssential: [],
      autoSave: null
    };

Update all references across all JS files. Test thoroughly — this touches everything.

---

## Execution Order & Estimates

    Order   Phase                                   Effort    Risk    Notes
    -------------------------------------------------------------------------
    1       Phase 1 (Security)                      2–3h      Low     Unblocks public sharing
    2       Phase 2 (Accessibility foundations)     3–4h      Medium  Tab refactor touches many files
    3       Phase 3.1–3.4 (CSS tokens + theme engine) 4–6h   Medium  Tokenize CSS before building UI
    4       Phase 4 (Mobile nav)                    3–4h      Low     Independent of theme work
    5       Phase 5 (CSS cleanup)                   1–2h      Low     While CSS is already open
    6       Phase 3.5–3.7 (Theme UI + polish)       3–4h      Low     UI built on top of engine
    7       Phase 6 (PWA)                           1–2h      Low     Isolated to sw.js + main.js
    8       Phase 7 (Validation + edge cases)       3–4h      Medium  Touches events.js broadly

    Total estimate: 20–27 hours across all phases, working incrementally.
