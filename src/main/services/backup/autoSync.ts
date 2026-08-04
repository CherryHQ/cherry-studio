import { application } from '@application'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'
import { triggersEqual } from '@shared/data/api/schemas/jobs'
import { BACKUP_DESTINATION_IDS, type BackupDestinationId } from '@shared/ipc/schemas/backup'

import { DestinationNotConfiguredError } from './errors'

const logger = loggerService.withContext('BackupAutoSync')

export const AUTO_SYNC_JOB_TYPE = 'backup.auto-sync'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    /** One schedule per destination; the schedule's `name` is the destination. */
    'backup.auto-sync': { destination: BackupDestinationId }
  }
}

/**
 * Scheduled backup to one destination.
 *
 * `abandon`, not `retry`: a backup missed because the app was closed is not
 * worth replaying on the next launch — the schedule is about to produce a
 * fresher one anyway, and the user did not ask for a backup at startup.
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
  // A destination that is down stays down for a while; the next tick is a better
  // retry than three in quick succession.
  defaultRetryPolicy: { maxAttempts: 2, backoff: 'exponential', baseDelayMs: 30_000, maxDelayMs: 120_000 },
  async execute(ctx) {
    const { destination } = ctx.input
    try {
      const { name } = await application.get('BackupService').exportToDestination(destination)
      logger.info('Scheduled backup completed', { destination, name })
      return { name }
    } catch (error) {
      // Settings can be cleared while a schedule is still armed. That is not a
      // failure worth retrying or reporting — the reconciler is about to
      // disable this schedule anyway.
      if (error instanceof DestinationNotConfiguredError) {
        logger.info('Skipping scheduled backup for an unconfigured destination', { destination })
        return { skipped: true }
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

/**
 * Make the schedules match the settings, for every destination.
 *
 * Preference is the single source of truth and the schedule row is its
 * projection, which is what makes this safe to run at any time: a restore comes
 * back with every schedule forced to `enabled: false`
 * (`portability/tablePolicy.ts`), and the next reconcile turns the ones the
 * user still wants back on.
 */
export function reconcileAutoSyncSchedules(): void {
  const jobManager = application.get('JobManager')

  for (const destination of BACKUP_DESTINATION_IDS) {
    const desired = desiredFor(destination)
    const existing = jobManager.getJobSchedule(AUTO_SYNC_JOB_TYPE, destination)

    if (!desired.enabled) {
      if (existing?.enabled) {
        jobManager.updateJobSchedule(existing.id, { enabled: false })
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
