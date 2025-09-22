import { loggerService } from '@logger'
import type { Topic } from '@renderer/types'
import type { AgentPersistedMessage } from '@renderer/types/agent'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { IpcChannel } from '@shared/IpcChannel'

import type { MessageDataSource, MessageExchange } from './types'
import { extractSessionId } from './types'

const logger = loggerService.withContext('AgentMessageDataSource')

/**
 * IPC-based implementation of MessageDataSource
 * Handles agent session messages through backend communication
 */
export class AgentMessageDataSource implements MessageDataSource {
  // ============ Read Operations ============

  async fetchMessages(topicId: string): Promise<{
    messages: Message[]
    blocks: MessageBlock[]
  }> {
    try {
      const sessionId = extractSessionId(topicId)

      if (!window.electron?.ipcRenderer) {
        logger.warn('IPC renderer not available')
        return { messages: [], blocks: [] }
      }

      // Fetch from agent backend
      const historicalMessages: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
        IpcChannel.AgentMessage_GetHistory,
        { sessionId }
      )

      if (!historicalMessages || !Array.isArray(historicalMessages)) {
        return { messages: [], blocks: [] }
      }

      const messages: Message[] = []
      const blocks: MessageBlock[] = []

      for (const persistedMsg of historicalMessages) {
        if (persistedMsg?.message) {
          messages.push(persistedMsg.message)
          if (persistedMsg.blocks && persistedMsg.blocks.length > 0) {
            blocks.push(...persistedMsg.blocks)
          }
        }
      }

      logger.info(`Loaded ${messages.length} messages for agent session ${sessionId}`)

      return { messages, blocks }
    } catch (error) {
      logger.error(`Failed to fetch messages for agent session ${topicId}:`, error as Error)
      throw error
    }
  }

  // ============ Write Operations ============

  async persistExchange(topicId: string, exchange: MessageExchange): Promise<void> {
    try {
      const sessionId = extractSessionId(topicId)

      if (!window.electron?.ipcRenderer) {
        logger.warn('IPC renderer not available for persist exchange')
        return
      }

      const payload: any = {
        sessionId,
        agentSessionId: exchange.agentSessionId || ''
      }

      // Prepare user payload
      if (exchange.user) {
        payload.user = {
          payload: {
            message: exchange.user.message,
            blocks: exchange.user.blocks
          }
        }
      }

      // Prepare assistant payload
      if (exchange.assistant) {
        payload.assistant = {
          payload: {
            message: exchange.assistant.message,
            blocks: exchange.assistant.blocks
          }
        }
      }

      await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, payload)

      logger.info(`Persisted exchange for agent session ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to persist exchange for agent session ${topicId}:`, error as Error)
      throw error
    }
  }

  async appendMessage(topicId: string, message: Message, blocks: MessageBlock[], insertIndex?: number): Promise<void> {
    // For agent sessions, messages are persisted through persistExchange
    // This method might be called for user messages before the exchange
    // We'll store them temporarily in memory or skip for now
    logger.info(`appendMessage called for agent session ${topicId}, deferring to persistExchange`)

    // In a full implementation, you might want to:
    // 1. Store temporarily in Redux only
    // 2. Or call a specific backend endpoint for single messages
  }

  async updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    // Agent session messages are immutable once persisted
    logger.warn(`updateMessage called for agent session ${topicId}, operation not supported`)

    // In a full implementation, you might want to:
    // 1. Update in Redux only for UI consistency
    // 2. Or implement a backend endpoint for message updates
  }

  async updateMessageAndBlocks(
    topicId: string,
    messageUpdates: Partial<Message> & Pick<Message, 'id'>,
    blocksToUpdate: MessageBlock[]
  ): Promise<void> {
    // Agent session messages and blocks are immutable once persisted
    logger.warn(`updateMessageAndBlocks called for agent session ${topicId}, operation not supported`)
  }

  async deleteMessage(topicId: string, messageId: string): Promise<void> {
    // Agent session messages cannot be deleted individually
    logger.warn(`deleteMessage called for agent session ${topicId}, operation not supported`)

    // In a full implementation, you might want to:
    // 1. Implement soft delete in backend
    // 2. Or just hide from UI without actual deletion
  }

  async deleteMessagesByAskId(topicId: string, askId: string): Promise<void> {
    // Agent session messages cannot be deleted
    logger.warn(`deleteMessagesByAskId called for agent session ${topicId}, operation not supported`)
  }

  // ============ Block Operations ============

  async updateBlocks(blocks: MessageBlock[]): Promise<void> {
    // Blocks are updated through persistExchange for agent sessions
    logger.warn('updateBlocks called for agent session, operation not supported individually')
  }

  async deleteBlocks(blockIds: string[]): Promise<void> {
    // Blocks cannot be deleted individually for agent sessions
    logger.warn('deleteBlocks called for agent session, operation not supported')
  }

  // ============ Batch Operations ============

  async clearMessages(topicId: string): Promise<void> {
    const sessionId = extractSessionId(topicId)

    if (!window.electron?.ipcRenderer) {
      logger.warn('IPC renderer not available for clear messages')
      return
    }

    // In a full implementation, you would call a backend endpoint to clear session
    // For now, we'll just log the attempt
    logger.info(`Clear messages requested for agent session ${sessionId}`)

    // You might want to implement:
    // await window.electron.ipcRenderer.invoke(
    //   IpcChannel.AgentMessage_ClearSession,
    //   { sessionId }
    // )
  }

  async topicExists(topicId: string): Promise<boolean> {
    try {
      const sessionId = extractSessionId(topicId)

      if (!window.electron?.ipcRenderer) {
        return false
      }

      // Check if session exists by trying to fetch messages
      // In a full implementation, you'd have a dedicated endpoint
      const messages = await this.fetchMessages(topicId)
      return true // If no error thrown, session exists
    } catch (error) {
      return false
    }
  }

  async ensureTopic(topicId: string): Promise<void> {
    // Agent sessions are created externally, not by the chat interface
    // This is a no-op for agent sessions
    const sessionId = extractSessionId(topicId)
    logger.info(`ensureTopic called for agent session ${sessionId}, no action needed`)
  }

  async fetchTopic(topicId: string): Promise<Topic | undefined> {
    try {
      const sessionId = extractSessionId(topicId)

      // For agent sessions, we construct a synthetic topic
      // In a real implementation, you might fetch session metadata from backend
      return {
        id: topicId,
        name: `Session ${sessionId}`,
        assistantId: 'agent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [] // Messages are fetched separately
      } as Topic
    } catch (error) {
      logger.error(`Failed to fetch topic for agent session ${topicId}:`, error as Error)
      throw error
    }
  }

  async getRawTopic(topicId: string): Promise<{ id: string; messages: Message[] } | undefined> {
    try {
      // For agent sessions, fetch messages from backend and return in raw topic format
      const { messages } = await this.fetchMessages(topicId)
      return {
        id: topicId,
        messages
      }
    } catch (error) {
      logger.error(`Failed to get raw topic for agent session ${topicId}:`, error as Error)
      return undefined
    }
  }

  // ============ Additional Methods for Interface Compatibility ============

  async updateSingleBlock(blockId: string, updates: Partial<MessageBlock>): Promise<void> {
    // Agent session blocks are immutable once persisted
    logger.warn(`updateSingleBlock called for agent session block ${blockId}, operation not supported`)
  }

  async bulkAddBlocks(blocks: MessageBlock[]): Promise<void> {
    // Agent session blocks are added through persistExchange
    logger.warn(`bulkAddBlocks called for agent session, operation not supported individually`)
  }

  async updateFileCount(fileId: string, delta: number): Promise<void> {
    // Agent sessions don't manage file reference counts locally
    logger.warn(`updateFileCount called for agent session file ${fileId}, operation not supported`)
  }

  async updateFileCounts(files: Array<{ id: string; delta: number }>): Promise<void> {
    // Agent sessions don't manage file reference counts locally
    logger.warn(`updateFileCounts called for agent session, operation not supported`)
  }
}
