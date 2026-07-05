import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isTerminalStatus, type TerminalJobStatus } from '@shared/data/api/schemas/jobs'

import { trashPurgeJobHandler } from './trashPurgeJobHandler'

const logger = loggerService.withContext('TrashService')

/**
 * Owns the trash retention purge: registers the 'trash.purge' job handler,
 * keeps the daily schedule armed, and exposes the manual "empty trash"
 * entry point behind the `trash.purge_now` IpcApi route.
 *
 * PreferenceService/DbService are BeforeReady and consumed via
 * `application.get()` at execute time — never declared in @DependsOn
 * (phase ordering is auto-enforced by the container).
 */
@Injectable('TrashService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager', 'FileManager'])
export class TrashService extends BaseService {
  protected onInit(): void {
    // Register in onInit (NOT onReady) so JobManager's startup recovery sweep
    // sees the handler when re-dispatching non-terminal jobs.
    application.get('JobManager').registerHandler('trash.purge', trashPurgeJobHandler)
    logger.info('Trash service initialized')
  }

  protected onReady(): void {
    const jobManager = application.get('JobManager')
    // Idempotent boot registration: registerJobSchedule persists a row per
    // call, so only register when no 'trash.purge' schedule exists yet.
    if (!jobManager.getJobSchedule('trash.purge')) {
      jobManager.registerJobSchedule({
        type: 'trash.purge',
        trigger: { kind: 'cron', expr: '0 3 * * *' },
        jobInputTemplate: {},
        // Missed fires (app closed at 03:00) run shortly after next startup.
        catchUpPolicy: { kind: 'after-startup', minutes: 3 }
      })
      logger.info('Registered daily trash purge schedule')
    }
  }

  /**
   * "Empty trash now": enqueues an immediate purge with `emptyAll: true`
   * (ignores the retention window) and resolves once the run reached a
   * terminal state, so callers can trust `status` ('completed' | 'failed' |
   * 'cancelled') before invalidating caches or toasting success.
   *
   * Concurrency is 1 — a manual run queues behind an in-flight scheduled
   * purge. Caveat: JobManager.onDestroy abandons unresolved `finished`
   * promises during shutdown, so a request pending at quit never resolves;
   * acceptable for this fire-from-UI path.
   */
  async purgeNow(): Promise<{ jobId: string; status: TerminalJobStatus }> {
    const handle = application.get('JobManager').enqueue('trash.purge', { emptyAll: true })
    const snapshot = await handle.finished
    // `finished` resolves only at a terminal state; the guard narrows the type
    // and defends against a contract regression rather than widening the output.
    if (!isTerminalStatus(snapshot.status)) {
      throw new Error(`Trash purge resolved with non-terminal status: ${snapshot.status}`)
    }
    return { jobId: handle.id, status: snapshot.status }
  }
}
