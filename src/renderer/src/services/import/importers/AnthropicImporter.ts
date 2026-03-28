import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  MessageBlockStatus,
  MessageBlockType,
  type ThinkingMessageBlock,
  type ToolMessageBlock,
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

/** Content items inside a tool_result block */
interface AnthropicToolResultContent {
  type: string
  text?: string
  uuid?: string
  // knowledge type fields
  title?: string
  url?: string
  is_missing?: boolean
}

interface AnthropicContentBlock {
  type: string
  start_timestamp?: string | null
  stop_timestamp?: string | null
  flags?: null
  // text block fields
  text?: string
  citations?: AnthropicCitation[]
  // thinking block fields
  thinking?: string
  summaries?: { summary: string }[]
  cut_off?: boolean
  truncated?: boolean
  alternative_display_type?: string | null
  // tool_use block fields
  id?: string
  name?: string
  input?: Record<string, string | number | boolean | null>
  message?: string | null
  display_content?: { type: string; text?: string; json_block?: string } | null
  icon_name?: string | null
  // tool_result block fields
  tool_use_id?: string
  content?: AnthropicToolResultContent[]
  is_error?: boolean
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
  readonly emoji = '🍒'

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
    const allBlocks: (MainTextMessageBlock | ThinkingMessageBlock | ToolMessageBlock)[] = []

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
   * Extract text content from Anthropic content blocks (non-empty text blocks only)
   */
  private extractTextContent(message: AnthropicMessage): string {
    if (message.content && message.content.length > 0) {
      const textParts = message.content
        .filter((block) => block.type === 'text' && block.text && block.text.trim().length > 0)
        .map((block) => block.text!.trim())

      if (textParts.length > 0) {
        return textParts.join('\n\n')
      }
    }

    return message.text?.trim() ?? ''
  }

  /**
   * Check if a message has any usable content (text, thinking, or tool calls)
   */
  private hasUsableContent(message: AnthropicMessage): boolean {
    if (this.extractTextContent(message).length > 0) return true
    return (message.content ?? []).some((b) => b.type === 'tool_use' || b.type === 'thinking')
  }

  /**
   * Extract text from tool_result content items
   */
  private extractToolResultText(contentItems: AnthropicToolResultContent[]): string {
    return contentItems
      .filter((item) => item.text)
      .map((item) => item.text!)
      .join('\n\n')
  }

  /**
   * Create Message and MessageBlocks from an Anthropic message.
   * Handles text, thinking, tool_use, and tool_result content blocks.
   */
  private createMessageAndBlocks(
    anthropicMessage: AnthropicMessage,
    topicId: string,
    assistantId: string
  ): { message: Message; blocks: (MainTextMessageBlock | ThinkingMessageBlock | ToolMessageBlock)[] } {
    const messageId = uuid()
    const role = anthropicMessage.sender === 'human' ? 'user' : 'assistant'
    const createdAt = anthropicMessage.created_at ?? new Date().toISOString()
    const updatedAt = anthropicMessage.updated_at ?? createdAt

    const blocks: (MainTextMessageBlock | ThinkingMessageBlock | ToolMessageBlock)[] = []
    const contentBlocks = anthropicMessage.content ?? []

    // Index tool_result blocks by their tool_use_id for O(1) lookup
    const toolResultMap = new Map<string, AnthropicContentBlock>()
    for (const block of contentBlocks) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        toolResultMap.set(block.tool_use_id, block)
      }
    }

    // Iterate content blocks in order, building typed blocks
    for (const contentBlock of contentBlocks) {
      switch (contentBlock.type) {
        case 'thinking': {
          if (!contentBlock.thinking) break

          const thinkingMs =
            contentBlock.start_timestamp && contentBlock.stop_timestamp
              ? new Date(contentBlock.stop_timestamp).getTime() - new Date(contentBlock.start_timestamp).getTime()
              : 0

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
          if (!contentBlock.id) break

          // Find matching tool_result
          const toolResult = toolResultMap.get(contentBlock.id)
          const resultContent = toolResult?.content ? this.extractToolResultText(toolResult.content) : undefined
          const toolStatus = toolResult?.is_error ? 'error' : 'done'

          const toolBlock: ToolMessageBlock = {
            id: uuid(),
            messageId,
            type: MessageBlockType.TOOL,
            toolId: contentBlock.id,
            toolName: contentBlock.name,
            arguments: contentBlock.input,
            content: resultContent,
            createdAt,
            updatedAt,
            status: toolResult?.is_error ? MessageBlockStatus.ERROR : MessageBlockStatus.SUCCESS,
            // Populate rawMcpToolResponse so MessageMcpTool can render arguments and response
            metadata: {
              rawMcpToolResponse: {
                id: contentBlock.id,
                toolUseId: contentBlock.id,
                tool: {
                  id: contentBlock.name ?? '',
                  name: contentBlock.name ?? '',
                  serverId: 'anthropic-import',
                  serverName: 'Claude',
                  type: 'mcp',
                  inputSchema: { type: 'object', properties: {}, required: [] }
                },
                arguments: contentBlock.input ?? {},
                status: toolStatus,
                response: resultContent ? { content: [{ type: 'text', text: resultContent }] } : undefined
              }
            }
          }
          blocks.push(toolBlock)
          break
        }

        case 'tool_result':
          // Handled via toolResultMap when processing tool_use; skip here
          break

        default:
          // 'text' and other unknown types — handled below via extractTextContent
          break
      }
    }

    // Always add a MainTextMessageBlock (may be empty for tool-only messages)
    const mainBlock: MainTextMessageBlock = {
      id: uuid(),
      messageId,
      type: MessageBlockType.MAIN_TEXT,
      content: this.extractTextContent(anthropicMessage),
      createdAt,
      updatedAt,
      status: MessageBlockStatus.SUCCESS
    }
    blocks.push(mainBlock)

    const message: Message = {
      id: messageId,
      role,
      assistantId,
      topicId,
      createdAt,
      updatedAt,
      status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
      blocks: blocks.map((b) => b.id),
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
    blocks: (MainTextMessageBlock | ThinkingMessageBlock | ToolMessageBlock)[]
  } | null {
    const topicId = uuid()
    const messages: Message[] = []
    const blocks: (MainTextMessageBlock | ThinkingMessageBlock | ToolMessageBlock)[] = []

    // Filter out messages with no usable content
    const usableMessages = (conversation.chat_messages ?? []).filter((msg) => this.hasUsableContent(msg))

    // Keep only the last one per run to maintain a proper alternating human/assistant structure.
    const validMessages: AnthropicMessage[] = []
    for (const msg of usableMessages) {
      if (validMessages.length > 0 && validMessages[validMessages.length - 1].sender === msg.sender) {
        validMessages[validMessages.length - 1] = msg
      } else {
        validMessages.push(msg)
      }
    }

    // Skip entirely empty conversations
    if (validMessages.length === 0) {
      return null
    }

    for (const msg of validMessages) {
      const { message, blocks: msgBlocks } = this.createMessageAndBlocks(msg, topicId, assistantId)
      messages.push(message)
      blocks.push(...msgBlocks)
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
