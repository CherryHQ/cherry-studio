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
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { VectorStoreQueryResult } from '@vectorstores/core'
import { MetadataMode } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import Embeddings from './embeddings'
import type { ResolvedKnowledgeBase } from './KnowledgeProviderAdapter'
import { knowledgeProviderAdapter } from './KnowledgeProviderAdapter'
import Reranker from './reranker/Reranker'
import { DEFAULT_DOCUMENT_COUNT } from './utils/knowledge'
import { embedNodes } from './vectorstores/EmbeddingPipeline'
import { getReader } from './vectorstores/readers'
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
 * KnowledgeServiceV2 manages knowledge bases with vectorstores backend
 */
class KnowledgeServiceV2 {
  private storageDir = path.join(getDataPath(), 'KnowledgeBase')
  private storeCache: Map<string, LibSQLVectorStore> = new Map()

  constructor() {
    this.initStorageDir()
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

  /**
   * Get a cached LibSQLVectorStore for a knowledge base
   */
  private getStore(base: ResolvedKnowledgeBase): LibSQLVectorStore | undefined {
    return this.storeCache.get(base.id)
  }

  /**
   * Create and cache a LibSQLVectorStore for a knowledge base
   */
  private createStore(base: ResolvedKnowledgeBase): LibSQLVectorStore {
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
   * Ensure a LibSQLVectorStore exists for a knowledge base
   */
  private ensureStore(base: ResolvedKnowledgeBase): LibSQLVectorStore {
    return this.getStore(base) ?? this.createStore(base)
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
    this.ensureStore(resolvedBase)
  }

  /**
   * Reset a knowledge base (clear all data)
   */
  public reset = async (base: KnowledgeBase): Promise<void> => {
    logger.info(`[KnowledgeV2] Reset called for base ${base.id}`)
    const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
    const store = this.ensureStore(resolvedBase)
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

    // TODO: Deletion can still fail if libsql clients keep the DB open; add close+retry or persistent cleanup.
    const dbPath = this.getDbPath(id)
    if (fs.existsSync(dbPath)) {
      try {
        fs.rmSync(dbPath, { recursive: true })
        logger.debug(`Deleted knowledge base file with id: ${id}`)
      } catch (error) {
        logger.warn(`Failed to delete knowledge base ${id}: ${error}. Please delete it manually.`)
      }
    }
  }

  // ============================================================================
  // Content Management
  // ============================================================================

  /**
   * Add content to knowledge base
   * This is the main entry point for adding any type of content
   */
  public add = async (options: KnowledgeBaseAddItemOptions): Promise<void> => {
    const { base, item, userId = '', signal, onStageChange, onProgress, runStage } = options
    const itemType = item.type as KnowledgeItemType

    logger.info(`[KnowledgeV2] Add called: type=${itemType}, base=${base.id}, item=${item.id}`)

    // Check if reader exists for this type
    const reader = getReader(itemType)
    if (!reader) {
      logger.warn(`[KnowledgeV2] No reader for type: ${itemType}`)
      throw new Error(`Unsupported item type: ${itemType}`)
    }

    const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')

    // Create reader context
    const context: ReaderContext = {
      base: resolvedBase,
      item,
      itemId: item.id,
      userId
    }

    await this.processAddTask(context, { signal, onStageChange, onProgress, runStage })
  }

  /**
   * Process add task (called by queue)
   */
  private async processAddTask(
    context: ReaderContext,
    options: {
      signal?: AbortSignal
      onStageChange?: KnowledgeBaseAddItemOptions['onStageChange']
      onProgress?: KnowledgeBaseAddItemOptions['onProgress']
      runStage?: KnowledgeBaseAddItemOptions['runStage']
    }
  ): Promise<void> {
    const { base, item } = context
    const itemType = item.type as KnowledgeItemType
    const runStage = options.runStage ?? (async (_stage, task) => await task())

    const totalStartTime = Date.now()
    logger.info(`[KnowledgeV2] Processing started for item ${item.id}`)

    try {
      this.throwIfAborted(options.signal, item.id)
      options.onStageChange?.('preprocessing')

      // Step 1: Read content using appropriate reader
      const readStartTime = Date.now()
      logger.debug(`[KnowledgeV2] [READ] Starting for item ${item.id}`)
      const reader = getReader(itemType)!
      const readerResult = await runStage('read', async () => await reader.read(context))
      const readDuration = Date.now() - readStartTime
      logger.debug(`[KnowledgeV2] [READ] Completed in ${readDuration}ms, nodes: ${readerResult.nodes.length}`)

      if (readerResult.nodes.length === 0) {
        logger.warn(`[KnowledgeV2] No content read for item ${item.id}`)
        return
      }

      this.throwIfAborted(options.signal, item.id)
      options.onStageChange?.('embedding')

      // Step 2: Embed nodes with progress reporting
      const embedStartTime = Date.now()
      logger.debug(`[KnowledgeV2] [EMBED] Starting for item ${item.id}, nodes: ${readerResult.nodes.length}`)

      // Wrap progress callback to include stage
      const handleEmbedProgress = options.onProgress
        ? (progress: number) => options.onProgress!('embedding', progress)
        : undefined

      const embeddedNodes = await runStage(
        'embed',
        async () => await embedNodes(readerResult.nodes, base, handleEmbedProgress, options.signal)
      )
      const embedDuration = Date.now() - embedStartTime
      logger.debug(`[KnowledgeV2] [EMBED] Completed in ${embedDuration}ms`)

      const embeddedDimensions = embeddedNodes[0]?.getEmbedding()?.length ?? 0
      logger.debug('[KnowledgeV2] Embedding dimensions resolved', {
        baseId: base.id,
        baseDimensions: base.dimensions ?? 'auto',
        embeddedDimensions
      })

      this.throwIfAborted(options.signal, item.id)

      // Step 3: Store in vector database
      const writeStartTime = Date.now()
      logger.debug(`[KnowledgeV2] [WRITE] Starting for item ${item.id}`)
      const store = this.ensureStore(base)
      const insertedIds = await runStage('write', async () => await store.add(embeddedNodes))
      const writeDuration = Date.now() - writeStartTime
      logger.debug(`[KnowledgeV2] [WRITE] Completed in ${writeDuration}ms, inserted: ${insertedIds.length}`)

      const totalDuration = Date.now() - totalStartTime
      logger.info(
        `[KnowledgeV2] Processing completed for item ${item.id} in ${totalDuration}ms ` +
          `(read: ${readDuration}ms, embed: ${embedDuration}ms, write: ${writeDuration}ms)`
      )

      return
    } catch (error) {
      const totalDuration = Date.now() - totalStartTime
      logger.error(
        `[KnowledgeV2] Process add task failed for item ${item.id} after ${totalDuration}ms:`,
        error as Error
      )
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
      const store = this.ensureStore(resolvedBase)
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
      const store = this.ensureStore(resolvedBase)
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
      const store = this.ensureStore(resolvedBase)
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
