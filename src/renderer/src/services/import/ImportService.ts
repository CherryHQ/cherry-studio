import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type { Assistant, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'

import { DEFAULT_ASSISTANT_SETTINGS } from '../AssistantService'
import { availableImporters } from './importers'
import type { ClaudeImporter } from './importers/ClaudeImporter'
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

  /**
   * Import multiple files into a single assistant (for batch imports like Claude folder)
   * @param fileContents - Array of file contents to import
   * @param importerName - Name of the importer to use
   * @param onProgress - Optional callback for progress updates
   */
  async importBatch(
    fileContents: string[],
    importerName: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<ImportResponse> {
    try {
      logger.info(`Starting batch import of ${fileContents.length} files...`)

      const importer = this.getImporter(importerName)
      if (!importer) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: `Importer "${importerName}" not found`
        }
      }

      if (importerName.toLowerCase() === 'claude') {
        const claudeImporter = importer as ClaudeImporter
        const unknownModelKey = '__unknown__'
        const mixedModelKey = '__mixed__'
        const modelBuckets = new Map<
          string,
          { assistantId: string; modelLabel: string; topics: Topic[]; messages: Message[]; blocks: MessageBlock[] }
        >()
        const allTopics: Topic[] = []
        const allMessages: Message[] = []
        const allBlocks: MessageBlock[] = []
        const errors: string[] = []

        const getClaudeModelKey = (fileContent: string): string | null => {
          try {
            const parsed = JSON.parse(fileContent)
            const conversations = Array.isArray(parsed) ? parsed : [parsed]
            const models = new Set<string>()
            for (const conversation of conversations) {
              const model = typeof conversation?.model === 'string' ? conversation.model.trim() : ''
              if (model) {
                models.add(model)
              }
            }
            if (models.size === 1) {
              return Array.from(models)[0]
            }
            if (models.size > 1) {
              return mixedModelKey
            }
            return null
          } catch {
            return null
          }
        }

        for (let i = 0; i < fileContents.length; i++) {
          const fileContent = fileContents[i]
          onProgress?.(i + 1, fileContents.length)

          try {
            if (!importer.validate(fileContent)) {
              errors.push(`File ${i + 1}: Invalid format`)
              continue
            }

            const detectedModelKey = getClaudeModelKey(fileContent) || unknownModelKey
            let bucket = modelBuckets.get(detectedModelKey)
            if (!bucket) {
              const modelLabel =
                detectedModelKey === unknownModelKey
                  ? 'Unknown Model'
                  : detectedModelKey === mixedModelKey
                    ? 'Mixed Models'
                    : claudeImporter.getAssistantModelLabel(detectedModelKey)
              bucket = {
                assistantId: uuid(),
                modelLabel,
                topics: [],
                messages: [],
                blocks: []
              }
              modelBuckets.set(detectedModelKey, bucket)
            }

            const result = await importer.parse(fileContent, bucket.assistantId)
            bucket.topics.push(...result.topics)
            bucket.messages.push(...result.messages)
            bucket.blocks.push(...result.blocks)
            allTopics.push(...result.topics)
            allMessages.push(...result.messages)
            allBlocks.push(...result.blocks)
          } catch (error) {
            errors.push(`File ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        if (allTopics.length === 0) {
          return {
            success: false,
            topicsCount: 0,
            messagesCount: 0,
            error: errors.length > 0 ? errors.slice(0, 3).join('; ') : 'No valid conversations found'
          }
        }

        await saveImportToDatabase({
          topics: allTopics,
          messages: allMessages,
          blocks: allBlocks
        })

        const importerKey = `import.${importer.name.toLowerCase()}.assistant_name`
        const baseAssistantName = i18n.t(importerKey, {
          defaultValue: `${importer.name} Import`
        })

        const assistants: Assistant[] = []
        const buckets = Array.from(modelBuckets.values()).filter((bucket) => bucket.topics.length > 0)
        for (const bucket of buckets) {
          const assistant: Assistant = {
            id: bucket.assistantId,
            name: `${baseAssistantName} - ${bucket.modelLabel}`,
            emoji: importer.emoji,
            prompt: '',
            topics: bucket.topics,
            messages: [],
            type: 'assistant',
            settings: DEFAULT_ASSISTANT_SETTINGS
          }
          store.dispatch(addAssistant(assistant))
          assistants.push(assistant)
        }

        logger.info(
          `Batch import completed: ${allTopics.length} conversations, ${allMessages.length} messages imported`
        )

        if (errors.length > 0) {
          logger.warn(`Batch import had ${errors.length} errors:`, errors.slice(0, 5))
        }

        return {
          success: true,
          assistant: assistants[0],
          topicsCount: allTopics.length,
          messagesCount: allMessages.length,
          error: errors.length > 0 ? `${errors.length} files had errors` : undefined
        }
      }

      // Create a single assistant for all files
      const assistantId = uuid()

      const allTopics: Topic[] = []
      const allMessages: Message[] = []
      const allBlocks: MessageBlock[] = []
      const errors: string[] = []

      for (let i = 0; i < fileContents.length; i++) {
        const fileContent = fileContents[i]
        onProgress?.(i + 1, fileContents.length)

        try {
          // Validate format
          if (!importer.validate(fileContent)) {
            errors.push(`File ${i + 1}: Invalid format`)
            continue
          }

          // Parse conversations
          const result = await importer.parse(fileContent, assistantId)

          allTopics.push(...result.topics)
          allMessages.push(...result.messages)
          allBlocks.push(...result.blocks)
        } catch (error) {
          errors.push(`File ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      if (allTopics.length === 0) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: errors.length > 0 ? errors.slice(0, 3).join('; ') : 'No valid conversations found'
        }
      }

      // Save all to database
      await saveImportToDatabase({
        topics: allTopics,
        messages: allMessages,
        blocks: allBlocks
      })

      // Create single assistant for all imported conversations
      const importerKey = `import.${importer.name.toLowerCase()}.assistant_name`
      const assistant: Assistant = {
        id: assistantId,
        name: i18n.t(importerKey, {
          defaultValue: `${importer.name} Import`
        }),
        emoji: importer.emoji,
        prompt: '',
        topics: allTopics,
        messages: [],
        type: 'assistant',
        settings: DEFAULT_ASSISTANT_SETTINGS
      }

      // Add assistant to store
      store.dispatch(addAssistant(assistant))

      logger.info(`Batch import completed: ${allTopics.length} conversations, ${allMessages.length} messages imported`)

      if (errors.length > 0) {
        logger.warn(`Batch import had ${errors.length} errors:`, errors.slice(0, 5))
      }

      return {
        success: true,
        assistant,
        topicsCount: allTopics.length,
        messagesCount: allMessages.length,
        error: errors.length > 0 ? `${errors.length} files had errors` : undefined
      }
    } catch (error) {
      logger.error('Batch import failed:', error as Error)
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
   * True streaming import - reads, processes, and saves each chunk before moving to next
   * Never holds more than one chunk in memory at a time
   * @param filePaths - Array of file paths to import
   * @param chunkSize - Number of files per chunk
   * @param readFile - Function to read a single file (provided by caller)
   * @param importerName - Name of the importer to use
   * @param onProgress - Optional callback for progress updates
   * @param options - Optional import options (e.g., importAllBranches for Claude)
   */
  async importStreamingChunks(
    filePaths: string[],
    chunkSize: number,
    readFile: (path: string) => Promise<string>,
    importerName: string,
    onProgress?: (current: number, total: number) => void,
    options?: { importAllBranches?: boolean }
  ): Promise<ImportResponse> {
    try {
      const totalFiles = filePaths.length
      const totalChunks = Math.ceil(totalFiles / chunkSize)
      logger.info(`Starting streaming import: ${totalFiles} files in ${totalChunks} chunks of ${chunkSize}`)

      const importer = this.getImporter(importerName)
      if (!importer) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: `Importer "${importerName}" not found`
        }
      }

      // Model bucketing for Claude imports
      const isClaudeImport = importerName.toLowerCase() === 'claude'
      const claudeImporter = isClaudeImport ? (importer as { getAssistantModelLabel?: (m: string) => string }) : null
      const unknownModelKey = '__unknown__'
      const mixedModelKey = '__mixed__'

      interface ModelBucket {
        assistantId: string
        modelLabel: string
        topicRefs: Topic[]
      }

      const modelBuckets = new Map<string, ModelBucket>()
      let totalTopics = 0
      let totalMessages = 0
      const errors: string[] = []

      // Helper to get model key from file content
      const getClaudeModelKey = (fileContent: string): string | null => {
        try {
          const parsed = JSON.parse(fileContent)
          const conversations = Array.isArray(parsed) ? parsed : [parsed]
          const models = new Set<string>()
          for (const conversation of conversations) {
            const model = typeof conversation?.model === 'string' ? conversation.model.trim() : ''
            if (model) models.add(model)
          }
          if (models.size === 1) return Array.from(models)[0]
          if (models.size > 1) return mixedModelKey
          return null
        } catch {
          return null
        }
      }

      // Process chunks one at a time - TRUE STREAMING
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const startIdx = chunkIndex * chunkSize
        const endIdx = Math.min(startIdx + chunkSize, totalFiles)
        const chunkPaths = filePaths.slice(startIdx, endIdx)

        logger.info(`Chunk ${chunkIndex + 1}/${totalChunks}: Reading ${chunkPaths.length} files...`)

        // Read files for THIS chunk only - track which files succeeded
        const chunkContents: Array<{ content: string; filePath: string }> = []
        for (let i = 0; i < chunkPaths.length; i++) {
          const filePath = chunkPaths[i]
          const fileName = filePath.split('/').pop() || filePath
          onProgress?.(startIdx + i + 1, totalFiles)

          try {
            const content = await readFile(filePath)
            chunkContents.push({ content, filePath })
          } catch (error) {
            const errMsg = `READ FAILED: ${fileName}`
            logger.warn(errMsg, { filePath, error })
            errors.push(errMsg)
          }
        }

        // Process THIS chunk
        const chunkTopics: Topic[] = []
        const chunkMessages: Message[] = []
        const chunkBlocks: MessageBlock[] = []
        const topicToBucket = new Map<string, string>()

        for (let i = 0; i < chunkContents.length; i++) {
          const { content: fileContent, filePath } = chunkContents[i]
          const fileName = filePath.split('/').pop() || filePath

          try {
            if (!importer.validate(fileContent)) {
              const errMsg = `INVALID FORMAT: ${fileName}`
              logger.warn(errMsg, { filePath })
              errors.push(errMsg)
              continue
            }

            // Determine model bucket
            let bucketKey = 'default'
            if (isClaudeImport) {
              bucketKey = getClaudeModelKey(fileContent) || unknownModelKey
            }

            // Get or create bucket
            let bucket = modelBuckets.get(bucketKey)
            if (!bucket) {
              let modelLabel = 'Import'
              if (isClaudeImport && claudeImporter?.getAssistantModelLabel) {
                modelLabel =
                  bucketKey === unknownModelKey
                    ? 'Unknown Model'
                    : bucketKey === mixedModelKey
                      ? 'Mixed Models'
                      : claudeImporter.getAssistantModelLabel(bucketKey)
              }
              bucket = {
                assistantId: uuid(),
                modelLabel,
                topicRefs: []
              }
              modelBuckets.set(bucketKey, bucket)
            }

            const result = await importer.parse(fileContent, bucket.assistantId, options)

            // Check if parsing produced any topics
            if (result.topics.length === 0) {
              const errMsg = `EMPTY (no messages): ${fileName}`
              logger.warn(errMsg, { filePath })
              errors.push(errMsg)
              continue
            }

            for (const topic of result.topics) {
              topicToBucket.set(topic.id, bucketKey)
            }

            chunkTopics.push(...result.topics)
            chunkMessages.push(...result.messages)
            chunkBlocks.push(...result.blocks)
          } catch (error) {
            const errMsg = `PARSE ERROR: ${fileName} - ${error instanceof Error ? error.message : 'Unknown error'}`
            logger.warn(errMsg, { filePath, error })
            errors.push(errMsg)
          }
        }

        // SAVE THIS CHUNK TO DATABASE IMMEDIATELY
        if (chunkTopics.length > 0) {
          logger.info(
            `Chunk ${chunkIndex + 1}: Saving ${chunkTopics.length} topics, ${chunkMessages.length} messages to DB...`
          )
          await saveImportToDatabase({
            topics: chunkTopics,
            messages: chunkMessages,
            blocks: chunkBlocks
          })

          // Add minimal topic refs to buckets (only id, name, assistantId - not full messages)
          for (const topic of chunkTopics) {
            const bucketKey = topicToBucket.get(topic.id) || 'default'
            const bucket = modelBuckets.get(bucketKey)
            if (bucket) {
              // Store minimal reference only
              bucket.topicRefs.push({
                id: topic.id,
                assistantId: topic.assistantId,
                name: topic.name,
                createdAt: topic.createdAt,
                updatedAt: topic.updatedAt,
                messages: [], // Empty - don't hold message refs
                isNameManuallyEdited: topic.isNameManuallyEdited
              })
            }
          }

          totalTopics += chunkTopics.length
          totalMessages += chunkMessages.length
        }

        // EXPLICIT MEMORY CLEANUP - help GC by clearing references
        chunkContents.length = 0
        chunkTopics.length = 0
        chunkMessages.length = 0
        chunkBlocks.length = 0
        topicToBucket.clear()

        // Small delay to allow garbage collection to run
        await new Promise((resolve) => setTimeout(resolve, 10))

        logger.info(`Chunk ${chunkIndex + 1}: Complete. Total so far: ${totalTopics} topics`)
      }

      if (totalTopics === 0) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: errors.length > 0 ? errors.slice(0, 3).join('; ') : 'No valid conversations found'
        }
      }

      // Create assistants
      const assistants: Assistant[] = []
      const buckets = Array.from(modelBuckets.values()).filter((b) => b.topicRefs.length > 0)

      for (const bucket of buckets) {
        // Use "[Model] (Import)" format for Claude, just "Import" for others
        const assistantName = isClaudeImport ? `${bucket.modelLabel} (Import)` : 'Import'
        const assistant: Assistant = {
          id: bucket.assistantId,
          name: assistantName,
          emoji: importer.emoji,
          prompt: '',
          topics: bucket.topicRefs,
          messages: [],
          type: 'assistant',
          settings: DEFAULT_ASSISTANT_SETTINGS
        }
        store.dispatch(addAssistant(assistant))
        assistants.push(assistant)
      }

      logger.info(
        `Streaming import complete: ${totalTopics} topics, ${totalMessages} messages, ${assistants.length} assistants`
      )

      // Log detailed error summary
      if (errors.length > 0) {
        logger.warn(`=== IMPORT ERRORS SUMMARY (${errors.length} files) ===`)
        const readErrors = errors.filter((e) => e.startsWith('READ FAILED'))
        const formatErrors = errors.filter((e) => e.startsWith('INVALID FORMAT'))
        const emptyErrors = errors.filter((e) => e.startsWith('EMPTY'))
        const parseErrors = errors.filter((e) => e.startsWith('PARSE ERROR'))

        if (readErrors.length > 0) {
          logger.warn(`Read failures (${readErrors.length}):`, readErrors)
        }
        if (formatErrors.length > 0) {
          logger.warn(`Invalid format (${formatErrors.length}):`, formatErrors)
        }
        if (emptyErrors.length > 0) {
          logger.warn(`Empty conversations (${emptyErrors.length}):`, emptyErrors)
        }
        if (parseErrors.length > 0) {
          logger.warn(`Parse errors (${parseErrors.length}):`, parseErrors)
        }
        logger.warn(`=== END ERROR SUMMARY ===`)
      }

      return {
        success: true,
        assistant: assistants[0],
        topicsCount: totalTopics,
        messagesCount: totalMessages,
        error: errors.length > 0 ? `${errors.length} files had errors` : undefined
      }
    } catch (error) {
      logger.error('Streaming import failed:', error as Error)
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
   * Import files in chunks to avoid memory issues with large imports
   * Processes each chunk and saves to database before moving to next chunk
   * Groups by model like importBatch for Claude imports
   * @deprecated Use importStreamingChunks instead for true streaming
   */
  async importBatchChunked(
    chunks: string[][],
    importerName: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<ImportResponse> {
    try {
      const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      logger.info(`Starting chunked import: ${chunks.length} chunks, ${totalFiles} total files`)

      const importer = this.getImporter(importerName)
      if (!importer) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: `Importer "${importerName}" not found`
        }
      }

      // Model bucketing for Claude imports (creates separate assistants per model)
      const isClaudeImport = importerName.toLowerCase() === 'claude'
      const claudeImporter = isClaudeImport ? (importer as { getAssistantModelLabel?: (m: string) => string }) : null
      const unknownModelKey = '__unknown__'
      const mixedModelKey = '__mixed__'

      interface ModelBucket {
        assistantId: string
        modelLabel: string
        topicRefs: Topic[] // Only minimal refs for assistant
      }

      const modelBuckets = new Map<string, ModelBucket>()
      let totalTopics = 0
      let totalMessages = 0
      const errors: string[] = []
      let processedFiles = 0

      // Helper to get model key from file content
      const getClaudeModelKey = (fileContent: string): string | null => {
        try {
          const parsed = JSON.parse(fileContent)
          const conversations = Array.isArray(parsed) ? parsed : [parsed]
          const models = new Set<string>()
          for (const conversation of conversations) {
            const model = typeof conversation?.model === 'string' ? conversation.model.trim() : ''
            if (model) models.add(model)
          }
          if (models.size === 1) return Array.from(models)[0]
          if (models.size > 1) return mixedModelKey
          return null
        } catch {
          return null
        }
      }

      // Process each chunk separately
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex]
        const chunkTopics: Topic[] = []
        const chunkMessages: Message[] = []
        const chunkBlocks: MessageBlock[] = []

        // Track which bucket each topic belongs to (for this chunk)
        const topicToBucket = new Map<string, string>()

        logger.info(`Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} files`)

        for (let i = 0; i < chunk.length; i++) {
          const fileContent = chunk[i]
          processedFiles++
          onProgress?.(processedFiles, totalFiles)

          try {
            if (!importer.validate(fileContent)) {
              errors.push(`Chunk ${chunkIndex + 1}, File ${i + 1}: Invalid format`)
              continue
            }

            // Determine model bucket for Claude imports
            let bucketKey = 'default'
            if (isClaudeImport) {
              bucketKey = getClaudeModelKey(fileContent) || unknownModelKey
            }

            // Get or create bucket
            let bucket = modelBuckets.get(bucketKey)
            if (!bucket) {
              let modelLabel = 'Import'
              if (isClaudeImport && claudeImporter?.getAssistantModelLabel) {
                modelLabel =
                  bucketKey === unknownModelKey
                    ? 'Unknown Model'
                    : bucketKey === mixedModelKey
                      ? 'Mixed Models'
                      : claudeImporter.getAssistantModelLabel(bucketKey)
              }
              bucket = {
                assistantId: uuid(),
                modelLabel,
                topicRefs: []
              }
              modelBuckets.set(bucketKey, bucket)
            }

            const result = await importer.parse(fileContent, bucket.assistantId)

            // Track which bucket these topics belong to
            for (const topic of result.topics) {
              topicToBucket.set(topic.id, bucketKey)
            }

            chunkTopics.push(...result.topics)
            chunkMessages.push(...result.messages)
            chunkBlocks.push(...result.blocks)
          } catch (error) {
            errors.push(
              `Chunk ${chunkIndex + 1}, File ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          }
        }

        // Save this chunk to database immediately to free memory
        if (chunkTopics.length > 0) {
          logger.info(`Saving chunk ${chunkIndex + 1}: ${chunkTopics.length} topics, ${chunkMessages.length} messages`)
          await saveImportToDatabase({
            topics: chunkTopics,
            messages: chunkMessages,
            blocks: chunkBlocks
          })

          // Add topic refs to appropriate buckets (minimal memory)
          for (const topic of chunkTopics) {
            const bucketKey = topicToBucket.get(topic.id) || 'default'
            const bucket = modelBuckets.get(bucketKey)
            if (bucket) {
              bucket.topicRefs.push({ ...topic, messages: [] })
            }
          }

          totalTopics += chunkTopics.length
          totalMessages += chunkMessages.length
        }
      }

      if (totalTopics === 0) {
        return {
          success: false,
          topicsCount: 0,
          messagesCount: 0,
          error: errors.length > 0 ? errors.slice(0, 3).join('; ') : 'No valid conversations found'
        }
      }

      // Create assistants (one per model bucket for Claude, one for others)
      const importerKey = `import.${importer.name.toLowerCase()}.assistant_name`
      const baseAssistantName = i18n.t(importerKey, {
        defaultValue: `${importer.name} Import`
      })

      const assistants: Assistant[] = []
      const buckets = Array.from(modelBuckets.values()).filter((b) => b.topicRefs.length > 0)

      for (const bucket of buckets) {
        const assistant: Assistant = {
          id: bucket.assistantId,
          name: isClaudeImport ? `${baseAssistantName} - ${bucket.modelLabel}` : baseAssistantName,
          emoji: importer.emoji,
          prompt: '',
          topics: bucket.topicRefs,
          messages: [],
          type: 'assistant',
          settings: DEFAULT_ASSISTANT_SETTINGS
        }
        store.dispatch(addAssistant(assistant))
        assistants.push(assistant)
      }

      logger.info(
        `Chunked import completed: ${totalTopics} conversations, ${totalMessages} messages, ${assistants.length} assistants`
      )

      if (errors.length > 0) {
        logger.warn(`Chunked import had ${errors.length} errors`)
      }

      return {
        success: true,
        assistant: assistants[0],
        topicsCount: totalTopics,
        messagesCount: totalMessages,
        error: errors.length > 0 ? `${errors.length} files had errors` : undefined
      }
    } catch (error) {
      logger.error('Chunked import failed:', error as Error)
      return {
        success: false,
        topicsCount: 0,
        messagesCount: 0,
        error:
          error instanceof Error ? error.message : i18n.t('import.error.unknown', { defaultValue: 'Unknown error' })
      }
    }
  }
}

// Export singleton instance
export const ImportService = new ImportServiceClass()

// Export for backward compatibility
export const importChatGPTConversations = (fileContent: string) => ImportService.importChatGPTConversations(fileContent)
