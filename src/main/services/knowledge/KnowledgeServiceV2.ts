import * as fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { LoaderReturn } from '@shared/config/types'
import type { FileMetadata, KnowledgeBaseParams, KnowledgeSearchResult } from '@types'
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  MetadataMode,
  SentenceSplitter,
  type VectorStoreQueryResult
} from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'
import md5 from 'md5'

import Embeddings from './embedjs/embeddings/Embeddings'
import { DEFAULT_DOCUMENT_COUNT } from './utils/knowledge'
import { loadMarkdownDocuments } from './vectorstores/loader'

const logger = loggerService.withContext('KnowledgeServiceV2')

/**
 * KnowledgeServiceV2 负责知识库的向量搜索、嵌入和管理
 */
class KnowledgeServiceV2 {
  private storageDir = path.join(getDataPath(), 'KnowledgeBase')

  constructor() {
    this.initStorageDir()
  }

  private initStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  /**
   * 获取数据库文件路径
   */
  private getDbPath(id: string): string {
    return path.join(this.storageDir, sanitizeFilename(id, '_'))
  }

  public create = async (_: Electron.IpcMainInvokeEvent | undefined, base: KnowledgeBaseParams): Promise<void> => {
    logger.info(`[KnowledgeV2] Create called for base ${base.id}`)
  }

  public search = async (
    _: Electron.IpcMainInvokeEvent | undefined,
    { search, base }: { search: string; base: KnowledgeBaseParams }
  ): Promise<KnowledgeSearchResult[]> => {
    const dbPath = this.getDbPath(base.id)

    if (!fs.existsSync(dbPath)) {
      logger.warn(`[KnowledgeV2] Search skipped: db not found: ${dbPath}`)
      return []
    }

    try {
      logger.info(`[KnowledgeV2] Search starting for base ${base.id}`)

      // 1. Embed the query
      const embeddingsClient = new Embeddings({
        embedApiClient: base.embedApiClient,
        dimensions: base.dimensions
      })
      const queryEmbedding = await embeddingsClient.embedQuery(search)

      // 2. Perform vector search
      const dimensions = base.dimensions ?? queryEmbedding.length
      const store = new LibSQLVectorStore({
        clientConfig: { url: `file:${dbPath}` },
        dimensions,
        collection: ''
      })

      const topK = base.documentCount ?? DEFAULT_DOCUMENT_COUNT
      const queryResult = await store.query({
        queryEmbedding,
        similarityTopK: topK,
        mode: 'default'
      })

      logger.info(`[KnowledgeV2] Search completed: ${queryResult.nodes?.length ?? 0} results`)

      // 3. Map to KnowledgeSearchResult[]
      return this.mapQueryResultToSearchResults(queryResult)
    } catch (error) {
      logger.error(`[KnowledgeV2] Search failed for base ${base.id}:`, error as Error)
      throw error
    }
  }

  private mapQueryResultToSearchResults(queryResult: VectorStoreQueryResult): KnowledgeSearchResult[] {
    const nodes = queryResult.nodes ?? []
    const similarities = queryResult.similarities ?? []

    return nodes.map((node, index) => ({
      pageContent: node.getContent(MetadataMode.NONE),
      score: similarities[index] ?? 0,
      metadata: node.metadata ?? {}
    }))
  }

  public async removeByExternalId({
    base,
    externalId
  }: {
    base: KnowledgeBaseParams
    externalId: string
  }): Promise<number> {
    const dbPath = this.getDbPath(base.id)
    if (!fs.existsSync(dbPath)) {
      logger.warn(`[KnowledgeV2] Remove skipped: db not found: ${dbPath}`)
      return 0
    }

    try {
      const store = new LibSQLVectorStore({
        clientConfig: { url: `file:${dbPath}` },
        dimensions: base.dimensions,
        collection: ''
      })

      const deleted = await store.deleteByExternalId(externalId)
      logger.info(`[KnowledgeV2] Remove completed: external_id=${externalId}, rows=${deleted}`)
      return deleted
    } catch (error) {
      logger.error(`[KnowledgeV2] Remove failed for external_id ${externalId}:`, error as Error)
      return 0
    }
  }

  public async addMarkdownFile({
    base,
    file,
    itemId
  }: {
    base: KnowledgeBaseParams
    file: FileMetadata
    itemId: string
  }): Promise<LoaderReturn> {
    const uniqueId = `MarkdownLoader_${md5(file.path)}`
    const loaderType = 'MarkdownLoader'

    try {
      logger.info(`[KnowledgeV2] Markdown ingest start: ${file.path} (base: ${base.id}, item: ${itemId})`)
      if (!fs.existsSync(file.path)) {
        logger.warn(`[KnowledgeV2] Markdown ingest failed: file not found: ${file.path}`)
        throw new Error(`File not found: ${file.path}`)
      }

      const documents = await loadMarkdownDocuments(file)
      logger.info(`[KnowledgeV2] Markdown documents loaded: ${documents.length}`)
      if (documents.length === 0) {
        logger.warn(`[KnowledgeV2] Markdown ingest skipped: no content in ${file.path}`)
        return {
          entriesAdded: 0,
          uniqueId,
          uniqueIds: [uniqueId],
          loaderType
        }
      }

      const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
      const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP
      const splitter = new SentenceSplitter({ chunkSize, chunkOverlap })
      const nodes = splitter.getNodesFromDocuments(documents)
      logger.info(`[KnowledgeV2] Markdown chunks created: ${nodes.length}`)
      nodes.forEach((node) => {
        node.metadata = {
          ...node.metadata,
          external_id: itemId
        }
      })

      if (nodes.length === 0) {
        logger.warn(`[KnowledgeV2] Markdown ingest skipped: no chunks for ${file.path}`)
        return {
          entriesAdded: 0,
          uniqueId,
          uniqueIds: [uniqueId],
          loaderType
        }
      }

      const embeddingsClient = new Embeddings({
        embedApiClient: base.embedApiClient,
        dimensions: base.dimensions
      })
      const nodeTexts = nodes.map((node) => node.getContent(MetadataMode.NONE))
      logger.info(`[KnowledgeV2] Markdown embedding started: ${nodeTexts.length} chunks`)
      const vectors = await embeddingsClient.embedDocuments(nodeTexts)

      const dimensions = base.dimensions ?? vectors[0]?.length
      if (!dimensions) {
        throw new Error('Failed to resolve embedding dimensions')
      }
      logger.info(`[KnowledgeV2] Markdown embedding completed: ${vectors.length} vectors (dim: ${dimensions})`)

      vectors.forEach((vector, index) => {
        const node = nodes[index]
        if (node) {
          node.embedding = vector
        }
      })

      const dbPath = this.getDbPath(base.id)
      const store = new LibSQLVectorStore({
        clientConfig: { url: `file:${dbPath}` },
        dimensions,
        collection: ''
      })

      const insertedIds = await store.add(nodes)
      logger.info(`[KnowledgeV2] Markdown ingest completed: ${file.path}, nodes: ${insertedIds.length}`)

      return {
        entriesAdded: insertedIds.length,
        uniqueId,
        uniqueIds: [uniqueId],
        loaderType
      }
    } catch (error) {
      logger.error(`Markdown ingestion failed for ${file.path}:`, error as Error)
      return {
        entriesAdded: 0,
        uniqueId,
        uniqueIds: [uniqueId],
        loaderType,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        messageSource: 'embedding'
      }
    }
  }
}

export const knowledgeServiceV2 = new KnowledgeServiceV2()
