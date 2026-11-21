// K4 tests (conformance 3.14): the one Import statement button routes by file type to the existing flows.
import { importKind, routeImportFile, IMPORT_ACCEPT } from './route.js';

export const IMPORT_ROUTE_TEST_CASES = [
    {
        name: 'K4.3 import routing: PDF by extension or MIME, CSV and XLSX to the sheet flow',
        fn(assert) {
            assert('pdf by extension', importKind({ name: 'Statement.PDF', type: '' }), 'pdf');
            assert('pdf by MIME', importKind({ name: 'download', type: 'application/pdf' }), 'pdf');
            assert('csv', importKind({ name: 'bank.csv', type: 'text/csv' }), 'sheet');
            assert('csv without type', importKind({ name: 'bank.csv', type: '' }), 'sheet');
            assert('xlsx', importKind({ name: 'bank.xlsx', type: '' }), 'sheet');
            assert('xlsx by MIME', importKind({ name: 'x', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'sheet');
            assert('no file', importKind(null), null);
            assert('csv name that merely mentions pdf', importKind({ name: 'pdf-export.csv', type: 'text/csv' }), 'sheet');
            const seen = [];
            const flows = { pdf: (f) => seen.push(['pdf', f.name]), sheet: (f) => seen.push(['sheet', f.name]) };
            routeImportFile({ name: 'a.pdf', type: 'application/pdf' }, flows);
            routeImportFile({ name: 'b.csv', type: 'text/csv' }, flows);
            routeImportFile({ name: 'c.xlsx', type: '' }, flows);
            assert('each file reaches its flow once', seen, [['pdf', 'a.pdf'], ['sheet', 'b.csv'], ['sheet', 'c.xlsx']]);
            assert('no file routes nowhere', routeImportFile(null, flows), null);
            assert('and calls nothing', seen.length, 3);
        },
    },
    {
        name: 'K4.4 the chooser accepts CSV, XLSX and PDF',
        fn(assert) {
            for (const part of ['.csv', '.xlsx', '.pdf', 'application/pdf']) assert(`accepts ${part}`, IMPORT_ACCEPT.includes(part), true);
        },
    },
];

// Browser only: the PDF module needs the bundler, so it cannot load under Node.
export const IMPORT_ROUTE_BROWSER_TEST_CASES = [
    {
        name: 'K4.5 the payslip reader stays its own path, and the PDF flow can be started from the one button',
        async fn(assert) {
            const pdfUi = await import('./pdf-ui.js');
            assert('readPayslip still exported (income sheet check panel)', typeof pdfUi.readPayslip, 'function');
            assert('startPdfImport exported', typeof pdfUi.startPdfImport, 'function');
            const csvUi = await import('./import-ui.js');
            assert('startCsvImport exported', typeof csvUi.startCsvImport, 'function');
        },
    },
];
