import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'

import { AnthropicImporter } from './importers/AnthropicImporter'
import { ChatgptImporter } from './importers/ChatgptImporter'
import { CherryTopicImporter } from './importers/CherryTopicImporter'
import type { ConversationImporter, ImportConversation, ImportMessageNode, ImportResponse, ImportResult } from './types'

const logger = loggerService.withContext('ImportService')

type ImportProgressCallback = (percent: number) => void

// Every conversation importer the service registers on construction. Add new
// importers here as they are implemented.
const availableImporters = [new ChatgptImporter(), new AnthropicImporter(), new CherryTopicImporter()]

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
  async importConversations(
    fileContent: string,
    importerName?: string,
    onProgress?: ImportProgressCallback
  ): Promise<ImportResponse> {
    try {
      logger.info('Starting import...')
      onProgress?.(0)

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

      // Native topic files carry no assistant: route them to the native import
      // so a generic entry point never mints a throwaway assistant for them.
      if (importer instanceof CherryTopicImporter) {
        return this.importNativeTopic(fileContent, onProgress)
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
      onProgress?.(5)

      const importerKey = `import.${importer.name.toLowerCase()}.assistant_name`
      const dto: CreateAssistantDto = {
        name: i18n.t(importerKey, {
          defaultValue: `${importer.name} Import`
        }),
        emoji: importer.emoji
      }
      const assistant = await dataApiService.post('/assistants', { body: dto })
      onProgress?.(10)

      const result = await importer.parse(fileContent)
      onProgress?.(20)
      const messagesCount = await this.persistImport(result, assistant, onProgress)
      onProgress?.(100)

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
   * Import a native Cherry Studio topic file. Unlike external imports this
   * creates only the topic itself — no assistant — and preserves the exported
   * snapshots, sibling groups and status verbatim. The file is fully validated
   * before anything is written, so invalid input creates nothing.
   */
  async importNativeTopic(fileContent: string, onProgress?: ImportProgressCallback): Promise<ImportResponse> {
    try {
      logger.info('Starting native topic import...')
      onProgress?.(0)

      const importer = this.getImporter('cherry')
      if (!importer) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: 'Importer "cherry" not found'
        }
      }
      if (!importer.validate(fileContent)) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: i18n.t('import.error.invalid_format', { defaultValue: 'Invalid Cherry Studio topic file' })
        }
      }
      onProgress?.(10)

      const result = await importer.parse(fileContent)
      const conversation = result.conversations[0]
      if (!conversation) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: i18n.t('import.error.invalid_format', { defaultValue: 'Invalid Cherry Studio topic file' })
        }
      }
      onProgress?.(20)

      const messagesCount = await this.persistImport({ conversations: [conversation] }, undefined, onProgress)
      onProgress?.(100)

      logger.info(`Native topic import completed: 1 topic, ${messagesCount} messages imported`)

      return {
        success: true,
        topicsCount: 1,
        messagesCount
      }
    } catch (error) {
      logger.error('Native topic import failed:', error as Error)
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
   * Builds a v2 create-message DTO. Imported messages are historical, so they
   * are persisted as `success`. A `pending` source has no live stream on the
   * destination to complete it, so it lands as `error` (same convention as the
   * boot reconcile for crash-orphaned turns), keeping it terminal and retryable.
   * For assistant rows the producing author is frozen into `messageSnapshot`
   * so the header survives later rename/delete.
   * Native topic nodes carry their snapshot, status and sibling group verbatim;
   * external nodes synthesize them from the import assistant and tree position.
   */
  private toMessageDto(
    message: ImportMessageNode,
    parentId: string | null,
    siblingsGroupId: number | undefined,
    assistant?: { id: string; name: string; emoji: string }
  ): CreateMessageDto {
    const effectiveSiblingsGroupId = message.siblingsGroupId ?? siblingsGroupId
    const dto: CreateMessageDto = {
      parentId,
      role: message.role,
      data: message.turnOptions ? { parts: message.parts, turnOptions: message.turnOptions } : { parts: message.parts },
      status: message.status === 'pending' ? 'error' : (message.status ?? 'success'),
      setAsActive: false,
      ...(effectiveSiblingsGroupId ? { siblingsGroupId: effectiveSiblingsGroupId } : {})
    }

    if (message.messageSnapshot) {
      dto.messageSnapshot = message.messageSnapshot
    } else if (assistant && message.role === 'assistant' && message.model) {
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
   * Persists each imported conversation as a message tree. Source IDs stay
   * local to the import contract and are mapped to newly-created database IDs.
   * Without an assistant the topic is created unlinked; the caller moves it to
   * an assistant afterwards. Continuation then falls back to the destination's
   * current assistant and model while history renders from the snapshots.
   */
  private async persistImport(
    result: ImportResult,
    assistant: { id: string; name: string; emoji: string } | undefined,
    onProgress?: ImportProgressCallback
  ): Promise<number> {
    const { conversations } = result
    const totalSteps = conversations.reduce((count, conversation) => {
      const activeSourceId = conversation.activeSourceId ?? conversation.messages.at(-1)?.sourceId
      return count + 1 + conversation.messages.length + (activeSourceId ? 1 : 0)
    }, 0)
    let completedSteps = 0
    const completeStep = () => {
      completedSteps++
      onProgress?.(20 + Math.floor((completedSteps / totalSteps) * 79))
    }

    for (const conversation of conversations) {
      const createdTopic = await dataApiService.post('/topics', {
        body: assistant ? { name: conversation.name, assistantId: assistant.id } : { name: conversation.name }
      })
      try {
        await this.persistConversation(conversation, createdTopic.id, assistant, completeStep)
      } catch (error) {
        // Fresh topics are still active, so purge them through the trash
        // lifecycle (DataApi purge only covers trashed topics).
        try {
          await ipcApi.request('trash.topic.delete_permanently', { topicIds: [createdTopic.id] })
        } catch (cleanupError) {
          logger.warn('Failed to clean up a partially imported topic', { topicId: createdTopic.id, cleanupError })
        }
        throw error
      }
    }

    const messagesCount = conversations.reduce((count, conversation) => count + conversation.messages.length, 0)
    logger.info(`Persisted import: ${conversations.length} topics, ${messagesCount} messages`)
    return messagesCount
  }

  private async persistConversation(
    conversation: ImportConversation,
    topicId: string,
    assistant: { id: string; name: string; emoji: string } | undefined,
    completeStep: () => void
  ): Promise<void> {
    if (conversation.isNameManuallyEdited) {
      await dataApiService.patch(`/topics/${topicId}`, { body: { isNameManuallyEdited: true } })
    }
    completeStep()

    const messagesByParent = new Map<string | undefined, Map<ImportMessageNode['role'], ImportMessageNode[]>>()
    for (const message of conversation.messages) {
      const messagesByRole = messagesByParent.get(message.parentSourceId) ?? new Map()
      const siblings = messagesByRole.get(message.role) ?? []
      siblings.push(message)
      messagesByRole.set(message.role, siblings)
      messagesByParent.set(message.parentSourceId, messagesByRole)
    }

    const siblingGroupIds = new Map<string, number>()
    let nextSiblingGroupId = 1
    for (const messagesByRole of messagesByParent.values()) {
      for (const siblings of messagesByRole.values()) {
        if (siblings.length < 2) continue
        for (const sibling of siblings) siblingGroupIds.set(sibling.sourceId, nextSiblingGroupId)
        nextSiblingGroupId++
      }
    }

    const createdIds = new Map<string, string>()
    const pendingSourceIds = new Set(conversation.messages.map((message) => message.sourceId))
    while (pendingSourceIds.size > 0) {
      let createdInPass = 0
      for (const message of conversation.messages) {
        if (!pendingSourceIds.has(message.sourceId)) continue

        let parentId: string | null = null
        if (message.parentSourceId) {
          const createdParentId = createdIds.get(message.parentSourceId)
          if (!createdParentId) continue
          parentId = createdParentId
        }

        const created = await dataApiService.post(`/topics/${topicId}/messages`, {
          body: this.toMessageDto(message, parentId, siblingGroupIds.get(message.sourceId), assistant)
        })
        createdIds.set(message.sourceId, created.id)
        pendingSourceIds.delete(message.sourceId)
        createdInPass++
        completeStep()
      }

      if (createdInPass === 0) {
        throw new Error(`Unable to resolve imported message parents for topic "${conversation.name}"`)
      }
    }

    const activeSourceId = conversation.activeSourceId ?? conversation.messages.at(-1)?.sourceId
    const activeNodeId = activeSourceId ? createdIds.get(activeSourceId) : undefined
    if (activeNodeId) {
      await dataApiService.put(`/topics/${topicId}/active-node`, { body: { nodeId: activeNodeId } })
    }
    if (activeSourceId) completeStep()
  }
}

// Export singleton instance
export const importService = new ImportService()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => importService.importChatGPTConversations(fileContent)
