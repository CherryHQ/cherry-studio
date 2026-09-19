import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type {
  ReusableAgentSessionPlaceholdersResponse,
  ReuseOrCreateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'

import { buildAgentSessionTopicId } from '../agentSession/topic'
import { removeAgentStorageSubdirectory } from './agentDataDirectory'
import { sweepAgentOrphans } from './agentOrphanSweep'

const logger = loggerService.withContext('AgentLifecycleService')
const RETRY_AGENT_SESSION_ARCHIVE = Symbol('retry-agent-session-archive')

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
  'AgentSessionDeliveryService',
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
    application.get('DbService').withWriteTx((tx) => agentTaskService.reconcileOwnerStatesTx(tx, Date.now()))
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

  restoreAgent(agentId: string) {
    return this.runOperation('restore-agent:' + agentId, () =>
      this.agentLocks.runExclusive(agentId, () => {
        const { agent, scheduleIds } = application.get('DbService').withWriteTx((tx) => ({
          agent: agentService.restoreAgentTx(tx, agentId),
          scheduleIds: agentTaskService.setOwnerStateTx(tx, agentId, 'active', Date.now())
        }))
        this.syncSchedules(scheduleIds)
        application.get('ChannelManager').reconcileAgent(agentId)
        agentService.notifyReadModelChange([agentId], 'membership')
        return agent
      })
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
      this.sessionLocks.runExclusive(id, () => agentSessionService.restore(id))
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
      for (const id of ids) {
        await this.agentLocks.runExclusive(id, async () => {
          if (!agentService.isExpiredTrash(id, cutoffMs)) return
          const result = await this.deleteAgentInternal(id, false, true)
          if (result.deleted) purgedIds.push(id)
        })
      }
      return { purgedIds, hasMore: ids.length === limit }
    })
  }

  reconcile() {
    return this.runOperation('reconcile-agent-schedules', () => {
      const ids = application
        .get('DbService')
        .withWriteTx((tx) => agentTaskService.reconcileOwnerStatesTx(tx, Date.now()))
      this.syncSchedules(ids)
      return ids.length
    })
  }

  sweepOrphans(signal?: AbortSignal) {
    return this.runOperation('sweep-agent-orphans', () => sweepAgentOrphans(signal))
  }

  pauseIngress(reason?: string): Disposable {
    const token = Symbol(reason)
    this.ingressHolds.add(token)
    const channelHold = application.get('ChannelManager').pause(reason)
    return {
      dispose: () => {
        if (!this.ingressHolds.delete(token)) return
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
  ): Promise<{ purgedIds: string[]; hasMore: boolean }> {
    const hold = application.get('AgentSessionDeliveryService').pause('trash-purge')
    try {
      const sessionIds = agentSessionService.listExpiredTrashIds(cutoffMs, limit)
      if (sessionIds.length === 0) return { purgedIds: [], hasMore: false }

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

        const purgedIds =
          expiredSessionIds.length === 0
            ? []
            : application
                .get('DbService')
                .withWriteTx((tx) => agentSessionService.purgeExpiredByIdsTx(tx, expiredSessionIds, cutoffMs))
        agentSessionService.notifyPurged(purgedIds)
        return { purgedIds, hasMore: sessionIds.length === limit }
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
  ): Promise<{ deletedIds: string[] }> {
    const deleteSessions = async () => {
      const result = agentSessionService.deleteByIdsWithImpact(ids, {
        permanent,
        ...(targetState === 'active' ? { targetState } : {})
      })
      await this.finishDeletion(result.deletedIds, result.deliveryResults)
      await this.removePurgedSystemWorkspaces(result.purgedSystemWorkspacePaths)
      return { deletedIds: result.deletedIds }
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
  ): Promise<{ deleted: boolean; deletedSessionIds?: string[] }> {
    if (permanent && agentService.getLifecycleState(agentId) !== targetState) return { deleted: false }
    const deleteAgent = async () => {
      const { result, scheduleIds } = application.get('DbService').withWriteTx((tx) => {
        const result = agentService.deleteAgentStateTx(tx, agentId, { deleteSessions, permanent, targetState })
        const scheduleIds = result.deleted
          ? agentTaskService.setOwnerStateTx(tx, agentId, permanent ? 'missing' : 'trashed', Date.now())
          : []
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
        deleteSessions ? [] : result.affectedSessionIds
      )
      await this.removePurgedSystemWorkspaces(result.purgedSystemWorkspacePaths)
      return {
        deleted: result.deleted,
        ...(result.deletedSessionIds ? { deletedSessionIds: result.deletedSessionIds } : {})
      }
    }

    return this.withStableSessions(
      () => agentSessionService.listIdsByAgent(agentId),
      deleteAgent,
      permanent && targetState === 'trashed'
    )
  }

  private async removePurgedSystemWorkspaces(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    const root = application.getPath('feature.agents.system_workspaces')
    for (const workspacePath of paths) {
      try {
        await removeAgentStorageSubdirectory(root, workspacePath)
      } catch (error) {
        logger.warn('Failed to remove purged Agent Session workspace', { workspacePath, error })
      }
    }
  }

  private async deleteAgentSessionsInternal(agentId: string): Promise<{ deletedIds: string[] }> {
    return this.withStableSessions(
      () => agentSessionService.listActiveIdsByAgent(agentId),
      async () => {
        // Recycle Bin moves: the only caller is the "clear this agent's sessions" command, which is undoable.
        const result = agentSessionService.deleteByAgentIdWithImpact(agentId, { permanent: false })
        await this.finishDeletion(result.deletedIds, result.deliveryResults)
        return { deletedIds: result.deletedIds }
      },
      false
    )
  }

  private async deleteWorkspaceInternal(workspaceId: string): Promise<{ deletedIds: string[] }> {
    return this.withStableSessions(
      () => agentSessionService.listIdsByWorkspace(workspaceId),
      async () => {
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
    retrySessionIds: string[] = []
  ): Promise<void> {
    const closed = await Promise.allSettled(
      sessionIds.map(async (sessionId) => {
        const runtime = application.get('AgentSessionRuntimeService')
        await runtime.cancelSessionForks(sessionId)
        await runtime.closeSession(sessionId)
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
      logger.error('Failed to close deleted Agent Session runtime', {
        sessionId: sessionIds[index],
        error: result.reason
      })
    })
  }

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
        manager.hasUnsettledTopicWork(buildAgentSessionTopicId(sessionId)) || runtime.isSessionBusy(sessionId)
    )
    if (busySessionIds.length > 0) throw new AgentSessionArchiveBusyError(busySessionIds)
  }

  private sameIds(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index])
  }
}
