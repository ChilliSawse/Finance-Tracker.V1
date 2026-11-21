# P3d Manrope font subset (cold-load cause C4)

- `public/fonts/Manrope-Variable.woff2` shrunk from 53,652 bytes to 29,716 bytes (about 44 percent less).
  Subset to Basic Latin, Latin-1, Latin Extended-A, general punctuation (dashes, curly quotes, bullet,
  ellipsis, angle quotes), spaces (thin, hair, narrow no-break, figure), currency symbols (U+20A0-20BF, so
  euro and rupee), arrows U+2190-2193, minus U+2212, and the maths signs the app prints. The `wght` axis is kept
  whole (200-800). Layout features kept: kern, tnum, pnum, liga, calt, case, locl, frac. `OFL.txt` stays.
- `tools/subset-font.py` records the exact fontTools command and the unicode list so the subset can be rebuilt
  (needs fonttools + brotli in a venv; the full upstream font is passed as the argument).
- `src/styles/fonts.css`: added a matching `unicode-range`, so characters outside the subset use system-ui.
- Every non-ASCII character in `src/`, `index.html` and `style.css` was listed. All of them that Manrope ever had
  are kept. U+24D8, U+2500, U+25B2, U+25BC (and the check mark U+2713) are not in Manrope itself, so they already
  came from system-ui and still do.
- Checked: Today, Plan and a sheet at 390 and 1440, plus a 400/500/700 glyph strip, before and after:
  at most 117 pixels differ per screenshot, largest channel difference 17 of 255 (anti-aliasing noise).
- Tests: no font tests existed and none were added (nothing in the code reads the font). run-cases 2887/0, tests.html 3347/3347.
