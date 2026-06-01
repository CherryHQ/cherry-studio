/**
 * BranchPane width constants — drag-controlled, clamped here so the hook and
 * the component agree without prop drilling. Defaults chosen to match the
 * previous fixed `w-[420px]` and leave the main column readable on a 1280-wide
 * viewport even at max width.
 */
export const BRANCH_PANE_DEFAULT_WIDTH = 420
export const BRANCH_PANE_MIN_WIDTH = 280
export const BRANCH_PANE_MAX_WIDTH = 700

/**
 * Branch highlight color palette keys (P1-S2a).
 *
 * Each key maps to a CSS custom property defined in `sourceHighlight.ts`'s
 * `ensureHighlightStyle()`-injected `<style>` block (`--branch-hl-c1` etc.).
 * The injected span carries `data-hl="cN"` and a CSS selector
 * `span.branch-anchor-highlight[data-hl="cN"]` paints it with the matching
 * variable, so swapping colors is a CSS-only concern.
 *
 * S2a always assigns `c1` (the legacy amber) to every new branch — distinct-
 * color cycling for multiple branches lands in S2b, once the UI can create
 * more than one branch.
 *
 * The 6-color palette is the design budget for visually distinguishable
 * concurrent highlights on a typical chat body; beyond 6 we'd wrap or
 * fall back to a generic tag.
 */
export const BRANCH_HL_COLOR_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] as const
export type BranchHlColorKey = (typeof BRANCH_HL_COLOR_KEYS)[number]
export const BRANCH_HL_DEFAULT_COLOR: BranchHlColorKey = 'c1'

/**
 * Concrete rgba values for each palette key (P1-S2b-1). Kept here so
 * non-sourceHighlight consumers (BranchCard's tab header) can paint a
 * matching tint without depending on `ensureHighlightStyle` having injected
 * its `<style>` block yet.
 *
 * DRY caveat: `sourceHighlight.ts`'s `ensureHighlightStyle` hardcodes the
 * same literals to build the `--branch-hl-cN` CSS variables — the two MUST
 * agree visually. P1-S2b-1 is forbidden from editing sourceHighlight.ts
 * (frozen after S2a's mutation discipline), so we accept the duplication.
 * A future cleanup that's allowed to touch sourceHighlight.ts can refactor
 * to import this Record.
 */
export const BRANCH_HL_COLOR_VALUES: Record<BranchHlColorKey, string> = {
  c1: 'rgb(251 191 36 / 0.45)', // amber-400 — legacy default
  c2: 'rgb(56 189 248 / 0.45)', // sky-400
  c3: 'rgb(167 139 250 / 0.45)', // violet-400
  c4: 'rgb(244 114 182 / 0.45)', // pink-400
  c5: 'rgb(74 222 128 / 0.45)', // green-400
  c6: 'rgb(251 146 60 / 0.45)' // orange-400
}

/**
 * pickNextColor — select a palette key not currently in use by another open
 * branch. Returns the first unused key in palette order; if all six keys are
 * taken, falls back to cycling by count so the (rare) 7th branch still gets
 * a color. Collisions are accepted past 6 — that's the design budget.
 *
 * Pure helper, tested in isolation. Chat.tsx calls it on every new branch
 * creation: `pickNextColor(branches.map(b => b.color))`.
 */
export function pickNextColor(usedKeys: BranchHlColorKey[]): BranchHlColorKey {
  for (const key of BRANCH_HL_COLOR_KEYS) {
    if (!usedKeys.includes(key)) return key
  }
  // All 6 in use — fall back to cycling by count. usedKeys.length is the
  // count of currently-open branches; modulo wraps it into the palette.
  return BRANCH_HL_COLOR_KEYS[usedKeys.length % BRANCH_HL_COLOR_KEYS.length]
}
