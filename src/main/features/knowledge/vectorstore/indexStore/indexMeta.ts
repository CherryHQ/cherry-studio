import { KNOWLEDGE_INDEX_SCHEMA_VERSION } from './schema'
import type { SqliteExecutor } from './types'

/**
 * Contract versions stamped into the single `index_meta` row when a base's
 * `index.sqlite` is first opened. They are facts about the contract that
 * produced the stored data; a future PR compares them against the running
 * contract to decide whether a rebuild is needed (no consumer reads them yet).
 */
export const NORMALIZATION_VERSION = 1
export const CHUNKER_VERSION = 1
export const IGNORE_RULES_VERSION = 1

export interface IndexMetaInput {
  baseId: string
  embeddingModelId: string
  dimensions: number
  /** {@link hashChunkerConfig} of the base's chunk size / overlap. */
  chunkerConfigHash: string
}

/**
 * Ensure the index database's `index_meta` row exists and belongs to this base.
 *
 * On first open it writes the single (`id = 1`) row with the schema version,
 * base id and contract snapshot; on a re-open it leaves the existing row intact
 * (`INSERT OR IGNORE`). Either way it then verifies the stored `base_id` equals
 * the expected one and rejects otherwise, so a mismatched or swapped
 * `index.sqlite` (another base's index, or a corrupted/empty file) is refused
 * rather than silently mounted (knowledge-technical-design.md §4.1).
 */
export async function ensureIndexMeta(executor: SqliteExecutor, input: IndexMetaInput): Promise<void> {
  const now = Date.now()
  await executor.execute(
    `INSERT OR IGNORE INTO index_meta
       (id, schema_version, base_id, created_at, updated_at, normalization_version,
        chunker_version, chunker_config_hash, ignore_rules_version,
        embedding_model_id_snapshot, dimensions_snapshot)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      KNOWLEDGE_INDEX_SCHEMA_VERSION,
      input.baseId,
      now,
      now,
      NORMALIZATION_VERSION,
      CHUNKER_VERSION,
      input.chunkerConfigHash,
      IGNORE_RULES_VERSION,
      input.embeddingModelId,
      input.dimensions
    ]
  )

  const stored = await executor.execute(`SELECT base_id FROM index_meta WHERE id = 1`)
  const storedBaseId = stored.rows[0]?.base_id as string | undefined
  if (storedBaseId !== input.baseId) {
    throw new Error(
      `index.sqlite belongs to a different base: expected base_id '${input.baseId}', found '${storedBaseId ?? '(none)'}'`
    )
  }
}
