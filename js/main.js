// --- START OF: main.js ---

// --- Global (Module-Scoped) Variables ---
let deferredPrompt = null; // Holds the PWA install prompt event
let installButton = null;  // Holds the reference to our install button

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
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.classList.remove('active');
    });

    const activeContent = getElement(tabName);
    if (activeContent) {
        activeContent.classList.add('active');
    }

    const activeTabButton = document.querySelector(`.tabs .tab[data-tab-target="${tabName}"]`);
    if (activeTabButton) {
        activeTabButton.classList.add('active');
    }

    // Specific actions when a tab is shown
    if (tabName === 'whatIf') {
        initializeWhatIfTab();
    } else if (tabName === 'settings') {
        const totals = calculateTotals();
        setText('total-liabilities-settings', formatCurrency(totals.currentLiabilities));
    } else if (tabName === 'guiSettings') {
        initializeGuiSettingsForm();
    }
}

// --- Update Detection --- 
// --- PWA Update Management ---
function setupPwaUpdateListeners() {
    console.log('🔍 Setting up PWA update listeners...');
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('✅ Service Worker registered:', registration);
                
                // IMPORTANT: Check if there's already a waiting service worker
                if (registration.waiting) {
                    console.log('🎉 Service Worker already waiting! Showing notification immediately.');
                    showUpdateNotification();
                }
                
                // Listen for new service worker installing
                registration.addEventListener('updatefound', () => {
                    console.log('🆕 Update found! New service worker installing...');
                    const newWorker = registration.installing;
                    
                    newWorker.addEventListener('statechange', () => {
                        console.log('🔄 New Service Worker state:', newWorker.state);
                        
                        if (newWorker.state === 'installed') {
                            if (navigator.serviceWorker.controller) {
                                console.log('🎉 NEW VERSION READY! Showing notification...');
                                showUpdateNotification();
                            } else {
                                console.log('📦 First install - content cached for offline use');
                            }
                        }
                    });
                });
                
                // Listen for controlling service worker change
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    console.log('🔄 Controller changed - new service worker took control');
                    // Optionally reload here or show "Update complete" message
                });
                
                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', event => {
                    console.log('📨 Message from Service Worker:', event.data);
                    if (event.data && event.data.type === 'SW_UPDATED') {
                        console.log('✨ Service worker updated to:', event.data.version);
                        showUpdateNotification();
                    }
                });
                
            })
            .catch(error => {
                console.error('❌ Service Worker registration failed:', error);
            });
            
        // Also listen for service worker updates on the global scope
        navigator.serviceWorker.addEventListener('message', event => {
            console.log('📨 Global SW message:', event.data);
            if (event.data && event.data.type === 'SHOW_UPDATE_NOTIFICATION') {
                showUpdateNotification();
            }
        });
            
    } else {
        console.warn('⚠️ Service Workers not supported in this browser');
    }
}

function showUpdateNotification() {
    console.log('🚨 SHOWING UPDATE NOTIFICATION');
    
    // Remove any existing notification
    const existing = document.getElementById('update-notification');
    if (existing) {
        console.log('🗑️ Removing existing notification');
        existing.remove();
    }
    
    // Create update notification
    const updateBanner = document.createElement('div');
    updateBanner.id = 'update-notification';
    updateBanner.innerHTML = `
        <div style="
            position: fixed; 
            top: 0; 
            left: 0; 
            right: 0; 
            background: linear-gradient(135deg, #FF6B35, #F7931E); 
            color: white; 
            padding: 20px; 
            text-align: center; 
            z-index: 99999;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            font-family: var(--font-family-main);
            border-bottom: 3px solid #FF4500;
        ">
            <div style="max-width: 1200px; margin: 0 auto;">
                <div style="font-size: 1.3em; font-weight: bold; margin-bottom: 10px;">
                    🚀 UPDATE AVAILABLE!
                </div>
                <div style="margin-bottom: 15px;">
                    A new version of the app is ready with your latest changes.
                </div>
                <button onclick="applyUpdate()" style="
                    background: white; 
                    color: #FF6B35; 
                    border: none; 
                    padding: 12px 25px; 
                    border-radius: 8px; 
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 1.1em;
                    margin-right: 15px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                ">
                    🔄 UPDATE NOW
                </button>
                <button onclick="dismissUpdateNotification()" style="
                    background: transparent; 
                    color: white; 
                    border: 2px solid white; 
                    padding: 10px 20px; 
                    border-radius: 8px; 
                    cursor: pointer;
                    font-weight: bold;
                ">
                    ⏰ LATER
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(updateBanner);
    console.log('✅ Update notification added to DOM');
    
    // Make it really obvious with a console message
    console.log('🔔🔔🔔 UPDATE NOTIFICATION SHOULD BE VISIBLE NOW! 🔔🔔🔔');
    
    // Auto-dismiss after 45 seconds
    setTimeout(() => {
        console.log('⏰ Auto-dismissing update notification after 45 seconds');
        dismissUpdateNotification();
    }, 45000);
}

function applyUpdate() {
    console.log('🔄 User clicked UPDATE NOW');
    
    const banner = document.getElementById('update-notification');
    if (banner) {
        banner.innerHTML = `
            <div style="
                position: fixed; 
                top: 0; 
                left: 0; 
                right: 0; 
                background: linear-gradient(135deg, #2196F3, #1976D2); 
                color: white; 
                padding: 20px; 
                text-align: center; 
                z-index: 99999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            ">
                <div style="font-size: 1.2em; font-weight: bold;">
                    ⚡ UPDATING... Please wait a moment!
                </div>
            </div>
        `;
    }
    
    // Tell service worker to take control immediately
    if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
    }
    
    // Reload the page
    setTimeout(() => {
        console.log('🔄 Reloading page to apply update...');
        window.location.reload(true); // Hard reload
    }, 1500);
}

function dismissUpdateNotification() {
    console.log('❌ Update notification dismissed');
    const banner = document.getElementById('update-notification');
    if (banner) {
        banner.style.transition = 'transform 0.3s ease-out';
        banner.style.transform = 'translateY(-100%)';
        setTimeout(() => {
            banner.remove();
        }, 300);
    }
}

// Manual function to test notifications (run in console)
function testUpdateNotification() {
    console.log('🧪 Testing update notification manually...');
    showUpdateNotification();
}

// Make test function available globally for debugging
window.testUpdateNotification = testUpdateNotification;

// --- PWA Install Logic ---
function setupPwaInstallListeners() {
    installButton = getElement('install-app-btn'); // Get button *after* DOM is ready

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // Prevent mini-infobar
        console.log('>>> beforeinstallprompt FIRED! <<<'); // Debug log
        deferredPrompt = e; // Stash the event
        if (installButton) {
            console.log('>>> Showing install button <<<'); // Debug log
            installButton.style.display = 'inline-block'; // Show our button!
        } else {
            console.warn('>>> Install button not found! Check ID in HTML. <<<');
        }
    });

    if (installButton) {
        installButton.addEventListener('click', async () => {
            if (!deferredPrompt) {
                console.log('Install prompt not available (already used or not fired).');
                return;
            }

            deferredPrompt.prompt(); // Show the browser's install dialog

            try {
                const { outcome } = await deferredPrompt.userChoice;
                console.log(`User response: ${outcome}`);
                deferredPrompt = null; // It's a one-shot deal
                installButton.style.display = 'none'; // Hide button after use
            } catch (error) {
                console.error('Error handling install prompt:', error);
                deferredPrompt = null;
                installButton.style.display = 'none';
            }
        });
    } else {
        // This might log if getElement fails for any reason
        console.warn("Could not add click listener: Install button not found during setup.");
    }

    window.addEventListener('appinstalled', (evt) => {
        console.log('Finance Tracker was installed.', evt);
        if (installButton) {
            installButton.style.display = 'none';
        }
        deferredPrompt = null;
    });
}

// --- DOMContentLoaded - Main Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded - Initializing App...");
    setupPwaUpdateListeners();
    autoSave = new FinanceAutoSave();
    autoSave.loadData();

    // Initialize UI Elements (needs utils.js, etc.)
    initializeSettingsUI();
    initializeGuiSettingsForm();

    // Setup All Event Listeners (needs events.js)
    setupEventListeners();

    // Listen for data changes and update UI accordingly
    document.addEventListener('dataChanged', () => {
        console.log("📊 Data changed event received - updating all UI components");
        updateAllUI();
    });

    // Setup PWA Listeners (needs utils.js for getElement)
    setupPwaInstallListeners();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    }

    // Initial UI Render
    updateAllUI();
    showTab('dashboard');

    console.log("App Initialized.");
});

// --- END OF: main.js ---