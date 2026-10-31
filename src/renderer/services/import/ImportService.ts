import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { CreateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { CreateMessageDto } from '@shared/data/api/schemas/messages'
import { isTrashTargetNotFoundError } from '@shared/ipc/errors/trash'

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
            name: importer.name,
            defaultValue: `Invalid ${importer.name} format`
          })
        }
      }
      onProgress?.(5)

      // Parse before creating anything: a failed import must be side-effect free.
      const result = await importer.parse(fileContent)
      onProgress?.(10)

      const importerKey = `import.${importer.name.toLowerCase()}.assistant_name`
      const dto: CreateAssistantDto = {
        name: i18n.t(importerKey, {
          defaultValue: `${importer.name} Import`
        }),
        emoji: importer.emoji
      }
      const assistant = await dataApiService.post('/assistants', { body: dto })
      onProgress?.(20)

      // Tracks exactly what this import created, so the failure path can roll
      // back its own data without touching anything else that may have been
      // moved under the assistant while it was running.
      const createdTopicIds: string[] = []

      try {
        const messagesCount = await this.persistImport(result, assistant, onProgress, createdTopicIds)
        onProgress?.(100)

        logger.info(
          `Import completed: ${result.conversations.length} conversations, ${messagesCount} messages imported`
        )

        return {
          success: true,
          assistant,
          topicsCount: result.conversations.length,
          messagesCount
        }
      } catch (persistError) {
        await this.rollbackCreatedAssistant(assistant.id, createdTopicIds, persistError)
        throw persistError
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
   * A failure after the assistant row exists must not leave it behind. Only
   * data this import created is removed: the created topics are hard-deleted by
   * id first, then the assistant itself — a bulk `deleteTopics: true` would
   * also destroy topics a user moved under the assistant while the import was
   * still running.
   *
   * Cleanup is best-effort, one object at a time, across both lifecycle states:
   * another window can delete (archive) an imported object mid-import, which
   * makes the active-state hard-delete report the target as not found — the
   * recycle-bin row is then purged through the permanent DataApi delete before
   * the object counts as gone. A skipped object is logged and never masks the
   * original import failure.
   */
  private async rollbackCreatedAssistant(
    assistantId: string,
    createdTopicIds: readonly string[],
    cause: unknown
  ): Promise<void> {
    for (const topicId of createdTopicIds) {
      try {
        await ipcApi.request('trash.topic.delete_permanently', { topicIds: [topicId] })
      } catch (activeError) {
        if (!isTrashTargetNotFoundError(activeError)) {
          logger.warn('Failed to roll back an imported topic', activeError as Error, {
            cause: String(cause),
            topicId
          })
          continue
        }
        await this.purgeTrashedTopic(topicId, cause)
      }
    }
    try {
      await ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: false })
    } catch (activeError) {
      if (!isTrashTargetNotFoundError(activeError)) {
        logger.error('Failed to roll back the assistant after a failed import', activeError as Error, {
          assistantId,
          cause: String(cause)
        })
        return
      }
      try {
        await dataApiService.delete(`/assistants/${assistantId}`, { query: { permanent: true } })
      } catch (trashedError) {
        if (!isDataApiNotFoundError(trashedError)) {
          logger.error('Failed to purge the archived assistant after a failed import', trashedError as Error, {
            assistantId,
            cause: String(cause)
          })
        }
      }
    }
    logger.info('Rolled back the assistant after a failed import', { assistantId, cause: String(cause) })
  }

  /**
   * The topic is not active anymore — it was archived by another window (or is
   * already gone). Purge the archived row when it still exists.
   */
  private async purgeTrashedTopic(topicId: string, cause: unknown): Promise<void> {
    try {
      await dataApiService.delete(`/topics/${topicId}`, { query: { permanent: true } })
    } catch (error) {
      if (!isDataApiNotFoundError(error)) {
        logger.warn('Failed to purge an archived imported topic', error as Error, {
          cause: String(cause),
          topicId
        })
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
    onProgress?: ImportProgressCallback,
    createdTopicIds?: string[]
  ): Promise<number> {
    const { conversations } = result
    const totalSteps = conversations.reduce(
      (count, conversation) => count + 1 + conversation.messages.length + (conversation.activeSourceId ? 1 : 0),
      0
    )
    let completedSteps = 0
    const completeStep = () => {
      completedSteps++
      onProgress?.(20 + Math.floor((completedSteps / totalSteps) * 79))
    }

    for (const conversation of conversations) {
      const createdTopic = await dataApiService.post('/topics', {
        body: assistant ? { name: conversation.name, assistantId: assistant.id } : { name: conversation.name }
      })
      createdTopicIds?.push(createdTopic.id)
      try {
        await this.persistConversation(conversation, createdTopic.id, assistant, completeStep)
      } catch (error) {
        // External imports are rolled back as a unit by their caller. Native
        // imports have no assistant owner, so remove only this fresh topic.
        if (!createdTopicIds) {
          try {
            await ipcApi.request('trash.topic.delete_permanently', { topicIds: [createdTopic.id] })
          } catch (cleanupError) {
            if (isTrashTargetNotFoundError(cleanupError)) {
              await this.purgeTrashedTopic(createdTopic.id, error)
            } else {
              logger.warn('Failed to clean up a partially imported topic', { topicId: createdTopic.id, cleanupError })
            }
          }
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

    const activeNodeId = conversation.activeSourceId ? createdIds.get(conversation.activeSourceId) : undefined
    if (activeNodeId) {
      await dataApiService.put(`/topics/${topicId}/active-node`, { body: { nodeId: activeNodeId } })
      completeStep()
    }
  }
}

// Export singleton instance
export const importService = new ImportService()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => importService.importChatGPTConversations(fileContent)
