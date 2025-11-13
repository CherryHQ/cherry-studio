import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'

import type { ConversationImporter, ImportResult } from '../types'

const logger = loggerService.withContext('ChatGPTImporter')

/**
 * ChatGPT Export Format Types
 */
interface ChatGPTMessage {
  id: string
  author: {
    role: 'user' | 'assistant' | 'system' | 'tool'
  }
  content: {
    content_type: string
    parts?: string[]
  }
  metadata?: any
  create_time?: number
}

interface ChatGPTNode {
  id: string
  message?: ChatGPTMessage
  parent?: string
  children?: string[]
}

interface ChatGPTConversation {
  title: string
  create_time: number
  update_time: number
  mapping: Record<string, ChatGPTNode>
  current_node?: string
}

/**
 * ChatGPT conversation importer
 * Handles importing conversations from ChatGPT's conversations.json export format
 */
export class ChatGPTImporter implements ConversationImporter {
  readonly name = 'ChatGPT'
  readonly emoji = '💬'

  /**
   * Validate if the file content is a valid ChatGPT export
   */
  validate(fileContent: string): boolean {
    try {
      const parsed = JSON.parse(fileContent)
      const conversations = Array.isArray(parsed) ? parsed : [parsed]

      // Check if it has the basic ChatGPT conversation structure
      return conversations.every(
        (conv) =>
          conv &&
          typeof conv === 'object' &&
          'mapping' in conv &&
          typeof conv.mapping === 'object' &&
          'title' in conv &&
          'create_time' in conv
      )
    } catch {
      return false
    }
  }

  /**
   * Parse ChatGPT conversations and convert to unified format
   */
  async parse(fileContent: string, assistantId: string): Promise<ImportResult> {
    logger.info('Starting ChatGPT import...')

    // Parse JSON
    const parsed = JSON.parse(fileContent)
    const conversations: ChatGPTConversation[] = Array.isArray(parsed) ? parsed : [parsed]

    if (!conversations || conversations.length === 0) {
      throw new Error(i18n.t('import.chatgpt.error.no_conversations'))
    }

    logger.info(`Found ${conversations.length} conversations`)

    const topics: Topic[] = []
    const allMessages: Message[] = []
    const allBlocks: MainTextMessageBlock[] = []

    // Convert each conversation
    for (const conversation of conversations) {
      try {
        const { topic, messages, blocks } = this.convertConversationToTopic(conversation, assistantId)
        topics.push(topic)
        allMessages.push(...messages)
        allBlocks.push(...blocks)
      } catch (convError) {
        logger.warn(`Failed to convert conversation "${conversation.title}":`, convError as Error)
        // Continue with other conversations
      }
    }

    if (topics.length === 0) {
      throw new Error(i18n.t('import.chatgpt.error.no_valid_conversations'))
    }

    return {
      topics,
      messages: allMessages,
      blocks: allBlocks
    }
  }

  /**
   * Extract main conversation thread from ChatGPT's tree structure
   * Traces back from current_node to root to get the main conversation path
   */
  private extractMainThread(mapping: Record<string, ChatGPTNode>, currentNode?: string): ChatGPTMessage[] {
    const messages: ChatGPTMessage[] = []
    const nodeIds: string[] = []

    // Start from current_node or find the last node
    let nodeId = currentNode
    if (!nodeId) {
      // Find node with no children (leaf node)
      const leafNodes = Object.entries(mapping).filter(([, node]) => !node.children || node.children.length === 0)
      if (leafNodes.length > 0) {
        nodeId = leafNodes[0][0]
      }
    }

    // Trace back to root
    while (nodeId) {
      const node = mapping[nodeId]
      if (!node) break

      nodeIds.unshift(nodeId)
      nodeId = node.parent
    }

    // Extract messages from the path
    for (const id of nodeIds) {
      const node = mapping[id]
      if (node?.message) {
        const message = node.message
        // Filter out empty messages and tool messages
        if (
          message.author.role !== 'tool' &&
          message.content?.parts &&
          message.content.parts.length > 0 &&
          message.content.parts.some((part) => part && part.trim().length > 0)
        ) {
          messages.push(message)
        }
      }
    }

    return messages
  }

  /**
   * Map ChatGPT role to Cherry Studio role
   */
  private mapRole(chatgptRole: string): 'user' | 'assistant' | 'system' {
    if (chatgptRole === 'user') return 'user'
    if (chatgptRole === 'assistant') return 'assistant'
    return 'system'
  }

  /**
   * Create Message and MessageBlock from ChatGPT message
   */
  private createMessageAndBlock(
    chatgptMessage: ChatGPTMessage,
    topicId: string,
    assistantId: string
  ): { message: Message; block: MainTextMessageBlock } {
    const messageId = uuid()
    const blockId = uuid()
    const role = this.mapRole(chatgptMessage.author.role)

    // Extract text content from parts
    const content = (chatgptMessage.content?.parts || []).filter((part) => part && part.trim()).join('\n\n')

    const createdAt = chatgptMessage.create_time
      ? new Date(chatgptMessage.create_time * 1000).toISOString()
      : new Date().toISOString()

    // Create message
    const message: Message = {
      id: messageId,
      role,
      assistantId,
      topicId,
      createdAt,
      updatedAt: createdAt,
      status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
      blocks: [blockId]
    }

    // Create block
    const block: MainTextMessageBlock = {
      id: blockId,
      messageId,
      type: MessageBlockType.MAIN_TEXT,
      content,
      createdAt,
      updatedAt: createdAt,
      status: MessageBlockStatus.SUCCESS
    }

    return { message, block }
  }

  /**
   * Convert ChatGPT conversation to Cherry Studio Topic
   */
  private convertConversationToTopic(
    conversation: ChatGPTConversation,
    assistantId: string
  ): { topic: Topic; messages: Message[]; blocks: MainTextMessageBlock[] } {
    const topicId = uuid()
    const messages: Message[] = []
    const blocks: MainTextMessageBlock[] = []

    // Extract main thread messages
    const chatgptMessages = this.extractMainThread(conversation.mapping, conversation.current_node)

    // Convert each message
    for (const chatgptMessage of chatgptMessages) {
      const { message, block } = this.createMessageAndBlock(chatgptMessage, topicId, assistantId)
      messages.push(message)
      blocks.push(block)
    }

    // Create topic
    const topic: Topic = {
      id: topicId,
      assistantId,
      name: conversation.title || i18n.t('import.chatgpt.untitled_conversation'),
      createdAt: new Date(conversation.create_time * 1000).toISOString(),
      updatedAt: new Date(conversation.update_time * 1000).toISOString(),
      messages,
      isNameManuallyEdited: true
    }

    return { topic, messages, blocks }
  }
}
