/**
 * Engine-neutral SQLite driver port for the per-base knowledge index.
 *
 * knowledge-technical-design.md §5.6 calls for a thin driver so the index store
 * is written once and the storage engine stays swappable (better-sqlite3 +
 * sqlite-vec today) with zero user migration. Only the driver and VectorIndex
 * adapters are engine-specific; everything above them — the schema DDL
 * (schema.ts) and the store's queries — is shared, engine-neutral SQL.
 *
 * Synchronous by design, mirroring `DbService.withWriteTx` (src/main/data/db/DbService.ts):
 * better-sqlite3 is a single synchronous connection with no I/O wait, so an `async`
 * surface here would be pure libsql-era residue. It is not just cosmetic — a
 * transaction callback that actually awaits real async work would yield the event
 * loop while `BEGIN`..`COMMIT` is open, letting an unrelated read on the same
 * connection observe uncommitted rows. A synchronous `transaction<T>(fn: (tx) => T): T`
 * makes that categorically impossible: `fn` runs to completion in one JS turn.
 */

/** A value bindable to a statement parameter or read back from a result column. */
export type SqlValue = string | number | bigint | boolean | Uint8Array | ArrayBuffer | null

export interface SqlQueryResult {
  rows: Array<Record<string, SqlValue>>
  /** Rows inserted/updated/deleted by this statement (0 for a read). */
  changes: number
}

/** Runs a single statement. Implemented by both the driver and a transaction handle. */
export interface SqliteExecutor {
  execute(sql: string, args?: SqlValue[]): SqlQueryResult
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
   * Run `fn` inside a single write transaction. Commits when `fn` returns,
   * rolls back and rethrows when it throws — preserving the atomic-replace
   * semantics rebuildMaterial relies on (no mixed old/new rows ever visible).
   * `fn` MUST be synchronous — the better-sqlite3 backing implementation throws
   * if it returns a Promise (see BetterSqlite3Driver).
   */
  transaction<T>(fn: (tx: SqliteTransaction) => T): T
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
  reclaim(preVacuumStatements?: readonly string[]): SqliteReclaimOutcome
  /**
   * Whether {@link close} has been called. Lets a caller tell an operation that
   * failed because the store was closed mid-flight (concurrent base deletion or
   * shutdown) from a genuine query error, and surface a defined, retryable error
   * instead of leaking an opaque driver error.
   */
  isClosed(): boolean
  close(): void
}

/**
 * Engine-specific vector primitives. The store composes the brute-force scan
 * (`SELECT … ORDER BY dist LIMIT k`) over the plain-BLOB `embedding.vector_blob`
 * column from these; only the distance function and how the query vector binds
 * are engine-specific (sqlite-vec: `vec_distance_cosine` + a raw float32 blob).
 * No derived ANN index is used — brute-force first, see §5.6 / decision A1.
 */
export interface VectorIndex {
  /** SQL expression computing cosine distance between `column` and the bound query vector. */
  buildDistanceExpression(column: string): string
  /** Bind value for the single `?` placeholder produced by buildDistanceExpression. */
  bindQueryVector(values: number[]): SqlValue
}
