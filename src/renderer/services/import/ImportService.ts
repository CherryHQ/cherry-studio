import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'

import { AnthropicImporter } from './importers/AnthropicImporter'
import { ChatgptImporter } from './importers/ChatgptImporter'
import type { ConversationImporter, ImportMessage, ImportResponse, ImportResult } from './types'

const logger = loggerService.withContext('ImportService')

// Every conversation importer the service registers on construction. Add new
// importers here as they are implemented.
const availableImporters = [new ChatgptImporter(), new AnthropicImporter()]

/**
 * Main import service that manages all conversation importers
 */
class ImportService {
  private importers: Map<string, ConversationImporter> = new Map()

  constructor() {
    // Register all available importers
    for (const importer of availableImporters) {
      this.importers.set(importer.name.toLowerCase(), importer)
      logger.info(`Registered importer: ${importer.name}`)
    }
  }

  /**
   * Get all registered importers
   */
  getImporters(): ConversationImporter[] {
    return Array.from(this.importers.values())
  }

  /**
   * Get importer by name
   */
  getImporter(name: string): ConversationImporter | undefined {
    return this.importers.get(name.toLowerCase())
  }

  /**
   * Auto-detect the appropriate importer for the file content
   */
  detectImporter(fileContent: string): ConversationImporter | null {
    for (const importer of this.importers.values()) {
      if (importer.validate(fileContent)) {
        logger.info(`Detected importer: ${importer.name}`)
        return importer
      }
    }
    logger.warn('No matching importer found for file content')
    return null
  }

  /**
   * Import conversations from file content
   * Automatically detects the format and uses the appropriate importer
   */
  async importConversations(fileContent: string, importerName?: string): Promise<ImportResponse> {
    try {
      logger.info('Starting import...')

      // Parse JSON first to validate format
      let importer: ConversationImporter | null = null

      if (importerName) {
        // Use specified importer
        const foundImporter = this.getImporter(importerName)
        if (!foundImporter) {
          return {
            success: false,
            topicsCount: 0,
            messagesCount: 0,
            error: `Importer "${importerName}" not found`
          }
        }
        importer = foundImporter
      } else {
        // Auto-detect importer
        importer = this.detectImporter(fileContent)
        if (!importer) {
          return {
            success: false,
            topicsCount: 0,
            messagesCount: 0,
            error: i18n.t('import.error.unsupported_format', { defaultValue: 'Unsupported file format' })
          }
        }
      }

      // Validate format
      if (!importer.validate(fileContent)) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: i18n.t('import.error.invalid_format', {
            defaultValue: `Invalid ${importer.name} format`
          })
        }
      }

      const importerKey = `import.${importer.name.toLowerCase()}.assistant_name`
      const dto: CreateAssistantDto = {
        name: i18n.t(importerKey, {
          defaultValue: `${importer.name} Import`
        }),
        emoji: importer.emoji
      }
      const assistant = await dataApiService.post('/assistants', { body: dto })

      const result = await importer.parse(fileContent)
      const messagesCount = await this.persistImport(result, assistant)

      logger.info(`Import completed: ${result.conversations.length} conversations, ${messagesCount} messages imported`)

      return {
        success: true,
        assistant,
        topicsCount: result.conversations.length,
        messagesCount
      }
    } catch (error) {
      logger.error('Import failed:', error as Error)
      return {
        success: false,
        topicsCount: 0,
        messagesCount: 0,
        error:
          error instanceof Error ? error.message : i18n.t('import.error.unknown', { defaultValue: 'Unknown error' })
      }
    }
  }

  /**
   * Import ChatGPT conversations (backward compatibility)
   * @deprecated Use importConversations() instead
   */
  async importChatGPTConversations(fileContent: string): Promise<ImportResponse> {
    return this.importConversations(fileContent, 'chatgpt')
  }

  /**
   * Builds a v2 create-message DTO. Imported messages are historical, so they
   * are persisted as `success`. For assistant rows the producing author is
   * frozen into `messageSnapshot` so the header survives later rename/delete.
   */
  private toMessageDto(
    message: ImportMessage,
    parentId: string | null,
    assistant: { id: string; name: string; emoji: string }
  ): CreateMessageDto {
    const dto: CreateMessageDto = {
      parentId,
      role: message.role,
      data: { parts: message.parts },
      status: 'success'
    }

    if (message.role === 'assistant' && message.model) {
      dto.messageSnapshot = {
        id: assistant.id,
        name: assistant.name,
        emoji: assistant.emoji,
        model: {
          id: message.model.id,
          name: message.model.name,
          provider: message.model.provider,
          ...(message.model.group ? { group: message.model.group } : {})
        }
      }
    }

    return dto
  }

  /**
   * Persists the import result via DataApi. Messages chain by parent id into
   * a single linear branch under each topic.
   */
  private async persistImport(
    result: ImportResult,
    assistant: { id: string; name: string; emoji: string }
  ): Promise<number> {
    const { conversations } = result

    for (const conversation of conversations) {
      const createdTopic = await dataApiService.post('/topics', {
        body: { name: conversation.name, assistantId: assistant.id }
      })

      let parentId: string | null = null
      for (const message of conversation.messages) {
        const created = await dataApiService.post(`/topics/${createdTopic.id}/messages`, {
          body: this.toMessageDto(message, parentId, assistant)
        })
        parentId = created.id
      }
    }

    const messagesCount = conversations.reduce((count, conversation) => count + conversation.messages.length, 0)
    logger.info(`Persisted import: ${conversations.length} topics, ${messagesCount} messages`)
    return messagesCount
  }
}

// Export singleton instance
export const importService = new ImportService()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => importService.importChatGPTConversations(fileContent)
