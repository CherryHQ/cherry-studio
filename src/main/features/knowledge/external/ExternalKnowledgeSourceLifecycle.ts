import { application } from '@application'
import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { isTerminalStatus } from '@shared/data/api/schemas/jobs'
import type {
  ExternalKnowledgeSchedulePolicy,
  ExternalKnowledgeSource,
  ExternalKnowledgeSourceState,
  ExternalKnowledgeSyncTrigger
} from '@shared/data/types/externalKnowledge'

import type { KnowledgeSyncExternalSourcePayload } from '../tasks/jobTypes'
import { notifyExternalKnowledgeSourceChange } from './externalKnowledgeDataChange'

type SyncRequester = {
  requestSyncForTrigger(
    input: { sourceId: string },
    trigger: Exclude<ExternalKnowledgeSyncTrigger, 'initial'>
  ): Promise<ExternalKnowledgeSource | void>
}

type LifecycleDependencies = {
  waitForRetry(signal: AbortSignal): Promise<void>
}

export type ActiveJobReconciliationResult = 'ready' | 'active' | 'pending-recovery'

const defaultDependencies: LifecycleDependencies = {
  waitForRetry: (signal) =>
    new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(handle)
        reject(signal.reason)
      }
      const handle = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, 250)
      handle.unref()
      signal.addEventListener('abort', onAbort, { once: true })
    })
}

function scheduleTemplate(source: ExternalKnowledgeSource, sourceRevision = source.revision) {
  return {
    baseId: source.baseId,
    sourceId: source.id,
    sourceRevision,
    trigger: 'scheduled' as const,
    dispatch: 'schedule' as const
  }
}

function dailyCron(policy: Extract<ExternalKnowledgeSchedulePolicy, { kind: 'daily' }>) {
  const [hour, minute] = policy.time.split(':')
  return { kind: 'cron' as const, expr: `${Number(minute)} ${Number(hour)} * * *`, timezone: policy.timezone }
}

export class ExternalKnowledgeSourceLifecycle {
  constructor(
    private readonly syncRequester: SyncRequester,
    private readonly dependencies: LifecycleDependencies = defaultDependencies
  ) {}

  async updateSchedulePolicy(input: {
    sourceId: string
    policy: ExternalKnowledgeSchedulePolicy
  }): Promise<ExternalKnowledgeSource> {
    if (input.policy.kind === 'manual') return this.useManualSchedule(input.sourceId)
    const policy = input.policy

    const jobManager = application.get('JobManager')
    const scheduleId = application.get('DbService').withWriteTx((tx) => {
      const source = externalKnowledgeSourceService.getByIdTx(tx, input.sourceId)
      if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', input.sourceId)
      const scheduleInput = {
        trigger: dailyCron(policy),
        jobInputTemplate: scheduleTemplate(source),
        catchUpPolicy: { kind: 'after-startup' as const, minutes: 0 },
        enabled: source.state === 'active'
      }
      if (source.scheduleId) {
        const updated = jobManager.updateJobScheduleTx(tx, source.scheduleId, scheduleInput)
        if (!updated) {
          throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Linked schedule is missing')
        }
        return source.scheduleId
      }

      const created = jobManager.registerJobScheduleTx(tx, {
        type: 'knowledge.sync-external-source',
        name: `external-knowledge-source-${source.id}`,
        ...scheduleInput
      })
      const linked = externalKnowledgeSourceService.setScheduleIdTx(tx, {
        sourceId: source.id,
        expectedRevision: source.revision,
        expectedScheduleId: null,
        scheduleId: created.id
      })
      if (!linked) throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeSource', source.id)
      return created.id
    })

    jobManager.syncJobScheduleTimerById(scheduleId)
    return this.readAndNotify(input.sourceId)
  }

  async pauseSource(sourceId: string): Promise<ExternalKnowledgeSource> {
    return this.setSourceState(sourceId, 'paused')
  }

  async resumeSource(sourceId: string): Promise<ExternalKnowledgeSource> {
    return this.setSourceState(sourceId, 'active')
  }

  pauseForReauthorization(connectionId: string): void {
    this.setConnectionSourcesState(connectionId, 'paused')
  }

  resumeAfterReauthorization(connectionId: string): void {
    this.setConnectionSourcesState(connectionId, 'active')
  }

  reconcilePersistedReauthorization(): void {
    for (const connection of externalKnowledgeConnectionService.list()) {
      if (connection.authorizationStatus === 'reauthorization-required') {
        this.pauseForReauthorization(connection.id)
      }
    }
  }

  async dispatchScheduledEnvelope(
    input: KnowledgeSyncExternalSourcePayload,
    trigger: Extract<ExternalKnowledgeSyncTrigger, 'scheduled' | 'startup'>
  ): Promise<void> {
    await this.reconcileSourceActiveJob(input.sourceId)
    const source = externalKnowledgeSourceService.getById(input.sourceId)
    if (
      !source ||
      source.baseId !== input.baseId ||
      source.revision !== input.sourceRevision ||
      source.scheduleId === null ||
      source.state !== 'active'
    ) {
      return
    }
    await this.syncRequester.requestSyncForTrigger({ sourceId: source.id }, trigger)
  }

  async reconcileSourceActiveJob(
    sourceId: string,
    options: { settleNonTerminal?: boolean } = {}
  ): Promise<ActiveJobReconciliationResult> {
    for (;;) {
      const source = externalKnowledgeSourceService.getById(sourceId)
      if (!source?.activeJobId) return 'ready'
      const activeJobId = source.activeJobId
      const job = await application.get('JobManager').get(activeJobId)
      if (!job || isTerminalStatus(job.status)) {
        const cleared = application.get('DbService').withWriteTx((tx) =>
          externalKnowledgeSourceService.clearActiveJobTx(tx, {
            sourceId: source.id,
            expectedRevision: source.revision,
            expectedActiveJobId: activeJobId
          })
        )
        if (cleared) return 'ready'
        continue
      }
      if (!options.settleNonTerminal) return 'active'

      await application.get('JobManager').cancel(activeJobId, 'External knowledge source startup reconciliation')
      const settled = await application.get('JobManager').get(activeJobId)
      if (settled && !isTerminalStatus(settled.status)) return 'pending-recovery'
    }
  }

  async reconcileAllActiveJobs(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted()
      let pendingRecovery = false
      for (const source of externalKnowledgeSourceService.listWithActiveJobId()) {
        signal.throwIfAborted()
        const result = await this.reconcileSourceActiveJob(source.id, { settleNonTerminal: true })
        pendingRecovery ||= result === 'pending-recovery'
      }
      if (!pendingRecovery) return
      await this.dependencies.waitForRetry(signal)
    }
  }

  private async useManualSchedule(sourceId: string): Promise<ExternalKnowledgeSource> {
    const source = externalKnowledgeSourceService.getById(sourceId)
    if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', sourceId)
    if (!source.scheduleId) return source

    const removed = await application.get('JobManager').unregisterJobScheduleById(source.scheduleId)
    if (!removed) throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Linked schedule is missing')
    const updated = externalKnowledgeSourceService.getById(sourceId)
    if (!updated || updated.scheduleId !== null) {
      throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeSource', sourceId)
    }
    notifyExternalKnowledgeSourceChange(updated.baseId, updated.id, 'projection')
    return updated
  }

  private async setSourceState(
    sourceId: string,
    state: ExternalKnowledgeSourceState
  ): Promise<ExternalKnowledgeSource> {
    const scheduleId = application.get('DbService').withWriteTx((tx) => {
      const source = externalKnowledgeSourceService.getByIdTx(tx, sourceId)
      if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', sourceId)
      if (source.state === state) return source.scheduleId

      const nextRevision = source.revision + 1
      if (source.scheduleId) {
        const updated = application.get('JobManager').updateJobScheduleTx(tx, source.scheduleId, {
          enabled: state === 'active',
          jobInputTemplate: scheduleTemplate(source, nextRevision)
        })
        if (!updated)
          throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Linked schedule is missing')
      }
      const changed = externalKnowledgeSourceService.setStateTx(tx, {
        sourceId,
        expectedRevision: source.revision,
        expectedState: source.state,
        state
      })
      if (!changed) throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeSource', sourceId)
      return source.scheduleId
    })

    if (scheduleId) application.get('JobManager').syncJobScheduleTimerById(scheduleId)
    return this.readAndNotify(sourceId)
  }

  private setConnectionSourcesState(connectionId: string, state: ExternalKnowledgeSourceState): void {
    const changedSourceIds: string[] = []
    const scheduleIds = application.get('DbService').withWriteTx((tx) => {
      const ids: string[] = []
      for (const source of externalKnowledgeSourceService.listByConnectionIdTx(tx, connectionId)) {
        const nextRevision = source.state === state ? source.revision : source.revision + 1
        if (source.scheduleId) {
          const updated = application.get('JobManager').updateJobScheduleTx(tx, source.scheduleId, {
            enabled: state === 'active',
            jobInputTemplate: scheduleTemplate(source, nextRevision)
          })
          if (!updated) {
            throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Linked schedule is missing')
          }
          ids.push(source.scheduleId)
        }
        if (source.state === state) continue
        const changed = externalKnowledgeSourceService.setStateTx(tx, {
          sourceId: source.id,
          expectedRevision: source.revision,
          expectedState: source.state,
          state
        })
        if (!changed) throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeSource', source.id)
        changedSourceIds.push(source.id)
      }
      return ids
    })

    for (const scheduleId of scheduleIds) application.get('JobManager').syncJobScheduleTimerById(scheduleId)
    for (const sourceId of changedSourceIds) {
      const source = externalKnowledgeSourceService.getById(sourceId)
      if (source) notifyExternalKnowledgeSourceChange(source.baseId, source.id, 'projection')
    }
  }

  private readAndNotify(sourceId: string): ExternalKnowledgeSource {
    const source = externalKnowledgeSourceService.getById(sourceId)
    if (!source) throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Committed source is missing')
    notifyExternalKnowledgeSourceChange(source.baseId, source.id, 'projection')
    return source
  }
}
