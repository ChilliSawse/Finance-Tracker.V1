// "Open the Check card" from the Future screen and What If (DB12): the card lives at the top of the Plan screen, so go there
// and bring it into view. The card is drawn when the Plan tab shows; if it is not there yet (a tab that has not drawn), the
// first draw is awaited a moment before giving up. Nothing here changes data.

import { showTab } from './tabs.js';

export async function showCheckCard() {
    await showTab('plan');
    const find = () => document.getElementById('plan-check');
    for (let i = 0; i < 10 && !find(); i += 1) await new Promise((r) => setTimeout(r, 50));
    const card = find();
    if (!card) return false;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    const heading = document.getElementById('p-check-h'); // the card's heading (tabindex -1): a screen reader starts at the card
    if (heading) heading.focus({ preventScroll: true });
    return true;
}
