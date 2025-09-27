/**
 * V2 implementations of message thunk functions using the unified DbService
 * These implementations will be gradually rolled out using feature flags
 */

import { loggerService } from '@logger'
import { dbService } from '@renderer/services/db'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import type { AppDispatch, RootState } from '../index'
import { upsertManyBlocks } from '../messageBlock'
import { newMessagesActions } from '../newMessage'

const logger = loggerService.withContext('MessageThunkV2')

// =================================================================
// Phase 2.1 - Batch 1: Read-only operations (lowest risk)
// =================================================================

/**
 * Load messages for a topic using unified DbService
 * This is the V2 implementation that will replace the original
 */
export const loadTopicMessagesThunkV2 =
  (topicId: string, forceReload: boolean = false) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()

    dispatch(newMessagesActions.setCurrentTopicId(topicId))

    // Skip if already cached and not forcing reload
    if (!forceReload && state.messages.messageIdsByTopic[topicId]) {
      return
    }

    try {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

      // Unified call - no need to check isAgentSessionTopicId
      const { messages, blocks } = await dbService.fetchMessages(topicId)

      logger.silly('Loaded messages via DbService', {
        topicId,
        messageCount: messages.length,
        blockCount: blocks.length
      })

      // Update Redux state with fetched data
      if (blocks.length > 0) {
        dispatch(upsertManyBlocks(blocks))
      }
      dispatch(newMessagesActions.messagesReceived({ topicId, messages }))
    } catch (error) {
      logger.error(`Failed to load messages for topic ${topicId}:`, error as Error)
      // Could dispatch an error action here if needed
    } finally {
      dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    }
  }

/**
 * Get raw topic data using unified DbService
 * Returns topic with messages array
 */
export const getRawTopicV2 = async (topicId: string): Promise<{ id: string; messages: Message[] } | undefined> => {
  try {
    const rawTopic = await dbService.getRawTopic(topicId)
    logger.silly('Retrieved raw topic via DbService', { topicId, found: !!rawTopic })
    return rawTopic
  } catch (error) {
    logger.error('Failed to get raw topic:', { topicId, error })
    return undefined
  }
}

// =================================================================
// Phase 2.2 - Batch 2: Helper functions
// =================================================================

/**
 * Update file reference count
 * Only applies to Dexie data source, no-op for agent sessions
 */
export const updateFileCountV2 = async (
  fileId: string,
  delta: number,
  deleteIfZero: boolean = false
): Promise<void> => {
  try {
    // Pass all parameters to dbService, including deleteIfZero
    await dbService.updateFileCount(fileId, delta, deleteIfZero)
    logger.silly('Updated file count', { fileId, delta, deleteIfZero })
  } catch (error) {
    logger.error('Failed to update file count:', { fileId, delta, error })
    throw error
  }
}

// =================================================================
// Phase 2.3 - Batch 3: Delete operations
// =================================================================

/**
 * Delete a single message from database
 */
export const deleteMessageFromDBV2 = async (topicId: string, messageId: string): Promise<void> => {
  try {
    await dbService.deleteMessage(topicId, messageId)
    logger.silly('Deleted message via DbService', { topicId, messageId })
  } catch (error) {
    logger.error('Failed to delete message:', { topicId, messageId, error })
    throw error
  }
}

/**
 * Delete multiple messages from database
 */
export const deleteMessagesFromDBV2 = async (topicId: string, messageIds: string[]): Promise<void> => {
  try {
    await dbService.deleteMessages(topicId, messageIds)
    logger.silly('Deleted messages via DbService', { topicId, count: messageIds.length })
  } catch (error) {
    logger.error('Failed to delete messages:', { topicId, messageIds, error })
    throw error
  }
}

/**
 * Clear all messages from a topic
 */
export const clearMessagesFromDBV2 = async (topicId: string): Promise<void> => {
  try {
    await dbService.clearMessages(topicId)
    logger.silly('Cleared all messages via DbService', { topicId })
  } catch (error) {
    logger.error('Failed to clear messages:', { topicId, error })
    throw error
  }
}

// =================================================================
// Phase 2.4 - Batch 4: Complex write operations
// =================================================================

/**
 * Save a message and its blocks to database
 * Uses unified interface, no need for isAgentSessionTopicId check
 */
export const saveMessageAndBlocksToDBV2 = async (
  topicId: string,
  message: Message,
  blocks: MessageBlock[],
  messageIndex: number = -1
): Promise<void> => {
  try {
    const blockIds = blocks.map((block) => block.id)
    const shouldSyncBlocks =
      blockIds.length > 0 && (!message.blocks || blockIds.some((id, index) => message.blocks?.[index] !== id))

    const messageWithBlocks = shouldSyncBlocks ? { ...message, blocks: blockIds } : message
    // Direct call without conditional logic, now with messageIndex
    await dbService.appendMessage(topicId, messageWithBlocks, blocks, messageIndex)
    logger.silly('Saved message and blocks via DbService', {
      topicId,
      messageId: message.id,
      blockCount: blocks.length,
      messageIndex
    })
  } catch (error) {
    logger.error('Failed to save message and blocks:', { topicId, messageId: message.id, error })
    throw error
  }
}

// Note: sendMessageV2 would be implemented here but it's more complex
// and would require more of the supporting code from messageThunk.ts

// =================================================================
// Phase 2.5 - Batch 5: Update operations
// =================================================================

/**
 * Update a message in the database
 */
export const updateMessageV2 = async (topicId: string, messageId: string, updates: Partial<Message>): Promise<void> => {
  try {
    await dbService.updateMessage(topicId, messageId, updates)
    logger.silly('Updated message via DbService', { topicId, messageId })
  } catch (error) {
    logger.error('Failed to update message:', { topicId, messageId, error })
    throw error
  }
}

/**
 * Update a single message block
 */
export const updateSingleBlockV2 = async (blockId: string, updates: Partial<MessageBlock>): Promise<void> => {
  try {
    await dbService.updateSingleBlock(blockId, updates)
    logger.silly('Updated single block via DbService', { blockId })
  } catch (error) {
    logger.error('Failed to update single block:', { blockId, error })
    throw error
  }
}

/**
 * Bulk add message blocks (for new blocks)
 */
export const bulkAddBlocksV2 = async (blocks: MessageBlock[]): Promise<void> => {
  try {
    await dbService.bulkAddBlocks(blocks)
    logger.silly('Bulk added blocks via DbService', { count: blocks.length })
  } catch (error) {
    logger.error('Failed to bulk add blocks:', { count: blocks.length, error })
    throw error
  }
}

/**
 * Update multiple message blocks (upsert operation)
 */
export const updateBlocksV2 = async (blocks: MessageBlock[]): Promise<void> => {
  try {
    await dbService.updateBlocks(blocks)
    logger.silly('Updated blocks via DbService', { count: blocks.length })
  } catch (error) {
    logger.error('Failed to update blocks:', { count: blocks.length, error })
    throw error
  }
}
