// Inline-SVG sparkline — the small trend mark inside stat tiles.
//
// Dataviz rules applied: single series (no legend — the tile names it), thin
// 2px line, no grid/axes at sparkline scale, an end-point dot ≥3px, colour from
// a theme token (identity), never from the value's direction — the delta chip
// beside the number carries good/bad. Decorative for screen readers: the tile's
// number IS the value, so the SVG is aria-hidden.

/**
 * Build a sparkline SVG string.
 * @param {number[]} values - series, oldest → newest. Needs ≥ 2 points.
 * @param {{width?:number, height?:number, stroke?:string}} [opts]
 *   stroke: CSS colour (defaults to the neutral token via currentColor styling).
 * @returns {string} SVG markup, or '' when there aren't enough points.
 */
export function sparklineSvg(values, opts = {}) {
    const width = opts.width || 120;
    const height = opts.height || 32;
    const pad = 3; // room for the line cap + end dot at the extremes
    if (!Array.isArray(values) || values.length < 2) return '';

    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max === min) { max += 1; min -= 1; } // flat series → centred line

    const x = (i) => pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = (v) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2);

    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const lineD = 'M' + points.join(' L');
    // Soft area fill under the line, closed to the bottom edge.
    const areaD = `${lineD} L${x(values.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
    const lastX = x(values.length - 1).toFixed(1);
    const lastY = y(values[values.length - 1]).toFixed(1);

    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">` +
        `<path class="sparkline-area" d="${areaD}"></path>` +
        `<path class="sparkline-line" d="${lineD}"></path>` +
        `<circle class="sparkline-dot" cx="${lastX}" cy="${lastY}" r="3"></circle>` +
        `</svg>`;
}
