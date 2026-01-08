import * as fs from 'node:fs'
import path from 'node:path'

import { type Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { LoaderReturn } from '@shared/config/types'
import type { FileMetadata, KnowledgeBase, KnowledgeBaseParams, KnowledgeItem } from '@types'
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE, MetadataMode, SentenceSplitter, TextNode } from '@vectorstores/core'
import { LibSQLVectorStore } from '@vectorstores/libsql'
import md5 from 'md5'

import Embeddings from './embedjs/embeddings/Embeddings'
import { loadMarkdownDocuments } from './vectorstores/loader'

const logger = loggerService.withContext('KnowledgeServiceV2')

/**
 * embedjs vectors 表的行结构
 */
interface EmbedjsVectorRow {
  id: string
  pageContent: string
  uniqueLoaderId: string
  source: string
  vector: ArrayBuffer | Float32Array
  metadata: string | null
}

/**
 * 迁移结果
 */
export interface MigrationResult {
  success: boolean
  migratedCount: number
  error?: string
}

/**
 * KnowledgeServiceV2 负责将知识库从 embedjs libsql 迁移到 vectorstores libsql
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

  /**
   * 构建 uniqueLoaderId -> item.id 的映射
   */
  private buildLoaderIdToItemIdMap(items: KnowledgeItem[]): Map<string, string> {
    const map = new Map<string, string>()

    for (const item of items) {
      // 单个 uniqueId
      if (item.uniqueId) {
        map.set(item.uniqueId, item.id)
      }
      // 多个 uniqueIds (目录等场景)
      if (item.uniqueIds && item.uniqueIds.length > 0) {
        for (const uid of item.uniqueIds) {
          map.set(uid, item.id)
        }
      }
    }

    return map
  }

  /**
   * 从向量数据推断维度
   */
  private inferDimensions(vector: ArrayBuffer | Float32Array): number {
    if (vector instanceof Float32Array) {
      return vector.length
    }
    // ArrayBuffer 转换为 Float32Array
    return new Float32Array(vector).length
  }

  /**
   * 将 embedjs 向量转换为数字数组
   */
  private vectorToArray(vector: ArrayBuffer | Float32Array): number[] {
    if (vector instanceof Float32Array) {
      return Array.from(vector)
    }
    return Array.from(new Float32Array(vector))
  }

  /**
   * 读取 embedjs 数据库中的所有向量
   */
  private async readEmbedjsVectors(client: Client): Promise<EmbedjsVectorRow[]> {
    try {
      const result = await client.execute({
        sql: 'SELECT id, pageContent, uniqueLoaderId, source, vector, metadata FROM vectors',
        args: []
      })

      return result.rows.map((row) => ({
        id: String(row.id),
        pageContent: String(row.pageContent || ''),
        uniqueLoaderId: String(row.uniqueLoaderId || ''),
        source: String(row.source || ''),
        vector: row.vector as ArrayBuffer | Float32Array,
        metadata: row.metadata ? String(row.metadata) : null
      }))
    } catch (error) {
      logger.error('Failed to read embedjs vectors:', error as Error)
      throw error
    }
  }

  /**
   * 检查是否为 embedjs 格式的数据库
   */
  private async isEmbedjsDatabase(client: Client): Promise<boolean> {
    try {
      const result = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'",
        args: []
      })
      return result.rows.length > 0
    } catch {
      return false
    }
  }

  /**
   * 备份原数据库
   */
  private backupDatabase(dbPath: string): void {
    const backupPath = `${dbPath}.bak`

    // 如果备份已存在，先删除
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true })
    }

    // 重命名原数据库为备份
    fs.renameSync(dbPath, backupPath)
    logger.info(`Database backed up to: ${backupPath}`)
  }

  /**
   * 迁移单个知识库
   */
  public async migrate(base: KnowledgeBase): Promise<MigrationResult> {
    logger.info(`Starting migration for knowledge base: ${base.id} (${base.name})`)

    const dbPath = this.getDbPath(base.id)

    // 检查数据库是否存在
    if (!fs.existsSync(dbPath)) {
      logger.warn(`Database not found: ${dbPath}`)
      return {
        success: false,
        migratedCount: 0,
        error: 'Database not found'
      }
    }

    let sourceClient: Client | null = null

    try {
      // 1. 连接源数据库 (embedjs)
      const client = createClient({ url: `file:${dbPath}` })
      sourceClient = client

      // 2. 检查是否为 embedjs 格式
      const isEmbedjs = await this.isEmbedjsDatabase(client)
      if (!isEmbedjs) {
        logger.warn('Database is not in embedjs format, skipping migration')
        return {
          success: false,
          migratedCount: 0,
          error: 'Database is not in embedjs format'
        }
      }

      // 3. 读取所有向量数据
      const vectors = await this.readEmbedjsVectors(client)

      if (vectors.length === 0) {
        logger.info('No vectors to migrate')
        return {
          success: true,
          migratedCount: 0
        }
      }

      // 4. 构建 uniqueLoaderId -> item.id 映射
      const loaderIdToItemId = this.buildLoaderIdToItemIdMap(base.items)

      // 5. 推断维度 (从第一条向量)
      const dimensions = base.dimensions || this.inferDimensions(vectors[0].vector)
      logger.info(`Inferred dimensions: ${dimensions}`)

      // 6. 关闭源数据库连接
      client.close()
      sourceClient = null

      // 7. 备份原数据库
      this.backupDatabase(dbPath)

      // 8. 创建新的 vectorstores 数据库
      const store = new LibSQLVectorStore({
        clientConfig: { url: `file:${dbPath}` },
        dimensions,
        collection: '' // 使用空字符串作为 collection
      })

      // 9. 转换并批量插入数据
      const BATCH_SIZE = 100
      let migratedCount = 0

      for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
        const batch = vectors.slice(i, i + BATCH_SIZE)

        const nodes = batch.map((row) => {
          // 查找对应的 item.id 作为 external_id
          const externalId = loaderIdToItemId.get(row.uniqueLoaderId) || ''

          // 合并 source 和原有 metadata
          let metadata: Record<string, unknown> = {}
          if (row.metadata) {
            try {
              metadata = JSON.parse(row.metadata)
            } catch {
              // 忽略解析错误
            }
          }
          metadata.source = row.source
          metadata.external_id = externalId
          metadata.uniqueLoaderId = row.uniqueLoaderId // 保留原始 ID 以便调试

          return new TextNode({
            id_: row.id,
            text: row.pageContent,
            embedding: this.vectorToArray(row.vector),
            metadata
          })
        })

        await store.add(nodes)
        migratedCount += nodes.length

        logger.debug(`Migrated ${migratedCount}/${vectors.length} vectors`)
      }

      logger.info(`Migration completed: ${migratedCount} vectors migrated`)

      return {
        success: true,
        migratedCount
      }
    } catch (error) {
      logger.error('Migration failed:', error as Error)

      // 如果迁移失败且已备份，尝试恢复
      const backupPath = `${dbPath}.bak`
      if (fs.existsSync(backupPath) && !fs.existsSync(dbPath)) {
        try {
          fs.renameSync(backupPath, dbPath)
          logger.info('Restored database from backup')
        } catch (restoreError) {
          logger.error('Failed to restore database:', restoreError as Error)
        }
      }

      return {
        success: false,
        migratedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (sourceClient) {
        sourceClient.close()
      }
    }
  }
}

export const knowledgeServiceV2 = new KnowledgeServiceV2()
