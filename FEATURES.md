# Finance-Tracker.V1 — Features

A user-facing overview of what the app does today, plus what's still on the wishlist. This reconciles the older `Current and Proposed Features_v2.md` against the actual shipped state (see `Implementation-Record.md` for the engineering detail — that record is the source of truth for current state).

Last reconciled: 2026-06-25.

---

## Part 1 — Current Features (built and shipped)

### How the app is laid out
- **Sidebar navigation** (CSS-grid app shell): Dashboard, Income, Expenses, Savings, Liabilities, What If. Collapsible; the active tab persists.
- **Mobile bottom-nav** under 640px — the same tabs render as a fixed bottom bar, with on-device usability fixes (no focus-zoom, no horizontal scroll, figures auto-fit their cards).
- **No "Settings" or "Data Settings" tab.** Data entry lives in a **gear-button modal on each tab** (Income/Expenses/Savings/Liabilities). Appearance + currency + backup live in a **topbar gear modal**.
- **Offline-capable (PWA).** Service worker caches the app shell; works with no connection. All data is local — nothing leaves the device.

---

### 1. Dashboard Tab

| Feature | What the user does |
|---|---|
| **View period switcher** | See numbers as Daily (5-day week), Weekly, Fortnightly, Monthly, or Yearly. All cards reflow immediately. |
| **Welcome / empty state** | With no data, three action cards (Add income / Add expenses / Set FI goal) jump straight to the relevant tab and open its editor. |
| **Income Overview card** | After-tax income for the selected period, plus equivalent Annual / Weekly / Daily figures. |
| **Outgoing vs Savings card** | Side-by-side outgoing-expenses and savings for the period; savings-rate progress bar. Negative savings shows red with "Spending exceeds income". |
| **Net Worth card** | Assets − liabilities, with asset and liability lists below. **Coloured by sign** — green when positive, red when negative (not the brand accent). |
| **Expense Breakdown card** | Essential vs non-essential split in dollars + % of spend + a share bar, respecting the active period. |
| **Income Allocation Strategy card** | Per allocation category, the dollar amount per period. For categories with a savings goal: a progress bar + `current / goal · time-to-reach`. |
| **Clickable cards** | Every dashboard card is a link to its tab (keyboard-accessible). |

---

### 2. Income Tab

| Feature | What the user does |
|---|---|
| **Info section** | Collapsible explainer (multiple sources, tax, net income, pay schedules) with a "Learn more" expander; can be dismissed per section. |
| **Per-source income cards** | Each source: name, primary marker, salaried/self-employed label, Gross & Net per cycle, hours per cycle, and an annual Gross / Tax / Net row. |
| **Income Breakdown (Total) card** | Total Gross / Tax / Net (annual) across all sources. |
| **Tax Brackets reference card** | Per-band breakdown for the primary source (range → rate → taxable-in-band → tax-in-band) with a live "Estimated Total Tax" row. Labelled an **estimate** (default brackets omit Medicare levy / LITO). |
| **Summary stats** | Avg Fortnightly Gross, Avg Fortnightly Net, Avg Monthly Net, Effective Tax Rate %. |
| **Edit (gear modal)** | Add/remove income sources (name, salaried/self-employed, gross per cycle, pay cycle, hours, primary toggle) and edit tax brackets (financial year, tax-free-threshold claim, bands + rates). |

> **Salaried calc fix (shipped):** salaried sources now honour the Net Pay / Tax-per-cycle you actually enter, only falling back to a bracket estimate when those are left blank. (Resolves the old "fortnightly income calculated wrong" bug note.)

---

### 3. Expenses Tab

| Feature | What the user does |
|---|---|
| **Info section** | Collapsible explainer (essential vs non-essential, optimisation). |
| **Essential Expenses card** | List with name, amount/frequency, fortnightly + monthly equivalents; weekly + annual totals in the subtitle. Uses a **calm, softer palette** (essentials aren't "bad"). |
| **Non-Essential Expenses card** | Same format, in amber. |
| **Name-search filter** | Filter the expense lists by name. |
| **Summary stats** | Total Weekly, Total Annual, Essential Ratio %, Expenses as % of Net Income. |
| **Edit (gear modal)** | Add/remove/edit expenses: name, amount, frequency, essential/non-essential. |

---

### 4. Savings Tab

| Feature | What the user does |
|---|---|
| **Info section** | Collapsible explainer (savings rate, FI, compound growth, 4% rule) + a Barefoot-buckets explainer. |
| **Net Savings Capacity card** | Per Year / Per Month / Per Week tiles of cash left after all expenses. |
| **Savings Rate card** | Rate % (green/red), progress bar, contextual message, plus a benchmark hint. |
| **Financial Independence card** | Years to FI (compound-growth), Target amount, Annual expenses, Current progress %. Shows "Already reached" / "Needs positive savings" as appropriate. |
| **Assets card** | Read-only asset list + total, as a tinted-card grid. |
| **Allocation goals** | Per-bucket `currentBalance` + `savingsGoal`; the dashboard allocation card shows progress + time-to-reach (goal − funds ÷ annual contribution). |
| **Edit (gear modal)** | Assets, Allocation (percentages — must total 100% — plus per-bucket funds & goals), and FI Settings (FI multiple, expected return %, withdrawal rate). |

---

### 5. Liabilities Tab

| Feature | What the user does |
|---|---|
| **Info section** | Collapsible explainer (debt types, payoff strategy). |
| **Liability Summary card** | Per liability: name, balance, interest rate %, computed monthly/annual interest cost, and a **cost-indicator badge** (High >10% red / Moderate 5–10% amber / Low <5% green). Empty state when none. |
| **Debt Reduction Impact card** | Total Liabilities, Annual Interest Cost, Average Interest Rate %, Net Worth if Debt-Free. |
| **Edit (gear modal)** | Add/remove/edit liabilities: name, balance, annual interest rate %. |

---

### 6. What If? Tab

A **sandboxed second instance of the app** — edits never touch your real data.

| Feature | What the user does |
|---|---|
| **Info section** | Collapsible explainer for scenario planning. |
| **Editable scenario inputs** | Inline editors for Income Sources, Essential & Non-Essential Expenses, Assets, Liabilities, Allocation (percentages, funds, goals) and FI Settings — every base-app setting, seeded from live data but fully overridable. |
| **Edits persist across tab switches** | Switching away and back keeps your scenario; only the first visit or "Reset to current" re-seeds from live data. |
| **Calculate Scenario** | Renders a **full simulated dashboard** below (same card layout as the real one): Income, Outgoing vs Savings, Net Worth, Expense Breakdown, Financial Independence, and an Allocation card with goal/time-to-reach. |
| **Delta badges** | Every figure shows a ↑/↓ change vs current (incl. "no change"). |
| **View period selector** | Reflows the cash-flow cards (daily → yearly); Net Worth + FI stay absolute. |
| **Reset to current** | Re-seeds all inputs from live data (wipes scenario edits). |

---

### 7. Appearance & Settings (topbar gear modal)

A two-tab **Themes | Customize** panel. Everything auto-saves on change — there is no separate "Apply" button.

| Feature | What the user does |
|---|---|
| **Theme presets (12)** | One-click swatches with 4-circle previews: light, midnight, paper, retrowave, forest, ocean, ume, copper, terminal, organs, lavender, cute. Each ships a locked semantic trio so **positive figures always read green**. |
| **Customize — base colours (6)** | Round-swatch pickers: Background, Surface, Text, Accent, Border, Headings. |
| **More Colours** | Grouped extras (muted/secondary, sub-heading, topbar text, content-area bg, tab/active-tab bg, Positive/Negative/Neutral, Essential/Warning). Anything left blank is **derived** automatically — no invisible white-on-white. |
| **Colour Harmony generator** | Pick an accent + a rule (complementary / analogous / triadic / monochromatic) → auto-derives a coherent base palette. Finance semantics stay locked (a red accent won't paint profits red). |
| **Custom themes** | Save named themes to your browser ("Your Themes" grid, with delete), and **export / import** themes as JSON. |
| **Typography** | Font family dropdown, base font size, and **custom-font upload** (`.ttf/.otf/.woff/.woff2`, stored locally and registered via the browser). |
| **Background effects** | Optional animated canvas behind the (transparent) content area, so cards float over it: constellations, petals, rain, synapse, sparkles, embers, perlin-flow. Tint with a custom "Effect colour" or let it follow the accent (auto-disabled with reduced-motion or on small/low-power screens). |
| **Currency selector** | Choose the display currency. |
| **Backup / Restore** | Export all finance data + settings as JSON; import with validation (shows counts of income sources, expenses, assets, liabilities, allocation categories, theme). |
| **Reset / Clear** | Reset appearance to defaults, or clear all data — both behind an inline confirm. |

---

### 8. Global / Cross-cutting

| Feature | Detail |
|---|---|
| **Theme engine** | All semantic tokens derived from a small base palette; one derive-then-apply chokepoint so the whole page stays consistent (no "split look"). Theme cached and replayed before first paint (no flash). |
| **Responsive** | CSS-grid app shell, sidebar on desktop, bottom-nav on phones; figures auto-fit their cards at any width. |
| **Accessibility** | ARIA `tablist` pattern, full keyboard nav, skip link, `aria-live`, reduced-motion guard. |
| **Security** | XSS sanitisation, CSP, JSON-import validation. |
| **Offline / PWA** | Service worker (network-first HTML, cache-first assets, offline fallback). |
| **Persistence** | All finance data + settings in `localStorage`, hydrated on load. |
| **Test harness** | Standalone `tests.html` covering the tax + FI calculations. |

---

## Part 2 — Proposed Features (not yet built)

These are the only genuinely-outstanding items; each is a deliberate stop, usually pending a data-model addition or a design decision. (Mirrors the "Outstanding items" in `Implementation-Record.md`.)

### Needs a data-model addition (could land as one pass)
| Idea | Notes |
|---|---|
| **Upcoming bills (F.3)** | An `upcomingBills[]` (name, amount, due date, frequency); a dashboard "Upcoming this month" card; edited in the Expenses modal; excluded from monthly totals unless due this period. *Deferred to settle how bills interact with existing expense totals.* |
| **Expense category grouping (H.2)** | Group expenses under collapsible category headers with per-category totals. Needs a free-form `category` field (today expenses only carry essential/non-essential). *The name-search half already shipped.* |
| **Debt-free / years-to-zero projection (H.4)** | A payoff timeline per liability. Needs a per-liability repayment-amount field. *The cost-indicator badge already shipped; "Net Worth if Debt-Free" already exists.* |

### Other proposed
| Idea | Notes |
|---|---|
| **Saved What If scenarios (G.5)** | Name + store up to 3 scenarios in `localStorage`; a dropdown to reload/compare. The sandbox architecture makes this straightforward. |
| **"How much can I save by date X?" — inverse solver (G.6)** | Set a target amount + date → back-solve the required savings/allocation split. *The forward direction already shipped as per-bucket savings goals; this is the reverse.* |
| **FI net-worth forecast chart** | A small line/area chart projecting net worth over time (compound growth from current assets + annual savings). Would make the Savings info copy fully accurate. |
| **Medicare levy + HELP/HECS in the estimate path** | When a salaried source leaves Net/Tax blank, the bracket estimate omits Medicare + HELP/HECS. *Optional — the override path (the real fix) is done; the figure stays labelled an estimate.* |

---

*For the full engineering history, sub-phase notes, and the running update log, see `Implementation-Record.md`.*
