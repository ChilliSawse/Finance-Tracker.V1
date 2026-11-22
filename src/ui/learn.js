// The Quick-add edit toast, plus learn on correct (FT-R-56, DB9). Loaded by dynamic import() after an edit is saved,
// so none of it is in the cold-load core. When the category changed it learns the merchant rule, then offers to
// sort past unconfirmed rows that match.

import { t } from '../i18n/strings.js';
import { store } from '../state/store.js';
import { showUndoToast } from './toast.js';
import { updateTransaction } from '../state/transactions.js';
import { learnFromCorrection, applyLearnedRule } from '../state/rule-learn.js';
import { enLearn } from '../i18n/en-learn.js';

// These strings live in their own on-demand catalogue (cold-load budget), so they are filled in here, not by t().
const L = (key, params) => enLearn[key].replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
const dirty = () => { if (store.autoSave) store.autoSave.onDataChange(); };

/**
 * Called once an edit is saved and the screens are refreshed. Shows the toast: the usual "Updated" with Undo, or,
 * when the category changed and the learned rule matches past unconfirmed rows, the offer to sort them (Apply).
 * @param {object} data financeData
 * @param {object} prev the row before the edit
 * @param {object} next the saved row
 * @param {Function} afterChange refreshes the screens
 */
export default async function afterEdit(data, prev, next, afterChange) {
    const name = next.description || t('a.quickAdd.entryFallback');
    let learned = null;
    try {
        if (next.categoryId !== prev.categoryId) learned = await learnFromCorrection(data, prev, next.categoryId);
        if (learned) dirty();
    } catch (err) { console.error('learn on correct failed', err); learned = null; }
    if (learned && learned.count) {
        const cat = (data.categories || []).find((c) => c && c.id === next.categoryId);
        showUndoToast({
            message: L('a.quickAdd.learnOffer', { name, count: learned.count }),
            actionLabel: L('a.quickAdd.learnApply'),
            duration: 10000,
            onUndo: async () => {
                const res = await applyLearnedRule(learned.rule);
                await afterChange();
                showUndoToast({
                    message: L('a.quickAdd.learnApplied', { count: res.count, category: cat ? cat.name : next.categoryId }),
                    onUndo: async () => { await res.undo(); await afterChange(); },
                });
            },
        });
        return;
    }
    showUndoToast({
        message: t('a.quickAdd.updated', { name }),
        onUndo: async () => { await updateTransaction(prev); if (learned) { learned.onUndo(); dirty(); } await afterChange(); },
    });
}
