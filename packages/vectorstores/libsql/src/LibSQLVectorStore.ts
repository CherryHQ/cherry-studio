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
const SAFE_METADATA_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

type PositionalArgs = Extract<InArgs, readonly unknown[]>

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function toFts5PhraseQuery(query: string): string | null {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    return null
  }

  if (!/[\p{L}\p{N}_]/u.test(trimmedQuery)) {
    return null
  }

  return `"${trimmedQuery.replaceAll('"', '""')}"`
}

function validateMetadataKey(key: string): string {
  if (!SAFE_METADATA_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid metadata filter key: ${key}`)
  }

  return key
}

function isSupportedInArg(param: unknown): param is NonNullable<PositionalArgs[number]> {
  return (
    param != null &&
    (typeof param === 'string' ||
      typeof param === 'number' ||
      typeof param === 'boolean' ||
      param instanceof ArrayBuffer ||
      ArrayBuffer.isView(param) ||
      param instanceof Date)
  )
}

// Helper function to safely convert unknown array to InArgs
function toInArgs(params: unknown[]): InArgs {
  for (const [index, param] of params.entries()) {
    if (!isSupportedInArg(param)) {
      throw new Error(`Invalid libSQL argument at index ${index}: ${String(param)}`)
    }
  }

  return params as PositionalArgs
}

/**
 * Provides support for writing and querying vector data in libSQL/Turso.
 * Uses native libSQL vector operations for similarity search without ANN indexes.
 */
export class LibSQLVectorStore extends BaseVectorStore {
  storesText: boolean = true

  private collection: string = DEFAULT_COLLECTION
  private readonly tableName: string = LIBSQL_TABLE
  private readonly dimensions: number = DEFAULT_DIMENSIONS

  private clientInstance: Client
  private initialized: boolean = false
  private initializationPromise?: Promise<void>

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
    if (this.initialized) {
      return
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.checkSchema(this.clientInstance)
        .then(() => {
          this.initialized = true
        })
        .finally(() => {
          this.initializationPromise = undefined
        })
    }

    await this.initializationPromise
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

    const indexStatement: InStatement = {
      sql: `
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_external_id
        ON ${this.tableName} (external_id)
      `,
      args: []
    }
    await client.execute(indexStatement)

    const collectionIndexStatement: InStatement = {
      sql: `
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_collection
        ON ${this.tableName} (collection)
      `,
      args: []
    }
    await client.execute(collectionIndexStatement)

    // Create FTS5 virtual table for full-text search (bm25/hybrid modes)
    const ftsTableName = `${this.tableName}_fts`
    const ftsTableExistsResult = await client.execute({
      sql: `
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
      `,
      args: toInArgs([ftsTableName])
    })
    const shouldRebuildFts = ftsTableExistsResult.rows.length === 0
    const ftsStatement: InStatement = {
      sql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTableName}
        USING fts5(document, content='${this.tableName}', content_rowid='rowid')
      `,
      args: []
    }
    await client.execute(ftsStatement)

    await client.execute({
      sql: `
        CREATE TRIGGER IF NOT EXISTS ${this.tableName}_ai
        AFTER INSERT ON ${this.tableName}
        BEGIN
          INSERT INTO ${ftsTableName}(rowid, document)
          VALUES (NEW.rowid, NEW.document);
        END
      `,
      args: []
    })

    await client.execute({
      sql: `
        CREATE TRIGGER IF NOT EXISTS ${this.tableName}_au
        AFTER UPDATE OF document ON ${this.tableName}
        BEGIN
          INSERT INTO ${ftsTableName}(${ftsTableName}, rowid, document)
          VALUES ('delete', OLD.rowid, OLD.document);
          INSERT INTO ${ftsTableName}(rowid, document)
          VALUES (NEW.rowid, NEW.document);
        END
      `,
      args: []
    })

    await client.execute({
      sql: `
        CREATE TRIGGER IF NOT EXISTS ${this.tableName}_ad
        AFTER DELETE ON ${this.tableName}
        BEGIN
          INSERT INTO ${ftsTableName}(${ftsTableName}, rowid, document)
          VALUES ('delete', OLD.rowid, OLD.document);
        END
      `,
      args: []
    })

    if (shouldRebuildFts) {
      await client.execute({
        sql: `
          INSERT INTO ${ftsTableName}(${ftsTableName})
          VALUES ('rebuild')
        `,
        args: []
      })
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
      const externalId = node.sourceNode?.nodeId || node.id_
      const meta = node.metadata || {}
      if (!meta.create_date) {
        meta.create_date = new Date()
      }

      const nodeId = id ?? '<auto-id>'
      const embedding = this.normalizeEmbeddingOrThrow(this.getNodeEmbedding(node, nodeId), nodeId)

      // Convert embedding to JSON string for vector() function
      const embeddingJson = `[${Array.from(embedding).join(',')}]`

      return [id!, externalId, this.collection, node.getContent(MetadataMode.NONE), JSON.stringify(meta), embeddingJson]
    })
  }

  private getNodeEmbedding(node: BaseNode<Metadata>, nodeId: string): number[] | undefined {
    try {
      return node.getEmbedding()
    } catch (error) {
      throw new Error(`Missing embedding for node ${nodeId}`, { cause: toError(error) })
    }
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
    void _deleteKwargs
    await this.ensureInitialized()

    const collectionCriteria = this.collection.length ? 'AND collection = ?' : ''
    const sql = `DELETE FROM ${this.tableName} WHERE external_id = ? ${collectionCriteria}`

    const args = this.collection.length ? [refDocId, this.collection] : [refDocId]
    const validParams = toInArgs(args)
    const statement: InStatement = { sql, args: validParams }
    await this.clientInstance.execute(statement)
  }

  private normalizeEmbeddingOrThrow(embedding: number[] | undefined, nodeId: string): Float32Array {
    if (!embedding || embedding.length === 0) {
      throw new Error(`Missing embedding for node ${nodeId}`)
    }

    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch for node ${nodeId}: expected ${this.dimensions}, got ${embedding.length}`
      )
    }

    return new Float32Array(embedding)
  }

  private deserializeEmbedding(raw: unknown): number[] {
    if (raw == null) {
      throw new Error('Missing embedding payload in LibSQLVectorStore.deserializeEmbedding')
    }

    if (raw instanceof Float32Array) {
      return Array.from(raw)
    }

    if (raw instanceof ArrayBuffer) {
      return Array.from(new Float32Array(raw))
    }

    if (ArrayBuffer.isView(raw)) {
      const view = raw
      return Array.from(
        new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT)
      )
    }

    if (Array.isArray(raw)) {
      return raw.map((value) => Number(value))
    }

    throw new Error(
      `Unexpected embedding payload type in LibSQLVectorStore.deserializeEmbedding: ${JSON.stringify({
        type: typeof raw,
        constructorName: raw instanceof Object ? raw.constructor?.name : undefined
      })}`
    )
  }

  private parseJson<T>(
    value: T | string | null | undefined,
    fallback: T,
    context: { field: string; rowId?: string }
  ): T {
    if (value == null) {
      return fallback
    }

    if (typeof value !== 'string') {
      return value as T
    }

    try {
      return JSON.parse(value) as T
    } catch (error) {
      console.warn(`Failed to parse ${context.field} JSON for row ${context.rowId ?? '<unknown>'}`, toError(error))
      return fallback
    }
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

  private buildFilterClause(
    filter: MetadataFilter,
    alias: string
  ): {
    clause: string
    params: unknown[]
  } {
    const key = validateMetadataKey(filter.key)
    const metadataColumn = `${alias}.metadata`

    switch (filter.operator) {
      case FilterOperator.EQ:
        return {
          clause: `json_extract(${metadataColumn}, '$.${key}') = ?`,
          params: [filter.value]
        }
      case FilterOperator.GT:
        return {
          clause: `CAST(json_extract(${metadataColumn}, '$.${key}') AS REAL) > ?`,
          params: [filter.value]
        }
      case FilterOperator.LT:
        return {
          clause: `CAST(json_extract(${metadataColumn}, '$.${key}') AS REAL) < ?`,
          params: [filter.value]
        }
      case FilterOperator.GTE:
        return {
          clause: `CAST(json_extract(${metadataColumn}, '$.${key}') AS REAL) >= ?`,
          params: [filter.value]
        }
      case FilterOperator.LTE:
        return {
          clause: `CAST(json_extract(${metadataColumn}, '$.${key}') AS REAL) <= ?`,
          params: [filter.value]
        }
      case FilterOperator.NE:
        return {
          clause: `json_extract(${metadataColumn}, '$.${key}') != ?`,
          params: [filter.value]
        }
      case FilterOperator.IN:
        if (Array.isArray(filter.value)) {
          const placeholders = filter.value.map(() => '?').join(', ')
          return {
            clause: `json_extract(${metadataColumn}, '$.${key}') IN (${placeholders})`,
            params: filter.value
          }
        }
        return {
          clause: `json_extract(${metadataColumn}, '$.${key}') IN (?)`,
          params: [filter.value]
        }
      case FilterOperator.NIN:
        if (Array.isArray(filter.value)) {
          const placeholders = filter.value.map(() => '?').join(', ')
          return {
            clause: `json_extract(${metadataColumn}, '$.${key}') NOT IN (${placeholders})`,
            params: filter.value
          }
        }
        return {
          clause: `json_extract(${metadataColumn}, '$.${key}') NOT IN (?)`,
          params: [filter.value]
        }
      case FilterOperator.CONTAINS:
        return {
          clause: `json_extract(${metadataColumn}, '$.${key}') LIKE '%' || ? || '%'`,
          params: [filter.value]
        }
      case FilterOperator.IS_EMPTY:
        return {
          clause: `(json_extract(${metadataColumn}, '$.${key}') IS NULL OR json_extract(${metadataColumn}, '$.${key}') = '' OR json_extract(${metadataColumn}, '$.${key}') = '[]')`,
          params: []
        }
      case FilterOperator.TEXT_MATCH:
        return {
          clause: `LOWER(json_extract(${metadataColumn}, '$.${key}')) LIKE LOWER('%' || ? || '%')`,
          params: [filter.value]
        }
      default:
        return {
          clause: `json_extract(${metadataColumn}, '$.${key}') = ?`,
          params: [filter.value]
        }
    }
  }

  async query(query: VectorStoreQuery, _options?: object): Promise<VectorStoreQueryResult> {
    void _options
    await this.ensureInitialized()

    if (query.mode === 'bm25') {
      return this.bm25Search(query)
    } else if (query.mode === 'hybrid') {
      return this.hybridSearch(query)
    } else {
      return this.vectorSearch(query)
    }
  }

  private buildWhereClause(
    query: VectorStoreQuery,
    alias: string
  ): {
    where: string
    params: unknown[]
  } {
    const whereClauses: string[] = []
    const params: unknown[] = []

    if (this.collection.length) {
      whereClauses.push(`${alias}.collection = ?`)
      params.push(this.collection)
    }

    const filterClauses: string[] = []
    query.filters?.filters.forEach((filter: MetadataFilter) => {
      const { clause, params: filterParams } = this.buildFilterClause(filter, alias)
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
      throw new Error('queryEmbedding is required for vector search')
    }

    const { where, params } = this.buildWhereClause(query, 't')
    const vectorJson = `[${queryEmbedding.join(',')}]`

    const vectorStatement: InStatement = {
      sql: `
        SELECT t.*, vector_distance_cos(t.embeddings, vector32(?)) as distance
        FROM ${this.tableName} t
        ${where}
        ORDER BY distance
        LIMIT ${max}
      `,
      args: toInArgs([vectorJson, ...params])
    }

    const vectorResults = await this.clientInstance.execute(vectorStatement)
    return this.mapVectorResult(vectorResults.rows, max)
  }

  private async bm25Search(query: VectorStoreQuery): Promise<VectorStoreQueryResult> {
    const max = query.similarityTopK ?? 2

    if (!query.queryStr) {
      throw new Error('queryStr is required for BM25 mode')
    }

    const matchQuery = toFts5PhraseQuery(query.queryStr)

    if (!matchQuery) {
      return {
        nodes: [],
        similarities: [],
        ids: []
      }
    }

    const { where, params } = this.buildWhereClause(query, 'v')

    // Use FTS5 for BM25 search
    const ftsStatement: InStatement = {
      sql: `
        SELECT v.*, bm25(${this.tableName}_fts) as score
        FROM ${this.tableName}_fts fts
        JOIN ${this.tableName} v ON fts.rowid = v.rowid
        ${where}
        ${where ? 'AND' : 'WHERE'} ${this.tableName}_fts MATCH ?
        ORDER BY score
        LIMIT ${max}
      `,
      args: toInArgs([...params, matchQuery])
    }

    try {
      const results = await this.clientInstance.execute(ftsStatement)
      return this.mapBm25Result(results.rows, max)
    } catch (error) {
      console.warn('FTS5 search failed:', toError(error))
      throw new Error('BM25 search failed', { cause: toError(error) })
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
      const metadata = this.parseJson<Metadata>(
        row.metadata as Metadata | string | null | undefined,
        {},
        {
          field: 'metadata',
          rowId: String(row.id ?? '')
        }
      )
      const externalId = typeof row.external_id === 'string' && row.external_id.length > 0 ? row.external_id : undefined

      if (externalId && metadata.itemId === undefined) {
        metadata.itemId = externalId
      }

      return {
        node: new Document({
          id_: String(row.id),
          text: String(row.document || ''),
          metadata,
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
      const metadata = this.parseJson<Metadata>(
        row.metadata as Metadata | string | null | undefined,
        {},
        {
          field: 'metadata',
          rowId: String(row.id ?? '')
        }
      )
      const externalId = typeof row.external_id === 'string' && row.external_id.length > 0 ? row.external_id : undefined

      if (externalId && metadata.itemId === undefined) {
        metadata.itemId = externalId
      }

      return {
        node: new Document({
          id_: String(row.id),
          text: String(row.document || ''),
          metadata,
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
    void _persistPath
    return Promise.resolve()
  }

  async exists(refDocId: string): Promise<boolean> {
    await this.ensureInitialized()
    const collectionCriteria = this.collection.length ? 'AND collection = ?' : ''
    const sql = `SELECT 1 FROM ${this.tableName}
                 WHERE external_id = ? ${collectionCriteria} LIMIT 1`
    const params = this.collection.length ? [refDocId, this.collection] : [refDocId]
    const results = await this.clientInstance.execute({
      sql,
      args: toInArgs(params)
    })
    return results.rows.length > 0
  }
}
