/**
 * Engine-neutral SQLite driver port for the per-base knowledge index.
 *
 * knowledge-technical-design.md §5.6 calls for a thin driver so the index store
 * is written once and the storage engine can be swapped (libsql today,
 * better-sqlite3 + sqlite-vec later) with zero user migration. Only the driver
 * and VectorIndex adapters are engine-specific; everything above them — the
 * schema DDL (schema.ts) and the store's queries — is shared, engine-neutral SQL.
 */

/** A value bindable to a statement parameter or read back from a result column. */
export type SqlValue = string | number | bigint | boolean | Uint8Array | ArrayBuffer | null

export interface SqlQueryResult {
  rows: Array<Record<string, SqlValue>>
}

/** Runs a single statement. Implemented by both the driver and a transaction handle. */
export interface SqliteExecutor {
  execute(sql: string, args?: SqlValue[]): Promise<SqlQueryResult>
}

/** A handle valid only inside SqliteDriver.transaction(); same surface as the driver. */
export type SqliteTransaction = SqliteExecutor

export interface SqliteDriver extends SqliteExecutor {
  /**
   * Run `fn` inside a single write transaction. Commits when `fn` resolves,
   * rolls back and rethrows when it rejects — preserving the atomic-replace
   * semantics rebuildMaterial relies on (no mixed old/new rows ever visible).
   */
  transaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T>
  /**
   * Whether {@link close} has been called. Lets a caller tell an operation that
   * failed because the store was closed mid-flight (concurrent base deletion or
   * shutdown) from a genuine query error, and surface a defined, retryable error
   * instead of leaking an opaque driver error.
   */
  isClosed(): boolean
  close(): Promise<void>
}

/** One brute-force vector match: an embedding row and its distance to the query. */
export interface VectorMatch {
  embeddingTextHash: string
  distance: number
}

/**
 * Engine-specific vector primitives. The store composes the brute-force scan
 * (`SELECT … ORDER BY dist LIMIT k`) over the plain-BLOB `embedding.vector_blob`
 * column from these; only the distance function and how the query vector binds
 * differ across engines (libsql: vector_distance_cos + vector32(json-string);
 * sqlite-vec: vec_distance_cosine + raw blob). No derived ANN index is used —
 * brute-force first, see §5.6 / decision A1.
 */
export interface VectorIndex {
  /** SQL expression computing cosine distance between `column` and the bound query vector. */
  buildDistanceExpression(column: string): string
  /** Bind value for the single `?` placeholder produced by buildDistanceExpression. */
  bindQueryVector(values: number[]): SqlValue
}
