import { loggerService } from '@logger'
import type { JobContext } from '@main/core/job/types'
import { trashPurgeJobHandler } from '@main/services/trash/trashPurgeJobHandler'
import type { TerminalJobStatus } from '@shared/data/api/schemas/jobs'

const logger = loggerService.withContext('ArchivePurge')

/**
 * `TrashService.purgeNow` without the desktop job queue, which the Web edition does not have: runs the
 * `trash.purge` job's handler once, emptying the whole archive, and answers as `trash.purge_now` does.
 */
export async function purgeArchiveNow(): Promise<{
  status: TerminalJobStatus
  reclaimed: boolean
  deletedCount: number
  retainedReferencedFileCount: number
}> {
  const input = { emptyAll: true }
  const context: JobContext<typeof input> = {
    jobId: crypto.randomUUID(),
    input,
    attempt: 1,
    parentId: null,
    signal: new AbortController().signal,
    metadata: {},
    patchMetadata: async () => {},
    reportProgress() {},
    logger
  }
  try {
    const output = (await trashPurgeJobHandler.execute(context)) as {
      reclaimed: boolean
      retainedReferencedFileCount: number
      purged: Record<string, number>
    }
    return {
      status: 'completed',
      reclaimed: output.reclaimed,
      deletedCount: Object.values(output.purged).reduce((total, count) => total + count, 0),
      retainedReferencedFileCount: output.retainedReferencedFileCount
    }
  } catch (error) {
    logger.error('Emptying the archive failed', error as Error)
    return { status: 'failed', reclaimed: false, deletedCount: 0, retainedReferencedFileCount: 0 }
  }
}
