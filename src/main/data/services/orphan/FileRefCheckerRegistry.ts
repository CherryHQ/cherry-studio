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

/**
 * Conservative no-op stub: returns every input id as alive, so the orphan
 * scanner deletes nothing for this sourceType. Replace with a real DB lookup
 * once the owning v2 table lands (Phase 2 batch migration).
 */
function makeStubChecker<T extends FileRefSourceType>(sourceType: T): SourceTypeChecker<T> {
  return {
    sourceType,
    checkExists: async (sourceIds) => new Set(sourceIds)
  }
}

export const chatMessageChecker: SourceTypeChecker<'chat_message'> = makeStubChecker('chat_message')
export const paintingChecker: SourceTypeChecker<'painting'> = makeStubChecker('painting')
export const noteChecker: SourceTypeChecker<'note'> = makeStubChecker('note')

/**
 * SQLite parameter cap is configurable but defaults to 999; keep batches well
 * under that for `inArray()` even with comparison overhead. Long-tenured users
 * accumulating thousands of knowledge items would otherwise blow up a single-
 * shot lookup.
 */
const SQLITE_INARRAY_CHUNK = 500

/** One transient-busy retry — SQLITE_BUSY at startup is realistic when other services are also writing. */
const BUSY_RETRY_DELAY_MS = 50

export const knowledgeItemChecker: SourceTypeChecker<'knowledge_item'> = {
  sourceType: 'knowledge_item',
  checkExists: async (sourceIds) => {
    if (sourceIds.length === 0) return new Set()
    const db = application.get('DbService').getDb()
    const alive = new Set<string>()
    for (let i = 0; i < sourceIds.length; i += SQLITE_INARRAY_CHUNK) {
      const chunk = sourceIds.slice(i, i + SQLITE_INARRAY_CHUNK)
      const rows = await runWithBusyRetry(() =>
        db.select({ id: knowledgeItemTable.id }).from(knowledgeItemTable).where(inArray(knowledgeItemTable.id, chunk))
      )
      for (const r of rows) alive.add(r.id)
    }
    return alive
  }
}

async function runWithBusyRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    if ((err as { code?: string }).code !== 'SQLITE_BUSY') throw err
    await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAY_MS))
    return op()
  }
}

/**
 * Build the default registry wiring every checker exported above. The
 * `Record<FileRefSourceType, ...>` return shape is exhaustive — adding a
 * variant to `FileRefSourceType` without listing it here is a TS error.
 */
export function createDefaultOrphanCheckerRegistry(): OrphanCheckerRegistry {
  return {
    temp_session: tempSessionChecker,
    chat_message: chatMessageChecker,
    knowledge_item: knowledgeItemChecker,
    painting: paintingChecker,
    note: noteChecker
  }
}

/** Process-wide singleton; tests use the factory for isolation. */
export const orphanCheckerRegistry: OrphanCheckerRegistry = createDefaultOrphanCheckerRegistry()
