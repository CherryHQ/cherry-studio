import { Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
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
import { app } from 'electron'
import path from 'path'

import { MemoryQueries } from './queries'

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

export class MemoryService {
  private static instance: MemoryService | null = null
  private db: Client | null = null
  private isInitialized = false
  private embeddings: Embeddings | null = null
  private config: MemoryConfig | null = null
  private static readonly UNIFIED_DIMENSION = 1536
  private static readonly SIMILARITY_THRESHOLD = 0.85

  private constructor() {
    // Private constructor to enforce singleton pattern
  }

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService()
    }
    return MemoryService.instance
  }

  public static reload(): MemoryService {
    if (MemoryService.instance) {
      MemoryService.instance.close()
    }
    MemoryService.instance = new MemoryService()
    return MemoryService.instance
  }

  /**
   * Initialize the database connection and create tables
   */
  private async init(): Promise<void> {
    if (this.isInitialized && this.db) {
      return
    }

    try {
      const userDataPath = app.getPath('userData')
      const dbPath = path.join(userDataPath, 'memories.db')

      this.db = createClient({
        url: `file:${dbPath}`,
        intMode: 'number'
      })

      // Create tables
      await this.createTables()
      this.isInitialized = true
      logger.debug('Memory database initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize memory database:', error as Error)
      throw new Error(
        `Memory database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Create memories table with native vector support
    await this.db.execute(MemoryQueries.createTables.memories)

    // Create memory history table
    await this.db.execute(MemoryQueries.createTables.memoryHistory)

    // Create indexes
    await this.db.execute(MemoryQueries.createIndexes.userId)
    await this.db.execute(MemoryQueries.createIndexes.agentId)
    await this.db.execute(MemoryQueries.createIndexes.createdAt)
    await this.db.execute(MemoryQueries.createIndexes.hash)
    await this.db.execute(MemoryQueries.createIndexes.memoryHistory)

    // Create vector index for similarity search
    try {
      await this.db.execute(MemoryQueries.createIndexes.vector)
    } catch (error) {
      // Vector index might not be supported in all versions
      logger.warn('Failed to create vector index, falling back to non-indexed search:', error as Error)
    }
  }

  /**
   * Add new memories from messages
   */
  public async add(messages: string | AssistantMessage[], options: AddMemoryOptions): Promise<SearchResult> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    const { userId, agentId, runId, metadata } = options

    try {
      // Convert messages to memory strings
      const memoryStrings = Array.isArray(messages)
        ? messages.map((m) => (typeof m === 'string' ? m : m.content))
        : [messages]
      const addedMemories: MemoryItem[] = []

      for (const memory of memoryStrings) {
        const trimmedMemory = memory.trim()
        if (!trimmedMemory) continue

        // Generate hash for deduplication
        const hash = crypto.createHash('sha256').update(trimmedMemory).digest('hex')

        // Check if memory already exists
        const existing = await this.db.execute({
          sql: MemoryQueries.memory.checkExistsIncludeDeleted,
          args: [hash]
        })

        if (existing.rows.length > 0) {
          const existingRecord = existing.rows[0] as any
          const isDeleted = existingRecord.is_deleted === 1

          if (!isDeleted) {
            // Active record exists, skip insertion
            logger.debug(`Memory already exists with hash: ${hash}`)
            continue
          } else {
            // Deleted record exists, restore it instead of inserting new one
            logger.debug(`Restoring deleted memory with hash: ${hash}`)

            // Generate embedding if model is configured
            let embedding: number[] | null = null
            const embedderApiClient = this.config?.embedderApiClient
            if (embedderApiClient) {
              try {
                embedding = await this.generateEmbedding(trimmedMemory)
                logger.debug(
                  `Generated embedding for restored memory with dimension: ${embedding.length} (target: ${this.config?.embedderDimensions || MemoryService.UNIFIED_DIMENSION})`
                )
              } catch (error) {
                logger.error('Failed to generate embedding for restored memory:', error as Error)
              }
            }

            const now = new Date().toISOString()

            // Restore the deleted record
            await this.db.execute({
              sql: MemoryQueries.memory.restoreDeleted,
              args: [
                trimmedMemory,
                embedding ? this.embeddingToVector(embedding) : null,
                metadata ? JSON.stringify(metadata) : null,
                now,
                existingRecord.id
              ]
            })

            // Add to history
            await this.addHistory(existingRecord.id, null, trimmedMemory, 'ADD')

            addedMemories.push({
              id: existingRecord.id,
              memory: trimmedMemory,
              hash,
              createdAt: now,
              updatedAt: now,
              metadata
            })
            continue
          }
        }

        // Generate embedding if model is configured
        let embedding: number[] | null = null
        if (this.config?.embedderApiClient) {
          try {
            embedding = await this.generateEmbedding(trimmedMemory)
            logger.debug(
              `Generated embedding with dimension: ${embedding.length} (target: ${this.config?.embedderDimensions || MemoryService.UNIFIED_DIMENSION})`
            )

            // Check for similar memories using vector similarity
            const similarMemories = await this.hybridSearch(trimmedMemory, embedding, {
              limit: 5,
              threshold: 0.1, // Lower threshold to get more candidates
              userId,
              agentId
            })

            // Check if any similar memory exceeds the similarity threshold
            if (similarMemories.memories.length > 0) {
              const highestSimilarity = Math.max(...similarMemories.memories.map((m) => m.score || 0))
              if (highestSimilarity >= MemoryService.SIMILARITY_THRESHOLD) {
                logger.debug(
                  `Skipping memory addition due to high similarity: ${highestSimilarity.toFixed(3)} >= ${MemoryService.SIMILARITY_THRESHOLD}`
                )
                logger.debug(`Similar memory found: "${similarMemories.memories[0].memory}"`)
                continue
              }
            }
          } catch (error) {
            logger.error('Failed to generate embedding:', error as Error)
          }
        }

        // Insert new memory
        const id = crypto.randomUUID()
        const now = new Date().toISOString()

        await this.db.execute({
          sql: MemoryQueries.memory.insert,
          args: [
            id,
            trimmedMemory,
            hash,
            embedding ? this.embeddingToVector(embedding) : null,
            metadata ? JSON.stringify(metadata) : null,
            userId || null,
            agentId || null,
            runId || null,
            now,
            now
          ]
        })

        // Add to history
        await this.addHistory(id, null, trimmedMemory, 'ADD')

        addedMemories.push({
          id,
          memory: trimmedMemory,
          hash,
          createdAt: now,
          updatedAt: now,
          metadata
        })
      }

      return {
        memories: addedMemories,
        count: addedMemories.length
      }
    } catch (error) {
      logger.error('Failed to add memories:', error as Error)
      return {
        memories: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Search memories using text or vector similarity
   */
  public async search(query: string, options: MemorySearchOptions = {}): Promise<SearchResult> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    const { limit = 10, userId, agentId, filters = {} } = options

    try {
      // If we have an embedder model configured, use vector search
      if (this.config?.embedderApiClient) {
        try {
          const queryEmbedding = await this.generateEmbedding(query)
          return await this.hybridSearch(query, queryEmbedding, { limit, userId, agentId, filters })
        } catch (error) {
          logger.error('Vector search failed, falling back to text search:', error as Error)
        }
      }

      // Fallback to text search
      const conditions: string[] = ['m.is_deleted = 0']
      const params: any[] = []

      // Add search conditions
      conditions.push('(m.memory LIKE ? OR m.memory LIKE ?)')
      params.push(`%${query}%`, `%${query.split(' ').join('%')}%`)

      if (userId) {
        conditions.push('m.user_id = ?')
        params.push(userId)
      }

      if (agentId) {
        conditions.push('m.agent_id = ?')
        params.push(agentId)
      }

      // Add custom filters
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          conditions.push(`json_extract(m.metadata, '$.${key}') = ?`)
          params.push(value)
        }
      }

      const whereClause = conditions.join(' AND ')
      params.push(limit)

      const result = await this.db.execute({
        sql: `${MemoryQueries.memory.list} ${whereClause}
          ORDER BY m.created_at DESC
          LIMIT ?
        `,
        args: params
      })

      const memories: MemoryItem[] = result.rows.map((row: any) => ({
        id: row.id as string,
        memory: row.memory as string,
        hash: (row.hash as string) || undefined,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string
      }))

      return {
        memories,
        count: memories.length
      }
    } catch (error) {
      logger.error('Search failed:', error as Error)
      return {
        memories: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * List all memories with optional filters
   */
  public async list(options: MemoryListOptions = {}): Promise<SearchResult> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    const { userId, agentId, limit = 100, offset = 0 } = options

    try {
      const conditions: string[] = ['m.is_deleted = 0']
      const params: any[] = []

      if (userId) {
        conditions.push('m.user_id = ?')
        params.push(userId)
      }

      if (agentId) {
        conditions.push('m.agent_id = ?')
        params.push(agentId)
      }

      const whereClause = conditions.join(' AND ')

      // Get total count
      const countResult = await this.db.execute({
        sql: `${MemoryQueries.memory.count} ${whereClause}`,
        args: params
      })
      const totalCount = (countResult.rows[0] as any).total as number

      // Get paginated results
      params.push(limit, offset)
      const result = await this.db.execute({
        sql: `${MemoryQueries.memory.list} ${whereClause}
          ORDER BY m.created_at DESC
          LIMIT ? OFFSET ?
        `,
        args: params
      })

      const memories: MemoryItem[] = result.rows.map((row: any) => ({
        id: row.id as string,
        memory: row.memory as string,
        hash: (row.hash as string) || undefined,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string
      }))

      return {
        memories,
        count: totalCount
      }
    } catch (error) {
      logger.error('List failed:', error as Error)
      return {
        memories: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Delete a memory (soft delete)
   */
  public async delete(id: string): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      // Get current memory value for history
      const current = await this.db.execute({
        sql: MemoryQueries.memory.getForDelete,
        args: [id]
      })

      if (current.rows.length === 0) {
        throw new Error('Memory not found')
      }

      const currentMemory = (current.rows[0] as any).memory as string

      // Soft delete
      await this.db.execute({
        sql: MemoryQueries.memory.softDelete,
        args: [new Date().toISOString(), id]
      })

      // Add to history
      await this.addHistory(id, currentMemory, null, 'DELETE')

      logger.debug(`Memory deleted: ${id}`)
    } catch (error) {
      logger.error('Delete failed:', error as Error)
      throw new Error(`Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Update a memory
   */
  public async update(id: string, memory: string, metadata?: Record<string, any>): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      // Get current memory
      const current = await this.db.execute({
        sql: MemoryQueries.memory.getForUpdate,
        args: [id]
      })

      if (current.rows.length === 0) {
        throw new Error('Memory not found')
      }

      const row = current.rows[0] as any
      const previousMemory = row.memory as string
      const previousMetadata = row.metadata ? JSON.parse(row.metadata as string) : {}

      // Generate new hash
      const hash = crypto.createHash('sha256').update(memory.trim()).digest('hex')

      // Generate new embedding if model is configured
      let embedding: number[] | null = null
      if (this.config?.embedderApiClient) {
        try {
          embedding = await this.generateEmbedding(memory)
          logger.debug(
            `Updated embedding with dimension: ${embedding.length} (target: ${this.config?.embedderDimensions || MemoryService.UNIFIED_DIMENSION})`
          )
        } catch (error) {
          logger.error('Failed to generate embedding for update:', error as Error)
        }
      }

      // Merge metadata
      const mergedMetadata = { ...previousMetadata, ...metadata }

      // Update memory
      await this.db.execute({
        sql: MemoryQueries.memory.update,
        args: [
          memory.trim(),
          hash,
          embedding ? this.embeddingToVector(embedding) : null,
          JSON.stringify(mergedMetadata),
          new Date().toISOString(),
          id
        ]
      })

      // Add to history
      await this.addHistory(id, previousMemory, memory, 'UPDATE')

      logger.debug(`Memory updated: ${id}`)
    } catch (error) {
      logger.error('Update failed:', error as Error)
      throw new Error(`Failed to update memory: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get memory history
   */
  public async get(memoryId: string): Promise<MemoryHistoryItem[]> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const result = await this.db.execute({
        sql: MemoryQueries.history.getByMemoryId,
        args: [memoryId]
      })

      return result.rows.map((row: any) => ({
        id: row.id as number,
        memoryId: row.memory_id as string,
        previousValue: row.previous_value as string | undefined,
        newValue: row.new_value as string,
        action: row.action as 'ADD' | 'UPDATE' | 'DELETE',
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        isDeleted: row.is_deleted === 1
      }))
    } catch (error) {
      logger.error('Get history failed:', error as Error)
      throw new Error(`Failed to get memory history: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Delete all memories for a user without deleting the user (hard delete)
   */
  public async deleteAllMemoriesForUser(userId: string): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    if (!userId) {
      throw new Error('User ID is required')
    }

    try {
      // Get count of memories to be deleted
      const countResult = await this.db.execute({
        sql: MemoryQueries.users.countMemoriesForUser,
        args: [userId]
      })
      const totalCount = (countResult.rows[0] as any).total as number

      // Delete history entries for this user's memories
      await this.db.execute({
        sql: MemoryQueries.users.deleteHistoryForUser,
        args: [userId]
      })

      // Hard delete all memories for this user
      await this.db.execute({
        sql: MemoryQueries.users.deleteAllMemoriesForUser,
        args: [userId]
      })

      logger.debug(`Reset all memories for user ${userId} (${totalCount} memories deleted)`)
    } catch (error) {
      logger.error('Reset user memories failed:', error as Error)
      throw new Error(`Failed to reset user memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Delete a user and all their memories (hard delete)
   */
  public async deleteUser(userId: string): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    if (!userId) {
      throw new Error('User ID is required')
    }

    if (userId === 'default-user') {
      throw new Error('Cannot delete the default user')
    }

    try {
      // Get count of memories to be deleted
      const countResult = await this.db.execute({
        sql: `SELECT COUNT(*) as total FROM memories WHERE user_id = ?`,
        args: [userId]
      })
      const totalCount = (countResult.rows[0] as any).total as number

      // Delete history entries for this user's memories
      await this.db.execute({
        sql: `DELETE FROM memory_history WHERE memory_id IN (SELECT id FROM memories WHERE user_id = ?)`,
        args: [userId]
      })

      // Delete all memories for this user (hard delete)
      await this.db.execute({
        sql: `DELETE FROM memories WHERE user_id = ?`,
        args: [userId]
      })

      logger.debug(`Deleted user ${userId} and ${totalCount} memories`)
    } catch (error) {
      logger.error('Delete user failed:', error as Error)
      throw new Error(`Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get list of unique user IDs with their memory counts
   */
  public async getUsersList(): Promise<{ userId: string; memoryCount: number; lastMemoryDate: string }[]> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    try {
      const result = await this.db.execute({
        sql: MemoryQueries.users.getUniqueUsers,
        args: []
      })

      return result.rows.map((row: any) => ({
        userId: row.user_id as string,
        memoryCount: row.memory_count as number,
        lastMemoryDate: row.last_memory_date as string
      }))
    } catch (error) {
      logger.error('Get users list failed:', error as Error)
      throw new Error(`Failed to get users list: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Update configuration
   */
  public setConfig(config: MemoryConfig): void {
    this.config = config
    // Reset embeddings instance when config changes
    this.embeddings = null
  }

  /**
   * Close database connection
   */
  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
      this.db = null
      this.isInitialized = false
    }
  }

  // ========== EMBEDDING OPERATIONS (Previously EmbeddingService) ==========

  /**
   * Normalize embedding dimensions to unified size
   */
  private normalizeEmbedding(embedding: number[]): number[] {
    if (embedding.length === MemoryService.UNIFIED_DIMENSION) {
      return embedding
    }

    if (embedding.length < MemoryService.UNIFIED_DIMENSION) {
      // Pad with zeros
      return [...embedding, ...new Array(MemoryService.UNIFIED_DIMENSION - embedding.length).fill(0)]
    } else {
      // Truncate
      return embedding.slice(0, MemoryService.UNIFIED_DIMENSION)
    }
  }

  /**
   * Generate embedding for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.config?.embedderApiClient) {
      throw new Error('Embedder model not configured')
    }

    try {
      // Initialize embeddings instance if needed
      if (!this.embeddings) {
        if (!this.config.embedderApiClient) {
          throw new Error('Embedder provider not configured')
        }

        this.embeddings = new Embeddings({
          embedApiClient: this.config.embedderApiClient,
          dimensions: this.config.embedderDimensions
        })
        await this.embeddings.init()
      }

      const embedding = await this.embeddings.embedQuery(text)

      // Normalize to unified dimension
      return this.normalizeEmbedding(embedding)
    } catch (error) {
      logger.error('Embedding generation failed:', error as Error)
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // ========== VECTOR SEARCH OPERATIONS (Previously VectorSearch) ==========

  /**
   * Convert embedding array to libsql vector format
   */
  private embeddingToVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`
  }

  /**
   * Hybrid search combining text and vector similarity (currently vector-only)
   */
  private async hybridSearch(
    _: string,
    queryEmbedding: number[],
    options: VectorSearchOptions = {}
  ): Promise<SearchResult> {
    if (!this.db) throw new Error('Database not initialized')

    const { limit = 10, threshold = 0.5, userId } = options

    try {
      const queryVector = this.embeddingToVector(queryEmbedding)

      const conditions: string[] = ['m.is_deleted = 0']
      const params: any[] = []

      // Vector search only - three vector parameters for distance, vector_similarity, and combined_score
      params.push(queryVector, queryVector, queryVector)

      if (userId) {
        conditions.push('m.user_id = ?')
        params.push(userId)
      }

      const whereClause = conditions.join(' AND ')

      const hybridQuery = `${MemoryQueries.search.hybridSearch} ${whereClause}
      ) AS results
      WHERE vector_similarity >= ?
      ORDER BY vector_similarity DESC
      LIMIT ?`

      params.push(threshold, limit)

      const result = await this.db.execute({
        sql: hybridQuery,
        args: params
      })

      const memories: MemoryItem[] = result.rows.map((row: any) => ({
        id: row.id as string,
        memory: row.memory as string,
        hash: (row.hash as string) || undefined,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        score: row.vector_similarity as number
      }))

      return {
        memories,
        count: memories.length
      }
    } catch (error) {
      logger.error('Hybrid search failed:', error as Error)
      throw new Error(`Hybrid search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // ========== HELPER METHODS ==========

  /**
   * Add entry to memory history
   */
  private async addHistory(
    memoryId: string,
    previousValue: string | null,
    newValue: string | null,
    action: 'ADD' | 'UPDATE' | 'DELETE'
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const now = new Date().toISOString()
    await this.db.execute({
      sql: MemoryQueries.history.insert,
      args: [memoryId, previousValue, newValue, action, now, now]
    })
  }
}

export default MemoryService
