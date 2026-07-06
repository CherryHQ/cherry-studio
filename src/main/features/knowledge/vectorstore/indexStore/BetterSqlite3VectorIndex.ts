import type { SqlValue, VectorIndex } from './types'
import { encodeVectorBlob } from './vectorBlob'

/**
 * sqlite-vec VectorIndex adapter: cosine distance over the plain-BLOB embedding
 * column via the `vec_distance_cosine` scalar function, with the query vector
 * bound as raw little-endian float32 bytes (the same encoding stored in
 * `embedding.vector_blob`, so no per-engine re-encode). sqlite-vec returns NaN
 * for a zero-norm vector, which SQLite coerces to NULL — KnowledgeIndexStore's
 * `WHERE dist IS NOT NULL` then drops those degenerate rows. See
 * knowledge-technical-design.md §5.6.
 */
export class BetterSqlite3VectorIndex implements VectorIndex {
  buildDistanceExpression(column: string): string {
    // No dimension guard: a base's embedding dims are immutable, so the bound query
    // vector always matches `column`'s stored dims (see KnowledgeIndexStore.vectorSearch).
    return `vec_distance_cosine(${column}, ?)`
  }

  bindQueryVector(values: number[]): SqlValue {
    // Raw LE float32 bytes. The driver's toBindable wraps this Uint8Array as a
    // Buffer (better-sqlite3 only binds Buffers for BLOB params).
    return encodeVectorBlob(values)
  }
}

export const betterSqlite3VectorIndex = new BetterSqlite3VectorIndex()
