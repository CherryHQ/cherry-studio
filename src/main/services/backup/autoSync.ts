import { application } from '@application'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'
import { ACTIVE_JOB_STATUSES, type JobSnapshot, triggersEqual } from '@shared/data/api/schemas/jobs'
import { BACKUP_DESTINATION_IDS, type BackupDestinationId } from '@shared/ipc/schemas/backup'

import { BackupBusyError, DestinationNotConfiguredError } from './errors'

const logger = loggerService.withContext('BackupAutoSync')

export const AUTO_SYNC_JOB_TYPE = 'backup.auto-sync'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    /** One schedule per destination; the schedule's `name` is the destination. */
    'backup.auto-sync': { destination: BackupDestinationId }
  }
}

/** Why a scheduled run finished without writing an archive. */
type AutoSyncSkip = 'not-configured' | 'busy'

/**
 * Scheduled backup to one destination.
 *
 * `abandon` covers a run interrupted by quitting: a half-made export is not
 * resumed. A turn missed while the app was closed is the schedule's
 * `after-startup` catch-up, not this.
 *
 * One queue for every destination. Export holds the service exclusively
 * (`runExclusive`), so two destinations firing on the same minute would make one
 * of them fail with `BackupBusyError` for no reason; queueing makes the second
 * wait instead.
 */
export const autoSyncJobHandler: JobHandler<{ destination: BackupDestinationId }> = {
  recovery: 'abandon',
  defaultQueue: () => AUTO_SYNC_JOB_TYPE,
  defaultConcurrency: 1,
  // A slow destination on a short interval would otherwise queue a run per tick.
  skipFireWhileUnfinished: true,
  // A destination that is down stays down for a while; the next tick is a better
  // retry than three in quick succession.
  defaultRetryPolicy: { maxAttempts: 2, backoff: 'exponential', baseDelayMs: 30_000, maxDelayMs: 120_000 },
  async execute(ctx) {
    const { destination } = ctx.input
    try {
      const { name } = await application.get('BackupService').exportToDestination(destination, undefined, ctx.signal)
      logger.info('Scheduled backup completed', { destination, name })
      return { name }
    } catch (error) {
      // Settings can be cleared while the schedule stays on. Retrying cannot
      // help; the status page reports it instead.
      if (error instanceof DestinationNotConfiguredError) {
        logger.info('Skipping scheduled backup for an unconfigured destination', { destination })
        return { skipped: 'not-configured' satisfies AutoSyncSkip }
      }
      // A manual export or restore holds the service; the next turn covers this one.
      if (error instanceof BackupBusyError) {
        logger.info('Skipping scheduled backup while another backup operation runs', { destination })
        return { skipped: 'busy' satisfies AutoSyncSkip }
      }
      throw error
    }
  }
}

/** What the user's settings say this destination's schedule should look like. */
interface DesiredSchedule {
  readonly enabled: boolean
  readonly intervalMs: number
}

/** The settings a schedule is derived from — what the reconciler listens to. */
export const AUTO_SYNC_PREFERENCE_KEYS = BACKUP_DESTINATION_IDS.flatMap(
  (destination) => [`data.backup.${destination}.auto_sync`, `data.backup.${destination}.sync_interval`] as const
)

function desiredFor(destination: BackupDestinationId): DesiredSchedule {
  const preferences = application.get('PreferenceService')
  const enabled = preferences.get(`data.backup.${destination}.auto_sync`)
  const minutes = preferences.get(`data.backup.${destination}.sync_interval`)
  // A zero interval is how the settings UI spells "off" — it must not become a
  // zero-delay timer.
  return { enabled: enabled && minutes > 0, intervalMs: minutes * 60_000 }
}

/** What the settings pages show about a destination's scheduled backup. */
export interface AutoSyncStatus {
  readonly destination: BackupDestinationId
  /** When a scheduled run last wrote an archive, in epoch millis; null when none is on record. */
  readonly lastSuccessAt: number | null
  /** Why the latest run wrote nothing. A run deferred by a busy service is not a problem. */
  readonly problem?: 'failed' | 'not-configured'
}

/** JobManager keeps this many terminal runs per schedule, so reading more finds nothing. */
const RUN_HISTORY_LIMIT = 100

function skipOf(run: JobSnapshot): AutoSyncSkip | undefined {
  const output = run.output as { skipped?: AutoSyncSkip } | null
  return output?.skipped
}

/**
 * Scheduled-backup status per destination, read from the schedule's own runs.
 *
 * From the runs, not the schedule row: `lastRun` there is when the timer fired,
 * which a failed, skipped, or still-retrying run writes just the same.
 */
export function readAutoSyncStatus(): AutoSyncStatus[] {
  const jobManager = application.get('JobManager')

  return BACKUP_DESTINATION_IDS.map((destination) => {
    const schedule = jobManager.getJobSchedule(AUTO_SYNC_JOB_TYPE, destination)
    if (!schedule) return { destination, lastSuccessAt: null }

    const runs = jobService
      .listRecentTerminalByScheduleId(schedule.id, RUN_HISTORY_LIMIT)
      .filter((run) => run.status !== 'cancelled' && skipOf(run) !== 'busy')
    const success = runs.find((run) => run.status === 'completed' && skipOf(run) === undefined)
    const latest = runs[0]
    const problem =
      latest?.status === 'failed'
        ? 'failed'
        : latest && skipOf(latest) === 'not-configured'
          ? 'not-configured'
          : undefined

    return {
      destination,
      lastSuccessAt: success?.finishedAt ? Date.parse(success.finishedAt) : null,
      ...(problem ? { problem } : {})
    }
  })
}

/** A run already queued or in flight read the settings the user just turned off. */
function cancelUnfinishedRuns(scheduleId: string, destination: BackupDestinationId): void {
  const jobManager = application.get('JobManager')
  for (const run of jobService.list({ scheduleId, status: [...ACTIVE_JOB_STATUSES] })) {
    void jobManager.cancel(run.id, 'automatic backup turned off').catch((error: unknown) => {
      logger.warn('Could not cancel a scheduled backup run', error as Error, { destination, jobId: run.id })
    })
  }
}

/**
 * Make the schedules match the settings, for every destination.
 *
 * Preference is the single source of truth and the schedule row is its
 * projection, which is what makes this safe to run at any time. A restore
 * resets every `auto_sync` preference (`portability/preferenceResetPolicy.ts`),
 * so the reconcile after one leaves every schedule off until the user turns it
 * back on.
 */
export function reconcileAutoSyncSchedules(): void {
  const jobManager = application.get('JobManager')

  for (const destination of BACKUP_DESTINATION_IDS) {
    const desired = desiredFor(destination)
    const existing = jobManager.getJobSchedule(AUTO_SYNC_JOB_TYPE, destination)

    if (!desired.enabled) {
      if (existing?.enabled) {
        jobManager.updateJobSchedule(existing.id, { enabled: false })
        cancelUnfinishedRuns(existing.id, destination)
        logger.info('Auto backup disabled', { destination })
      }
      continue
    }

    const trigger = { kind: 'interval', ms: desired.intervalMs, anchor: 'lastRun' } as const

    if (!existing) {
      jobManager.registerJobSchedule({
        type: AUTO_SYNC_JOB_TYPE,
        name: destination,
        trigger,
        jobInputTemplate: { destination },
        // `skip-missed` would mean a daily backup never runs for anyone who does
        // not leave the app open across the interval boundary.
        catchUpPolicy: { kind: 'after-startup', minutes: 5 }
      })
      logger.info('Auto backup scheduled', { destination, intervalMs: desired.intervalMs })
      continue
    }

    // Patch only what actually differs. `updateJobSchedule` re-arms on field
    // PRESENCE, so passing an unchanged trigger would restart the interval and
    // a reconcile on every unrelated settings edit would push the backup away
    // forever.
    const patch: { trigger?: typeof trigger; enabled?: boolean } = {}
    if (!triggersEqual(existing.trigger, trigger)) patch.trigger = trigger
    if (!existing.enabled) patch.enabled = true

    if (Object.keys(patch).length > 0) {
      jobManager.updateJobSchedule(existing.id, patch)
      logger.info('Auto backup schedule updated', { destination, ...patch })
    }
  }
}
