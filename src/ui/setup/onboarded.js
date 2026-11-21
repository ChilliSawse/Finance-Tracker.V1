// The one-time "has been through setup" flag (`ft-onboarded`). Kept apart from onboarding.js so main.js can
// decide at boot whether a first run needs Setup without loading the whole Setup module (P3b).

const ONBOARDED_KEY = 'ft-onboarded';

export function markOnboarded() {
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch (e) { return false; }
    return true;
}

export function alreadyOnboarded() {
    try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch (e) { return false; }
}
