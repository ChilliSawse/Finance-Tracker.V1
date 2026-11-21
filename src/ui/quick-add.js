// Quick-add entry point. A5 stub wired to the sidebar Add button and the phone "+"; A8 replaces
// the body and keeps the signature.

import { t } from '../i18n/strings.js';
import { showToast } from './toast.js';

export function openQuickAdd() {
    showToast(t('a.quickAdd.stub'));
    return false;
}
