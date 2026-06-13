import { KNOWLEDGE_INDEX_SCHEMA_VERSION } from './schema'
import type { SqliteExecutor } from './types'

export interface IndexMetaInput {
  baseId: string
}

/**
 * Ensure the index database's `meta` row exists and belongs to this base.
 *
 * On first open it writes the single (`id = 1`) identity row with the schema
 * version and base id; on a re-open it leaves the existing row intact
 * (`INSERT OR IGNORE`). Either way it then verifies the stored `base_id` equals
 * the expected one and rejects otherwise, so an `index.sqlite` swapped in from
 * another base is refused rather than silently mounted
 * (knowledge-technical-design.md §4.1).
 *
 * That base_id mismatch is the ONLY refusal here. A blank or recreated file has
 * no row to mismatch — it is stamped as a fresh empty index and mounts cleanly;
 * the store-open path logs an error when that happens under a base that already
 * has completed items (see KnowledgeVectorStoreService).
 */
export async function ensureIndexMeta(executor: SqliteExecutor, input: IndexMetaInput): Promise<void> {
  const now = Date.now()
  await executor.execute(
    `INSERT OR IGNORE INTO meta (id, schema_version, base_id, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?)`,
    [KNOWLEDGE_INDEX_SCHEMA_VERSION, input.baseId, now, now]
  )

  const stored = await executor.execute(`SELECT base_id FROM meta WHERE id = 1`)
  const storedBaseId = stored.rows[0]?.base_id as string | undefined
  if (storedBaseId !== input.baseId) {
    throw new Error(
      `index.sqlite belongs to a different base: expected base_id '${input.baseId}', found '${storedBaseId ?? '(none)'}'`
    )
  }
}

/**
 * Table name of the legacy single-table vector layout — written by the removed
 * vendored `@vectorstores/libsql` package and, until PR B, still written by
 * `KnowledgeVectorMigrator` into the same `index.sqlite` the runtime opens. The
 * runtime store never reads it, so its presence means the file holds vectors
 * that are invisible to search.
 */
const LEGACY_VECTOR_TABLE_NAME = 'libsql_vectorstores_embedding'

/** Whether the opened index database still contains the legacy single-table layout. */
export async function hasLegacyVectorStoreTable(executor: SqliteExecutor): Promise<boolean> {
  const result = await executor.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, [
    LEGACY_VECTOR_TABLE_NAME
  ])
  return result.rows.length > 0
}

/** Whether the index database holds at least one material row (store-open diagnostics probe). */
export async function hasAnyMaterial(executor: SqliteExecutor): Promise<boolean> {
  const result = await executor.execute(`SELECT 1 FROM material LIMIT 1`)
  return result.rows.length > 0
}
