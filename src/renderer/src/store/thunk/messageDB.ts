/**
 * Database operations for messages and blocks.
 * Extracted from messageThunk.ts for better separation of concerns.
 */
import { loggerService } from '@logger'
import { DbService } from '@renderer/services/DbService'
import type { MessageBlock } from '@renderer/types/newMessage'
import type { Message } from '@renderer/types/newMessage'

const logger = loggerService.withContext('MessageDB')
const dbFacade = DbService.getInstance()

/**
 * Get raw topic data from database
 */
export const getRawTopic = async (topicId: string): Promise<{ id: string; messages: Message[] } | undefined> => {
  try {
    const rawTopic = await dbFacade.getRawTopic(topicId)
    logger.silly('Retrieved raw topic via DbService', {
      topicId,
      found: !!rawTopic
    })
    return rawTopic
  } catch (error) {
    logger.error('Failed to get raw topic:', { topicId, error })
    return undefined
  }
}

/**
 * Update file reference count
 * Only applies to Dexie data source, no-op for agent sessions
 */
export const updateFileCount = async (fileId: string, delta: number, deleteIfZero: boolean = false): Promise<void> => {
  try {
    await dbFacade.updateFileCount(fileId, delta, deleteIfZero)
    logger.silly('Updated file count', { fileId, delta, deleteIfZero })
  } catch (error) {
    logger.error('Failed to update file count:', { fileId, delta, error })
    throw error
  }
}

/**
 * Delete a single message from database
 */
export const deleteMessageFromDB = async (topicId: string, messageId: string): Promise<void> => {
  try {
    await dbFacade.deleteMessage(topicId, messageId)
    logger.silly('Deleted message via DbService', { topicId, messageId })
  } catch (error) {
    logger.error('Failed to delete message:', { topicId, messageId, error })
    throw error
  }
}

/**
 * Delete multiple messages from database
 */
export const deleteMessagesFromDB = async (topicId: string, messageIds: string[]): Promise<void> => {
  try {
    await dbFacade.deleteMessages(topicId, messageIds)
    logger.silly('Deleted messages via DbService', {
      topicId,
      count: messageIds.length
    })
  } catch (error) {
    logger.error('Failed to delete messages:', { topicId, messageIds, error })
    throw error
  }
}

/**
 * Clear all messages from a topic
 */
export const clearMessagesFromDB = async (topicId: string): Promise<void> => {
  try {
    await dbFacade.clearMessages(topicId)
    logger.silly('Cleared all messages via DbService', { topicId })
  } catch (error) {
    logger.error('Failed to clear messages:', { topicId, error })
    throw error
  }
}

/**
 * Save a message and its blocks to database
 * Uses unified interface, no need for isAgentSessionTopicId check
 */
export const saveMessageAndBlocksToDB = async (
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
    await dbFacade.appendMessage(topicId, messageWithBlocks, blocks, messageIndex)
    logger.silly('Saved message and blocks via DbService', {
      topicId,
      messageId: message.id,
      blockCount: blocks.length,
      messageIndex
    })
  } catch (error) {
    logger.error('Failed to save message and blocks:', {
      topicId,
      messageId: message.id,
      error
    })
    throw error
  }
}

/**
 * Update a message in the database
 */
export const updateMessage = async (topicId: string, messageId: string, updates: Partial<Message>): Promise<void> => {
  try {
    await dbFacade.updateMessage(topicId, messageId, updates)
    logger.silly('Updated message via DbService', { topicId, messageId })
  } catch (error) {
    logger.error('Failed to update message:', { topicId, messageId, error })
    throw error
  }
}

/**
 * Update a single message block
 */
export const updateSingleBlock = async (blockId: string, updates: Partial<MessageBlock>): Promise<void> => {
  try {
    await dbFacade.updateSingleBlock(blockId, updates)
    logger.silly('Updated single block via DbService', { blockId })
  } catch (error) {
    logger.error('Failed to update single block:', { blockId, error })
    throw error
  }
}

/**
 * Bulk add message blocks (for new blocks)
 */
export const bulkAddBlocks = async (blocks: MessageBlock[]): Promise<void> => {
  try {
    await dbFacade.bulkAddBlocks(blocks)
    logger.silly('Bulk added blocks via DbService', { count: blocks.length })
  } catch (error) {
    logger.error('Failed to bulk add blocks:', { count: blocks.length, error })
    throw error
  }
}

/**
 * Update multiple message blocks (upsert operation)
 */
export const updateBlocks = async (blocks: MessageBlock[]): Promise<void> => {
  try {
    await dbFacade.updateBlocks(blocks)
    logger.silly('Updated blocks via DbService', { count: blocks.length })
  } catch (error) {
    logger.error('Failed to update blocks:', { count: blocks.length, error })
    throw error
  }
}
