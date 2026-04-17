/**
 * LibSqlProvider — local, offline memory provider using LibSQL (SQLite with
 * vector extension) + Embeddings from the knowledge base infrastructure.
 *
 * This is a simplified, self-contained revival of the deleted MemoryService
 * (commit ea99c8211). It is the default provider (no external server needed).
 *
 * Schema:
 *   memories(id TEXT PK, memory TEXT, hash TEXT, embedding F32_BLOB, userId TEXT,
 *            agentId TEXT, topicId TEXT, metadata TEXT JSON, created_at TEXT,
 *            updated_at TEXT)
 *
 * Fact extraction / update is handled by the renderer-side MemoryProcessor
 * (LibSql code path only). This class receives already-extracted facts.
 */

import crypto from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import type {
  AddMemoryOptions,
  BankStrategy,
  MemoryDeleteAllOptions,
  MemoryEntity,
  MemoryItem,
  MemoryListOptions,
  MemoryProviderCapabilities,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryUser
} from '@shared/memory'
import type { MemoryProvider } from '@shared/memory/provider'

const logger = loggerService.withContext('LibSqlProvider')

const TABLE = 'cherry_memories'

export class LibSqlProvider implements MemoryProvider {
  readonly id = 'libsql'

  readonly capabilities: MemoryProviderCapabilities = {
    supportsReflect: false,
    supportsMentalModels: false,
    supportsBanks: false,
    serverSideExtraction: false
  }

  private db: any = null
  private dimensions = 1536
  private similarityThreshold = 0.85
  private initialized = false

  async init(): Promise<void> {
    const { createClient } = require('@libsql/client')
    const dbPath = application.getPath('feature.memory.db_file')

    this.db = createClient({ url: `file:${dbPath}`, intMode: 'number' })

    this.dimensions = (this.pref('feature.memory.libsql.embedder_dimensions') as number) ?? 1536
    this.similarityThreshold = (this.pref('feature.memory.libsql.similarity_threshold') as number) ?? 0.85

    await this.ensureSchema()
    this.initialized = true
    logger.info('LibSqlProvider initialised', { dbPath, dimensions: this.dimensions })
  }

  async add(content: string | string[], options?: AddMemoryOptions): Promise<MemoryItem[]> {
    this.requireInit()
    const texts = Array.isArray(content) ? content : [content]
    const results: MemoryItem[] = []

    for (const text of texts) {
      const hash = this.hashContent(text)

      // Dedup: if hash already exists, skip.
      const existing = await this.findByHash(hash, options)
      if (existing) {
        results.push(existing)
        continue
      }

      const embedding = await this.embed(text)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      await this.db.execute({
        sql: `INSERT INTO ${TABLE}
              (id, memory, hash, embedding, user_id, agent_id, topic_id, metadata, created_at, updated_at)
              VALUES (?, ?, ?, vector32(?), ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          text,
          hash,
          JSON.stringify(embedding),
          options?.userId ?? null,
          options?.agentId ?? null,
          options?.topicId ?? options?.runId ?? null,
          JSON.stringify(options?.metadata ?? {}),
          now,
          now
        ]
      })

      results.push({ id, memory: text, hash, createdAt: now, metadata: options?.metadata })
    }

    return results
  }

  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult> {
    this.requireInit()
    const embedding = await this.embed(query)
    const limit = options?.limit ?? 10

    const scopeClause = this.buildScopeClause(options)
    const sql = `
      SELECT id, memory, hash, metadata, created_at, updated_at,
             vector_distance_cos(embedding, vector32(?)) AS dist
      FROM ${TABLE}
      ${scopeClause.sql}
      ORDER BY dist ASC
      LIMIT ?
    `

    const rs = await this.db.execute({
      sql,
      args: [...scopeClause.args, JSON.stringify(embedding), limit]
    })

    const results: MemoryItem[] = (rs.rows ?? [])
      .filter((row: { dist: number }) => row.dist <= 1 - this.similarityThreshold)
      .map((row: Record<string, unknown>) => this.rowToItem(row))

    return { results }
  }

  async list(options?: MemoryListOptions): Promise<MemoryItem[]> {
    this.requireInit()
    const scopeClause = this.buildScopeClause(options)
    const limit = options?.limit ?? 100
    const offset = options?.offset ?? 0

    const rs = await this.db.execute({
      sql: `SELECT id, memory, hash, metadata, created_at, updated_at
            FROM ${TABLE}
            ${scopeClause.sql}
            ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [...scopeClause.args, limit, offset]
    })

    return (rs.rows ?? []).map((row: Record<string, unknown>) => this.rowToItem(row))
  }

  async get(id: string): Promise<MemoryItem | null> {
    this.requireInit()
    const rs = await this.db.execute({
      sql: `SELECT id, memory, hash, metadata, created_at, updated_at FROM ${TABLE} WHERE id = ?`,
      args: [id]
    })
    const row = rs.rows?.[0]
    return row ? this.rowToItem(row as Record<string, unknown>) : null
  }

  async update(id: string, memory: string, metadata?: Record<string, unknown>): Promise<MemoryItem> {
    this.requireInit()
    const embedding = await this.embed(memory)
    const hash = this.hashContent(memory)
    const now = new Date().toISOString()

    const existing = await this.get(id)
    const mergedMeta = { ...existing?.metadata, ...metadata }

    await this.db.execute({
      sql: `UPDATE ${TABLE}
            SET memory = ?, hash = ?, embedding = vector32(?), metadata = ?, updated_at = ?
            WHERE id = ?`,
      args: [memory, hash, JSON.stringify(embedding), JSON.stringify(mergedMeta), now, id]
    })

    return { id, memory, hash, metadata: mergedMeta, updatedAt: now }
  }

  async delete(id: string): Promise<void> {
    this.requireInit()
    await this.db.execute({ sql: `DELETE FROM ${TABLE} WHERE id = ?`, args: [id] })
  }

  async deleteAll(options?: MemoryDeleteAllOptions): Promise<void> {
    this.requireInit()
    const scopeClause = this.buildScopeClause(options)
    await this.db.execute({
      sql: `DELETE FROM ${TABLE} ${scopeClause.sql}`,
      args: scopeClause.args
    })
  }

  async listUsers(): Promise<MemoryUser[]> {
    this.requireInit()
    const rs = await this.db.execute({
      sql: `SELECT user_id, COUNT(*) as cnt FROM ${TABLE} WHERE user_id IS NOT NULL GROUP BY user_id`,
      args: []
    })
    return (rs.rows ?? []).map((row: Record<string, unknown>) => ({
      userId: String(row.user_id),
      memoryCount: Number(row.cnt)
    }))
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.db) return false
      await this.db.execute({ sql: 'SELECT 1', args: [] })
      return true
    } catch {
      return false
    }
  }

  async destroy(): Promise<void> {
    this.db?.close?.()
    this.db = null
    this.initialized = false
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private requireInit(): void {
    if (!this.initialized) throw new Error('LibSqlProvider not initialised.')
  }

  private async ensureSchema(): Promise<void> {
    await this.db.execute({
      sql: `CREATE TABLE IF NOT EXISTS ${TABLE} (
        id         TEXT PRIMARY KEY,
        memory     TEXT NOT NULL,
        hash       TEXT NOT NULL,
        embedding  F32_BLOB(${this.dimensions}),
        user_id    TEXT,
        agent_id   TEXT,
        topic_id   TEXT,
        metadata   TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      args: []
    })
    await this.db.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_${TABLE}_hash ON ${TABLE}(hash)`,
      args: []
    })
    await this.db.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_${TABLE}_user ON ${TABLE}(user_id)`,
      args: []
    })
  }

  private async embed(text: string): Promise<number[]> {
    // Delegate to the embeddings infrastructure shared with KnowledgeBase.
    // This requires the user to have configured an embedding model — same as KB.
    const Embeddings = await import('@main/knowledge/embedjs/embeddings/Embeddings')
    const embedApiClient = this.getEmbedApiClient()

    if (!embedApiClient) {
      throw new Error(
        'No embedding model configured for LibSql memory provider. ' +
          'Configure an embedder in Settings → Memory → Built-in Provider.'
      )
    }

    const embedder = new Embeddings.default({
      embedApiClient,
      dimensions: this.dimensions
    })
    await embedder.init()
    return embedder.embedQuery(text)
  }

  private getEmbedApiClient(): null {
    // TODO(v2): LibSql provider embedding is not yet wired.
    // Building an embedApiClient requires resolving provider config (apiKey / baseURL)
    // for the configured embedder model, which currently lives in renderer state and
    // is not directly accessible from the main process.
    //
    // Until this is implemented the LibSql provider is non-functional — activation
    // will fail fast with a clear error from embed() above.
    // Use the Hindsight provider in the meantime.
    return null
  }

  private async findByHash(hash: string, options?: Partial<MemoryEntity>): Promise<MemoryItem | null> {
    const scopeClause = this.buildScopeClause(options)
    const rs = await this.db.execute({
      sql: `SELECT id, memory, hash, metadata, created_at FROM ${TABLE}
            WHERE hash = ? ${scopeClause.sql ? 'AND ' + scopeClause.sql.replace(/^\s*WHERE\s+/i, '') : ''}
            LIMIT 1`,
      args: [hash, ...scopeClause.args]
    })
    const row = rs.rows?.[0]
    return row ? this.rowToItem(row as Record<string, unknown>) : null
  }

  private buildScopeClause(entity?: Partial<MemoryEntity>): { sql: string; args: (string | null)[] } {
    const conditions: string[] = []
    const args: (string | null)[] = []

    const strategy = (this.pref('feature.memory.bank_strategy') as BankStrategy) ?? 'per_user'
    const userId = entity?.userId ?? (this.pref('feature.memory.current_user_id') as string)

    switch (strategy) {
      case 'per_user':
        if (userId) {
          conditions.push('user_id = ?')
          args.push(userId)
        }
        break
      case 'per_assistant':
        if (entity?.agentId) {
          conditions.push('agent_id = ?')
          args.push(entity.agentId)
        }
        break
      case 'per_topic':
        if (entity?.topicId ?? entity?.runId) {
          conditions.push('topic_id = ?')
          args.push(entity.topicId ?? entity.runId ?? null)
        }
        break
      case 'global':
      default:
        // No scope filter.
        break
    }

    return {
      sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
      args
    }
  }

  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex')
  }

  private rowToItem(row: Record<string, unknown>): MemoryItem {
    let metadata: Record<string, unknown> = {}
    try {
      metadata = JSON.parse(String(row.metadata ?? '{}'))
    } catch {
      // malformed json — use empty
    }
    return {
      id: String(row.id),
      memory: String(row.memory),
      hash: row.hash ? String(row.hash) : undefined,
      createdAt: row.created_at ? String(row.created_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
      metadata
    }
  }

  private pref(key: string): unknown {
    return application.get('PreferenceService').get(key as never)
  }
}
