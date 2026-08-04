import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  MessageBlockStatus,
  MessageBlockType,
  type ThinkingMessageBlock,
  UserMessageStatus
} from '@renderer/types/newMessage'
import type { Topic } from '@renderer/types/topic'
import { uuid } from '@renderer/utils/uuid'

import type { ConversationImporter, ImportMessageBlock, ImportResult, ImportToolMessageBlock } from '../types'

const logger = loggerService.withContext('AnthropicImporter')

interface AnthropicToolResultContent {
  text: string
}

interface AnthropicTextBlock {
  type: 'text'
  text: string
}

interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
  start_timestamp: string
  stop_timestamp: string
}

interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string | null
  name: string
  input: Record<string, unknown>
}

interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string | null
  content: AnthropicToolResultContent[]
  is_error: boolean
}

interface AnthropicTokenBudgetBlock {
  type: 'token_budget'
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicTokenBudgetBlock

interface AnthropicMessage {
  uuid: string
  text: string
  content: AnthropicContentBlock[]
  sender: 'human' | 'assistant'
  created_at: string
  updated_at: string
}

interface AnthropicConversation {
  uuid: string
  name: string
  summary: string
  created_at: string
  updated_at: string
  chat_messages: AnthropicMessage[]
}

/**
 * Anthropic Claude conversation importer
 * Handles importing conversations from Claude's conversations.json export format
 */
export class AnthropicImporter implements ConversationImporter {
  readonly name = 'Claude'
  readonly emoji = '🍒'

  /**
   * Validate if the file content is a valid Anthropic Claude export
   */
  validate(fileContent: string): boolean {
    try {
      const parsed = JSON.parse(fileContent)
      return (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(({ uuid, created_at, chat_messages }) => uuid && created_at && Array.isArray(chat_messages))
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

    const conversations = JSON.parse(fileContent) as AnthropicConversation[]

    if (conversations.length === 0) {
      throw new Error(i18n.t('import.claude.error.no_conversations'))
    }

    logger.info(`Found ${conversations.length} conversations`)

    const topics: Topic[] = []
    const allMessages: Message[] = []
    const allBlocks: ImportMessageBlock[] = []

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
   * Check if a message has any usable content (text, thinking, or tool calls)
   */
  private hasUsableContent(message: AnthropicMessage): boolean {
    return (
      message.text.trim().length > 0 ||
      message.content.some((block) => block.type === 'tool_use' || block.type === 'thinking')
    )
  }

  /**
   * Extract text from tool_result content items
   */
  private extractToolResultContent(block: AnthropicToolResultBlock): string {
    return block.content.map((item) => item.text).join('\n\n')
  }

  private createMainTextBlock(
    messageId: string,
    content: string,
    createdAt: string,
    updatedAt: string
  ): MainTextMessageBlock {
    return {
      id: uuid(),
      messageId,
      type: MessageBlockType.MAIN_TEXT,
      content,
      createdAt,
      updatedAt,
      status: MessageBlockStatus.SUCCESS
    }
  }

  /**
   * Create Message and MessageBlocks from an Anthropic message.
   * Handles text, thinking, tool_use, and tool_result content blocks.
   */
  private createMessageAndBlocks(
    anthropicMessage: AnthropicMessage,
    topicId: string,
    assistantId: string
  ): { message: Message; blocks: ImportMessageBlock[] } {
    const messageId = uuid()
    const role = anthropicMessage.sender === 'human' ? 'user' : 'assistant'
    const createdAt = anthropicMessage.created_at
    const updatedAt = anthropicMessage.updated_at

    const blocks: ImportMessageBlock[] = []
    const contentBlocks = anthropicMessage.content

    // Index tool_result blocks by their tool_use_id for O(1) lookup
    const toolResultMap = new Map<string, AnthropicToolResultBlock>()
    const anonymousToolResults: AnthropicToolResultBlock[] = []
    for (const block of contentBlocks) {
      if (block.type !== 'tool_result') continue
      if (block.tool_use_id) {
        toolResultMap.set(block.tool_use_id, block)
      } else {
        anonymousToolResults.push(block)
      }
    }

    // Iterate content blocks in order, building typed blocks
    let anonymousToolIndex = 0
    let hasTextBlock = false
    for (const contentBlock of contentBlocks) {
      switch (contentBlock.type) {
        case 'text': {
          const content = contentBlock.text.trim()
          if (!content) break

          blocks.push(this.createMainTextBlock(messageId, content, createdAt, updatedAt))
          hasTextBlock = true
          break
        }

        case 'thinking': {
          const thinkingMs =
            new Date(contentBlock.stop_timestamp).getTime() - new Date(contentBlock.start_timestamp).getTime()

          const thinkingBlock: ThinkingMessageBlock = {
            id: uuid(),
            messageId,
            type: MessageBlockType.THINKING,
            content: contentBlock.thinking,
            thinking_millsec: thinkingMs,
            createdAt,
            updatedAt,
            status: MessageBlockStatus.SUCCESS
          }
          blocks.push(thinkingBlock)
          break
        }

        case 'tool_use': {
          const toolId = contentBlock.id ?? `${anthropicMessage.uuid}-tool-${anonymousToolIndex}`
          const toolResult = contentBlock.id
            ? toolResultMap.get(contentBlock.id)
            : anonymousToolResults[anonymousToolIndex++]

          const toolBlock: ImportToolMessageBlock = {
            id: uuid(),
            messageId,
            type: MessageBlockType.TOOL,
            toolId,
            toolName: contentBlock.name,
            arguments: contentBlock.input,
            createdAt,
            updatedAt,
            ...(toolResult?.is_error
              ? { content: this.extractToolResultContent(toolResult), status: MessageBlockStatus.ERROR }
              : {
                  content: toolResult ? this.extractToolResultContent(toolResult) : undefined,
                  status: MessageBlockStatus.SUCCESS
                })
          }
          blocks.push(toolBlock)
          break
        }

        case 'tool_result':
        case 'token_budget':
          break
      }
    }

    const messageText = anthropicMessage.text.trim()
    if (!hasTextBlock && messageText) {
      blocks.push(this.createMainTextBlock(messageId, messageText, createdAt, updatedAt))
    }

    const message: Message = {
      id: messageId,
      role,
      assistantId,
      topicId,
      createdAt,
      updatedAt,
      status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
      blocks: blocks.map((b) => b.id),
      // Anthropic's conversations.json export carries no per-message model field
      // (chat_messages only expose uuid/text/content/sender/timestamps/attachments/files),
      // so assistant messages are tagged with a default Claude model purely so the
      // Claude logo renders. Mirrors ChatgptImporter's hard-coded gpt-5 default.
      ...(role === 'assistant' && {
        model: {
          id: 'claude-sonnet-4-6',
          provider: 'anthropic',
          name: 'Claude Sonnet 4.6',
          group: 'Claude 4.6'
        }
      })
    }

    return { message, blocks }
  }

  /**
   * Convert Anthropic conversation to Cherry Studio Topic.
   * Returns null if the conversation has no usable message content.
   */
  private convertConversationToTopic(
    conversation: AnthropicConversation,
    assistantId: string
  ): {
    topic: Topic
    messages: Message[]
    blocks: ImportMessageBlock[]
  } | null {
    const topicId = uuid()
    const messages: Message[] = []
    const blocks: ImportMessageBlock[] = []

    // Filter out messages with no usable content
    const usableMessages = conversation.chat_messages.filter((msg) => this.hasUsableContent(msg))

    // Skip entirely empty conversations
    if (usableMessages.length === 0) {
      return null
    }

    for (const msg of usableMessages) {
      const { message, blocks: msgBlocks } = this.createMessageAndBlocks(msg, topicId, assistantId)
      messages.push(message)
      blocks.push(...msgBlocks)
    }

    const title =
      conversation.name.trim() || conversation.summary.trim() || i18n.t('import.claude.untitled_conversation')

    const topic: Topic = {
      id: topicId,
      assistantId,
      name: title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      messages,
      isNameManuallyEdited: Boolean(conversation.name.trim())
    }

    return { topic, messages, blocks }
  }
}
