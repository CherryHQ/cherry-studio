import { createContext, use } from 'react'

/**
 * T-006D-2B S6' / P1-S1 — source-passage highlight at the React-subtree boundary.
 *
 * While branches are open, the EXACT selected passage(s) in the MAIN
 * conversation are highlighted so the user sees where each branch came from.
 * A whole assistant reply is a single MAIN_TEXT block, so block-level tinting
 * would wash the entire reply. Instead, for each open branch this carries
 * the source `blockId` plus the selection's char offsets within that block;
 * `MainTextBlock` filters anchors by its own `block.id` and paints each
 * match by wrapping the resolved Range's text nodes in
 * `<span class="branch-anchor-highlight">` (see `sourceHighlight.ts`).
 *
 * S1 invariant: anchors.length ≤ 1. The list shape is the state foundation
 * for S2 multi-branch UI; at length ≤ 1 runtime behavior is bit-for-bit
 * identical to the previous single-anchor shape. (S2 will introduce per-
 * branch span tagging so multiple paints can coexist without the current
 * paintSourceHighlight doc-wide clear overwriting earlier anchors.)
 */
export interface BranchAnchorHighlight {
  /** Stable client id of the branch this anchor belongs to (Branch.id). */
  branchId: string
  /** blockId of the source block this branch is anchored to. */
  blockId: string
  /** Char offset of the selection start within the source block's text content. */
  selectionStart: number
  /** Char offset of the selection end within the source block's text content. */
  selectionEnd: number
}

/** Value carried by BranchAnchorContext — list of currently-open anchors. */
export interface BranchAnchorContextValue {
  anchors: BranchAnchorHighlight[]
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
  context: React.Context<BranchAnchorContextValue>
}

declare global {
  var __BRANCH_ANCHOR_CTX_CACHE__: BranchAnchorCtxCache | undefined
}

function createBranchAnchorCtxCache(): BranchAnchorCtxCache {
  return {
    context: createContext<BranchAnchorContextValue>({ anchors: [] })
  }
}

// HMR cache key intentionally unchanged (P1-S1): the globalThis pattern is
// the documented fix for the D-013-FIX context-split root cause. Dev users
// pulling the shape change need a single full reload to drop the stale
// cache entry; after that the new shape is in effect.
const cache: BranchAnchorCtxCache = (globalThis.__BRANCH_ANCHOR_CTX_CACHE__ ??= createBranchAnchorCtxCache())

export const BranchAnchorContext: React.Context<BranchAnchorContextValue> = cache.context

/** Reader for `MainTextBlock`. Returns the default (empty anchors) when no Provider is above. */
export function useBranchAnchorHighlight(): BranchAnchorContextValue {
  return use(BranchAnchorContext)
}
