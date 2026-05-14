/**
 * FileRefCheckerRegistry — typed compile-safe registry for OrphanRefScanner.
 *
 * Each `FileRefSourceType` variant must have a `SourceTypeChecker` registered
 * here; the `Record<FileRefSourceType, SourceTypeChecker<...>>` shape forces
 * exhaustive coverage at compile time. Adding a new variant to
 * `allSourceTypes` (in `packages/shared/data/types/file/ref/index.ts`) without
 * adding a checker here = TypeScript build error.
 *
 * Phase status: Phase 1b.4 lands the typed surface + temp_session and
 * knowledge_item checkers. Other business domains (chat_message / painting /
 * note) will be added when their owning DB tables migrate to v2 — each new
 * variant lands as a single PR introducing (a) the ref schema variant, (b)
 * the source-type tuple entry, AND (c) the checker below, so the three
 * surfaces stay in lockstep.
 */

import { application } from '@application'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import type { FileRefSourceType } from '@shared/data/types/file'
import { inArray } from 'drizzle-orm'

const logger = loggerService.withContext('file/orphan/checker-registry')

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
    logger.warn('orphan-sweep: SQLITE_BUSY, retrying once', { delayMs: BUSY_RETRY_DELAY_MS })
    await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAY_MS))
    try {
      return await op()
    } catch (retryErr) {
      // Always log: upstream catches only see a generic "checker threw"
      // without the "already retried" context, leaving no signal whether
      // the delay/retry count needs revisiting (BUSY persists) or whether a
      // separate failure mode surfaced after the BUSY-induced retry
      // (SQLITE_CORRUPT, SQLITE_IOERR, driver-level error, …). The code
      // field disambiguates both cases on the dashboard.
      const retryCode = (retryErr as { code?: string }).code
      logger.warn('orphan-sweep: retry attempt also failed; surfacing as failure', {
        delayMs: BUSY_RETRY_DELAY_MS,
        code: retryCode,
        err: retryErr
      })
      throw retryErr
    }
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
    knowledge_item: knowledgeItemChecker
  }
}

/** Process-wide singleton; tests use the factory for isolation. */
export const orphanCheckerRegistry: OrphanCheckerRegistry = createDefaultOrphanCheckerRegistry()
