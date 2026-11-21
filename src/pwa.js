// PWA: generated service worker registration + update banner + install prompt.
//
// The old sw.js was manually versioned (bump VERSION or ship stale assets — it
// bit repeatedly). vite-plugin-pwa now generates the worker from the built,
// hashed assets, so every build that changes anything produces a new worker
// automatically. The explicit "Update Now" banner UX is preserved: Workbox
// waits (registerType 'prompt') until the user opts in.

import { t } from './i18n/strings.js';
import { DB_NOTICE_EVENT } from './state/db.js';

let deferredPrompt = null;

// G6W15-7: db.js announces 'ledger:db-notice' when another tab upgraded the database ('reload': this tab runs old code) or
// holds it open during an upgrade ('blocked'). Both reuse the update banner.
export function showDbNotice(kind) {
    if (kind === 'reload') {
        showUpdateNotification(() => window.location.reload(), { title: t('d.db.reloadTitle'), message: t('d.db.reloadBody'), action: t('d.db.reloadAction') });
    } else if (kind === 'blocked') {
        showUpdateNotification(() => {}, { title: t('d.db.blockedTitle'), message: t('d.db.blockedBody'), action: null });
    }
}

export function setupPwaUpdateListeners() {
    document.addEventListener(DB_NOTICE_EVENT, (e) => showDbNotice(e && e.detail && e.detail.kind));
    // 'virtual:pwa-register' only exists when Vite serves/builds the app. GitHub
    // Pages currently serves the raw source (legacy branch mode, no build step),
    // where a STATIC import of it kills the entire module graph — no JS runs at
    // all. Import it dynamically so raw hosting just skips SW setup instead.
    import('virtual:pwa-register')
        .then(({ registerSW }) => {
            const updateSW = registerSW({
                onNeedRefresh() {
                    showUpdateNotification(() => updateSW(true));
                },
                onRegisterError(error) {
                    console.error('Service Worker registration failed:', error);
                },
            });
        })
        .catch(() => { /* raw static hosting — no service worker, app still runs */ });
}

// Exported so the banner can be shown and tested without a real service worker update.
// Every colour comes from the theme tokens through the .update-banner classes in base.css.
// `text` is optional (G6W15-7, the database notices reuse this banner): { title, message, action, later }.
// `action` null leaves out the main button (a notice with nothing to press but Later).
export function showUpdateNotification(onUpdate, text) {
    const tx = Object.assign({ title: 'Update Available', message: 'A new version of the app is ready.', action: 'Update Now', later: 'Later' }, text);
    const existing = document.getElementById('update-notification');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'update-notification';
    banner.className = 'update-banner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');

    const inner = document.createElement('div');
    inner.className = 'update-banner-inner';

    const heading = document.createElement('div');
    heading.className = 'update-banner-title';
    heading.textContent = tx.title;

    const msg = document.createElement('div');
    msg.className = 'update-banner-msg';
    msg.textContent = tx.message;

    const actions = document.createElement('div');
    actions.className = 'update-banner-actions';

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'update-banner-btn primary';
    updateBtn.textContent = tx.action || '';
    updateBtn.addEventListener('click', () => {
        banner.textContent = 'Updating… please wait a moment.';
        banner.classList.add('is-updating');
        onUpdate(); // activates the waiting worker; the page reloads under its control
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'update-banner-btn';
    dismissBtn.textContent = tx.later;
    dismissBtn.addEventListener('click', dismissUpdateNotification);

    if (tx.action) actions.append(updateBtn, dismissBtn); else actions.append(dismissBtn);
    inner.append(heading, msg, actions);
    banner.appendChild(inner);
    document.body.appendChild(banner);

    setTimeout(dismissUpdateNotification, 45000);
}

function dismissUpdateNotification() {
    const banner = document.getElementById('update-notification');
    if (banner) {
        banner.classList.add('is-leaving');
        setTimeout(() => banner.remove(), 300);
    }
}

// --- PWA Install Logic ---
// The Install row lives in Settings, About (D2, FT-R-62). The browser's prompt is held here;
// the screen asks canInstall() and listens for 'ledger:install-availability' to show the row.
export function canInstall() { return deferredPrompt !== null; }

function announceInstall() {
    document.dispatchEvent(new CustomEvent('ledger:install-availability', { detail: { available: canInstall() } }));
}

export async function promptInstall() {
    if (!deferredPrompt) return false;
    const prompt = deferredPrompt;
    deferredPrompt = null; // a prompt can be used once
    announceInstall();
    try {
        prompt.prompt();
        const choice = await prompt.userChoice;
        return !!choice && choice.outcome === 'accepted';
    } catch (error) {
        console.error('Error handling install prompt:', error);
        return false;
    }
}

export function setupPwaInstallListeners() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        announceInstall();
    });
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        announceInstall();
    });
}
