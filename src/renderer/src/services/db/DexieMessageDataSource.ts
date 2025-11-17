import { loggerService } from '@logger'
import db from '@renderer/databases'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import { updateTopicUpdatedAt } from '@renderer/store/assistants'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { isEmpty } from 'lodash'

import type { MessageDataSource } from './types'

const logger = loggerService.withContext('DexieMessageDataSource')

/**
 * Dexie-based implementation of MessageDataSource
 * Handles local IndexedDB storage for regular chat messages
 */
export class DexieMessageDataSource implements MessageDataSource {
  // ============ Read Operations ============

  async fetchMessages(topicId: string): Promise<{
    messages: Message[]
    blocks: MessageBlock[]
  }> {
    try {
      const topic = await db.topics.get(topicId)
      if (!topic) {
        await db.topics.add({ id: topicId, messages: [] })
      }
      const messages = topic?.messages || []

      if (messages.length === 0) {
        return { messages: [], blocks: [] }
      }

      const messageIds = messages.map((m) => m.id)
      const blocks = await db.message_blocks.where('messageId').anyOf(messageIds).toArray()

      // Ensure block IDs are strings for consistency
      const messagesWithBlockIds = messages.map((m) => ({
        ...m,
        blocks: m.blocks?.map(String) || []
      }))

      return { messages: messagesWithBlockIds, blocks: blocks || [] }
    } catch (error) {
      logger.error(`Failed to fetch messages for topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async getRawTopic(topicId: string): Promise<{ id: string; messages: Message[] } | undefined> {
    try {
      return await db.topics.get(topicId)
    } catch (error) {
      logger.error(`Failed to get raw topic ${topicId}:`, error as Error)
      throw error
    }
  }

  // ============ Write Operations ============
  async appendMessage(topicId: string, message: Message, blocks: MessageBlock[], insertIndex?: number): Promise<void> {
    try {
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Save blocks first
        if (blocks.length > 0) {
          await db.message_blocks.bulkPut(blocks)
        }

        // Get or create topic
        let topic = await db.topics.get(topicId)
        if (!topic) {
          await db.topics.add({ id: topicId, messages: [] })
          topic = await db.topics.get(topicId)
        }

        if (!topic) {
          throw new Error(`Failed to create topic ${topicId}`)
        }

        const updatedMessages = [...(topic.messages || [])]

        // Check if message already exists
        const existingIndex = updatedMessages.findIndex((m) => m.id === message.id)
        if (existingIndex !== -1) {
          updatedMessages[existingIndex] = message
        } else {
          // Insert at specific index or append
          if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= updatedMessages.length) {
            updatedMessages.splice(insertIndex, 0, message)
          } else {
            updatedMessages.push(message)
          }
        }

        await db.topics.update(topicId, { messages: updatedMessages })
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to append message to topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    try {
      await db.transaction('rw', db.topics, async () => {
        await db.topics
          .where('id')
          .equals(topicId)
          .modify((topic) => {
            if (!topic || !topic.messages) return

            const messageIndex = topic.messages.findIndex((m) => m.id === messageId)
            if (messageIndex !== -1) {
              Object.assign(topic.messages[messageIndex], updates)
            }
          })
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to update message ${messageId} in topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async updateMessageAndBlocks(
    topicId: string,
    messageUpdates: Partial<Message> & Pick<Message, 'id'>,
    blocksToUpdate: MessageBlock[]
  ): Promise<void> {
    try {
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Update blocks
        if (blocksToUpdate.length > 0) {
          await db.message_blocks.bulkPut(blocksToUpdate)
        }

        // Update message if there are actual changes beyond id and topicId
        const keysToUpdate = Object.keys(messageUpdates).filter((key) => key !== 'id' && key !== 'topicId')
        if (keysToUpdate.length > 0) {
          await db.topics
            .where('id')
            .equals(topicId)
            .modify((topic) => {
              if (!topic || !topic.messages) return

              const messageIndex = topic.messages.findIndex((m) => m.id === messageUpdates.id)
              if (messageIndex !== -1) {
                keysToUpdate.forEach((key) => {
                  ;(topic.messages[messageIndex] as any)[key] = (messageUpdates as any)[key]
                })
              }
            })
        }
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to update message and blocks for ${messageUpdates.id}:`, error as Error)
      throw error
    }
  }

  async deleteMessage(topicId: string, messageId: string): Promise<void> {
    try {
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        const topic = await db.topics.get(topicId)
        if (!topic) return

        const messageIndex = topic.messages.findIndex((m) => m.id === messageId)
        if (messageIndex === -1) return

        const message = topic.messages[messageIndex]
        const blockIds = message.blocks || []

        // Delete blocks and handle files
        if (blockIds.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
          const files = blocks
            .filter((block) => block.type === 'file' || block.type === 'image')
            .map((block: any) => block.file)
            .filter((file) => file !== undefined)

          // Clean up files
          if (!isEmpty(files)) {
            await Promise.all(files.map((file) => FileManager.deleteFile(file.id, false)))
          }

          await db.message_blocks.bulkDelete(blockIds)
        }

        // Remove message from topic
        topic.messages.splice(messageIndex, 1)
        await db.topics.update(topicId, { messages: topic.messages })
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to delete message ${messageId} from topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async deleteMessages(topicId: string, messageIds: string[]): Promise<void> {
    try {
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        const topic = await db.topics.get(topicId)
        if (!topic) return

        // Collect all block IDs from messages to be deleted
        const allBlockIds: string[] = []
        const messagesToDelete: Message[] = []

        for (const messageId of messageIds) {
          const message = topic.messages.find((m) => m.id === messageId)
          if (message) {
            messagesToDelete.push(message)
            if (message.blocks && message.blocks.length > 0) {
              allBlockIds.push(...message.blocks)
            }
          }
        }

        // Delete blocks and handle files
        if (allBlockIds.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(allBlockIds).toArray()
          const files = blocks
            .filter((block) => block.type === 'file' || block.type === 'image')
            .map((block: any) => block.file)
            .filter((file) => file !== undefined)

          // Clean up files
          if (!isEmpty(files)) {
            await Promise.all(files.map((file) => FileManager.deleteFile(file.id, false)))
          }
          await db.message_blocks.bulkDelete(allBlockIds)
        }

        // Remove messages from topic
        const remainingMessages = topic.messages.filter((m) => !messageIds.includes(m.id))
        await db.topics.update(topicId, { messages: remainingMessages })
      })
      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to delete messages from topic ${topicId}:`, error as Error)
      throw error
    }
  }

  // ============ Block Operations ============

  async updateBlocks(blocks: MessageBlock[]): Promise<void> {
    try {
      if (blocks.length === 0) return
      await db.message_blocks.bulkPut(blocks)
    } catch (error) {
      logger.error('Failed to update blocks:', error as Error)
      throw error
    }
  }

  async updateSingleBlock(blockId: string, updates: Partial<MessageBlock>): Promise<void> {
    try {
      await db.message_blocks.update(blockId, updates)
    } catch (error) {
      logger.error(`Failed to update block ${blockId}:`, error as Error)
      throw error
    }
  }

  async bulkAddBlocks(blocks: MessageBlock[]): Promise<void> {
    try {
      if (blocks.length === 0) return
      await db.message_blocks.bulkAdd(blocks)
    } catch (error) {
      logger.error('Failed to bulk add blocks:', error as Error)
      throw error
    }
  }

  async deleteBlocks(blockIds: string[]): Promise<void> {
    try {
      if (blockIds.length === 0) return

      // Get blocks to find associated files
      const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
      const files = blocks
        .filter((block) => block.type === 'file' || block.type === 'image')
        .map((block: any) => block.file)
        .filter((file) => file !== undefined)

      // Clean up files
      if (!isEmpty(files)) {
        await Promise.all(files.map((file) => FileManager.deleteFile(file.id, false)))
      }

      await db.message_blocks.bulkDelete(blockIds)
    } catch (error) {
      logger.error('Failed to delete blocks:', error as Error)
      throw error
    }
  }

  // ============ Batch Operations ============

  async clearMessages(topicId: string): Promise<void> {
    try {
      // First, collect file information and block IDs within a read transaction
      let blockIds: string[] = []
      let files: any[] = []

      await db.transaction('r', db.topics, db.message_blocks, async () => {
        const topic = await db.topics.get(topicId)
        if (!topic) return

        // Get all block IDs
        blockIds = topic.messages.flatMap((m) => m.blocks || [])

        // Get blocks and extract file info
        if (blockIds.length > 0) {
          const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
          files = blocks
            .filter((block) => block.type === 'file' || block.type === 'image')
            .map((block: any) => block.file)
            .filter((file) => file !== undefined)
        }
      })

      // Delete files outside the transaction to avoid transaction timeout
      if (!isEmpty(files)) {
        await Promise.all(files.map((file) => FileManager.deleteFile(file.id, false)))
      }

      // Perform the actual database cleanup in a separate write transaction
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        const topic = await db.topics.get(topicId)
        if (!topic) return

        // Delete blocks
        if (blockIds.length > 0) {
          await db.message_blocks.bulkDelete(blockIds)
        }

        // Clear messages
        await db.topics.update(topicId, { messages: [] })
      })

      store.dispatch(updateTopicUpdatedAt({ topicId }))
    } catch (error) {
      logger.error(`Failed to clear messages for topic ${topicId}:`, error as Error)
      throw error
    }
  }

  async topicExists(topicId: string): Promise<boolean> {
    try {
      const topic = await db.topics.get(topicId)
      return !!topic
    } catch (error) {
      logger.error(`Failed to check if topic ${topicId} exists:`, error as Error)
      return false
    }
  }

  async ensureTopic(topicId: string): Promise<void> {
    try {
      const exists = await this.topicExists(topicId)
      if (!exists) {
        await db.topics.add({ id: topicId, messages: [] })
      }
    } catch (error) {
      logger.error(`Failed to ensure topic ${topicId} exists:`, error as Error)
      throw error
    }
  }

  // ============ File Operations ============

  async updateFileCount(fileId: string, delta: number, deleteIfZero: boolean = false): Promise<void> {
    try {
      await db.transaction('rw', db.files, async () => {
        const file = await db.files.get(fileId)

        if (!file) {
          logger.warn(`File ${fileId} not found for count update`)
          return
        }

        const newCount = (file.count || 0) + delta

        if (newCount <= 0 && deleteIfZero) {
          // Delete the file when count reaches 0 or below
          await FileManager.deleteFile(fileId, false)
          await db.files.delete(fileId)
          logger.info(`Deleted file ${fileId} as reference count reached ${newCount}`)
        } else {
          // Update the count
          await db.files.update(fileId, { count: Math.max(0, newCount) })
          logger.debug(`Updated file ${fileId} count to ${Math.max(0, newCount)}`)
        }
      })
    } catch (error) {
      logger.error(`Failed to update file count for ${fileId}:`, error as Error)
      throw error
    }
  }

  async updateFileCounts(files: Array<{ id: string; delta: number; deleteIfZero?: boolean }>): Promise<void> {
    try {
      for (const file of files) {
        await this.updateFileCount(file.id, file.delta, file.deleteIfZero || false)
      }
    } catch (error) {
      logger.error('Failed to update file counts:', error as Error)
      throw error
    }
  }
}
