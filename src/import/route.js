// One "Import statement" button on Activity (mock activity.html). It opens a native file chooser that
// takes CSV, XLSX and PDF, then sends the file to the existing flow for its type: PDF goes to the
// bank-statement PDF reader (pdf-ui.js), everything else to the CSV / Excel flow (import-ui.js).
// Neither parser changed. Payslip PDFs never come through here: the income sheet's check panel
// calls readPayslip() in pdf-ui.js directly.

export const IMPORT_ACCEPT = '.csv,text/csv,text/plain,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf';

/** 'pdf' when the name or MIME type says PDF, otherwise 'sheet' (CSV, XLSX, or anything the CSV flow will judge). */
export function importKind(file) {
    if (!file) return null;
    const name = String(file.name || '');
    const type = String(file.type || '').toLowerCase();
    if (/\.pdf$/i.test(name) || type === 'application/pdf') return 'pdf';
    return 'sheet';
}

/** Sends the file to flows.pdf or flows.sheet by its type; returns the kind (null when there is no file). */
export function routeImportFile(file, flows) {
    const kind = importKind(file);
    if (kind === 'pdf') flows.pdf(file);
    else if (kind === 'sheet') flows.sheet(file);
    return kind;
}
