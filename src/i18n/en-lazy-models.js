// Strings read only by the saving-model picker (Plan "Change" and the setup model step), FT-0032 DB15.
// This module registers them in the catalogue when it loads; ui/model-picker.js and the setup model step import it first.

import { en } from './en.js';

Object.assign(en, {
    'm.pick.title': 'Saving model',
    'm.pick.choose': 'Choose a model',
    'm.pick.useName': 'Use {name}',
    'm.pick.current': 'In use now',
    'm.pick.needsNewer': 'Needs a newer Ledger',
    'm.pick.updateAvailable': 'Updated version available',
    'm.pick.replaces': 'Would replace your buckets. Not available here yet.',
    'm.pick.switchBack': 'Switch back to {name}',
    'm.pick.own': 'Make this your own template',
    'm.pick.ownYes': 'Make it mine',
    'm.pick.bucketBlurb': 'Daily expenses first, then a share to Splurge, Smile and a Fire extinguisher.',
    'm.pick.replaceTitle': 'Replace your buckets with {name}?',
    'm.pick.replaceBody': 'Your bucket names, split, bank labels and ticks go. Undo puts them back.',
    'm.pick.replaceYes': 'Replace them',
    'm.pick.failed': 'That model could not be used.',
    'm.pick.used': 'Now using {name}.',
    'm.pick.unavailable': 'That model could not be loaded. Try again when you are online.',
});
