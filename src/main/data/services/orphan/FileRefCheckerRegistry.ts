/**
 * FileRefCheckerRegistry — typed compile-safe registry for OrphanRefScanner.
 *
 * Each `FileRefSourceType` variant must have a `SourceTypeChecker` registered
 * here; the `Record<FileRefSourceType, SourceTypeChecker<...>>` shape forces
 * exhaustive coverage at compile time. Adding a new variant to
 * `allSourceTypes` (in `packages/shared/data/types/file/ref/index.ts`) without
 * adding a checker here = TypeScript build error.
 *
 * Phase status: Phase 1b.4 lands the typed surface + temp_session checker.
 * Subsequent variants (knowledge_item / chat_message / painting / note) ship
 * incrementally as their owning DB tables migrate to v2 (the stubs in this
 * file are conservative no-ops until then — see per-checker JSDoc).
 */

import { application } from '@application'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { FileRefSourceType } from '@shared/data/types/file'
import { inArray } from 'drizzle-orm'

export interface SourceTypeChecker<T extends FileRefSourceType = FileRefSourceType> {
  readonly sourceType: T
  /** Given a batch of sourceIds, return the subset that still exists. */
  readonly checkExists: (sourceIds: readonly string[]) => Promise<Set<string>>
}

export type OrphanCheckerRegistry = {
  readonly [K in FileRefSourceType]: SourceTypeChecker<K>
}

/**
 * Sessions are in-memory only — by the time the orphan scanner runs, no
 * `temp_session` sourceId from a previous run is "alive". Returning an empty
 * set instructs the scanner to treat every persisted `temp_session` ref as
 * orphaned, which is the correct behavior: temp_session refs should never
 * survive across runs.
 */
export const tempSessionChecker: SourceTypeChecker<'temp_session'> = {
  sourceType: 'temp_session',
  checkExists: async () => new Set()
}

export const knowledgeItemChecker: SourceTypeChecker<'knowledge_item'> = {
  sourceType: 'knowledge_item',
  checkExists: async (sourceIds) => {
    if (sourceIds.length === 0) return new Set()
    const db = application.get('DbService').getDb()
    const rows = await db
      .select({ id: knowledgeItemTable.id })
      .from(knowledgeItemTable)
      .where(inArray(knowledgeItemTable.id, sourceIds as string[]))
    return new Set(rows.map((r) => r.id))
  }
}
