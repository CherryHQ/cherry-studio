import { createContext, use } from 'react'

/**
 * T-006D-2B S6' — source-passage highlight at the React-subtree boundary.
 *
 * While a branch panel is open, the EXACT selected passage in the MAIN
 * conversation is highlighted so the user sees where the branch came from.
 * A whole assistant reply is a single MAIN_TEXT block, so block-level tinting
 * would wash the entire reply. Instead this carries the source `blockId` plus
 * the selection's char offsets within that block; `MainTextBlock` paints the
 * precise range via the CSS Custom Highlight API (see `sourceHighlight.ts`).
 */
export interface BranchAnchorHighlight {
  /** blockId of the source block the open branch panel is anchored to, or null. */
  highlightedBlockId: string | null
  /** Char offset of the selection start within the source block's text content. */
  selectionStart: number
  /** Char offset of the selection end within the source block's text content. */
  selectionEnd: number
}

/**
 * D-013 ROOT-CAUSE FIX — survive HMR / module re-execution.
 *
 * This module exports a `createContext` result + a hook + a default object
 * (NO React component), so `@vitejs/plugin-react`'s Fast Refresh classifies
 * it as a non-FR-eligible module. When the file is edited mid-session, Vite
 * propagates HMR up to its importers, which re-fetch & re-execute this
 * module. Each re-execution calls `createContext(...)` again → a BRAND NEW
 * context object. Any React subtree still mounted under the previous
 * provider object would then read the new context's default (because the
 * new `use(BranchAnchorContext)` consults the new object, which has no
 * provider in the live fiber tree). Symptom: every `MainTextBlock` reads
 * `BRANCH_ANCHOR_DEFAULT` even though `<BranchAnchorContext value>` is
 * statically wrapping its subtree.
 *
 * Fix: stash the singleton on `globalThis` so all module re-executions
 * return the SAME context object and default. This is the React-community
 * pattern for HMR-safe contexts that don't co-locate with a component.
 */
type BranchAnchorCtxCache = {
  default: BranchAnchorHighlight
  context: React.Context<BranchAnchorHighlight>
}

declare global {
  var __BRANCH_ANCHOR_CTX_CACHE__: BranchAnchorCtxCache | undefined
}

function createBranchAnchorCtxCache(): BranchAnchorCtxCache {
  const def: BranchAnchorHighlight = {
    highlightedBlockId: null,
    selectionStart: 0,
    selectionEnd: 0
  }
  return { default: def, context: createContext<BranchAnchorHighlight>(def) }
}

const cache: BranchAnchorCtxCache = (globalThis.__BRANCH_ANCHOR_CTX_CACHE__ ??= createBranchAnchorCtxCache())

/**
 * The context default value — and the EXACT object `use(BranchAnchorContext)`
 * returns by reference when no Provider sits above the reader. Pulled from
 * the globalThis cache so the `received === BRANCH_ANCHOR_DEFAULT`
 * discriminator stays stable across HMR cycles.
 */
export const BRANCH_ANCHOR_DEFAULT: BranchAnchorHighlight = cache.default

export const BranchAnchorContext: React.Context<BranchAnchorHighlight> = cache.context

/** Reader for `MainTextBlock`. Returns the default (null) when no Provider is above. */
export function useBranchAnchorHighlight(): BranchAnchorHighlight {
  return use(BranchAnchorContext)
}
