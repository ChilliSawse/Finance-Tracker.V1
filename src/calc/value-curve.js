// Value curves for things that lose value (FT-0032 DB10, R3 section 5.3, FT-R-114: market value loss).
// Pure and tiny: the asset maths imports it, so it stays out of anything big.
//
// A curve is a list of points `{year, pct}` (year 0 = 100). Between the listed years the value is a straight line;
// after the last listed year the last value is held (the curve says nothing beyond it, and that is not guessed at).
// A powertrain factor is a list `{year, factor}`: year 0 = 1, straight lines between the listed years, the last
// factor held after that (the year-10 factor for the cars).

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Straight-line value of `list` (sorted by year) at `years`, from `start` at year 0; the last value is held. */
function along(list, key, start, years) {
    const t = Math.max(0, isNum(years) ? years : 0);
    let prev = { year: 0, v: start };
    for (const p of list) {
        if (!isNum(p.year) || !isNum(p[key])) continue;
        if (p.year <= 0) { prev = { year: 0, v: p[key] }; continue; }
        if (t <= p.year) return prev.v + ((p[key] - prev.v) * (t - prev.year)) / (p.year - prev.year);
        prev = { year: p.year, v: p[key] };
    }
    return prev.v;
}

/** The curve's percent at `years` of age (100 at year 0), or null when the curve has no usable points. */
export function curvePct(points, years) {
    if (!Array.isArray(points) || !points.some((p) => p && isNum(p.pct))) return null;
    return along(points, 'pct', 100, years);
}

/** The powertrain factor at `years` (1 at year 0, last listed factor held), 1 when there is no list. */
export function factorAt(factors, years) {
    if (!Array.isArray(factors) || !factors.length) return 1;
    return along(factors, 'factor', 1, years);
}

/** `{points, factors}` value as a fraction of the price at `years` of age, or null with no curve. */
export function curveFraction(curve, years) {
    if (!curve) return null;
    const pct = curvePct(curve.points, years);
    return pct === null ? null : (pct / 100) * factorAt(curve.factors, years);
}

/** True when `years` is past the last listed point (the value is being held, not read). */
export function beyondCurve(curve, years) {
    const pts = curve && Array.isArray(curve.points) ? curve.points.filter((p) => p && isNum(p.year)) : [];
    return pts.length > 0 && years > Math.max(...pts.map((p) => p.year));
}
