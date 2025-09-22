import { loggerService } from '@logger'
import type { AgentPersistedMessage } from '@renderer/types/agent'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { IpcChannel } from '@shared/IpcChannel'

import type { MessageDataSource } from './types'
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
  async appendMessage(topicId: string, message: Message, blocks: MessageBlock[], _insertIndex?: number): Promise<void> {
    // For agent sessions, we need to save messages immediately
    // Don't wait for persistExchange which happens after response completion
    const sessionId = extractSessionId(topicId)
    if (!sessionId) {
      throw new Error(`Invalid agent session topicId: ${topicId}`)
    }

    try {
      // Create a persisted message payload
      const payload: AgentPersistedMessage = {
        message,
        blocks
      }

      // Save single message immediately to backend
      // Use persistExchange with only one side of the conversation
      await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
        sessionId,
        agentSessionId: '', // Will be set later if needed
        ...(message.role === 'user' ? { user: { payload } } : { assistant: { payload } })
      })

      logger.info(`Saved ${message.role} message for agent session ${sessionId}`, {
        messageId: message.id,
        blockCount: blocks.length
      })
    } catch (error) {
      logger.error(`Failed to save message for agent session ${topicId}:`, error as Error)
      throw error
    }
  }

  async updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    const sessionId = extractSessionId(topicId)
    if (!sessionId) {
      throw new Error(`Invalid agent session topicId: ${topicId}`)
    }

    try {
      // Fetch current message from backend to merge updates
      const historicalMessages: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
        IpcChannel.AgentMessage_GetHistory,
        { sessionId }
      )

      const existingMessage = historicalMessages?.find((pm) => pm.message?.id === messageId)
      if (!existingMessage?.message) {
        logger.warn(`Message ${messageId} not found in agent session ${sessionId}`)
        return
      }

      // Merge updates with existing message
      const updatedMessage = { ...existingMessage.message, ...updates }

      // Save updated message back to backend
      await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
        sessionId,
        agentSessionId: '',
        ...(updatedMessage.role === 'user'
          ? { user: { payload: { message: updatedMessage, blocks: existingMessage.blocks || [] } } }
          : { assistant: { payload: { message: updatedMessage, blocks: existingMessage.blocks || [] } } })
      })

      logger.info(`Updated message ${messageId} in agent session ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to update message ${messageId} in agent session ${topicId}:`, error as Error)
      throw error
    }
  }

  async updateMessageAndBlocks(
    topicId: string,
    messageUpdates: Partial<Message> & Pick<Message, 'id'>,
    blocksToUpdate: MessageBlock[]
  ): Promise<void> {
    const sessionId = extractSessionId(topicId)
    if (!sessionId) {
      throw new Error(`Invalid agent session topicId: ${topicId}`)
    }

    try {
      // Fetch current message from backend if we need to merge
      const historicalMessages: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
        IpcChannel.AgentMessage_GetHistory,
        { sessionId }
      )

      const existingMessage = historicalMessages?.find((pm) => pm.message?.id === messageUpdates.id)
      let finalMessage: Message

      if (existingMessage?.message) {
        // Merge updates with existing message
        finalMessage = { ...existingMessage.message, ...messageUpdates }
      } else {
        // New message, ensure we have required fields
        if (!messageUpdates.topicId || !messageUpdates.role) {
          logger.warn(`Incomplete message data for ${messageUpdates.id}`)
          return
        }
        finalMessage = messageUpdates as Message
      }

      // Save updated message and blocks to backend
      await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
        sessionId,
        agentSessionId: '',
        ...(finalMessage.role === 'user'
          ? { user: { payload: { message: finalMessage, blocks: blocksToUpdate } } }
          : { assistant: { payload: { message: finalMessage, blocks: blocksToUpdate } } })
      })

      logger.info(`Updated message and blocks for ${messageUpdates.id} in agent session ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to update message and blocks for agent session ${topicId}:`, error as Error)
      throw error
    }
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

  async updateBlocks(_blocks: MessageBlock[]): Promise<void> {
    // Blocks are updated through persistExchange for agent sessions
    logger.warn('updateBlocks called for agent session, operation not supported individually')
  }

  async deleteBlocks(_blockIds: string[]): Promise<void> {
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
      return sessionId != null
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

  async updateSingleBlock(blockId: string, _updates: Partial<MessageBlock>): Promise<void> {
    // Agent session blocks are immutable once persisted
    logger.warn(`updateSingleBlock called for agent session block ${blockId}, operation not supported`)
  }

  async bulkAddBlocks(_blocks: MessageBlock[]): Promise<void> {
    // Agent session blocks are added through persistExchange
    logger.warn(`bulkAddBlocks called for agent session, operation not supported individually`)
  }

  async updateFileCount(fileId: string, _delta: number): Promise<void> {
    // Agent sessions don't manage file reference counts locally
    logger.warn(`updateFileCount called for agent session file ${fileId}, operation not supported`)
  }

  async updateFileCounts(_files: Array<{ id: string; delta: number }>): Promise<void> {
    // Agent sessions don't manage file reference counts locally
    logger.warn(`updateFileCounts called for agent session, operation not supported`)
  }
}
