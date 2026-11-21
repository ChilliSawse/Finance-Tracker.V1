// Wiring for the single Import statement button on Activity: a native file chooser (CSV, XLSX, PDF),
// then route.js picks the existing flow. Kept apart from route.js so the routing stays pure and testable.

import { startCsvImport } from './import-ui.js';
import { startPdfImport } from './pdf-ui.js';
import { IMPORT_ACCEPT, routeImportFile } from './route.js';

export function setupImportEntry() {
    const btn = document.getElementById('open-import');
    const input = document.getElementById('import-pick');
    if (!btn || !input) return;
    input.accept = IMPORT_ACCEPT;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.value = '';
        routeImportFile(file, { pdf: startPdfImport, sheet: startCsvImport });
    });
}
