// Slice d string catalogue. Keys use the prefix "d."; only that slice's steps edit this file.

export const enD = {
    // Sheet
    'd.sheet.save': 'Save',
    'd.sheet.saving': 'Saving...',
    'd.sheet.cancel': 'Cancel',
    'd.sheet.close': 'Close',
    'd.sheet.delete': 'Delete',
    'd.sheet.required': 'Please fill this in.',
    'd.sheet.notNumber': 'Enter a number, like 25 or 25.50.',
    'd.sheet.saveFailed': 'Could not save. Nothing was changed.',
    'd.sheet.fixCount': 'Please check {count} field(s) marked below.',
    // Plausibility notes (quiet, never block Save)
    'd.plaus.weekly': 'That is about {amount} a week. Is that right?',
    'd.plaus.hours': '{hours} hours a week is more than most people work. Is that right?',
    'd.plaus.buckets': 'Your buckets add up to {total}%, not 100%.',
    'd.plaus.fixSmile': 'Put the difference into Smile',
    // Toast
    'd.toast.undo': 'Undo',
    'd.toast.dismiss': 'Dismiss',
    'd.toast.deleted': '{name} deleted',
    // Dialog
    'd.dialog.confirm': 'Confirm',
    'd.dialog.cancel': 'Cancel',

    // Import limits and checks (S3)
    'd.import.fileTooLarge': 'That file is too big to import (the limit is {limit}). Export a shorter date range from your bank.',
    'd.import.csvTooWide': 'That file has too many columns or very long lines, so it does not look like a bank export.',
    'd.import.csvTooManyRows': 'That file has too many rows to import. Export a shorter date range from your bank.',
    'd.import.pdfTooManyPages': 'That PDF has too many pages to read here. Export a shorter date range from your bank.',
    'd.import.outOfRange': '{count} row(s) skipped because the amount was too large to store.',
    'd.import.skippedLines': '{count} line(s) skipped because the date or amount could not be read.',
    'd.import.gross.title': 'Replace your gross income?',
    'd.import.gross.body': 'The payslip suggests {proposed} a year, but this income source has {current}.',
    'd.import.gross.estimated': 'The payslip does not print gross pay, so this figure is estimated from net pay plus tax.',
    'd.import.gross.replace': 'Replace gross',
    'd.import.gross.kept': ' · gross left as it was',
};
