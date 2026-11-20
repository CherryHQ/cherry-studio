import { existsSync } from 'node:fs'

import { application } from '@application'
import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { loggerService } from '@logger'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { terminalConversationId } from '@main/services/terminal/contracts'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type {
  ReusableAgentSessionPlaceholdersResponse,
  ReuseOrCreateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { KeyedMutex } from '@shared/utils/async'

import { buildAgentSessionTopicId } from '../agentSession/topic'
import { reclaimPurgedRuntimeSessions, sweepAgentOrphans } from './agentOrphanSweep'
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
  'AgentSessionDeliveryService',
  'AgentSessionRuntimeService',
  'AiStreamManager',
  'ChannelManager',
  'TerminalService',
  'AgentWorkspaceStorageService'
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

  restoreAgent(agentId: string) {
    return this.runOperation('restore-agent:' + agentId, () =>
      this.agentLocks.runExclusive(agentId, () =>
        this.withOperationLocks(agentSessionService.listIdsByAgent(agentId), async () => {
          const workspaces = agentSessionService
            .listSystemWorkspaceSessions(agentSessionService.listIdsByAgent(agentId))
            .filter((workspace) => workspace.deletedAt !== null && workspace.deletedAt === workspace.agentDeletedAt)
          const { agent, scheduleIds, restoredSessionIds } = await this.withQuiescedWorkspaces(workspaces, () =>
            application.get('AgentWorkspaceStorageService').restoreWorkspaces(workspaces, () =>
              application.get('DbService').withWriteTx((tx) => {
                const { agent, restoredSessionIds } = agentService.restoreAgentTx(tx, agentId)
                return {
                  agent,
                  restoredSessionIds,
                  scheduleIds: agentTaskService.setOwnerStateTx(tx, agentId, 'active', Date.now()).scheduleIds
                }
              })
            )
          )
          for (const id of restoredSessionIds)
            await application.get('TerminalService').reopenConversation(terminalConversationId.parse(id))
          this.syncSchedules(scheduleIds)
          application.get('ChannelManager').reconcileAgent(agentId)
          agentSessionService.notifyReadModelChange(restoredSessionIds, 'membership')
          agentService.notifyReadModelChange([agentId], 'membership')
          return agent
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
            const trashed = agentSessionService.trashByIdsTx(tx, ids)
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

  async retryWorkspaceCleanup(id: string): Promise<{ status: 'confirmed' | 'unconfirmed' | 'unavailable' }> {
    const storage = application.get('AgentWorkspaceStorageService')
    if (await storage.discardFailedAdmission(id)) return { status: 'confirmed' }
    const record = (await storage.listUnconfirmedUsage()).find((item) => item.id === id)
    if (!record) {
      await storage.releaseUsage(id)
      return { status: (await storage.cleanupStatus()).recoveryFailed ? 'unavailable' : 'confirmed' }
    }
    const owner = record.owner
    if (owner.kind === 'terminal') {
      const terminal = application.get('TerminalService')
      const resource = terminal
        .list(terminalConversationId.parse(record.sessionId))
        .find((item) => item.id === owner.resourceId && item.host.generation === owner.generation)
      if (!resource) return { status: 'unavailable' }
      const receipt = await terminal.mutate(
        { host: resource.host, id: resource.id },
        {
          kind: 'stop',
          id: resource.id,
          actor: { kind: 'user' },
          controlRevision: resource.controlRevision,
          cancelRevision: resource.cancelRevision,
          reason: 'user'
        },
        crypto.randomUUID()
      )
      if (receipt.kind !== 'resource' || receipt.resource.cleanup !== 'confirmed') return { status: 'unconfirmed' }
      await storage.releaseUsage(id)
      return { status: 'confirmed' }
    }
    if (owner.kind === 'runtime' && (await application.get('AgentSessionRuntimeService').retryWorkspaceCleanup(id))) {
      await storage.releaseUsage(id)
      return { status: 'confirmed' }
    }
    return { status: 'unavailable' }
  }

  createUserTerminal(input: { sessionId: string; shell: 'default' | 'bash' | 'powershell'; operationId: string }) {
    return this.runOperation('create-user-terminal:' + input.sessionId, async () => {
      const session = agentSessionService.getById(input.sessionId)
      const terminal = application.get('TerminalService')
      const revision = terminal.workspaceRevision(input.sessionId)
      return terminal.createUserTerminal(
        input.sessionId,
        session.workspace.path,
        input.shell,
        input.operationId,
        revision,
        () => prepareAgentSessionWorkspaceDirectory(session)
      )
    })
  }

  setSessionWorkspace(id: string, source: AgentSessionWorkspaceSource) {
    return this.runOperation('set-session-workspace:' + id, () =>
      this.sessionLocks.runExclusive(id, async () => {
        const current = agentSessionService.getConversationById(id)
        const unchanged =
          source.type === 'system' ? current.workspace.type === 'system' : current.workspaceId === source.workspaceId
        if (unchanged) return current
        agentSessionService.assertWorkspaceChangeAllowed(id)
        return application
          .get('AgentSessionRuntimeService')
          .changeWorkspace(id, () =>
            application.get('TerminalService').changeWorkspace(id, () => agentSessionService.setWorkspace(id, source))
          )
      })
    )
  }

  restoreSession(id: string) {
    return this.runOperation('restore-session:' + id, () =>
      this.sessionLocks.runExclusive(id, async () => {
        const workspaces = agentSessionService
          .listSystemWorkspaceSessions([id])
          .filter((workspace) => workspace.deletedAt !== null)
        const restored = await this.withQuiescedWorkspaces(workspaces, () =>
          application
            .get('AgentWorkspaceStorageService')
            .restoreWorkspaces(workspaces, () => agentSessionService.restore(id))
        )
        await application.get('TerminalService').reopenConversation(terminalConversationId.parse(id))
        return restored
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
              if (workspace.deletedAt !== null) await this.quiesceWorkspace(workspace.id)
              await application
                .get('AgentWorkspaceStorageService')
                .reconcileWorkspace(workspace, workspace.deletedAt === null ? 'active' : 'archived')
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

        const workspaces = agentSessionService.listSystemWorkspaceSessions(expiredSessionIds)
        const tokensBySession = agentSessionMessageService.listRuntimeResumeTokensBySession(expiredSessionIds)
        const purgedIds =
          expiredSessionIds.length === 0
            ? []
            : application
                .get('DbService')
                .withWriteTx((tx) => agentSessionService.purgeExpiredByIdsTx(tx, expiredSessionIds, cutoffMs))
        agentSessionService.notifyPurged(purgedIds)
        await this.removePurgedSystemWorkspaces(workspaces.filter(({ id }) => purgedIds.includes(id)))
        await reclaimPurgedRuntimeSessions(resumeTokensForDeletedSessions(purgedIds, tokensBySession))
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
      const workspaces = agentSessionService.listSystemWorkspaceSessions(ids)
      const tokensBySession = permanent
        ? agentSessionMessageService.listRuntimeResumeTokensBySession(ids)
        : new Map<string, Set<string>>()
      const result = agentSessionService.deleteByIdsWithImpact(ids, {
        permanent,
        ...(targetState === 'active' ? { targetState } : {})
      })
      await this.finishDeletion(result.deletedIds, result.deliveryResults)
      await this.removePurgedSystemWorkspaces(
        workspaces.filter(({ path }) => result.purgedSystemWorkspacePaths.includes(path))
      )
      if (permanent) {
        await reclaimPurgedRuntimeSessions(resumeTokensForDeletedSessions(result.deletedIds, tokensBySession))
      }
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
      const workspaces = agentSessionService.listSystemWorkspaceSessions(agentSessionService.listIdsByAgent(agentId))
      const tokensBySession =
        permanent && targetState === 'active' && deleteSessions
          ? agentSessionMessageService.listRuntimeResumeTokensBySession(agentSessionService.listIdsByAgent(agentId))
          : new Map<string, Set<string>>()
      const { result, scheduleIds } = application.get('DbService').withWriteTx((tx) => {
        const result = agentService.deleteAgentStateTx(tx, agentId, { deleteSessions, permanent, targetState })
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
        deleteSessions ? [] : result.affectedSessionIds
      )
      await this.removePurgedSystemWorkspaces(
        workspaces.filter(({ path }) => result.purgedSystemWorkspacePaths.includes(path))
      )
      if (permanent && targetState === 'active' && deleteSessions) {
        await reclaimPurgedRuntimeSessions(
          resumeTokensForDeletedSessions(result.deletedSessionIds ?? [], tokensBySession)
        )
      }
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

  private async withQuiescedWorkspaces<T>(
    workspaces: Array<{ id: string; path: string }>,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!workspaces.length) return operation()
    const storage = application.get('AgentWorkspaceStorageService')
    const paths = workspaces.map((workspace) => workspace.path)
    const release = storage.reserveWorkspaceStorage(
      paths.flatMap((path) => storage.workspaceStoragePaths(path)),
      paths
    )
    if (!release && existsSync(application.getPath('feature.agents.system_workspaces')))
      throw DataApiErrorFactory.conflict(
        'Workspace storage is in use; retry after the operation completes',
        'Workspace'
      )
    try {
      for (const workspace of workspaces) await this.quiesceWorkspace(workspace.id)
      // The storage operation reacquires synchronously, before another admission can run.
      release?.()
      return await operation()
    } finally {
      release?.()
    }
  }

  private async quiesceWorkspace(sessionId: string): Promise<void> {
    const terminals = await application
      .get('TerminalService')
      .closeConversation(terminalConversationId.parse(sessionId))
    const runtime = application.get('AgentSessionRuntimeService')
    await runtime.cancelSessionForks(sessionId)
    await runtime.closeSessionForArchive(sessionId)
    if (terminals.some((state) => state.cleanup !== 'confirmed'))
      throw new Error('Terminal cleanup remains unconfirmed')
  }

  private async removePurgedSystemWorkspaces(workspaces: Array<{ id: string; path: string }>): Promise<void> {
    for (const workspace of workspaces) {
      try {
        await this.withQuiescedWorkspaces([workspace], () =>
          application.get('AgentWorkspaceStorageService').purgeWorkspace(workspace)
        )
      } catch (error) {
        logger.warn('Failed to remove purged Agent Session workspace', { workspacePath: workspace.path, error })
      }
    }
  }

  private async archiveSystemWorkspaces(ids: string[]): Promise<void> {
    for (const workspace of agentSessionService.listSystemWorkspaceSessions(ids)) {
      if (workspace.deletedAt === null) continue
      try {
        await this.withQuiescedWorkspaces([workspace], () =>
          application.get('AgentWorkspaceStorageService').archiveWorkspace(workspace)
        )
      } catch (error) {
        logger.warn('Failed to archive system workspace; retained for retry', { workspacePath: workspace.path, error })
      }
    }
  }

  private async deleteAgentSessionsInternal(agentId: string): Promise<{ deletedIds: string[] }> {
    // Scope both sameIds and assertSessionsSettled to conversations so a running
    // heartbeat outside this archive cannot trigger a retry or block admission.
    return this.withStableSessions(
      () => agentSessionService.listActiveIdsByAgent(agentId, { sessionTypes: ['conversation'] }),
      async () => {
        // Recycle Bin moves: the only caller is the "clear this agent's sessions" command, which is undoable.
        const result = agentSessionService.deleteByAgentIdWithImpact(agentId, {
          permanent: false,
          sessionTypes: ['conversation']
        })
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
        await application.get('TerminalService').closeConversation(terminalConversationId.parse(sessionId))
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
    await this.archiveSystemWorkspaces(sessionIds.filter((_, index) => closed[index].status === 'fulfilled'))
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
        manager.hasUnsettledTopicWork(buildAgentSessionTopicId(sessionId)) || runtime.isSessionBusyForArchive(sessionId)
    )
    if (busySessionIds.length > 0) throw new AgentSessionArchiveBusyError(busySessionIds)
  }

  private sameIds(first: string[], second: string[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index])
  }
}
