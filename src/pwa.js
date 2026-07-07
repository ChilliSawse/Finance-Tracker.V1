// PWA: generated service worker registration + update banner + install prompt.
//
// The old sw.js was manually versioned (bump VERSION or ship stale assets — it
// bit repeatedly). vite-plugin-pwa now generates the worker from the built,
// hashed assets, so every build that changes anything produces a new worker
// automatically. The explicit "Update Now" banner UX is preserved: Workbox
// waits (registerType 'prompt') until the user opts in.

import { registerSW } from 'virtual:pwa-register';

let deferredPrompt = null;
let installButton = null;

export function setupPwaUpdateListeners() {
    const updateSW = registerSW({
        onNeedRefresh() {
            showUpdateNotification(() => updateSW(true));
        },
        onRegisterError(error) {
            console.error('Service Worker registration failed:', error);
        },
    });
}

function showUpdateNotification(onUpdate) {
    const existing = document.getElementById('update-notification');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'update-notification';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#FF6B35,#F7931E);color:white;padding:20px;text-align:center;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.5);font-family:var(--font-family-main);border-bottom:3px solid #FF4500;';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');

    const inner = document.createElement('div');
    inner.style.cssText = 'max-width:1200px;margin:0 auto;';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:1.3em;font-weight:bold;margin-bottom:10px;';
    heading.textContent = 'Update Available';

    const msg = document.createElement('div');
    msg.style.cssText = 'margin-bottom:15px;';
    msg.textContent = 'A new version of the app is ready.';

    const updateBtn = document.createElement('button');
    updateBtn.textContent = 'Update Now';
    updateBtn.style.cssText = 'background:white;color:#FF6B35;border:none;padding:12px 25px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:1.1em;margin-right:15px;box-shadow:0 2px 10px rgba(0,0,0,0.2);';
    updateBtn.addEventListener('click', () => {
        banner.textContent = 'Updating… please wait a moment.';
        banner.style.background = 'linear-gradient(135deg, #2196F3, #1976D2)';
        onUpdate(); // activates the waiting worker; the page reloads under its control
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Later';
    dismissBtn.style.cssText = 'background:transparent;color:white;border:2px solid white;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;';
    dismissBtn.addEventListener('click', dismissUpdateNotification);

    inner.appendChild(heading);
    inner.appendChild(msg);
    inner.appendChild(updateBtn);
    inner.appendChild(dismissBtn);
    banner.appendChild(inner);
    document.body.appendChild(banner);

    setTimeout(dismissUpdateNotification, 45000);
}

function dismissUpdateNotification() {
    const banner = document.getElementById('update-notification');
    if (banner) {
        banner.style.transition = 'transform 0.3s ease-out';
        banner.style.transform = 'translateY(-100%)';
        setTimeout(() => banner.remove(), 300);
    }
}

// --- PWA Install Logic ---
export function setupPwaInstallListeners() {
    installButton = document.getElementById('install-app-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installButton) installButton.style.display = 'inline-block';
    });

    if (installButton) {
        installButton.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            try {
                await deferredPrompt.userChoice;
            } catch (error) {
                console.error('Error handling install prompt:', error);
            } finally {
                deferredPrompt = null;
                installButton.style.display = 'none';
            }
        });
    }

    window.addEventListener('appinstalled', () => {
        if (installButton) installButton.style.display = 'none';
        deferredPrompt = null;
    });
}
