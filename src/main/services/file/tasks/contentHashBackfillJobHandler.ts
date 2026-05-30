import { fileEntryService } from '@data/services/FileEntryService'
import type { JobHandler } from '@main/core/job/types'
import { hash as fsHash } from '@main/utils/file/fs'

import { resolvePhysicalPath } from '../utils/pathResolver'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    /**
     * Backfill `contentHash` for internal entries that predate the content-dedup
     * feature (v1-migrated / pre-feature inserts), which carry `contentHash = null`.
     * Empty payload — the job drains every NULL-contentHash internal row.
     */
    'file.contenthash-backfill': Record<string, never>
  }
}

/** Rows scanned per keyset page. Bounded so the DB round-trips stay small. */
const BATCH_SIZE = 200

/**
 * Backfill the dedup-detection `contentHash` for internal entries created before
 * this feature (v1 migration / pre-feature inserts), which carry `contentHash =
 * null`. New entries always get their hash on create (§7.2); this fills the gap
 * for the existing set so legacy files also participate in dedup detection.
 *
 * **Drain strategy — keyset pagination over `id`** (UUID v7, lexicographically
 * time-ordered): each page queries `content_hash IS NULL AND id > cursor`, so an
 * entry that fails to hash (missing/orphan blob → ENOENT) stays NULL but sits
 * behind the cursor and is NOT re-scanned within the same run — otherwise the
 * NULL set would never shrink and the loop would spin. Such rows are left for the
 * orphan sweep (§10) or a future run. Per-entry hash failures never fail the
 * whole job, but are classified by errno so a disk/permission regression is not
 * buried as a benign orphan: ENOENT/ENOTDIR (blob genuinely gone) is the expected
 * quiet case (`skippedOrphan`, warn-logged); any other code (EACCES/EBUSY/EMFILE/
 * EIO/EISDIR — the blob may be hashable) is surfaced as an `error`-level
 * `failedIo` and the row is left NULL for a future run. Includes trashed entries
 * (their blob is preserved, so they are hashable and become reuse targets if
 * restored).
 *
 * **Lifecycle** — `recovery: 'singleton'` + `defaultConcurrency: 1`: at most one
 * backfill runs at a time. A crash-interrupted run is simply re-triggered on the
 * next startup by `FileManager.onAllReady` (the `content_hash IS NULL` set is
 * itself the resumable work queue), and re-running is idempotent — it only
 * touches rows that are still NULL.
 */
export const contentHashBackfillJobHandler: JobHandler<Record<string, never>> = {
  recovery: 'singleton',
  defaultConcurrency: 1,
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const total = await fileEntryService.countInternalMissingContentHash()
    if (total === 0) {
      ctx.reportProgress(100, { stage: 'done', total: 0 })
      return { total: 0, hashed: 0, skippedOrphan: 0, failedIo: 0 }
    }

    let cursor: string | null = null
    let processed = 0
    let hashed = 0
    let skippedOrphan = 0
    let failedIo = 0

    for (;;) {
      if (ctx.signal.aborted) throw new DOMException('aborted', 'AbortError')
      const batch = await fileEntryService.findInternalMissingContentHash(cursor, BATCH_SIZE)
      if (batch.length === 0) break

      for (const entry of batch) {
        if (ctx.signal.aborted) throw new DOMException('aborted', 'AbortError')
        try {
          // Same path resolution + streaming hash as the write path, producing
          // the canonical `{algo}:{hex}` value the column expects.
          const contentHash = await fsHash(resolvePhysicalPath(entry))
          await fileEntryService.update(entry.id, { contentHash })
          hashed++
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') {
            // Blob genuinely gone — the expected orphan case. Left NULL for the
            // orphan sweep (§10); a quiet warn keeps the dashboard uncluttered.
            ctx.logger.warn('contentHash backfill: skipped orphan entry (blob missing)', { id: entry.id, code })
            skippedOrphan++
          } else {
            // EACCES / EBUSY / EMFILE / ENFILE / EIO / EISDIR — the blob may be
            // present and hashable, so this is a real IO/permission failure, not
            // an orphan. Surface it distinctly; leave the row NULL for a future
            // run rather than aborting the whole job.
            ctx.logger.error('contentHash backfill: hash failed for a present-looking blob', {
              id: entry.id,
              code,
              err
            })
            failedIo++
          }
        }
        processed++
      }

      cursor = batch[batch.length - 1].id
      ctx.reportProgress(Math.min(99, Math.floor((processed / total) * 100)), { stage: 'hashing', processed, total })
    }

    ctx.reportProgress(100, { stage: 'done', hashed, skippedOrphan, failedIo })
    ctx.logger.info('contentHash backfill complete', { total, hashed, skippedOrphan, failedIo })
    return { total, hashed, skippedOrphan, failedIo }
  }
}
