import {
  type Client,
  type Config as LibSQLClientConfig,
  createClient,
  type InArgs,
  type InStatement
} from '@libsql/client'
import {
  type BaseNode,
  BaseVectorStore,
  combineResults,
  DEFAULT_COLLECTION,
  Document,
  FilterCondition,
  FilterOperator,
  type Metadata,
  type MetadataFilter,
  MetadataMode,
  type VectorStoreQuery,
  type VectorStoreQueryResult
} from '@vectorstores/core'
import { getEnv } from '@vectorstores/env'

export const LIBSQL_TABLE = 'libsql_vectorstores_embedding'
export const DEFAULT_DIMENSIONS = 1536

type PositionalArgs = Extract<InArgs, readonly unknown[]>

// Helper function to safely convert unknown array to InArgs
function toInArgs(params: unknown[]): InArgs {
  // Filter and validate parameters to ensure they match InArgs requirements
  return params.filter(
    (param): param is NonNullable<PositionalArgs[number]> =>
      param != null &&
      (typeof param === 'string' ||
        typeof param === 'number' ||
        typeof param === 'boolean' ||
        param instanceof ArrayBuffer ||
        ArrayBuffer.isView(param) ||
        param instanceof Date)
  ) as PositionalArgs
}

/**
 * Provides support for writing and querying vector data in libSQL/Turso.
 * Uses native libSQL vector operations for similarity search.
 */
export class LibSQLVectorStore extends BaseVectorStore {
  storesText: boolean = true

  private collection: string = DEFAULT_COLLECTION
  private readonly tableName: string = LIBSQL_TABLE
  private readonly dimensions: number = DEFAULT_DIMENSIONS

  private clientInstance: Client
  private initialized: boolean = false

  constructor(
    init: Partial<{ client: Client }> &
      Partial<{
        tableName?: string
        dimensions?: number
        collection?: string
        clientConfig?: LibSQLClientConfig
      }>
  ) {
    super()

    this.collection = init.collection ?? DEFAULT_COLLECTION
    this.tableName = init.tableName ?? LIBSQL_TABLE
    this.dimensions = init.dimensions ?? DEFAULT_DIMENSIONS

    let clientConfig = init.clientConfig

    if (init.client) {
      this.clientInstance = init.client
    } else {
      clientConfig = clientConfig ?? this.getDefaultClientConfig()
      if (!clientConfig) {
        throw new Error('LibSQL clientConfig is required when no client instance is provided.')
      }
      this.clientInstance = createClient(clientConfig)
    }
  }

  setCollection(coll: string) {
    this.collection = coll
  }

  getCollection(): string {
    return this.collection
  }

  client(): Client {
    return this.clientInstance
  }

  private getDefaultClientConfig(): LibSQLClientConfig {
    const envUrl = getEnv('LIBSQL_URL')
    const url = envUrl ?? ':memory:'

    if (!envUrl) {
      console.warn(
        'LIBSQL_URL not set. Falling back to in-memory libSQL (non-persistent). Set LIBSQL_URL for a persistent database.'
      )
    }

    const authToken = getEnv('LIBSQL_AUTH_TOKEN')

    return authToken ? { url, authToken } : { url }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.checkSchema(this.clientInstance)
      this.initialized = true
    }
  }

  private async checkSchema(client: Client) {
    const createTableStatement: InStatement = {
      sql: `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          external_id TEXT,
          collection TEXT,
          document TEXT,
          metadata JSON DEFAULT '{}',
          embeddings F32_BLOB(${this.dimensions})
        )
      `,
      args: []
    }
    await client.execute(createTableStatement)

    try {
      const indexStatement: InStatement = {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_external_id
          ON ${this.tableName} (external_id)
        `,
        args: []
      }
      await client.execute(indexStatement)
    } catch {
      // Index might already exist, ignore
    }

    try {
      const collectionIndexStatement: InStatement = {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_collection
          ON ${this.tableName} (collection)
        `,
        args: []
      }
      await client.execute(collectionIndexStatement)
    } catch {
      // Index might already exist, ignore
    }
    try {
      const vectorIndexStatement: InStatement = {
        sql: `
            CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vector
            ON ${this.tableName} (libsql_vector_idx(embeddings, 'metric=cosine'))
          `,
        args: []
      }
      await client.execute(vectorIndexStatement)
    } catch (e) {
      console.warn('Failed to create vector index:', e)
    }

    // Create FTS5 virtual table for full-text search (bm25/hybrid modes)
    try {
      const ftsStatement: InStatement = {
        sql: `
          CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_fts
          USING fts5(id, document, content='${this.tableName}', content_rowid='rowid')
        `,
        args: []
      }
      await client.execute(ftsStatement)
    } catch (e) {
      console.warn('Failed to create FTS5 table:', e)
    }
  }

  async clearCollection(): Promise<void> {
    const sql = `DELETE FROM ${this.tableName} WHERE collection = ?`
    await this.ensureInitialized()
    const validParams = toInArgs([this.collection])
    const statement: InStatement = { sql, args: validParams }
    await this.clientInstance.execute(statement)
  }

  private getDataToInsert(embeddingResults: BaseNode<Metadata>[]) {
    return embeddingResults.map((node) => {
      const id = node.id_.length ? node.id_ : null
      const meta = node.metadata || {}
      if (!meta.create_date) {
        meta.create_date = new Date()
      }

      // Extract external_id from metadata and store in dedicated column
      const externalId = (meta.external_id as string) || ''
      delete meta.external_id

      let embedding: Float32Array
      try {
        embedding = this.normalizeEmbedding(node.getEmbedding())
      } catch {
        console.warn(`Embedding missing for node ${id ?? '<auto-id>'}, using zero vector.`)
        embedding = new Float32Array(this.dimensions)
      }

      // Convert embedding to JSON string for vector() function
      const embeddingJson = `[${Array.from(embedding).join(',')}]`

      return [id!, externalId, this.collection, node.getContent(MetadataMode.NONE), JSON.stringify(meta), embeddingJson]
    })
  }

  async add(embeddingResults: BaseNode<Metadata>[]): Promise<string[]> {
    if (embeddingResults.length === 0) {
      console.warn('Empty list sent to LibSQLVectorStore::add')
      return []
    }

    await this.ensureInitialized()
    const data = this.getDataToInsert(embeddingResults)

    const placeholders = data
      .map(
        (_, index) =>
          `(?${index * 6 + 1}, ?${index * 6 + 2}, ?${index * 6 + 3}, ?${index * 6 + 4}, ?${index * 6 + 5}, vector32(?${index * 6 + 6}))`
      )
      .join(', ')

    const sql = `
      INSERT INTO ${this.tableName}
        (id, external_id, collection, document, metadata, embeddings)
      VALUES ${placeholders}
      ON CONFLICT (id) DO UPDATE SET
        external_id = excluded.external_id,
        collection = excluded.collection,
        document = excluded.document,
        metadata = excluded.metadata,
        embeddings = excluded.embeddings
    `

    const flattenedParams = data.flat()
    const validParams = toInArgs(flattenedParams)
    const statement: InStatement = { sql, args: validParams }
    await this.clientInstance.execute(statement)
    return data.map((row) => String(row[0]))
  }

  async delete(refDocId: string, _deleteKwargs?: object): Promise<void> {
    await this.ensureInitialized()

    const collectionCriteria = this.collection.length ? 'AND collection = ?' : ''
    const sql = `DELETE FROM ${this.tableName} WHERE id = ? ${collectionCriteria}`

    const args = this.collection.length ? [refDocId, this.collection] : [refDocId]
    const validParams = toInArgs(args)
    const statement: InStatement = { sql, args: validParams }
    await this.clientInstance.execute(statement)
  }

  async deleteByExternalId(externalId: string): Promise<number> {
    await this.ensureInitialized()

    // 1. Query rowids for FTS table deletion
    const rowIdResult = await this.clientInstance.execute({
      sql: `SELECT rowid FROM ${this.tableName} WHERE external_id = ?`,
      args: [externalId]
    })
    const rowIds = rowIdResult.rows
      .map((row) => Number((row as { rowid?: unknown }).rowid))
      .filter((rowId) => Number.isFinite(rowId))

    if (rowIds.length === 0) {
      return 0
    }

    // 2. Delete FTS table records
    const placeholders = rowIds.map(() => '?').join(', ')
    try {
      await this.clientInstance.execute({
        sql: `DELETE FROM ${this.tableName}_fts WHERE rowid IN (${placeholders})`,
        args: toInArgs(rowIds)
      })
    } catch {
      // FTS table may not exist, ignore error
    }

    // 3. Delete main table records
    const deleteResult = await this.clientInstance.execute({
      sql: `DELETE FROM ${this.tableName} WHERE external_id = ?`,
      args: [externalId]
    })

    return deleteResult.rowsAffected ?? rowIds.length
  }

  private normalizeEmbedding(embedding?: number[]): Float32Array {
    if (!embedding || embedding.length === 0) {
      return new Float32Array(this.dimensions)
    }

    if (embedding.length === this.dimensions) {
      return new Float32Array(embedding)
    }

    const normalized = new Float32Array(this.dimensions)
    normalized.set(embedding.slice(0, this.dimensions))
    return normalized
  }

  private deserializeEmbedding(raw: unknown): number[] {
    if (!raw) return []

    if (raw instanceof Float32Array) {
      return Array.from(raw)
    }

    if (raw instanceof ArrayBuffer) {
      return Array.from(new Float32Array(raw))
    }

    if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView
      return Array.from(
        new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT)
      )
    }

    if (Array.isArray(raw)) {
      return raw.map((value) => Number(value))
    }

    return []
  }

  private toLibSQLCondition(condition: `${FilterCondition}`) {
    switch (condition) {
      case FilterCondition.AND:
        return 'AND'
      case FilterCondition.OR:
        return 'OR'
      default:
        return 'AND'
    }
  }

  private buildFilterClause(filter: MetadataFilter): {
    clause: string
    params: unknown[]
  } {
    const key = filter.key

    switch (filter.operator) {
      case FilterOperator.EQ:
        return {
          clause: `json_extract(metadata, '$.${key}') = ?`,
          params: [filter.value]
        }
      case FilterOperator.GT:
        return {
          clause: `CAST(json_extract(metadata, '$.${key}') AS REAL) > ?`,
          params: [filter.value]
        }
      case FilterOperator.LT:
        return {
          clause: `CAST(json_extract(metadata, '$.${key}') AS REAL) < ?`,
          params: [filter.value]
        }
      case FilterOperator.GTE:
        return {
          clause: `CAST(json_extract(metadata, '$.${key}') AS REAL) >= ?`,
          params: [filter.value]
        }
      case FilterOperator.LTE:
        return {
          clause: `CAST(json_extract(metadata, '$.${key}') AS REAL) <= ?`,
          params: [filter.value]
        }
      case FilterOperator.NE:
        return {
          clause: `json_extract(metadata, '$.${key}') != ?`,
          params: [filter.value]
        }
      case FilterOperator.IN:
        if (Array.isArray(filter.value)) {
          const placeholders = filter.value.map(() => '?').join(', ')
          return {
            clause: `json_extract(metadata, '$.${key}') IN (${placeholders})`,
            params: filter.value
          }
        }
        return {
          clause: `json_extract(metadata, '$.${key}') IN (?)`,
          params: [filter.value]
        }
      case FilterOperator.NIN:
        if (Array.isArray(filter.value)) {
          const placeholders = filter.value.map(() => '?').join(', ')
          return {
            clause: `json_extract(metadata, '$.${key}') NOT IN (${placeholders})`,
            params: filter.value
          }
        }
        return {
          clause: `json_extract(metadata, '$.${key}') NOT IN (?)`,
          params: [filter.value]
        }
      case FilterOperator.CONTAINS:
        return {
          clause: `json_extract(metadata, '$.${key}') LIKE '%' || ? || '%'`,
          params: [filter.value]
        }
      case FilterOperator.IS_EMPTY:
        return {
          clause: `(json_extract(metadata, '$.${key}') IS NULL OR json_extract(metadata, '$.${key}') = '' OR json_extract(metadata, '$.${key}') = '[]')`,
          params: []
        }
      case FilterOperator.TEXT_MATCH:
        return {
          clause: `LOWER(json_extract(metadata, '$.${key}')) LIKE LOWER('%' || ? || '%')`,
          params: [filter.value]
        }
      default:
        return {
          clause: `json_extract(metadata, '$.${key}') = ?`,
          params: [filter.value]
        }
    }
  }

  async query(query: VectorStoreQuery, _options?: object): Promise<VectorStoreQueryResult> {
    await this.ensureInitialized()

    if (query.mode === 'bm25') {
      return this.bm25Search(query)
    } else if (query.mode === 'hybrid') {
      return this.hybridSearch(query)
    } else {
      return this.vectorSearch(query)
    }
  }

  private buildWhereClause(query: VectorStoreQuery): {
    where: string
    params: unknown[]
  } {
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (this.collection.length) {
      whereClauses.push('collection = ?')
      params.push(this.collection)
    }

    const filterClauses: string[] = []
    query.filters?.filters.forEach((filter: MetadataFilter) => {
      const { clause, params: filterParams } = this.buildFilterClause(filter)
      filterClauses.push(clause)
      if (filterParams.length > 0) {
        params.push(...filterParams)
      }
    })

    if (filterClauses.length > 0) {
      const condition = this.toLibSQLCondition(query.filters?.condition ?? FilterCondition.AND)
      whereClauses.push(`(${filterClauses.join(` ${condition} `)})`)
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    return { where, params }
  }

  private async vectorSearch(query: VectorStoreQuery): Promise<VectorStoreQueryResult> {
    const max = query.similarityTopK ?? 2
    const queryEmbedding = query.queryEmbedding ?? []

    if (!queryEmbedding.length) {
      return { nodes: [], similarities: [], ids: [] }
    }

    const { where, params } = this.buildWhereClause(query)
    const vectorJson = `[${queryEmbedding.join(',')}]`
    const indexName = `idx_${this.tableName}_vector`

    // Use vector_top_k for efficient ANN search with vector index
    // Fetch more candidates to account for filtering
    const prefetch = where ? max * 5 : max

    const vectorStatement: InStatement = {
      sql: `
        SELECT t.*, vector_distance_cos(t.embeddings, vector32(?)) as distance
        FROM vector_top_k('${indexName}', vector32(?), ${prefetch}) AS v
        JOIN ${this.tableName} t ON t.rowid = v.id
        ${where.replace(/collection/g, 't.collection').replace(/metadata/g, 't.metadata')}
        ORDER BY distance
        LIMIT ${max}
      `,
      args: toInArgs([vectorJson, vectorJson, ...params])
    }

    const vectorResults = await this.clientInstance.execute(vectorStatement)
    return this.mapVectorResult(vectorResults.rows, max)
  }

  private async bm25Search(query: VectorStoreQuery): Promise<VectorStoreQueryResult> {
    const max = query.similarityTopK ?? 2

    if (!query.queryStr) {
      throw new Error('queryStr is required for BM25 mode')
    }

    const { where, params } = this.buildWhereClause(query)

    // Use FTS5 for BM25 search
    const ftsStatement: InStatement = {
      sql: `
        SELECT v.*, bm25(${this.tableName}_fts) as score
        FROM ${this.tableName}_fts fts
        JOIN ${this.tableName} v ON fts.rowid = v.rowid
        ${where.replace(/collection/g, 'v.collection').replace(/metadata/g, 'v.metadata')}
        ${where ? 'AND' : 'WHERE'} ${this.tableName}_fts MATCH ?
        ORDER BY score
        LIMIT ${max}
      `,
      args: toInArgs([...params, query.queryStr])
    }

    try {
      const results = await this.clientInstance.execute(ftsStatement)
      return this.mapBm25Result(results.rows, max)
    } catch (err) {
      console.warn('FTS5 search failed:', err)
      throw new Error(`BM25 search failed: ${err}`)
    }
  }

  private async hybridSearch(query: VectorStoreQuery): Promise<VectorStoreQueryResult> {
    const max = query.similarityTopK ?? 2
    const queryEmbedding = query.queryEmbedding ?? []

    if (!queryEmbedding.length) {
      throw new Error('queryEmbedding is required for HYBRID mode')
    }
    if (!query.queryStr) {
      throw new Error('queryStr is required for HYBRID mode')
    }

    const alpha = query.alpha ?? 0.5
    const prefetch = query.hybridPrefetch ?? max * 5

    // Step 1: Get vector search results
    const vectorQuery: VectorStoreQuery = {
      ...query,
      similarityTopK: prefetch,
      mode: 'default'
    }
    const vectorResults = await this.vectorSearch(vectorQuery)

    // Step 2: Get BM25 results
    const bm25Query: VectorStoreQuery = {
      ...query,
      similarityTopK: prefetch,
      mode: 'bm25'
    }
    const bm25Results = await this.bm25Search(bm25Query)

    // Step 3: Combine results using RRF
    return combineResults(vectorResults, bm25Results, alpha, max)
  }

  private mapVectorResult(rows: Record<string, unknown>[], max: number): VectorStoreQueryResult {
    const results = rows.slice(0, max).map((row) => {
      const embedding = this.deserializeEmbedding(row.embeddings)
      const distance = Number(row.distance ?? 0)
      const similarity = 1 - distance

      return {
        node: new Document({
          id_: String(row.id),
          text: String(row.document || ''),
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Metadata),
          embedding
        }),
        similarity,
        id: String(row.id)
      }
    })

    return {
      nodes: results.map((r) => r.node),
      similarities: results.map((r) => r.similarity),
      ids: results.map((r) => r.id)
    }
  }

  private mapBm25Result(rows: Record<string, unknown>[], max: number): VectorStoreQueryResult {
    const results = rows.slice(0, max).map((row) => {
      const embedding = this.deserializeEmbedding(row.embeddings)
      const score = Math.abs(Number(row.score ?? 0))

      return {
        node: new Document({
          id_: String(row.id),
          text: String(row.document || ''),
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Metadata),
          embedding
        }),
        similarity: score,
        id: String(row.id)
      }
    })

    return {
      nodes: results.map((r) => r.node),
      similarities: results.map((r) => r.similarity),
      ids: results.map((r) => r.id)
    }
  }

  persist(_persistPath: string): Promise<void> {
    return Promise.resolve()
  }

  async exists(refDocId: string): Promise<boolean> {
    await this.ensureInitialized()
    const collectionCriteria = this.collection.length ? 'AND collection = ?' : ''
    const sql = `SELECT 1 FROM ${this.tableName}
                 WHERE json_extract(metadata, '$.ref_doc_id') = ? ${collectionCriteria} LIMIT 1`
    const params = this.collection.length ? [refDocId, this.collection] : [refDocId]
    const results = await this.clientInstance.execute({
      sql,
      args: toInArgs(params)
    })
    return results.rows.length > 0
  }
}
