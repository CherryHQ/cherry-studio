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
import { type BaseNode, type Metadata, MetadataMode } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'

import Embeddings from './embeddings'
import { knowledgeProviderAdapter } from './KnowledgeProviderAdapter'
import Reranker from './reranker/Reranker'
import {
  DEFAULT_DOCUMENT_COUNT,
  type KnowledgeBaseRemoveOptions,
  type RerankOptions,
  type SearchOptions
} from './types'

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
  private ensureStore(base: KnowledgeBase): LibSQLVectorStore {
    const cached = this.storeCache.get(base.id)
    if (cached) {
      return cached
    }

    const dbPath = this.getDbPath(base.id)
    const store = new LibSQLVectorStore({
      clientConfig: { url: `file:${dbPath}` },
      dimensions: base.embeddingModelMeta?.dimensions,
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
    logger.info(`[KnowledgeV2] Create called for base ${base.id}`, {
      dimensions: base.embeddingModelMeta?.dimensions ?? 'auto',
      model: base.embeddingModelId
    })
    this.ensureStore(base)
  }

  /**
   * Reset a knowledge base (clear all data)
   */
  public reset = async (base: KnowledgeBase): Promise<void> => {
    logger.info(`[KnowledgeV2] Reset called for base ${base.id}`)
    const store = this.ensureStore(base)
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
   * Add embedded nodes to knowledge base
   *
   * This is a low-level method that stores already-embedded nodes.
   * For full processing (read -> embed -> store), use KnowledgeProcessor.
   *
   * @param options - Contains base config and nodes to store
   */
  public addNodes = async (options: { base: KnowledgeBase; nodes: BaseNode<Metadata>[] }): Promise<void> => {
    const { base, nodes } = options

    if (nodes.length === 0) {
      logger.warn(`[KnowledgeV2] addNodes called with empty nodes array for base ${base.id}`)
      return
    }

    logger.info(`[KnowledgeV2] addNodes: storing ${nodes.length} nodes to base ${base.id}`)

    const store = this.ensureStore(base)
    await store.add(nodes)

    logger.info(`[KnowledgeV2] addNodes completed for base ${base.id}`)
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
      const store = this.ensureStore(base)
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
      const store = this.ensureStore(base)
      const topK = DEFAULT_DOCUMENT_COUNT
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

      let results: KnowledgeSearchResult[] = nodes.map((node, index) => ({
        pageContent: node.getContent(MetadataMode.NONE),
        score: similarities[index] ?? 0,
        metadata: node.metadata ?? {}
      }))

      // Rerank if rerank model is configured
      if (base.rerankModelId && results.length > 0) {
        results = await this.rerank({ search, base, results })
        logger.info(`[KnowledgeV2] Reranked results: ${results.length}`)
      }

      return results
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
