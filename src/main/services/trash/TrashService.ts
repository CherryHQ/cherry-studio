import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { DeleteAssistantResult } from '@shared/data/api/schemas/assistants'
import { isTerminalStatus, type TerminalJobStatus } from '@shared/data/api/schemas/jobs'
import type { DeleteTopicsResult } from '@shared/data/api/schemas/topics'

import { trashPurgeJobHandler } from './trashPurgeJobHandler'

const logger = loggerService.withContext('TrashService')
const RETRY_ASSISTANT_ARCHIVE = Symbol('retry-assistant-archive')

export class TopicArchiveBusyError extends Error {
  readonly topicIds: string[]

  constructor(topicIds: string[]) {
    super(`Cannot archive topics with unsettled work: ${topicIds.join(', ')}`)
    this.name = 'TopicArchiveBusyError'
    this.topicIds = topicIds
  }
}

/**
 * Owns trash lifecycle commands and retention purge. Archive commands coordinate
 * runtime state with DB writes; purge registers and schedules the `trash.purge` job.
 *
 * PreferenceService/DbService are BeforeReady and consumed via
 * `application.get()` at execute time — never declared in @DependsOn
 * (phase ordering is auto-enforced by the container).
 */
@Injectable('TrashService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager', 'FileManager', 'AiStreamManager'])
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
   * `reclaimed` reports whether disk reclamation actually finished. The rows are
   * always gone on 'completed', but the sweeps are batch-capped and stand aside
   * during a restore, so a caller must not promise the space back on status alone.
   *
   * Concurrency is 1 — a manual run queues behind an in-flight scheduled
   * purge. Caveat: JobManager.onDestroy abandons unresolved `finished`
   * promises during shutdown, so a request pending at quit never resolves;
   * acceptable for this fire-from-UI path.
   */
  async purgeNow(): Promise<{ status: TerminalJobStatus; reclaimed: boolean }> {
    const handle = application.get('JobManager').enqueue('trash.purge', { emptyAll: true })
    const snapshot = await handle.finished
    // `finished` resolves only at a terminal state; the guard narrows the type
    // and defends against a contract regression rather than widening the output.
    if (!isTerminalStatus(snapshot.status)) {
      throw new Error(`Trash purge resolved with non-terminal status: ${snapshot.status}`)
    }
    const output = snapshot.output as { reclaimed?: boolean } | undefined
    return { status: snapshot.status, reclaimed: output?.reclaimed === true }
  }

  async archiveTopics(topicIds: string[]): Promise<DeleteTopicsResult> {
    const ids = [...new Set(topicIds)].sort()
    return this.withTopicLocks(ids, async () => {
      this.assertTopicsSettled(ids)
      return topicService.deleteByIds(ids)
    })
  }

  async archiveAssistantTopics(assistantId: string): Promise<DeleteTopicsResult> {
    return this.withStableAssistantTopics(assistantId, () => topicService.deleteByAssistantId(assistantId))
  }

  async archiveAssistant(assistantId: string, deleteTopics: boolean): Promise<DeleteAssistantResult> {
    if (!deleteTopics) return assistantDataService.delete(assistantId)

    return this.withStableAssistantTopics(assistantId, () =>
      assistantDataService.delete(assistantId, { deleteTopics: true })
    )
  }

  private async withStableAssistantTopics<T>(assistantId: string, archive: () => T): Promise<T> {
    for (;;) {
      const topicIds = topicService.listActiveIdsByAssistant(assistantId)
      const result = await this.withTopicLocks(topicIds, async () => {
        const currentTopicIds = topicService.listActiveIdsByAssistant(assistantId)
        if (!this.sameIds(topicIds, currentTopicIds)) return RETRY_ASSISTANT_ARCHIVE

        this.assertTopicsSettled(topicIds)
        return archive()
      })
      if (result !== RETRY_ASSISTANT_ARCHIVE) return result
    }
  }

  private withTopicLocks<T>(topicIds: string[], operation: () => T | Promise<T>): Promise<T> {
    const streamManager = application.get('AiStreamManager')
    const acquire = (index: number): Promise<T> => {
      const topicId = topicIds[index]
      if (!topicId) return Promise.resolve(operation())
      return streamManager.withDispatchLock(topicId, () => acquire(index + 1))
    }
    return acquire(0)
  }

  private assertTopicsSettled(topicIds: string[]): void {
    const streamManager = application.get('AiStreamManager')
    const busyTopicIds = topicIds.filter((topicId) => streamManager.hasUnsettledTopicWork(topicId))
    if (busyTopicIds.length > 0) throw new TopicArchiveBusyError(busyTopicIds)
  }

  private sameIds(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index])
  }
}
