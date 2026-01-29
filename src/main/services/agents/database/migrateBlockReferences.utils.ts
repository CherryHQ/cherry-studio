/**
 * Pure utility functions for block reference migration.
 * Separated from the main migration module to avoid Electron dependencies in tests.
 */

export interface MigrationResult {
  totalMessages: number
  messagesFixed: number
  blockReferencesAdded: number
  errors: Array<{ sessionId: string; messageId: string; error: string }>
}

/**
 * Find block IDs that exist in blocks array but not in message.blocks
 */
export function findMissingBlockIds(messageBlocks: string[], blocks: Array<{ id?: string }>): string[] {
  const messageBlockSet = new Set(messageBlocks)
  const missingIds: string[] = []

  for (const block of blocks) {
    if (block.id && !messageBlockSet.has(block.id)) {
      missingIds.push(block.id)
    }
  }

  return missingIds
}

/**
 * Merge missing block IDs into message.blocks
 */
export function mergeBlockReferences(messageBlocks: string[], missingIds: string[]): string[] {
  return [...messageBlocks, ...missingIds]
}
