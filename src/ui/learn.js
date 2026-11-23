// The Quick-add edit toast, plus learn on correct (FT-R-56, DB9). Loaded by dynamic import() after an edit is saved,
// so none of it is in the cold-load core. When the category changed it learns the merchant rule, then offers to
// sort past unconfirmed rows that match. Every toast it shows keeps an Undo for the edit.

import { t } from '../i18n/strings.js';
import { showToast, showUndoToast } from './toast.js';
import { updateTransaction } from '../state/transactions.js';
import { learnFromCorrection, applyLearnedRule } from '../state/rule-learn.js';
import { enLearn } from '../i18n/en-learn.js';

// These strings live in their own on-demand catalogue (cold-load budget), so they are filled in here, not by t().
const L = (key, params) => enLearn[key].replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
// afterChange({ planChanged: true }) also marks the data dirty for autosave: the rules live in financeData.

/**
 * Called once an edit is saved and the screens are refreshed. Shows the toast: the usual "Updated" with Undo, or,
 * when the category changed and the learned rule matches past unconfirmed rows, the offer to sort them (Apply, Undo).
 * Undo always puts the row back and takes the learned rule back. Returns true once a toast is showing.
 * @param {object} data financeData
 * @param {object} prev the row before the edit
 * @param {object} next the saved row
 * @param {Function} afterChange refreshes the screens
 */
export default async function afterEdit(data, prev, next, afterChange) {
    let learned = null;
    try {
        return await show(data, prev, next, afterChange, (l) => { learned = l; });
    } catch (err) { // never an error for the save; a rule learned for an edit that shows no toast is taken back
        console.error('edit toast failed', err);
        if (learned) { learned.onUndo(); try { await afterChange({ planChanged: true }); } catch (_) { /* the rule is already out */ } }
        return false;
    }
}

async function show(data, prev, next, afterChange, remember) {
    const name = next.description || t('a.quickAdd.entryFallback');
    let learned = null;
    try {
        if (next.categoryId !== prev.categoryId) learned = await learnFromCorrection(data, prev, next.categoryId);
        remember(learned);
        if (learned) await afterChange({ planChanged: true });
    } catch (err) { console.error('learn on correct failed', err); if (learned) learned.onUndo(); learned = null; remember(null); }
    const undoEdit = async () => { await updateTransaction(prev); if (learned) learned.onUndo(); await afterChange({ planChanged: !!learned }); };
    if (learned && learned.count) {
        const cat = (data.categories || []).find((c) => c && c.id === next.categoryId);
        showUndoToast({
            message: L('a.quickAdd.learnOffer', { name, count: learned.count }),
            duration: 0, // stays until used or dismissed (WCAG 2.2.1)
            actions: [
                {
                    label: L('a.quickAdd.learnApply'),
                    onAction: async () => {
                        let res;
                        try { res = await applyLearnedRule(learned.rule, data.categories); } catch (err) {
                            console.error('apply failed', err); showToast(t('a.quickAdd.failed'), 'error'); return;
                        }
                        await afterChange();
                        showUndoToast({
                            message: L('a.quickAdd.learnApplied', { count: res.count, category: cat ? cat.name : next.categoryId }),
                            onUndo: async () => {
                                try { await res.undo(); } catch (err) { console.error('undo failed', err); showToast(t('a.quickAdd.failed'), 'error'); return; }
                                await undoEdit();
                            },
                        });
                    },
                },
                { label: t('d.toast.undo'), onAction: undoEdit },
            ],
        });
        return true;
    }
    showUndoToast({ message: t('a.quickAdd.updated', { name }), onUndo: undoEdit });
    return true;
}
