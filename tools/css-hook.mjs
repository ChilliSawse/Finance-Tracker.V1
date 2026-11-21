// Node loader hook: a `.css` import (lazy UI modules import their own styles, P3b) loads as an empty module,
// so the pure test groups can import those modules in Node. Vite handles the real CSS in the browser build.
export async function load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
}
