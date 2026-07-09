import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { serializeError } from '@main/ai/utils/serializeError'
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
import {
  AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY,
  type AgentSessionSlashCommand
} from '@shared/ai/agentSessionSlashCommands'
import type { AgentEntity, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryUIMessage } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { applyTurnInputAttributes, deriveRootSpanId, startAiChildTurnSpan } from '../observability'
import { type DispatchDecision, toolApprovalRegistry } from '../runtime/claudeCode'
import { registerRuntimeDrivers } from '../runtime/registerDrivers'
import { runtimeDriverRegistry } from '../runtime/registry'
import type {
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimePolicyUpdate,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput
} from '../runtime/types'
import {
  PersistenceListener,
  type StreamErrorResult,
  type StreamListener,
  type StreamPausedResult,
  TraceFlushListener
} from '../streamManager'
import { AgentSessionMessageBackend } from './persistence/AgentSessionMessageBackend'
import { buildAgentSessionTopicId, extractAgentSessionId, isAgentSessionTopic } from './topic'

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
  assistantMessageId: string
  userMessage?: AgentSessionMessageEntity
  headless?: boolean
  /** Container-level OTel trace id (one trace per session); cached on the entry. */
  traceId?: string
}

export interface AgentSessionRuntimeHandle {
  listeners: StreamListener[]
  turnId: string
  abortController: AbortController
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
  assistantMessageId: string
  userMessage: AgentSessionMessageEntity
  modelId: UniqueModelId
  admitted: boolean
  abortController: AbortController
  terminalStatus?: AgentSessionRuntimeTerminalStatus
  controller?: ReadableStreamDefaultController<UIMessageChunk>
  activeToolIds: Set<string>
  headless?: boolean
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
  /** Model the current connection was opened with. A model edit invalidates reuse. */
  connectionModelId?: UniqueModelId
  connectionLoop?: Promise<void>
  /** In-flight {@link ensureConnection} promise — shared by concurrent callers so only one connect runs. */
  connecting?: Promise<boolean>
  connectingModelId?: UniqueModelId
  currentTurn?: AgentSessionTurn
  lastResumeToken?: string
  lastTerminalStatus?: AgentSessionRuntimeTerminalStatus
  idleTimer?: ReturnType<typeof setTimeout>
  startingNextTurn?: boolean
  /** Ids of pending messages that arrived mid-turn (steers) — drives the system-reminder wrap. */
  steerMessageIds?: Set<string>
  /** Ids of queued follow-ups that must open a responder-less/headless turn. */
  headlessMessageIds?: Set<string>
  /** Roll in progress: a steer was injected mid-turn (`steer-boundary`), the current row was finalised
   *  as A1a, and the post-steer chunks are buffered until the continuation row (A2) opens its stream. */
  rolling?: boolean
  /** Post-steer chunks captured between A1a closing and A2's controller being ready; flushed into A2. */
  rollBuffer?: UIMessageChunk[]
  /** The injected steer(s) carried to the continuation turn for its rename/seed context (U2 is already
   *  persisted by the provider — these do NOT create a new user row). */
  rollSteerInputs?: AgentRuntimeUserInput[]
  /** Whether the post-steer continuation turn should keep responder-less/headless enforcement. */
  rollHeadless?: boolean
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
    // Populate the AI runtime driver registry at a controlled lifecycle point (WhenReady, before
    // any agent session runs) instead of relying on an import-time side effect.
    registerRuntimeDrivers()

    // Resolve agent-session assistant rows a prior main-process crash left `pending` — at boot the
    // in-memory entry map is empty, so every such row is stale. Mirrors AiStreamManager's chat
    // reconcile so both message tables are settled on restart (neither stays a frozen "thinking"
    // bubble); agent sessions additionally recover conversation context via the resume token.
    this.reconcileStalePendingMessages()

    this.registerDisposable(
      agentService.onAgentUpdated(({ agentId, updates, agent }) => {
        void this.handleAgentUpdated(agentId, updates, agent).catch((error) => {
          logger.warn('Failed to apply live agent policy update', { agentId, error })
        })
      })
    )
  }

  private reconcileStalePendingMessages(): void {
    try {
      const staleIds = agentSessionMessageService.findPendingAssistantMessageIds()
      if (staleIds.length === 0) return
      logger.info('Reconciling crash-orphaned pending agent-session messages', { count: staleIds.length })
      agentSessionMessageService.markMessagesError(staleIds)
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
      abortController: new AbortController(),
      activeToolIds: new Set(),
      headless: input.headless === true
    }

    if (existing?.status === 'idle') {
      // A warm connection is always safe to reuse: per-turn headless enforcement lives in `canUseTool`
      // and PreToolUse hooks (resolved by session id at fire-time via `isCurrentTurnHeadless`), so the
      // connection's baked settings no longer vary by headless mode and never need a mismatch rebuild.
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
        turnId,
        abortController: turn.abortController
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
      turnId,
      abortController: turn.abortController
    }
  }

  /**
   * Open the session's runtime connection ahead of the first turn (on session open) so the driver's
   * slash-command catalog (`query.supportedCommands()`) is read into the shared cache before the user
   * types — the SDK warm-query handle can't expose commands without a live connection. Best-effort and
   * idempotent: an existing entry (idle-warm or mid-turn) is just kept connected; a freshly primed
   * entry idles under the same TTL as a post-turn one, so it self-tears-down if never used.
   */
  async primeConnection(sessionId: string): Promise<void> {
    try {
      const existing = this.entries.get(sessionId)
      if (existing) {
        // Re-prime of a live session (e.g. a second window opening it): re-read and republish the
        // catalog so a consumer that mounts after the initial publish still gets it — `ensureConnection`
        // alone skips the read when the connection already exists.
        void this.ensureConnection(existing)
          .then((connected) => {
            if (connected) this.refreshSupportedCommands(existing)
          })
          .catch((error) => logger.warn('Failed to re-prime agent session connection', { sessionId, error }))
        return
      }

      const session = agentSessionService.getById(sessionId)
      if (!session?.agentId) return
      const agent = agentService.getAgent(session.agentId)
      if (!agent?.model) return
      if (!runtimeDriverRegistry.getAgentSessionDriver(agent.type)) return

      // Resolve the session's container trace id up front so the primed connection carries the same
      // trace context the first turn will. The connection is reused across turns, so without this its
      // subprocess would start without TRACEPARENT and its spans would never join the session trace
      // tree. Idempotent with the dispatch path (`ensureTraceId` returns the same id).
      const sessionTraceId = agentSessionService.ensureTraceId(sessionId)

      // A real turn may have created the entry while we resolved the session — defer to it.
      const raced = this.entries.get(sessionId)
      if (raced) {
        void this.ensureConnection(raced)
        return
      }

      const entry: AgentSessionRuntimeEntry = {
        sessionId,
        topicId: buildAgentSessionTopicId(sessionId),
        sessionTraceId,
        agentId: session.agentId,
        agentType: agent.type,
        modelId: agent.model,
        status: 'idle',
        pendingTurns: []
      }
      this.entries.set(sessionId, entry)

      const connected = await this.ensureConnection(entry)
      // A turn may have superseded/cleared this entry while connecting — leave its lifecycle to it.
      if (this.entries.get(sessionId) !== entry) return
      if (!connected) {
        this.closeSession(sessionId)
        return
      }
      // Still idle (no turn took over): arm the TTL so an unused primed connection self-closes.
      if (entry.status === 'idle' && !entry.currentTurn) {
        this.refreshIdleTimer(entry)
      }
    } catch (error) {
      logger.warn('Failed to prime agent session connection', { sessionId, error })
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
    if (Object.prototype.hasOwnProperty.call(updates, 'model')) {
      this.applyAgentModelUpdate(agentId, agent.model)
    }

    // WARNING: only the primary `model` invalidates the connection here — `planModel`/`smallModel` edits
    // are NOT reconciled against a live or warm connection. The sonnet/haiku route is rebuilt from the
    // current agent in `buildClaudeCodeQueryRequestForAgentSession`, so a sub-model change takes effect on
    // the NEXT reconnect (next fresh turn on a cold entry, or after the idle TTL), not on an already-open
    // connection. Editing only plan/small while a connection is warm won't retarget it until it rebuilds.

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

  private applyAgentModelUpdate(agentId: string, modelId: UniqueModelId | null): void {
    for (const entry of this.entries.values()) {
      if (entry.agentId !== agentId) continue

      if (!modelId) {
        this.invalidateModelClearedEntry(entry)
        continue
      }

      if (entry.modelId === modelId) continue
      entry.modelId = modelId

      // Treat a steer roll as a live turn: at a `steer-boundary` A1a is marked terminal but `entry.rolling`
      // stays true while the same SDK query keeps streaming the post-steer response into A2. Closing the
      // connection in that gap would drop the continuation. Deferring is safe — the roll continuation keeps
      // A1a's captured model, and the next fresh turn reconnects to the new model via `ensureConnection`.
      const turn = entry.currentTurn
      const hasLiveTurn = (turn && !turn.terminalStatus) || entry.rolling === true
      if (!hasLiveTurn) {
        this.closeConnectionAsync(entry)
      }
    }
  }

  /**
   * An agent update cleared the model (`PATCH { model: null }` — `AgentEntitySchema.model` is nullable),
   * so the agent can no longer be routed to any model. Fully invalidate the runtime entry instead of only
   * closing its connection: pause a live turn so the renderer learns it stopped (the abort then tears the
   * session down via the turn stream's abort listener), then `closeSession` to settle the turn, drop queued
   * follow-ups, and close the connection. Removing the entry from the map also self-discards any in-flight
   * old-model connect (its entry is no longer current, so `connect()` closes the connection it opened
   * instead of installing it) — a modelless agent must not be left with a stale entry still targeting the
   * previous model.
   *
   * NOTE: deleting the model's `user_model` row also nulls `agent.model` via the FK (`onDelete: 'set null'`),
   * but that path (`ModelService.delete`/`bulkDelete`) emits no agent update, so it does NOT reach this
   * update-driven handler. The deleted-model runtime is covered elsewhere instead: a live turn finishes on
   * its captured model; a queued follow-up is caught by `startNextTurn`'s model re-check before it can start
   * on the stale model; and a fresh dispatch fails fast in the chat context with "no model configured".
   */
  private invalidateModelClearedEntry(entry: AgentSessionRuntimeEntry): void {
    const turn = entry.currentTurn
    if (turn && !turn.terminalStatus) {
      application.get('AiStreamManager').pauseRuntimeTurn(entry.topicId, 'agent-model-cleared')
    }
    this.closeSession(entry.sessionId)
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

  enqueueUserMessage(sessionId: string, message: AgentSessionMessageEntity, opts: { headless?: boolean } = {}): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    entry.status = 'active'
    this.clearIdleTimer(entry)
    if (opts.headless === true) (entry.headlessMessageIds ??= new Set()).add(message.id)

    const turn = entry.currentTurn
    // Live turn + a backend that can steer → inject into the running turn (claude's PreToolUse steer
    // hook): the steer is folded into the current turn — no new turn, no queue entry. If the turn
    // ends before it's injected, the connection emits `steer-undelivered` and we queue it below.
    const canRedirectOnCurrentModel = entry.connectionModelId === entry.modelId
    if (
      turn &&
      !turn.terminalStatus &&
      canRedirectOnCurrentModel &&
      entry.connection?.redirect?.({ message, systemReminder: true })
    ) {
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
      entry.rollHeadless = undefined
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
   * Release a connection opened by {@link primeConnection} (or left idle after a turn) when its
   * session view closes — frees the subprocess and clears the cached catalog now instead of waiting
   * out the idle TTL. No-op while a turn is in flight so a backgrounded stream keeps running.
   */
  releaseIdleConnection(sessionId: string): void {
    if (this.isSessionBusy(sessionId)) return
    this.closeSession(sessionId)
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

  abortPendingTurn(sessionId: string, reason: string): boolean {
    const turn = this.entries.get(sessionId)?.currentTurn
    if (!turn || turn.terminalStatus || turn.abortController.signal.aborted) return false
    turn.abortController.abort(reason)
    return true
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

  /**
   * Model the session's connection should serve right now. A live turn runs on the model captured
   * when it was created — its assistant row, persistence and trace are already stamped with it, so
   * a model edit landing between turn creation and its stream opening must NOT retarget the
   * connection (the turn would execute on a different model than it records). A steer roll counts as
   * live too: at a `steer-boundary` A1a is already terminal while `entry.rolling` stays true and the
   * same SDK query keeps streaming the post-steer response on A1a's captured model — retargeting in
   * that gap (e.g. a re-prime re-entering `ensureConnection`) would close the connection and drop the
   * continuation. Mirrors the live-turn test in `applyAgentModelUpdate`. Without a live turn or roll
   * the connection follows the agent's latest model.
   */
  private connectionTargetModelId(entry: AgentSessionRuntimeEntry): UniqueModelId {
    const turn = entry.currentTurn
    const live = turn && (!turn.terminalStatus || entry.rolling === true)
    return live ? turn.modelId : entry.modelId
  }

  private async ensureConnection(entry: AgentSessionRuntimeEntry): Promise<boolean> {
    while (this.isCurrentEntry(entry)) {
      const targetModelId = this.connectionTargetModelId(entry)
      if (entry.connection) {
        if (entry.connectionModelId === targetModelId) return true
        this.closeConnectionAsync(entry)
        continue
      }

      // Share a single in-flight connect across concurrent callers so two streams opening at once
      // can't each spin up a connection (the second would leak/clobber the first). If the target
      // model changed while that connect was in flight, wait for the stale attempt to self-discard,
      // then loop and open the new model.
      if (entry.connecting) {
        if (entry.connectingModelId === targetModelId) {
          // Don't hand the shared promise straight back: it resolves false when the attempt
          // self-discards on a mid-flight model edit, and a caller surfacing that false while the
          // entry is still current would leave its turn stream waiting forever. Loop and retry.
          if (await entry.connecting) return true
          continue
        }
        await entry.connecting.catch(() => false)
        continue
      }

      const connectingModelId = targetModelId
      const connecting = this.connect(entry, connectingModelId).finally(() => {
        if (entry.connecting === connecting) {
          entry.connecting = undefined
          entry.connectingModelId = undefined
        }
      })
      entry.connecting = connecting
      entry.connectingModelId = connectingModelId
      const connected = await connecting
      if (connected) return true
    }

    return false
  }

  private async connect(entry: AgentSessionRuntimeEntry, modelId: UniqueModelId): Promise<boolean> {
    const driver = runtimeDriverRegistry.getAgentSessionDriver(entry.agentType)
    if (!driver) throw new Error(`Unsupported agent runtime type: ${entry.agentType}`)

    this.hydrateResumeToken(entry)
    if (!this.isCurrentEntry(entry)) return false

    const connection = await driver.connect({
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      modelId,
      resumeToken: entry.lastResumeToken,
      trace: this.sessionTraceContext(entry, modelId)
    })
    if (!this.isCurrentEntry(entry) || this.connectionTargetModelId(entry) !== modelId) {
      void Promise.resolve(connection.close()).catch((error) =>
        logger.warn('Agent runtime connection close failed', { sessionId: entry.sessionId, error })
      )
      return false
    }

    entry.connection = connection
    entry.connectionModelId = modelId
    this.refreshContextUsage(entry, connection)
    this.refreshSupportedCommands(entry, connection)
    entry.connectionLoop = this.runConnectionLoop(entry, connection).finally(() => {
      if (entry.connection === connection) {
        entry.connection = undefined
        entry.connectionModelId = undefined
      }
      if (entry.connectionLoop) entry.connectionLoop = undefined
    })
    return true
  }

  private hydrateResumeToken(entry: AgentSessionRuntimeEntry): void {
    if (entry.lastResumeToken) return
    const runtimeResumeToken = agentSessionMessageService.getLastRuntimeResumeToken(entry.sessionId)
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
        // A responder exists if the pre-steer turn was interactive or any injected steer came from one.
        entry.rollHeadless =
          entry.currentTurn?.headless === true &&
          event.inputs.every((input) => entry.headlessMessageIds?.has(input.message.id) === true)
        for (const input of event.inputs) entry.headlessMessageIds?.delete(input.message.id)
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
      case 'supported-commands':
        // SDK pushed a refreshed catalog (`commands_changed`) — replace the cached list so the
        // composer and channel `/help` reflect commands discovered after the initial read.
        this.publishSupportedCommands(entry, event.commands)
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

  // The initial slash command catalog read (`query.supportedCommands()`) once the connection is live.
  // It only captures the catalog at init; mid-session changes arrive separately as `supported-commands`
  // events (`commands_changed`) and are applied via the same {@link publishSupportedCommands} sink.
  // The cached list feeds both the renderer composer and the channel `/help` listing.
  private refreshSupportedCommands(entry: AgentSessionRuntimeEntry, connection = entry.connection): void {
    if (!connection?.getSupportedCommands) return

    void (async () => {
      const commands = await connection.getSupportedCommands?.()
      if (!commands) return
      if (!this.isCurrentEntry(entry) || entry.connection !== connection) return
      this.publishSupportedCommands(entry, commands)
    })().catch((error) => {
      logger.warn('Failed to refresh agent session slash commands', { sessionId: entry.sessionId, error })
    })
  }

  private publishSupportedCommands(entry: AgentSessionRuntimeEntry, commands: AgentSessionSlashCommand[]): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(entry.sessionId), commands)
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
    // Keep `startingNextTurn` set for the WHOLE drain — `startNextTurn` runs on a deferred
    // microtask, and `isSessionBusy` relies on this flag so a concurrent dispatch landing in the
    // inter-turn window enqueues instead of beginning a clobbering fresh turn. Clear it only once
    // the drain settles (turn established, bailed, or errored).
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

    // A queued follow-up can outlive the agent's model: deleting the model nulls `agent.model` via the FK
    // (`onDelete: 'set null'`) without emitting an agent update, so `applyAgentModelUpdate` never ran and
    // `entry.modelId` still caches the deleted model. Re-read the live model before draining — starting the
    // turn here would stamp an assistant row with the stale deleted model and then fail to connect. If the
    // model is gone, surface the failure to the renderer, drop the queue (its rows stay resendable) and
    // settle instead of starting a doomed turn. Use `terminateHeldTopicStream` (not `broadcastTopicError`):
    // the prior turn kept this topic's stream alive for the continuation (`willContinueTopic`), skipping its
    // terminal lifecycle — a bare error broadcast would leave that stream in `activeStreams` with its status
    // cache stuck `streaming` and still re-attachable, so it must be terminalized/evicted here.
    if (!agentService.getAgent(entry.agentId)?.model) {
      application
        .get('AiStreamManager')
        .terminateHeldTopicStream(
          entry.topicId,
          entry.modelId,
          serializeError(new Error(`Agent ${entry.agentId} has no model configured`))
        )
      entry.pendingTurns = []
      this.markTurnTerminal(entry.sessionId, 'error')
      return
    }

    const rootSpan = this.startRuntimeRootSpan(entry)
    let assistantMessage: Awaited<ReturnType<typeof agentSessionMessageService.saveMessage>>
    try {
      assistantMessage = agentSessionMessageService.saveMessage({
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

    const assistantMessageId = assistantMessage.id
    const headless = entry.headlessMessageIds?.delete(nextMessage.id) === true

    const turnId = crypto.randomUUID()
    entry.currentTurn = {
      turnId,
      assistantMessageId,
      userMessage: nextMessage,
      modelId: entry.modelId,
      admitted: false,
      abortController: new AbortController(),
      activeToolIds: new Set(),
      headless
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
      abortController: entry.currentTurn.abortController,
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
    const modelId = entry.currentTurn?.modelId ?? entry.modelId
    const steerMessage = entry.rollSteerInputs?.[0]?.message ?? createSyntheticUserMessage(entry.sessionId)
    const headless = entry.rollHeadless === true
    entry.rollSteerInputs = undefined
    entry.rollHeadless = undefined

    const rootSpan = this.startRuntimeRootSpan(entry, modelId)
    let assistantMessage: Awaited<ReturnType<typeof agentSessionMessageService.saveMessage>>
    try {
      assistantMessage = agentSessionMessageService.saveMessage({
        sessionId: entry.sessionId,
        message: {
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId
        }
      })
    } catch (error) {
      // The A2 placeholder save failed — abandon the roll, drop the buffered post-steer chunks, and
      // surface the failure (mirrors `startNextTurn`'s doomed-placeholder handling).
      rootSpan?.end()
      entry.rolling = false
      entry.rollBuffer = undefined
      entry.rollHeadless = undefined
      application.get('AiStreamManager').broadcastTopicError(entry.topicId, entry.modelId, serializeError(error))
      this.markTurnTerminal(entry.sessionId, 'error')
      return
    }

    const assistantMessageId = assistantMessage.id
    const turnId = crypto.randomUUID()
    entry.currentTurn = {
      turnId,
      assistantMessageId,
      userMessage: steerMessage,
      modelId,
      // Pre-admitted: the steer was already delivered via the hook, so `admitTurn` must NOT re-send it.
      admitted: true,
      abortController: new AbortController(),
      activeToolIds: new Set(),
      headless
    }

    const messages = createRuntimeSeedMessages(steerMessage, assistantMessageId)
    // Author the turn span's input/identity here (the runtime owns its roll continuation turns).
    if (rootSpan) {
      applyTurnInputAttributes(rootSpan, {
        modelId,
        topicId: entry.topicId,
        operation: 'invoke_agent',
        messages
      })
    }
    application.get('AiStreamManager').startRuntimeTurn({
      topicId: entry.topicId,
      modelId,
      rootSpan,
      request: {
        chatId: entry.topicId,
        trigger: 'submit-message',
        messageId: assistantMessageId,
        messages,
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId }
      },
      abortController: entry.currentTurn.abortController,
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

  isCurrentTurnHeadless(sessionId: string): boolean {
    return this.entries.get(sessionId)?.currentTurn?.headless === true
  }

  private startRuntimeRootSpan(
    entry: AgentSessionRuntimeEntry,
    modelId: UniqueModelId = entry.modelId
  ): Span | undefined {
    const traceId = entry.sessionTraceId
    if (!traceId) return undefined
    const turnTrace = startAiChildTurnSpan(
      'ai.turn',
      {
        attributes: {
          'cs.topic_id': entry.topicId,
          'cs.trigger': 'submit-message',
          'cs.model_id': modelId,
          'cs.role': 'assistant',
          'cs.agent_id': entry.agentId,
          'cs.session_id': entry.sessionId
        }
      },
      { topicId: entry.topicId, modelName: parseUniqueModelId(modelId).modelId },
      traceId
    )
    return turnTrace.rootSpan
  }

  /** Container trace passed to the driver as the connection's traceparent. */
  private sessionTraceContext(
    entry: AgentSessionRuntimeEntry,
    modelId: UniqueModelId = entry.modelId
  ): AgentRuntimeTraceContext | undefined {
    const traceId = entry.sessionTraceId
    if (!traceId) return undefined
    return {
      topicId: entry.topicId,
      traceId,
      rootSpanId: deriveRootSpanId(traceId),
      sessionId: entry.sessionId,
      turnId: entry.currentTurn?.turnId ?? '',
      modelName: parseUniqueModelId(modelId).modelId
    }
  }

  private createPersistenceListener(
    entry: AgentSessionRuntimeEntry,
    userMessage: AgentSessionMessageEntity
  ): StreamListener {
    const currentTurn = entry.currentTurn
    if (!currentTurn) {
      throw new Error(`Cannot create persistence listener without an active turn: ${entry.sessionId}`)
    }
    const { assistantMessageId, modelId } = currentTurn
    const userText = extractMessageText(userMessage)
    return new PersistenceListener({
      topicId: entry.topicId,
      modelId,
      backend: new AgentSessionMessageBackend({
        sessionId: entry.sessionId,
        assistantMessageId,
        modelId,
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
    entry.rollHeadless = undefined
    if (entry.compacting) {
      application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
        status: 'idle'
      })
    }
    entry.compacting = false
    application.get('CacheService').deleteShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.sessionId))
    application.get('CacheService').deleteShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(entry.sessionId))

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
    entry.connectionModelId = undefined
    entry.connectionLoop = undefined
    return connection
  }

  private closeConnectionAsync(entry: AgentSessionRuntimeEntry): void {
    const connection = this.closeConnection(entry)
    void Promise.resolve(connection?.close()).catch((error) =>
      logger.warn('Agent runtime connection close failed', { sessionId: entry.sessionId, error })
    )
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
