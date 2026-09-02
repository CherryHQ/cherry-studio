import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { AgentSessionDeliveryRoutingError, agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { isAgentSessionWorkspaceError } from '@main/ai/runtime/agentSessionWorkspace'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type {
  AgentSessionEntity,
  ReusableAgentSessionPlaceholdersResponse,
  ReuseOrCreateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

import { agentChatContextProvider, finalizeInterruptedParts, type StreamListener } from '../streamManager'
import { buildAgentSessionTopicId } from './topic'

const logger = loggerService.withContext('AgentSessionDeliveryService')
// Filesystem availability has no app event (for example, an external workspace volume remount).
// Keep this low-frequency fallback; move to path-specific events if the platform exposes them.
const DELIVERY_RETRY_SWEEP_MS = 60_000

class DeliveryClaimLostError extends Error {}

class AgentSessionDeliverySubscriber implements StreamListener {
  readonly id: string

  constructor(messageId: string) {
    this.id = `agent-delivery:${messageId}`
  }

  onChunk(): void {}
  onDone(): void {}
  onPaused(): void {}
  onError(): void {}
  isAlive(): boolean {
    return true
  }
}

export type AcceptSessionDeliveryInput = {
  senderAgentId: string
  senderSessionId: string
  receiverSessionId: string
  content: string
  replyPolicy?: 'none' | 'completion'
}

export type CreateSessionDeliveryInput = {
  senderAgentId: string
  senderSessionId: string
  sessionName: string
  workspace: AgentSessionWorkspaceSource
  content: string
}

@Injectable('AgentSessionDeliveryService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AgentSessionRuntimeService', 'AiStreamManager'])
export class AgentSessionDeliveryService extends BaseService {
  private readonly pauseHolds = new Set<symbol>()
  private readonly kicks = new Map<string, Promise<void>>()
  private readonly pendingKicks = new Set<string>()
  private readonly inFlight = new Map<Promise<void>, string>()
  private readonly suppressedSessionIds = new Set<string>()
  private isShuttingDown = false

  protected override onInit(): void {
    this.isShuttingDown = false
    const runtime = application.get('AgentSessionRuntimeService')
    this.registerDisposable(
      runtime.onTurnTerminal((event) => {
        if (event.boundary === 'row-roll') return
        this.track(`terminal:${event.assistantMessageId}`, this.handleTurnTerminal(event))
      })
    )
    this.registerDisposable(runtime.onRuntimeIdle(({ sessionId }) => this.kick(sessionId)))
    this.recoverDeliveries()
    this.registerInterval(() => this.kick(), DELIVERY_RETRY_SWEEP_MS)
    this.kick()
  }

  protected override async onStop(): Promise<void> {
    this.isShuttingDown = true
    await this.waitForInFlight()
  }

  accept(input: AcceptSessionDeliveryInput): AgentSessionMessageEntity {
    this.assertWritesAvailable()
    const message = agentSessionMessageService.acceptSessionDelivery(input)
    this.kick(message.sessionId)
    return message
  }

  acceptWithNewSession(input: CreateSessionDeliveryInput): {
    session: AgentSessionEntity
    message: AgentSessionMessageEntity
  } {
    this.assertWritesAvailable()
    const created = agentSessionMessageService.createSessionWithDelivery(input)
    this.kick(created.message.sessionId)
    return created
  }

  deleteSessions(ids: string[], permanent: boolean = false): Promise<{ deletedIds: string[] }> {
    const uniqueIds = [...new Set(ids)]
    const work = this.deleteSessionsInternal(uniqueIds, permanent)
    this.track(
      `delete:${uniqueIds.join(',')}`,
      work.then(() => undefined)
    )
    return work
  }

  reuseOrCreateSession(input: ReuseOrCreateAgentSessionDto): Promise<ReusableAgentSessionPlaceholdersResponse> {
    const work = this.reuseOrCreateSessionInternal(input)
    this.track(
      `reuse-or-create:${input.agentId}`,
      work.then(() => undefined)
    )
    return work
  }

  deleteAgent(
    agentId: string,
    deleteSessions: boolean,
    permanent: boolean = false
  ): Promise<{ deleted: boolean; deletedSessionIds?: string[] }> {
    const work = this.deleteAgentInternal(agentId, deleteSessions, permanent)
    this.track(
      `delete-agent:${agentId}`,
      work.then(() => undefined)
    )
    return work
  }

  deleteAgentSessions(agentId: string): Promise<{ deletedIds: string[] }> {
    const work = this.deleteAgentSessionsInternal(agentId)
    this.track(
      `delete-agent-sessions:${agentId}`,
      work.then(() => undefined)
    )
    return work
  }

  deleteWorkspace(workspaceId: string): Promise<{ deletedIds: string[] }> {
    const work = this.deleteWorkspaceInternal(workspaceId)
    this.track(
      `delete-workspace:${workspaceId}`,
      work.then(() => undefined)
    )
    return work
  }

  kick(sessionId?: string): void {
    if (this.isShuttingDown) return
    if (this.isWriteQuiesced) {
      if (sessionId) this.suppressedSessionIds.add(sessionId)
      else {
        for (const message of agentSessionMessageService.listRecoverableSessionDeliveries()) {
          this.suppressedSessionIds.add(message.sessionId)
        }
      }
      return
    }

    if (!sessionId) {
      for (const targetSessionId of new Set(
        agentSessionMessageService.listRecoverableSessionDeliveries().map((message) => message.sessionId)
      )) {
        this.kick(targetSessionId)
      }
      return
    }
    if (this.kicks.has(sessionId)) {
      this.pendingKicks.add(sessionId)
      return
    }

    const work = Promise.resolve()
      .then(() => this.runSessionQueue(sessionId))
      .catch((error) => logger.error('Agent Session delivery kick failed', { sessionId, error }))
      .finally(() => {
        this.kicks.delete(sessionId)
        this.inFlight.delete(work)
        if (this.pendingKicks.delete(sessionId)) this.kick(sessionId)
      })
    this.kicks.set(sessionId, work)
    this.inFlight.set(work, `kick:${sessionId}`)
  }

  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  pause(reason?: string): Disposable {
    const token = Symbol(reason)
    this.pauseHolds.add(token)
    logger.info('AgentSessionDeliveryService paused', { reason: reason ?? null, holds: this.pauseHolds.size })
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('AgentSessionDeliveryService pause hold released', {
          reason: reason ?? null,
          holds: this.pauseHolds.size
        })
        if (this.pauseHolds.size > 0 || this.isShuttingDown) return
        const sessionIds = [...this.suppressedSessionIds]
        this.suppressedSessionIds.clear()
        if (sessionIds.length === 0) this.kick()
        else sessionIds.forEach((sessionId) => this.kick(sessionId))
      }
    }
  }

  async drainInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    const deadline = Date.now() + opts.timeoutMs
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      const snapshot = [...this.inFlight.keys()]
      const remaining = deadline - Date.now()
      await Promise.race([
        Promise.allSettled(snapshot),
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(remaining, 0)))
      ])
    }
    return { stragglerIds: [...this.inFlight.values()] }
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return [...this.inFlight.values()].map((id) => ({ id, summary: 'Agent Session delivery handoff' }))
  }

  private track(id: string, work: Promise<void>): void {
    this.inFlight.set(work, id)
    void work
      .catch((error) => logger.error('Tracked Agent Session delivery work failed', { id, error }))
      .finally(() => this.inFlight.delete(work))
  }

  private async waitForInFlight(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.keys()])
    }
  }

  private async deleteSessionsInternal(ids: string[], permanent: boolean): Promise<{ deletedIds: string[] }> {
    this.assertWritesAvailable()
    const result = agentSessionService.deleteByIdsForDelivery(ids, { permanent })
    await this.finishDeletion(result.deletedIds, result.deliveryResults)
    return { deletedIds: result.deletedIds }
  }

  private async reuseOrCreateSessionInternal(
    input: ReuseOrCreateAgentSessionDto
  ): Promise<ReusableAgentSessionPlaceholdersResponse> {
    this.assertWritesAvailable()
    const result = agentSessionService.reuseOrCreatePlaceholderForDelivery(input)
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
    permanent: boolean
  ): Promise<{ deleted: boolean; deletedSessionIds?: string[] }> {
    this.assertWritesAvailable()
    const result = agentService.deleteAgentForDelivery(agentId, { deleteSessions, permanent })
    if (!deleteSessions) {
      const manager = application.get('AiStreamManager')
      result.affectedSessionIds.forEach((sessionId) =>
        manager.pauseRuntimeTurn(buildAgentSessionTopicId(sessionId), 'target-agent-deleted')
      )
    }
    // Sessions that outlive the agent (trashed or permanently deleted) keep
    // their queue — kick it so pending deliveries re-evaluate against the gone agent.
    await this.finishDeletion(
      result.affectedSessionIds,
      result.deliveryResults,
      deleteSessions ? [] : result.affectedSessionIds
    )
    return {
      deleted: result.deleted,
      ...(result.deletedSessionIds ? { deletedSessionIds: result.deletedSessionIds } : {})
    }
  }

  private async deleteAgentSessionsInternal(agentId: string): Promise<{ deletedIds: string[] }> {
    this.assertWritesAvailable()
    // Recycle Bin moves: the only caller is the "clear this agent's sessions" command, which is undoable.
    const result = agentSessionService.deleteByAgentIdForDelivery(agentId, { permanent: false })
    await this.finishDeletion(result.deletedIds, result.deliveryResults)
    return { deletedIds: result.deletedIds }
  }

  private async deleteWorkspaceInternal(workspaceId: string): Promise<{ deletedIds: string[] }> {
    this.assertWritesAvailable()
    const result = agentSessionService.deleteWorkspaceCascadeForDelivery(workspaceId)
    await this.finishDeletion(result.deletedIds, result.deliveryResults)
    return { deletedIds: result.deletedIds }
  }

  private async finishDeletion(
    sessionIds: string[],
    deliveryResults: AgentSessionMessageEntity[],
    retrySessionIds: string[] = []
  ): Promise<void> {
    const closed = await Promise.allSettled(
      sessionIds.map((sessionId) => application.get('AgentSessionRuntimeService').closeSession(sessionId))
    )
    for (const deliveryResult of deliveryResults) this.kick(deliveryResult.sessionId)
    retrySessionIds.forEach((sessionId) => this.kick(sessionId))

    const failures = closed.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more deleted Agent Session runtimes failed to close')
    }
  }

  private assertWritesAvailable(): void {
    if (this.isShuttingDown || this.isWriteQuiesced || application.get('AiStreamManager').isWriteQuiesced) {
      throw new Error('Agent Session delivery writes are paused')
    }
  }

  private async runSessionQueue(sessionId: string): Promise<void> {
    let revalidatedRequestId: string | undefined
    while (!this.isShuttingDown && !this.isWriteQuiesced) {
      if (this.reconcileCompletedDelivery(sessionId)) return
      const next = agentSessionMessageService.listAcceptedSessionDeliveries(sessionId)[0]
      if (!next) return
      const outcome = await this.dispatchOne(next)
      if (outcome === 'settled') {
        revalidatedRequestId = undefined
        continue
      }
      // Validation crosses an async boundary, so one fresh snapshot retry is useful. Never spin on
      // one durable row: a deterministic mismatch must release backup/shutdown drains.
      if (outcome === 'revalidate' && revalidatedRequestId !== next.id) {
        revalidatedRequestId = next.id
        continue
      }
      return
    }
  }

  private async dispatchOne(
    message: AgentSessionMessageEntity
  ): Promise<'blocked' | 'started' | 'settled' | 'revalidate' | 'stale'> {
    const manager = application.get('AiStreamManager')
    const runtime = application.get('AgentSessionRuntimeService')
    const topicId = buildAgentSessionTopicId(message.sessionId)
    let outcome: 'blocked' | 'started' | 'settled' | 'revalidate' | 'stale' = 'stale'

    await manager.withDispatchLock(topicId, async () => {
      if (this.isShuttingDown || this.isWriteQuiesced || manager.isWriteQuiesced) {
        this.suppressedSessionIds.add(message.sessionId)
        outcome = 'blocked'
        return
      }
      if (manager.hasLiveStream(topicId) || runtime.isSessionBusy(message.sessionId)) {
        outcome = 'blocked'
        return
      }

      let current: AgentSessionMessageEntity
      try {
        current = agentSessionMessageService.getSessionMessage(message.sessionId, message.id)
      } catch (error) {
        if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return
        throw error
      }
      if (current.delivery?.status !== 'accepted') return

      let validated
      try {
        validated = await agentChatContextProvider.validateDispatch({
          trigger: 'submit-message',
          topicId,
          userMessageParts: current.data.parts ?? [],
          headless: true,
          agentDeliveryMessage: current
        })
      } catch (error) {
        if (isAgentSessionWorkspaceError(error) && error.retryable) {
          logger.warn('Agent Session delivery target workspace is temporarily unavailable', {
            deliveryId: current.id,
            sessionId: current.sessionId,
            error
          })
          outcome = 'blocked'
          return
        }
        this.failBeforeStart(current, error)
        outcome = 'settled'
        return
      }

      // Validation crosses an async boundary. Backup pause, lifecycle stop, or another writer may
      // have changed admission state while the driver was validating the target.
      if (this.isShuttingDown || this.isWriteQuiesced || manager.isWriteQuiesced) {
        this.suppressedSessionIds.add(message.sessionId)
        outcome = 'blocked'
        return
      }
      if (manager.hasLiveStream(topicId) || runtime.isSessionBusy(message.sessionId)) {
        outcome = 'blocked'
        return
      }

      let persisted
      try {
        persisted = application.get('DbService').withWriteTx((tx) => {
          const prepared = agentChatContextProvider.persistDispatchTx(tx, validated, {
            id: validated.agentId,
            updatedAt: validated.agentUpdatedAt,
            model: validated.uniqueModelId,
            type: validated.agentType
          })
          const claimed = agentSessionMessageService.claimSessionDeliveryTx(
            tx,
            current.sessionId,
            current.id,
            prepared.assistantMessageId
          )
          if (!claimed) throw new DeliveryClaimLostError(`Delivery ${current.id} lost its accepted claim`)
          return prepared
        })
      } catch (error) {
        if (error instanceof DeliveryClaimLostError) return
        if (isDataApiError(error) && error.code === ErrorCode.CONCURRENT_MODIFICATION) {
          outcome = 'revalidate'
          return
        }
        this.failBeforeStart(current, error)
        outcome = 'settled'
        return
      }

      agentSessionMessageService.publishDispatchChanges(current.sessionId, persisted.savedMessages)

      try {
        const prepared = agentChatContextProvider.activateDispatch(
          persisted,
          new AgentSessionDeliverySubscriber(current.id)
        )
        try {
          manager.send({
            topicId: prepared.topicId,
            models: prepared.models,
            listeners: prepared.listeners,
            siblingsGroupId: prepared.siblingsGroupId,
            lifecycle: prepared.lifecycle
          })
        } catch (error) {
          // send() launches before its final lifecycle callback. A callback failure can therefore
          // throw after ownership has crossed into a live stream; do not label that turn pre-start
          // failure or make it eligible for replay.
          if (!manager.hasLiveStream(prepared.topicId)) throw error
          logger.warn('Delivery send threw after runtime ownership handoff; keeping it delivering', error as Error, {
            requestId: current.id,
            sessionId: current.sessionId,
            assistantMessageId: persisted.assistantMessageId
          })
        }
        outcome = 'started'
      } catch (error) {
        await runtime.closeSession(current.sessionId)
        const assistant = persisted.savedMessages[1]
        agentSessionMessageService.resolveCrashOrphanedMessages(
          [
            {
              id: persisted.assistantMessageId,
              data: {
                ...assistant.data,
                parts: finalizeInterruptedParts(assistant.data.parts ?? [], 'error')
              }
            }
          ],
          [current.sessionId]
        )
        const result = agentSessionMessageService.finalizeSessionDelivery({
          requestSessionId: current.sessionId,
          requestMessageId: current.id,
          assistantMessageId: persisted.assistantMessageId,
          outcome: 'interrupted'
        })
        logger.warn('Agent Session delivery turn handoff was interrupted', {
          deliveryId: current.id,
          assistantMessageId: persisted.assistantMessageId,
          error
        })
        if (result) this.kick(result.sessionId)
        outcome = 'settled'
      }
    })
    return outcome
  }

  private failBeforeStart(message: AgentSessionMessageEntity, error: unknown): void {
    const deliveryError =
      error instanceof AgentSessionDeliveryRoutingError
        ? { code: error.code, message: error.message }
        : isAgentSessionWorkspaceError(error)
          ? { code: 'TARGET_UNAVAILABLE', message: error.message }
          : isDataApiError(error) && error.code === ErrorCode.NOT_FOUND
            ? { code: 'TARGET_UNAVAILABLE', message: error.message }
            : {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Internal Session delivery error'
              }
    const result = agentSessionMessageService.failSessionDelivery(message, deliveryError)
    logger.warn('Agent Session delivery admission failed', {
      deliveryId: message.id,
      code: deliveryError.code,
      error
    })
    if (result) this.kick(result.sessionId)
  }

  private async handleTurnTerminal(event: {
    sessionId: string
    assistantMessageId: string
    status: 'success' | 'paused' | 'error'
  }): Promise<void> {
    const request = agentSessionMessageService.findDeliveringSessionDeliveryByTurnRef(event.assistantMessageId)
    if (!request) return
    const result = agentSessionMessageService.finalizeSessionDelivery({
      requestSessionId: event.sessionId,
      requestMessageId: request.id,
      assistantMessageId: event.assistantMessageId,
      outcome: event.status === 'success' ? 'success' : event.status === 'paused' ? 'interrupted' : 'failed'
    })
    if (result) this.kick(result.sessionId)
  }

  private reconcileCompletedDelivery(sessionId: string): boolean {
    const delivering = agentSessionMessageService
      .listRecoverableSessionDeliveries(sessionId)
      .find((message) => message.delivery?.status === 'delivering')
    if (!delivering?.delivery?.turnRef) return false

    let assistant: AgentSessionMessageEntity
    try {
      assistant = agentSessionMessageService.getSessionMessage(sessionId, delivering.delivery.turnRef)
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        const result = agentSessionMessageService.failSessionDelivery(delivering, {
          code: 'DELIVERY_TURN_DELETED',
          message: 'The delivery turn was deleted before it could be finalized'
        })
        if (result) this.kick(result.sessionId)
        return false
      }
      throw error
    }
    if (assistant.status === 'pending') {
      const topicId = buildAgentSessionTopicId(sessionId)
      const manager = application.get('AiStreamManager')
      if (
        application.get('AgentSessionRuntimeService').isSessionBusy(sessionId) ||
        manager.hasLiveStream(topicId) ||
        manager.hasTerminalPersistenceInFlight(topicId)
      ) {
        return true
      }
      // Runtime and stream persistence are idle, so no writer can still complete this placeholder.
      // A transient repair failure is retried by the next idle/sweep kick.
      agentSessionMessageService.markAssistantMessageTerminalError(sessionId, assistant.id)
      assistant = agentSessionMessageService.getSessionMessage(sessionId, assistant.id)
      if (assistant.status === 'pending') return true
    }

    const result = agentSessionMessageService.finalizeSessionDelivery({
      requestSessionId: sessionId,
      requestMessageId: delivering.id,
      assistantMessageId: assistant.id,
      outcome: assistant.status === 'success' ? 'success' : assistant.status === 'paused' ? 'interrupted' : 'failed'
    })
    if (result) this.kick(result.sessionId)
    return false
  }

  private recoverDeliveries(): void {
    const recoverable = agentSessionMessageService.listRecoverableSessionDeliveries()
    for (const message of recoverable) {
      if (message.delivery?.status !== 'delivering') continue
      const turnRef = message.delivery.turnRef
      if (!turnRef) {
        const result = agentSessionMessageService.failSessionDelivery(message, {
          code: 'INTERNAL_ERROR',
          message: 'Delivering Session request has no turn reference'
        })
        if (result) this.suppressedSessionIds.add(result.sessionId)
        continue
      }

      let assistant: AgentSessionMessageEntity | null = null
      try {
        assistant = agentSessionMessageService.getSessionMessage(message.sessionId, turnRef)
      } catch (error) {
        if (!(isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)) throw error
      }
      if (!assistant) {
        const result = agentSessionMessageService.failSessionDelivery(message, {
          code: 'DELIVERY_TURN_DELETED',
          message: 'The delivery turn was deleted before it could be recovered'
        })
        if (result) this.suppressedSessionIds.add(result.sessionId)
        continue
      }
      if (assistant.status === 'pending') {
        agentSessionMessageService.resolveCrashOrphanedMessages(
          [
            {
              id: assistant.id,
              data: {
                ...assistant.data,
                parts: finalizeInterruptedParts(assistant.data.parts ?? [], 'error')
              }
            }
          ],
          [message.sessionId]
        )
      }
      const result = agentSessionMessageService.finalizeSessionDelivery({
        requestSessionId: message.sessionId,
        requestMessageId: message.id,
        assistantMessageId: assistant.id,
        outcome:
          assistant.status === 'success'
            ? 'success'
            : assistant.status === 'paused' || assistant.status === 'pending'
              ? 'interrupted'
              : 'failed'
      })
      if (result) this.suppressedSessionIds.add(result.sessionId)
    }
  }
}
