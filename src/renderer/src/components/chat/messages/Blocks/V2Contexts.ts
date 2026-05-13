/**
 * V2 Contexts — extracted to avoid circular imports.
 *
 * PartsContext is the primary data source for V2 rendering.
 * Components read parts directly via useMessageParts / usePartsMap.
 */

import type { CherryMessagePart } from '@shared/data/types/message'
import { createContext, use, useMemo } from 'react'

// ============================================================================
// Refresh Context — allows deep components to trigger data refresh
// ============================================================================

export const RefreshContext = createContext<(() => void) | null>(null)
export const RefreshProvider = RefreshContext.Provider

/** Get the refresh callback from context. Returns no-op if not provided. */
export function useRefresh(): () => void {
  const refresh = use(RefreshContext)
  return refresh ?? (() => {})
}

// ============================================================================
// Parts Context — primary V2 rendering data source
// ============================================================================

/**
 * Parts context — provides raw CherryMessagePart[] keyed by message ID.
 * Null in V1 mode (Redux path).
 */
export const PartsContext = createContext<Record<string, CherryMessagePart[]> | null>(null)

/** Wrap subtree to provide raw parts data for rendering components. */
export const PartsProvider = PartsContext.Provider

/** Read the parts map from context (null when not in V2 mode). */
export function usePartsMap() {
  return use(PartsContext)
}

/** Check if we are in V2 chat mode (PartsContext is provided). */
export function useIsV2Chat(): boolean {
  return use(PartsContext) !== null
}

// ============================================================================
// Helpers
// ============================================================================

/** Parse a block/part ID into messageId and part index. */
export function parseBlockId(blockId: string): { messageId: string; index: number } | null {
  const lastBlockDash = blockId.lastIndexOf('-block-')
  if (lastBlockDash === -1) return null
  const messageId = blockId.slice(0, lastBlockDash)
  const index = parseInt(blockId.slice(lastBlockDash + 7), 10)
  if (isNaN(index)) return null
  return { messageId, index }
}

/**
 * Get raw parts for a message from PartsContext.
 * Returns empty array if not in V2 mode or no parts exist.
 */
export function useMessageParts(messageId: string): CherryMessagePart[] {
  const partsMap = use(PartsContext)
  return useMemo(() => {
    if (!partsMap) return []
    return partsMap[messageId] ?? []
  }, [partsMap, messageId])
}

/**
 * Resolve a single part from partsMap by part/block ID.
 * Supports both `${messageId}-part-${index}` and `${messageId}-block-${index}` formats.
 * Returns null if not found.
 */
export function resolvePartFromParts(
  partsMap: Record<string, CherryMessagePart[]>,
  partId: string
): { part: CherryMessagePart; messageId: string; index: number } | null {
  // Try block format first (existing parseBlockId handles ${msgId}-block-${i})
  let parsed = parseBlockId(partId)
  // Also try part format: ${msgId}-part-${i}
  if (!parsed) {
    const lastPartDash = partId.lastIndexOf('-part-')
    if (lastPartDash !== -1) {
      const messageId = partId.slice(0, lastPartDash)
      const index = parseInt(partId.slice(lastPartDash + 6), 10)
      if (!isNaN(index)) {
        parsed = { messageId, index }
      }
    }
  }
  if (!parsed) return null
  const parts = partsMap[parsed.messageId]
  if (!parts || parsed.index >= parts.length) return null
  return { part: parts[parsed.index], messageId: parsed.messageId, index: parsed.index }
}
