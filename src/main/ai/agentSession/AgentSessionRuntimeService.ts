import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { topicNamingService } from '@main/services/TopicNamingService'
import { type Span, SpanStatusCode } from '@opentelemetry/api'
import {
  AGENT_SESSION_COMPACTION_CACHE_KEY,
  type AgentSessionCompactionAnchorData,
  type AgentSessionCompactionTrigger
} from '@shared/ai/agentSessionCompaction'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'
import type { AgentEntity, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryUIMessage } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { serializeError } from '@shared/utils/error'
import type { UIMessageChunk } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { applyTurnInputAttributes, deriveRootSpanId, startAiChildTurnSpan } from '../observability'
import {
  type AgentRuntimeConnection,
  type AgentRuntimeEvent,
  type AgentRuntimePolicyUpdate,
  type AgentRuntimeTraceContext,
  type AgentRuntimeUserInput,
  runtimeDriverRegistry
} from '../runtime'
import { type DispatchDecision, toolApprovalRegistry } from '../runtime/claudeCode/ToolApprovalRegistry'
import { PersistenceListener } from '../streamManager/listeners/PersistenceListener'
import { TraceFlushListener } from '../streamManager/listeners/TraceFlushListener'
import type { StreamErrorResult, StreamListener, StreamPausedResult } from '../streamManager/types'
import { AgentSessionMessageBackend } from './persistence/AgentSessionMessageBackend'
import { extractAgentSessionId, isAgentSessionTopic } from './topic'

const logger = loggerService.withContext('AgentSessionRuntimeService')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000

export type AgentSessionRuntimeStatus = 'active' | 'idle'
export type AgentSessionRuntimeTerminalStatus = 'success' | 'paused' | 'error'

export interface BeginAgentSessionTurnInput {
  sessionId: string
  topicId: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  assistantMessageId?: string
  userMessage?: AgentSessionMessageEntity
  /** Container-level OTel trace id (one trace per session); cached on the entry. */
  traceId?: string
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
}

type AgentSessionRuntimeEntry = {
  sessionId: string
  topicId: string
  /** Container-level OTel trace id (one trace tree per session); the warm connection's traceparent. */
  sessionTraceId?: string
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
  /** Ids of pending messages that arrived mid-turn (steers) — drives the system-reminder wrap. */
  steerMessageIds?: Set<string>
  /** Roll in progress: a steer was injected mid-turn (`steer-boundary`), the current row was finalised
   *  as A1a, and the post-steer chunks are buffered until the continuation row (A2) opens its stream. */
  rolling?: boolean
  /** Post-steer chunks captured between A1a closing and A2's controller being ready; flushed into A2. */
  rollBuffer?: UIMessageChunk[]
  /** The injected steer(s) carried to the continuation turn for its rename/seed context (U2 is already
   *  persisted by the provider — these do NOT create a new user row). */
  rollSteerInputs?: AgentRuntimeUserInput[]
  compacting?: boolean
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

  onDone(): void {
    // Always advance the runtime turn. For a single-model agent turn, `isTopicDone=false` only means
    // the stream manager is CHAINING the next turn (keeping the stream alive so the queued follow-up
    // can carry the renderer listeners) — which still needs markTurnTerminal to open that next turn.
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
      activeToolIds: new Set()
    }

    if (existing?.status === 'idle') {
      this.clearIdleTimer(existing)
      existing.pendingTurns = []
      existing.topicId = input.topicId
      existing.sessionTraceId = input.traceId ?? existing.sessionTraceId
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
      sessionTraceId: input.traceId,
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

      // Fail closed: a rejected policy update may have left the connection enforcing the OLD (looser)
      // policy — the snapshot's `permissionMode` gates `canUseTool`, so a failed tighten must not keep
      // running. Pause the live turn and tear the connection down rather than silently continuing.
      if (result.status === 'rejected') {
        logger.error('Failed to apply live agent policy update; closing runtime connection', {
          agentId,
          sessionId,
          error: result.reason
        })
        this.closeFailedPolicyUpdateConnection(entry, connection)
        continue
      }

      // `false` means the connection had no live query to apply the update to (already torn down) —
      // detach it so a stale connection doesn't keep serving a policy it never received.
      if (result.value === false) {
        logger.warn('Live agent policy update had no live query; detaching runtime connection', { agentId, sessionId })
        this.detachPolicyUpdateConnection(entry, connection)
      }
    }
  }

  private async handleAgentUpdated(agentId: string, updates: UpdateAgentDto, agent: AgentEntity): Promise<void> {
    // `configuration` is a wholesale column replace, so a partial update that omits `permission_mode`
    // still changes the effective value (it clears it). Resync on ANY configuration change and derive
    // the authoritative value from the post-update agent — never from the update DTO's key presence,
    // which would leave the warm connection on a stale mode the DB no longer holds.
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

          // A user Stop is the only abort source now (steer no longer interrupts) — tear the
          // session down so `connection.close()` kills the warm query and its subagent.
          const onAbort = () => this.closeSession(entry.sessionId)
          if (input.signal.aborted) {
            onAbort()
            return
          } else {
            input.signal.addEventListener('abort', onAbort, { once: true })
          }

          controller.enqueue({ type: 'start' })
          // Roll continuation: replay the post-steer chunks captured while A2's stream was opening, as
          // soon as the controller exists (before the connection round-trip). No-op for normal turns.
          this.flushRollBuffer(entry, turn)
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

    entry.status = 'active'
    this.clearIdleTimer(entry)

    const turn = entry.currentTurn
    // Live turn + a backend that can steer → inject into the running turn (claude's PreToolUse steer
    // hook): the steer is folded into the current turn — no new turn, no queue entry. If the turn
    // ends before it's injected, the connection emits `steer-undelivered` and we queue it below.
    if (turn && !turn.terminalStatus && entry.connection?.redirect?.({ message, systemReminder: true })) {
      return
    }

    // No live turn (or backend can't steer) → queue as the next turn, wrapped in a steer system-reminder.
    entry.pendingTurns.push(message)
    ;(entry.steerMessageIds ??= new Set()).add(message.id)
    if (!turn || turn.terminalStatus) this.scheduleNextTurn(entry)
  }

  markTurnTerminal(sessionId: string, status: AgentSessionRuntimeTerminalStatus): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    // Roll: A1a closed at a steer-injection boundary. Mark A1a terminal but keep the session ACTIVE
    // and open the continuation (A2) for the post-steer response instead of idling. `currentTurn` is
    // still A1a here (the swap to A2 happens in the scheduled microtask), so we don't mis-mark A2.
    if (entry.rolling) {
      if (entry.currentTurn) entry.currentTurn.terminalStatus = status
      if (status === 'success') {
        entry.status = 'active'
        entry.lastTerminalStatus = status
        this.scheduleContinuationTurn(entry)
        return
      }
      // Non-success during a roll (defensive — `onDone`/success is the only terminal kept alive across
      // the boundary): abandon the roll and settle normally; the buffered post-steer chunks are dropped.
      entry.rolling = false
      entry.rollBuffer = undefined
      entry.rollSteerInputs = undefined
    }

    entry.status = 'idle'
    entry.lastTerminalStatus = status
    if (entry.currentTurn) entry.currentTurn.terminalStatus = status

    // Connection stays warm across turns (no per-turn close) — only `closeSession`/idle TTL tears it
    // down. A queued steer drains into the same warm subprocess via `scheduleNextTurn`.
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
      entry.rolling === true ||
      entry.compacting === true ||
      entry.pendingTurns.length > 0 ||
      (entry.currentTurn !== undefined && entry.currentTurn.terminalStatus === undefined)
    )
  }

  /**
   * Whether the agent runtime will open another turn for this topic once the current one ends — a
   * queued steer/follow-up, or a next-turn drain already in progress. `AiStreamManager.onExecutionDone`
   * uses this to KEEP the topic's stream alive across the inter-turn gap (broadcasting `isTopicDone=false`,
   * skipping the terminal lifecycle) so the follow-up turn can carry the renderer listeners — without it
   * the stream is evicted and the follow-up's response reaches no one.
   */
  willContinueTopic(topicId: string): boolean {
    if (!isAgentSessionTopic(topicId)) return false
    const entry = this.entries.get(extractAgentSessionId(topicId))
    if (!entry) return false
    // `rolling`: A1a just closed at a steer boundary and the continuation (A2) is coming — keep the
    // stream alive so A2 carries the renderer listeners.
    // `compacting`: a compaction is mid-flight between turns; keep the stream alive so its
    // compaction-anchor / completion chunks (and the resumed turn) still reach the renderer.
    return (
      entry.pendingTurns.length > 0 ||
      entry.startingNextTurn === true ||
      entry.rolling === true ||
      entry.compacting === true
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
      activeToolCount: turn?.activeToolIds.size ?? 0
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
    if (entry.connecting) return entry.connecting

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
      trace: this.sessionTraceContext(entry)
    })
    if (!this.isCurrentEntry(entry)) {
      void Promise.resolve(connection.close()).catch((error) =>
        logger.warn('Agent runtime connection close failed', { sessionId: entry.sessionId, error })
      )
      return false
    }

    entry.connection = connection
    this.refreshContextUsage(entry, connection)
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
        this.refreshContextUsage(entry)
        break
      case 'chunk': {
        // Mid-roll: A1a is closed and A2's stream isn't open yet — buffer the post-steer chunks so
        // `flushRollBuffer` can replay them into A2 in order (see `steer-boundary`).
        if (entry.rolling) {
          ;(entry.rollBuffer ??= []).push(event.chunk)
          break
        }
        const turn = entry.currentTurn
        if (turn?.controller && !turn.terminalStatus) this.enqueueTurnChunk(turn, event.chunk)
        break
      }
      case 'steer-boundary':
        // The model is about to emit its post-steer assistant message. Finalise the pre-steer parts as
        // A1a (`closeCurrentTurn` 'success'), then buffer the continuation until `startContinuationTurn`
        // opens A2. `rolling` keeps the topic stream alive (willContinueTopic) across the gap.
        entry.rolling = true
        entry.rollBuffer = []
        entry.rollSteerInputs = event.inputs
        this.closeCurrentTurn(entry, 'success')
        break
      case 'steer-undelivered':
        // Steers stashed via redirect() that this turn ended before injecting → queue them as the
        // next turn (with a steer system-reminder). The following `turn-complete` → markTurnTerminal
        // drains pendingTurns via scheduleNextTurn.
        for (const input of event.inputs) {
          entry.pendingTurns.push(input.message)
          ;(entry.steerMessageIds ??= new Set()).add(input.message.id)
        }
        break
      case 'compaction-start':
        this.handleCompactionStart(entry, event.trigger)
        break
      case 'compaction-complete':
        this.handleCompactionComplete(entry, event.anchor)
        break
      case 'compaction-error':
        this.handleCompactionError(entry, event.error)
        break
      case 'context-usage':
        this.persistContextUsage(entry, event.usage)
        break
      case 'turn-complete':
        this.closeCurrentTurn(entry, 'success')
        this.refreshContextUsage(entry)
        break
      case 'error':
        this.handleRuntimeError(entry, event.error)
        break
    }
  }

  private handleCompactionStart(
    entry: AgentSessionRuntimeEntry,
    trigger: AgentSessionCompactionTrigger | undefined
  ): void {
    entry.compacting = true
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
      status: 'compacting',
      startedAt: new Date().toISOString(),
      ...(trigger ? { trigger } : {})
    })
  }

  private handleCompactionComplete(entry: AgentSessionRuntimeEntry, anchor?: AgentSessionCompactionAnchorData): void {
    entry.compacting = false

    const turn = entry.currentTurn
    if (anchor && turn?.controller && !turn.terminalStatus) {
      this.enqueueTurnChunk(turn, {
        type: 'data-compaction-anchor',
        id: crypto.randomUUID(),
        data: anchor
      } as UIMessageChunk)
    }

    // Completed-run metrics ride the `data-compaction-anchor` chunk above (the UI's source); the cache
    // state only tracks `status`. A no-anchor success (which can follow the boundary, or arrive on its
    // own when the SDK reports success without a boundary) therefore can't clobber any token stats — it
    // just leaves the compacting state.
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
      status: 'idle'
    })
    this.refreshContextUsage(entry)
  }

  private handleCompactionError(entry: AgentSessionRuntimeEntry, error: string): void {
    this.settleCompactionError(entry, error)
  }

  private settleCompactionError(entry: AgentSessionRuntimeEntry, error: string): void {
    entry.compacting = false
    // The failure is surfaced to the user through the turn error (handleRuntimeError) and logged here;
    // the compaction cache state only needs to leave the compacting status.
    logger.warn('Agent session compaction failed', { sessionId: entry.sessionId, error })
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
      status: 'idle'
    })
  }

  private refreshContextUsage(entry: AgentSessionRuntimeEntry, connection = entry.connection): void {
    if (!connection?.getContextUsage) return

    void (async () => {
      const usage = await connection.getContextUsage?.()
      if (!usage) return
      if (!this.isCurrentEntry(entry) || entry.connection !== connection) return
      this.persistContextUsage(entry, usage)
    })().catch((error) => {
      logger.warn('Failed to refresh agent session context usage', { sessionId: entry.sessionId, error })
    })
  }

  private persistContextUsage(entry: AgentSessionRuntimeEntry, usage: AgentSessionContextUsage): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.sessionId), usage)
  }

  private handleRuntimeError(entry: AgentSessionRuntimeEntry, error: unknown): void {
    if (entry.compacting) {
      this.settleCompactionError(entry, error instanceof Error ? error.message : String(error))
    }

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
    // `Set.delete` returns whether it was queued as a steer — consume the flag as we admit the turn.
    const systemReminder = entry.steerMessageIds?.delete(turn.userMessage.id) ?? false
    await entry.connection?.send({ message: turn.userMessage, systemReminder })
  }

  private enqueueTurnChunk(turn: AgentSessionTurn, chunk: UIMessageChunk): void {
    if ((chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') && chunk.toolCallId) {
      turn.activeToolIds.add(chunk.toolCallId)
    } else if (
      (chunk.type === 'tool-output-available' ||
        chunk.type === 'tool-output-error' ||
        chunk.type === 'tool-output-denied') &&
      chunk.toolCallId
    ) {
      turn.activeToolIds.delete(chunk.toolCallId)
    }

    turn.controller?.enqueue(chunk)
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

    const rootSpan = this.startRuntimeRootSpan(entry)
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
      rootSpan?.setStatus({ code: SpanStatusCode.ERROR, message: 'Placeholder save failed' })
      rootSpan?.end()
      application.get('AiStreamManager').broadcastTopicError(entry.topicId, entry.modelId, serializeError(error))
      this.markTurnTerminal(entry.sessionId, 'error')
      return
    }

    // The DB save above yields the event loop; the session may have been torn down
    // (shutdown / a fresh beginTurn) in the meantime. Re-check before mutating the entry,
    // mirroring every other async method here — otherwise a dead entry gets resurrected
    // into a doomed runtime turn with no backing agent connection.
    if (!this.isCurrentEntry(entry)) {
      rootSpan?.setStatus({ code: SpanStatusCode.ERROR, message: 'Entry invalidated mid-turn' })
      rootSpan?.end()
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
      activeToolIds: new Set()
    }

    const messages = createRuntimeSeedMessages(nextMessage, assistantMessageId)
    // Author the turn span's input/identity here (the runtime owns its continuation turns).
    if (rootSpan) {
      applyTurnInputAttributes(rootSpan, {
        modelId: entry.modelId,
        topicId: entry.topicId,
        operation: 'invoke_agent',
        messages
      })
    }
    application.get('AiStreamManager').startRuntimeTurn({
      topicId: entry.topicId,
      modelId: entry.modelId,
      rootSpan,
      request: {
        chatId: entry.topicId,
        trigger: 'submit-message',
        messageId: assistantMessageId,
        messages,
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId }
      },
      listeners: [
        this.createPersistenceListener(entry, nextMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId),
        new TraceFlushListener(entry.topicId)
      ]
    })
  }

  /** Drain-dedup + microtask defer for the roll continuation. Mirrors `scheduleNextTurn`. */
  private scheduleContinuationTurn(entry: AgentSessionRuntimeEntry): void {
    if (entry.startingNextTurn) return
    entry.startingNextTurn = true
    queueMicrotask(() => {
      void this.startContinuationTurn(entry)
        .catch((error) => {
          logger.error('Failed to start steer continuation turn', { sessionId: entry.sessionId, error })
        })
        .finally(() => {
          entry.startingNextTurn = false
        })
    })
  }

  /**
   * Open the post-steer continuation row (A2) after a `steer-boundary` rolled A1a closed. Unlike
   * `startNextTurn` this sends NOTHING to the connection (the steer is already in flight via the
   * PreToolUse hook) — the turn is pre-`admitted` so `admitTurn` no-ops, and the still-streaming SDK
   * turn's post-steer chunks (buffered in `rollBuffer`) are replayed into A2 by `flushRollBuffer`.
   * The steer message is reused only for rename/seed context — U2 is already a persisted row.
   */
  private async startContinuationTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    const steerMessage = entry.rollSteerInputs?.[0]?.message ?? createSyntheticUserMessage(entry.sessionId)
    entry.rollSteerInputs = undefined

    const rootSpan = this.startRuntimeRootSpan(entry)
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
      // The A2 placeholder save failed — abandon the roll, drop the buffered post-steer chunks, and
      // surface the failure (mirrors `startNextTurn`'s doomed-placeholder handling).
      rootSpan?.end()
      entry.rolling = false
      entry.rollBuffer = undefined
      application.get('AiStreamManager').broadcastTopicError(entry.topicId, entry.modelId, serializeError(error))
      this.markTurnTerminal(entry.sessionId, 'error')
      return
    }

    if (!this.isCurrentEntry(entry)) {
      rootSpan?.end()
      return
    }

    const assistantMessageId = assistantMessage.id
    const turnId = crypto.randomUUID()
    entry.currentTurn = {
      turnId,
      assistantMessageId,
      userMessage: steerMessage,
      modelId: entry.modelId,
      // Pre-admitted: the steer was already delivered via the hook, so `admitTurn` must NOT re-send it.
      admitted: true,
      activeToolIds: new Set()
    }

    const messages = createRuntimeSeedMessages(steerMessage, assistantMessageId)
    // Author the turn span's input/identity here (the runtime owns its roll continuation turns).
    if (rootSpan) {
      applyTurnInputAttributes(rootSpan, {
        modelId: entry.modelId,
        topicId: entry.topicId,
        operation: 'invoke_agent',
        messages
      })
    }
    application.get('AiStreamManager').startRuntimeTurn({
      topicId: entry.topicId,
      modelId: entry.modelId,
      rootSpan,
      request: {
        chatId: entry.topicId,
        trigger: 'submit-message',
        messageId: assistantMessageId,
        messages,
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId }
      },
      listeners: [
        this.createPersistenceListener(entry, steerMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId),
        new TraceFlushListener(entry.topicId)
      ]
    })
  }

  /**
   * Replay the post-steer chunks buffered during a roll into the continuation turn's controller, then
   * clear the roll so subsequent chunks route live. A no-op for normal turns (`rolling` is false).
   * Synchronous (no await between draining the buffer and clearing `rolling`) so ordering is preserved.
   */
  private flushRollBuffer(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): void {
    if (!entry.rolling || entry.currentTurn !== turn) return
    const buffered = entry.rollBuffer ?? []
    entry.rolling = false
    entry.rollBuffer = undefined
    for (const chunk of buffered) this.enqueueTurnChunk(turn, chunk)
  }

  private startRuntimeRootSpan(entry: AgentSessionRuntimeEntry): Span | undefined {
    const traceId = entry.sessionTraceId
    if (!traceId) return undefined
    const turnTrace = startAiChildTurnSpan(
      'ai.turn',
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
      { topicId: entry.topicId, modelName: parseUniqueModelId(entry.modelId).modelId },
      traceId
    )
    return turnTrace.rootSpan
  }

  /** Container trace passed to the driver as the connection's traceparent. */
  private sessionTraceContext(entry: AgentSessionRuntimeEntry): AgentRuntimeTraceContext | undefined {
    const traceId = entry.sessionTraceId
    if (!traceId) return undefined
    return {
      topicId: entry.topicId,
      traceId,
      rootSpanId: deriveRootSpanId(traceId),
      sessionId: entry.sessionId,
      turnId: entry.currentTurn?.turnId ?? '',
      modelName: parseUniqueModelId(entry.modelId).modelId
    }
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
    entry.rolling = false
    entry.rollBuffer = undefined
    entry.rollSteerInputs = undefined
    if (entry.compacting) {
      application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
        status: 'idle'
      })
    }
    entry.compacting = false
    application.get('CacheService').deleteShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.sessionId))

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
      // Pause the live turn so the renderer learns it stopped (the abort path then tears the session
      // down via `closeSession`); a failed tighten must not keep streaming under the old policy.
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
