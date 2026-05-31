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
