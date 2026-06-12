import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { Span } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import type { AgentEntity, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryUIMessage } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { startAiTurnTrace } from '../observability'
import {
  type AgentRuntimeConnection,
  type AgentRuntimeEvent,
  type AgentRuntimePolicyUpdate,
  type AgentRuntimeTraceContext,
  runtimeDriverRegistry
} from '../runtime'
import { type DispatchDecision, toolApprovalRegistry } from '../runtime/claudeCode/ToolApprovalRegistry'
import { PersistenceListener } from '../streamManager/listeners/PersistenceListener'
import { TraceFlushListener } from '../streamManager/listeners/TraceFlushListener'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../streamManager/types'
import { AgentSessionMessageBackend } from './persistence/AgentSessionMessageBackend'

const logger = loggerService.withContext('AgentSessionRuntimeService')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000

export type AgentSessionRuntimeStatus = 'active' | 'idle'
export type AgentSessionRuntimeTerminalStatus = 'success' | 'paused' | 'error'

/**
 * Why an in-flight turn is being stopped — selects how much runtime state to
 * tear down (see {@link STOP_POLICY}). Derived from the service's own typed
 * state (`turn.interruptRequested`), never from the abort signal's `reason`, so
 * a user Stop can't be misread as a steer interrupt. An abort with nothing
 * requested defaults to `user-stop` — the safe-failure direction (full teardown
 * closes the connection, killing the runtime/subagent).
 */
type AgentTurnStopIntent = 'interrupt' | 'user-stop'

interface TurnStopPolicy {
  /** Terminal status stamped on the turn when the session survives the stop. */
  turnStatus: AgentSessionRuntimeTerminalStatus
  /** Tear the whole session down (connection + entry), not just the turn. */
  closeSession: boolean
}

/**
 * `interrupt` (steer): pause this turn but keep the connection + session so the
 * queued message can open the next turn (the runtime was gracefully interrupted,
 * not closed — the warm query survives). `user-stop`: tear the session down so
 * `connection.close()` kills the runtime query and its subagent.
 */
const STOP_POLICY: Record<AgentTurnStopIntent, TurnStopPolicy> = {
  interrupt: { turnStatus: 'paused', closeSession: false },
  'user-stop': { turnStatus: 'paused', closeSession: true }
}

export interface BeginAgentSessionTurnInput {
  sessionId: string
  topicId: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  assistantMessageId?: string
  userMessage?: AgentSessionMessageEntity
  traceId?: string
  rootSpanId?: string
}

export interface AgentSessionRuntimeHandle {
  listeners: StreamListener[]
  turnId: string
}

export interface OpenAgentSessionTurnStreamInput {
  sessionId: string
  turnId: string
  signal: AbortSignal
}

export interface AgentSessionRuntimeSnapshot {
  sessionId: string
  topicId?: string
  assistantMessageId?: string
  status: AgentSessionRuntimeStatus
  pendingMessageCount: number
  lastTerminalStatus?: AgentSessionRuntimeTerminalStatus
  resumeToken?: string
  activeToolCount: number
  interruptRequested: boolean
}

type AgentSessionTurn = {
  turnId: string
  assistantMessageId?: string
  userMessage: AgentSessionMessageEntity
  modelId: UniqueModelId
  admitted: boolean
  terminalStatus?: AgentSessionRuntimeTerminalStatus
  controller?: ReadableStreamDefaultController<UIMessageChunk>
  activeToolIds: Set<string>
  interruptRequested: boolean
  trace?: AgentRuntimeTraceContext
}

type AgentSessionRuntimeEntry = {
  sessionId: string
  topicId: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  status: AgentSessionRuntimeStatus
  pendingTurns: AgentSessionMessageEntity[]
  connection?: AgentRuntimeConnection
  connectionLoop?: Promise<void>
  /** In-flight {@link ensureConnection} promise — shared by concurrent callers so only one connect runs. */
  connecting?: Promise<boolean>
  currentTurn?: AgentSessionTurn
  lastResumeToken?: string
  lastTerminalStatus?: AgentSessionRuntimeTerminalStatus
  idleTimer?: ReturnType<typeof setTimeout>
  startingNextTurn?: boolean
}

class AgentSessionRuntimeTerminalListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly service: AgentSessionRuntimeService,
    private readonly sessionId: string
  ) {
    this.id = `agent-runtime:${sessionId}`
  }

  onChunk(): void {}

  onDone(result: StreamDoneResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'success')
  }

  onPaused(result: StreamPausedResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'paused')
  }

  onError(result: StreamErrorResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'error')
  }

  isAlive(): boolean {
    return true
  }
}

@Injectable('AgentSessionRuntimeService')
@ServicePhase(Phase.WhenReady)
export class AgentSessionRuntimeService extends BaseService {
  private readonly entries = new Map<string, AgentSessionRuntimeEntry>()

  protected async onInit(): Promise<void> {
    // Resolve agent-session assistant rows a prior main-process crash left `pending` — at boot the
    // in-memory entry map is empty, so every such row is stale. Mirrors AiStreamManager's chat
    // reconcile so both message tables are settled on restart (neither stays a frozen "thinking"
    // bubble); agent sessions additionally recover conversation context via the resume token.
    await this.reconcileStalePendingMessages()

    this.registerDisposable(
      agentService.onAgentUpdated(({ agentId, updates, agent }) => {
        void this.handleAgentUpdated(agentId, updates, agent).catch((error) => {
          logger.warn('Failed to apply live agent policy update', { agentId, error })
        })
      })
    )
  }

  private async reconcileStalePendingMessages(): Promise<void> {
    try {
      const staleIds = await agentSessionMessageService.findPendingAssistantMessageIds()
      if (staleIds.length === 0) return
      logger.info('Reconciling crash-orphaned pending agent-session messages', { count: staleIds.length })
      await agentSessionMessageService.markMessagesError(staleIds)
    } catch (error) {
      logger.error('Failed to reconcile stale pending agent-session messages', { error })
    }
  }

  beginTurn(input: BeginAgentSessionTurnInput): AgentSessionRuntimeHandle {
    const turnId = crypto.randomUUID()
    const userMessage = input.userMessage ?? createSyntheticUserMessage(input.sessionId)
    const existing = this.entries.get(input.sessionId)
    const turn: AgentSessionTurn = {
      turnId,
      assistantMessageId: input.assistantMessageId,
      userMessage,
      modelId: input.modelId,
      admitted: false,
      activeToolIds: new Set(),
      interruptRequested: false,
      trace: this.createTraceContext(input, turnId, input.traceId, input.rootSpanId)
    }

    if (existing?.status === 'idle') {
      this.clearIdleTimer(existing)
      existing.pendingTurns = []
      existing.topicId = input.topicId
      existing.agentId = input.agentId
      existing.agentType = input.agentType
      existing.modelId = input.modelId
      existing.status = 'active'
      existing.currentTurn = turn

      return {
        listeners: [
          this.createPersistenceListener(existing, userMessage),
          new AgentSessionRuntimeTerminalListener(this, input.sessionId),
          new TraceFlushListener(input.topicId)
        ],
        turnId
      }
    }

    if (existing) this.closeSession(input.sessionId)

    const entry: AgentSessionRuntimeEntry = {
      sessionId: input.sessionId,
      topicId: input.topicId,
      agentId: input.agentId,
      agentType: input.agentType,
      modelId: input.modelId,
      status: 'active',
      pendingTurns: [],
      currentTurn: turn
    }
    this.entries.set(input.sessionId, entry)

    return {
      listeners: [
        this.createPersistenceListener(entry, userMessage),
        new AgentSessionRuntimeTerminalListener(this, input.sessionId),
        new TraceFlushListener(input.topicId)
      ],
      turnId
    }
  }

  async applyAgentPolicyUpdate(agentId: string, update: AgentRuntimePolicyUpdate): Promise<void> {
    const updates: Array<{
      entry: AgentSessionRuntimeEntry
      connection: AgentRuntimeConnection
      promise: Promise<boolean> | boolean
    }> = []
    for (const entry of this.entries.values()) {
      if (entry.agentId !== agentId) continue
      const { connection } = entry
      if (!connection?.applyPolicyUpdate) continue
      updates.push({ entry, connection, promise: connection.applyPolicyUpdate(update) })
    }
    const results = await Promise.allSettled(updates.map(({ promise }) => promise))
    for (const [index, result] of results.entries()) {
      const updateTarget = updates[index]
      if (!updateTarget) continue
      const { entry, connection } = updateTarget
      const { sessionId } = entry

      if (result.status === 'rejected') {
        logger.error('Failed to apply live agent policy update; closing runtime connection', {
          agentId,
          sessionId,
          error: result.reason
        })
        this.closeFailedPolicyUpdateConnection(entry, connection)
        continue
      }

      if (result.value === false) {
        logger.warn('Live agent policy update had no live query; detaching runtime connection', { agentId, sessionId })
        this.detachPolicyUpdateConnection(entry, connection)
      }
    }
  }

  private async handleAgentUpdated(agentId: string, updates: UpdateAgentDto, agent: AgentEntity): Promise<void> {
    if (updates.configuration !== undefined) {
      await this.applyAgentPolicyUpdate(agentId, {
        type: 'permission-mode',
        permissionMode: agent.configuration?.permission_mode
      })
    }

    if (
      Object.prototype.hasOwnProperty.call(updates, 'disabledTools') ||
      Object.prototype.hasOwnProperty.call(updates, 'mcps')
    ) {
      await this.applyAgentPolicyUpdate(agentId, { type: 'tool-policy', agent })
    }
  }

  openTurnStream(input: OpenAgentSessionTurnStreamInput): ReadableStream<UIMessageChunk> {
    const entry = this.entries.get(input.sessionId)
    const turn = entry?.currentTurn
    if (!entry || !turn || turn.turnId !== input.turnId) {
      throw new Error(`No active agent runtime turn ${input.turnId} for session ${input.sessionId}`)
    }

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          this.clearIdleTimer(entry)
          turn.controller = controller

          const onAbort = () => this.stopTurn(entry, turn.interruptRequested ? 'interrupt' : 'user-stop')
          if (input.signal.aborted) {
            onAbort()
            return
          } else {
            input.signal.addEventListener('abort', onAbort, { once: true })
          }

          controller.enqueue({ type: 'start' })
          const connected = await this.ensureConnection(entry)
          if (!connected || !this.isCurrentEntry(entry) || turn.terminalStatus) return
          await this.admitTurn(entry, turn)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel: () => {
        this.closeCurrentTurn(entry, 'paused')
      }
    })
  }

  enqueueUserMessage(sessionId: string, message: AgentSessionMessageEntity): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    entry.pendingTurns.push(message)
    entry.status = 'active'
    this.clearIdleTimer(entry)

    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus) {
      this.scheduleNextTurn(entry)
      return
    }

    if (turn.activeToolIds.size > 0) return

    queueMicrotask(() => {
      const latest = this.entries.get(sessionId)
      if (!latest?.currentTurn || latest.currentTurn.terminalStatus) {
        if (latest) this.scheduleNextTurn(latest)
        return
      }
      this.requestInterruptWhenSafe(latest)
    })
  }

  markTurnTerminal(sessionId: string, status: AgentSessionRuntimeTerminalStatus): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    entry.status = 'idle'
    entry.lastTerminalStatus = status
    if (entry.currentTurn) entry.currentTurn.terminalStatus = status

    if (this.shouldCloseConnectionAfterTurn(entry)) {
      // close() may be async on some drivers; swallow rejection so it can't become unhandled.
      void Promise.resolve(this.closeConnection(entry)?.close()).catch((error) =>
        logger.warn('Agent runtime connection close failed', { sessionId: entry.sessionId, error })
      )
    }

    if (entry.pendingTurns.length > 0) {
      this.scheduleNextTurn(entry)
    } else {
      this.refreshIdleTimer(entry)
    }
  }

  closeSession(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    this.entries.delete(sessionId)
    this.closeEntry(entry)
  }

  /**
   * Whether the session has a turn in flight or about to start: a non-terminal current turn,
   * a next-turn drain in progress (`startingNextTurn`), or queued follow-ups. The dispatcher
   * uses this — NOT `AiStreamManager.hasLiveStream` — to decide enqueue-vs-begin, because
   * `hasLiveStream` is false during the inter-turn drain window while the entry is still
   * mid-transition; a fresh dispatch trusting `hasLiveStream` there would clobber the drain via
   * `beginTurn`.
   */
  isSessionBusy(sessionId: string): boolean {
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    return (
      entry.startingNextTurn === true ||
      entry.pendingTurns.length > 0 ||
      (entry.currentTurn !== undefined && entry.currentTurn.terminalStatus === undefined)
    )
  }

  inspect(sessionId: string): AgentSessionRuntimeSnapshot | undefined {
    const entry = this.entries.get(sessionId)
    if (!entry) return undefined
    const turn = entry.currentTurn

    return {
      sessionId: entry.sessionId,
      topicId: entry.topicId,
      assistantMessageId: turn?.assistantMessageId,
      status: entry.status,
      pendingMessageCount: entry.pendingTurns.length,
      lastTerminalStatus: entry.lastTerminalStatus,
      resumeToken: entry.lastResumeToken,
      activeToolCount: turn?.activeToolIds.size ?? 0,
      interruptRequested: turn?.interruptRequested ?? false
    }
  }

  /**
   * Resolve a Claude `canUseTool` approval that was registered against the live
   * driver session. Returns `false` if no live entry matches — the caller
   * falls back to MCP/DB path.
   */
  respondToolApproval(approvalId: string, decision: DispatchDecision): boolean {
    return toolApprovalRegistry.dispatch(approvalId, decision)
  }

  protected onStop(): void {
    this.closeAll()
    toolApprovalRegistry.clear('agent-session-runtime-stop')
  }

  protected onDestroy(): void {
    this.closeAll()
    toolApprovalRegistry.clear('agent-session-runtime-destroy')
  }

  private isCurrentEntry(entry: AgentSessionRuntimeEntry): boolean {
    return this.entries.get(entry.sessionId) === entry
  }

  private async ensureConnection(entry: AgentSessionRuntimeEntry): Promise<boolean> {
    if (!this.isCurrentEntry(entry)) return false
    if (entry.connection) return true
    // Share a single in-flight connect across concurrent callers so two streams opening at once
    // can't each spin up a connection (the second would leak/clobber the first).
    if (entry.connecting) {
      const connected = await entry.connecting
      if (!connected || !this.isCurrentEntry(entry)) return false
      return true
    }

    const connecting = this.connect(entry).finally(() => {
      if (entry.connecting === connecting) entry.connecting = undefined
    })
    entry.connecting = connecting
    return connecting
  }

  private async connect(entry: AgentSessionRuntimeEntry): Promise<boolean> {
    const driver = runtimeDriverRegistry.getAgentSessionDriver(entry.agentType)
    if (!driver) throw new Error(`Unsupported agent runtime type: ${entry.agentType}`)

    await this.hydrateResumeToken(entry)
    if (!this.isCurrentEntry(entry)) return false

    const connection = await driver.connect({
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      modelId: entry.modelId,
      resumeToken: entry.lastResumeToken,
      trace: entry.currentTurn?.trace
    })
    if (!this.isCurrentEntry(entry)) {
      void Promise.resolve(connection.close()).catch((error) =>
        logger.warn('Agent runtime connection close failed', { sessionId: entry.sessionId, error })
      )
      return false
    }

    entry.connection = connection
    entry.connectionLoop = this.runConnectionLoop(entry, connection).finally(() => {
      if (entry.connection === connection) entry.connection = undefined
      if (entry.connectionLoop) entry.connectionLoop = undefined
    })
    return true
  }

  private async hydrateResumeToken(entry: AgentSessionRuntimeEntry): Promise<void> {
    if (entry.lastResumeToken) return
    const runtimeResumeToken = await agentSessionMessageService.getLastRuntimeResumeToken(entry.sessionId)
    if (runtimeResumeToken) entry.lastResumeToken = runtimeResumeToken
  }

  private async runConnectionLoop(entry: AgentSessionRuntimeEntry, connection: AgentRuntimeConnection): Promise<void> {
    try {
      for await (const event of connection.events) {
        this.handleRuntimeEvent(entry, event)
      }
    } catch (error) {
      this.handleRuntimeError(entry, error)
    }
  }

  private handleRuntimeEvent(entry: AgentSessionRuntimeEntry, event: AgentRuntimeEvent): void {
    switch (event.type) {
      case 'resume-token':
        entry.lastResumeToken = event.token
        break
      case 'chunk': {
        const turn = entry.currentTurn
        if (turn?.controller && !turn.terminalStatus) this.enqueueTurnChunk(entry, turn, event.chunk)
        break
      }
      case 'turn-complete':
        this.closeCurrentTurn(entry, 'success')
        break
      case 'error':
        this.handleRuntimeError(entry, event.error)
        break
    }
  }

  private handleRuntimeError(entry: AgentSessionRuntimeEntry, error: unknown): void {
    const turn = entry.currentTurn
    if (turn?.controller && !turn.terminalStatus) {
      turn.controller.error(error)
      // Mark terminal synchronously: the listener's markTurnTerminal arrives async (after the
      // stream error propagates), so a trailing `chunk` event in the same connection loop would
      // otherwise hit enqueueTurnChunk and throw on the now-errored controller.
      turn.terminalStatus = 'error'
    } else if (isAbortError(error)) {
      // Expected when a turn was interrupted/closed — the connection ending is not a fault.
      logger.warn('Agent runtime connection ended without an active turn', { sessionId: entry.sessionId, error })
    } else {
      // No turn to surface this on, so a real runtime failure would otherwise vanish — log it loudly
      // so the next reconnect-into-the-same-failure is at least traceable.
      logger.error('Agent runtime connection ended without an active turn', { sessionId: entry.sessionId, error })
    }
  }

  private async admitTurn(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): Promise<void> {
    if (!this.isCurrentEntry(entry) || entry.currentTurn !== turn || turn.terminalStatus) return
    if (turn.admitted) return
    turn.admitted = true
    entry.status = 'active'
    await entry.connection?.send({ message: turn.userMessage })
    if (entry.pendingTurns.length > 0) {
      queueMicrotask(() => this.requestInterruptWhenSafe(entry))
    }
  }

  private enqueueTurnChunk(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn, chunk: UIMessageChunk): void {
    const toolChunk = chunk as { type?: string; toolCallId?: string }
    if ((toolChunk.type === 'tool-input-start' || toolChunk.type === 'tool-input-available') && toolChunk.toolCallId) {
      turn.activeToolIds.add(toolChunk.toolCallId)
    } else if (
      (toolChunk.type === 'tool-output-available' ||
        toolChunk.type === 'tool-output-error' ||
        toolChunk.type === 'tool-output-denied') &&
      toolChunk.toolCallId
    ) {
      turn.activeToolIds.delete(toolChunk.toolCallId)
    }

    turn.controller?.enqueue(chunk)

    if (turn.activeToolIds.size === 0 && entry.pendingTurns.length > 0) this.requestInterruptWhenSafe(entry)
  }

  private requestInterruptWhenSafe(entry: AgentSessionRuntimeEntry): void {
    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus || !turn.admitted || turn.interruptRequested) return
    const canInterrupt = entry.connection?.canInterruptNow?.() ?? turn.activeToolIds.size === 0
    if (!canInterrupt) return
    turn.interruptRequested = true
    this.interruptCurrentTurn(entry)
  }

  private interruptCurrentTurn(entry: AgentSessionRuntimeEntry): void {
    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus) return
    void entry.connection?.interrupt?.().catch((error) => {
      logger.warn('Agent runtime interrupt failed', { sessionId: entry.sessionId, error })
    })
    application.get('AiStreamManager').pauseRuntimeTurn(entry.topicId, 'agent-runtime-interrupt')
  }

  private stopTurn(entry: AgentSessionRuntimeEntry, intent: AgentTurnStopIntent): void {
    const policy = STOP_POLICY[intent]
    if (policy.closeSession) {
      this.closeSession(entry.sessionId)
      return
    }
    this.closeCurrentTurn(entry, policy.turnStatus)
  }

  private closeCurrentTurn(entry: AgentSessionRuntimeEntry, status: AgentSessionRuntimeTerminalStatus): void {
    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus) return
    turn.terminalStatus = status
    try {
      turn.controller?.close()
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private scheduleNextTurn(entry: AgentSessionRuntimeEntry): void {
    if (entry.startingNextTurn) return
    entry.startingNextTurn = true
    // Keep `startingNextTurn` set for the WHOLE drain — `startNextTurn` spans a DB round-trip,
    // and `isSessionBusy` relies on this flag so a concurrent dispatch landing in the inter-turn
    // window enqueues instead of beginning a clobbering fresh turn. Clear it only once the drain
    // settles (turn established, bailed, or errored).
    queueMicrotask(() => {
      void this.startNextTurn(entry)
        .catch((error) => {
          logger.error('Failed to start next agent runtime turn', { sessionId: entry.sessionId, error })
        })
        .finally(() => {
          entry.startingNextTurn = false
        })
    })
  }

  private async startNextTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    const nextMessage = entry.pendingTurns.shift()
    if (!nextMessage) {
      this.refreshIdleTimer(entry)
      return
    }

    const { rootSpan, traceId, rootSpanId } = this.startRuntimeRootSpan(entry)
    let assistantMessage: Awaited<ReturnType<typeof agentSessionMessageService.saveMessage>>
    try {
      assistantMessage = await agentSessionMessageService.saveMessage({
        sessionId: entry.sessionId,
        message: {
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId: entry.modelId
        }
      })
    } catch (error) {
      // The placeholder save failed, so there is no assistant row to drive to `error` and no
      // point re-queuing the message — the retry would just fail the same way, and a re-queued
      // message is silently cleared by the idle TTL anyway. Instead surface the failure to the
      // live renderer and settle the turn so the session doesn't sit idle on a doomed message.
      rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'Placeholder save failed' })
      rootSpan.end()
      application.get('AiStreamManager').broadcastTopicError(entry.topicId, entry.modelId, serializeError(error))
      this.markTurnTerminal(entry.sessionId, 'error')
      return
    }

    // The DB save above yields the event loop; the session may have been torn down
    // (shutdown / a fresh beginTurn) in the meantime. Re-check before mutating the entry,
    // mirroring every other async method here — otherwise a dead entry gets resurrected
    // into a doomed runtime turn with no backing agent connection.
    if (!this.isCurrentEntry(entry)) {
      rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'Entry invalidated mid-turn' })
      rootSpan.end()
      return
    }

    const assistantMessageId = assistantMessage.id

    const turnId = crypto.randomUUID()
    entry.currentTurn = {
      turnId,
      assistantMessageId,
      userMessage: nextMessage,
      modelId: entry.modelId,
      admitted: false,
      activeToolIds: new Set(),
      interruptRequested: false,
      trace: this.createTraceContext(entry, turnId, traceId, rootSpanId)
    }

    application.get('AiStreamManager').startRuntimeTurn({
      topicId: entry.topicId,
      modelId: entry.modelId,
      rootSpan,
      request: {
        chatId: entry.topicId,
        trigger: 'submit-message',
        messageId: assistantMessageId,
        messages: createRuntimeSeedMessages(nextMessage, assistantMessageId),
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId }
      },
      listeners: [
        this.createPersistenceListener(entry, nextMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId),
        new TraceFlushListener(entry.topicId)
      ]
    })
  }

  private startRuntimeRootSpan(entry: AgentSessionRuntimeEntry): {
    rootSpan: Span
    traceId: string
    rootSpanId: string
  } {
    const turnTrace = startAiTurnTrace(
      'chat.turn',
      {
        attributes: {
          'cs.topic_id': entry.topicId,
          'cs.trigger': 'submit-message',
          'cs.model_id': entry.modelId,
          'cs.role': 'assistant',
          'cs.agent_id': entry.agentId,
          'cs.session_id': entry.sessionId
        }
      },
      { topicId: entry.topicId, modelName: parseUniqueModelId(entry.modelId).modelId }
    )
    return { rootSpan: turnTrace.rootSpan, traceId: turnTrace.traceId, rootSpanId: turnTrace.rootSpanId }
  }

  private createTraceContext(
    input: Pick<BeginAgentSessionTurnInput, 'topicId' | 'sessionId' | 'modelId'>,
    turnId: string,
    traceId?: string,
    rootSpanId?: string
  ): AgentRuntimeTraceContext | undefined {
    if (!traceId || !rootSpanId) return undefined
    return {
      topicId: input.topicId,
      traceId,
      rootSpanId,
      sessionId: input.sessionId,
      turnId,
      modelName: parseUniqueModelId(input.modelId).modelId
    }
  }

  private shouldCloseConnectionAfterTurn(entry: AgentSessionRuntimeEntry): boolean {
    return entry.connection?.shouldCloseAfterTurn?.() ?? false
  }

  private createPersistenceListener(
    entry: AgentSessionRuntimeEntry,
    userMessage: AgentSessionMessageEntity
  ): StreamListener {
    const userText = extractMessageText(userMessage)
    return new PersistenceListener({
      topicId: entry.topicId,
      modelId: entry.modelId,
      backend: new AgentSessionMessageBackend({
        sessionId: entry.sessionId,
        modelId: entry.modelId,
        runtimeResumeToken: () => entry.lastResumeToken,
        afterPersist: async (finalMessage) => {
          await topicNamingService.maybeRenameAgentSession(entry.agentId, entry.sessionId, userText, finalMessage)
        }
      }),
      onPersistFailed: (error) =>
        application.get('AiStreamManager').broadcastTopicError(entry.topicId, entry.modelId, error)
    })
  }

  private refreshIdleTimer(entry: AgentSessionRuntimeEntry): void {
    this.clearIdleTimer(entry)
    entry.idleTimer = setTimeout(() => {
      const { sessionId, agentType, lastResumeToken } = entry
      this.closeSession(sessionId)
      if (lastResumeToken) {
        runtimeDriverRegistry.getAgentSessionDriver(agentType)?.onSessionIdle?.(sessionId)
      }
    }, DEFAULT_IDLE_TTL_MS)
    entry.idleTimer.unref?.()
  }

  private clearIdleTimer(entry: AgentSessionRuntimeEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
  }

  private closeAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.closeSession(sessionId)
    }
  }

  private closeEntry(entry: AgentSessionRuntimeEntry): void {
    this.clearIdleTimer(entry)
    this.closeCurrentTurn(entry, 'paused')
    entry.pendingTurns = []

    const connection = this.closeConnection(entry)
    entry.currentTurn = undefined
    entry.startingNextTurn = false

    void Promise.resolve(connection?.close()).catch((error) =>
      logger.warn('Agent runtime connection close failed', { sessionId: entry.sessionId, error })
    )
  }

  private closeFailedPolicyUpdateConnection(entry: AgentSessionRuntimeEntry, connection: AgentRuntimeConnection): void {
    if (entry.connection !== connection) return
    const turn = entry.currentTurn
    if (turn && !turn.terminalStatus) {
      turn.interruptRequested = true
      application.get('AiStreamManager').pauseRuntimeTurn(entry.topicId, 'agent-policy-update-failed')
    }
    this.detachPolicyUpdateConnection(entry, connection)
  }

  private detachPolicyUpdateConnection(entry: AgentSessionRuntimeEntry, connection: AgentRuntimeConnection): void {
    if (entry.connection !== connection) return
    this.closeConnection(entry)
    void Promise.resolve(connection.close()).catch((error) =>
      logger.warn('Agent runtime connection close failed', { sessionId: entry.sessionId, error })
    )
  }

  private closeConnection(entry: AgentSessionRuntimeEntry): AgentRuntimeConnection | undefined {
    const connection = entry.connection
    entry.connection = undefined
    entry.connectionLoop = undefined
    return connection
  }
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name: unknown }).name === 'AbortError'
}

function createRuntimeSeedMessages(
  userMessage: AgentSessionMessageEntity,
  assistantMessageId: string
): CherryUIMessage[] {
  return [
    {
      id: userMessage.id,
      role: 'user',
      parts: userMessage.data?.parts ?? []
    },
    {
      id: assistantMessageId,
      role: 'assistant',
      parts: []
    }
  ] as CherryUIMessage[]
}

function createSyntheticUserMessage(sessionId: string): AgentSessionMessageEntity {
  const now = new Date().toISOString()
  return {
    id: uuidv7(),
    sessionId,
    role: 'user',
    data: { parts: [] },
    status: 'success',
    searchableText: '',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: now,
    updatedAt: now
  }
}

function extractMessageText(message: AgentSessionMessageEntity): string {
  return (
    message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}
