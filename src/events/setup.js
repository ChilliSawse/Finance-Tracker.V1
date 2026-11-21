// Top-level event wiring (from events.js setupEventListeners).

import { store } from '../state/store.js';
import { getElement } from '../utils.js';
import { showTab } from '../ui/tabs.js';
import { updateDataAndUI } from '../ui/render.js';
import { openQuickAdd } from '../ui/quick-add.js';
import { openSettings } from '../ui/settings-screen.js';

export function setupEventListeners() {
    // Tab navigation. iOS Safari silently drops the synthetic `click` when a
    // tap wobbles a few pixels (reclassified as a scroll) or lands mid
    // double-tap heuristics — on the bottom bar that read as "tabs randomly
    // need two taps". So touch/pen taps activate on pointerup with a small
    // movement/time guard; `click` stays as the mouse/keyboard path and is
    // deduped by timestamp (showTab is idempotent, so a rare double-fire is
    // harmless anyway).
    const tabsContainer = document.querySelector('[role="tablist"]');
    if (tabsContainer) {
        let downX = 0, downY = 0, downTime = 0, pointerTapAt = 0;
        tabsContainer.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            downX = e.clientX; downY = e.clientY; downTime = e.timeStamp;
        });
        tabsContainer.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'mouse') return;
            const tab = e.target.closest('[role="tab"]');
            if (!tab || !tab.dataset.tabTarget) return;
            // Real taps barely move and don't linger; anything else is a
            // scroll/press — leave those to their native behaviour.
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
            if (e.timeStamp - downTime > 700) return;
            pointerTapAt = performance.now();
            showTab(tab.dataset.tabTarget);
        });
        tabsContainer.addEventListener('click', (event) => {
            const tab = event.target.closest('[role="tab"]');
            if (tab) {
                if (performance.now() - pointerTapAt < 400) return; // pointerup already handled this tap
                const tabName = tab.dataset.tabTarget;
                if (tabName) showTab(tabName);
            }
        });
    }

    // Quick add (sidebar Add, phone +) and the phone Settings gear: delegated, so the single nav and
    // the topbar carry no per-element listeners. Settings opens the Settings screen (D2).
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-quick-add]')) { event.preventDefault(); openQuickAdd(); return; }
        if (event.target.closest('[data-open-settings]')) openSettings();
    });

    // Dashboard view period change
    const dashboardViewPeriodSelect = getElement('dashboard-view-period');
    if (dashboardViewPeriodSelect) {
        dashboardViewPeriodSelect.addEventListener('change', (event) => {
            store.financeData.dashboardViewPeriod = event.target.value;
            updateDataAndUI();
        });
    }

}
