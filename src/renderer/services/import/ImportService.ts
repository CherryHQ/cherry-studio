import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { type Message, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import type { DynamicToolUIPart, ReasoningUIPart } from 'ai'

import { AnthropicImporter } from './importers/AnthropicImporter'
import { ChatgptImporter } from './importers/ChatgptImporter'
import type { ConversationImporter, ImportMessageBlock, ImportResponse, ImportResult } from './types'

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

      const result = await importer.parse(fileContent, assistant.id)
      await this.persistImport(result, assistant)

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
   * are historical, so they are persisted as `success`. For assistant rows the
   * producing author (the import's assistant, owning the source model) is frozen
   * into `messageSnapshot` so the header survives later rename/delete.
   */
  private toMessageDto(
    message: Message,
    blocksById: Map<string, ImportMessageBlock>,
    parentId: string | null,
    assistant: { id: string; name: string; emoji: string }
  ): CreateMessageDto {
    const dto: CreateMessageDto = {
      parentId,
      role: message.role,
      data: { parts: this.toMessageParts(message, blocksById) },
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

  private toMessageParts(message: Message, blocksById: Map<string, ImportMessageBlock>): CherryMessagePart[] {
    return message.blocks.flatMap((blockId): CherryMessagePart[] => {
      const block = blocksById.get(blockId)
      if (!block) throw new Error(`Missing imported message block: ${blockId}`)

      switch (block.type) {
        case MessageBlockType.MAIN_TEXT:
          return [{ type: 'text', text: block.content }]

        case MessageBlockType.THINKING: {
          const part: ReasoningUIPart = { type: 'reasoning', text: block.content, state: 'done' }
          return [withCherryMeta(part, { thinkingMs: block.thinking_millsec })]
        }

        case MessageBlockType.TOOL: {
          const base = {
            type: 'dynamic-tool' as const,
            toolCallId: block.toolId,
            toolName: block.toolName,
            input: block.arguments
          }

          let part: DynamicToolUIPart
          if (block.status === MessageBlockStatus.ERROR) {
            part = { ...base, state: 'output-error', errorText: block.content }
          } else if (block.content === undefined) {
            part = { ...base, state: 'input-available' }
          } else {
            part = { ...base, state: 'output-available', output: block.content }
          }

          return [part]
        }
      }
    })
  }

  /**
   * Persists the import result via DataApi. Messages chain by parent id into
   * a single linear branch under each topic.
   */
  private async persistImport(
    result: ImportResult,
    assistant: { id: string; name: string; emoji: string }
  ): Promise<void> {
    const { topics, blocks, messages } = result
    const blocksById = new Map(blocks.map((block) => [block.id, block]))

    for (const topic of topics) {
      const createdTopic = await dataApiService.post('/topics', {
        body: { name: topic.name, assistantId: topic.assistantId }
      })

      let parentId: string | null = null
      for (const message of topic.messages) {
        const created = await dataApiService.post(`/topics/${createdTopic.id}/messages`, {
          body: this.toMessageDto(message, blocksById, parentId, assistant)
        })
        parentId = created.id
      }
    }

    logger.info(`Persisted import: ${topics.length} topics, ${messages.length} messages`)
  }
}

// Export singleton instance
export const importService = new ImportService()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => importService.importChatGPTConversations(fileContent)
