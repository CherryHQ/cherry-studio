import { fileEntryService } from '@data/services/FileEntryService'
import type { JobHandler } from '@main/core/job/types'
import { hash as fsHash } from '@main/utils/file/fs'
import { ErrorCode, isDataApiError } from '@shared/data/api'

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
 * null`. New entries always get their hash on create (§1.2); this fills the gap
 * for the existing set so legacy files also participate in dedup detection.
 *
 * **Drain strategy — keyset pagination over `id`** (UUID v7, lexicographically
 * time-ordered): each page queries `content_hash IS NULL AND id > cursor`, so an
 * entry that fails to hash (missing/orphan blob → ENOENT) stays NULL but sits
 * behind the cursor and is NOT re-scanned within the same run — otherwise the
 * NULL set would never shrink and the loop would spin. A row whose blob is
 * genuinely gone can never be hashed; it simply persists in the NULL set until
 * the entry itself is removed by an unrelated flow. (It is NOT reaped by the §10
 * FS sweep, which deletes on-disk blobs that have NO DB row — the opposite
 * direction; a DB-row-with-missing-blob is out of scope for both that sweep and
 * the §7 entry scanner.) Includes trashed entries (their blob is preserved, so
 * they are hashable and become reuse targets if restored).
 *
 * **Per-entry failure handling** — each entry is hashed then persisted, and the
 * two steps are classified independently so a real regression is never buried as
 * a benign orphan:
 *   - **Hash** (`fsHash`) is errno-classified: `ENOENT`/`ENOTDIR` (blob gone) is
 *     the expected quiet case (`skippedOrphan`, warn); any other errno
 *     (`EACCES`/`EBUSY`/`EMFILE`/`EIO`/`EISDIR`/…) means the blob couldn't be
 *     read — a genuine IO/permission `failedIo` (error), row left NULL.
 *   - **Persist** (`update`): a `NOT_FOUND` means the row was trashed/deleted
 *     concurrently between the keyset page and the write — benign, counted as
 *     `skippedOrphan` (the work item is simply gone). Any OTHER persist error
 *     (`SQLITE_BUSY`, a programming bug) is unexpected and is **rethrown**, so it
 *     surfaces as a failed job instead of a silent `failedIo` under a green
 *     terminal status.
 * A hash failure or a benign concurrent-delete never aborts the drain; only an
 * unexpected persist error does (the job re-triggers on the next startup).
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
      ctx.reportProgress(100, { stage: 'done', total: 0, hashed: 0, skippedOrphan: 0, failedIo: 0 })
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

        // Phase 1 — hash the blob. ONLY the FS read is errno-classified here, so
        // a non-FS error (e.g. from the persist below) can never be mislabeled as
        // a blob IO failure. ENOENT/ENOTDIR = expected orphan; any other errno =
        // real IO/permission failure. Either leaves the row NULL for a future run.
        let contentHash: string
        try {
          // Same path resolution + streaming hash as the write path, producing
          // the canonical `{algo}:{hex}` value the column expects.
          contentHash = await fsHash(resolvePhysicalPath(entry))
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') {
            // Blob genuinely gone — the expected orphan case. A quiet warn keeps
            // the dashboard uncluttered; the row stays NULL for a future run.
            ctx.logger.warn('contentHash backfill: skipped orphan entry (blob missing)', { id: entry.id, code })
            skippedOrphan++
          } else {
            // EACCES / EBUSY / EMFILE / ENFILE / EIO / EISDIR — the blob couldn't
            // be read. A real IO/permission failure, not an orphan; surface it
            // distinctly and leave the row NULL rather than aborting the job.
            ctx.logger.error('contentHash backfill: blob hash failed (IO/permission)', { id: entry.id, code, err })
            failedIo++
          }
          processed++
          continue
        }

        // Phase 2 — persist. A NOT_FOUND means the row was trashed/permanently
        // deleted concurrently between the keyset page and this write: benign,
        // the work item is simply gone (counted as a skip, not a blob failure).
        // Any other persist error (SQLITE_BUSY, a programming bug) is unexpected
        // and rethrown — a real regression must surface as a FAILED job, never be
        // buried as a silent `failedIo` under a green terminal status.
        try {
          await fileEntryService.update(entry.id, { contentHash })
          hashed++
        } catch (err) {
          if (isDataApiError(err) && err.code === ErrorCode.NOT_FOUND) {
            ctx.logger.warn('contentHash backfill: entry vanished before persist (concurrent delete)', {
              id: entry.id
            })
            skippedOrphan++
          } else {
            throw err
          }
        }
        processed++
      }

      cursor = batch[batch.length - 1].id
      ctx.reportProgress(Math.min(99, Math.floor((processed / total) * 100)), { stage: 'hashing', processed, total })
    }

    const summary = { total, hashed, skippedOrphan, failedIo }
    ctx.reportProgress(100, { stage: 'done', ...summary })
    // A non-zero `failedIo` is a permanent-until-next-run condition (these rows
    // fail every startup re-trigger), so raise the terminal log to `warn` — the
    // count is visible without aggregating per-row error lines.
    if (failedIo > 0) {
      ctx.logger.warn('contentHash backfill complete with IO failures', summary)
    } else {
      ctx.logger.info('contentHash backfill complete', summary)
    }
    return summary
  }
}
