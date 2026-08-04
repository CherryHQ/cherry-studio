import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'

import type { ConversationImporter, ImportConversation, ImportMessage, ImportResult } from '../types'

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
        const textParts = extractTextParts(message.content?.parts)
        // Filter out empty messages and tool messages
        if (message.author.role !== 'tool' && textParts.some((part) => part.trim().length > 0)) {
          messages.push(message)
        }
      }
    }

    return messages
  }

  /**
   * Map ChatGPT role to Cherry Studio role
   */
  private mapRole(chatgptRole: ChatGPTMessage['author']['role']): ImportMessage['role'] {
    if (chatgptRole === 'user') return 'user'
    if (chatgptRole === 'assistant') return 'assistant'
    return 'system'
  }

  /**
   * Create a v2 import message from a ChatGPT message
   */
  private createMessage(chatgptMessage: ChatGPTMessage): ImportMessage {
    const role = this.mapRole(chatgptMessage.author.role)

    // Extract text content from parts
    const content = extractTextParts(chatgptMessage.content?.parts)
      .filter((part) => part && part.trim())
      .map(normalizeExportText)
      .join('\n\n')

    return {
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
    const chatgptMessages = this.extractMainThread(conversation.mapping, conversation.current_node)
    return {
      name: conversation.title || i18n.t('import.chatgpt.untitled_conversation'),
      messages: chatgptMessages.map((message) => this.createMessage(message))
    }
  }
}
