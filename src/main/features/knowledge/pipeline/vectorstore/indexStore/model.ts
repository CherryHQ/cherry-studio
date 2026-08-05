/**
 * Domain types for the per-base knowledge index store. These mirror the enum
 * CHECK constraints in schema.ts (§4) and shape the store's write contract.
 */

export type SearchUnitType = 'chunk'

/**
 * Retrieval mode for the index store's `search()` primitive. Independent of the
 * product-level KnowledgeBase policy (KnowledgeService.search() only ever passes
 * 'bm25' | 'hybrid' — see isCompletedVectorKnowledgeBase); 'vector' remains a
 * supported engine capability with its own test coverage.
 */
export type KnowledgeIndexSearchMode = 'vector' | 'bm25' | 'hybrid'

/** One retrieval unit (chunk/section) with its offsets into the material's content. */
export interface RebuildMaterialUnitInput {
  unitType: SearchUnitType
  unitIndex: number
  charStart: number
  charEnd: number
}

export interface RebuildMaterialEmbeddingInput {
  embeddingTextHash: string
  /**
   * The unit's embedding. `Float32Array` is accepted alongside `number[]` so the v1→v2 vector
   * migrator can stream decoded legacy vectors at half the resident size; both encode to the
   * same little-endian float32 blob.
   */
  vector: number[] | Float32Array
}

/**
 * Input to {@link KnowledgeIndexStore.rebuildMaterial}. Embeddings are
 * pre-computed by the caller (the indexing job calls AiService before the
 * synchronous write transaction). The body text of each unit is derived from
 * `content.text` sliced by the unit's offsets — see §5.3 — so the
 * `content.text.slice(charStart, charEnd) === body text` invariant holds by
 * construction. Supply a vector for every distinct embedding-text hash that is
 * not already stored; existing hashes are reused (decision A4).
 */
export interface RebuildMaterialInput {
  material: {
    relativePath: string
  }
  content: {
    text: string
  }
  units: RebuildMaterialUnitInput[]
  /**
   * Whether this base embeds its content. A vector base supplies `embeddings` and
   * its per-unit vector coverage is verified; a BM25-only base (no embedding
   * model) supplies none and skips that check — it is searched lexically.
   */
  usesEmbeddings: boolean
  /**
   * An `Iterable` (not just an array) so a caller can stream vectors in batches:
   * rebuildMaterial consumes it lazily inside its write transaction, and duplicate
   * hashes collapse in the store (INSERT OR IGNORE), so the v1→v2 vector migrator
   * never holds more than one read batch of a large item's vectors resident. The
   * iterable must be synchronous — the transaction cannot yield the event loop.
   */
  embeddings: Iterable<RebuildMaterialEmbeddingInput>
}

/**
 * A material identified by its Concept ID (the `relative_path`, OKF §2). The
 * relative path is UNIQUE per index, so this is the addressing primitive behind
 * the deep-read tool kb_read (read or grep mode); the caller re-validates the resolved
 * material against the visible knowledge_item before exposing any content.
 */
export interface KnowledgeMaterialRef {
  materialId: string
  relativePath: string
}

/** A retrieval unit read back from the index, with its body text. */
export interface KnowledgeSearchUnit {
  unitId: string
  materialId: string
  unitType: SearchUnitType
  unitIndex: number
  title: string | null
  charStart: number
  charEnd: number
  text: string
}

export interface KnowledgeIndexSearchInput {
  queryText: string
  /** Pre-computed query embedding. Required for 'hybrid'/'vector'; ignored for 'bm25'. */
  queryEmbedding?: number[]
  mode: KnowledgeIndexSearchMode
  topK: number
  /** RRF weight for the vector list in 'hybrid' (0 = pure BM25, 1 = pure vector). Default 0.5. */
  alpha?: number
}

/** One search hit. `score` is higher-is-better; its semantics depend on `mode`. */
export interface KnowledgeIndexSearchMatch {
  unitId: string
  materialId: string
  unitIndex: number
  text: string
  score: number
}
