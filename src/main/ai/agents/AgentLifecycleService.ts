import { application } from '@application'
import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import {
  ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX,
  type ArchivedSystemWorkspacesHook,
  agentSessionService
} from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { protectLocalAgentEnvironment } from '@main/services/localAgentCredentials'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'
import type { LocalAgentLaunchSettings } from '@shared/ai/localAgent'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type {
  ReusableAgentSessionPlaceholdersResponse,
  ReuseOrCreateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'
import { KeyedMutex } from '@shared/utils/async'

import { reclaimPurgedRuntimeSessions, sweepAgentOrphans } from './agentOrphanSweep'
import { agentWorkspaceStorageService } from './AgentWorkspaceStorageService'
import { reclaimHeartbeatWorkspacesTx } from './heartbeatSchedule'

const logger = loggerService.withContext('AgentLifecycleService')
const RETRY_AGENT_SESSION_ARCHIVE = Symbol('retry-agent-session-archive')

function resumeTokensForDeletedSessions(
  ids: readonly string[],
  tokensBySession: Map<string, Set<string>>
): Set<string> {
  return new Set(ids.flatMap((id) => [...(tokensBySession.get(id) ?? [])]))
}

export class AgentSessionArchiveBusyError extends Error {
  constructor(readonly sessionIds: string[]) {
    super(`Cannot archive Agent Sessions with unsettled work: ${sessionIds.join(', ')}`)
    this.name = 'AgentSessionArchiveBusyError'
  }
}

@Injectable('AgentLifecycleService')
@ServicePhase(Phase.WhenReady)
@DependsOn([
  'AgentJobsService',
  'AgentImportService',
  'AgentSessionDeliveryService',
  'AgentDelegationService',
  'AgentSessionRuntimeService',
  'AiStreamManager',
  'ChannelManager'
])
export class AgentLifecycleService extends BaseService {
  private readonly agentLocks = new KeyedMutex()
  private readonly sessionLocks = new KeyedMutex()
  private readonly ingressHolds = new Set<symbol>()
  private readonly inFlight = new Map<Promise<unknown>, string>()
  private isShuttingDown = false

  protected override onInit(): void {
    this.isShuttingDown = false
  }

  protected override onReady(): void {
    application.get('DbService').withWriteTx((tx) => this.reconcileSchedulesTx(tx))
  }

  protected override async onStop(): Promise<void> {
    this.isShuttingDown = true
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight.keys()])
  }

  archiveAgent(agentId: string, options: { archiveSessions: boolean }) {
    return this.runOperation('archive-agent:' + agentId, () =>
      this.agentLocks.runExclusive(agentId, () => this.deleteAgentInternal(agentId, options.archiveSessions, false))
    )
  }

  purgeAgent(agentId: string) {
    return this.runOperation('purge-agent:' + agentId, () =>
      this.agentLocks.runExclusive(agentId, () => this.deleteAgentInternal(agentId, false, true))
    )
  }

  deleteActiveAgentPermanently(agentId: string, deleteSessions: boolean) {
    return this.runOperation('delete-active-agent:' + agentId, () =>
      this.agentLocks.runExclusive(agentId, () => this.deleteAgentInternal(agentId, deleteSessions, true, 'active'))
    )
  }

  restoreAgent(agentId: string, launchSettings?: LocalAgentLaunchSettings) {
    return this.runOperation('restore-agent:' + agentId, () =>
      this.agentLocks.runExclusive(agentId, () =>
        this.withOperationLocks(agentSessionService.listIdsByAgent(agentId), async () => {
          const workspaces = agentSessionService
            .listSystemWorkspaceSessions(agentSessionService.listIdsByAgent(agentId))
            .filter((workspace) => workspace.deletedAt !== null && workspace.deletedAt === workspace.agentDeletedAt)
          const archiveHold = this.acquireWorkspaceArchiveHold(workspaces)
          try {
            await this.settlePendingWorkspaceArchives(workspaces)
            const { agent, scheduleIds, restoredSessionIds } = await agentWorkspaceStorageService.restoreWorkspaces(
              workspaces,
              () => {
                const settings = launchSettings && protectLocalAgentEnvironment(launchSettings, agentId)
                return application.get('DbService').withWriteTx((tx) => {
                  const { agent, restoredSessionIds } = agentService.restoreAgentTx(tx, agentId, settings)
                  const enabled = agent.type !== 'local' || agent.localRuntime?.enabled
                  return {
                    agent,
                    restoredSessionIds,
                    scheduleIds: agentTaskService.setOwnerStateTx(
                      tx,
                      agentId,
                      enabled ? 'active' : 'trashed',
                      Date.now()
                    ).scheduleIds
                  }
                })
              }
            )
            // Cancel the queued packs only after activation committed (see
            // restoreSession; issue #21645).
            await this.cancelQueuedWorkspaceArchives(workspaces, 'Workspace restored before its archive ran')
            this.syncSchedules(scheduleIds)
            application.get('ChannelManager').reconcileAgent(agentId)
            agentSessionService.notifyReadModelChange(restoredSessionIds, 'membership')
            agentService.notifyReadModelChange([agentId], 'membership')
            return agent
          } finally {
            archiveHold?.dispose()
          }
        })
      )
    )
  }

  deleteTaskWithSessions(taskId: string) {
    return this.runOperation('delete-task:' + taskId, () =>
      this.withStableSessions(
        () => agentSessionService.listTaskSessionIds(taskId),
        async () => {
          await Promise.all(
            agentSessionService
              .listTaskSessionIds(taskId)
              .map((id) => application.get('AgentSessionRuntimeService').closeSessionForArchive(id))
          )
          const result = application.get('DbService').withWriteTx((tx) => {
            const ids = agentSessionService.listTaskSessionIds(taskId)
            const trashed = agentSessionService.trashByIdsTx(tx, ids, {
              onArchivedSystemWorkspacesTx: this.enqueueWorkspaceArchivesTx
            })
            const deleted = agentTaskService.deleteScheduleTx(tx, taskId)
            return { ...trashed, deleted }
          })
          this.syncSchedules([taskId])
          agentSessionService.notifyReadModelChange(result.trashedIds, 'membership')
          await this.finishDeletion(result.trashedIds, result.deliveryResults)
          return result.deleted
        },
        true
      )
    )
  }

  archiveSessions(ids: string[]) {
    return this.runOperation('archive-sessions:' + ids.join(','), () =>
      this.deleteSessionsInternal([...new Set(ids)], false)
    )
  }

  purgeSessions(ids: string[]) {
    return this.runOperation('purge-sessions:' + ids.join(','), () =>
      this.deleteSessionsInternal([...new Set(ids)], true)
    )
  }

  deleteActiveSessionsPermanently(ids: string[]) {
    return this.runOperation('delete-active-sessions:' + ids.join(','), () =>
      this.deleteSessionsInternal([...new Set(ids)], true, 'active')
    )
  }

  restoreSession(id: string) {
    return this.runOperation('restore-session:' + id, () =>
      this.sessionLocks.runExclusive(id, async () => {
        const workspaces = agentSessionService
          .listSystemWorkspaceSessions([id])
          .filter((workspace) => workspace.deletedAt !== null)
        const archiveHold = this.acquireWorkspaceArchiveHold(workspaces)
        try {
          await this.settlePendingWorkspaceArchives(workspaces)
          const restored = await agentWorkspaceStorageService.restoreWorkspaces(workspaces, () =>
            agentSessionService.restore(id)
          )
          // Cancel the queued packs only after activation committed: a rollback
          // leaves them replayable so the still-archived session packs later
          // (issue #21645).
          await this.cancelQueuedWorkspaceArchives(workspaces, 'Workspace restored before its archive ran')
          return restored
        } finally {
          archiveHold?.dispose()
        }
      })
    )
  }

  archiveAgentSessions(agentId: string) {
    return this.runOperation('archive-agent-sessions:' + agentId, () =>
      this.agentLocks.runExclusive(agentId, () => this.deleteAgentSessionsInternal(agentId))
    )
  }

  deleteWorkspace(workspaceId: string) {
    return this.runOperation('delete-workspace:' + workspaceId, () => this.deleteWorkspaceInternal(workspaceId))
  }

  reuseOrCreateSession(input: ReuseOrCreateAgentSessionDto) {
    return this.runOperation('reuse-or-create:' + input.agentId, () => this.reuseOrCreateSessionInternal(input))
  }

  purgeExpiredSessions(cutoffMs: number, limit: number) {
    return this.runOperation('purge-expired-sessions', () => this.purgeExpiredSessionsInternal(cutoffMs, limit))
  }

  purgeExpiredAgents(cutoffMs: number, limit: number) {
    return this.runOperation('purge-expired-agents', async () => {
      const ids = agentService.listExpiredTrashIds(cutoffMs, limit)
      const purgedIds: string[] = []
      const deferredWorkspacePaths: string[] = []
      for (const id of ids) {
        await this.agentLocks.runExclusive(id, async () => {
          if (!agentService.isExpiredTrash(id, cutoffMs)) return
          const result = await this.deleteAgentInternal(id, false, true)
          if (result.deleted) purgedIds.push(id)
          deferredWorkspacePaths.push(...result.deferredWorkspacePaths)
        })
      }
      return { purgedIds, hasMore: ids.length === limit, deferredWorkspacePaths }
    })
  }

  reconcile() {
    return this.runOperation('reconcile-agent-schedules', () => {
      const ids = application.get('DbService').withWriteTx((tx) => this.reconcileSchedulesTx(tx))
      this.syncSchedules(ids)
      return ids.length
    })
  }

  sweepOrphans(signal?: AbortSignal) {
    return this.runOperation('sweep-agent-orphans', async () => {
      if (hasPendingRestore()) return sweepAgentOrphans(signal)
      for (const { id } of agentSessionService.listSystemWorkspaceSessions()) {
        signal?.throwIfAborted()
        await this.sessionLocks.runExclusive(id, async () => {
          for (const workspace of agentSessionService.listSystemWorkspaceSessions([id])) {
            try {
              await agentWorkspaceStorageService.reconcileWorkspace(
                workspace,
                workspace.deletedAt === null ? 'active' : 'archived',
                workspace.deletedAt === null
                  ? {}
                  : {
                      // AC6: the archive queue owns every pack. The sweep only
                      // enqueues, so firing during a batch archive never starts
                      // a third concurrent compression; the queued job retries.
                      pack: async () => this.enqueueWorkspaceArchive(workspace.id)
                    }
              )
            } catch (error) {
              logger.warn('Workspace storage operation retained for retry', { workspace: workspace.path, error })
            }
          }
        })
      }
      return sweepAgentOrphans(signal)
    })
  }

  pauseIngress(reason?: string): Disposable {
    const token = Symbol(reason)
    this.ingressHolds.add(token)
    const channelHold = application.get('ChannelManager').pause(reason)
    const importHold = application.get('AgentImportService').pause(reason)
    return {
      dispose: () => {
        if (!this.ingressHolds.delete(token)) return
        importHold.dispose()
        channelHold.dispose()
      }
    }
  }

  pauseExecution(reason?: string): Disposable {
    const delivery = application.get('AgentSessionDeliveryService').pause(reason)
    const runtime = application.get('AgentSessionRuntimeService').pause(reason)
    return {
      dispose: () => {
        runtime.dispose()
        delivery.dispose()
      }
    }
  }

  async drainIngress(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    const verdicts = await Promise.all([
      application.get('ChannelManager').drainInFlight(options),
      application.get('AgentImportService').drainInFlight(options),
      this.drainOperations(options)
    ])
    return { stragglerIds: verdicts.flatMap((verdict) => verdict.stragglerIds) }
  }

  async drainInFlight(options: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    const verdicts = await Promise.all([
      this.drainIngress(options),
      application.get('AgentSessionDeliveryService').drainInFlight(options),
      application.get('AgentSessionRuntimeService').drainInFlight(options)
    ])
    return { stragglerIds: verdicts.flatMap((verdict) => verdict.stragglerIds) }
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return [
      ...[...this.inFlight.values()].map((id) => ({ id, summary: 'Agent lifecycle operation' })),
      ...application.get('ChannelManager').listActiveWork(),
      ...application.get('AgentImportService').listActiveWork(),
      ...application.get('AgentSessionDeliveryService').listActiveWork(),
      ...application.get('AgentSessionRuntimeService').listActiveWork()
    ]
  }

  private runOperation<T>(id: string, operation: () => T | Promise<T>): Promise<T> {
    if (this.isShuttingDown || this.ingressHolds.size > 0 || application.get('AiStreamManager').isWriteQuiesced) {
      return Promise.reject(new Error('Agent lifecycle writes are paused'))
    }
    const work = Promise.resolve().then(operation)
    this.inFlight.set(work, id)
    void work.finally(() => this.inFlight.delete(work)).catch(() => {})
    return work
  }

  private async drainOperations({ timeoutMs }: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs)
    })
    try {
      await Promise.race([
        deadline,
        (async () => {
          while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight.keys()])
        })()
      ])
      return { stragglerIds: [...this.inFlight.values()] }
    } finally {
      clearTimeout(timeout)
    }
  }

  private syncSchedules(ids: string[]): void {
    for (const id of ids) application.get('JobManager').syncJobScheduleTimerById(id)
    agentTaskService.notifyReadModelChange(ids, 'membership')
  }

  private reconcileSchedulesTx(tx: DbOrTx): string[] {
    const { scheduleIds, deletedSchedules } = agentTaskService.reconcileOwnerStatesTx(tx, Date.now())
    reclaimHeartbeatWorkspacesTx(tx, deletedSchedules)
    return scheduleIds
  }

  private async withOperationLocks<T>(ids: string[], operation: () => T | Promise<T>): Promise<T> {
    const releases: Array<() => void> = []
    try {
      for (const id of [...new Set(ids)].sort()) releases.push(await this.sessionLocks.acquire(id))
      return await operation()
    } finally {
      for (const release of releases.reverse()) release()
    }
  }

  private async drainSessions(ids: string[]): Promise<void> {
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        await application.get('AiStreamManager').abortAndDrain(buildAgentSessionTopicId(id), 'agent-session-purge')
        await application.get('AgentSessionDeliveryService').drainSessionQueues([id])
      })
    )
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  private async purgeExpiredSessionsInternal(
    cutoffMs: number,
    limit: number
  ): Promise<{ purgedIds: string[]; hasMore: boolean; deferredWorkspacePaths: string[] }> {
    const hold = application.get('AgentSessionDeliveryService').pause('trash-purge')
    try {
      const sessionIds = agentSessionService.listExpiredTrashIds(cutoffMs, limit)
      if (sessionIds.length === 0) return { purgedIds: [], hasMore: false, deferredWorkspacePaths: [] }

      const releases: Array<() => void> = []
      try {
        for (const sessionId of [...sessionIds].sort()) {
          releases.push(await this.sessionLocks.acquire(sessionId))
        }

        const expiredSessionIds = sessionIds.filter((sessionId) =>
          agentSessionService.isExpiredTrash(sessionId, cutoffMs)
        )
        const drains = await Promise.allSettled(
          expiredSessionIds.map(async (sessionId) => {
            await application
              .get('AiStreamManager')
              .abortAndDrain(buildAgentSessionTopicId(sessionId), 'agent-session-retention-purge')
            await application.get('AgentSessionDeliveryService').drainSessionQueues([sessionId])
          })
        )
        const failedDrain = drains.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failedDrain) throw failedDrain.reason

        const workspaces = agentSessionService.listSystemWorkspaceSessions(expiredSessionIds)
        const tokensBySession = agentSessionMessageService.listRuntimeResumeTokensBySession(expiredSessionIds)
        const purgedIds =
          expiredSessionIds.length === 0
            ? []
            : application
                .get('DbService')
                .withWriteTx((tx) => agentSessionService.purgeExpiredByIdsTx(tx, expiredSessionIds, cutoffMs))
        agentSessionService.notifyPurged(purgedIds)
        // Protected deletion has committed: release the global delivery pause
        // before waiting on in-flight workspace packs, so an unrelated Session
        // keeps delivering while a pack settles (issue #21645). dispose() is
        // idempotent; the outer finally becomes a no-op.
        hold.dispose()
        const deferredWorkspacePaths = await this.removePurgedSystemWorkspaces(
          workspaces.filter(({ id }) => purgedIds.includes(id))
        )
        await reclaimPurgedRuntimeSessions(resumeTokensForDeletedSessions(purgedIds, tokensBySession))
        return { purgedIds, hasMore: sessionIds.length === limit, deferredWorkspacePaths }
      } finally {
        for (const release of releases.reverse()) release()
      }
    } finally {
      hold.dispose()
    }
  }

  private async deleteSessionsInternal(
    ids: string[],
    permanent: boolean,
    targetState: 'active' | 'trashed' = 'trashed'
  ): Promise<{ deletedIds: string[]; deferredWorkspacePaths: string[] }> {
    const deleteSessions = async () => {
      await application.get('AgentDelegationService').cancelOwnedBy(ids)
      const workspaces = agentSessionService.listSystemWorkspaceSessions(ids)
      const tokensBySession = permanent
        ? agentSessionMessageService.listRuntimeResumeTokensBySession(ids)
        : new Map<string, Set<string>>()
      const result = agentSessionService.deleteByIdsWithImpact(ids, {
        permanent,
        onArchivedSystemWorkspacesTx: this.enqueueWorkspaceArchivesTx,
        ...(targetState === 'active' ? { targetState } : {})
      })
      await this.finishDeletion(result.deletedIds, result.deliveryResults, [], !permanent)
      const deferredWorkspacePaths = await this.removePurgedSystemWorkspaces(
        workspaces.filter(({ path }) => result.purgedSystemWorkspacePaths.includes(path))
      )
      if (permanent) {
        await reclaimPurgedRuntimeSessions(resumeTokensForDeletedSessions(result.deletedIds, tokensBySession))
      }
      return { deletedIds: result.deletedIds, deferredWorkspacePaths }
    }
    if (permanent && targetState === 'trashed')
      return this.withOperationLocks(ids, async () => {
        const eligibleIds = ids.filter((id) => agentSessionService.isExpiredTrash(id, Number.MAX_SAFE_INTEGER))
        await this.drainSessions(eligibleIds)
        ids = eligibleIds
        return deleteSessions()
      })

    return this.withSessionLocks(ids, async () => {
      this.assertSessionsSettled(ids)
      return deleteSessions()
    })
  }

  private async reuseOrCreateSessionInternal(
    input: ReuseOrCreateAgentSessionDto
  ): Promise<ReusableAgentSessionPlaceholdersResponse> {
    const result = agentSessionService.reuseOrCreatePlaceholderWithImpact(input)
    await this.finishDeletion(result.deletedDuplicateSessionIds, result.deliveryResults)
    return {
      session: result.session,
      created: result.created,
      deletedDuplicateSessionIds: result.deletedDuplicateSessionIds
    }
  }

  private async deleteAgentInternal(
    agentId: string,
    deleteSessions: boolean,
    permanent: boolean,
    targetState: 'active' | 'trashed' = 'trashed'
  ): Promise<{ deleted: boolean; deletedSessionIds?: string[]; deferredWorkspacePaths: string[] }> {
    if (permanent && agentService.getLifecycleState(agentId) !== targetState)
      return { deleted: false, deferredWorkspacePaths: [] }
    const deleteAgent = async () => {
      await application.get('AgentDelegationService').cancelOwnedBy(agentSessionService.listIdsByAgent(agentId))
      const workspaces = agentSessionService.listSystemWorkspaceSessions(agentSessionService.listIdsByAgent(agentId))
      const tokensBySession =
        permanent && targetState === 'active' && deleteSessions
          ? agentSessionMessageService.listRuntimeResumeTokensBySession(agentSessionService.listIdsByAgent(agentId))
          : new Map<string, Set<string>>()
      const { result, scheduleIds } = application.get('DbService').withWriteTx((tx) => {
        const result = agentService.deleteAgentStateTx(tx, agentId, {
          deleteSessions,
          permanent,
          targetState,
          onArchivedSystemWorkspacesTx: this.enqueueWorkspaceArchivesTx
        })
        const { scheduleIds, deletedSchedules } = result.deleted
          ? agentTaskService.setOwnerStateTx(tx, agentId, permanent ? 'missing' : 'trashed', Date.now())
          : { scheduleIds: [], deletedSchedules: [] }
        reclaimHeartbeatWorkspacesTx(tx, deletedSchedules)
        return { result, scheduleIds }
      })
      agentService.notifyDeleted(agentId, result)
      this.syncSchedules(scheduleIds)
      application.get('ChannelManager').reconcileAgent(agentId, true)
      const manager = application.get('AiStreamManager')
      result.affectedSessionIds.forEach((sessionId) =>
        manager.pauseRuntimeTurn(buildAgentSessionTopicId(sessionId), 'target-agent-deleted')
      )
      // Sessions that outlive the agent (trashed or permanently deleted) keep
      // their queue — kick it so pending deliveries re-evaluate against the gone agent.
      await this.finishDeletion(
        result.affectedSessionIds,
        result.deliveryResults,
        deleteSessions ? [] : result.affectedSessionIds,
        !permanent && deleteSessions
      )
      const deferredWorkspacePaths = await this.removePurgedSystemWorkspaces(
        workspaces.filter(({ path }) => result.purgedSystemWorkspacePaths.includes(path))
      )
      if (permanent && targetState === 'active' && deleteSessions) {
        await reclaimPurgedRuntimeSessions(
          resumeTokensForDeletedSessions(result.deletedSessionIds ?? [], tokensBySession)
        )
      }
      return {
        deleted: result.deleted,
        ...(result.deletedSessionIds ? { deletedSessionIds: result.deletedSessionIds } : {}),
        deferredWorkspacePaths
      }
    }

    return this.withStableSessions(
      () => agentSessionService.listIdsByAgent(agentId),
      deleteAgent,
      permanent && targetState === 'trashed'
    )
  }

  /**
   * Enqueue one background archive task per archived system workspace inside
   * the caller's trash transaction (issue #21645): the trash commit and the job
   * commit or roll back together, and the request resolves without waiting for
   * the compression. The handler re-reads the business state before packing, so
   * a restored workspace is never re-archived by a stale task. Orchestration
   * lives here, not in the data services, which only report the sessions.
   */
  /** Non-transactional twin used by the orphan sweep. */
  private enqueueWorkspaceArchive(sessionId: string): void {
    application
      .get('JobManager')
      .enqueue(
        'agent.archive-system-workspace',
        { sessionId },
        { idempotencyKey: ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX + sessionId }
      )
  }

  private readonly enqueueWorkspaceArchivesTx: ArchivedSystemWorkspacesHook = (tx, sessionIds) => {
    const jobManager = application.get('JobManager')
    for (const sessionId of sessionIds) {
      jobManager.enqueueTx(
        tx,
        'agent.archive-system-workspace',
        { sessionId },
        { idempotencyKey: ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX + sessionId }
      )
    }
  }

  /**
   * Undo side of the background workspace archive (issue #21645): while a
   * restore reactivates archived workspaces, hold the archive queue
   * ({@link acquireWorkspaceArchiveHold}) so queued packs cannot be claimed,
   * wait out any pack running in this process (an in-flight compression is
   * never aborted mid-pack), then let the caller cancel the still-queued tasks
   * after activation commits ({@link cancelQueuedWorkspaceArchives}). A queued
   * task is cancelled only after the restore commits: on rollback it stays
   * replayable so the still-archived workspace is packed later (the handler's
   * business-state re-read is the backstop).
   *
   * One deadline covers the whole settle batch: workspaces archived together
   * pack together, so each one getting a fresh deadline would let a restore
   * outlive the documented wait bound by a multiple of the workspace count.
   */
  private async settlePendingWorkspaceArchives(workspaces: Array<{ id: string; path: string }>): Promise<void> {
    const deadline = Date.now() + AgentLifecycleService.ARCHIVE_RESTORE_WAIT_TIMEOUT_MS
    for (const workspace of workspaces) {
      let active = jobService.findActiveByIdempotencyKey(ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX + workspace.id)
      if (!active) continue
      // Resolved lazily: a restore with no queued archive never touches the job runtime.
      const jobManager = application.get('JobManager')
      for (;;) {
        // Wait only for a pack running in this process: it holds the
        // per-workspace storage reservation. A 'running' row from a prior
        // process has no live pack here (the reservation died with it) and
        // startup recovery re-queues it shortly, so waiting behind it would
        // stall the restore on the recovery poll instead. Queued/delayed rows
        // hold no storage operation and stay held (never cancelled) until the
        // restore commits.
        if (active.status !== 'running' || !jobManager.isExecutingLocally(active.id)) break
        if (Date.now() >= deadline) {
          throw DataApiErrorFactory.conflict(
            'Workspace archive is still in progress; retry the restore shortly',
            'Workspace'
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        const current = jobService.getById(active.id)
        if (!current || !['running', 'pending', 'delayed'].includes(current.status)) break
        active = current
      }
    }
  }

  /**
   * Suspends claims on the archive queue while a restore (or purge) settles
   * and reactivates workspaces, so a queued pack cannot start against a
   * workspace mid-restore. Returns undefined when no workspace has an active
   * archive row: a restore with no queued archive never touches the job
   * runtime. Dispose the hold once the operation finishes (commit or
   * rollback); disposing kicks dispatch, so tasks kept for rollback replay
   * are claimed normally afterwards.
   */
  private acquireWorkspaceArchiveHold(workspaces: Array<{ id: string; path: string }>): Disposable | undefined {
    const hasActiveArchive = workspaces.some((workspace) =>
      jobService.findActiveByIdempotencyKey(ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX + workspace.id)
    )
    return hasActiveArchive ? application.get('JobManager').suspendQueue('agent.workspace-archive') : undefined
  }

  /**
   * Cancels each workspace's queued `agent.archive-system-workspace` task
   * after the caller's operation (restore or purge) committed. Rows running
   * in this process are left to settle on their own (an in-flight pack is
   * never aborted mid-pack); the handler's business-state re-read skips a
   * pack whose workspace is no longer archived.
   */
  private async cancelQueuedWorkspaceArchives(
    workspaces: Array<{ id: string; path: string }>,
    cancelReason: string
  ): Promise<void> {
    const jobManager = application.get('JobManager')
    for (const workspace of workspaces) {
      const active = jobService.findActiveByIdempotencyKey(ARCHIVE_SYSTEM_WORKSPACE_JOB_KEY_PREFIX + workspace.id)
      if (!active || jobManager.isExecutingLocally(active.id)) continue
      if (active.status === 'running') {
        // Prior-process zombie: the pack died with its process, and cancel()
        // could only set cancelRequested — the row would stay non-terminal, an
        // idempotent re-archive would reuse it, and startup recovery would
        // settle the REUSED row cancelled, losing the new compression task.
        // Settle it terminal here instead, freeing the idempotency key.
        jobService.setTerminalTx(application.get('DbService').getDb(), active.id, 'cancelled', undefined, {
          code: JOB_ERROR_CODES.CANCELLED,
          message: cancelReason,
          retryable: false
        })
      } else {
        await jobManager.cancel(active.id, cancelReason)
      }
    }
  }

  /**
   * Returns the paths whose filesystem cleanup was deferred (reservation held
   * by an in-flight pack, or a failed removal): the orphan sweep reclaims them
   * later, and callers reporting reclamation success must treat them as
   * outstanding.
   */
  private async removePurgedSystemWorkspaces(workspaces: Array<{ id: string; path: string }>): Promise<string[]> {
    // A purge racing the background archive pack loses the workspace's storage
    // reservation to it: purgeWorkspace then silently skips filesystem cleanup
    // while the deleted session's archive publishes unclaimed. Settle first,
    // the same way a restore does — cancel a queued pack, wait out a running
    // one — so the purge below actually reclaims the directory. A settle that
    // times out keeps the old fallback: purge skips and the orphan sweep
    // reclaims the directory later.
    const archiveHold = this.acquireWorkspaceArchiveHold(workspaces)
    try {
      await this.settlePendingWorkspaceArchives(workspaces)
      await this.cancelQueuedWorkspaceArchives(workspaces, 'Workspace permanently deleted before its archive ran')
    } catch (error) {
      logger.warn('Workspace archive still in progress during permanent delete; purge may defer to orphan sweep', {
        workspacePaths: workspaces.map(({ path }) => path),
        error
      })
    } finally {
      archiveHold?.dispose()
    }
    const deferred: string[] = []
    for (const workspace of workspaces) {
      try {
        if (!(await agentWorkspaceStorageService.purgeWorkspace(workspace))) deferred.push(workspace.path)
      } catch (error) {
        deferred.push(workspace.path)
        logger.warn('Failed to remove purged Agent Session workspace', { workspacePath: workspace.path, error })
      }
    }
    return deferred
  }

  private async deleteAgentSessionsInternal(agentId: string): Promise<{ deletedIds: string[] }> {
    // Scope both sameIds and assertSessionsSettled to conversations so a running
    // heartbeat outside this archive cannot trigger a retry or block admission.
    return this.withStableSessions(
      () => agentSessionService.listActiveIdsByAgent(agentId, { sessionTypes: ['conversation'] }),
      async () => {
        // Recycle Bin moves: the only caller is the "clear this agent's sessions" command, which is undoable.
        await application
          .get('AgentDelegationService')
          .cancelOwnedBy(agentSessionService.listActiveIdsByAgent(agentId, { sessionTypes: ['conversation'] }))
        const result = agentSessionService.deleteByAgentIdWithImpact(agentId, {
          permanent: false,
          sessionTypes: ['conversation'],
          onArchivedSystemWorkspacesTx: this.enqueueWorkspaceArchivesTx
        })
        await this.finishDeletion(result.deletedIds, result.deliveryResults, [], true)
        return { deletedIds: result.deletedIds }
      },
      false
    )
  }

  private async deleteWorkspaceInternal(workspaceId: string): Promise<{ deletedIds: string[] }> {
    return this.withStableSessions(
      () => agentSessionService.listIdsByWorkspace(workspaceId),
      async () => {
        await application
          .get('AgentDelegationService')
          .cancelOwnedBy(agentSessionService.listIdsByWorkspace(workspaceId))
        const result = agentSessionService.deleteWorkspaceCascadeWithImpact(workspaceId)
        await this.finishDeletion(result.deletedIds, result.deliveryResults)
        return { deletedIds: result.deletedIds }
      },
      true
    )
  }

  private async finishDeletion(
    sessionIds: string[],
    deliveryResults: AgentSessionMessageEntity[],
    retrySessionIds: string[] = [],
    archiveClose = false
  ): Promise<void> {
    const closed = await Promise.allSettled(
      sessionIds.map(async (sessionId) => {
        const runtime = application.get('AgentSessionRuntimeService')
        await runtime.cancelSessionForks(sessionId)
        // An archive acknowledgement must wait for strict teardown (warm-query
        // disposal and the closing barrier), not just the permissive close: the
        // pack worker's own strict barrier must not be the only one (issue
        // #21645). Purges keep the permissive close.
        if (archiveClose) await runtime.closeSessionForArchive(sessionId)
        else await runtime.closeSession(sessionId)
      })
    )
    await application
      .get('AgentSessionRuntimeService')
      .recoverSessionForks()
      .catch((error) => logger.warn('Fork cleanup remains pending after session deletion', { error }))
    for (const deliveryResult of deliveryResults)
      application.get('AgentSessionDeliveryService').kick(deliveryResult.sessionId)
    retrySessionIds.forEach((sessionId) => application.get('AgentSessionDeliveryService').kick(sessionId))

    closed.forEach((result, index) => {
      if (result.status !== 'rejected') return
      // The directory is retained and the archive task stays queued for retry:
      // a failed close must not drop the workspace archive (issue #21645).
      logger.error('Failed to close deleted Agent Session runtime', {
        sessionId: sessionIds[index],
        error: result.reason
      })
    })
  }

  private static readonly ARCHIVE_RESTORE_WAIT_TIMEOUT_MS = 5 * 60 * 1000

  private async withStableSessions<T>(
    readIds: () => string[],
    operation: () => T | Promise<T>,
    permanent: boolean
  ): Promise<T> {
    for (;;) {
      const sessionIds = readIds()
      const apply = async () => {
        if (permanent) await this.drainSessions(sessionIds)
        const currentSessionIds = readIds()
        if (!this.sameIds(sessionIds, currentSessionIds)) return RETRY_AGENT_SESSION_ARCHIVE
        if (!permanent) this.assertSessionsSettled(sessionIds)
        return operation()
      }
      const result = await (permanent
        ? this.withOperationLocks(sessionIds, apply)
        : this.withSessionLocks(sessionIds, apply))
      if (result !== RETRY_AGENT_SESSION_ARCHIVE) return result
    }
  }

  private withSessionLocks<T>(sessionIds: string[], operation: () => T | Promise<T>): Promise<T> {
    const manager = application.get('AiStreamManager')
    const ids = [...new Set(sessionIds)].sort()
    const acquire = (index: number): Promise<T> => {
      const sessionId = ids[index]
      if (!sessionId) return Promise.resolve(operation())
      return manager.withDispatchLock(buildAgentSessionTopicId(sessionId), () => acquire(index + 1))
    }
    return this.withOperationLocks(ids, () => acquire(0))
  }

  private assertSessionsSettled(sessionIds: string[]): void {
    const manager = application.get('AiStreamManager')
    const runtime = application.get('AgentSessionRuntimeService')
    const busySessionIds = sessionIds.filter(
      (sessionId) =>
        manager.hasUnsettledTopicWork(buildAgentSessionTopicId(sessionId)) || runtime.isSessionBusyForArchive(sessionId)
    )
    if (busySessionIds.length > 0) throw new AgentSessionArchiveBusyError(busySessionIds)
  }

  private sameIds(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index])
  }
}
