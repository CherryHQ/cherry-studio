/**
 * KnowledgeServiceV2 - Complete Knowledge Base Service
 *
 * This service manages knowledge bases using vectorstores for RAG (Retrieval-Augmented Generation).
 * It supports multiple content types: file, directory, url, sitemap, and note.
 *
 * Features:
 * - Concurrent task processing with workload management
 * - Multiple data source support via reader registry
 * - Vector database integration using LibSQLVectorStore
 * - Support for vector, BM25, and hybrid search modes
 */

import * as fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { LoaderReturn } from '@shared/config/types'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { VectorStoreQueryResult } from '@vectorstores/core'
import { MetadataMode } from '@vectorstores/core'
import { LIBSQL_TABLE, LibSQLVectorStore } from '@vectorstores/libsql'

import Embeddings from './embedjs/embeddings/Embeddings'
import type { ResolvedKnowledgeBase } from './KnowledgeProviderAdapter'
import { knowledgeProviderAdapter } from './KnowledgeProviderAdapter'
import { knowledgeQueueManager } from './KnowledgeQueueManager'
import Reranker from './reranker/Reranker'
import { DEFAULT_DOCUMENT_COUNT } from './utils/knowledge'
import { embedNodes } from './vectorstores/EmbeddingPipeline'
import { getReader } from './vectorstores/reader'
import {
  type KnowledgeBaseAddItemOptions,
  type KnowledgeBaseRemoveOptions,
  type KnowledgeItemType,
  type ReaderContext,
  type RerankOptions,
  type SearchOptions
} from './vectorstores/types'

const logger = loggerService.withContext('KnowledgeServiceV2')

/**
 * Error return template for failed operations
 */
const ERROR_LOADER_RETURN: LoaderReturn = {
  entriesAdded: 0,
  uniqueId: '',
  uniqueIds: [''],
  loaderType: '',
  status: 'failed'
}

/**
 * KnowledgeServiceV2 manages knowledge bases with vectorstores backend
 */
class KnowledgeServiceV2 {
  private storageDir = path.join(getDataPath(), 'KnowledgeBase')
  private pendingDeleteFile = path.join(this.storageDir, 'knowledge_pending_delete_v2.json')
  private storeCache: Map<string, LibSQLVectorStore> = new Map()

  constructor() {
    this.initStorageDir()
    this.cleanupOnStartup()
  }

  private initStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  /**
   * Get database file path for a knowledge base
   */
  private getDbPath(id: string): string {
    return path.join(this.storageDir, sanitizeFilename(id, '_'))
  }

  private async getEmbeddingSchemaInfo(
    store: LibSQLVectorStore
  ): Promise<{ dimensions: number | null; columnType: string | null }> {
    try {
      const result = await store.client().execute({
        sql: `PRAGMA table_info(${LIBSQL_TABLE})`,
        args: []
      })
      const embeddingRow = result.rows.find((row) => String(row.name) === 'embeddings')
      if (!embeddingRow) {
        return { dimensions: null, columnType: null }
      }
      const columnType = String(embeddingRow.type ?? '')
      const match = /F32_BLOB\((\d+)\)/i.exec(columnType)
      return { dimensions: match ? Number(match[1]) : null, columnType }
    } catch (error) {
      logger.debug('[KnowledgeV2] Failed to read embedding schema info', error as Error)
      return { dimensions: null, columnType: null }
    }
  }

  private async logEmbeddingSchemaInfo(store: LibSQLVectorStore, baseId: string, context: string): Promise<void> {
    const { dimensions, columnType } = await this.getEmbeddingSchemaInfo(store)
    logger.debug(`[KnowledgeV2] ${context} embedding schema`, {
      baseId,
      table: LIBSQL_TABLE,
      dimensions: dimensions ?? 'unknown',
      columnType: columnType ?? 'unknown'
    })
  }

  /**
   * Get or create a LibSQLVectorStore for a knowledge base
   */
  private async getOrCreateStore(base: ResolvedKnowledgeBase): Promise<LibSQLVectorStore> {
    if (this.storeCache.has(base.id)) {
      return this.storeCache.get(base.id)!
    }

    const dbPath = this.getDbPath(base.id)
    const store = new LibSQLVectorStore({
      clientConfig: { url: `file:${dbPath}` },
      dimensions: base.dimensions,
      collection: ''
    })

    this.storeCache.set(base.id, store)
    return store
  }

  /**
   * Clean up store from cache
   */
  private cleanupStoreCache(id: string): void {
    if (this.storeCache.has(id)) {
      this.storeCache.delete(id)
      logger.debug(`Cleaned up store cache for id: ${id}`)
    }
  }

  // ============================================================================
  // Pending Delete Management
  // ============================================================================

  private pendingDeleteManager = {
    load: (): string[] => {
      try {
        if (fs.existsSync(this.pendingDeleteFile)) {
          return JSON.parse(fs.readFileSync(this.pendingDeleteFile, 'utf-8')) as string[]
        }
      } catch (error) {
        logger.warn('Failed to load pending delete IDs:', error as Error)
      }
      return []
    },

    save: (ids: string[]): void => {
      try {
        fs.writeFileSync(this.pendingDeleteFile, JSON.stringify(ids, null, 2))
        logger.debug(`Total ${ids.length} knowledge bases pending delete`)
      } catch (error) {
        logger.warn('Failed to save pending delete IDs:', error as Error)
      }
    },

    add: (id: string): void => {
      const existingIds = this.pendingDeleteManager.load()
      const allIds = [...new Set([...existingIds, id])]
      this.pendingDeleteManager.save(allIds)
    },

    clear: (): void => {
      try {
        if (fs.existsSync(this.pendingDeleteFile)) {
          fs.unlinkSync(this.pendingDeleteFile)
        }
      } catch (error) {
        logger.warn('Failed to clear pending delete file:', error as Error)
      }
    }
  }

  /**
   * Delete knowledge base file
   */
  private deleteKnowledgeFile(id: string): boolean {
    const dbPath = this.getDbPath(id)
    if (fs.existsSync(dbPath)) {
      try {
        fs.rmSync(dbPath, { recursive: true })
        logger.debug(`Deleted knowledge base file with id: ${id}`)
        return true
      } catch (error) {
        logger.warn(`Failed to delete knowledge base file with id: ${id}: ${error}`)
        return false
      }
    }
    return true
  }

  /**
   * Clean up databases marked for deletion on startup
   */
  private cleanupOnStartup(): void {
    const pendingDeleteIds = this.pendingDeleteManager.load()
    if (pendingDeleteIds.length === 0) return

    logger.info(`Found ${pendingDeleteIds.length} knowledge bases pending deletion from previous session`)

    let deletedCount = 0
    pendingDeleteIds.forEach((id) => {
      if (this.deleteKnowledgeFile(id)) {
        deletedCount++
      } else {
        logger.warn(`Failed to delete knowledge base ${id}, please delete it manually`)
      }
    })

    this.pendingDeleteManager.clear()
    logger.info(`Startup cleanup completed: ${deletedCount}/${pendingDeleteIds.length} knowledge bases deleted`)
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Create/initialize a knowledge base
   */
  public create = async (base: KnowledgeBase): Promise<void> => {
    const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
    logger.info(`[KnowledgeV2] Create called for base ${base.id}`, {
      dimensions: resolvedBase.dimensions ?? 'auto',
      model: resolvedBase.embedApiClient.model,
      provider: resolvedBase.embedApiClient.provider
    })
    await this.getOrCreateStore(resolvedBase)
  }

  /**
   * Reset a knowledge base (clear all data)
   */
  public reset = async (base: KnowledgeBase): Promise<void> => {
    logger.info(`[KnowledgeV2] Reset called for base ${base.id}`)
    const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
    const store = await this.getOrCreateStore(resolvedBase)
    await store.clearCollection()
    logger.info(`[KnowledgeV2] Reset completed for base ${base.id}`)
  }

  /**
   * Delete a knowledge base entirely
   */
  public delete = async (id: string): Promise<void> => {
    logger.info(`[KnowledgeV2] Delete called for id: ${id}`)

    this.cleanupStoreCache(id)

    // Small delay to ensure connections are closed
    await new Promise((resolve) => setTimeout(resolve, 100))

    if (!this.deleteKnowledgeFile(id)) {
      logger.debug(`Will delete knowledge base ${id} on next startup`)
      this.pendingDeleteManager.add(id)
    }
  }

  // ============================================================================
  // Content Management
  // ============================================================================

  /**
   * Add content to knowledge base
   * This is the main entry point for adding any type of content
   */
  public add = async (options: KnowledgeBaseAddItemOptions): Promise<LoaderReturn> => {
    const { base, item, userId = '', signal, onStageChange } = options
    const itemType = item.type as KnowledgeItemType

    logger.info(`[KnowledgeV2] Add called: type=${itemType}, base=${base.id}, item=${item.id}`)

    // Check if reader exists for this type
    const reader = getReader(itemType)
    if (!reader) {
      logger.warn(`[KnowledgeV2] No reader for type: ${itemType}`)
      return {
        ...ERROR_LOADER_RETURN,
        message: `Unsupported item type: ${itemType}`,
        messageSource: 'validation'
      }
    }

    const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')

    // Create reader context
    const context: ReaderContext = {
      base: resolvedBase,
      item,
      itemId: item.id,
      userId
    }

    try {
      return await this.processAddTask(context, { signal, onStageChange })
    } catch (error) {
      logger.error(`[KnowledgeV2] Add task failed for item ${item.id}:`, error as Error)
      return {
        ...ERROR_LOADER_RETURN,
        message: error instanceof Error ? error.message : String(error),
        messageSource: 'embedding'
      }
    }
  }

  /**
   * Process add task (called by queue)
   */
  private async processAddTask(
    context: ReaderContext,
    options: { signal?: AbortSignal; onStageChange?: KnowledgeBaseAddItemOptions['onStageChange'] }
  ): Promise<LoaderReturn> {
    const { base, item } = context
    const itemType = item.type as KnowledgeItemType

    try {
      this.throwIfAborted(options.signal, item.id)
      options.onStageChange?.('preprocessing')
      // TODO: Preprocessing integration point
      // When PreprocessingService is ready, call it here for PDF files:
      // if (itemType === 'file') {
      //   processedItem = await preprocessingService.preprocessIfNeeded(item, base, userId)
      // }

      // Read content using appropriate reader
      const reader = getReader(itemType)!
      const readerResult = await reader.read(context)

      if (readerResult.nodes.length === 0) {
        logger.warn(`[KnowledgeV2] No content read for item ${item.id}`)
        return {
          entriesAdded: 0,
          uniqueId: readerResult.uniqueId,
          uniqueIds: [readerResult.uniqueId],
          loaderType: readerResult.readerType
        }
      }

      this.throwIfAborted(options.signal, item.id)
      options.onStageChange?.('embedding')

      // Step 3: Embed nodes
      logger.info(`[KnowledgeV2] Embedding ${readerResult.nodes.length} nodes for item ${item.id}`)
      const embeddedNodes = await embedNodes(readerResult.nodes, base)
      const embeddedDimensions = embeddedNodes[0]?.getEmbedding()?.length ?? 0
      logger.debug('[KnowledgeV2] Embedding dimensions resolved', {
        baseId: base.id,
        baseDimensions: base.dimensions ?? 'auto',
        embeddedDimensions
      })

      this.throwIfAborted(options.signal, item.id)

      // Step 4: Store in vector database
      const store = await this.getOrCreateStore(base)
      const insertedIds = await store.add(embeddedNodes)
      await this.logEmbeddingSchemaInfo(store, base.id, 'Post-add')

      logger.info(`[KnowledgeV2] Add completed: item=${item.id}, nodes=${insertedIds.length}`)

      return {
        entriesAdded: insertedIds.length,
        uniqueId: readerResult.uniqueId,
        uniqueIds: [readerResult.uniqueId],
        loaderType: readerResult.readerType
      }
    } catch (error) {
      logger.error(`[KnowledgeV2] Process add task failed for item ${item.id}:`, error as Error)
      throw error
    }
  }

  /**
   * Remove content from knowledge base
   */
  public remove = async (options: KnowledgeBaseRemoveOptions): Promise<void> => {
    const { uniqueId, uniqueIds, base, externalId } = options

    logger.info(`[KnowledgeV2] Remove called: uniqueId=${uniqueId}, externalId=${externalId}`)

    // Use external_id based deletion if available
    if (externalId) {
      await this.removeByExternalId({ base, externalId })
      return
    }

    // Fall back to uniqueId based deletion (v1 compatibility)
    if (uniqueIds && uniqueIds.length > 0) {
      const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
      const store = await this.getOrCreateStore(resolvedBase)
      for (const id of uniqueIds) {
        try {
          await store.delete(id)
        } catch (error) {
          logger.warn(`Failed to delete by uniqueId ${id}:`, error as Error)
        }
      }
    }
  }

  /**
   * Remove content by external_id
   */
  public async removeByExternalId({ base, externalId }: { base: KnowledgeBase; externalId: string }): Promise<number> {
    const dbPath = this.getDbPath(base.id)
    if (!fs.existsSync(dbPath)) {
      logger.warn(`[KnowledgeV2] Remove skipped: db not found: ${dbPath}`)
      return 0
    }

    try {
      const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
      const store = await this.getOrCreateStore(resolvedBase)
      const deleted = await store.deleteByExternalId(externalId)
      logger.info(`[KnowledgeV2] Remove completed: external_id=${externalId}, rows=${deleted}`)
      return deleted
    } catch (error) {
      logger.error(`[KnowledgeV2] Remove failed for external_id ${externalId}:`, error as Error)
      return 0
    }
  }

  // ============================================================================
  // Search & Retrieval
  // ============================================================================

  /**
   * Search the knowledge base
   */
  public search = async (
    options: SearchOptions | { search: string; base: KnowledgeBase }
  ): Promise<KnowledgeSearchResult[]> => {
    const { search, base } = options
    const mode = 'mode' in options ? options.mode : 'default'
    const alpha = 'alpha' in options ? options.alpha : 0.5

    const dbPath = this.getDbPath(base.id)

    if (!fs.existsSync(dbPath)) {
      logger.warn(`[KnowledgeV2] Search skipped: db not found: ${dbPath}`)
      return []
    }

    try {
      const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
      logger.info(`[KnowledgeV2] Search starting for base ${base.id}, mode=${mode}`)

      // Embed the query
      const embeddingsClient = new Embeddings({
        embedApiClient: resolvedBase.embedApiClient,
        dimensions: resolvedBase.dimensions
      })
      const queryEmbedding = await embeddingsClient.embedQuery(search)
      logger.debug('[KnowledgeV2] Search query embedding dimensions', {
        baseId: base.id,
        baseDimensions: resolvedBase.dimensions ?? 'auto',
        queryDimensions: queryEmbedding.length
      })

      // Perform search
      const dimensions = resolvedBase.dimensions ?? queryEmbedding.length
      const store = new LibSQLVectorStore({
        clientConfig: { url: `file:${dbPath}` },
        dimensions,
        collection: ''
      })
      await this.logEmbeddingSchemaInfo(store, base.id, 'Pre-search')

      const topK = resolvedBase.documentCount ?? DEFAULT_DOCUMENT_COUNT
      const queryResult = await store.query({
        queryEmbedding,
        queryStr: search,
        similarityTopK: topK,
        mode: mode ?? 'default',
        alpha
      })

      logger.info(`[KnowledgeV2] Search completed: ${queryResult.nodes?.length ?? 0} results`)

      return this.mapQueryResultToSearchResults(queryResult)
    } catch (error) {
      logger.error(`[KnowledgeV2] Search failed for base ${base.id}:`, error as Error)
      throw error
    }
  }

  /**
   * Map VectorStoreQueryResult to KnowledgeSearchResult[]
   */
  private mapQueryResultToSearchResults(queryResult: VectorStoreQueryResult): KnowledgeSearchResult[] {
    const nodes = queryResult.nodes ?? []
    const similarities = queryResult.similarities ?? []

    return nodes.map((node, index) => ({
      pageContent: node.getContent(MetadataMode.NONE),
      score: similarities[index] ?? 0,
      metadata: node.metadata ?? {}
    }))
  }

  /**
   * Rerank search results
   */
  public rerank = async (
    options: RerankOptions | { search: string; base: KnowledgeBase; results: KnowledgeSearchResult[] }
  ): Promise<KnowledgeSearchResult[]> => {
    const { search, base, results } = options

    if (results.length === 0) {
      return results
    }

    const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'rerankModelId')
    return new Reranker(resolvedBase).rerank(search, results)
  }

  // ============================================================================
  // Preprocessing Interface (To be implemented by separate PreprocessingService)
  // ============================================================================

  /**
   * Preprocessing will be extracted as a separate service.
   * The following interfaces should be implemented:
   *
   * interface PreprocessingService {
   *   // Parse file (e.g., convert PDF to markdown)
   *   parseFile(sourceId: string, file: FileMetadata): Promise<{ processedFile: FileMetadata; quota?: number }>
   *
   *   // Check preprocessing quota
   *   checkQuota(userId: string): Promise<number>
   *
   *   // Check if file was already preprocessed (cache check)
   *   checkIfAlreadyProcessed(file: FileMetadata): Promise<FileMetadata | null>
   * }
   *
   * Events to emit:
   * - 'file-preprocess-finished': { itemId: string, quota?: number }
   * - 'file-preprocess-progress': { itemId: string, progress: number }
   */

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get storage directory path
   */
  public getStorageDir = (): string => {
    return this.storageDir
  }

  /**
   * Get queue status
   */
  public getQueueStatus(): { queueSize: number; processingCount: number } {
    return knowledgeQueueManager.getStatus()
  }

  private throwIfAborted(signal: AbortSignal | undefined, itemId: string): void {
    if (!signal?.aborted) {
      return
    }

    const error = new Error(`Knowledge item ${itemId} cancelled`)
    error.name = 'AbortError'
    throw error
  }
}

export const knowledgeServiceV2 = new KnowledgeServiceV2()
