/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { loggerService } from '@logger'
import store from '@renderer/store'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import { AgentMessageDataSource } from './AgentMessageDataSource'
import { DexieMessageDataSource } from './DexieMessageDataSource'
import type { MessageDataSource } from './types'
import { buildAgentSessionTopicId, isAgentSessionTopicId } from './types'

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

  /**
   * Resolve topicId for a message
   */
  private resolveMessageTopicId(messageId: string): string | undefined {
    const state = store.getState()

    const parentMessage = state.messages.entities[messageId]
    if (parentMessage) {
      return parentMessage.topicId
    }

    const agentInfo = this.agentSource.getStreamingCacheInfo(messageId)
    if (agentInfo) {
      return buildAgentSessionTopicId(agentInfo.sessionId)
    }

    return undefined
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

    const agentBlocks: MessageBlock[] = []
    const regularBlocks: MessageBlock[] = []

    for (const block of blocks) {
      const topicId = this.resolveMessageTopicId(block.messageId)

      if (topicId && isAgentSessionTopicId(topicId)) {
        agentBlocks.push(block)
      } else {
        if (!topicId) {
          logger.warn(`Unable to resolve topicId for block ${block.id}, defaulting to Dexie`)
        }
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
    const state = store.getState()
    const existingBlock = state.messageBlocks.entities[blockId]

    if (!existingBlock) {
      logger.warn(`Block ${blockId} not found in state, defaulting to Dexie`)
      return this.dexieSource.updateSingleBlock(blockId, updates)
    }

    const topicId = this.resolveMessageTopicId(existingBlock.messageId)

    if (topicId && isAgentSessionTopicId(topicId)) {
      return this.agentSource.updateSingleBlock(blockId, updates)
    }

    // Default to Dexie for regular blocks
    return this.dexieSource.updateSingleBlock(blockId, updates)
  }

  async bulkAddBlocks(blocks: MessageBlock[]): Promise<void> {
    // For bulk add operations, default to Dexie since agent blocks use persistExchange
    return this.dexieSource.bulkAddBlocks(blocks)
  }

  async updateFileCount(fileId: string, delta: number, deleteIfZero: boolean = false): Promise<void> {
    // File operations only apply to Dexie source
    return this.dexieSource.updateFileCount(fileId, delta, deleteIfZero)
  }

  async updateFileCounts(files: Array<{ id: string; delta: number; deleteIfZero?: boolean }>): Promise<void> {
    // File operations only apply to Dexie source
    return this.dexieSource.updateFileCounts(files)
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
