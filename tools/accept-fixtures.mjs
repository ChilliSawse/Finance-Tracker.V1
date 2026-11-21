// D4: synthetic fixtures for the acceptance harness. Fake names, fake descriptions, fake
// numbers; nothing here is real. Works in Node and in the browser (no file system).
//   buildStatementPdf / buildPayslipPdf make tiny single-page text PDFs (Helvetica).

export const FAKE_NAME = 'Jane Q Citizen';
export const FAKE_ACCOUNT = '062000 12345678';

export const CSV_FIXTURE = [
    'Date,Description,Amount,Balance',
    '02/03/2026,WOOLWORTHS 1234 THORNBURY,-45.50,1204.50',
    '03/03/2026,EMPLOYER PTY LTD PAY,1850.00,3054.50',
    '05/03/2026,NETFLIX.COM,-16.99,3037.51',
    '05/04/2026,TRANSFER TO ' + FAKE_NAME + ' ACC ' + FAKE_ACCOUNT + ',-300.00,2737.51',
    '06/04/2026,CAFE ROSSI,-12.40,2725.11',
    '99/99/2026,BROKEN ROW,-9.99,0.00',
].join('\n');

export const XLSX_ROWS = [
    ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
    [{ serial: 46083 }, 'WOOLWORTHS 1234 THORNBURY', '45.50', null, '1204.50'],
    [{ serial: 46084 }, 'EMPLOYER PTY LTD PAY', null, '1850.00', '3054.50'],
    [{ serial: 46086 }, 'TRANSFER TO ' + FAKE_NAME, '300.00', null, '2754.50'],
];

const L = (...cells) => ({ y: 0, items: cells.map(([x, str]) => ({ x, str })), text: cells.map((c) => c[1]).join(' ') });

/** Page lines in extractPagesLines() shape. */
export const STATEMENT_PAGES = [[
    L([50, 'Westpac Banking Corporation Statement 2026']),
    L([50, 'Account holder ' + FAKE_NAME], [330, FAKE_ACCOUNT]),
    L([50, 'DATE'], [130, 'TRANSACTION DESCRIPTION'], [380, 'DEBIT'], [460, 'CREDIT'], [540, 'BALANCE']),
    L([50, '01/03/26'], [130, 'EFTPOS WOOLWORTHS 1234'], [370, '85.32'], [530, '914.68']),
    L([50, '02/03/26'], [130, 'DEPOSIT PAYROLL ACME PTY LTD'], [450, '1,200.00'], [530, '2,114.68']),
    L([50, '03/03/26'], [130, 'EFTPOS CAFE ROSSI'], [370, '12.40'], [530, '2,102.28']),
]];

export const PAYSLIP_LINES = [
    'Xero Payslip ' + FAKE_NAME,
    'Employee account ' + FAKE_ACCOUNT,
    'Pay period fortnightly',
    'Gross pay $3,200.00 $12,800.00',
    'PAYG withholding $640.00 $2,560.00',
    'Net pay $2,560.00 $10,240.00',
    'Superannuation guarantee $368.00',
];

// ---- tiny PDF writer ----
const esc = (s) => String(s).replace(/[\\()]/g, (c) => '\\' + c);

/** @param {Array<Array<[number, string]>>} lines top to bottom; each line is [[x, text], ...] */
export function buildPdf(lines) {
    let y = 780;
    let stream = 'BT /F1 10 Tf\n';
    for (const line of lines) {
        for (const [x, str] of line) stream += `1 0 0 1 ${x} ${y} Tm (${esc(str)}) Tj\n`;
        y -= 16;
    }
    stream += 'ET';
    const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new TextEncoder().encode(out);
}

export const buildStatementPdf = () => buildPdf(STATEMENT_PAGES[0].map((l) => l.items.map((i) => [i.x, i.str])));
export const buildPayslipPdf = () => buildPdf(PAYSLIP_LINES.map((t) => [[50, t]]));
