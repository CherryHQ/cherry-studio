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
import type { KnowledgeBase, KnowledgeItemType, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { MetadataMode } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import Embeddings from './embeddings'
import { embedNodes } from './embeddings/EmbeddingPipeline'
import type { ResolvedKnowledgeBase } from './KnowledgeProviderAdapter'
import { knowledgeProviderAdapter } from './KnowledgeProviderAdapter'
import { getReader } from './readers'
import Reranker from './reranker/Reranker'
import {
  type KnowledgeBaseAddItemOptions,
  type KnowledgeBaseRemoveOptions,
  type ReaderContext,
  type RerankOptions,
  type SearchOptions
} from './types'
import { DEFAULT_DOCUMENT_COUNT } from './utils/knowledge'

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
   * Ensure a LibSQLVectorStore exists for a knowledge base
   */
  private ensureStore(base: ResolvedKnowledgeBase): LibSQLVectorStore {
    const cached = this.storeCache.get(base.id)
    if (cached) {
      return cached
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
    this.cleanupStoreCache(id)
    const dbPath = this.getDbPath(id)

    if (!fs.existsSync(dbPath)) {
      logger.warn(`Knowledge base file not found for id: ${id}, skipping deletion.`)
      throw new Error(`Knowledge base file not found for id: ${id}`)
    }

    try {
      fs.rmSync(dbPath, { recursive: true })
      logger.debug(`Deleted knowledge base file with id: ${id}`)
    } catch (error) {
      logger.warn(`Failed to delete knowledge base ${id}: ${error}. Please delete it manually.`)
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
      userId
    }

    onStageChange('ocr')

    // Step 1: OCR preprocessing (placeholder for future OCR implementation)
    // TODO: Add actual OCR processing here when needed

    onStageChange('read')

    // Step 2: Read content using appropriate reader
    const readerResult = await runStage('read', async () => await reader.read(context))

    if (readerResult.nodes.length === 0) {
      logger.warn(`[KnowledgeV2] No content read for item ${item.id}`)
      return
    }

    onStageChange('embed')

    // Step 3: Embed nodes and store in vector database
    const store = this.ensureStore(resolvedBase)
    await runStage('embed', async () => {
      const embeddedNodes = await embedNodes(
        readerResult.nodes,
        resolvedBase,
        (progress) => onProgress('embed', progress),
        signal
      )
      await store.add(embeddedNodes)
    })

    logger.info(`[KnowledgeV2] Add completed for item ${item.id}`)
  }

  /**
   * Remove content from knowledge base
   */
  public remove = async (options: KnowledgeBaseRemoveOptions): Promise<void> => {
    const { base, item } = options
    const externalId = item.id

    const dbPath = this.getDbPath(base.id)

    if (!fs.existsSync(dbPath)) {
      logger.warn(`[KnowledgeV2] Remove skipped: db not found: ${dbPath}`)
      throw new Error(`Knowledge base database not found for id: ${base.id}`)
    }

    try {
      const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
      const store = this.ensureStore(resolvedBase)
      await store.deleteByExternalId(externalId)
      logger.info(`[KnowledgeV2] Remove completed: external_id=${externalId}`)
    } catch (error) {
      logger.error(`[KnowledgeV2] Remove failed for external_id ${externalId}:`, error as Error)
    }
  }

  // ============================================================================
  // Search & Retrieval
  // ============================================================================

  /**
   * Search the knowledge base
   */
  public search = async (options: SearchOptions): Promise<KnowledgeSearchResult[]> => {
    const { search, base } = options

    const dbPath = this.getDbPath(base.id)

    if (!fs.existsSync(dbPath)) {
      logger.warn(`[KnowledgeV2] Search skipped: db not found: ${dbPath}`)
      return []
    }

    try {
      const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')
      logger.info(`[KnowledgeV2] Search called for base ${base.id}: "${search}"`)

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
        mode: 'default'
      })

      logger.info(`[KnowledgeV2] Search completed: ${queryResult.nodes?.length ?? 0} results`)

      // Map results to KnowledgeSearchResult format
      const nodes = queryResult.nodes ?? []
      const similarities = queryResult.similarities ?? []

      return nodes.map((node, index) => ({
        pageContent: node.getContent(MetadataMode.NONE),
        score: similarities[index] ?? 0,
        metadata: node.metadata ?? {}
      }))
    } catch (error) {
      logger.error(`[KnowledgeV2] Search failed for base ${base.id}:`, error as Error)
      throw error
    }
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
}

export const knowledgeServiceV2 = new KnowledgeServiceV2()
