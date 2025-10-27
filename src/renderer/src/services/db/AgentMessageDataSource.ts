import { loggerService } from '@logger'
import store from '@renderer/store'
import type { AgentPersistedMessage } from '@renderer/types/agent'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { IpcChannel } from '@shared/IpcChannel'
import { throttle } from 'lodash'
import { LRUCache } from 'lru-cache'

import type { MessageDataSource } from './types'
import { extractSessionId } from './types'

const logger = loggerService.withContext('AgentMessageDataSource')

/**
 * Streaming message cache to track messages being streamed
 * Key: messageId, Value: { message, blocks, isComplete }
 */
const streamingMessageCache = new LRUCache<
  string,
  {
    message: Message
    blocks: MessageBlock[]
    isComplete: boolean
    sessionId: string
    agentSessionId?: string
  }
>({
  max: 100,
  ttl: 1000 * 60 * 5 // 5 minutes
})

/**
 * Throttled persisters for each message to batch updates during streaming
 */
const messagePersistThrottlers = new LRUCache<string, ReturnType<typeof throttle>>({
  max: 100,
  ttl: 1000 * 60 * 5
})

/**
 * IPC-based implementation of MessageDataSource
 * Handles agent session messages through backend communication
 */
export class AgentMessageDataSource implements MessageDataSource {
  // ============ Helper Methods ============

  /**
   * Get or create a throttled persister for a message
   */
  private getMessagePersister(messageId: string): ReturnType<typeof throttle> {
    if (!messagePersistThrottlers.has(messageId)) {
      const persister = throttle(async () => {
        const cached = streamingMessageCache.get(messageId)
        if (!cached) return

        const { message, blocks, sessionId, isComplete, agentSessionId } = cached
        const sessionPointer = agentSessionId ?? message.agentSessionId ?? ''

        try {
          // Persist to backend
          await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
            sessionId,
            agentSessionId: sessionPointer,
            ...(message.role === 'user'
              ? { user: { payload: { message, blocks } } }
              : { assistant: { payload: { message, blocks } } })
          })

          logger.debug(`Persisted ${isComplete ? 'complete' : 'streaming'} message ${messageId} to backend`)

          // Clean up if complete
          if (isComplete) {
            streamingMessageCache.delete(messageId)
            messagePersistThrottlers.delete(messageId)
          }
        } catch (error) {
          logger.error(`Failed to persist message ${messageId}:`, error as Error)
        }
      }, 500) // Throttle to 500ms for agent messages (less frequent than chat)

      messagePersistThrottlers.set(messageId, persister)
    }

    return messagePersistThrottlers.get(messageId)!
  }

  /**
   * Check if a message is in streaming state based on status
   */
  private isMessageStreaming(message: Partial<Message>): boolean {
    return message.status?.includes('ing') ?? false
  }

  /**
   * Clean up resources for a message
   */
  private cleanupMessage(messageId: string): void {
    streamingMessageCache.delete(messageId)
    const throttler = messagePersistThrottlers.get(messageId)
    if (throttler) {
      throttler.cancel()
      messagePersistThrottlers.delete(messageId)
    }
  }

  private mergeBlockUpdates(existingBlocks: MessageBlock[], updates: MessageBlock[]): MessageBlock[] {
    if (existingBlocks.length === 0) {
      return [...updates]
    }

    const existingById = new Map(existingBlocks.map((block) => [block.id, block]))

    for (const update of updates) {
      if (!update?.id) {
        continue
      }
      existingById.set(update.id, update)
    }

    const merged: MessageBlock[] = []

    for (const original of existingBlocks) {
      const updated = existingById.get(original.id)
      if (updated) {
        merged.push(updated)
        existingById.delete(original.id)
      }
    }

    for (const update of updates) {
      if (!update?.id) {
        continue
      }
      if (!merged.some((block) => block.id === update.id)) {
        merged.push(update)
      }
    }

    return merged
  }

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
  // oxlint-disable-next-line no-unused-vars
  async appendMessage(topicId: string, message: Message, blocks: MessageBlock[], _insertIndex?: number): Promise<void> {
    const sessionId = extractSessionId(topicId)
    if (!sessionId) {
      throw new Error(`Invalid agent session topicId: ${topicId}`)
    }

    try {
      const isStreaming = this.isMessageStreaming(message)
      const agentSessionId = message.agentSessionId ?? ''

      // Always persist immediately for visibility in UI
      const payload: AgentPersistedMessage = {
        message,
        blocks
      }

      await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
        sessionId,
        agentSessionId,
        ...(message.role === 'user' ? { user: { payload } } : { assistant: { payload } })
      })

      logger.info(`Saved ${message.role} message for agent session ${sessionId}`, {
        messageId: message.id,
        blockCount: blocks.length,
        status: message.status,
        isStreaming
      })

      // If streaming, also set up cache for throttled updates
      if (isStreaming && message.role === 'assistant') {
        streamingMessageCache.set(message.id, {
          message,
          blocks,
          isComplete: false,
          sessionId,
          agentSessionId
        })

        // Set up throttled persister for future updates
        this.getMessagePersister(message.id)

        logger.debug(`Set up streaming cache for message ${message.id}`)
      } else {
        // Clean up any streaming cache for non-streaming messages
        this.cleanupMessage(message.id)
      }
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
      const agentSessionId = updatedMessage.agentSessionId ?? existingMessage.message.agentSessionId ?? ''

      // Save updated message back to backend
      await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
        sessionId,
        agentSessionId,
        ...(updatedMessage.role === 'user'
          ? { user: { payload: { message: updatedMessage, blocks: existingMessage.blocks || [] } } }
          : { assistant: { payload: { message: updatedMessage, blocks: existingMessage.blocks || [] } } })
      })

      const cacheEntry = streamingMessageCache.get(messageId)
      if (cacheEntry) {
        streamingMessageCache.set(messageId, {
          ...cacheEntry,
          message: updatedMessage,
          agentSessionId: agentSessionId || cacheEntry.agentSessionId
        })
      }

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
      const isStreaming = this.isMessageStreaming(messageUpdates)

      // Check if we have cached data for this message
      const cached = streamingMessageCache.get(messageUpdates.id)

      if (isStreaming) {
        // During streaming, update cache and trigger throttled persist
        let currentMessage: Message
        let currentBlocks: MessageBlock[]

        if (cached) {
          // Update existing cached message
          currentMessage = { ...cached.message, ...messageUpdates }
          currentBlocks = this.mergeBlockUpdates(cached.blocks ?? [], blocksToUpdate)
        } else {
          // First streaming update - fetch from backend or create new
          const historicalMessages: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
            IpcChannel.AgentMessage_GetHistory,
            { sessionId }
          )

          const existingMessage = historicalMessages?.find((pm) => pm.message?.id === messageUpdates.id)

          if (existingMessage?.message) {
            currentMessage = { ...existingMessage.message, ...messageUpdates }
            currentBlocks = this.mergeBlockUpdates(existingMessage.blocks || [], blocksToUpdate)
          } else {
            // New message
            if (!messageUpdates.topicId || !messageUpdates.role) {
              logger.warn(`Incomplete message data for streaming message ${messageUpdates.id}`)
              return
            }
            currentMessage = messageUpdates as Message
            currentBlocks = [...blocksToUpdate]
          }
        }

        const agentSessionId = currentMessage.agentSessionId ?? cached?.agentSessionId ?? ''

        // Update cache
        streamingMessageCache.set(messageUpdates.id, {
          message: currentMessage,
          blocks: currentBlocks,
          isComplete: false,
          sessionId,
          agentSessionId
        })

        // Trigger throttled persist
        const persister = this.getMessagePersister(messageUpdates.id)
        persister()

        logger.debug(`Updated streaming cache for message ${messageUpdates.id}`, {
          status: messageUpdates.status,
          blockCount: currentBlocks.length
        })
      } else {
        // Not streaming - persist immediately
        let finalMessage: Message
        let finalBlocks: MessageBlock[]

        if (cached) {
          // Use cached data as base
          finalMessage = { ...cached.message, ...messageUpdates }
          finalBlocks = this.mergeBlockUpdates(cached.blocks ?? [], blocksToUpdate)
        } else {
          // Fetch from backend if no cache
          const historicalMessages: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
            IpcChannel.AgentMessage_GetHistory,
            { sessionId }
          )

          const existingMessage = historicalMessages?.find((pm) => pm.message?.id === messageUpdates.id)

          if (existingMessage?.message) {
            finalMessage = { ...existingMessage.message, ...messageUpdates }
            finalBlocks = this.mergeBlockUpdates(existingMessage.blocks || [], blocksToUpdate)
          } else {
            if (!messageUpdates.topicId || !messageUpdates.role) {
              logger.warn(`Incomplete message data for ${messageUpdates.id}`)
              return
            }
            finalMessage = messageUpdates as Message
            finalBlocks = [...blocksToUpdate]
          }
        }

        const agentSessionId = finalMessage.agentSessionId ?? cached?.agentSessionId ?? ''

        // Mark as complete in cache if it was streaming
        if (cached) {
          streamingMessageCache.set(messageUpdates.id, {
            message: finalMessage,
            blocks: finalBlocks,
            isComplete: true,
            sessionId,
            agentSessionId
          })
        }

        // Persist to backend
        await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
          sessionId,
          agentSessionId,
          ...(finalMessage.role === 'user'
            ? { user: { payload: { message: finalMessage, blocks: finalBlocks } } }
            : { assistant: { payload: { message: finalMessage, blocks: finalBlocks } } })
        })

        logger.info(`Persisted complete message ${messageUpdates.id} for agent session ${sessionId}`, {
          status: finalMessage.status,
          blockCount: finalBlocks.length
        })

        // Clean up
        this.cleanupMessage(messageUpdates.id)
      }
    } catch (error) {
      logger.error(`Failed to update message and blocks for agent session ${topicId}:`, error as Error)
      throw error
    }
  }

  // oxlint-disable-next-line no-unused-vars
  async deleteMessage(topicId: string, _messageId: string): Promise<void> {
    // Agent session messages cannot be deleted individually
    logger.warn(`deleteMessage called for agent session ${topicId}, operation not supported`)

    // In a full implementation, you might want to:
    // 1. Implement soft delete in backend
    // 2. Or just hide from UI without actual deletion
  }

  // oxlint-disable-next-line no-unused-vars
  async deleteMessages(topicId: string, _messageIds: string[]): Promise<void> {
    // Agent session messages cannot be deleted in batch
    logger.warn(`deleteMessages called for agent session ${topicId}, operation not supported`)

    // In a full implementation, you might want to:
    // 1. Implement batch soft delete in backend
    // 2. Update local state accordingly
  }

  // oxlint-disable-next-line no-unused-vars
  async deleteMessagesByAskId(topicId: string, _askId: string): Promise<void> {
    // Agent session messages cannot be deleted
    logger.warn(`deleteMessagesByAskId called for agent session ${topicId}, operation not supported`)
  }

  // ============ Block Operations ============

  async updateBlocks(blocks: MessageBlock[]): Promise<void> {
    if (!blocks.length) {
      return
    }

    try {
      if (!window.electron?.ipcRenderer) {
        logger.warn('IPC renderer not available for agent block update')
        return
      }

      const state = store.getState()

      const sessionMessageMap = new Map<
        string,
        Map<
          string,
          {
            message: Message | undefined
            updates: MessageBlock[]
            baseBlocks?: MessageBlock[]
          }
        >
      >()

      for (const block of blocks) {
        const messageId = block.messageId
        if (!messageId) {
          logger.warn('Skipping block update without messageId')
          continue
        }

        const cached = streamingMessageCache.get(messageId)
        const storeMessage = cached?.message ?? state.messages.entities[messageId]

        if (!storeMessage) {
          logger.warn(`Unable to locate parent message ${messageId} for block update`)
          continue
        }

        const sessionId = cached?.sessionId ?? extractSessionId(storeMessage.topicId)
        if (!sessionId) {
          logger.warn(`Unable to determine session for message ${messageId}`)
          continue
        }

        if (!sessionMessageMap.has(sessionId)) {
          sessionMessageMap.set(sessionId, new Map())
        }

        const messageMap = sessionMessageMap.get(sessionId)!
        if (!messageMap.has(messageId)) {
          messageMap.set(messageId, {
            message: storeMessage,
            updates: [],
            baseBlocks: cached?.blocks
          })
        }

        messageMap.get(messageId)!.updates.push(block)
      }

      for (const [sessionId, messageMap] of sessionMessageMap) {
        let historyMap: Map<string, AgentPersistedMessage> | null = null

        for (const [messageId, pending] of messageMap) {
          let baseBlocks = pending.baseBlocks
          let message = pending.message

          if (!baseBlocks) {
            if (!historyMap) {
              const historicalMessages: AgentPersistedMessage[] = await window.electron.ipcRenderer.invoke(
                IpcChannel.AgentMessage_GetHistory,
                { sessionId }
              )
              historyMap = new Map(
                (historicalMessages || [])
                  .filter((persisted) => persisted?.message?.id)
                  .map((persisted) => [persisted.message.id, persisted])
              )
            }

            const persisted = historyMap.get(messageId)
            if (persisted) {
              baseBlocks = persisted.blocks || []
              if (!message) {
                message = persisted.message
              }
            }
          }

          if (!message) {
            logger.warn(`Failed to resolve message payload for ${messageId}, skipping block persist`)
            continue
          }

          const mergedBlocks = this.mergeBlockUpdates(baseBlocks || [], pending.updates)
          const cacheEntry = streamingMessageCache.get(messageId)
          const agentSessionId = message.agentSessionId ?? cacheEntry?.agentSessionId ?? ''

          if (cacheEntry) {
            streamingMessageCache.set(messageId, {
              ...cacheEntry,
              blocks: mergedBlocks,
              agentSessionId
            })
          }

          await window.electron.ipcRenderer.invoke(IpcChannel.AgentMessage_PersistExchange, {
            sessionId,
            agentSessionId,
            ...(message.role === 'user'
              ? { user: { payload: { message, blocks: mergedBlocks } } }
              : { assistant: { payload: { message, blocks: mergedBlocks } } })
          })

          logger.debug(`Persisted block updates for message ${messageId} in agent session ${sessionId}`, {
            blockCount: mergedBlocks.length
          })
        }
      }
    } catch (error) {
      logger.error('Failed to update agent message blocks:', error as Error)
      throw error
    }
  }

  // oxlint-disable-next-line no-unused-vars
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

  // oxlint-disable-next-line no-unused-vars
  async updateSingleBlock(blockId: string, _updates: Partial<MessageBlock>): Promise<void> {
    // Agent session blocks are immutable once persisted
    logger.warn(`updateSingleBlock called for agent session block ${blockId}, operation not supported`)
  }

  // oxlint-disable-next-line no-unused-vars
  async bulkAddBlocks(_blocks: MessageBlock[]): Promise<void> {
    // Agent session blocks are added through persistExchange
    logger.warn(`bulkAddBlocks called for agent session, operation not supported individually`)
  }

  // oxlint-disable-next-line no-unused-vars
  async updateFileCount(fileId: string, _delta: number, _deleteIfZero?: boolean): Promise<void> {
    // Agent sessions don't manage file reference counts locally
    logger.warn(`updateFileCount called for agent session file ${fileId}, operation not supported`)
  }

  // oxlint-disable-next-line no-unused-vars
  async updateFileCounts(_files: Array<{ id: string; delta: number; deleteIfZero?: boolean }>): Promise<void> {
    // Agent sessions don't manage file reference counts locally
    logger.warn(`updateFileCounts called for agent session, operation not supported`)
  }
}
