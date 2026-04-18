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
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import { fetchMessagesFromDataApi } from './DataApiMessageDataSource'
import { DexieMessageDataSource } from './DexieMessageDataSource'
import type { MessageDataSource } from './types'

/**
 * Facade service that routes data operations to the appropriate data source
 * based on the topic ID type (regular chat or agent session)
 */
class DbService implements MessageDataSource {
  private dexieSource: DexieMessageDataSource

  constructor() {
    this.dexieSource = new DexieMessageDataSource()
  }

  /**
   * Determine which data source to use based on topic ID.
   * Agent sessions now use useAgentSessionParts + AgentPersistenceListener (Main-side),
   * so this only routes to Dexie.
   */
  private getDataSource(_topicId: string): MessageDataSource {
    return this.dexieSource
  }

  // ============ Read Operations ============

  async fetchMessages(
    topicId: string,
    // oxlint-disable-next-line no-unused-vars -- interface requires this parameter
    _forceReload?: boolean
  ): Promise<{
    messages: Message[]
    blocks: MessageBlock[]
  }> {
    // Normal topics: read from Data API (SQLite)
    // Agent sessions now use useAgentSessionParts (direct IPC), not this path.
    return fetchMessagesFromDataApi(topicId)
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
    if (blocks.length === 0) return
    return this.dexieSource.updateBlocks(blocks)
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
}

// Export singleton instance
export const dbService = new DbService()

// Also export class for testing purposes
export { DbService }
