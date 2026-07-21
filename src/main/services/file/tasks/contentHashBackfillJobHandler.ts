import { fileEntryService } from '@data/services/FileEntryService'
import type { JobHandler } from '@main/core/job/types'
import { hash as fsHash } from '@main/utils/file'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { ContentHash, FileEntryId } from '@shared/data/types/file'

import { resolvePhysicalPath } from '../utils/pathResolver'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'file.contenthash-backfill': Record<string, never>
  }
}

const BATCH_SIZE = 200

export interface ContentHashBackfillSummary {
  total: number
  hashed: number
  skippedOrphan: number
  failedIo: number
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
}

/** Backfill nullable hashes on pre-feature internal rows using keyset pagination. */
export const contentHashBackfillJobHandler: JobHandler<Record<string, never>> = {
  recovery: 'singleton',
  defaultConcurrency: 1,
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx): Promise<ContentHashBackfillSummary> {
    const total = fileEntryService.countInternalMissingContentHash()
    if (total === 0) {
      const summary = { total: 0, hashed: 0, skippedOrphan: 0, failedIo: 0 }
      ctx.reportProgress(100, { stage: 'done', ...summary })
      return summary
    }

    let cursor: FileEntryId | null = null
    let processed = 0
    let hashed = 0
    let skippedOrphan = 0
    let failedIo = 0

    for (;;) {
      throwIfAborted(ctx.signal)
      const batch = fileEntryService.findInternalMissingContentHash(cursor, BATCH_SIZE)
      if (batch.length === 0) break

      for (const entry of batch) {
        throwIfAborted(ctx.signal)

        let contentHash: ContentHash
        try {
          contentHash = await fsHash(resolvePhysicalPath(entry), ctx.signal)
        } catch (error) {
          if (ctx.signal.aborted) throwIfAborted(ctx.signal)
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') {
            ctx.logger.warn('contentHash backfill: skipped orphan entry (blob missing)', { id: entry.id, code })
            skippedOrphan++
          } else {
            ctx.logger.error('contentHash backfill: blob hash failed (IO/permission)', {
              id: entry.id,
              code,
              err: error
            })
            failedIo++
          }
          processed++
          continue
        }

        throwIfAborted(ctx.signal)
        try {
          fileEntryService.update(entry.id, { contentHash })
          hashed++
        } catch (error) {
          if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
            ctx.logger.warn('contentHash backfill: entry vanished before persist (concurrent delete)', { id: entry.id })
            skippedOrphan++
          } else {
            throw error
          }
        }
        processed++
      }

      cursor = batch[batch.length - 1].id
      ctx.reportProgress(Math.min(99, Math.floor((processed / total) * 100)), {
        stage: 'hashing',
        processed,
        total
      })
    }

    const summary = { total, hashed, skippedOrphan, failedIo }
    ctx.reportProgress(100, { stage: 'done', ...summary })
    if (failedIo > 0) {
      ctx.logger.warn('contentHash backfill complete with IO failures', summary)
    } else {
      ctx.logger.info('contentHash backfill complete', summary)
    }
    return summary
  }
}
