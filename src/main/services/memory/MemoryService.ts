import { memoryHistoryTable, memoryTable } from '@data/db/schemas/memory'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import Embeddings from '@main/knowledge/embedjs/embeddings/Embeddings'
import type {
  AddMemoryOptions,
  AssistantMessage,
  MemoryConfig,
  MemoryHistoryItem,
  MemoryItem,
  MemoryListOptions,
  MemorySearchOptions
} from '@types'
import crypto from 'crypto'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'

const logger = loggerService.withContext('MemoryService')

export interface EmbeddingOptions {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
  dimensions?: number
  batchSize?: number
}

export interface VectorSearchOptions {
  limit?: number
  threshold?: number
  userId?: string
  agentId?: string
  filters?: Record<string, any>
}

export interface SearchResult {
  memories: MemoryItem[]
  count: number
  error?: string
}

type MemoryDbRow = typeof memoryTable.$inferSelect
type MemoryHistoryDbRow = typeof memoryHistoryTable.$inferSelect

export class MemoryService {
  private static instance: MemoryService | null = null
  private embeddings: Embeddings | null = null
  private config: MemoryConfig | null = null
  private static readonly UNIFIED_DIMENSION = 1536
  private static readonly SIMILARITY_THRESHOLD = 0.85

  private constructor() {}

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
    }
    return MemoryService.instance
  }

  public static reload(): MemoryService {
    MemoryService.instance = new MemoryService()
    return MemoryService.instance
  }


  /**
   * Legacy noop kept for renderer compatibility.
   * Memory data migration is now handled by v2 migration engine (MemoryMigrator).
   */
  public migrateMemoryDb(): void {
    logger.info('migrateMemoryDb is now handled by v2 migration engine, skipping legacy file move')
  }

  public async add(messages: string | AssistantMessage[], options: AddMemoryOptions): Promise<SearchResult> {
    const db = this.getDb()
    const { userId, agentId, runId, metadata } = options
    logger.info('Memory add started', {
      messageType: Array.isArray(messages) ? 'array' : 'string',
      messageCount: Array.isArray(messages) ? messages.length : 1,
      userId: userId ?? '',
      agentId: agentId ?? '',
      hasEmbeddingModel: !!this.config?.embeddingModel,
      hasEmbeddingApiClient: !!this.config?.embeddingApiClient,
      embeddingModelId: this.config?.embeddingModel?.id ?? '',
      embeddingModelProvider: this.config?.embeddingModel?.provider ?? ''
    })

    try {
      const memoryStrings = Array.isArray(messages)
        ? messages.map((m) => (typeof m === 'string' ? m : m.content))
        : [messages]
      const addedMemories: MemoryItem[] = []

      for (const memory of memoryStrings) {
        const trimmedMemory = memory.trim()
        if (!trimmedMemory) continue

        const hash = this.buildMemoryHash(trimmedMemory, userId)
        const existing = await db.select().from(memoryTable).where(eq(memoryTable.hash, hash)).get()

        if (existing) {
          if (!existing.deletedAt) {
            logger.debug(`Memory already exists with hash: ${hash}`)
            continue
          }

          let embedding: string | null = existing.embedding ?? null
          if (this.config?.embeddingModel) {
            try {
              const embeddingArray = await this.generateEmbedding(trimmedMemory)
              embedding = this.embeddingToVector(embeddingArray)
              logger.debug('Generated embedding for restored memory', {
                memoryId: existing.id,
                embeddingDim: embeddingArray.length,
                willPersistEmbedding: !!embedding
              })
            } catch (error) {
              logger.warn('Failed to generate embedding for restored memory', error as Error)
            }
          }

          const now = new Date().toISOString()
          await this.updateMemoryCore(existing.id, {
            memory: trimmedMemory,
            metadata: metadata ?? null,
            updatedAt: now,
            deletedAt: null,
            embedding
          })

          await this.addHistory(existing.id, null, trimmedMemory, 'ADD')
          addedMemories.push({
            id: existing.id,
            memory: trimmedMemory,
            hash,
            createdAt: existing.createdAt,
            updatedAt: now,
            metadata: metadata ?? undefined
          })
          continue
        }

        let embedding: string | null = null
        if (this.config?.embeddingModel) {
          try {
            const embeddingArray = await this.generateEmbedding(trimmedMemory)
            embedding = this.embeddingToVector(embeddingArray)
            logger.info('Generated embedding for new memory', {
              memoryHash: hash,
              embeddingDim: embeddingArray.length,
              willPersistEmbedding: !!embedding
            })

            const similarMemories = await this.hybridSearch(trimmedMemory, embeddingArray, {
              limit: 5,
              threshold: 0.1,
              userId,
              agentId
            })

            if (similarMemories.memories.length > 0) {
              const highestSimilarity = Math.max(...similarMemories.memories.map((m) => m.score || 0))
              if (highestSimilarity >= MemoryService.SIMILARITY_THRESHOLD) {
                logger.debug(
                  `Skipping memory addition due to high similarity: ${highestSimilarity.toFixed(3)} >= ${MemoryService.SIMILARITY_THRESHOLD}`
                )
                continue
              }
            }
          } catch (error) {
            logger.warn('Embedding generation failed during add; continue with text-only behavior', error as Error)
          }
        } else {
          logger.warn('Embedding skipped during add because embeddingModel is not configured', {
            userId: userId ?? '',
            memoryHash: hash
          })
        }

        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        await this.insertMemoryCore({
          id,
          memory: trimmedMemory,
          hash,
          embedding,
          metadata: metadata ?? null,
          userId: userId || null,
          agentId: agentId || null,
          runId: runId || null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        })
        await this.addHistory(id, null, trimmedMemory, 'ADD')

        addedMemories.push({
          id,
          memory: trimmedMemory,
          hash,
          createdAt: now,
          updatedAt: now,
          metadata: metadata ?? undefined
        })
      }

      return { memories: addedMemories, count: addedMemories.length }
    } catch (error) {
      logger.error('Failed to add memories', error as Error)
      return {
        memories: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  public async search(query: string, options: MemorySearchOptions = {}): Promise<SearchResult> {
    const { limit = 10, userId, agentId, filters = {} } = options

    try {
      if (this.config?.embeddingModel) {
        try {
          const queryEmbedding = await this.generateEmbedding(query)
          const vectorResult = await this.hybridSearch(query, queryEmbedding, { limit, userId, agentId, filters })
          if (vectorResult.memories.length > 0) {
            return vectorResult
          }
          logger.info('Vector search returned no results, fallback to text search')
        } catch (error) {
          logger.warn('Vector search failed, fallback to text search', error as Error)
        }
      }

      const whereClauses = [isNull(memoryTable.deletedAt)]
      if (userId) whereClauses.push(eq(memoryTable.userId, userId))
      if (agentId) whereClauses.push(or(eq(memoryTable.agentId, agentId), isNull(memoryTable.agentId))!)

      const rows = await this.getDb()
        .select()
        .from(memoryTable)
        .where(and(...whereClauses))
        .orderBy(desc(memoryTable.createdAt))
        .all()

      const lower = query.toLowerCase()
      const filtered = rows
        .filter((row) => row.memory.toLowerCase().includes(lower))
        .filter((row) => this.matchMetadataFilters(row.metadata, filters))
        .slice(0, limit)

      return {
        memories: filtered.map((row) => this.mapMemoryRow(row)),
        count: filtered.length
      }
    } catch (error) {
      logger.error('Search failed', error as Error)
      return {
        memories: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  public async list(options: MemoryListOptions = {}): Promise<SearchResult> {
    const { userId, agentId, limit = 100, offset = 0 } = options

    try {
      const whereClauses = [isNull(memoryTable.deletedAt)]
      if (userId) whereClauses.push(eq(memoryTable.userId, userId))
      if (agentId) whereClauses.push(or(eq(memoryTable.agentId, agentId), isNull(memoryTable.agentId))!)

      const db = this.getDb()
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(memoryTable)
        .where(and(...whereClauses))

      const rows = await db
        .select()
        .from(memoryTable)
        .where(and(...whereClauses))
        .orderBy(desc(memoryTable.createdAt))
        .limit(limit)
        .offset(offset)
        .all()

      return {
        memories: rows.map((row) => this.mapMemoryRow(row)),
        count: Number(total ?? 0)
      }
    } catch (error) {
      logger.error('List failed', error as Error)
      return {
        memories: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  public async delete(id: string): Promise<void> {
    const db = this.getDb()
    const current = await db
      .select()
      .from(memoryTable)
      .where(and(eq(memoryTable.id, id), isNull(memoryTable.deletedAt)))
      .get()

    if (!current) {
      throw new Error('Memory not found')
    }

    const now = new Date().toISOString()
    await db.update(memoryTable).set({ deletedAt: now, updatedAt: now }).where(eq(memoryTable.id, id))
    await this.addHistory(id, current.memory, null, 'DELETE')
  }

  public async update(id: string, memory: string, metadata?: Record<string, any>): Promise<void> {
    const db = this.getDb()
    const current = await db
      .select()
      .from(memoryTable)
      .where(and(eq(memoryTable.id, id), isNull(memoryTable.deletedAt)))
      .get()

    if (!current) {
      throw new Error('Memory not found')
    }

    const trimmedMemory = memory.trim()
    const hash = this.buildMemoryHash(trimmedMemory, current.userId ?? null)
    let embedding: string | null = current.embedding ?? null

    if (this.config?.embeddingModel) {
      try {
        const embeddingArray = await this.generateEmbedding(trimmedMemory)
        embedding = this.embeddingToVector(embeddingArray)
        logger.info('Generated embedding for memory update', {
          memoryId: id,
          embeddingDim: embeddingArray.length,
          willPersistEmbedding: !!embedding
        })
      } catch (error) {
        logger.warn('Failed to generate embedding for update', error as Error)
      }
    } else {
      logger.warn('Embedding skipped during update because embeddingModel is not configured', {
        memoryId: id
      })
    }

    const mergedMetadata = { ...current.metadata, ...metadata }
    const now = new Date().toISOString()

    await this.updateMemoryCore(id, {
      memory: trimmedMemory,
      hash,
      embedding,
      metadata: mergedMetadata,
      updatedAt: now
    })

    await this.addHistory(id, current.memory, trimmedMemory, 'UPDATE')
  }

  public async get(memoryId: string): Promise<MemoryHistoryItem[]> {
    const rows = await this.getDb()
      .select()
      .from(memoryHistoryTable)
      .where(and(eq(memoryHistoryTable.memoryId, memoryId), isNull(memoryHistoryTable.deletedAt)))
      .orderBy(desc(memoryHistoryTable.createdAt))
      .all()

    return rows.map((row) => this.mapHistoryRow(row))
  }

  public async deleteAllMemoriesForUser(userId: string): Promise<void> {
    if (!userId) throw new Error('User ID is required')
    const db = this.getDb()

    await db.transaction(async (tx) => {
      const memoryIds = await tx
        .select({ id: memoryTable.id })
        .from(memoryTable)
        .where(eq(memoryTable.userId, userId))
        .all()

      for (const item of memoryIds) {
        await tx.delete(memoryHistoryTable).where(eq(memoryHistoryTable.memoryId, item.id))
      }
      await tx.delete(memoryTable).where(eq(memoryTable.userId, userId))
    })
  }

  public async deleteUser(userId: string): Promise<void> {
    if (!userId) throw new Error('User ID is required')
    if (userId === 'default-user') throw new Error('Cannot delete the default user')
    await this.deleteAllMemoriesForUser(userId)
  }

  public async getUsersList(): Promise<{ userId: string; memoryCount: number; lastMemoryDate: string }[]> {
    const rows = await this.getDb()
      .select({
        userId: memoryTable.userId,
        memoryCount: sql<number>`count(*)`,
        lastMemoryDate: sql<string>`max(${memoryTable.createdAt})`
      })
      .from(memoryTable)
      .where(and(isNull(memoryTable.deletedAt), sql`${memoryTable.userId} IS NOT NULL`))
      .groupBy(memoryTable.userId)
      .orderBy(sql`max(${memoryTable.createdAt}) DESC`)
      .all()

    return rows
      .filter((row) => !!row.userId)
      .map((row) => ({
        userId: row.userId as string,
        memoryCount: Number(row.memoryCount ?? 0),
        lastMemoryDate: row.lastMemoryDate || ''
      }))
  }

  public setConfig(config: MemoryConfig): void {
    this.config = config
    this.embeddings = null
    logger.info('Memory config updated', {
      hasEmbeddingModel: !!config.embeddingModel,
      hasEmbeddingApiClient: !!config.embeddingApiClient,
      embeddingModelId: config.embeddingModel?.id ?? '',
      embeddingModelProvider: config.embeddingModel?.provider ?? '',
      embeddingDimensions: config.embeddingDimensions ?? null
    })
  }

  public async close(): Promise<void> {
    this.embeddings = null
  }

  private normalizeEmbedding(embedding: number[]): number[] {
    if (embedding.length === MemoryService.UNIFIED_DIMENSION) {
      return embedding
    }
    if (embedding.length < MemoryService.UNIFIED_DIMENSION) {
      return [...embedding, ...new Array(MemoryService.UNIFIED_DIMENSION - embedding.length).fill(0)]
    }
    return embedding.slice(0, MemoryService.UNIFIED_DIMENSION)
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.config?.embeddingModel) {
      logger.warn('generateEmbedding aborted: embedding model not configured', {
        inputLength: text.length
      })
      throw new Error('Embedder model not configured')
    }

    if (!this.embeddings) {
      if (!this.config.embeddingApiClient) {
        logger.warn('generateEmbedding aborted: embedding provider not configured', {
          inputLength: text.length
        })
        throw new Error('Embedder provider not configured')
      }
      logger.info('Initializing embedding client', {
        hasEmbeddingModel: !!this.config.embeddingModel,
        hasEmbeddingApiClient: !!this.config.embeddingApiClient,
        configuredDimensions: this.config.embeddingDimensions ?? null,
        embeddingModelId: this.config.embeddingModel?.id ?? '',
        embeddingModelProvider: this.config.embeddingModel?.provider ?? ''
      })
      this.embeddings = new Embeddings({
        embedApiClient: this.config.embeddingApiClient,
        dimensions: this.config.embeddingDimensions
      })
      await this.embeddings.init()
    }

    const embedding = await this.embeddings.embedQuery(text)
    logger.info('Embedding generated from provider', {
      inputLength: text.length,
      rawDim: embedding.length
    })
    const normalized = this.normalizeEmbedding(embedding)
    logger.info('Embedding normalized', {
      inputLength: text.length,
      normalizedDim: normalized.length
    })
    return normalized
  }

  private embeddingToVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`
  }

  private buildMemoryHash(memory: string, userId: string | null | undefined): string {
    const scopedUser = userId ?? ''
    return crypto.createHash('sha256').update(`${scopedUser}:${memory}`).digest('hex')
  }

  private async hybridSearch(
    _: string,
    queryEmbedding: number[],
    options: VectorSearchOptions = {}
  ): Promise<SearchResult> {
    const { limit = 10, threshold = 0.5, userId, agentId, filters = {} } = options
    const queryVector = this.embeddingToVector(queryEmbedding)

    const whereClauses = [isNull(memoryTable.deletedAt), sql`${memoryTable.embedding} IS NOT NULL`]
    if (userId) whereClauses.push(eq(memoryTable.userId, userId))
    if (agentId) whereClauses.push(or(eq(memoryTable.agentId, agentId), isNull(memoryTable.agentId))!)

    try {
      const similarityExpr = sql<number>`(1 - vector_distance_cos(${memoryTable.embedding}, vector32(${queryVector})))`
      const rows = await this.getDb()
        .select({
          id: memoryTable.id,
          memory: memoryTable.memory,
          hash: memoryTable.hash,
          metadata: memoryTable.metadata,
          createdAt: memoryTable.createdAt,
          updatedAt: memoryTable.updatedAt,
          score: similarityExpr
        })
        .from(memoryTable)
        .where(and(...whereClauses, sql`${similarityExpr} >= ${threshold}`))
        .orderBy(sql`${similarityExpr} DESC`)
        .limit(limit)
        .all()

      const filteredRows = rows.filter((row) => this.matchMetadataFilters(row.metadata, filters))
      return {
        memories: filteredRows.map((row) => ({
          id: row.id,
          memory: row.memory,
          hash: row.hash || undefined,
          metadata: row.metadata || undefined,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          score: Number(row.score ?? 0)
        })),
        count: filteredRows.length
      }
    } catch (error) {
      logger.warn('Hybrid search unavailable, fallback to text search path', error as Error)
      return { memories: [], count: 0 }
    }
  }

  private async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: 'ADD' | 'UPDATE' | 'DELETE'
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.getDb().insert(memoryHistoryTable).values({
      memoryId,
      previousValue,
      newValue,
      action,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    })
  }

  private mapMemoryRow(row: MemoryDbRow): MemoryItem {
    return {
      id: row.id,
      memory: row.memory,
      hash: row.hash || undefined,
      metadata: row.metadata || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }

  private mapHistoryRow(row: MemoryHistoryDbRow): MemoryHistoryItem {
    return {
      id: Number(row.id),
      memoryId: row.memoryId,
      previousValue: row.previousValue || undefined,
      newValue: row.newValue || '',
      action: row.action as 'ADD' | 'UPDATE' | 'DELETE',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isDeleted: !!row.deletedAt
    }
  }

  private matchMetadataFilters(metadata: Record<string, any> | null, filters: Record<string, any>): boolean {
    if (!filters || Object.keys(filters).length === 0) return true
    if (!metadata) return false

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue
      if (metadata[key] !== value) return false
    }
    return true
  }

  private getDb(): DbType {
    return application.get('DbService').getDb()
  }

  private async insertMemoryCore(payload: {
    id: string
    memory: string
    hash: string
    embedding: string | null
    metadata: Record<string, any> | null
    userId: string | null
    agentId: string | null
    runId: string | null
    createdAt: string
    updatedAt: string
    deletedAt: string | null
  }): Promise<void> {
    const embeddingValue = payload.embedding ? sql`vector32(${payload.embedding})` : null
    logger.info('Persisting memory row', {
      memoryId: payload.id,
      userId: payload.userId ?? '',
      hasEmbeddingPayload: payload.embedding !== null,
      embeddingPayloadLength: payload.embedding?.length ?? 0
    })
    await this.getDb()
      .insert(memoryTable)
      .values({
        id: payload.id,
        memory: payload.memory,
        hash: payload.hash,
        embedding: embeddingValue as any,
        metadata: payload.metadata as any,
        userId: payload.userId,
        agentId: payload.agentId,
        runId: payload.runId,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt: payload.deletedAt
      })
    const persisted = await this.getDb()
      .select({
        hasEmbedding: sql<number>`CASE WHEN ${memoryTable.embedding} IS NULL THEN 0 ELSE 1 END`
      })
      .from(memoryTable)
      .where(eq(memoryTable.id, payload.id))
      .get()
    logger.info('Memory row persisted', {
      memoryId: payload.id,
      dbHasEmbedding: (persisted?.hasEmbedding ?? 0) === 1
    })
  }

  private async updateMemoryCore(
    id: string,
    payload: {
      memory: string
      metadata: Record<string, any> | null
      updatedAt: string
      deletedAt?: string | null
      hash?: string
      embedding?: string | null
    }
  ): Promise<void> {
    const setData: Record<string, any> = {
      memory: payload.memory,
      metadata: payload.metadata as any,
      updatedAt: payload.updatedAt
    }

    if (payload.hash !== undefined) {
      setData.hash = payload.hash
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'deletedAt')) {
      setData.deletedAt = payload.deletedAt ?? null
    }

    if (payload.embedding !== undefined) {
      setData.embedding = payload.embedding === null ? null : (sql`vector32(${payload.embedding})` as any)
    }

    logger.info('Updating memory row', {
      memoryId: id,
      hasEmbeddingInUpdate: payload.embedding !== undefined,
      embeddingIsNullInUpdate: payload.embedding === null,
      embeddingPayloadLength: payload.embedding?.length ?? 0
    })
    await this.getDb().update(memoryTable).set(setData).where(eq(memoryTable.id, id))
    const persisted = await this.getDb()
      .select({
        hasEmbedding: sql<number>`CASE WHEN ${memoryTable.embedding} IS NULL THEN 0 ELSE 1 END`
      })
      .from(memoryTable)
      .where(eq(memoryTable.id, id))
      .get()
    logger.info('Memory row updated', {
      memoryId: id,
      dbHasEmbedding: (persisted?.hasEmbedding ?? 0) === 1
    })
  }
}

export const memoryService = new MemoryService()
