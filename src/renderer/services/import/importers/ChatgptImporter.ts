import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'

import type { ConversationImporter, ImportConversation, ImportMessageNode, ImportResult } from '../types'

const logger = loggerService.withContext('ChatgptImporter')

const ENTITY_MARKER = /\uE200entity\uE202([^\uE201]*)\uE201/g
const URL_MARKER = /\uE200url\uE202([^\uE202]*)\uE202([^\uE201]*)\uE201/g
const METADATA_MARKER = /\uE200(?:cite|filecite|genui|image_group)\uE202[^\uE201]*\uE201/g

const normalizeExportText = (text: string): string =>
  text
    .replace(ENTITY_MARKER, (_, payload: string) => {
      const [, label] = JSON.parse(payload) as [string, string, string]
      return label
    })
    .replace(URL_MARKER, (_, label: string, target: string) =>
      target.startsWith('https://') || target.startsWith('http://') ? `[${label}](${target})` : label
    )
    .replace(METADATA_MARKER, '')

const extractTextParts = (parts: unknown[] = []): string[] =>
  parts.filter((part): part is string => typeof part === 'string')

/**
 * ChatGPT Export Format Types
 */
interface ChatGPTMessage {
  author: {
    role: 'user' | 'assistant' | 'system' | 'tool'
  }
  content: {
    content_type: string
    parts?: unknown[]
  }
}

interface ChatGPTNode {
  message?: ChatGPTMessage
  parent?: string
  children?: string[]
}

interface ChatGPTConversation {
  title: string
  create_time: number
  mapping: Record<string, ChatGPTNode>
  current_node?: string
}

/**
 * ChatGPT conversation importer
 * Handles importing conversations from ChatGPT's conversations.json export format
 */
export class ChatgptImporter implements ConversationImporter {
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
  async parse(fileContent: string): Promise<ImportResult> {
    logger.info('Starting ChatGPT import...')

    // Parse JSON
    const parsed = JSON.parse(fileContent)
    const conversations: ChatGPTConversation[] = Array.isArray(parsed) ? parsed : [parsed]

    if (!conversations || conversations.length === 0) {
      throw new Error(i18n.t('import.chatgpt.error.no_conversations'))
    }

    logger.info(`Found ${conversations.length} conversations`)

    const importedConversations: ImportConversation[] = []

    // Convert each conversation
    for (const conversation of conversations) {
      try {
        importedConversations.push(this.convertConversation(conversation))
      } catch (convError) {
        logger.warn(`Failed to convert conversation "${conversation.title}":`, convError as Error)
        // Continue with other conversations
      }
    }

    if (importedConversations.length === 0) {
      throw new Error(i18n.t('import.chatgpt.error.no_valid_conversations'))
    }

    return {
      conversations: importedConversations
    }
  }

  /**
   * Map ChatGPT role to Cherry Studio role
   */
  private mapRole(chatgptRole: ChatGPTMessage['author']['role']): ImportMessageNode['role'] {
    if (chatgptRole === 'user') return 'user'
    if (chatgptRole === 'assistant') return 'assistant'
    return 'system'
  }

  /**
   * Create a v2 import message from a ChatGPT message
   */
  private createMessage(
    sourceId: string,
    parentSourceId: string | undefined,
    chatgptMessage: ChatGPTMessage
  ): ImportMessageNode {
    const role = this.mapRole(chatgptMessage.author.role)

    // Extract text content from parts
    const content = extractTextParts(chatgptMessage.content?.parts)
      .filter((part) => part && part.trim())
      .map(normalizeExportText)
      .join('\n\n')

    return {
      sourceId,
      ...(parentSourceId ? { parentSourceId } : {}),
      role,
      parts: [{ type: 'text', text: content }],
      // Set model for assistant messages to display GPT-5 logo
      ...(role === 'assistant' && {
        model: {
          id: 'gpt-5',
          provider: 'openai',
          name: 'GPT-5',
          group: 'gpt-5'
        }
      })
    }
  }

  /**
   * Convert a ChatGPT conversation to the v2 import contract
   */
  private convertConversation(conversation: ChatGPTConversation): ImportConversation {
    const importedNodeIds = new Set(
      Object.entries(conversation.mapping).flatMap(([sourceId, node]) => {
        const message = node.message
        if (!message || message.author.role === 'tool') return []
        return extractTextParts(message.content?.parts).some((part) => part.trim().length > 0) ? [sourceId] : []
      })
    )
    const resolveImportedNodeId = (sourceId?: string): string | undefined => {
      let candidate = sourceId
      while (candidate && !importedNodeIds.has(candidate)) {
        candidate = conversation.mapping[candidate]?.parent
      }
      return candidate
    }
    const messages = Object.entries(conversation.mapping).flatMap(([sourceId, node]) => {
      if (!importedNodeIds.has(sourceId) || !node.message) return []
      return [this.createMessage(sourceId, resolveImportedNodeId(node.parent), node.message)]
    })

    return {
      name: conversation.title || i18n.t('import.chatgpt.untitled_conversation'),
      messages,
      activeSourceId: resolveImportedNodeId(conversation.current_node) ?? messages.at(-1)?.sourceId
    }
  }
}
