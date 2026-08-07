import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import type { DynamicToolUIPart, ModelSnapshot, ReasoningUIPart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'

import type { ConversationImporter, ImportConversation, ImportMessageNode, ImportResult } from '../types'

const logger = loggerService.withContext('AnthropicImporter')

/**
 * Fallback model tagged onto assistant messages when the export carries no
 * usable model id, purely so the Claude logo renders.
 * Mirrors ChatgptImporter's hard-coded gpt-5 default.
 */
const DEFAULT_MODEL: ModelSnapshot = {
  id: 'claude-sonnet-4-6',
  provider: 'anthropic',
  name: 'Claude Sonnet 4.6',
  group: 'Claude 4.6'
}

interface AnthropicToolResultContent {
  text: string
}

interface AnthropicTextBlock {
  type: 'text'
  text?: string
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
  parent_message_uuid?: string | null
  text?: string
  content?: AnthropicContentBlock[]
  sender: 'human' | 'assistant'
}

interface AnthropicConversation {
  uuid: string
  name: string
  summary: string
  created_at: string
  model?: string | null
  current_leaf_message_uuid?: string | null
  chat_messages: AnthropicMessage[]
}

/**
 * Anthropic Claude conversation importer
 * Handles importing conversations from Claude's conversations.json export format,
 * as well as the raw claude.ai API responses that browser-extension exporters dump
 * (a single conversation object, empty flattened `text`, and a real model id).
 */
export class AnthropicImporter implements ConversationImporter {
  readonly name = 'Claude'
  readonly emoji = '🍒'

  /**
   * Validate if the file content is a valid Anthropic Claude export.
   * The official conversations.json holds an array of conversations, while
   * browser-extension exporters dump a single conversation object.
   */
  validate(fileContent: string): boolean {
    try {
      const parsed = JSON.parse(fileContent)
      const conversations = Array.isArray(parsed) ? parsed : [parsed]
      return (
        conversations.length > 0 &&
        conversations.every(
          (conversation) =>
            conversation &&
            typeof conversation === 'object' &&
            conversation.uuid &&
            conversation.created_at &&
            Array.isArray(conversation.chat_messages) &&
            // Fingerprint the messages themselves so unrelated JSON that happens to
            // carry these three field names is not claimed by this importer.
            conversation.chat_messages.every(
              (message: { uuid?: unknown; sender?: unknown }) =>
                message &&
                typeof message.uuid === 'string' &&
                (message.sender === 'human' || message.sender === 'assistant')
            )
        )
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

    const parsed = JSON.parse(fileContent)
    const conversations = (Array.isArray(parsed) ? parsed : [parsed]) as AnthropicConversation[]

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
   * Check if a message has any usable content (text, thinking, or tool calls).
   * API-style exports always leave the flattened `text` empty, so text content
   * blocks have to count on their own.
   */
  private hasUsableContent(message: AnthropicMessage): boolean {
    return (
      (message.text ?? '').trim().length > 0 ||
      (message.content ?? []).some(
        (block) =>
          block.type === 'tool_use' ||
          block.type === 'thinking' ||
          (block.type === 'text' && (block.text ?? '').trim().length > 0)
      )
    )
  }

  /**
   * Extract text from tool_result content items
   */
  private extractToolResultContent(block: AnthropicToolResultBlock): string {
    return block.content.map((item) => item.text).join('\n\n')
  }

  /**
   * Split a Claude model id into family and version, handling both naming
   * schemes: `claude-3-5-sonnet-20241022` and `claude-sonnet-4-5-20250929`.
   * Returns an empty result for ids that match neither.
   */
  private parseModelId(modelId: string): {
    family?: string
    version?: string
    ordering?: 'version-first' | 'family-first'
  } {
    // Drop the provider prefix, any deployment suffix, and the trailing release date
    const base = modelId
      .toLowerCase()
      .trim()
      .replace(/^anthropic[/.:]/, '')
      .split('@')[0]
      .split(':')[0]
      .replace(/-\d{8}$/, '')

    const versionFirst = base.match(/^claude-(\d+(?:[.-]\d+)?)-(opus|sonnet|haiku)/)
    if (versionFirst) {
      return { version: versionFirst[1].replace('-', '.'), family: versionFirst[2], ordering: 'version-first' }
    }

    const familyFirst = base.match(/^claude-(opus|sonnet|haiku)-(\d+(?:[.-]\d+)?)/)
    if (familyFirst) {
      return { version: familyFirst[2].replace('-', '.'), family: familyFirst[1], ordering: 'family-first' }
    }

    return {}
  }

  /**
   * Turn a raw claude.ai model id into a model snapshot. Unrecognised ids keep the
   * raw string as their display name so nothing is silently lost.
   */
  private toModelSnapshot(modelId: string): ModelSnapshot {
    const { family, version, ordering } = this.parseModelId(modelId)

    if (!family || !version) {
      return { id: modelId, provider: 'anthropic', name: modelId, group: 'Claude' }
    }

    const familyLabel = family.charAt(0).toUpperCase() + family.slice(1)
    return {
      id: modelId,
      provider: 'anthropic',
      name: ordering === 'version-first' ? `Claude ${version} ${familyLabel}` : `Claude ${familyLabel} ${version}`,
      group: `Claude ${version}`
    }
  }

  /**
   * Create a v2 import message from an Anthropic message.
   * Handles text, thinking, tool_use, and tool_result content blocks.
   */
  private createMessage(
    anthropicMessage: AnthropicMessage,
    model: ModelSnapshot,
    parentSourceId?: string
  ): ImportMessageNode {
    const role = anthropicMessage.sender === 'human' ? 'user' : 'assistant'
    const parts: ImportMessageNode['parts'] = []
    const contentBlocks = anthropicMessage.content ?? []

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
          const content = (contentBlock.text ?? '').trim()
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

    const messageText = (anthropicMessage.text ?? '').trim()
    if (!hasTextBlock && messageText) {
      parts.push({ type: 'text', text: messageText })
    }

    return {
      sourceId: anthropicMessage.uuid,
      ...(parentSourceId ? { parentSourceId } : {}),
      role,
      parts,
      // Neither export shape carries a per-message model field (chat_messages only
      // expose uuid/text/content/sender/timestamps/attachments/files), so every
      // assistant message in a conversation shares the conversation-level model —
      // the real id when the export records one, the default Claude model otherwise.
      ...(role === 'assistant' && { model })
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

    const messagesById = new Map(conversation.chat_messages.map((message) => [message.uuid, message]))
    const usableMessageIds = new Set(usableMessages.map((message) => message.uuid))
    // Walk up the parent chain until an imported message is reached, so filtered-out
    // messages (and the export's root sentinel) never leak into the imported tree.
    // The visited set keeps cyclic parent pointers in malformed exports from hanging.
    const resolveUsableSourceId = (sourceId: string | null | undefined): string | undefined => {
      const visited = new Set<string>()
      let candidate = sourceId ?? undefined
      while (candidate && !usableMessageIds.has(candidate)) {
        if (visited.has(candidate)) return undefined
        visited.add(candidate)
        candidate = messagesById.get(candidate)?.parent_message_uuid ?? undefined
      }
      return candidate
    }

    const modelId = typeof conversation.model === 'string' ? conversation.model.trim() : ''
    const model = modelId ? this.toModelSnapshot(modelId) : DEFAULT_MODEL

    const messages = usableMessages.map((message) =>
      this.createMessage(message, model, resolveUsableSourceId(message.parent_message_uuid))
    )

    return {
      name,
      messages,
      // API-style exports name the active branch leaf, which is not always the last
      // exported message; fall back to export order when it is missing or unusable.
      activeSourceId: resolveUsableSourceId(conversation.current_leaf_message_uuid) ?? messages.at(-1)?.sourceId
    }
  }
}
