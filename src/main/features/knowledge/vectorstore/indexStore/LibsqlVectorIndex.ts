import type { SqlValue, VectorIndex } from './types'

/**
 * libsql VectorIndex adapter: cosine distance over the plain-BLOB embedding
 * column via `vector_distance_cos`, with the query vector parsed by `vector32()`
 * from a JSON-array string. Reading a plain BLOB column (rather than F32_BLOB)
 * is validated by the schema spike test — see knowledge-technical-design.md §5.6.
 */
export class LibsqlVectorIndex implements VectorIndex {
  buildDistanceExpression(column: string): string {
    // No dimension guard: a base's embedding dims are immutable, so the bound query
    // vector always matches `column`'s stored dims (see KnowledgeIndexStore.vectorSearch).
    return `vector_distance_cos(${column}, vector32(?))`
  }

  bindQueryVector(values: number[]): SqlValue {
    return `[${values.join(',')}]`
  }
}

export const libsqlVectorIndex = new LibsqlVectorIndex()
