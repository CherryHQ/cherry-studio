// JobManager-only restore quiesce capability.
//
// Packaged restore remains unavailable until the AI, channel, and renderer writer
// barriers are implemented. This helper owns the JobManager hold for the dev-only
// restore path and preserves it after a staged journal commits.

import { application } from '@application'
import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'

import { BackupCancelledError } from './errors'

const logger = loggerService.withContext('BackupRestoreJobQuiesce')

/** Pause JobManager activity and require all in-flight work to drain cleanly. */
export class BackupRestoreJobQuiesce {
  private hold: Disposable | undefined
  private drainClean = false
  private retainedForRelaunch = false

  constructor(private readonly timeoutMs: number) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('backup restore drain timeoutMs must be a positive integer')
    }
  }

  /** Acquire a pause hold and reject any straggler or pending recovery work. */
  async quiesce(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new BackupCancelledError()
    if (this.hold) throw new Error('backup restore JobManager quiesce already acquired')

    const jobManager = application.get('JobManager')
    this.hold = jobManager.pause('backup restore')
    try {
      const verdict = await jobManager.drainInFlight({ timeoutMs: this.timeoutMs })
      const clean = verdict.stragglerIds.length === 0 && !verdict.startupRecoveryPending
      if (!clean) {
        logger.warn('restore JobManager drain was not clean', {
          stragglerIds: verdict.stragglerIds,
          startupRecoveryPending: verdict.startupRecoveryPending,
          timeoutMs: this.timeoutMs
        })
        throw new Error('backup restore JobManager did not drain cleanly')
      }
      if (signal?.aborted) throw new BackupCancelledError()
      this.drainClean = true
    } catch (error) {
      this.disposeOnAbort()
      throw error
    }
  }

  /** Transfer a clean hold to process exit after the staged journal is durable. */
  retainForRelaunch(): void {
    if (!this.hold) throw new Error('backup restore JobManager quiesce was not acquired')
    if (!this.drainClean) throw new Error('backup restore JobManager did not drain cleanly')
    this.retainedForRelaunch = true
  }

  /** Release an uncommitted restore hold exactly once. */
  disposeOnAbort(): void {
    if (this.retainedForRelaunch) return
    const hold = this.hold
    this.hold = undefined
    this.drainClean = false
    hold?.dispose()
  }
}
