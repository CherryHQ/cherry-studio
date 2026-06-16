/**
 * Domain types for the per-base knowledge index store. These mirror the enum
 * CHECK constraints in schema.ts (§4) and shape the store's write contract.
 */

import type { KnowledgeSearchMode } from '@shared/data/types/knowledge'

export type SearchUnitType = 'chunk'

/** One retrieval unit (chunk/section) with its offsets into the material's content. */
export interface RebuildMaterialUnitInput {
  unitType: SearchUnitType
  unitIndex: number
  charStart: number
  charEnd: number
  title?: string
  locator?: unknown
}

export interface RebuildMaterialEmbeddingInput {
  embeddingTextHash: string
  vector: number[]
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
  embeddings: RebuildMaterialEmbeddingInput[]
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
  mode: KnowledgeSearchMode
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
