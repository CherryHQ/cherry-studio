/**
 * @fileoverview StreamingService - Manages message streaming lifecycle and state
 *
 * This service encapsulates the streaming state management during message generation.
 * It uses CacheService (memoryCache) for temporary storage during streaming,
 * and persists final data to the database via Data API or dbService.
 *
 * Key Design Decisions:
 * - Uses messageId as primary key for tasks (supports multi-model concurrent streaming)
 * - Streaming data is stored in memory only (not Redux, not Dexie during streaming)
 * - On finalize, data is converted to new format and persisted via appropriate data source
 * - Throttling is handled externally by messageThunk.ts (preserves existing throttle logic)
 *
 * Cache Key Strategy (uses schema-defined template keys from cacheSchemas.ts):
 * - Task key: `message.streaming.task.${messageId}` - Internal task lifecycle management
 * - Topic tasks index: `message.streaming.topic_tasks.${topicId}` - Track active tasks per topic
 * - Message key: `message.streaming.content.${messageId}` - UI subscription for message-level changes
 * - Block key: `message.streaming.block.${blockId}` - UI subscription for block content updates
 * - Siblings counter: `message.streaming.siblings_counter.${topicId}` - Multi-model response group counter
 */

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { Model } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { isAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CreateMessageDto, UpdateMessageDto } from '@shared/data/api/schemas/messages'
import type { Message as SharedMessage, MessageDataBlock, MessageStats } from '@shared/data/types/message'

import { dbService } from '../db'

const logger = loggerService.withContext('StreamingService')

// Cache key generators (matches template keys in cacheSchemas.ts)
const getTaskKey = (messageId: string) => `message.streaming.task.${messageId}` as const
const getTopicTasksKey = (topicId: string) => `message.streaming.topic_tasks.${topicId}` as const
const getMessageKey = (messageId: string) => `message.streaming.content.${messageId}` as const
const getBlockKey = (blockId: string) => `message.streaming.block.${blockId}` as const
const getSiblingsGroupCounterKey = (topicId: string) => `message.streaming.siblings_counter.${topicId}` as const

// Task TTL for auto-cleanup (prevents memory leaks from crashed processes)
const TASK_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Streaming task data structure (stored in memory)
 */
interface StreamingTask {
  topicId: string
  messageId: string

  // Message data (legacy format, compatible with existing logic)
  message: Message
  blocks: Record<string, MessageBlock>

  // Tree structure information (v2 new fields)
  parentId: string // Parent message ID (user message)
  // siblingsGroupId: 0 = single model response, >0 = multi-model response group
  // Messages with the same parentId and siblingsGroupId (>0) are displayed together for comparison
  siblingsGroupId: number

  // Context for usage estimation (messages up to and including user message)
  contextMessages?: Message[]

  // Metadata
  startedAt: number
}

/**
 * Options for starting a streaming task
 *
 * NOTE: Internal naming uses v2 convention (parentId).
 * The renderer Message format uses 'askId' for backward compatibility,
 * which is set from parentId during message creation.
 */
interface StartTaskOptions {
  parentId: string
  siblingsGroupId?: number // Defaults to 0 (single model), >0 for multi-model response groups
  role: 'assistant'
  model?: Message['model']
  modelId?: string
  assistantId: string
  traceId?: string
  agentSessionId?: string
  // Context messages for usage estimation (messages up to and including user message)
  contextMessages?: Message[]
}

/**
 * Options for creating an assistant message
 */
interface CreateAssistantMessageOptions {
  parentId: string // askId (user message id)
  assistantId: string
  modelId?: string
  model?: Model
  siblingsGroupId?: number
  traceId?: string
}

/**
 * StreamingService - Manages streaming message state during generation
 *
 * Responsibilities:
 * - Task lifecycle management (start, update, finalize, end)
 * - Block operations (add, update, get)
 * - Message operations (update, get)
 * - Cache-based state management with automatic TTL cleanup
 */
class StreamingService {
  // Internal mapping: blockId -> messageId (for efficient block updates)
  private blockToMessageMap = new Map<string, string>()

  // ============ Task Lifecycle ============

  /**
   * Start a streaming task for a message
   *
   * IMPORTANT: The message must be created via Data API POST before calling this.
   * This method initializes the in-memory streaming state.
   *
   * @param topicId - Topic ID (used for topic tasks index)
   * @param messageId - Message ID returned from Data API POST
   * @param options - Task options including parentId and siblingsGroupId
   */
  startTask(topicId: string, messageId: string, options: StartTaskOptions): void {
    const {
      parentId,
      siblingsGroupId = 0,
      role,
      model,
      modelId,
      assistantId,
      traceId,
      agentSessionId,
      contextMessages
    } = options

    // Initialize message structure
    // NOTE: askId is set from parentId for renderer format compatibility (v1 uses askId, v2 uses parentId)
    const message: Message = {
      id: messageId,
      topicId,
      role,
      assistantId,
      status: AssistantMessageStatus.PENDING,
      createdAt: new Date().toISOString(),
      blocks: [],
      model,
      modelId,
      askId: parentId, // Map v2 parentId to v1 renderer format askId
      traceId,
      agentSessionId
    }

    // Create task
    const task: StreamingTask = {
      topicId,
      messageId,
      message,
      blocks: {},
      parentId,
      siblingsGroupId,
      contextMessages,
      startedAt: Date.now()
    }

    // Store task with TTL
    cacheService.set(getTaskKey(messageId), task, TASK_TTL)

    // Store message data for UI subscription
    cacheService.set(getMessageKey(messageId), message, TASK_TTL)

    // Add to topic tasks index
    const topicTasks = cacheService.get(getTopicTasksKey(topicId)) || []
    if (!topicTasks.includes(messageId)) {
      topicTasks.push(messageId)
      cacheService.set(getTopicTasksKey(topicId), topicTasks, TASK_TTL)
    }

    logger.debug('Started streaming task', { topicId, messageId, parentId, siblingsGroupId })
  }

  /**
   * Finalize a streaming task by persisting data to database
   *
   * This method:
   * 1. Converts streaming data to the appropriate format
   * 2. Routes to the appropriate data source based on topic type
   * 3. Cleans up all related cache keys
   *
   * ## Persistence Paths
   *
   * - **Normal topics** → Data API (target architecture for v2)
   * - **Agent sessions** → dbService (TEMPORARY: This is a transitional approach.
   *   Agent message storage will be migrated to Data API in a later phase.
   *   Once migration is complete, all paths will use Data API uniformly.)
   *
   * @param messageId - Task message ID
   * @param status - Final message status
   */
  async finalize(messageId: string, status: AssistantMessageStatus): Promise<void> {
    const task = this.getTask(messageId)
    if (!task) {
      logger.warn(`finalize called for non-existent task: ${messageId}`)
      return
    }

    try {
      // Route to appropriate data source based on topic type
      // TEMPORARY: Agent sessions use dbService until migration to Data API is complete
      if (isAgentSessionTopicId(task.topicId)) {
        const updatePayload = this.convertToUpdatePayload(task, status)
        await dbService.updateMessageAndBlocks(task.topicId, updatePayload.messageUpdates, updatePayload.blocks)
      } else {
        // Normal topic → Use Data API for persistence (has built-in retry)
        const dataApiPayload = this.convertToDataApiFormat(task, status)
        await dataApiService.patch(`/messages/${task.messageId}`, { body: dataApiPayload })
      }

      this.endTask(messageId)
      logger.debug('Finalized streaming task', { messageId, status })
    } catch (error) {
      logger.error('finalize failed:', error as Error)
      // Don't end task on error - TTL will auto-clean to prevent memory leak
      throw error
    }
  }

  /**
   * End a streaming task and clear all related cache keys
   *
   * @param messageId - Task message ID
   */
  endTask(messageId: string): void {
    const task = this.getTask(messageId)
    if (!task) {
      return
    }

    // Remove block mappings
    Object.keys(task.blocks).forEach((blockId) => {
      this.blockToMessageMap.delete(blockId)
      cacheService.delete(getBlockKey(blockId))
    })

    // Remove message cache
    cacheService.delete(getMessageKey(messageId))

    // Remove from topic tasks index
    const topicTasks = cacheService.get(getTopicTasksKey(task.topicId)) || []
    const updatedTopicTasks = topicTasks.filter((id: string) => id !== messageId)
    if (updatedTopicTasks.length > 0) {
      cacheService.set(getTopicTasksKey(task.topicId), updatedTopicTasks, TASK_TTL)
    } else {
      cacheService.delete(getTopicTasksKey(task.topicId))
    }

    // Remove task
    cacheService.delete(getTaskKey(messageId))

    logger.debug('Ended streaming task', { messageId, topicId: task.topicId })
  }

  // ============ Block Operations ============

  /**
   * Add a new block to a streaming task
   * (Replaces dispatch(upsertOneBlock))
   *
   * @param messageId - Parent message ID
   * @param block - Block to add
   */
  addBlock(messageId: string, block: MessageBlock): void {
    const task = this.getTask(messageId)
    if (!task) {
      logger.warn(`addBlock called for non-existent task: ${messageId}`)
      return
    }

    // Register block mapping
    this.blockToMessageMap.set(block.id, messageId)

    // Create new message with updated blocks (immutable update for cache notification)
    const newMessage: Message = {
      ...task.message,
      blocks: task.message.blocks.includes(block.id) ? task.message.blocks : [...task.message.blocks, block.id]
    }

    // Create new task with updated blocks and message (immutable update for cache notification)
    const newTask: StreamingTask = {
      ...task,
      blocks: { ...task.blocks, [block.id]: block },
      message: newMessage
    }

    // Update caches with new references to trigger notifications
    cacheService.set(getTaskKey(messageId), newTask, TASK_TTL)
    cacheService.set(getBlockKey(block.id), block, TASK_TTL)
    cacheService.set(getMessageKey(messageId), newMessage, TASK_TTL)

    logger.debug('Added block to task', { messageId, blockId: block.id, blockType: block.type })
  }

  /**
   * Update a block in a streaming task
   * (Replaces dispatch(updateOneBlock))
   *
   * NOTE: This method does NOT include throttling. Throttling is controlled
   * by the existing throttler in messageThunk.ts.
   *
   * @param blockId - Block ID to update
   * @param changes - Partial block changes
   */
  updateBlock(blockId: string, changes: Partial<MessageBlock>): void {
    const messageId = this.blockToMessageMap.get(blockId)
    if (!messageId) {
      logger.warn(`updateBlock: Block ${blockId} not found in blockToMessageMap`)
      return
    }

    const task = this.getTask(messageId)
    if (!task) {
      logger.warn(`updateBlock: Task not found for message ${messageId}`)
      return
    }

    const existingBlock = task.blocks[blockId]
    if (!existingBlock) {
      logger.warn(`updateBlock: Block ${blockId} not found in task`)
      return
    }

    // Merge changes - use type assertion since we're updating the same block type
    const updatedBlock = { ...existingBlock, ...changes } as MessageBlock

    // Create new task with updated block (immutable update for cache notification)
    const newTask: StreamingTask = {
      ...task,
      blocks: { ...task.blocks, [blockId]: updatedBlock }
    }

    // Update caches with new references to trigger notifications
    cacheService.set(getTaskKey(messageId), newTask, TASK_TTL)
    cacheService.set(getBlockKey(blockId), updatedBlock, TASK_TTL)
  }

  /**
   * Get a block from the streaming task
   *
   * @param blockId - Block ID
   * @returns Block or null if not found
   */
  getBlock(blockId: string): MessageBlock | null {
    return cacheService.get(getBlockKey(blockId)) || null
  }

  // ============ Message Operations ============

  /**
   * Update message properties in the streaming task
   * (Replaces dispatch(newMessagesActions.updateMessage))
   *
   * @param messageId - Message ID
   * @param updates - Partial message updates
   */
  updateMessage(messageId: string, updates: Partial<Message>): void {
    const task = this.getTask(messageId)
    if (!task) {
      logger.warn(`updateMessage called for non-existent task: ${messageId}`)
      return
    }

    // Create new message with updates (immutable update for cache notification)
    const newMessage = { ...task.message, ...updates }

    // Create new task with updated message (immutable update for cache notification)
    const newTask: StreamingTask = {
      ...task,
      message: newMessage
    }

    // Update caches with new references to trigger notifications
    cacheService.set(getTaskKey(messageId), newTask, TASK_TTL)
    cacheService.set(getMessageKey(messageId), newMessage, TASK_TTL)
  }

  /**
   * Get a message from the streaming task
   *
   * @param messageId - Message ID
   * @returns Message or null if not found
   */
  getMessage(messageId: string): Message | null {
    return cacheService.get(getMessageKey(messageId)) || null
  }

  // ============ Query Methods ============

  /**
   * Check if a topic has any active streaming tasks
   *
   * @param topicId - Topic ID
   * @returns True if streaming is active
   */
  isStreaming(topicId: string): boolean {
    const topicTasks = cacheService.get(getTopicTasksKey(topicId)) || []
    return topicTasks.length > 0
  }

  /**
   * Check if a specific message is currently streaming
   *
   * @param messageId - Message ID
   * @returns True if message is streaming
   */
  isMessageStreaming(messageId: string): boolean {
    return cacheService.has(getTaskKey(messageId))
  }

  /**
   * Get the streaming task for a message
   *
   * @param messageId - Message ID
   * @returns Task or null if not found
   */
  getTask(messageId: string): StreamingTask | null {
    return cacheService.get(getTaskKey(messageId)) || null
  }

  /**
   * Get all active streaming message IDs for a topic
   *
   * @param topicId - Topic ID
   * @returns Array of message IDs
   */
  getActiveMessageIds(topicId: string): string[] {
    return cacheService.get(getTopicTasksKey(topicId)) || []
  }

  // ============ siblingsGroupId Generation ============

  /**
   * Generate the next siblingsGroupId for a topic.
   *
   * ## siblingsGroupId Semantics
   *
   * - **0** = Single-model response (one assistant message per user message)
   * - **>0** = Multi-model response group (multiple assistant messages sharing
   *   the same parentId belong to the same sibling group for parallel comparison)
   *
   * This method is used for multi-model responses where multiple assistant messages
   * share the same parentId and siblingsGroupId (>0).
   *
   * The counter is stored in CacheService and auto-increments per topic.
   * Single-model responses should use siblingsGroupId=0 (not generated here).
   *
   * @param topicId - Topic ID
   * @returns Next siblingsGroupId (always > 0 for multi-model groups)
   */
  //FIXME [v2] 现在获取 siblingsGroupId 的方式是不正确，后续再做修改调整
  generateNextGroupId(topicId: string): number {
    const counterKey = getSiblingsGroupCounterKey(topicId)
    const currentCounter = cacheService.get(counterKey) || 0
    const nextGroupId = currentCounter + 1
    // Store with no TTL (persistent within task lifecycle, cleared on app restart)
    cacheService.set(counterKey, nextGroupId)
    logger.debug('Generated siblingsGroupId', { topicId, siblingsGroupId: nextGroupId })
    return nextGroupId
  }

  // ============ User Message Creation ============

  /**
   * Create a user message via Data API
   *
   * The message ID is generated by the server, not locally.
   * Block IDs remain client-generated for Redux store use.
   *
   * TRADEOFF: Not passing parentId - Data API will use topic.activeNodeId as parent.
   * In multi-window/multi-branch scenarios, this may cause incorrect associations
   * if activeNodeId was changed by another window.
   * TODO: In the future, parentId should come from the full message tree
   * maintained in the topic UI, not from topic.activeNodeId.
   *
   * @param topicId - Topic ID
   * @param message - Renderer format message (message.id will be ignored, server generates ID)
   * @param blocks - Renderer format blocks (block IDs preserved for Redux)
   * @returns Message with server-generated ID and original block IDs
   */
  async createUserMessage(topicId: string, message: Message, blocks: MessageBlock[]): Promise<Message> {
    // Convert blocks to MessageDataBlock format (remove id, status, messageId)
    const dataBlocks = this.convertBlocksToDataFormat(blocks)

    // Build CreateMessageDto (parentId omitted - API uses topic.activeNodeId)
    const createDto: CreateMessageDto = {
      role: 'user',
      data: { blocks: dataBlocks },
      status: 'success',
      traceId: message.traceId ?? undefined
    }

    // POST to Data API - server generates message ID
    const sharedMessage = await dataApiService.post(`/topics/${topicId}/messages`, { body: createDto })

    logger.debug('Created user message via Data API', { topicId, messageId: sharedMessage.id })

    // Return message with server ID, preserving other fields from original message
    return {
      ...message,
      id: sharedMessage.id, // Use server-generated ID
      blocks: blocks.map((b) => b.id) // Preserve client-generated block IDs
    }
  }

  // ============ Assistant Message Creation ============

  /**
   * Create an assistant message via Data API
   *
   * The message ID is generated by the server, not locally.
   * This method is used for normal topics only (not agent sessions).
   *
   * @param topicId - Topic ID
   * @param options - Creation options including parentId, assistantId, modelId
   * @returns Message with server-generated ID in renderer format
   */
  async createAssistantMessage(topicId: string, options: CreateAssistantMessageOptions): Promise<Message> {
    const { parentId, assistantId, modelId, model, siblingsGroupId = 0, traceId } = options

    const createDto: CreateMessageDto = {
      parentId,
      role: 'assistant',
      data: { blocks: [] },
      status: 'pending',
      siblingsGroupId,
      assistantId,
      modelId,
      traceId
    }

    const sharedMessage = (await dataApiService.post(`/topics/${topicId}/messages`, {
      body: createDto
    })) as SharedMessage

    logger.debug('Created assistant message via Data API', { topicId, messageId: sharedMessage.id })

    return this.convertSharedToRendererMessage(sharedMessage, assistantId, model)
  }

  // ============ Internal Methods ============

  /**
   * Convert shared Message format (from Data API) to renderer Message format
   *
   * For newly created pending messages, blocks are empty.
   *
   * NOTE: Field mapping for backward compatibility:
   * - shared.parentId (v2 Data API) → askId (v1 renderer format)
   *
   * @param shared - Message from Data API response
   * @param assistantId - Assistant ID to include
   * @param model - Optional Model object to include
   * @returns Renderer-format Message
   */
  private convertSharedToRendererMessage(shared: SharedMessage, assistantId: string, model?: Model): Message {
    return {
      id: shared.id,
      topicId: shared.topicId,
      role: shared.role,
      assistantId,
      status: shared.status as AssistantMessageStatus,
      blocks: [], // For new pending messages, blocks are empty
      createdAt: shared.createdAt,
      // v2 Data API uses 'parentId'; renderer format uses 'askId' for backward compatibility
      askId: shared.parentId ?? undefined,
      modelId: shared.modelId ?? undefined,
      traceId: shared.traceId ?? undefined,
      model
    }
  }

  /**
   * Convert renderer MessageBlock[] to shared MessageDataBlock[]
   * Removes renderer-specific fields: id, status, messageId
   */
  private convertBlocksToDataFormat(blocks: MessageBlock[]): MessageDataBlock[] {
    return blocks.map((block) => {
      // oxlint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, status, messageId, ...blockData } = block as MessageBlock & { messageId?: string }
      return blockData as unknown as MessageDataBlock
    })
  }

  /**
   * Convert task data to database update payload
   *
   * @param task - Streaming task
   * @param status - Final message status
   * @returns Update payload for database
   */
  private convertToUpdatePayload(
    task: StreamingTask,
    status: AssistantMessageStatus
  ): {
    messageUpdates: Partial<Message> & Pick<Message, 'id'>
    blocks: MessageBlock[]
  } {
    const blocks = Object.values(task.blocks)

    // Ensure all blocks have final status
    // Use type assertion since we're only updating the status field
    const finalizedBlocks: MessageBlock[] = blocks.map((block) => {
      if (block.status === MessageBlockStatus.STREAMING || block.status === MessageBlockStatus.PROCESSING) {
        const finalizedBlock = {
          ...block,
          status: status === AssistantMessageStatus.SUCCESS ? MessageBlockStatus.SUCCESS : MessageBlockStatus.ERROR
        }
        return finalizedBlock as typeof block
      }
      return block
    })

    const messageUpdates: Partial<Message> & Pick<Message, 'id'> = {
      id: task.messageId,
      status,
      blocks: task.message.blocks,
      updatedAt: new Date().toISOString(),
      // Include usage and metrics if available
      ...(task.message.usage && { usage: task.message.usage }),
      ...(task.message.metrics && { metrics: task.message.metrics })
    }

    return {
      messageUpdates,
      blocks: finalizedBlocks
    }
  }

  /**
   * Convert task data to Data API UpdateMessageDto format
   *
   * Converts from renderer format (MessageBlock with id/status) to
   * shared format (MessageDataBlock without id/status) for Data API persistence.
   *
   * @param task - Streaming task
   * @param status - Final message status
   * @returns UpdateMessageDto for Data API PATCH request
   */
  private convertToDataApiFormat(task: StreamingTask, status: AssistantMessageStatus): UpdateMessageDto {
    const blocks = Object.values(task.blocks)

    // Convert MessageBlock[] to MessageDataBlock[]
    // Remove id, status, messageId fields as they are renderer-specific, not part of MessageDataBlock
    // TRADEOFF: Using 'as unknown as' because renderer's MessageBlockType and shared's BlockType
    // are structurally identical but TypeScript treats them as incompatible enums.
    const dataBlocks: MessageDataBlock[] = blocks.map((block) => {
      // oxlint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, status, messageId, ...blockData } = block as MessageBlock & { messageId?: string }
      return blockData as unknown as MessageDataBlock
    })

    // Build MessageStats from usage and metrics
    // Note: Renderer uses 'time_first_token_millsec' while shared uses 'timeFirstTokenMs'
    const stats: MessageStats | undefined =
      task.message.usage || task.message.metrics
        ? {
            promptTokens: task.message.usage?.prompt_tokens,
            completionTokens: task.message.usage?.completion_tokens,
            totalTokens: task.message.usage?.total_tokens,
            timeFirstTokenMs: task.message.metrics?.time_first_token_millsec,
            timeCompletionMs: task.message.metrics?.time_completion_millsec
          }
        : undefined

    return {
      data: { blocks: dataBlocks },
      status: status as 'pending' | 'success' | 'error' | 'paused',
      ...(stats && { stats })
    }
  }
}

// Export singleton instance
export const streamingService = new StreamingService()

// Also export class for testing
export { StreamingService }
export type { StartTaskOptions, StreamingTask }
