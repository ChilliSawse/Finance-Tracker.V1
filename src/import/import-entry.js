// Wiring for the single Import statement button on Activity: a native file chooser (CSV, XLSX, PDF),
// then route.js picks the existing flow. The flows themselves (import-ui.js, pdf-ui.js) load and wire on the first
// file chosen (P3b), so the file chooser still opens straight from the click. Kept apart from route.js so the routing stays pure and testable.

import { ensureImport } from '../lazy-setup.js';
import { IMPORT_ACCEPT, routeImportFile } from './route.js';

export function setupImportEntry() {
    const btn = document.getElementById('open-import');
    const input = document.getElementById('import-pick');
    if (!btn || !input) return;
    input.accept = IMPORT_ACCEPT;
    btn.addEventListener('click', () => {
        input.click();
        // Start loading the flows while the chooser is open (first click only does work; later ones return the same promise).
        ensureImport().catch((err) => console.error('Import could not be loaded', err));
    });
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        try {
            const [csv, pdf] = await ensureImport();
            routeImportFile(file, { pdf: pdf.startPdfImport, sheet: csv.startCsvImport });
        } catch (err) {
            console.error('Import could not be loaded', err);
        }
    });
}
