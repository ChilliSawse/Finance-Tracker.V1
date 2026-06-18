// --- START OF: main.js ---

// --- Global (Module-Scoped) Variables ---
let deferredPrompt = null;
let installButton = null;

const DEBUG = false;
const log = (...args) => DEBUG && console.log(...args);

// --- Core UI Functions ---
function updateAllUI() {
    const totals = calculateTotals(financeData);
    updateDashboardUI(totals);
    updateIncomeTabUI(totals);
    updateExpensesTabUI(totals);
    updateSavingsTabUI(totals);
    updateLiabilitiesTabUI(totals);
    setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('[role="tablist"] .tab').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
    });

    const activeContent = getElement(tabName);
    if (activeContent) activeContent.classList.add('active');

    const activeTabButton = document.querySelector(`[role="tablist"] .tab[data-tab-target="${tabName}"]`);
    if (activeTabButton) {
        activeTabButton.classList.add('active');
        activeTabButton.setAttribute('aria-selected', 'true');
        activeTabButton.setAttribute('tabindex', '0');
    }

    if (tabName === 'whatIf') {
        initializeWhatIfTab();
    } else if (tabName === 'settings') {
        const totals = calculateTotals();
        setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
    } else if (tabName === 'guiSettings') {
        initializeGuiSettingsForm();
    }
}

function setupTabKeyboardNav() {
    const tabList = document.querySelector('[role="tablist"]');
    if (!tabList) return;
    tabList.addEventListener('keydown', (e) => {
        const tabs = Array.from(tabList.querySelectorAll('.tab'));
        const current = tabs.indexOf(document.activeElement);
        if (current === -1) return;

        let next = -1;
        if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;

        if (next !== -1) {
            e.preventDefault();
            tabs[next].focus();
            showTab(tabs[next].dataset.tabTarget);
        }
    });
}

// --- Update Detection --- 
// --- PWA Update Management ---
function setupPwaUpdateListeners() {
    log('Setting up PWA update listeners...');
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                log('Service Worker registered:', registration.scope);
                
                if (registration.waiting) {
                    showUpdateNotification();
                }

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateNotification();
                        }
                    });
                });

                navigator.serviceWorker.addEventListener('message', event => {
                    if (event.data && event.data.type === 'SW_UPDATED') {
                        showUpdateNotification();
                    }
                });
                
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });

        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'SHOW_UPDATE_NOTIFICATION') {
                showUpdateNotification();
            }
        });

    } else {
        log('Service Workers not supported in this browser');
    }
}

function showUpdateNotification() {
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
    updateBtn.addEventListener('click', applyUpdate);

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

function applyUpdate() {
    const banner = document.getElementById('update-notification');
    if (banner) {
        banner.textContent = 'Updating… please wait a moment.';
        banner.style.background = 'linear-gradient(135deg, #2196F3, #1976D2)';
    }
    if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
    }
    setTimeout(() => window.location.reload(true), 1500);
}

function dismissUpdateNotification() {
    const banner = document.getElementById('update-notification');
    if (banner) {
        banner.style.transition = 'transform 0.3s ease-out';
        banner.style.transform = 'translateY(-100%)';
        setTimeout(() => banner.remove(), 300);
    }
}

window.testUpdateNotification = showUpdateNotification;

// --- PWA Install Logic ---
function setupPwaInstallListeners() {
    installButton = getElement('install-app-btn'); // Get button *after* DOM is ready

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

// --- DOMContentLoaded - Main Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
    setupPwaUpdateListeners();
    autoSave = new FinanceAutoSave();
    autoSave.loadData();
    loadTheme(); // apply full preset (tab colours, tints, etc.) before UI renders

    initializeSettingsUI();
    initializeGuiSettingsForm();
    setupEventListeners();

    document.addEventListener('dataChanged', () => updateAllUI());

    setupPwaInstallListeners();
    setupTabKeyboardNav();

    updateAllUI();
    showTab('dashboard');
});

// --- END OF: main.js ---