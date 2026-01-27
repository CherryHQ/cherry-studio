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
   * Import conversations from file content
   */
  async importConversations(fileContent: string, importerName: string): Promise<ImportResponse> {
    try {
      logger.info('Starting import...')

      const importer = this.getImporter(importerName)
      if (!importer) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: `Importer "${importerName}" not found`
        }
      }

      // Validate format
      if (!importer.validate(fileContent)) {
        const importerKey = `import.${importer.name.toLowerCase()}.error.invalid_format`
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: i18n.t(importerKey, {
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
        topics: result.topics.map((topic) => ({ ...topic, messages: [] })),
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
        messagesCount: result.messages.length,
        skippedMessagesCount: result.stats?.skippedMessagesCount ?? 0,
        skippedTopicsCount: result.stats?.skippedTopicsCount ?? 0
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
   * Import ChatBox conversations (backward compatibility)
   * @deprecated Use importConversations() instead
   */
  async importChatBoxConversations(fileContent: string): Promise<ImportResponse> {
    return this.importConversations(fileContent, 'chatbox')
  }
}

// Export singleton instance
export const ImportService = new ImportServiceClass()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => ImportService.importChatGPTConversations(fileContent)
export const importChatBoxConversations = (fileContent: string) => ImportService.importChatBoxConversations(fileContent)
