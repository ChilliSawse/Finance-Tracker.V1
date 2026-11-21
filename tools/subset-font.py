"""Rebuild public/fonts/Manrope-Variable.woff2 as a Latin subset (step P3d, cause C4).

Needs fontTools + brotli:  python -m venv v && v/Scripts/python -m pip install fonttools brotli
Run from the repo root:    v/Scripts/python tools/subset-font.py [path/to/full/Manrope-Variable.ttf|woff2]

The full upstream font (OFL 1.1, wght 200-800) is not kept in the repo; pass it as the argument,
or recover it from git history (commit before P3d: `git show 5f3ab77:public/fonts/Manrope-Variable.woff2`).
The wght axis is kept whole. Characters outside the list fall back to system-ui (see src/styles/fonts.css).
"""
import subprocess
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "Manrope-Variable.full.woff2"
OUT = "public/fonts/Manrope-Variable.woff2"

UNICODES = ",".join([
    "U+0020-007E",   # Basic Latin
    "U+00A0-00FF",   # Latin-1 Supplement (nbsp, pound, yen, middle dot, multiplication sign)
    "U+0100-017F",   # Latin Extended-A
    "U+2009",        # thin space
    "U+200A",        # hair space
    "U+202F",        # narrow no-break space
    "U+2007-2008",   # figure / punctuation space
    "U+2010-2015",   # hyphens and dashes
    "U+2018-201F",   # curly quotes
    "U+2022",        # bullet
    "U+2026",        # ellipsis
    "U+2030",        # per mille
    "U+2039-203A",   # single angle quotes
    "U+20A0-20BF",   # currency symbols (euro, rupee, ...)
    "U+2190-2193",   # arrows left, up, right, down
    "U+2212",        # minus sign
    "U+2248",        # approximately equal
    "U+2264-2265",   # less/greater or equal
    "U+2713,U+2717", # check and cross marks (not in Manrope; listed so a future font gains them)
])

FEATURES = "kern,tnum,pnum,lnum,onum,liga,calt,case,locl,frac,ccmp,mark,mkmk"

cmd = [
    sys.executable, "-m", "fontTools.subset", SRC,
    "--unicodes=" + UNICODES,
    "--layout-features=" + FEATURES,
    "--flavor=woff2",
    "--output-file=" + OUT,
    "--no-hinting",
    "--desubroutinize",
]
print(" ".join(cmd))
subprocess.run(cmd, check=True)
