import { createContext, use } from 'react'

/**
 * T-006D-2B S6' — source-passage highlight at the React-subtree boundary.
 *
 * While a branch panel is open, the EXACT selected passage in the MAIN
 * conversation is highlighted so the user sees where the branch came from.
 * A whole assistant reply is a single MAIN_TEXT block, so block-level tinting
 * would wash the entire reply. Instead this carries the source `blockId` plus
 * the selection's char offsets within that block; `MainTextBlock` paints the
 * precise range by wrapping the resolved Range's text nodes in
 * `<span class="branch-anchor-highlight">` (see `sourceHighlight.ts`).
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
 * HMR-safe context singleton — DO NOT remove the globalThis cache.
 *
 * This module exports a `createContext` result + a hook (NO React component),
 * so `@vitejs/plugin-react`'s Fast Refresh classifies it as a non-FR-eligible
 * module. When the file is edited mid-session, Vite propagates HMR up to its
 * importers and re-executes this module. Each re-execution would otherwise
 * call `createContext(...)` again, producing a BRAND NEW context object —
 * `<BranchAnchorContext value>` in Chat.tsx and `use(BranchAnchorContext)` in
 * MainTextBlock would then resolve to *different* objects, so consumers read
 * the new context's default while the provider's value silently lands in
 * orphan storage. Symptom: every `MainTextBlock` reads the default null even
 * though the Provider statically wraps its subtree.
 *
 * Stashing the context on `globalThis` guarantees that module re-executions
 * reuse the same object across HMR cycles. This is the React-community
 * pattern for HMR-safe contexts that don't co-locate with a component.
 */
type BranchAnchorCtxCache = {
  context: React.Context<BranchAnchorHighlight>
}

declare global {
  var __BRANCH_ANCHOR_CTX_CACHE__: BranchAnchorCtxCache | undefined
}

function createBranchAnchorCtxCache(): BranchAnchorCtxCache {
  return {
    context: createContext<BranchAnchorHighlight>({
      highlightedBlockId: null,
      selectionStart: 0,
      selectionEnd: 0
    })
  }
}

const cache: BranchAnchorCtxCache = (globalThis.__BRANCH_ANCHOR_CTX_CACHE__ ??= createBranchAnchorCtxCache())

export const BranchAnchorContext: React.Context<BranchAnchorHighlight> = cache.context

/** Reader for `MainTextBlock`. Returns the default (null) when no Provider is above. */
export function useBranchAnchorHighlight(): BranchAnchorHighlight {
  return use(BranchAnchorContext)
}
