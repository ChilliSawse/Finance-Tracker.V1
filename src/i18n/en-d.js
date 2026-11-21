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
    // Backup import and load safety (S1)
    'd.import.tooBig': 'That file is too large to be a Ledger backup (over 20 MB).',
    'd.import.invalid': 'Invalid backup file: {reason}',
    'd.import.failed': 'Could not import that backup. Nothing was changed.',
    'd.import.confirmTitle': 'Replace all your data?',
    'd.import.confirmBody': 'Importing this file will replace ALL current data (financial and appearance). A safety copy of your current data is kept first.',
    'd.import.confirmLabel': 'Replace data',
    'd.import.done': 'Data imported successfully! Please review all tabs.',
    'd.corrupt.title': 'Your saved data could not be read',
    'd.corrupt.body': 'Ledger started with fresh data. The unreadable copy was kept safely on this device. Export it so you can get help recovering it.',
    'd.corrupt.export': 'Export it',
    'd.recovery.title': 'Ledger could not start',
    'd.recovery.body': 'Something in the saved data stopped Ledger from opening. Your data has not been deleted. Choose what to do.',
    'd.recovery.export': 'Export saved data',
    'd.recovery.import': 'Import a backup',
    'd.recovery.reset': 'Reset Ledger',
    'd.recovery.resetTitle': 'Reset Ledger?',
    'd.recovery.resetBody': 'This clears the saved data on this device. A copy is kept first, and you can still export it later.',
    'd.recovery.nothing': 'There is no saved data to export.',
    'd.recovery.importFailed': 'That backup could not be used: {reason}',
    'd.migrate.aborted': 'Some of your data could not be upgraded to the latest version. Ledger is running on the earlier layout. Your data is safe: export a backup before making changes.',
};
