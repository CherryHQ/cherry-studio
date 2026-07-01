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

/** What a {@link SqliteDriver.reclaim} pass did. */
export interface SqliteReclaimOutcome {
  /** Whether a VACUUM ran (only when the freelist crossed the size threshold). */
  vacuumed: boolean
  /** Bytes the VACUUM returned to the OS (0 when it was skipped). */
  reclaimedBytes: number
}

export interface SqliteDriver extends SqliteExecutor {
  /**
   * Run `fn` inside a single write transaction. Commits when `fn` resolves,
   * rolls back and rethrows when it rejects — preserving the atomic-replace
   * semantics rebuildMaterial relies on (no mixed old/new rows ever visible).
   */
  transaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T>
  /**
   * Return free space left by deletes to the OS: always checkpoint+truncate the
   * WAL, and VACUUM the main file when its freelist has grown large (both a big
   * fraction of the file AND past an absolute floor). Engine-level
   * checkpoint/threshold/VACUUM only — schema-specific maintenance stays out of the
   * driver: `preVacuumStatements` are caller-owned SQL (e.g. the knowledge FTS
   * 'optimize') run once, gated behind the same threshold and right before the
   * VACUUM, so a sub-threshold delete runs none of them. Serialized against this
   * driver's writes; the VACUUM blocks the calling thread for the whole-file
   * rewrite, which is why the threshold gates it to large deletes.
   */
  reclaim(preVacuumStatements?: readonly string[]): Promise<SqliteReclaimOutcome>
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
