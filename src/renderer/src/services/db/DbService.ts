import { loggerService } from '@logger'
import store from '@renderer/store'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import { AgentMessageDataSource } from './AgentMessageDataSource'
import { DexieMessageDataSource } from './DexieMessageDataSource'
import type { MessageDataSource } from './types'
import { isAgentSessionTopicId } from './types'

const logger = loggerService.withContext('DbService')

/**
 * Facade service that routes data operations to the appropriate data source
 * based on the topic ID type (regular chat or agent session)
 */
class DbService implements MessageDataSource {
  private static instance: DbService
  private dexieSource: DexieMessageDataSource
  private agentSource: AgentMessageDataSource

  private constructor() {
    this.dexieSource = new DexieMessageDataSource()
    this.agentSource = new AgentMessageDataSource()
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DbService {
    if (!DbService.instance) {
      DbService.instance = new DbService()
    }
    return DbService.instance
  }

  /**
   * Determine which data source to use based on topic ID
   */
  private getDataSource(topicId: string): MessageDataSource {
    if (isAgentSessionTopicId(topicId)) {
      logger.silly(`Using AgentMessageDataSource for topic ${topicId}`)
      return this.agentSource
    }

    // Future: Could add more data source types here
    // e.g., if (isCloudTopicId(topicId)) return this.cloudSource

    logger.silly(`Using DexieMessageDataSource for topic ${topicId}`)
    return this.dexieSource
  }

  // ============ Read Operations ============

  async fetchMessages(
    topicId: string,
    forceReload?: boolean
  ): Promise<{
    messages: Message[]
    blocks: MessageBlock[]
  }> {
    const source = this.getDataSource(topicId)
    return source.fetchMessages(topicId, forceReload)
  }

  // ============ Write Operations ============
  async appendMessage(topicId: string, message: Message, blocks: MessageBlock[], insertIndex?: number): Promise<void> {
    const source = this.getDataSource(topicId)
    return source.appendMessage(topicId, message, blocks, insertIndex)
  }

  async updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    const source = this.getDataSource(topicId)
    return source.updateMessage(topicId, messageId, updates)
  }

  async updateMessageAndBlocks(
    topicId: string,
    messageUpdates: Partial<Message> & Pick<Message, 'id'>,
    blocksToUpdate: MessageBlock[]
  ): Promise<void> {
    const source = this.getDataSource(topicId)
    return source.updateMessageAndBlocks(topicId, messageUpdates, blocksToUpdate)
  }

  async deleteMessage(topicId: string, messageId: string): Promise<void> {
    const source = this.getDataSource(topicId)
    return source.deleteMessage(topicId, messageId)
  }

  async deleteMessages(topicId: string, messageIds: string[]): Promise<void> {
    const source = this.getDataSource(topicId)
    return source.deleteMessages(topicId, messageIds)
  }

  // ============ Block Operations ============

  async updateBlocks(blocks: MessageBlock[]): Promise<void> {
    if (blocks.length === 0) {
      return
    }

    const state = store.getState()

    const agentBlocks: MessageBlock[] = []
    const regularBlocks: MessageBlock[] = []

    for (const block of blocks) {
      const parentMessage = state.messages.entities[block.messageId]
      if (parentMessage && isAgentSessionTopicId(parentMessage.topicId)) {
        agentBlocks.push(block)
      } else {
        regularBlocks.push(block)
      }
    }

    if (agentBlocks.length > 0) {
      await this.agentSource.updateBlocks(agentBlocks)
    }

    if (regularBlocks.length > 0) {
      await this.dexieSource.updateBlocks(regularBlocks)
    }
  }

  async deleteBlocks(blockIds: string[]): Promise<void> {
    // Similar limitation as updateBlocks
    // Default to Dexie since agent blocks can't be deleted individually
    return this.dexieSource.deleteBlocks(blockIds)
  }

  // ============ Batch Operations ============

  async clearMessages(topicId: string): Promise<void> {
    const source = this.getDataSource(topicId)
    return source.clearMessages(topicId)
  }

  async topicExists(topicId: string): Promise<boolean> {
    const source = this.getDataSource(topicId)
    return source.topicExists(topicId)
  }

  async ensureTopic(topicId: string): Promise<void> {
    const source = this.getDataSource(topicId)
    return source.ensureTopic(topicId)
  }

  // ============ Optional Methods (with fallback) ============

  async getRawTopic(topicId: string): Promise<{ id: string; messages: Message[] } | undefined> {
    const source = this.getDataSource(topicId)
    return source.getRawTopic(topicId)
  }

  async updateSingleBlock(blockId: string, updates: Partial<MessageBlock>): Promise<void> {
    // For single block operations, default to Dexie since agent blocks are immutable
    if (this.dexieSource.updateSingleBlock) {
      return this.dexieSource.updateSingleBlock(blockId, updates)
    }
    // Fallback to updateBlocks with single item
    return this.dexieSource.updateBlocks([{ ...updates, id: blockId } as MessageBlock])
  }

  async bulkAddBlocks(blocks: MessageBlock[]): Promise<void> {
    // For bulk add operations, default to Dexie since agent blocks use persistExchange
    if (this.dexieSource.bulkAddBlocks) {
      return this.dexieSource.bulkAddBlocks(blocks)
    }
    // Fallback to updateBlocks
    return this.dexieSource.updateBlocks(blocks)
  }

  async updateFileCount(fileId: string, delta: number, deleteIfZero: boolean = false): Promise<void> {
    // File operations only apply to Dexie source
    if (this.dexieSource.updateFileCount) {
      return this.dexieSource.updateFileCount(fileId, delta, deleteIfZero)
    }
    // No-op if not supported
    logger.warn(`updateFileCount not supported for file ${fileId}`)
  }

  async updateFileCounts(files: Array<{ id: string; delta: number; deleteIfZero?: boolean }>): Promise<void> {
    // File operations only apply to Dexie source
    if (this.dexieSource.updateFileCounts) {
      return this.dexieSource.updateFileCounts(files)
    }
    // No-op if not supported
    logger.warn(`updateFileCounts not supported`)
  }

  // ============ Utility Methods ============

  /**
   * Check if a topic is an agent session
   */
  isAgentSession(topicId: string): boolean {
    return isAgentSessionTopicId(topicId)
  }

  /**
   * Get the data source type for a topic
   */
  getSourceType(topicId: string): 'dexie' | 'agent' | 'unknown' {
    if (isAgentSessionTopicId(topicId)) {
      return 'agent'
    }
    // Add more checks for other source types as needed
    return 'dexie'
  }
}

// Export singleton instance
export const dbService = DbService.getInstance()

// Also export class for testing purposes
export { DbService }
