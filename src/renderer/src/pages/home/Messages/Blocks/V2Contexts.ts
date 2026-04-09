/**
 * V2 Contexts — extracted to avoid circular imports.
 *
 * PartsContext is the primary data source for V2 rendering.
 * Components read parts directly or convert to blocks inline via partToBlock().
 */

import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { partToBlock } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createContext, use, useMemo } from 'react'

// ============================================================================
// Parts Context — primary V2 rendering data source
// ============================================================================

/**
 * Parts context — provides raw CherryMessagePart[] keyed by message ID.
 * MessageBlockRenderer reads parts and converts to blocks inline.
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

/**
 * Resolve a block from PartsContext by block ID.
 *
 * Block IDs follow the convention `${messageId}-block-${index}`.
 * This function parses the ID, finds the corresponding part, and converts it.
 * Returns null if not in V2 mode or if the block cannot be resolved.
 */
export function useResolveBlock(blockId: string | undefined): MessageBlock | null {
  const partsMap = use(PartsContext)
  return useMemo(() => {
    if (!partsMap || !blockId) return null
    return resolveBlockFromParts(partsMap, blockId)
  }, [partsMap, blockId])
}

/**
 * Build a block map from PartsContext for a specific message.
 * Used by components that need to iterate all blocks of a message.
 */
export function useMessageBlocks(messageId: string, messageStatus?: string): MessageBlock[] {
  const partsMap = use(PartsContext)
  return useMemo(() => {
    if (!partsMap) return []
    const parts = partsMap[messageId]
    if (!parts) return []
    const blockStatus = messageStatus?.includes('ing') ? MessageBlockStatus.STREAMING : MessageBlockStatus.SUCCESS
    const blocks: MessageBlock[] = []
    for (let i = 0; i < parts.length; i++) {
      const block = partToBlock(parts[i], `${messageId}-block-${i}`, messageId, '', blockStatus)
      if (block) blocks.push(block)
    }
    return blocks
  }, [partsMap, messageId, messageStatus])
}

// ============================================================================
// Helpers
// ============================================================================

/** Parse a block ID into messageId and part index. */
function parseBlockId(blockId: string): { messageId: string; index: number } | null {
  const lastBlockDash = blockId.lastIndexOf('-block-')
  if (lastBlockDash === -1) return null
  const messageId = blockId.slice(0, lastBlockDash)
  const index = parseInt(blockId.slice(lastBlockDash + 7), 10)
  if (isNaN(index)) return null
  return { messageId, index }
}

/** Resolve a single block from partsMap by block ID. */
export function resolveBlockFromParts(
  partsMap: Record<string, CherryMessagePart[]>,
  blockId: string
): MessageBlock | null {
  const parsed = parseBlockId(blockId)
  if (!parsed) return null
  const parts = partsMap[parsed.messageId]
  if (!parts || parsed.index >= parts.length) return null
  return partToBlock(parts[parsed.index], blockId, parsed.messageId, '', MessageBlockStatus.SUCCESS)
}
