import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import type { DynamicToolUIPart, ReasoningUIPart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'

import type { ConversationImporter, ImportConversation, ImportMessage, ImportResult } from '../types'

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
}

interface AnthropicConversation {
  uuid: string
  name: string
  summary: string
  created_at: string
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
  async parse(fileContent: string): Promise<ImportResult> {
    logger.info('Starting Anthropic Claude import...')

    const conversations = JSON.parse(fileContent) as AnthropicConversation[]

    if (conversations.length === 0) {
      throw new Error(i18n.t('import.claude.error.no_conversations'))
    }

    logger.info(`Found ${conversations.length} conversations`)

    const importedConversations: ImportConversation[] = []

    for (const conversation of conversations) {
      try {
        const importedConversation = this.convertConversation(conversation)
        if (importedConversation) importedConversations.push(importedConversation)
      } catch (convError) {
        logger.warn(`Failed to convert conversation "${conversation.name}":`, convError as Error)
      }
    }

    if (importedConversations.length === 0) {
      throw new Error(i18n.t('import.claude.error.no_valid_conversations'))
    }

    return {
      conversations: importedConversations
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

  /**
   * Create a v2 import message from an Anthropic message.
   * Handles text, thinking, tool_use, and tool_result content blocks.
   */
  private createMessage(anthropicMessage: AnthropicMessage): ImportMessage {
    const role = anthropicMessage.sender === 'human' ? 'user' : 'assistant'
    const parts: ImportMessage['parts'] = []
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

    // Iterate content blocks in order, building v2 AI SDK parts
    let anonymousToolIndex = 0
    let hasTextBlock = false
    for (const contentBlock of contentBlocks) {
      switch (contentBlock.type) {
        case 'text': {
          const content = contentBlock.text.trim()
          if (!content) break

          parts.push({ type: 'text', text: content })
          hasTextBlock = true
          break
        }

        case 'thinking': {
          const thinkingMs =
            new Date(contentBlock.stop_timestamp).getTime() - new Date(contentBlock.start_timestamp).getTime()

          const reasoningPart: ReasoningUIPart = {
            type: 'reasoning',
            text: contentBlock.thinking,
            state: 'done'
          }
          parts.push(withCherryMeta(reasoningPart, { thinkingMs }))
          break
        }

        case 'tool_use': {
          const toolId = contentBlock.id ?? `${anthropicMessage.uuid}-tool-${anonymousToolIndex}`
          const toolResult = contentBlock.id
            ? toolResultMap.get(contentBlock.id)
            : anonymousToolResults[anonymousToolIndex++]

          const base = {
            type: 'dynamic-tool' as const,
            toolCallId: toolId,
            toolName: contentBlock.name,
            input: contentBlock.input
          }

          let toolPart: DynamicToolUIPart
          if (toolResult?.is_error) {
            toolPart = { ...base, state: 'output-error', errorText: this.extractToolResultContent(toolResult) }
          } else if (toolResult) {
            toolPart = { ...base, state: 'output-available', output: this.extractToolResultContent(toolResult) }
          } else {
            toolPart = { ...base, state: 'input-available' }
          }
          parts.push(toolPart)
          break
        }

        case 'tool_result':
        case 'token_budget':
          break
      }
    }

    const messageText = anthropicMessage.text.trim()
    if (!hasTextBlock && messageText) {
      parts.push({ type: 'text', text: messageText })
    }

    return {
      role,
      parts,
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
  }

  /**
   * Convert an Anthropic conversation to the v2 import contract.
   * Returns null if the conversation has no usable message content.
   */
  private convertConversation(conversation: AnthropicConversation): ImportConversation | null {
    // Filter out messages with no usable content
    const usableMessages = conversation.chat_messages.filter((msg) => this.hasUsableContent(msg))

    // Skip entirely empty conversations
    if (usableMessages.length === 0) {
      return null
    }

    const name =
      conversation.name.trim() || conversation.summary.trim() || i18n.t('import.claude.untitled_conversation')

    return {
      name,
      messages: usableMessages.map((message) => this.createMessage(message))
    }
  }
}
