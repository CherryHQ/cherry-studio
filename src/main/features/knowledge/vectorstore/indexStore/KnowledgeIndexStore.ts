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
 * Retrieval (BM25 + brute-force vector + RRF) applies no material-level filter
 * here; the knowledge_item-level filter (existence / lifecycle status) lives in
 * the caller (it reads the global app DB, not this per-base index).
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
    const contentHash = hashContentText(input.content.text)

    // Derive each unit's stable id and its body text + embedding hash from the
    // content offsets, so `content.text.slice(start, end) === body text` holds.
    const units = input.units.map((unit) => {
      // slice() clamps out-of-range offsets silently, which would persist a lying
      // charEnd alongside a shorter body — fail loud at write time instead of in
      // whatever later reads the offsets (charStart bounds are covered by the
      // schema CHECKs inside this same transaction).
      if (unit.charEnd > input.content.text.length) {
        throw new Error(
          `Knowledge index unit ${unit.unitIndex} of material ${materialId} has charEnd ${unit.charEnd} beyond the content length ${input.content.text.length}`
        )
      }
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
      await tx.execute(`INSERT OR IGNORE INTO content (content_hash, text, created_at) VALUES (?, ?, ?)`, [
        contentHash,
        input.content.text,
        now
      ])

      // 2. Upsert the material (current_content_hash set in step 7).
      await tx.execute(
        `INSERT INTO material (material_id, relative_path, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(material_id) DO UPDATE SET
           relative_path = excluded.relative_path,
           updated_at = excluded.updated_at`,
        [materialId, input.material.relativePath, now, now]
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
            // title and locator_json are reserved for the PR-C locator seam; no
            // producer populates them yet, so they are persisted as NULL.
            null,
            unit.charStart,
            unit.charEnd,
            null,
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

      // 6b. Coverage check: every unit's re-derived embedding hash must resolve to a
      //     vector, or roll the rebuild back. This catches two failure modes:
      //     (a) the caller hashes its chunk text while this store hashes the re-sliced
      //         body, so an offset/hash mismatch would leave a unit silently absent
      //         from vector search; and
      //     (b) the listExistingEmbeddingHashes race — the caller reads existing hashes
      //         outside the base lock, so a concurrent GC (step 8 / deleteMaterial) can
      //         drop a hash it reported present before this rebuild writes, and the job
      //         then skips re-embedding it. Failing loud rolls back; the job's retry
      //         re-reads (the hash is now absent), re-embeds it, and converges.
      await this.assertEmbeddingCoverage(tx, materialId, [...new Set(units.map((unit) => unit.embeddingTextHash))])

      // 7. Mark the material's current content (failure/lifecycle state is the
      //    authority of knowledge_item, not this derived index).
      await tx.execute(`UPDATE material SET current_content_hash = ?, updated_at = ? WHERE material_id = ?`, [
        contentHash,
        now,
        materialId
      ])

      // 8. Sweep rows this rebuild orphaned (old units' embeddings, old content the
      //    new revision no longer references). Safe under the base mutation lock.
      await this.collectIndexGarbage(tx)
    })
  }

  /**
   * Delete a material and everything derived from it. Removing the material row
   * cascades to its `search_unit`; the units' body `search_text` is deleted
   * explicitly first (no FK), which also clears the FTS index via the delete
   * trigger. {@link collectIndexGarbage} then sweeps the `embedding` and `content`
   * rows this delete orphaned, in the same transaction.
   */
  async deleteMaterial(materialId: string): Promise<void> {
    await this.driver.transaction(async (tx) => {
      await this.deleteMaterialSearchText(tx, materialId)
      await tx.execute(`DELETE FROM material WHERE material_id = ?`, [materialId])
      await this.collectIndexGarbage(tx)
    })
  }

  /**
   * Sweep rows orphaned by a material delete/rebuild, inside the same write
   * transaction (so under the base mutation lock the callers already hold). Runs
   * after the material change, so the just-written rows are visible and never
   * collected:
   *  - `embedding`: no `search_text` references its hash (no FK points at it).
   *  - `content`: no `material.current_content_hash` (FK NO ACTION) and no
   *    `search_unit.content_hash` (FK CASCADE) reference it — both referrers are
   *    excluded, so the delete never violates either constraint.
   */
  private async collectIndexGarbage(tx: SqliteTransaction): Promise<void> {
    await tx.execute(
      `DELETE FROM embedding
       WHERE NOT EXISTS (SELECT 1 FROM search_text st WHERE st.embedding_text_hash = embedding.embedding_text_hash)`
    )
    await tx.execute(
      `DELETE FROM content
       WHERE NOT EXISTS (SELECT 1 FROM material m WHERE m.current_content_hash = content.content_hash)
         AND NOT EXISTS (SELECT 1 FROM search_unit su WHERE su.content_hash = content.content_hash)`
    )
  }

  /**
   * Of the given embedding-text hashes, return those already stored. Lets the
   * indexing job skip re-embedding unchanged chunks (decision A4): only the
   * missing hashes need the paid embedding API, since a stored vector is reused
   * for any unit whose body hashes to it.
   *
   * The job reads this outside the base mutation lock, then writes the rebuild
   * under it. {@link collectIndexGarbage} (run under that lock by rebuild/delete)
   * can drop a hash reported here as present, between this read and the rebuild
   * write. rebuildMaterial closes that race: {@link assertEmbeddingCoverage} rolls
   * the rebuild back if any new unit's hash lost its embedding, so the job retries,
   * re-reads (the hash is now absent) and re-embeds it. A stale "present" therefore
   * self-corrects rather than leaving a unit silently absent from vector search.
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
   * incompatible cosine/BM25 score ranges don't need normalizing). The body
   * text of a unit is the search source for both lanes
   * (knowledge-technical-design.md §6).
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
    // `WHERE dist IS NOT NULL` drops degenerate (zero-norm) vectors: cosine distance is
    // undefined for them, and SQLite coerces that NULL/NaN to NULL — which would otherwise
    // sort first under `ORDER BY dist` and score `1 - Number(null) = 1`, outranking real hits.
    const result = await this.driver.execute(
      `SELECT su.unit_id, su.material_id, su.unit_index, st.text AS body,
              ${this.vectorIndex.buildDistanceExpression('e.vector_blob')} AS dist
       FROM embedding e
       JOIN search_text st
         ON st.embedding_text_hash = e.embedding_text_hash AND st.target_type = 'search_unit' AND st.kind = 'body'
       JOIN search_unit su ON su.unit_id = st.target_id
       WHERE dist IS NOT NULL
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
       WHERE search_text_fts MATCH ?
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
       WHERE st.target_type = 'search_unit' AND st.kind = 'body'
         AND ${likeClauses}
       ORDER BY len ASC
       LIMIT ?`,
      args
    )
    return result.rows.map((row) => toMatch(row, -Number(row.len)))
  }

  /** Throw (rolling back the surrounding rebuild) if any unit hash has no embedding row. */
  private async assertEmbeddingCoverage(tx: SqliteTransaction, materialId: string, hashes: string[]): Promise<void> {
    const missing = new Set(hashes)
    for (let i = 0; i < hashes.length; i += EMBEDDING_HASH_QUERY_BATCH) {
      const batch = hashes.slice(i, i + EMBEDDING_HASH_QUERY_BATCH)
      const placeholders = batch.map(() => '?').join(', ')
      const result = await tx.execute(
        `SELECT embedding_text_hash FROM embedding WHERE embedding_text_hash IN (${placeholders})`,
        batch
      )
      for (const row of result.rows) {
        missing.delete(row.embedding_text_hash as string)
      }
    }
    if (missing.size > 0) {
      throw new Error(
        `Knowledge index rebuild for material ${materialId} left ${missing.size} unit embedding hash(es) without a vector (first: ${[...missing][0]})`
      )
    }
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
  // Every lane selects `st.text AS body` through an INNER JOIN on a NOT NULL
  // column, so a missing body is store corruption — fail loudly like
  // listMaterialUnits does instead of fabricating an empty result.
  if (row.body == null) {
    throw new Error(`Knowledge index store is missing the body text for unit ${row.unit_id as string}`)
  }
  return {
    unitId: row.unit_id as string,
    materialId: row.material_id as string,
    unitIndex: Number(row.unit_index),
    text: row.body as string,
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
