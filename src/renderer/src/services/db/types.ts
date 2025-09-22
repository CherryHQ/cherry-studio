import type { Message, MessageBlock } from '@renderer/types/newMessage'

/**
 * Message exchange data structure for persisting user-assistant conversations
 */
export interface MessageExchange {
  user?: {
    message: Message
    blocks: MessageBlock[]
  }
  assistant?: {
    message: Message
    blocks: MessageBlock[]
  }
  // For agent sessions
  agentSessionId?: string
}

/**
 * Unified interface for message data operations
 * Implementations can be backed by Dexie, IPC, or other storage mechanisms
 */
export interface MessageDataSource {
  // ============ Read Operations ============
  /**
   * Fetch all messages and blocks for a topic
   */
  fetchMessages(
    topicId: string,
    forceReload?: boolean
  ): Promise<{
    messages: Message[]
    blocks: MessageBlock[]
  }>

  /**
   * Get raw topic data (just id and messages)
   */
  getRawTopic(topicId: string): Promise<{ id: string; messages: Message[] } | undefined>

  // ============ Write Operations ============
  /**
   * Append a single message with its blocks
   */
  appendMessage(topicId: string, message: Message, blocks: MessageBlock[], insertIndex?: number): Promise<void>

  /**
   * Update an existing message
   */
  updateMessage(topicId: string, messageId: string, updates: Partial<Message>): Promise<void>

  /**
   * Update existing message and its blocks
   */
  updateMessageAndBlocks(
    topicId: string,
    messageUpdates: Partial<Message> & Pick<Message, 'id'>,
    blocksToUpdate: MessageBlock[]
  ): Promise<void>

  /**
   * Delete a single message and its blocks
   */
  deleteMessage(topicId: string, messageId: string): Promise<void>

  /**
   * Delete multiple messages and their blocks
   */
  deleteMessages(topicId: string, messageIds: string[]): Promise<void>

  // ============ Block Operations ============
  /**
   * Update multiple blocks
   */
  updateBlocks(blocks: MessageBlock[]): Promise<void>

  /**
   * Update single block
   */
  updateSingleBlock?(blockId: string, updates: Partial<MessageBlock>): Promise<void>

  /**
   * Bulk add blocks (for cloning operations)
   */
  bulkAddBlocks?(blocks: MessageBlock[]): Promise<void>

  /**
   * Delete multiple blocks
   */
  deleteBlocks(blockIds: string[]): Promise<void>

  // ============ Batch Operations ============
  /**
   * Clear all messages in a topic
   */
  clearMessages(topicId: string): Promise<void>

  /**
   * Check if topic exists
   */
  topicExists(topicId: string): Promise<boolean>

  /**
   * Create or ensure topic exists
   */
  ensureTopic(topicId: string): Promise<void>

  // ============ File Operations (Optional) ============

  /**
   * Update file reference count
   * @param fileId - The file ID to update
   * @param delta - The change in reference count (positive or negative)
   * @param deleteIfZero - Whether to delete the file when count reaches 0
   */
  updateFileCount?(fileId: string, delta: number, deleteIfZero?: boolean): Promise<void>

  /**
   * Update multiple file reference counts
   */
  updateFileCounts?(files: Array<{ id: string; delta: number; deleteIfZero?: boolean }>): Promise<void>
}

/**
 * Type guard to check if a topic ID is for an agent session
 */
export function isAgentSessionTopicId(topicId: string): boolean {
  return topicId.startsWith('agent-session:')
}

/**
 * Extract session ID from agent session topic ID
 */
export function extractSessionId(topicId: string): string {
  return topicId.replace('agent-session:', '')
}

/**
 * Build agent session topic ID from session ID
 */
export function buildAgentSessionTopicId(sessionId: string): string {
  return `agent-session:${sessionId}`
}
