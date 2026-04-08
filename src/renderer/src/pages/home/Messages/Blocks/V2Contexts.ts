/**
 * V2 Block & Parts Contexts — extracted to avoid circular imports.
 *
 * Child components (CitationBlock, MainTextBlock, etc.) can import from this
 * file without creating a cycle through Blocks/index.tsx.
 */

import type { MessageBlock } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createContext, use } from 'react'

// ============================================================================
// V2 Block Context (transition layer — will be removed when all components read parts)
// ============================================================================

/**
 * V2 block context — provides pre-resolved MessageBlock objects keyed by block ID.
 * When present, MessageBlockRenderer reads blocks from this context instead of Redux.
 * V1 mode: context is null, blocks resolved from Redux store as before.
 */
export const V2BlockContext = createContext<Record<string, MessageBlock> | null>(null)

/** Wrap V2 subtree with this provider to bypass Redux block lookups. */
export const V2BlockProvider = V2BlockContext.Provider

/** Read the V2 block map from context (null in V1 mode). */
export function useV2BlockMap() {
  return use(V2BlockContext)
}

// ============================================================================
// Parts Context (target layer — components will gradually migrate to read this)
// ============================================================================

/**
 * Parts context — provides raw CherryMessagePart[] keyed by message ID.
 * This is the target data source for rendering: components read parts directly
 * and convert to blocks internally (Plan A), or read parts natively (future).
 */
export const PartsContext = createContext<Record<string, CherryMessagePart[]> | null>(null)

/** Wrap subtree to provide raw parts data for rendering components. */
export const PartsProvider = PartsContext.Provider

/** Read the parts map from context (null when not in parts-driven mode). */
export function usePartsMap() {
  return use(PartsContext)
}
