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

const logger = loggerService.withContext('AnthropicImporter')

/**
 * Anthropic Claude Export Format Types
 */
interface AnthropicCitation {
  uuid: string
  start_index: number
  end_index: number
  details: {
    type: string
    url: string
  }
}

interface AnthropicAttachment {
  file_name: string
  file_size?: number
  file_type?: string
  extracted_content?: string
}

interface AnthropicFile {
  file_name: string
}

interface AnthropicToolResultItem {
  type: string
  title?: string
  url?: string
  text?: string
  is_missing?: boolean
  metadata?: {
    type: string
    site_domain?: string
    favicon_url?: string
    site_name?: string
  }
}

interface AnthropicContentBlock {
  type: string
  text?: string
  start_timestamp?: string | null
  stop_timestamp?: string | null
  flags?: null
  citations?: AnthropicCitation[]
  // tool_use fields
  id?: string
  name?: string
  input?: Record<string, string | number | boolean | null>
  message?: string | null
  // tool_result fields
  tool_use_id?: string
  content?: AnthropicToolResultItem[]
}

interface AnthropicMessage {
  uuid: string
  text: string
  content: AnthropicContentBlock[]
  sender: 'human' | 'assistant'
  created_at: string
  updated_at: string
  attachments?: AnthropicAttachment[]
  files?: AnthropicFile[]
}

interface AnthropicConversation {
  uuid: string
  name: string
  summary?: string
  created_at: string
  updated_at: string
  account?: { uuid: string }
  chat_messages: AnthropicMessage[]
}

/**
 * Anthropic Claude conversation importer
 * Handles importing conversations from Claude's conversations.json export format
 */
export class AnthropicImporter implements ConversationImporter {
  readonly name = 'Claude'
  readonly emoji = '💬'

  /**
   * Validate if the file content is a valid Anthropic Claude export
   */
  validate(fileContent: string): boolean {
    try {
      const parsed = JSON.parse(fileContent)
      const conversations = Array.isArray(parsed) ? parsed : [parsed]

      return conversations.every(
        (conv) =>
          conv &&
          typeof conv === 'object' &&
          'uuid' in conv &&
          'chat_messages' in conv &&
          Array.isArray(conv.chat_messages) &&
          'created_at' in conv &&
          // Distinguish from ChatGPT format which uses 'mapping'
          !('mapping' in conv)
      )
    } catch {
      return false
    }
  }

  /**
   * Parse Anthropic conversations and convert to unified format
   */
  async parse(fileContent: string, assistantId: string): Promise<ImportResult> {
    logger.info('Starting Anthropic Claude import...')

    const parsed = JSON.parse(fileContent)
    const conversations: AnthropicConversation[] = Array.isArray(parsed) ? parsed : [parsed]

    if (!conversations || conversations.length === 0) {
      throw new Error(i18n.t('import.claude.error.no_conversations'))
    }

    logger.info(`Found ${conversations.length} conversations`)

    const topics: Topic[] = []
    const allMessages: Message[] = []
    const allBlocks: MainTextMessageBlock[] = []

    for (const conversation of conversations) {
      try {
        const result = this.convertConversationToTopic(conversation, assistantId)
        if (!result) continue
        const { topic, messages, blocks } = result
        topics.push(topic)
        allMessages.push(...messages)
        allBlocks.push(...blocks)
      } catch (convError) {
        logger.warn(`Failed to convert conversation "${conversation.name}":`, convError as Error)
      }
    }

    if (topics.length === 0) {
      throw new Error(i18n.t('import.claude.error.no_valid_conversations'))
    }

    return {
      topics,
      messages: allMessages,
      blocks: allBlocks
    }
  }

  /**
   * Extract text content from Anthropic content blocks
   */
  private extractTextContent(message: AnthropicMessage): string {
    // Prefer content array if available
    if (message.content && message.content.length > 0) {
      const textParts = message.content
        .filter((block) => block.type === 'text' && block.text && block.text.trim().length > 0)
        .map((block) => block.text!.trim())

      if (textParts.length > 0) {
        return textParts.join('\n\n')
      }
    }

    // Fallback to top-level text field
    return message.text?.trim() ?? ''
  }

  /**
   * Create Message and MessageBlock from an Anthropic message
   */
  private createMessageAndBlock(
    anthropicMessage: AnthropicMessage,
    topicId: string,
    assistantId: string
  ): { message: Message; block: MainTextMessageBlock } {
    const messageId = uuid()
    const blockId = uuid()
    const role = anthropicMessage.sender === 'human' ? 'user' : 'assistant'
    const content = this.extractTextContent(anthropicMessage)

    const createdAt = anthropicMessage.created_at ?? new Date().toISOString()

    const message: Message = {
      id: messageId,
      role,
      assistantId,
      topicId,
      createdAt,
      updatedAt: anthropicMessage.updated_at ?? createdAt,
      status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
      blocks: [blockId],
      // Set model for assistant messages to display Claude logo
      ...(role === 'assistant' && {
        model: {
          id: 'claude-sonnet-4-6',
          provider: 'anthropic',
          name: 'Claude Sonnet 4.6',
          group: 'Claude 4.6'
        }
      })
    }

    const block: MainTextMessageBlock = {
      id: blockId,
      messageId,
      type: MessageBlockType.MAIN_TEXT,
      content,
      createdAt,
      updatedAt: anthropicMessage.updated_at ?? createdAt,
      status: MessageBlockStatus.SUCCESS
    }

    return { message, block }
  }

  /**
   * Convert Anthropic conversation to Cherry Studio Topic.
   * Returns null if the conversation has no usable message content.
   */
  private convertConversationToTopic(
    conversation: AnthropicConversation,
    assistantId: string
  ): { topic: Topic; messages: Message[]; blocks: MainTextMessageBlock[] } | null {
    const topicId = uuid()
    const messages: Message[] = []
    const blocks: MainTextMessageBlock[] = []

    // Filter out messages with no usable content
    const validMessages = (conversation.chat_messages ?? []).filter((msg) => {
      const text = this.extractTextContent(msg)
      return text.length > 0
    })

    // Skip entirely empty conversations
    if (validMessages.length === 0) {
      return null
    }

    for (const msg of validMessages) {
      const { message, block } = this.createMessageAndBlock(msg, topicId, assistantId)
      messages.push(message)
      blocks.push(block)
    }

    const title =
      (conversation.name && conversation.name.trim()) ||
      (conversation.summary && conversation.summary.trim()) ||
      i18n.t('import.claude.untitled_conversation')

    const topic: Topic = {
      id: topicId,
      assistantId,
      name: title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      messages,
      isNameManuallyEdited: !!(conversation.name && conversation.name.trim())
    }

    return { topic, messages, blocks }
  }
}
