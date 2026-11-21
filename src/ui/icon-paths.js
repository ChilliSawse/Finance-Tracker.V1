// 16x16 stroke icon paths shared by Quick-add, the Plan category list and the category sheet (FT-R-39).
// A category stores only the icon NAME; an unknown name falls back to "tag" (categoryIcon in state/categories.js).

export const ICON_PATHS = {
    cart: 'M2 3h2l1.5 7h6.5l1.5-5H5M6.5 13.2v.1M11.5 13.2v.1',
    home: 'M2.5 8L8 3l5.5 5M4 7v6h8V7',
    bolt: 'M9 2L4 9h3.5L7 14l5-7H8.5z',
    phone: 'M5 2.5h6v11H5zM7.5 12h1',
    car: 'M3 10V8l1.5-3.5h7L13 8v2zM3 10v2.5M13 10v2.5M5 8.5h.1M11 8.5h.1',
    heart: 'M8 13.5S2.5 10 2.5 6.3A2.8 2.8 0 0 1 8 5a2.8 2.8 0 0 1 5.5 1.3C13.5 10 8 13.5 8 13.5z',
    shield: 'M8 2.5l5 2v4c0 2.5-2 4.3-5 5.5-3-1.2-5-3-5-5.5v-4z',
    utensils: 'M5 2.5v4M3.5 2.5v3a1.5 1.5 0 0 0 3 0v-3M5 8v5.5M11 13.5v-11c-1.5 1-2 3-2 5h2',
    film: 'M2.5 3.5h11v9h-11zM5.5 3.5v9M10.5 3.5v9M2.5 8h3M10.5 8h3',
    repeat: 'M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2',
    dumbbell: 'M2.5 6v4M4.5 4.5v7M11.5 4.5v7M13.5 6v4M4.5 8h7',
    bag: 'M3.5 5.5h9l-.8 8H4.3zM5.5 5.5V4.5a2.5 2.5 0 0 1 5 0v1',
    plane: 'M2 9l12-5-3 9-3-3.5L6 13l.5-3.5z',
    wallet: 'M2.5 4.5h10a1 1 0 0 1 1 1v7h-11zM2.5 4.5V4l9-1.5V4.5M10.5 9h1.5',
    dots: 'M4 8h.1M8 8h.1M12 8h.1',
    tag: 'M2.5 8.5V3h5.5l5.5 5.5-5.5 5.5zM5.5 5.5h.1',
    close: 'M4 4l8 8M12 4l-8 8',
    info: 'M8 7.2v3.6M8 5.2v.1M2.5 8a5.5 5.5 0 1 0 11 0 5.5 5.5 0 1 0-11 0',
};

/** Icons a person can pick for a category (the two UI icons, close and info, are not offered). */
export const CATEGORY_ICON_NAMES = Object.keys(ICON_PATHS).filter((n) => n !== 'close' && n !== 'info');

/** Inline <svg> markup for an icon name (the name is looked up, never printed). */
export function iconSvgHtml(name) {
    const d = ICON_PATHS[name] || ICON_PATHS.tag;
    return `<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
}
