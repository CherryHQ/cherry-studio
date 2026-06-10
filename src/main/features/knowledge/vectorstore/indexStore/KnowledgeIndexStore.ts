import { extractFtsTokens, needsLikeFallback, toFtsLikePattern, toFtsMatchQuery } from './ftsQuery'
import { computeSearchTextId, computeUnitId, hashContentText, hashEmbeddingText } from './hashing'
import type {
  KnowledgeIndexSearchInput,
  KnowledgeIndexSearchMatch,
  KnowledgeSearchUnit,
  RebuildMaterialInput
} from './model'
import type { SqliteDriver, SqliteTransaction, SqlValue, VectorIndex } from './types'
import { encodeVectorBlob } from './vectorBlob'

/** RRF constant (1-indexed rank), matching the legacy hybrid fusion. */
const RRF_K = 60

/** Max bound parameters per `listExistingEmbeddingHashes` query (SQLite's limit is ~999). */
const EMBEDDING_HASH_QUERY_BATCH = 500

/**
 * Engine-neutral store over a per-base `index.sqlite`. Written once; the storage
 * engine is swapped by injecting a different {@link SqliteDriver} (libsql today,
 * better-sqlite3 + sqlite-vec later) — see knowledge-technical-design.md §5.6.
 *
 * Retrieval (BM25 + brute-force vector + RRF) only filters by material state
 * (status / index_policy) here; the knowledge_item-level filter lives in the
 * caller (it reads the global app DB, not this per-base index).
 */
export class KnowledgeIndexStore {
  constructor(
    private readonly driver: SqliteDriver,
    private readonly vectorIndex: VectorIndex
  ) {}

  /**
   * Atomically replace everything indexed for `materialId`. Runs in one write
   * transaction so a crash or error can never leave old and new units mixed, and
   * an insert failure rolls back without destroying the prior index (§5.2).
   */
  async rebuildMaterial(materialId: string, input: RebuildMaterialInput): Promise<void> {
    const now = Date.now()
    const contentHash = hashContentText(input.content.text, input.content.normalizationVersion)

    // Derive each unit's stable id and its body text + embedding hash from the
    // content offsets, so `content.text.slice(start, end) === body text` holds.
    const units = input.units.map((unit) => {
      const bodyText = input.content.text.slice(unit.charStart, unit.charEnd)
      return {
        ...unit,
        bodyText,
        embeddingTextHash: hashEmbeddingText(bodyText),
        unitId: computeUnitId(materialId, contentHash, unit.unitType, unit.unitIndex, unit.charStart, unit.charEnd)
      }
    })

    await this.driver.transaction(async (tx) => {
      // 1. Content is immutable by hash — keep the existing row if present.
      await tx.execute(
        `INSERT OR IGNORE INTO content (content_hash, text, text_format, normalization_version, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [contentHash, input.content.text, input.content.textFormat, input.content.normalizationVersion, now]
      )

      // 2. Upsert the material (current_content_hash / last_indexed_at set in step 7).
      await tx.execute(
        `INSERT INTO material
           (material_id, relative_path, status, origin, index_policy, title, file_ext, mime_type, size_bytes, mtime_ms, last_seen_at, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(material_id) DO UPDATE SET
           relative_path = excluded.relative_path,
           status = 'active',
           missing_since = NULL,
           origin = excluded.origin,
           index_policy = excluded.index_policy,
           title = excluded.title,
           file_ext = excluded.file_ext,
           mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes,
           mtime_ms = excluded.mtime_ms,
           last_seen_at = excluded.last_seen_at,
           updated_at = excluded.updated_at`,
        [
          materialId,
          input.material.relativePath,
          input.material.origin,
          input.material.indexPolicy,
          input.material.title ?? null,
          input.material.fileExt ?? null,
          input.material.mimeType ?? null,
          input.material.sizeBytes ?? null,
          input.material.mtimeMs ?? null,
          now,
          now,
          now
        ]
      )

      // 3. Drop the material's old units and their search_text. search_text has no
      //    FK to search_unit (its target_id is polymorphic), so it is deleted
      //    explicitly while search_unit still exists to resolve the targets; the
      //    FTS index is kept in sync by the search_text delete trigger.
      await this.deleteMaterialSearchText(tx, materialId)
      await tx.execute(`DELETE FROM search_unit WHERE material_id = ?`, [materialId])

      // 4 & 5. Insert new units and their body search_text (FTS synced by trigger).
      for (const unit of units) {
        await tx.execute(
          `INSERT INTO search_unit
             (unit_id, material_id, content_hash, unit_type, unit_index, title, char_start, char_end, locator_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            unit.unitId,
            materialId,
            contentHash,
            unit.unitType,
            unit.unitIndex,
            unit.title ?? null,
            unit.charStart,
            unit.charEnd,
            unit.locator === undefined ? null : JSON.stringify(unit.locator),
            now
          ]
        )
        await tx.execute(
          `INSERT INTO search_text (search_text_id, target_type, target_id, kind, text, embedding_text_hash, created_at)
           VALUES (?, 'search_unit', ?, 'body', ?, ?, ?)`,
          [
            computeSearchTextId('search_unit', unit.unitId, 'body'),
            unit.unitId,
            unit.bodyText,
            unit.embeddingTextHash,
            now
          ]
        )
      }

      // 6. Insert missing embeddings; existing hashes are reused (decision A4).
      for (const embedding of input.embeddings) {
        await tx.execute(
          `INSERT OR IGNORE INTO embedding (embedding_text_hash, vector_blob, created_at) VALUES (?, ?, ?)`,
          [embedding.embeddingTextHash, encodeVectorBlob(embedding.vector), now]
        )
      }

      // 7. Mark the material indexed and clear any prior failure summary.
      await tx.execute(
        `UPDATE material
         SET current_content_hash = ?, last_indexed_at = ?, last_error_stage = NULL, last_error_code = NULL,
             last_error_message = NULL, last_failed_at = NULL, updated_at = ?
         WHERE material_id = ?`,
        [contentHash, now, now, materialId]
      )
    })
  }

  /**
   * Delete a material and everything derived from it. Removing the material row
   * cascades to its `search_unit` (and `content_index_entry`); the units' body
   * `search_text` is deleted explicitly first (no FK), which also clears the FTS
   * index via the delete trigger. Orphaned `embedding` rows are left for GC (§10).
   */
  async deleteMaterial(materialId: string): Promise<void> {
    await this.driver.transaction(async (tx) => {
      await this.deleteMaterialSearchText(tx, materialId)
      await tx.execute(`DELETE FROM material WHERE material_id = ?`, [materialId])
    })
  }

  /**
   * Of the given embedding-text hashes, return those already stored. Lets the
   * indexing job skip re-embedding unchanged chunks (decision A4): only the
   * missing hashes need the paid embedding API, since a stored vector is reused
   * for any unit whose body hashes to it.
   *
   * The job reads this outside the base mutation lock, then writes the rebuild
   * under it. That is safe only because nothing deletes `embedding` rows today
   * (orphans are left for a not-yet-implemented GC, §10). Whoever adds that GC
   * MUST run it under the base mutation lock — otherwise it could drop a hash
   * reported here as existing between this read and the rebuild write, leaving a
   * unit with no vector (silently absent from vector search).
   */
  async listExistingEmbeddingHashes(hashes: string[]): Promise<Set<string>> {
    const existing = new Set<string>()
    // Chunk to stay well under SQLite's bound-parameter limit for large materials.
    for (let i = 0; i < hashes.length; i += EMBEDDING_HASH_QUERY_BATCH) {
      const batch = hashes.slice(i, i + EMBEDDING_HASH_QUERY_BATCH)
      const placeholders = batch.map(() => '?').join(', ')
      const result = await this.driver.execute(
        `SELECT embedding_text_hash FROM embedding WHERE embedding_text_hash IN (${placeholders})`,
        batch
      )
      for (const row of result.rows) {
        existing.add(row.embedding_text_hash as string)
      }
    }
    return existing
  }

  /** Read back a material's units (with body text), ordered by unit index. */
  async listMaterialUnits(materialId: string): Promise<KnowledgeSearchUnit[]> {
    const result = await this.driver.execute(
      `SELECT su.unit_id, su.material_id, su.unit_type, su.unit_index, su.title, su.char_start, su.char_end, st.text AS body
       FROM search_unit su
       LEFT JOIN search_text st
         ON st.target_type = 'search_unit' AND st.target_id = su.unit_id AND st.kind = 'body'
       WHERE su.material_id = ?
       ORDER BY su.unit_index`,
      [materialId]
    )

    return result.rows.map((row) => {
      // rebuildMaterial writes a unit and its body row in one transaction, so a
      // missing body is store corruption. Fail loudly: the search lanes INNER JOIN
      // (silently excluding the unit), and fabricating '' here would give the same
      // damage a third symptom — an existing-but-empty chunk in the UI.
      if (row.body == null) {
        throw new Error(`Knowledge index store is missing the body text for unit ${row.unit_id as string}`)
      }
      return {
        unitId: row.unit_id as string,
        materialId: row.material_id as string,
        unitType: row.unit_type as KnowledgeSearchUnit['unitType'],
        unitIndex: Number(row.unit_index),
        title: (row.title as string | null) ?? null,
        charStart: Number(row.char_start),
        charEnd: Number(row.char_end),
        text: row.body as string
      }
    })
  }

  /**
   * Retrieve units for a query. 'vector' and 'bm25' return their single ranked
   * list; 'hybrid' fuses both with Reciprocal Rank Fusion (rank-based, so the
   * incompatible cosine/BM25 score ranges don't need normalizing). Only
   * active, indexable materials are returned. The body text of a unit is the
   * search source for both lanes (knowledge-technical-design.md §6).
   */
  async search(input: KnowledgeIndexSearchInput): Promise<KnowledgeIndexSearchMatch[]> {
    if (input.mode === 'bm25') {
      return this.bm25Search(input.queryText, input.topK)
    }
    if (input.mode === 'vector') {
      return this.vectorSearch(this.requireQueryEmbedding(input), input.topK)
    }

    const alpha = input.alpha ?? 0.5
    const prefetch = input.topK * 5
    const [vector, bm25] = await Promise.all([
      this.vectorSearch(this.requireQueryEmbedding(input), prefetch),
      this.bm25Search(input.queryText, prefetch)
    ])
    return fuseWithRrf(vector, bm25, alpha, input.topK)
  }

  async close(): Promise<void> {
    await this.driver.close()
  }

  /** Whether the backing driver has been closed (see {@link SqliteDriver.isClosed}). */
  isClosed(): boolean {
    return this.driver.isClosed()
  }

  private requireQueryEmbedding(input: KnowledgeIndexSearchInput): number[] {
    if (!input.queryEmbedding?.length) {
      throw new Error(`A query embedding is required for '${input.mode}' search`)
    }
    return input.queryEmbedding
  }

  /** Brute-force cosine scan over the plain-BLOB embedding column (no ANN index). */
  private async vectorSearch(queryEmbedding: number[], topK: number): Promise<KnowledgeIndexSearchMatch[]> {
    // Invariant, not a check: a base's embedding model and dimensions are immutable
    // (changing them means migrating to a new base), so `queryEmbedding` and every
    // stored `vector_blob` share one dimension — cosine never compares mismatched lengths.
    const result = await this.driver.execute(
      `SELECT su.unit_id, su.material_id, su.unit_index, st.text AS body,
              ${this.vectorIndex.buildDistanceExpression('e.vector_blob')} AS dist
       FROM embedding e
       JOIN search_text st
         ON st.embedding_text_hash = e.embedding_text_hash AND st.target_type = 'search_unit' AND st.kind = 'body'
       JOIN search_unit su ON su.unit_id = st.target_id
       JOIN material m ON m.material_id = su.material_id
       WHERE m.status = 'active' AND m.index_policy = 'index'
       ORDER BY dist
       LIMIT ?`,
      [this.vectorIndex.bindQueryVector(queryEmbedding), topK]
    )
    return result.rows.map((row) => toMatch(row, 1 - Number(row.dist)))
  }

  private async bm25Search(queryText: string, topK: number): Promise<KnowledgeIndexSearchMatch[]> {
    // Short tokens (notably 1–2 char CJK words) produce no trigram, so MATCH would
    // silently return nothing — route those queries to the LIKE fallback instead.
    if (needsLikeFallback(queryText)) {
      return this.bm25LikeSearch(extractFtsTokens(queryText), topK)
    }
    const matchQuery = toFtsMatchQuery(queryText)
    if (!matchQuery) {
      return []
    }
    const result = await this.driver.execute(
      `SELECT su.unit_id, su.material_id, su.unit_index, st.text AS body, bm25(search_text_fts) AS score
       FROM search_text_fts
       JOIN search_text st
         ON st.rowid = search_text_fts.rowid AND st.target_type = 'search_unit' AND st.kind = 'body'
       JOIN search_unit su ON su.unit_id = st.target_id
       JOIN material m ON m.material_id = su.material_id
       WHERE search_text_fts MATCH ? AND m.status = 'active' AND m.index_policy = 'index'
       ORDER BY score
       LIMIT ?`,
      [matchQuery, topK]
    )
    // bm25() is lower-is-better; negate so the returned score is higher-is-better.
    return result.rows.map((row) => toMatch(row, -Number(row.score)))
  }

  /**
   * Substring fallback for queries the trigram FTS can't index (decision A3).
   * ANDs a `LIKE '%token%'` per token over the same body text. There is no bm25
   * relevance here, so rank by ascending body length — a denser match (a shorter
   * unit fully about the term) ranks first — and expose it as a higher-is-better
   * score so it fuses sanely with the vector lane in hybrid mode.
   */
  private async bm25LikeSearch(tokens: string[], topK: number): Promise<KnowledgeIndexSearchMatch[]> {
    if (tokens.length === 0) {
      return []
    }
    const likeClauses = tokens.map(() => `st.text LIKE ? ESCAPE '\\'`).join(' AND ')
    const args: SqlValue[] = [...tokens.map(toFtsLikePattern), topK]
    const result = await this.driver.execute(
      `SELECT su.unit_id, su.material_id, su.unit_index, st.text AS body, length(st.text) AS len
       FROM search_text st
       JOIN search_unit su ON su.unit_id = st.target_id
       JOIN material m ON m.material_id = su.material_id
       WHERE st.target_type = 'search_unit' AND st.kind = 'body'
         AND ${likeClauses}
         AND m.status = 'active' AND m.index_policy = 'index'
       ORDER BY len ASC
       LIMIT ?`,
      args
    )
    return result.rows.map((row) => toMatch(row, -Number(row.len)))
  }

  private async deleteMaterialSearchText(tx: SqliteTransaction, materialId: string): Promise<void> {
    await tx.execute(
      `DELETE FROM search_text
       WHERE target_type = 'search_unit'
         AND target_id IN (SELECT unit_id FROM search_unit WHERE material_id = ?)`,
      [materialId]
    )
  }
}

/** Shape a single result row (shared by both lanes) with a precomputed score. */
function toMatch(row: Record<string, SqlValue>, score: number): KnowledgeIndexSearchMatch {
  return {
    unitId: row.unit_id as string,
    materialId: row.material_id as string,
    unitIndex: Number(row.unit_index),
    text: (row.body as string | null) ?? '',
    score
  }
}

/**
 * Reciprocal Rank Fusion of the two ranked lanes. Each lane contributes
 * `weight / (RRF_K + rank)` (1-indexed rank, weighted by `alpha` for vector and
 * `1 - alpha` for BM25); a unit's combined score is the sum over the lanes it
 * appears in. Rank-based fusion sidesteps the incompatible cosine/BM25 score
 * scales. Returns the top-`topK` units, score descending.
 */
function fuseWithRrf(
  vector: KnowledgeIndexSearchMatch[],
  bm25: KnowledgeIndexSearchMatch[],
  alpha: number,
  topK: number
): KnowledgeIndexSearchMatch[] {
  const fused = new Map<string, KnowledgeIndexSearchMatch>()

  const accumulate = (matches: KnowledgeIndexSearchMatch[], weight: number) => {
    matches.forEach((match, index) => {
      const contribution = weight / (RRF_K + index + 1)
      const existing = fused.get(match.unitId)
      if (existing) {
        existing.score += contribution
      } else {
        fused.set(match.unitId, { ...match, score: contribution })
      }
    })
  }

  accumulate(vector, alpha)
  accumulate(bm25, 1 - alpha)

  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, topK)
}
