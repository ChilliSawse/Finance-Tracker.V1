// Slice c string catalogue. Keys use the prefix "c."; only that slice's steps edit this file.

export const enC = {
    // Payslip check (C5)
    'c.payslip.truth': 'This payslip is from before the tax tables Ledger checks against, so the payslip is the truth for this pay.',
    'c.payslip.cause.help': 'The A${amount} difference is about what HELP takes on your pay.',
    'c.payslip.cause.noHelp': 'Your payslip is about A${amount} lower than expected, which is what HELP would take. Is HELP actually being withheld?',
    'c.payslip.cause.tftOn': 'Your payslip looks like the tax-free threshold is claimed. The A${amount} difference is the threshold.',
    'c.payslip.cause.tftOff': 'Your payslip looks like the tax-free threshold is not claimed. The A${amount} difference is the threshold.',
    'c.payslip.cause.sacrifice': 'The payslip tax fits about A${amount} of salary sacrifice this pay.',
    'c.payslip.cause.medicare': 'The payslip is about A${amount} lower, which is what the Medicare levy would take. Do you have a Medicare exemption?',
    'c.payslip.cause.overtime': 'Your payslip gross is A${amount} higher than usual. Overtime, allowances or penalties this pay?',
    'c.payslip.cause.extra': 'The payslip withholds A${amount} more than expected. Extra withholding?',
    'c.payslip.unexplained': 'A${amount} a pay unexplained. Ledger uses the payslip figures and keeps your gross.',
    'c.payslip.fix.help': 'I have a HELP debt',
    'c.payslip.fix.noHelp': 'I do not have a HELP debt',
    'c.payslip.fix.tft': 'Change the tax-free threshold setting',
    'c.payslip.fix.sacrifice': 'Add salary sacrifice',
    'c.payslip.fix.medicare': 'I have a Medicare exemption',
    'c.payslip.fix.overtime': 'Use the payslip gross for this pay',
    'c.payslip.fix.extra': 'Set extra withholding per pay',
};
