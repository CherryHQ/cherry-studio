import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { Message } from '@renderer/types/newMessage'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'

import { availableImporters } from './importers'
import type { ConversationImporter, ImportResponse, ImportResult } from './types'

const logger = loggerService.withContext('ImportService')

/**
 * Main import service that manages all conversation importers
 */
class ImportServiceClass {
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

      const result = await importer.parse(fileContent, assistant.id)
      await this.persistImport(result)

      logger.info(
        `Import completed: ${result.topics.length} conversations, ${result.messages.length} messages imported`
      )

      return {
        success: true,
        assistant,
        topicsCount: result.topics.length,
        messagesCount: result.messages.length
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
   * Builds a v2 create-message DTO from a parsed v1 message. Imported messages
   * are historical, so they are persisted as `success`; the source model is
   * captured as `modelSnapshot` for the renderer badge.
   */
  private toMessageDto(message: Message, blockContent: Map<string, string>, parentId: string | null): CreateMessageDto {
    const text = message.blocks.map((id) => blockContent.get(id) ?? '').join('\n\n')

    const dto: CreateMessageDto = {
      parentId,
      role: message.role,
      data: { parts: [{ type: 'text', text }] },
      status: 'success'
    }

    if (message.model) {
      dto.modelSnapshot = {
        id: message.model.id,
        name: message.model.name,
        provider: message.model.provider,
        group: message.model.group
      }
    }

    return dto
  }

  /**
   * Persists the import result via DataApi. Messages chain by parent id into
   * a single linear branch under each topic.
   */
  private async persistImport(result: ImportResult): Promise<void> {
    const { topics, blocks, messages } = result
    const blockContent = new Map(blocks.map((block) => [block.id, block.content]))

    for (const topic of topics) {
      const createdTopic = await dataApiService.post('/topics', {
        body: { name: topic.name, assistantId: topic.assistantId }
      })

      let parentId: string | null = null
      for (const message of topic.messages) {
        const created = await dataApiService.post(`/topics/${createdTopic.id}/messages`, {
          body: this.toMessageDto(message, blockContent, parentId)
        })
        parentId = created.id
      }
    }

    logger.info(`Persisted import: ${topics.length} topics, ${messages.length} messages`)
  }
}

// Export singleton instance
export const ImportService = new ImportServiceClass()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => ImportService.importChatGPTConversations(fileContent)
