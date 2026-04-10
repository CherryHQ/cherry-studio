import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type { Assistant } from '@renderer/types'
import { uuid } from '@renderer/utils'

import { DEFAULT_ASSISTANT_SETTINGS } from '../AssistantService'
import { availableImporters } from './importers'
import type { ConversationImporter, ImportResponse } from './types'
import { saveImportToDatabase } from './utils/database'

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

      // Create assistant
      const assistantId = uuid()

      // Parse conversations
      const result = await importer.parse(fileContent, assistantId)

      // Save to database
      await saveImportToDatabase(result)

      // Create assistant
      const importerKey = `import.${importer.name.toLowerCase()}.assistant_name`
      const assistant: Assistant = {
        id: assistantId,
        name: i18n.t(importerKey, {
          defaultValue: `${importer.name} Import`
        }),
        emoji: importer.emoji,
        prompt: '',
        topics: result.topics,
        messages: [],
        type: 'assistant',
        settings: DEFAULT_ASSISTANT_SETTINGS
      }

      // Add assistant to store
      store.dispatch(addAssistant(assistant))

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
}

// Export singleton instance
export const ImportService = new ImportServiceClass()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => ImportService.importChatGPTConversations(fileContent)
