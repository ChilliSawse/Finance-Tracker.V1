// Slice d string catalogue, part 2 (DB7): the Settings rows for the shared sorting rules. Kept out of en-d.js because that file ships in the
// first-load chunk and these strings are only read once Settings opens. settings-model.js merges them into the catalogue on import.

export const enDRef = {
    'd.settings.licence.value': 'Ledger will be free and open source (AGPL-3.0) at its public launch.',
    'd.settings.privacy.detail': 'Ledger keeps your figures on this device. There is no account and none of your data is sent anywhere. It only downloads shared sorting rules, which you can turn off under Your data. Backups are files you keep yourself.',
    'd.settings.refCheck': 'Check for updated rules',
    'd.settings.refCheck.hint': 'Ledger downloads shared sorting rules from its own site. It sends nothing about you and makes no request with your data.',
    'd.settings.refCheck.on': 'On',
    'd.settings.refCheck.off': 'Off',
    'd.settings.refVersion': 'Rules version',
    'd.settings.refVersion.builtIn': 'built-in',
    'd.settings.refBack': 'Go back to the earlier rules',
    'd.settings.refBack.value': 'Use the previous set',
    'd.settings.refBack.done': 'Went back to rules {version}.',
    'd.settings.refBack.none': 'There are no earlier rules to go back to.',
    'd.settings.refReset': 'Use reference rules only',
    'd.settings.refReset.value': 'Clear your changes to them',
    'd.settings.refReset.title': 'Use reference rules only?',
    'd.settings.refReset.body': 'This clears the changes you made to the shared sorting rules. Your own rules, keywords and categories stay as they are.',
    'd.settings.refReset.confirm': 'Clear my changes',
    'd.settings.refReset.done': 'Your changes to the shared rules were cleared.',
    'd.settings.refReset.none': 'You have not changed any of the shared rules.',
};
