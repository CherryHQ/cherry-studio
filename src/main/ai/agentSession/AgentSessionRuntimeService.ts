import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { aiUsageRecordService, type SourceSnapshot } from '@data/services/AiUsageRecordService'
import { loggerService } from '@logger'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { serializeError } from '@main/ai/utils/serializeError'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { topicNamingService } from '@main/services/TopicNamingService'
import { type Span, SpanStatusCode } from '@opentelemetry/api'
import { AGENT_SESSION_API_RETRY_CACHE_KEY, type AgentSessionApiRetryInfo } from '@shared/ai/agentSessionApiRetry'
import {
  AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY,
  AGENT_SESSION_TASK_EVENTS_CACHE_KEY,
  type AgentSessionBackgroundTasks
} from '@shared/ai/agentSessionBackgroundTasks'
import {
  AGENT_SESSION_COMPACTION_CACHE_KEY,
  type AgentSessionCompactionAnchorData,
  type AgentSessionCompactionTrigger
} from '@shared/ai/agentSessionCompaction'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'
import { AGENT_SESSION_FLOW_PARTS_CACHE_KEY } from '@shared/ai/agentSessionFlowParts'
import {
  AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY,
  type AgentSessionSlashCommand
} from '@shared/ai/agentSessionSlashCommands'
import type { AgentEntity, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage, MessageSnapshot } from '@shared/data/types/message'
import { createUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { type AgentTaskEventPartData, getKnowledgeBaseIdsFromParts } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { applyTurnInputAttributes, deriveRootSpanId, startAiChildTurnSpan } from '../observability'
import { type DispatchDecision, toolApprovalRegistry } from '../runtime/claudeCode'
import { registerRuntimeDrivers } from '../runtime/registerDrivers'
import { runtimeDriverRegistry } from '../runtime/registry'
import type {
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeToolApprovalRequest,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput,
  AgentSessionUsageCapture
} from '../runtime/types'
import {
  PersistenceListener,
  type StreamErrorResult,
  type StreamListener,
  type StreamPausedResult,
  TraceFlushListener
} from '../streamManager'
import type { InProcessUsageContext } from '../types'
import {
  type AgentSessionRuntimeConnectionTarget,
  type AgentSessionRuntimeLaunchTarget,
  type AgentSessionRuntimeState,
  type AgentSessionRuntimeStateEffect,
  type AgentSessionRuntimeStateEvent,
  type AgentSessionTerminalStatus,
  createAgentSessionRuntimeState,
  getAgentSessionRuntimeConnection,
  getAgentSessionRuntimeCurrentTurn,
  getAgentSessionRuntimeLiveTurn,
  getAgentSessionRuntimeOccupancy,
  hasAgentSessionRuntimeBackgroundWork,
  hasAgentSessionRuntimeOpenStream,
  isAgentSessionRuntimeAutonomous,
  isAgentSessionRuntimeBusy,
  isAgentSessionRuntimeCompacting,
  isAgentSessionRuntimeTransitioning,
  isAgentSessionRuntimeTurnAdmitted,
  isAgentSessionRuntimeTurnLive,
  transitionAgentSessionRuntime,
  willAgentSessionRuntimeContinue
} from './agentSessionRuntimeState'
import { AgentSessionMessageBackend } from './persistence/AgentSessionMessageBackend'
import { buildAgentSessionTopicId, extractAgentSessionId, isAgentSessionTopic } from './topic'

const logger = loggerService.withContext('AgentSessionRuntimeService')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000
const CONTEXT_USAGE_REFRESH_THROTTLE_MS = 3_000
const BACKGROUND_FLOW_HANDOFF_TTL_MS = 60_000
const BACKGROUND_FLOW_PUBLISH_THROTTLE_MS = 150

function knowledgeScopeEquals(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return left.every((id) => rightIds.has(id))
}

export type AgentSessionRuntimeStatus = 'active' | 'idle'
export type AgentSessionRuntimeTerminalStatus = AgentSessionTerminalStatus

export interface BeginAgentSessionTurnInput {
  sessionId: string
  topicId: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  reasoningEffort?: ReasoningEffortOption
  fastMode?: boolean
  assistantMessageId: string
  userMessage?: AgentSessionMessageEntity
  headless?: boolean
  /** Container-level OTel trace id (one trace per session); cached on the entry. */
  traceId?: string
  /** Author snapshot (agent + nested model) stamped onto every assistant row this turn produces. */
  messageSnapshot?: MessageSnapshot
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

export interface AgentSessionInteractionState {
  currentTurn: 'none' | 'interactive' | 'headless'
  userResponse: 'unavailable' | 'stream' | 'message'
}

type AgentSessionTurn = {
  turnId: string
  /** True when the user message arrived as a steer — admission wraps it in a system-reminder. */
  systemReminder?: boolean
  assistantMessageId: string
  userMessage: AgentSessionMessageEntity
  modelId: UniqueModelId
  /** Immutable author snapshot captured when this exact turn was submitted. */
  messageSnapshot?: MessageSnapshot
  reasoningEffort: ReasoningEffortOption
  knowledgeBaseIds: readonly string[]
  fastMode: boolean
  abortController: AbortController
  controller?: ReadableStreamDefaultController<UIMessageChunk>
  activeToolIds: Set<string>
  headless?: boolean
}

type PendingAgentSessionTurn = {
  message: AgentSessionMessageEntity
  reasoningEffort: ReasoningEffortOption
  knowledgeBaseIds: readonly string[]
  fastMode: boolean
  /** The message arrived mid-turn (steer) — the drained turn wraps it in a system-reminder. */
  steer?: boolean
  /** The follow-up must open a responder-less/headless turn. */
  headless?: boolean
  /** Submit-time author snapshot so a mid-session agent/model change can't restamp the reply. */
  messageSnapshot?: MessageSnapshot
}

type BackgroundFlowAccumulator = {
  messageId: string
  controller: ReadableStreamDefaultController<UIMessageChunk>
  latest?: CherryUIMessage
  done: Promise<void>
  closed: boolean
  /** Broadcast throttle for the live overlay — see {@link AgentSessionRuntimeService.publishBackgroundFlowSnapshot}. */
  lastPublishedAt?: number
  publishTimer?: ReturnType<typeof setTimeout>
}

type SteerContinuationReservation = {
  assistantMessageId: string
  userMessageId: string
  messageSnapshot?: MessageSnapshot
}

type AgentSessionConnectionTarget = AgentSessionRuntimeConnectionTarget & {
  modelId: UniqueModelId
  reasoningEffort: ReasoningEffortOption
  fastMode: boolean
}

type RuntimeState = AgentSessionRuntimeState<AgentSessionTurn, PendingAgentSessionTurn, SteerContinuationReservation>
type RuntimeStateEvent = AgentSessionRuntimeStateEvent<
  AgentSessionTurn,
  PendingAgentSessionTurn,
  SteerContinuationReservation
>

type AgentSessionRuntimeEntry = {
  sessionId: string
  topicId: string
  /** Container-level OTel trace id (one trace tree per session); the warm connection's traceparent. */
  sessionTraceId?: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  /** Author snapshot (agent + nested model) for assistant rows the runtime opens this session. */
  messageSnapshot?: MessageSnapshot
  runtimeState: RuntimeState
  /** Capture owner/receipt of the installed connection; retained through terminal persistence. */
  usageCapture?: AgentSessionUsageCapture
  connectionLoop?: Promise<void>
  lastResumeToken?: string
  idleTimer?: ReturnType<typeof setTimeout>
  /** Throttle stamp for {@link AgentSessionRuntimeService.refreshContextUsageOnDemand}. */
  lastContextUsageRefreshAt?: number
  /** Single-flight marker for context-usage reads on the current connection. */
  contextUsageRefresh?: { connection: AgentRuntimeConnection; pending: boolean }
  /** Root/nested tool call → persisted assistant row that owns its FlowTab projection. */
  flowMessageIdsByToolCallId?: Map<string, string>
  /** Assistant rows already committed by PersistenceListener and safe to use as accumulator seeds. */
  persistedFlowMessageIds?: Set<string>
  /** Detached chunks that raced PersistenceListener at the turn boundary. */
  pendingBackgroundFlowChunks?: Map<string, UIMessageChunk[]>
  /** One continuation accumulator per persisted assistant row receiving detached flow chunks. */
  backgroundFlowAccumulators?: Map<string, BackgroundFlowAccumulator>
  /** Single-flight finalization of the current detached flow batch. */
  backgroundFlowFlush?: Promise<void>
}

class AgentSessionRuntimeTerminalListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly service: AgentSessionRuntimeService,
    private readonly sessionId: string,
    private readonly turnId: string
  ) {
    this.id = `agent-runtime:${sessionId}`
  }

  onChunk(): void {}

  onDone(): void {
    // Always advance the runtime turn. For a single-model agent turn, `isTopicDone=false` only means
    // the stream manager is CHAINING the next turn (keeping the stream alive so the queued follow-up
    // can carry the renderer listeners) — which still needs markTurnTerminal to open that next turn.
    this.service.markTurnTerminal(this.sessionId, 'success', this.turnId)
  }

  onPaused(result: StreamPausedResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'paused', this.turnId)
  }

  onError(result: StreamErrorResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'error', this.turnId)
  }

  isAlive(): boolean {
    return true
  }
}

@Injectable('AgentSessionRuntimeService')
@ServicePhase(Phase.WhenReady)
// The dependency is runtime, not lexical: this service's connections spawn CLI children through
// ClaudeCodeProcessManager. Declaring it keeps that owner stopping LAST, so its sweep runs after
// these entries are closed — do not drop it as unused. Covered by a stop-order test.
@DependsOn(['ClaudeCodeProcessManager'])
export class AgentSessionRuntimeService extends BaseService {
  private readonly entries = new Map<string, AgentSessionRuntimeEntry>()
  /** Write-quiesce holds (backup restore). Quiesced ⇔ non-empty. Distinct from the BaseService
   *  lifecycle pause — this never touches service state. See `pause()`. */
  private readonly pauseHolds = new Set<symbol>()
  /** In-flight launches registered synchronously by the state-machine schedule effect. */
  private readonly inFlightTurnStarts = new Map<string, Promise<void>>()
  /** Async connection resources live outside the pure state; attempt ids reject stale completions. */
  private readonly connectionAttempts = new Map<string, { id: string; promise: Promise<boolean> }>()
  /** Promise resources for a rebuild-blocked connection; the state only owns the blocked phase. */
  private readonly backgroundWorkWaiters = new Map<
    string,
    { connection: AgentRuntimeConnection; promise: Promise<void>; resolve: () => void }
  >()
  /** Shutdown wins over pause-release compensation (same posture as JobManager). */
  private isShuttingDown = false

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

  private currentTurn(entry: AgentSessionRuntimeEntry): AgentSessionTurn | undefined {
    return getAgentSessionRuntimeCurrentTurn(entry.runtimeState)
  }

  private liveTurn(entry: AgentSessionRuntimeEntry): AgentSessionTurn | undefined {
    return getAgentSessionRuntimeLiveTurn(entry.runtimeState)
  }

  private isTurnLive(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): boolean {
    return isAgentSessionRuntimeTurnLive(entry.runtimeState, turn)
  }

  private currentConnection(entry: AgentSessionRuntimeEntry): AgentRuntimeConnection | undefined {
    return getAgentSessionRuntimeConnection(entry.runtimeState)
  }

  private runtimeStatus(entry: AgentSessionRuntimeEntry): AgentSessionRuntimeStatus {
    return isAgentSessionRuntimeBusy(entry.runtimeState) ? 'active' : 'idle'
  }

  private applyRuntimeStateEvent(entry: AgentSessionRuntimeEntry, event: RuntimeStateEvent): void {
    if (!this.isCurrentEntry(entry)) return
    const transition = transitionAgentSessionRuntime(entry.runtimeState, event)
    entry.runtimeState = transition.state
    for (const effect of transition.effects) this.applyRuntimeStateEffect(entry, effect)
  }

  private applyRuntimeStateEffect(
    entry: AgentSessionRuntimeEntry,
    effect: AgentSessionRuntimeStateEffect<AgentSessionTurn>
  ): void {
    switch (effect.type) {
      case 'schedule-launch':
        this.scheduleRuntimeLaunch(entry, effect.target)
        break
      case 'deliver-buffer':
        for (const chunk of effect.chunks) this.enqueueTurnChunk(entry, effect.turn, chunk)
        break
      case 'settle-turn': {
        // Closing the controller only requests stream settlement. The state remains
        // `awaiting-persistence` until the stream manager has awaited PersistenceListener and its
        // terminal listener dispatches `turn-terminal`; only that event may launch a successor.
        if (effect.outcome.status === 'error') {
          this.errorTurn(effect.turn, effect.outcome.error)
        } else {
          this.closeTurn(effect.turn)
        }
        break
      }
      case 'release-background-waiter':
        this.releaseBackgroundWorkWaiter(entry, effect.connection)
        break
      case 'compaction-interrupted':
        application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
          status: 'idle'
        })
        break
      case 'log-invalid-transition':
        logger.warn('Ignoring invalid agent session runtime transition', {
          sessionId: entry.sessionId,
          event: effect.event,
          state: effect.state
        })
        break
    }
  }

  beginTurn(input: BeginAgentSessionTurnInput): AgentSessionRuntimeHandle {
    const turnId = crypto.randomUUID()
    const userMessage = input.userMessage ?? createSyntheticUserMessage(input.sessionId)
    const messageSnapshot = input.messageSnapshot ? structuredClone(input.messageSnapshot) : undefined
    const existing = this.entries.get(input.sessionId)
    const turn: AgentSessionTurn = {
      turnId,
      assistantMessageId: input.assistantMessageId,
      userMessage,
      modelId: input.modelId,
      messageSnapshot,
      reasoningEffort: input.reasoningEffort ?? 'default',
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? []) ?? [],
      fastMode: input.fastMode === true,
      abortController: new AbortController(),
      activeToolIds: new Set(),
      headless: input.headless === true
    }

    if (existing && this.runtimeStatus(existing) === 'idle') {
      // A warm connection is always safe to reuse: per-turn headless enforcement lives in `canUseTool`
      // and PreToolUse hooks (resolved by session id at fire-time via `getInteractionState`), so the
      // connection's baked settings no longer vary by headless mode and never need a mismatch rebuild.
      this.clearIdleTimer(existing)
      existing.topicId = input.topicId
      existing.sessionTraceId = input.traceId ?? existing.sessionTraceId
      existing.agentId = input.agentId
      existing.agentType = input.agentType
      existing.modelId = input.modelId
      existing.messageSnapshot = messageSnapshot
      this.applyRuntimeStateEvent(existing, { type: 'begin-turn', turn, clearQueue: true })
      this.applyRuntimeStateEvent(existing, { type: 'clear-steer-reservation' })

      return {
        listeners: [
          this.createPersistenceListener(existing, userMessage),
          new AgentSessionRuntimeTerminalListener(this, input.sessionId, turnId),
          new TraceFlushListener(input.topicId)
        ],
        turnId,
        abortController: turn.abortController
      }
    }

    if (existing) void this.closeSession(input.sessionId)

    const entry: AgentSessionRuntimeEntry = {
      sessionId: input.sessionId,
      topicId: input.topicId,
      sessionTraceId: input.traceId,
      agentId: input.agentId,
      agentType: input.agentType,
      modelId: input.modelId,
      messageSnapshot,
      runtimeState: createAgentSessionRuntimeState(turn)
    }
    this.entries.set(input.sessionId, entry)

    return {
      listeners: [
        this.createPersistenceListener(entry, userMessage),
        new AgentSessionRuntimeTerminalListener(this, input.sessionId, turnId),
        new TraceFlushListener(input.topicId)
      ],
      turnId,
      abortController: turn.abortController
    }
  }

  /**
   * Resolve the trusted gateway correlation into the reserved continuation or active turn.
   * The gateway calls this at provider-request ingress, before any later agent edit,
   * message roll, or deletion can affect usage persistence.
   */
  getActiveUsageContext(sessionId: string): InProcessUsageContext | undefined {
    const entry = this.entries.get(sessionId)
    const reservation =
      entry?.runtimeState.execution.kind === 'turn'
        ? entry.runtimeState.execution.reservation
        : entry?.runtimeState.execution.kind === 'steer-transition'
          ? entry.runtimeState.execution.reservation
          : undefined
    if (reservation) {
      return {
        agentSessionId: sessionId,
        assistantMessageId: reservation.assistantMessageId,
        source: sourceSnapshotFromMessageSnapshot(reservation.messageSnapshot)
      }
    }

    const turn = entry ? this.liveTurn(entry) : undefined
    if (!turn) return undefined
    return {
      agentSessionId: sessionId,
      assistantMessageId: turn.assistantMessageId,
      source: sourceSnapshotFromMessageSnapshot(turn.messageSnapshot)
    }
  }

  private reserveSteerContinuation(entry: AgentSessionRuntimeEntry, inputs: AgentRuntimeUserInput[]): void {
    if (!this.isCurrentEntry(entry) || entry.usageCapture?.owner !== 'provider-calls') return
    const turn = this.currentTurn(entry)
    const steerMessage = inputs[0]?.message
    if (
      !turn ||
      !this.isTurnLive(entry, turn) ||
      !steerMessage ||
      (entry.runtimeState.execution.kind === 'turn' && entry.runtimeState.execution.reservation)
    ) {
      return
    }

    const messageSnapshot = inputs[0]?.messageSnapshot ?? entry.messageSnapshot
    this.applyRuntimeStateEvent(entry, {
      type: 'reserve-steer',
      reservation: {
        assistantMessageId: uuidv7(),
        userMessageId: steerMessage.id,
        ...(messageSnapshot ? { messageSnapshot: structuredClone(messageSnapshot) } : {})
      }
    })
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
        runtimeState: createAgentSessionRuntimeState()
      }
      this.entries.set(sessionId, entry)

      const connected = await this.ensureConnection(entry)
      // A turn may have superseded/cleared this entry while connecting — leave its lifecycle to it.
      if (this.entries.get(sessionId) !== entry) return
      if (!connected) {
        void this.closeSession(sessionId)
        return
      }
      // Still idle (no turn took over): arm the TTL so an unused primed connection self-closes.
      if (this.runtimeStatus(entry) === 'idle' && !this.liveTurn(entry)) {
        this.refreshIdleTimer(entry)
      }
    } catch (error) {
      logger.warn('Failed to prime agent session connection', { sessionId, error })
    }
  }

  /**
   * Push side of connection reconcile — a latency optimization over the pull that every fresh turn
   * runs in {@link ensureConnection}: agent edits apply to live/idle connections without waiting for
   * the next message. The connection's `reconcile` re-derives the desired config itself, so no
   * per-field knowledge lives here: safe tool-policy changes hot-apply, permission-mode changes
   * defer to the next turn boundary, and spawn-frozen changes (model, workspace, skills, sub-models,
   * MCP definitions, …) report 'rebuild'. Inputs that change WITHOUT an agent-updated event
   * (in-session skill toggles, MCP definition edits, workspace switches) have no push at all and are
   * covered by the pull.
   */
  private async handleAgentUpdated(agentId: string, updates: UpdateAgentDto, agent: AgentEntity): Promise<void> {
    const modelEdited = Object.prototype.hasOwnProperty.call(updates, 'model')
    const reconciles: Promise<void>[] = []
    for (const entry of this.entries.values()) {
      if (entry.agentId !== agentId) continue

      // A cleared model (`PATCH { model: null }`) is unroutable, not stale — fully invalidate.
      if (modelEdited && !agent.model) {
        this.invalidateModelClearedEntry(entry)
        continue
      }

      // Bookkeeping: fresh turns are stamped with (and steers gated on) the entry's latest model. A
      // live turn keeps its captured `turn.modelId` regardless.
      if (agent.model) entry.modelId = agent.model
      reconciles.push(this.reconcileEntryConnection(entry))
    }
    await Promise.all(reconciles)
  }

  private async reconcileEntryConnection(entry: AgentSessionRuntimeEntry): Promise<void> {
    const connection = this.currentConnection(entry)
    if (!connection) return

    let verdict: AgentRuntimeReconcileResult
    try {
      verdict = await connection.reconcile(this.connectionTarget(entry))
    } catch (error) {
      logger.error('Connection reconcile threw; failing closed', { sessionId: entry.sessionId, error })
      this.closeFailedPolicyUpdateConnection(entry, connection)
      return
    }
    // The entry/connection may have been replaced while reconcile awaited — never act on a successor.
    if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return

    switch (verdict) {
      case 'current':
      case 'patched':
        return
      case 'rebuild': {
        // Safe live patches are already applied. Rebuild eagerly only when nothing is streaming —
        // a roll or non-terminal turn keeps its connection, and the next fresh turn's pull picks up
        // the rebuild plus any permission-mode change deferred at the turn boundary.
        const hasLiveTurn =
          this.liveTurn(entry) !== undefined ||
          isAgentSessionRuntimeTransitioning(entry.runtimeState) ||
          hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)
        if (!hasLiveTurn) this.closeConnectionAsync(entry)
        return
      }
      case 'invalid':
        // Desired config no longer derivable (agent/session/model rows gone) — same full
        // invalidation as a cleared model.
        this.invalidateModelClearedEntry(entry)
        return
      case 'failed':
        // Fail closed: a failed live patch may have left the connection enforcing the OLD (looser)
        // policy — the snapshot's `permissionMode` gates `canUseTool`, so a failed tighten must not
        // keep running. Pause the live turn and tear the connection down.
        logger.error('Live connection reconcile failed; closing runtime connection', { sessionId: entry.sessionId })
        this.closeFailedPolicyUpdateConnection(entry, connection)
        return
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
    if (this.liveTurn(entry)) {
      application.get('AiStreamManager').pauseRuntimeTurn(entry.topicId, 'agent-model-cleared')
    }
    void this.closeSession(entry.sessionId)
  }

  openTurnStream(input: OpenAgentSessionTurnStreamInput): ReadableStream<UIMessageChunk> {
    const entry = this.entries.get(input.sessionId)
    const turn = entry ? this.currentTurn(entry) : undefined
    if (!entry || !turn || turn.turnId !== input.turnId) {
      throw new Error(`No active agent runtime turn ${input.turnId} for session ${input.sessionId}`)
    }

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          this.clearIdleTimer(entry)
          turn.controller = controller
          this.applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn })

          // A user Stop is the only abort source now (steer no longer interrupts) — tear the
          // session down so `connection.close()` kills the warm query and its subagent.
          const onAbort = () => void this.closeSession(entry.sessionId)
          if (input.signal.aborted) {
            onAbort()
            return
          } else {
            input.signal.addEventListener('abort', onAbort, { once: true })
          }

          controller.enqueue({ type: 'start' })
          // A steer/autonomous transition owns any chunks that arrived before this controller. The
          // state transition atomically transfers that buffer to this exact turn before admission.
          this.applyRuntimeStateEvent(entry, { type: 'flush-transition' })
          if (!this.isTurnLive(entry, turn)) return
          const connected = await this.ensureConnection(entry)
          if (!connected || !this.isCurrentEntry(entry) || !this.isTurnLive(entry, turn)) return
          await this.admitTurn(entry, turn)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel: () => {
        // Routed through the machine so the settle is a real transition (`awaiting-persistence`)
        // rather than an out-of-band mutation the busy/live queries cannot see.
        this.applyRuntimeStateEvent(entry, { type: 'runtime-terminal', outcome: { status: 'paused' } })
      }
    })
  }

  enqueueUserMessage(
    sessionId: string,
    message: AgentSessionMessageEntity,
    opts: {
      headless?: boolean
      messageSnapshot?: MessageSnapshot
      reasoningEffort?: ReasoningEffortOption
      fastMode?: boolean
    } = {}
  ): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    this.clearIdleTimer(entry)
    // Message attributes ride the payloads themselves: a redirect carries them through the driver
    // round-trip (steer-boundary/steer-undelivered), a queued follow-up carries them on its queue item.
    const headless = opts.headless === true
    const messageSnapshot = opts.messageSnapshot ? structuredClone(opts.messageSnapshot) : undefined
    const reasoningEffort = opts.reasoningEffort ?? 'default'
    const knowledgeBaseIds = getKnowledgeBaseIdsFromParts(message.data.parts ?? []) ?? []
    const fastMode = opts.fastMode === true

    const turn = this.currentTurn(entry)
    // Live turn + a backend that can steer → inject into the running turn (claude's PreToolUse steer
    // hook): the steer is folded into the current turn — no new turn, no queue entry. If the turn
    // ends before it's injected, the connection emits `steer-undelivered` and we queue it below.
    // The gate compares the live turn's frozen model/reasoning/Fast/knowledge config with the incoming
    // message: a changed effective connection scope must queue as the NEXT turn instead of being
    // folded into a query already running with different tools.
    const configuredKnowledgeBaseIds = agentService.getAgent(entry.agentId)?.knowledgeBaseIds
    const canRedirectOnCurrentConfig =
      turn?.modelId === entry.modelId &&
      turn.reasoningEffort === reasoningEffort &&
      turn.fastMode === fastMode &&
      knowledgeScopeEquals(
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, turn.knowledgeBaseIds),
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, knowledgeBaseIds)
      )
    if (
      turn &&
      this.isTurnLive(entry, turn) &&
      canRedirectOnCurrentConfig &&
      this.currentConnection(entry)?.redirect?.({
        message,
        systemReminder: true,
        ...(headless ? { headless } : {}),
        ...(messageSnapshot ? { messageSnapshot } : {})
      })
    ) {
      return
    }

    // No live turn (or backend can't steer) → queue as the next turn, wrapped in a steer system-reminder.
    this.applyRuntimeStateEvent(entry, {
      type: 'queue-turn',
      turn: {
        message,
        reasoningEffort,
        knowledgeBaseIds,
        fastMode,
        steer: true,
        ...(headless ? { headless } : {}),
        ...(messageSnapshot ? { messageSnapshot } : {})
      }
    })
    // An autonomous generation owns the connection until the runtime releases it.
    // Keep the user input queued instead of sending it into that generation.
    if ((!turn || !this.isTurnLive(entry, turn)) && !isAgentSessionRuntimeAutonomous(entry.runtimeState)) {
      this.requestRuntimeLaunch(entry, 'queued-turn')
    }
  }

  markTurnTerminal(sessionId: string, status: AgentSessionRuntimeTerminalStatus, expectedTurnId?: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    const completedTurn = this.currentTurn(entry)
    if (expectedTurnId) {
      const execution = entry.runtimeState.execution
      const executionOwnsTurn =
        (execution.kind === 'turn' && execution.turn === completedTurn) ||
        (execution.kind === 'steer-transition' &&
          (execution.sourceTurn === completedTurn || execution.continuationTurn === completedTurn)) ||
        (execution.kind === 'autonomous-turn' && execution.turn === completedTurn)
      if (!executionOwnsTurn || completedTurn?.turnId !== expectedTurnId) return
    }
    if (completedTurn) this.markFlowMessagePersisted(entry, completedTurn.assistantMessageId)
    if (completedTurn) {
      this.applyRuntimeStateEvent(entry, { type: 'turn-terminal', turn: completedTurn, status })
    }

    // Connection stays warm across turns (no per-turn close) — only `closeSession`/idle TTL tears it
    // down. A queued steer drains into the same warm subprocess via `scheduleNextTurn`.
    if (
      entry.runtimeState.execution.kind === 'idle' &&
      entry.runtimeState.queue.length > 0 &&
      !isAgentSessionRuntimeAutonomous(entry.runtimeState)
    ) {
      this.requestRuntimeLaunch(entry, 'queued-turn')
    } else {
      this.refreshIdleTimer(entry)
    }
  }

  closeSession(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry) return Promise.resolve()
    const fallbackConnection = this.currentConnection(entry)
    let closing: Promise<void>
    try {
      closing = this.closeEntry(entry)
    } catch (error) {
      logger.warn('Agent runtime entry close failed', { sessionId, error })
      closing = this.closeRuntimeConnection(fallbackConnection, sessionId)
    }
    if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId)
    return closing
  }

  /**
   * Release a connection opened by {@link primeConnection} (or left idle after a turn) when its
   * session view closes — frees the subprocess and clears the cached catalog now instead of waiting
   * out the idle TTL. No-op while a turn is in flight or background work still owns connection-local
   * resources. Background keepalive is deliberately not "busy": a new user turn may still start.
   */
  releaseIdleConnection(sessionId: string): void {
    const idleEntry = this.entries.get(sessionId)
    if (idleEntry && hasAgentSessionRuntimeBackgroundWork(idleEntry.runtimeState)) return
    if (this.isSessionBusy(sessionId)) return
    void this.closeSession(sessionId)
  }

  /**
   * Whether the session has a turn in flight or about to start: a non-terminal current turn,
   * a scheduled/running launch, or queued follow-ups. The dispatcher
   * uses this — NOT `AiStreamManager.hasLiveStream` — to decide enqueue-vs-begin, because
   * `hasLiveStream` is false during the inter-turn drain window while the entry is still
   * mid-transition; a fresh dispatch trusting `hasLiveStream` there would clobber the drain via
   * `beginTurn`.
   */
  isSessionBusy(sessionId: string): boolean {
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    return isAgentSessionRuntimeBusy(entry.runtimeState)
  }

  /** Whether any agent session can still mutate its DB row or external runtime files. */
  hasBusySessions(): boolean {
    for (const sessionId of this.entries.keys()) {
      if (this.isSessionBusy(sessionId)) return true
    }
    return false
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
    // A steer transition means A1a just closed and the continuation (A2) is coming — keep the
    // stream alive so A2 carries the renderer listeners.
    // `compacting`: a compaction is mid-flight between turns; keep the stream alive so its
    // compaction-anchor / completion chunks (and the resumed turn) still reach the renderer.
    return willAgentSessionRuntimeContinue(entry.runtimeState)
  }

  inspect(sessionId: string): AgentSessionRuntimeSnapshot | undefined {
    const entry = this.entries.get(sessionId)
    if (!entry) return undefined
    const turn = this.currentTurn(entry)

    return {
      sessionId: entry.sessionId,
      topicId: entry.topicId,
      assistantMessageId: turn?.assistantMessageId,
      status: this.runtimeStatus(entry),
      pendingMessageCount: entry.runtimeState.queue.length,
      lastTerminalStatus: entry.runtimeState.lastTerminal,
      resumeToken: entry.lastResumeToken,
      activeToolCount: turn?.activeToolIds.size ?? 0
    }
  }

  // ── Write quiesce (backup restore) ───────────────────────────────
  // Contract shared with JobManager / AiStreamManager / ChannelManager (issues
  // #16849/#16850). Every queued, steer-continuation, receive-only and deferred launch
  // enters through the same state-machine gate before it can consume state or write a
  // placeholder. A pause therefore leaves work represented in memory and DB-consistent;
  // the last hold's disposal re-kicks the exact suppressed target.
  // New-turn admission via `prepareDispatch`/`beginTurn` is gated upstream by
  // AiStreamManager.

  /** True while any write-quiesce hold is live. */
  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  /**
   * Pause autonomous launches: queued follow-ups, steer continuations, receive-only wakes
   * and deferred turns are suppressed before their launch body while any hold is live.
   * In-flight launches keep running until drained. No resume() — dispose your own hold;
   * the last disposal re-kicks suppressed starts. A dropped hold fails closed.
   */
  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'agent-session-runtime-pause')
    this.pauseHolds.add(token)
    logger.info('AgentSessionRuntimeService paused', { reason: reason ?? null, holds: this.pauseHolds.size })
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('AgentSessionRuntimeService pause hold released', {
          reason: reason ?? null,
          holds: this.pauseHolds.size
        })
        if (this.pauseHolds.size > 0) return
        // Shutdown wins: onStop owns the teardown; a compensation kick would only race it.
        if (this.isShuttingDown) return
        this.runReleaseCompensation()
      }
    }
  }

  /**
   * Await in-flight turn-start launches (placeholder write + `startRuntimeTurn` handoff),
   * bounded by timeoutMs. Never rejects; stragglers are NOT aborted. The resulting stream
   * writes are AiStreamManager's drain — this only covers the window this service writes in.
   * The set can grow one step while draining (a settling turn schedules the next start
   * before the pause gate suppresses it), so the drain is a fixed point over promise
   * identities rather than one snapshot.
   *
   * PRECONDITION: hold a live pause() hold — without one the verdict is a point-in-time
   * snapshot (warned, not thrown).
   */
  async drainInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    if (!this.isWriteQuiesced) {
      logger.warn('drainInFlight called without an active pause hold — the verdict is a point-in-time snapshot')
    }

    const seen = new WeakSet<Promise<unknown>>()
    const pending = new Map<Promise<unknown>, string>()
    const collect = (): void => {
      for (const [sessionId, launch] of this.inFlightTurnStarts) {
        if (seen.has(launch)) continue
        seen.add(launch)
        pending.set(launch, sessionId)
        const remove = () => pending.delete(launch)
        launch.then(remove, remove)
      }
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), opts.timeoutMs)
    })
    try {
      for (;;) {
        collect()
        if (pending.size === 0) return { stragglerIds: [] }
        const winner = await Promise.race([
          Promise.allSettled([...pending.keys()]).then(() => 'done' as const),
          timeout
        ])
        if (winner === 'timeout') {
          const stragglerIds = [...new Set(pending.values())]
          logger.warn('drainInFlight timed out with unsettled work', { timeoutMs: opts.timeoutMs, stragglerIds })
          return { stragglerIds }
        }
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  /** Advisory pre-flight enumeration for the restore orchestrator. Read-only, in-memory. */
  listActiveWork(): Array<{ id: string; summary: string }> {
    const work: Array<{ id: string; summary: string }> = []
    for (const [sessionId, entry] of this.entries) {
      if (!this.isSessionBusy(sessionId)) continue
      const turn = this.liveTurn(entry) ? 'live' : '-'
      work.push({
        id: sessionId,
        summary: `turn=${turn} pending=${entry.runtimeState.queue.length} execution=${entry.runtimeState.execution.kind} compacting=${isAgentSessionRuntimeCompacting(entry.runtimeState)} launch=${entry.runtimeState.launch.kind}`
      })
    }
    return work
  }

  /** Last-hold release: re-kick suppressed turn starts. The re-check guard skips WITHOUT
   *  draining the map, so a newer hold (or shutdown) inherits the debt. */
  private runReleaseCompensation(): void {
    if (this.isShuttingDown || this.isWriteQuiesced) return
    for (const entry of this.entries.values()) {
      if (entry.runtimeState.launch.kind !== 'suppressed') continue
      this.applyRuntimeStateEvent(entry, { type: 'launch-resumed' })
    }
  }

  /**
   * Resolve a Claude `canUseTool` approval registered against this runtime session. Persisted
   * interaction messages are settled before their SDK promise; live overlays are cleared after it.
   * Returns `false` if no registry entry matches so the caller can fall back to the MCP path.
   */
  respondToolApproval(approvalId: string, decision: DispatchDecision, anchorId?: string): boolean {
    const pending = toolApprovalRegistry.peek(approvalId)
    if (!pending) return false

    if (pending.presentation === 'message') {
      if (!anchorId) {
        logger.warn('Persisted tool approval response is missing its anchor message', { approvalId })
        return false
      }
      const applied = agentSessionMessageService.applyToolApprovalDecision(pending.sessionId, anchorId, {
        approvalId,
        approved: decision.approved,
        ...(decision.reason !== undefined && { reason: decision.reason }),
        ...(decision.updatedInput !== undefined && { updatedInput: decision.updatedInput })
      })
      if (!applied) {
        logger.warn('Persisted tool approval response did not match a pending card', {
          approvalId,
          anchorId
        })
        return false
      }
    }

    const dispatched = toolApprovalRegistry.dispatch(approvalId, decision)
    if (!dispatched) return false

    if (dispatched.presentation === 'stream') {
      application
        .get('AiStreamManager')
        .resolveToolApproval(buildAgentSessionTopicId(dispatched.sessionId), dispatched.toolCallId)
    }
    return true
  }

  /**
   * Stop one background task, leaving the turn and the session running. The runtime answers with a
   * `task_notification` carrying status `stopped`, so nothing is updated here. Returns false when
   * the session has no live connection or its runtime cannot stop tasks.
   */
  async stopBackgroundTask(sessionId: string, taskId: string): Promise<boolean> {
    const entry = this.entries.get(sessionId)
    const connection = entry ? this.currentConnection(entry) : undefined
    if (!connection?.stopTask) return false
    return await connection.stopTask(taskId)
  }

  recordToolExecutionTiming(
    sessionId: string,
    input: { toolCallId: string; toolName: string; durationMs: number }
  ): boolean {
    const entry = this.entries.get(sessionId)
    const turn = entry ? this.liveTurn(entry) : undefined
    if (!entry || !turn || !Number.isFinite(input.durationMs) || input.durationMs < 0) {
      return false
    }
    const completedAt = Date.now()
    return application.get('AiStreamManager').addCompletedRuntimeSpan(entry.topicId, turn.assistantMessageId, {
      id: `tool:${input.toolCallId}`,
      kind: 'tool-execution',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      startedAt: completedAt - input.durationMs,
      completedAt
    })
  }

  abortPendingTurn(sessionId: string, reason: string): boolean {
    const entry = this.entries.get(sessionId)
    const turn = entry ? this.liveTurn(entry) : undefined
    if (!turn || turn.abortController.signal.aborted) return false
    turn.abortController.abort(reason)
    return true
  }

  protected async onStop(): Promise<void> {
    this.isShuttingDown = true
    try {
      toolApprovalRegistry.clear('agent-session-runtime-stop')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during stop', { error })
    }
    await this.closeAll()
  }

  protected async onDestroy(): Promise<void> {
    await this.closeAll()
    try {
      toolApprovalRegistry.clear('agent-session-runtime-destroy')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during destroy', { error })
    }
  }

  private isCurrentEntry(entry: AgentSessionRuntimeEntry): boolean {
    return this.entries.get(entry.sessionId) === entry
  }

  /**
   * Model the session's connection should serve right now. A live turn runs on the model captured
   * when it was created — its assistant row, persistence and trace are already stamped with it, so
   * a model edit landing between turn creation and its stream opening must NOT retarget the
   * connection (the turn would execute on a different model than it records). A steer roll counts as
   * live too: at a `steer-boundary` A1a is already terminal while the steer-transition stays active and the
   * same SDK query keeps streaming the post-steer response on A1a's captured model — retargeting in
   * that gap (e.g. a re-prime re-entering `ensureConnection`) would close the connection and drop the
   * continuation. Mirrors the live-turn test in `applyAgentModelUpdate`. Without a live turn or roll
   * the connection follows the agent's latest model with the default reasoning selection.
   *
   * The turn's Fast and knowledge selections are frozen for exactly the same reason and on the same schedule.
   * Note the idle branch's `knowledgeBaseIds: []` means "no per-turn composer selection", NOT "no
   * knowledge": it is fed through `resolveKnowledgeBaseScope` against the agent's binding below, so a
   * statically bound agent still serves its full binding while idle. Idle deliberately converges on
   * the default config — same as `reasoningEffort: 'default'` — so any turn that carried a composer
   * selection (an unbound agent's whole scope, or a bound agent's narrowing) costs one rebuild once
   * it goes idle. That is intentional: the next turn's selection is unknowable, and prewarm builds
   * binding-only scope too, so pinning the last turn's selection would only move the rebuild onto the
   * next turn that does not repeat it.
   */
  private connectionTarget(entry: AgentSessionRuntimeEntry): AgentSessionConnectionTarget {
    const turn =
      this.currentTurn(entry) ??
      (entry.runtimeState.execution.kind === 'autonomous-turn' ? entry.runtimeState.execution.contextTurn : undefined)
    const live =
      turn &&
      (this.isTurnLive(entry, turn) ||
        isAgentSessionRuntimeTransitioning(entry.runtimeState) ||
        hasAgentSessionRuntimeBackgroundWork(entry.runtimeState))
    return live
      ? {
          modelId: turn.modelId,
          reasoningEffort: turn.reasoningEffort,
          knowledgeBaseIds: turn.knowledgeBaseIds,
          fastMode: turn.fastMode
        }
      : { modelId: entry.modelId, reasoningEffort: 'default', knowledgeBaseIds: [], fastMode: false }
  }

  private connectionTargetEquals(entry: AgentSessionRuntimeEntry, target: AgentSessionConnectionTarget): boolean {
    const current = this.connectionTarget(entry)
    const configuredKnowledgeBaseIds = agentService.getAgent(entry.agentId)?.knowledgeBaseIds
    return (
      current.modelId === target.modelId &&
      current.reasoningEffort === target.reasoningEffort &&
      current.fastMode === target.fastMode &&
      knowledgeScopeEquals(
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, current.knowledgeBaseIds),
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, target.knowledgeBaseIds)
      )
    )
  }

  private async ensureConnection(entry: AgentSessionRuntimeEntry): Promise<boolean> {
    while (this.isCurrentEntry(entry)) {
      const target = this.connectionTarget(entry)
      const connection = this.currentConnection(entry)
      if (connection) {
        // A connection carrying a live SDK stream is NEVER reconciled here: closing it would drop
        // the stream. The execution admission phase is load-bearing — the steer continuation (A2)
        // is pre-admitted and `flush-transition` moves it to a normal turn BEFORE openTurnStream reaches
        // this point, so `admitted` alone protects the still-streaming roll. (This also closes
        // #16796's steer-window edge case: the continuation always reuses the transition's connection.)
        // A fresh, unadmitted turn DOES reconcile — it must run on the latest config.
        const turn = this.currentTurn(entry)
        if (
          isAgentSessionRuntimeAutonomous(entry.runtimeState) ||
          isAgentSessionRuntimeTransitioning(entry.runtimeState) ||
          (turn && isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turn) && this.isTurnLive(entry, turn))
        ) {
          return true
        }

        // TOCTOU discipline: reconcile acts on the CAPTURED connection (its live patches land on
        // the right object even if the entry moves on), and every close decision below re-validates
        // that the captured connection is still the entry's current one. A thrown reconcile fails
        // closed like the push path: the suspect connection is replaced by a fresh one.
        let verdict: AgentRuntimeReconcileResult
        try {
          verdict = await connection.reconcile(target)
        } catch (error) {
          logger.error('Connection reconcile threw; failing closed', { sessionId: entry.sessionId, error })
          verdict = 'failed'
        }
        if (!this.isCurrentEntry(entry)) return false
        if (this.currentConnection(entry) !== connection) continue
        // A turn may have been admitted while reconcile awaited (e.g. a racing openTurnStream that
        // reused the connection) — its stream now rides this connection, so stop touching it.
        const turnAfter = this.currentTurn(entry)
        if (
          isAgentSessionRuntimeAutonomous(entry.runtimeState) ||
          isAgentSessionRuntimeTransitioning(entry.runtimeState) ||
          (turnAfter &&
            isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turnAfter) &&
            this.isTurnLive(entry, turnAfter))
        ) {
          return true
        }

        switch (verdict) {
          case 'current':
          case 'patched':
            return true
          case 'rebuild': {
            // Background work may keep the old connection alive, but it cannot make a spawn-frozen
            // mismatch safe. Hold this fresh turn until the driver releases that work, then loop,
            // close A, connect B, and only then admit the user input.
            if (hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)) {
              logger.info('Deferring connection rebuild until background work releases', {
                sessionId: entry.sessionId
              })
              await this.waitForBackgroundWorkRelease(entry, connection, target)
              if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) continue
              logger.info('Background work released; retrying connection rebuild', {
                sessionId: entry.sessionId
              })
              continue
            }
            this.closeConnectionAsync(entry)
            continue
          }
          case 'failed':
            // 'failed' pre-turn is recoverable: the suspect connection is torn down (fail closed)
            // and the loop reconnects from the latest config.
            this.closeConnectionAsync(entry)
            continue
          case 'invalid':
            void this.closeSession(entry.sessionId)
            return false
        }
      }

      // Share a single in-flight connect across concurrent callers so two streams opening at once
      // can't each spin up a connection (the second would leak/clobber the first). Whatever that
      // connect produces, loop and re-check it — a stale attempt self-discards in `connect()` and a
      // fresh one passes the reconcile above.
      const existingAttempt = this.connectionAttempts.get(entry.sessionId)
      if (existingAttempt) {
        await existingAttempt.promise.catch(() => false)
        continue
      }

      const attemptId = crypto.randomUUID()
      this.applyRuntimeStateEvent(entry, { type: 'connection-started', attemptId })
      const connecting = this.connect(entry, target, attemptId).finally(() => {
        if (this.connectionAttempts.get(entry.sessionId)?.id === attemptId) {
          this.connectionAttempts.delete(entry.sessionId)
        }
        if (
          this.isCurrentEntry(entry) &&
          entry.runtimeState.connection.kind === 'connecting' &&
          entry.runtimeState.connection.attemptId === attemptId
        ) {
          this.applyRuntimeStateEvent(entry, { type: 'connection-disconnected' })
        }
      })
      this.connectionAttempts.set(entry.sessionId, { id: attemptId, promise: connecting })
      const connected = await connecting
      if (connected) return true
    }

    return false
  }

  private async connect(
    entry: AgentSessionRuntimeEntry,
    target: AgentSessionConnectionTarget,
    attemptId: string
  ): Promise<boolean> {
    const driver = runtimeDriverRegistry.getAgentSessionDriver(entry.agentType)
    if (!driver) throw new Error(`Unsupported agent runtime type: ${entry.agentType}`)

    this.hydrateResumeToken(entry)
    if (!this.isCurrentEntry(entry)) return false

    const connection = await driver.connect({
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      modelId: target.modelId,
      reasoningEffort: target.reasoningEffort,
      knowledgeBaseIds: target.knowledgeBaseIds,
      fastMode: target.fastMode,
      resumeToken: entry.lastResumeToken,
      trace: this.sessionTraceContext(entry, target.modelId),
      onSteerInjected: (inputs) => this.reserveSteerContinuation(entry, inputs)
    })
    if (!this.isCurrentEntry(entry) || !this.connectionTargetEquals(entry, target)) {
      void this.closeRuntimeConnection(connection, entry.sessionId)
      return false
    }

    this.applyRuntimeStateEvent(entry, { type: 'connection-connected', attemptId, connection })
    if (this.currentConnection(entry) !== connection) {
      void this.closeRuntimeConnection(connection, entry.sessionId)
      return false
    }
    entry.usageCapture = connection.usageCapture
    this.resetConnectionRuntimeState(entry, connection)
    // Priming opens an idle connection only to populate connection-local metadata such as slash
    // commands. Context usage is expensive (the SDK issues multiple token-count probes), so defer it
    // until a real turn, a runtime event, or an explicit UI refresh needs a reading.
    if (this.runtimeStatus(entry) === 'active') this.refreshContextUsage(entry, connection)
    this.refreshSupportedCommands(entry, connection)
    const connectionLoop = this.runConnectionLoop(entry, connection).finally(() => {
      if (this.currentConnection(entry) === connection) {
        this.resetConnectionRuntimeState(entry, connection)
        this.applyRuntimeStateEvent(entry, { type: 'connection-disconnected', connection })
        if (entry.runtimeState.queue.length > 0 && !this.liveTurn(entry)) {
          this.requestRuntimeLaunch(entry, 'queued-turn')
        }
      }
      if (entry.connectionLoop === connectionLoop) entry.connectionLoop = undefined
    })
    entry.connectionLoop = connectionLoop
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
        if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) break
        this.handleRuntimeEvent(entry, event, connection)
      }
    } catch (error) {
      if (this.isCurrentEntry(entry) && this.currentConnection(entry) === connection) {
        this.handleRuntimeError(entry, error)
      }
    }
  }

  private handleRuntimeEvent(
    entry: AgentSessionRuntimeEntry,
    event: AgentRuntimeEvent,
    connection = this.currentConnection(entry)
  ): void {
    switch (event.type) {
      case 'resume-token':
        entry.lastResumeToken = event.token
        if (this.runtimeStatus(entry) === 'active') this.refreshContextUsage(entry)
        break
      case 'chunk': {
        // Any content chunk means the retried request succeeded and the stream resumed — clear the
        // ephemeral retry status (backoff windows produce no chunks, so this never fires mid-retry).
        this.clearApiRetry(entry)
        // During a transition A1a is closed, or the receive-only stream is not open yet. Buffer the
        // chunks so `flush-transition` can replay them into the exact successor stream in order.
        const execution = entry.runtimeState.execution
        const turn = this.currentTurn(entry)
        if (
          execution.kind === 'steer-transition' ||
          (execution.kind === 'autonomous-turn' && !hasAgentSessionRuntimeOpenStream(entry.runtimeState, turn))
        ) {
          this.applyRuntimeStateEvent(entry, { type: 'buffer-chunk', chunk: event.chunk })
          break
        }
        if (turn?.controller && this.isTurnLive(entry, turn)) this.enqueueTurnChunk(entry, turn, event.chunk)
        break
      }
      case 'tool-approval-request':
        this.handleToolApprovalRequest(entry, event.request)
        break
      case 'usage':
        this.recordRuntimeUsage(entry, event.invocation)
        break
      case 'steer-boundary':
        // The model is about to emit its post-steer assistant message. Finalise the pre-steer parts as
        // A1a, then buffer the continuation until `startContinuationTurn` opens A2. The reducer keeps
        // A1a awaiting persistence and does not schedule A2 until the stream terminal listener fires.
        // A responder exists if the pre-steer turn was interactive or any injected steer came from one.
        this.applyRuntimeStateEvent(entry, {
          type: 'steer-boundary',
          inputs: event.inputs,
          headless: this.currentTurn(entry)?.headless === true && event.inputs.every((input) => input.headless === true)
        })
        break
      case 'steer-undelivered':
        // Steers stashed via redirect() that this turn ended before injecting → queue them as the
        // next turn (with a steer system-reminder). The following `turn-complete` → markTurnTerminal
        // drains the state-machine queue through the queued-turn launch.
        for (const input of event.inputs) {
          this.applyRuntimeStateEvent(entry, {
            type: 'queue-turn',
            turn: {
              message: input.message,
              reasoningEffort: this.currentTurn(entry)?.reasoningEffort ?? 'default',
              knowledgeBaseIds: getKnowledgeBaseIdsFromParts(input.message.data.parts ?? []) ?? [],
              fastMode: this.currentTurn(entry)?.fastMode ?? false,
              steer: true,
              ...(input.headless ? { headless: true } : {}),
              ...(input.messageSnapshot ? { messageSnapshot: input.messageSnapshot } : {})
            }
          })
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
      case 'api-retry':
        this.handleApiRetry(entry, event.retry)
        break
      case 'context-usage':
        this.persistContextUsage(entry, event.usage)
        break
      case 'supported-commands':
        // SDK pushed a refreshed catalog (`commands_changed`) — replace the cached list so the
        // composer and channel `/help` reflect commands discovered after the initial read.
        this.publishSupportedCommands(entry, event.commands)
        break
      case 'background-tasks':
        this.publishBackgroundTasks(entry, event.tasks, connection)
        break
      case 'background-work-state':
        this.handleBackgroundWorkState(entry, event.active, connection)
        break
      case 'background-task-event':
        this.publishBackgroundTaskEvent(entry, event.data, connection)
        break
      case 'background-flow-chunk':
        this.handleBackgroundFlowChunk(entry, event.rootToolCallId, event.chunk, connection)
        break
      case 'autonomous-turn-state': {
        if (event.state === 'finished') {
          this.handleAutonomousGenerationFinished(entry, connection)
          break
        }
        // Runtime-generated content is already streaming. The autonomous execution state buffers
        // chunks until its receive-only stream exists and owns any still-unadmitted user turn.
        const turn = this.currentTurn(entry)
        const turnLive = turn !== undefined && this.isTurnLive(entry, turn)
        if (turnLive && turn && isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turn)) break
        if (entry.runtimeState.execution.kind === 'steer-transition') break
        this.applyRuntimeStateEvent(entry, {
          type: 'autonomous-turn-state',
          state: 'started',
          deferCurrentTurn: turnLive,
          contextTurn: turn
        })
        this.clearIdleTimer(entry)
        if (turnLive && turn) {
          this.deferUnadmittedTurnForReceiveOnly(entry, turn)
        } else {
          this.requestRuntimeLaunch(entry, 'receive-only')
        }
        break
      }
      case 'turn-complete':
        this.clearApiRetry(entry)
        if (entry.runtimeState.execution.kind === 'turn') {
          this.applyRuntimeStateEvent(entry, { type: 'clear-steer-reservation' })
        }
        this.applyRuntimeStateEvent(entry, {
          type: 'runtime-terminal',
          outcome: { status: 'success' }
        })
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
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'compaction', active: true })
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
      status: 'compacting',
      startedAt: new Date().toISOString(),
      ...(trigger ? { trigger } : {})
    })
  }

  private recordRuntimeUsage(
    entry: AgentSessionRuntimeEntry,
    invocation: Extract<AgentRuntimeEvent, { type: 'usage' }>['invocation']
  ): void {
    const capture = entry.usageCapture
    if (capture?.owner !== 'agent-sdk') return

    const turn = invocation.messageAssociation === 'current-turn' ? this.liveTurn(entry) : undefined
    if (invocation.messageAssociation === 'current-turn' && !turn) {
      logger.warn('Agent SDK usage lost its active turn before persistence; recording stateless', {
        sessionId: entry.sessionId,
        requestId: invocation.requestId
      })
    }

    const normalizedModel = normalizeClaudeModelAlias(invocation.model)
    const frozenModel = capture.frozenModels.find((candidate) =>
      candidate.aliases.some((alias) => normalizeClaudeModelAlias(alias) === normalizedModel)
    )
    const modelId = frozenModel?.modelId ?? normalizedModel
    aiUsageRecordService.recordInvocation({
      requestId: `claude-agent:${invocation.requestId}`,
      context: createAiUsageCaptureContext({
        providerId: capture.providerId,
        providerName: capture.providerName,
        modelId,
        modelName: frozenModel?.modelName ?? invocation.model,
        pricingSnapshot: frozenModel?.pricingSnapshot ?? null,
        credentialReceipt: capture.credentialReceipt,
        source: sourceSnapshotFromMessageSnapshot(turn?.messageSnapshot) ?? capture.source,
        messageRef: turn ? { kind: 'agent-session', id: turn.assistantMessageId } : null
      }),
      modality: 'language',
      usage: invocation.usage,
      metrics: invocation.metrics,
      completedAt: Date.now()
    })
  }

  private handleCompactionComplete(entry: AgentSessionRuntimeEntry, anchor?: AgentSessionCompactionAnchorData): void {
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'compaction', active: false })

    const turn = this.currentTurn(entry)
    if (anchor && turn?.controller && this.isTurnLive(entry, turn)) {
      this.enqueueTurnChunk(entry, turn, {
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

  private handleApiRetry(entry: AgentSessionRuntimeEntry, retry: AgentSessionApiRetryInfo): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_API_RETRY_CACHE_KEY(entry.sessionId), {
      status: 'retrying',
      startedAt: new Date().toISOString(),
      ...retry
    })
  }

  /** The ephemeral retry status IS the shared-cache entry — read it back instead of shadowing it. */
  private clearApiRetry(entry: AgentSessionRuntimeEntry): void {
    const cache = application.get('CacheService')
    if (cache.getShared(AGENT_SESSION_API_RETRY_CACHE_KEY(entry.sessionId))?.status !== 'retrying') return
    cache.setShared(AGENT_SESSION_API_RETRY_CACHE_KEY(entry.sessionId), { status: 'idle' })
  }

  private settleCompactionError(entry: AgentSessionRuntimeEntry, error: string): void {
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'compaction', active: false })
    // The failure is surfaced to the user through the turn error (handleRuntimeError) and logged here;
    // the compaction cache state only needs to leave the compacting status.
    logger.warn('Agent session compaction failed', { sessionId: entry.sessionId, error })
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), {
      status: 'idle'
    })
  }

  private refreshContextUsage(entry: AgentSessionRuntimeEntry, connection = this.currentConnection(entry)): void {
    if (!connection?.getContextUsage) return
    if (entry.contextUsageRefresh?.connection === connection) {
      entry.contextUsageRefresh.pending = true
      return
    }

    const refresh = { connection, pending: false }
    entry.contextUsageRefresh = refresh
    void (async () => {
      const read = async () => {
        const usage = await connection.getContextUsage?.()
        if (!usage) return
        if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return
        this.persistContextUsage(entry, usage)
      }

      await read()
      // Collapse every semantic invalidation that arrived during the first read into one trailing
      // post-turn reading. Invalidations during that trailing read intentionally collapse into it.
      if (refresh.pending && this.isCurrentEntry(entry) && this.currentConnection(entry) === connection) {
        refresh.pending = false
        await read()
      }
    })()
      .catch((error) => {
        logger.warn('Failed to refresh agent session context usage', { sessionId: entry.sessionId, error })
      })
      .finally(() => {
        if (entry.contextUsageRefresh === refresh) entry.contextUsageRefresh = undefined
      })
  }

  private persistContextUsage(entry: AgentSessionRuntimeEntry, usage: AgentSessionContextUsage): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.sessionId), usage)
  }

  /**
   * On-demand reading for a UI that is about to show the gauge (composer hover). Only a live
   * connection can answer, so a session that has idled out keeps its last published value rather
   * than paying for a subprocess spawn; the throttle keeps a hovering pointer from flooding the CLI
   * with control requests.
   */
  refreshContextUsageOnDemand(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry || !this.currentConnection(entry)) return
    const now = Date.now()
    if (entry.lastContextUsageRefreshAt && now - entry.lastContextUsageRefreshAt < CONTEXT_USAGE_REFRESH_THROTTLE_MS) {
      return
    }
    entry.lastContextUsageRefreshAt = now
    this.refreshContextUsage(entry)
  }

  // The initial slash command catalog read (`query.supportedCommands()`) once the connection is live.
  // It only captures the catalog at init; mid-session changes arrive separately as `supported-commands`
  // events (`commands_changed`) and are applied via the same {@link publishSupportedCommands} sink.
  // The cached list feeds both the renderer composer and the channel `/help` listing.
  private refreshSupportedCommands(entry: AgentSessionRuntimeEntry, connection = this.currentConnection(entry)): void {
    if (!connection?.getSupportedCommands) return

    void (async () => {
      const commands = await connection.getSupportedCommands?.()
      if (!commands) return
      if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return
      this.publishSupportedCommands(entry, commands)
    })().catch((error) => {
      logger.warn('Failed to refresh agent session slash commands', { sessionId: entry.sessionId, error })
    })
  }

  private publishSupportedCommands(entry: AgentSessionRuntimeEntry, commands: AgentSessionSlashCommand[]): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(entry.sessionId), commands)
  }

  /**
   * REPLACE the cached set with the driver's normalized snapshot. This is presentation state only:
   * generation ownership is reported separately through `autonomous-turn-state`.
   */
  private publishBackgroundTasks(
    entry: AgentSessionRuntimeEntry,
    tasks: AgentSessionBackgroundTasks,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    application.get('CacheService').setShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.sessionId), tasks)
  }

  private handleBackgroundWorkState(
    entry: AgentSessionRuntimeEntry,
    active: boolean,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    const turn = this.currentTurn(entry)
    this.applyRuntimeStateEvent(entry, {
      type: 'connection-occupancy',
      occupancy: 'background',
      active,
      ...(active
        ? { responder: turn && turn.headless !== true ? ('interactive' as const) : ('headless' as const) }
        : {})
    })
    if (active) {
      this.clearIdleTimer(entry)
    } else {
      void this.finishBackgroundFlows(entry)
      if (!this.isSessionBusy(entry.sessionId)) this.refreshIdleTimer(entry)
    }
  }

  private handleBackgroundFlowChunk(
    entry: AgentSessionRuntimeEntry,
    rootToolCallId: string,
    chunk: UIMessageChunk,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return

    const messageId = entry.flowMessageIdsByToolCallId?.get(rootToolCallId)
    if (!messageId) {
      logger.debug('Ignoring detached subagent flow chunk without a persisted message anchor', {
        sessionId: entry.sessionId,
        rootToolCallId,
        chunkType: chunk.type
      })
      return
    }

    if ((chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') && chunk.toolCallId) {
      ;(entry.flowMessageIdsByToolCallId ??= new Map()).set(chunk.toolCallId, messageId)
    }

    if (!entry.persistedFlowMessageIds?.has(messageId)) {
      const pending = entry.pendingBackgroundFlowChunks ?? new Map<string, UIMessageChunk[]>()
      entry.pendingBackgroundFlowChunks = pending
      const chunks = pending.get(messageId) ?? []
      chunks.push(chunk)
      pending.set(messageId, chunks)
      return
    }

    this.enqueueBackgroundFlowChunk(entry, messageId, chunk)
  }

  private markFlowMessagePersisted(entry: AgentSessionRuntimeEntry, messageId: string): void {
    ;(entry.persistedFlowMessageIds ??= new Set()).add(messageId)
    const pending = entry.pendingBackgroundFlowChunks?.get(messageId)
    if (!pending?.length) return

    entry.pendingBackgroundFlowChunks?.delete(messageId)
    for (const chunk of pending) this.enqueueBackgroundFlowChunk(entry, messageId, chunk)
    if (!hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)) void this.finishBackgroundFlows(entry)
  }

  private enqueueBackgroundFlowChunk(entry: AgentSessionRuntimeEntry, messageId: string, chunk: UIMessageChunk): void {
    const accumulator = this.getOrCreateBackgroundFlowAccumulator(entry, messageId)
    try {
      accumulator.controller.enqueue(chunk)
    } catch (error) {
      logger.warn('Failed to enqueue detached subagent flow chunk', {
        sessionId: entry.sessionId,
        messageId,
        chunkType: chunk.type,
        error
      })
    }
  }

  private getOrCreateBackgroundFlowAccumulator(
    entry: AgentSessionRuntimeEntry,
    messageId: string
  ): BackgroundFlowAccumulator {
    const accumulators = entry.backgroundFlowAccumulators ?? new Map<string, BackgroundFlowAccumulator>()
    entry.backgroundFlowAccumulators = accumulators
    const existing = accumulators.get(messageId)
    if (existing) return existing

    const persisted = agentSessionMessageService.getSessionMessage(entry.sessionId, messageId)
    const seed: CherryUIMessage = {
      id: persisted.id,
      role: 'assistant',
      parts: structuredClone(persisted.data.parts ?? [])
    }
    let controller!: ReadableStreamDefaultController<UIMessageChunk>
    const stream = new ReadableStream<UIMessageChunk>({
      start: (streamController) => {
        controller = streamController
      }
    })
    const accumulator: BackgroundFlowAccumulator = {
      messageId,
      controller,
      done: Promise.resolve(),
      closed: false
    }
    accumulator.done = this.consumeBackgroundFlow(entry, accumulator, stream, seed)
    accumulators.set(messageId, accumulator)
    return accumulator
  }

  private async consumeBackgroundFlow(
    entry: AgentSessionRuntimeEntry,
    accumulator: BackgroundFlowAccumulator,
    stream: ReadableStream<UIMessageChunk>,
    seed: CherryUIMessage
  ): Promise<void> {
    try {
      for await (const snapshot of readUIMessageStream<CherryUIMessage>({
        stream,
        message: seed,
        terminateOnError: false,
        onError: (error) =>
          logger.warn('Detached subagent flow accumulator reported an error', {
            sessionId: entry.sessionId,
            messageId: accumulator.messageId,
            error
          })
      })) {
        accumulator.latest = snapshot
        this.publishBackgroundFlowSnapshot(entry, accumulator)
      }
    } catch (error) {
      logger.warn('Detached subagent flow accumulator failed', {
        sessionId: entry.sessionId,
        messageId: accumulator.messageId,
        error
      })
    } finally {
      // The reader is done — flush the trailing snapshot now so `finishBackgroundFlows` (which
      // awaits `accumulator.done`) always sees the final overlay in the cache before its TTL write.
      if (accumulator.publishTimer) {
        clearTimeout(accumulator.publishTimer)
        accumulator.publishTimer = undefined
      }
      this.publishBackgroundFlowParts(entry, accumulator)
    }
  }

  /**
   * `readUIMessageStream` yields a full snapshot per chunk; broadcasting each one re-sends the whole
   * parts array to every window. Publish immediately when the window has elapsed, otherwise arm one
   * trailing timer so the overlay still converges without a chunk-rate broadcast storm.
   */
  private publishBackgroundFlowSnapshot(entry: AgentSessionRuntimeEntry, accumulator: BackgroundFlowAccumulator): void {
    if (accumulator.publishTimer) return
    const elapsed = Date.now() - (accumulator.lastPublishedAt ?? 0)
    if (elapsed >= BACKGROUND_FLOW_PUBLISH_THROTTLE_MS) {
      this.publishBackgroundFlowParts(entry, accumulator)
      return
    }
    accumulator.publishTimer = setTimeout(() => {
      accumulator.publishTimer = undefined
      this.publishBackgroundFlowParts(entry, accumulator)
    }, BACKGROUND_FLOW_PUBLISH_THROTTLE_MS - elapsed)
  }

  private publishBackgroundFlowParts(entry: AgentSessionRuntimeEntry, accumulator: BackgroundFlowAccumulator): void {
    const parts = accumulator.latest?.parts as CherryMessagePart[] | undefined
    if (!parts || !this.isCurrentEntry(entry)) return
    accumulator.lastPublishedAt = Date.now()
    application
      .get('CacheService')
      .setShared(AGENT_SESSION_FLOW_PARTS_CACHE_KEY(entry.sessionId, accumulator.messageId), parts)
  }

  private finishBackgroundFlows(entry: AgentSessionRuntimeEntry): Promise<void> {
    if (entry.backgroundFlowFlush) return entry.backgroundFlowFlush
    const accumulators = [...(entry.backgroundFlowAccumulators?.values() ?? [])]
    if (accumulators.length === 0) return Promise.resolve()

    for (const accumulator of accumulators) {
      if (accumulator.closed) continue
      accumulator.closed = true
      try {
        accumulator.controller.close()
      } catch {
        // Already closed by the accumulator reader.
      }
    }

    const flush = Promise.all(accumulators.map((accumulator) => accumulator.done))
      .then(() => {
        const completedMessageIds = new Set<string>()
        const completedFlows: Array<{ messageId: string; parts: CherryMessagePart[] }> = []
        for (const accumulator of accumulators) {
          const parts = accumulator.latest?.parts as CherryMessagePart[] | undefined
          if (!parts) continue
          completedMessageIds.add(accumulator.messageId)
          agentSessionMessageService.replaceMessageParts(entry.sessionId, accumulator.messageId, parts)
          completedFlows.push({ messageId: accumulator.messageId, parts })
        }

        entry.backgroundFlowAccumulators?.clear()
        for (const [toolCallId, messageId] of entry.flowMessageIdsByToolCallId ?? []) {
          if (completedMessageIds.has(messageId)) entry.flowMessageIdsByToolCallId?.delete(toolCallId)
        }
        if (this.isCurrentEntry(entry)) {
          const cacheService = application.get('CacheService')
          for (const { messageId, parts } of completedFlows) {
            cacheService.setShared(
              AGENT_SESSION_FLOW_PARTS_CACHE_KEY(entry.sessionId, messageId),
              parts,
              BACKGROUND_FLOW_HANDOFF_TTL_MS
            )
          }
        }
      })
      .catch((error) => {
        logger.warn('Failed to finalize detached subagent flow parts', { sessionId: entry.sessionId, error })
      })
      .finally(() => {
        if (entry.backgroundFlowFlush === flush) entry.backgroundFlowFlush = undefined
      })
    entry.backgroundFlowFlush = flush
    return flush
  }

  private waitForBackgroundWorkRelease(
    entry: AgentSessionRuntimeEntry,
    connection: AgentRuntimeConnection,
    target: AgentSessionConnectionTarget
  ): Promise<void> {
    if (
      !this.isCurrentEntry(entry) ||
      this.currentConnection(entry) !== connection ||
      !hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)
    ) {
      return Promise.resolve()
    }
    const existing = this.backgroundWorkWaiters.get(entry.sessionId)
    if (existing?.connection === connection) return existing.promise

    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    this.backgroundWorkWaiters.set(entry.sessionId, { connection, promise, resolve })
    this.applyRuntimeStateEvent(entry, { type: 'connection-rebuild-deferred', connection, target })
    return promise
  }

  private releaseBackgroundWorkWaiter(entry: AgentSessionRuntimeEntry, connection?: AgentRuntimeConnection): void {
    const waiter = this.backgroundWorkWaiters.get(entry.sessionId)
    if (!waiter || (connection && waiter.connection !== connection)) return
    this.backgroundWorkWaiters.delete(entry.sessionId)
    waiter.resolve()
  }

  private handleAutonomousGenerationFinished(
    entry: AgentSessionRuntimeEntry,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    this.applyRuntimeStateEvent(entry, { type: 'autonomous-turn-state', state: 'finished' })
    if (entry.runtimeState.execution.kind === 'idle' && entry.runtimeState.queue.length > 0) {
      this.requestRuntimeLaunch(entry, 'queued-turn')
    } else if (!this.isSessionBusy(entry.sessionId)) {
      this.refreshIdleTimer(entry)
    }
  }

  /** Keep the latest lifecycle edge per task for the current connection. */
  private publishBackgroundTaskEvent(
    entry: AgentSessionRuntimeEntry,
    data: AgentTaskEventPartData,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    const cache = application.get('CacheService')
    const key = AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.sessionId)
    const events = cache.getShared(key) ?? {}
    // Merge instead of replace: identity fields and the row title may exist only on the start edge.
    // A completion overwriting it wholesale would strip the task of its type and display name.
    const merged: Record<string, unknown> = { ...events[data.taskId] }
    for (const [field, value] of Object.entries(data)) {
      if (value !== undefined) merged[field] = value
    }
    cache.setShared(key, { ...events, [data.taskId]: merged as unknown as AgentTaskEventPartData })
  }

  private handleToolApprovalRequest(entry: AgentSessionRuntimeEntry, request: AgentRuntimeToolApprovalRequest): void {
    const turn = this.currentTurn(entry)
    if (request.presentation === 'stream') {
      const chunk: UIMessageChunk = {
        type: 'tool-approval-request',
        approvalId: request.approvalId,
        toolCallId: request.toolCallId
      }
      if (
        entry.runtimeState.execution.kind === 'steer-transition' ||
        (entry.runtimeState.execution.kind === 'autonomous-turn' &&
          !hasAgentSessionRuntimeOpenStream(entry.runtimeState, turn))
      ) {
        this.applyRuntimeStateEvent(entry, { type: 'buffer-chunk', chunk })
      } else if (turn?.controller && this.isTurnLive(entry, turn)) {
        this.enqueueTurnChunk(entry, turn, chunk)
      } else {
        logger.warn('Live tool approval request lost its turn stream', {
          sessionId: entry.sessionId,
          approvalId: request.approvalId
        })
        toolApprovalRegistry.dispatch(request.approvalId, {
          approved: false,
          reason: 'The turn ended before this approval request could be presented'
        })
      }
      return
    }

    // The requesting agent outlived its parent turn. Persist a settled assistant row containing the
    // pending interaction instead of reopening a streaming turn: user follow-ups remain admissible,
    // and several subagents can wait independently without overwriting one shared live message.
    const part = {
      type: `tool-${request.toolName}`,
      toolCallId: request.toolCallId,
      state: 'approval-requested',
      input: request.input,
      approval: { id: request.approvalId },
      ...(request.providerMetadata ? { callProviderMetadata: request.providerMetadata } : {})
    } as CherryMessagePart

    try {
      agentSessionMessageService.saveMessage(
        {
          sessionId: entry.sessionId,
          message: {
            role: 'assistant',
            status: 'success',
            data: { parts: [part] },
            modelId: this.connectionTarget(entry).modelId,
            messageSnapshot: entry.messageSnapshot
          }
        },
        { publishDataChange: true }
      )
    } catch (error) {
      logger.error('Failed to persist background tool approval request', {
        sessionId: entry.sessionId,
        approvalId: request.approvalId,
        error
      })
      toolApprovalRegistry.dispatch(request.approvalId, {
        approved: false,
        reason: 'Unable to present this approval request to the user'
      })
    }
  }

  /**
   * Connection-scoped status is reset at every attach/detach boundary. Keep the mutation guarded by
   * the captured connection so a late old loop cannot clear its successor.
   */
  private resetConnectionRuntimeState(entry: AgentSessionRuntimeEntry, connection: AgentRuntimeConnection): void {
    if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return
    void this.finishBackgroundFlows(entry)
    entry.flowMessageIdsByToolCallId?.clear()
    entry.persistedFlowMessageIds?.clear()
    entry.pendingBackgroundFlowChunks?.clear()
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'background', active: false })
    if (entry.runtimeState.execution.kind === 'autonomous-turn') {
      this.applyRuntimeStateEvent(entry, { type: 'autonomous-turn-state', state: 'finished' })
    }
    const cache = application.get('CacheService')
    cache.setShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.sessionId), [])
    cache.setShared(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.sessionId), {})
  }

  private handleRuntimeError(entry: AgentSessionRuntimeEntry, error: unknown): void {
    this.clearApiRetry(entry)
    this.applyRuntimeStateEvent(entry, { type: 'clear-steer-reservation' })
    if (isAgentSessionRuntimeCompacting(entry.runtimeState)) {
      this.settleCompactionError(entry, error instanceof Error ? error.message : String(error))
    }

    const turn = this.currentTurn(entry)
    const execution = entry.runtimeState.execution
    if (
      execution.kind === 'steer-transition' ||
      execution.kind === 'autonomous-turn' ||
      (execution.kind === 'turn' && turn !== undefined && this.isTurnLive(entry, turn))
    ) {
      this.applyRuntimeStateEvent(entry, {
        type: 'runtime-terminal',
        outcome: { status: 'error', error }
      })
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
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return
    if (isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turn)) return
    this.applyRuntimeStateEvent(entry, { type: 'turn-admitted', turn })
    // A fresh request starts clean — drop any retry status left over from the previous turn.
    this.clearApiRetry(entry)
    await this.refreshTurnTraceContext(entry, turn)
    await this.currentConnection(entry)?.send({
      message: turn.userMessage,
      systemReminder: turn.systemReminder === true
    })
  }

  private enqueueTurnChunk(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn, chunk: UIMessageChunk): void {
    if ((chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') && chunk.toolCallId) {
      turn.activeToolIds.add(chunk.toolCallId)
      ;(entry.flowMessageIdsByToolCallId ??= new Map()).set(chunk.toolCallId, turn.assistantMessageId)
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

  /** Pure resource release. Terminality itself lives in the machine (the `settle-turn` transition
   *  is synchronous, so a trailing `chunk` event in the same connection loop already reads not-live
   *  and never touches the closed controller). */
  private closeTurn(turn: AgentSessionTurn): void {
    try {
      turn.controller?.close()
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private errorTurn(turn: AgentSessionTurn, error: unknown): void {
    try {
      turn.controller?.error(error)
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private async refreshTurnTraceContext(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): Promise<void> {
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return
    const traceContext = this.sessionTraceContext(entry, turn.modelId)
    if (traceContext) await this.currentConnection(entry)?.refreshTraceContext?.(traceContext)
  }

  private requestRuntimeLaunch(entry: AgentSessionRuntimeEntry, target: AgentSessionRuntimeLaunchTarget): void {
    this.applyRuntimeStateEvent(entry, { type: 'launch-requested', target })
  }

  private scheduleRuntimeLaunch(entry: AgentSessionRuntimeEntry, target: AgentSessionRuntimeLaunchTarget): void {
    if (
      !this.isCurrentEntry(entry) ||
      entry.runtimeState.launch.kind !== 'scheduled' ||
      entry.runtimeState.launch.target !== target
    ) {
      return
    }

    // Register synchronously so write-quiesce drain cannot miss a launch behind its microtask.
    const launch = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        if (!this.isCurrentEntry(entry)) {
          resolve()
          return
        }
        if (this.isWriteQuiesced) {
          this.applyRuntimeStateEvent(entry, { type: 'launch-suppressed', target })
          if (this.inFlightTurnStarts.get(entry.sessionId) === launch) {
            this.inFlightTurnStarts.delete(entry.sessionId)
          }
          resolve()
          return
        }
        this.applyRuntimeStateEvent(entry, { type: 'launch-started', target })
        const run = (() => {
          switch (target) {
            case 'queued-turn':
              return this.startNextTurn(entry)
            case 'steer-continuation':
              return this.startContinuationTurn(entry)
            case 'receive-only':
              return this.startReceiveOnlyTurn(entry)
            case 'deferred-turn': {
              const turn = this.currentTurn(entry)
              return turn ? Promise.resolve(this.startDeferredTurn(entry, turn)) : Promise.resolve()
            }
          }
        })()
        void run
          .catch((error) => {
            logger.error('Failed to start agent runtime launch', {
              sessionId: entry.sessionId,
              target,
              error
            })
            if (target === 'deferred-turn') {
              const turn = this.currentTurn(entry)
              if (turn) {
                this.errorTurn(turn, error)
                this.markTurnTerminal(entry.sessionId, 'error')
              }
            }
          })
          .finally(() => {
            if (this.inFlightTurnStarts.get(entry.sessionId) === launch) {
              this.inFlightTurnStarts.delete(entry.sessionId)
            }
            if (this.isCurrentEntry(entry)) {
              this.applyRuntimeStateEvent(entry, { type: 'launch-finished', target })
              if (target === 'receive-only') {
                const turn = this.currentTurn(entry)
                if (
                  entry.runtimeState.execution.kind === 'turn' &&
                  turn &&
                  !isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turn) &&
                  this.isTurnLive(entry, turn)
                ) {
                  this.requestRuntimeLaunch(entry, 'deferred-turn')
                }
              }
              if (entry.runtimeState.execution.kind === 'idle' && entry.runtimeState.queue.length > 0) {
                this.requestRuntimeLaunch(entry, 'queued-turn')
              }
            }
            resolve()
          })
      })
    })
    this.inFlightTurnStarts.set(entry.sessionId, launch)
  }

  private async startNextTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    const pendingTurn = entry.runtimeState.queue[0]
    if (!pendingTurn) {
      this.refreshIdleTimer(entry)
      return
    }
    this.applyRuntimeStateEvent(entry, { type: 'dequeue-turn' })
    const { message: nextMessage, reasoningEffort, knowledgeBaseIds, fastMode = false } = pendingTurn

    // A queued follow-up can outlive the agent's model: deleting the model nulls `agent.model` via the FK
    // (`onDelete: 'set null'`) without emitting an agent update, so `applyAgentModelUpdate` never ran and
    // `entry.modelId` still caches the deleted model. Re-read the live model before draining — starting the
    // turn here would stamp an assistant row with the stale deleted model and then fail to connect. If the
    // model is gone, surface the failure to the renderer, drop the queue (its rows stay resendable) and
    // settle instead of starting a doomed turn. Use `terminateHeldTopicStream` (not `broadcastTopicError`):
    // the prior turn kept this topic's stream alive for the continuation (`willContinueTopic`), skipping its
    // terminal lifecycle — a bare error broadcast would leave that stream in `activeStreams` with its status
    // cache stuck `streaming` and still re-attachable, so it must be terminalized/evicted here.
    const liveAgent = agentService.getAgent(entry.agentId)
    if (!liveAgent?.model) {
      application
        .get('AiStreamManager')
        .terminateHeldTopicStream(
          entry.topicId,
          entry.modelId,
          serializeError(new Error(`Agent ${entry.agentId} has no model configured`))
        )
      this.applyRuntimeStateEvent(entry, { type: 'clear-queue' })
      this.markTurnTerminal(entry.sessionId, 'error')
      return
    }

    const rootSpan = this.startRuntimeRootSpan(entry)
    // Use the snapshot frozen when THIS follow-up was submitted (not the entry's, which the last beginTurn
    // set) so a mid-session agent change can't stamp the queued reply with a stale author. The queue drains
    // on the LATEST model (`entry.modelId`), so reconcile the snapshot's nested model to the model that
    // actually runs — otherwise a mid-queue model switch leaves `messageSnapshot.model` disagreeing with the
    // row's `modelId`, and the header/exports (which prefer the snapshot model) would show the wrong model.
    const frozenSnapshot = pendingTurn.messageSnapshot ?? entry.messageSnapshot
    const messageSnapshot = reconcileSnapshotModel(frozenSnapshot, entry.modelId, liveAgent.modelName)
    let assistantMessage: Awaited<ReturnType<typeof agentSessionMessageService.saveMessage>>
    try {
      assistantMessage = agentSessionMessageService.saveMessage({
        sessionId: entry.sessionId,
        message: {
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId: entry.modelId,
          messageSnapshot
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
    const headless = pendingTurn.headless === true

    const turnId = crypto.randomUUID()
    const nextTurn: AgentSessionTurn = {
      turnId,
      systemReminder: pendingTurn.steer === true,
      assistantMessageId,
      userMessage: nextMessage,
      modelId: entry.modelId,
      messageSnapshot,
      reasoningEffort,
      knowledgeBaseIds,
      fastMode,
      abortController: new AbortController(),
      activeToolIds: new Set(),
      headless
    }
    this.applyRuntimeStateEvent(entry, { type: 'begin-turn', turn: nextTurn })

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
        reasoningEffort,
        ...(fastMode ? { fastMode: true } : {}),
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId }
      },
      abortController: nextTurn.abortController,
      listeners: [
        this.createPersistenceListener(entry, nextMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId, turnId),
        new TraceFlushListener(entry.topicId)
      ]
    })
  }

  /**
   * Runtime-generated content can arrive in the narrow window after a user turn's renderer stream
   * opened but before its prompt was admitted. Detach that empty execution, keep the turn object
   * queued, and let the receive-only generation own the connection first.
   */
  private deferUnadmittedTurnForReceiveOnly(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): void {
    const execution = entry.runtimeState.execution
    if (
      execution.kind !== 'autonomous-turn' ||
      execution.deferredTurn !== turn ||
      isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turn)
    ) {
      return
    }
    const suspended = application.get('AiStreamManager').suspendUnadmittedRuntimeTurn(entry.topicId)
    try {
      turn.controller?.close()
    } catch {
      // The consumer may have already detached.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()

    void suspended
      .catch((error) => {
        logger.warn('Failed to suspend unadmitted turn before receive-only generation', {
          sessionId: entry.sessionId,
          error
        })
      })
      .finally(() => {
        if (
          !this.isCurrentEntry(entry) ||
          entry.runtimeState.execution.kind !== 'autonomous-turn' ||
          entry.runtimeState.execution.deferredTurn !== turn
        ) {
          return
        }
        this.requestRuntimeLaunch(entry, 'receive-only')
      })
  }

  private startDeferredTurn(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): void {
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return

    const rootSpan = this.startRuntimeRootSpan(entry, turn.modelId)
    const messages = createRuntimeSeedMessages(turn.userMessage, turn.assistantMessageId)
    if (rootSpan) {
      applyTurnInputAttributes(rootSpan, {
        modelId: turn.modelId,
        topicId: entry.topicId,
        operation: 'invoke_agent',
        messages
      })
    }
    application.get('AiStreamManager').startRuntimeTurn({
      topicId: entry.topicId,
      modelId: turn.modelId,
      rootSpan,
      request: {
        chatId: entry.topicId,
        trigger: 'submit-message',
        messageId: turn.assistantMessageId,
        messages,
        reasoningEffort: turn.reasoningEffort,
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId: turn.turnId }
      },
      abortController: turn.abortController,
      listeners: [
        this.createPersistenceListener(entry, turn.userMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId, turn.turnId),
        new TraceFlushListener(entry.topicId)
      ]
    })
  }

  /**
   * Open a receive-only turn for content the connected runtime generated autonomously. There is no
   * user message to send; the turn only carries the already-streaming response into the transcript.
   * Responder availability follows the work that triggered the wake: an interactive foreground turn
   * may still answer AskUserQuestion, while channel/scheduled work remains headless.
   */
  private async startReceiveOnlyTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    if (
      !this.isCurrentEntry(entry) ||
      entry.runtimeState.execution.kind !== 'autonomous-turn' ||
      entry.runtimeState.execution.turn
    ) {
      return
    }
    const { modelId, knowledgeBaseIds, fastMode } = this.connectionTarget(entry)
    const syntheticMessage = createSyntheticUserMessage(entry.sessionId)

    const rootSpan = this.startRuntimeRootSpan(entry, modelId)
    let assistantMessage: Awaited<ReturnType<typeof agentSessionMessageService.saveMessage>>
    try {
      assistantMessage = agentSessionMessageService.saveMessage({
        sessionId: entry.sessionId,
        message: {
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId,
          messageSnapshot: entry.messageSnapshot
        }
      })
    } catch (error) {
      rootSpan?.end()
      logger.error('Failed to save receive-only turn placeholder; dropping runtime-generated content', {
        sessionId: entry.sessionId,
        error
      })
      this.applyRuntimeStateEvent(entry, { type: 'autonomous-turn-abandoned' })
      return
    }

    const assistantMessageId = assistantMessage.id
    const turnId = crypto.randomUUID()
    const receiveOnlyTurn: AgentSessionTurn = {
      turnId,
      assistantMessageId,
      userMessage: syntheticMessage,
      modelId,
      reasoningEffort: 'default',
      knowledgeBaseIds,
      fastMode,
      // Pre-admitted: the connected runtime started this generation, so `admitTurn` must not send.
      abortController: new AbortController(),
      activeToolIds: new Set(),
      headless: this.getInteractionState(entry.sessionId).userResponse === 'unavailable'
    }
    this.applyRuntimeStateEvent(entry, { type: 'autonomous-turn-created', turn: receiveOnlyTurn })
    await this.refreshTurnTraceContext(entry, receiveOnlyTurn)
    if (
      !this.isCurrentEntry(entry) ||
      this.currentTurn(entry) !== receiveOnlyTurn ||
      !this.isTurnLive(entry, receiveOnlyTurn)
    ) {
      rootSpan?.end()
      return
    }

    const messages = createRuntimeSeedMessages(syntheticMessage, assistantMessageId)
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
        reasoningEffort: 'default',
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId }
      },
      abortController: receiveOnlyTurn.abortController,
      listeners: [
        this.createPersistenceListener(entry, syntheticMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId, turnId),
        new TraceFlushListener(entry.topicId)
      ]
    })
  }

  /**
   * Open the post-steer continuation row (A2) after a `steer-boundary` rolled A1a closed. Unlike
   * `startNextTurn` this sends NOTHING to the connection (the steer is already in flight via the
   * PreToolUse hook) — the turn is pre-`admitted` so `admitTurn` no-ops, and the still-streaming SDK
   * turn's post-steer chunks are owned by the steer-transition state until A2 opens its stream.
   * The steer message is reused only for rename/seed context — U2 is already a persisted row.
   */
  private async startContinuationTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    const transition = entry.runtimeState.execution
    if (transition.kind !== 'steer-transition' || transition.continuationTurn) return
    const reservation = transition.reservation
    const modelId = transition.sourceTurn.modelId
    const reasoningEffort = transition.sourceTurn.reasoningEffort
    const fastMode = transition.sourceTurn.fastMode
    const steerMessage = transition.inputs[0]?.message ?? createSyntheticUserMessage(entry.sessionId)
    // A2 opens no connection, so it must report the scope the still-streaming SDK query actually
    // serves — inherit the rolled turn's, like modelId/reasoningEffort above. Reading the steer's own
    // selection back off the message looks equivalent, because the fold gate proved both *effective*
    // scopes equal before the roll, but that equality only holds under the binding at injection time:
    // `resolveKnowledgeBaseScope` maps an empty or fully out-of-scope selection onto the whole
    // binding, so a later binding edit can pull the two raw selections apart while the live-turn
    // rebuild is still deferred, leaving the query serving one set and our bookkeeping claiming another.
    const knowledgeBaseIds = transition.sourceTurn.knowledgeBaseIds
    const headless = transition.headless
    // The continuation answers the steered follow-up — freeze its submit-time author, not the entry's.
    const messageSnapshot =
      reservation?.userMessageId === steerMessage.id
        ? reservation.messageSnapshot
        : (transition.inputs[0]?.messageSnapshot ?? entry.messageSnapshot)

    const rootSpan = this.startRuntimeRootSpan(entry, modelId)
    let assistantMessage: Awaited<ReturnType<typeof agentSessionMessageService.saveMessage>>
    try {
      assistantMessage = agentSessionMessageService.saveMessage({
        sessionId: entry.sessionId,
        message: {
          ...(reservation ? { id: reservation.assistantMessageId } : {}),
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId,
          messageSnapshot
        }
      })
    } catch (error) {
      // The A2 placeholder save failed — abandon the roll, drop the buffered post-steer chunks, and
      // surface the failure (mirrors `startNextTurn`'s doomed-placeholder handling).
      rootSpan?.end()
      application.get('AiStreamManager').broadcastTopicError(entry.topicId, entry.modelId, serializeError(error))
      this.markTurnTerminal(entry.sessionId, 'error')
      return
    }

    const assistantMessageId = assistantMessage.id
    const turnId = crypto.randomUUID()
    const continuationTurn: AgentSessionTurn = {
      turnId,
      assistantMessageId,
      userMessage: steerMessage,
      modelId,
      messageSnapshot,
      reasoningEffort,
      knowledgeBaseIds,
      fastMode,
      // Pre-admitted: the steer was already delivered via the hook, so `admitTurn` must NOT re-send it.
      abortController: new AbortController(),
      activeToolIds: new Set(),
      headless
    }
    this.applyRuntimeStateEvent(entry, { type: 'continuation-turn-created', turn: continuationTurn })
    await this.refreshTurnTraceContext(entry, continuationTurn)
    if (
      !this.isCurrentEntry(entry) ||
      this.currentTurn(entry) !== continuationTurn ||
      !this.isTurnLive(entry, continuationTurn)
    ) {
      rootSpan?.end()
      return
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
        reasoningEffort,
        ...(fastMode ? { fastMode: true } : {}),
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId }
      },
      abortController: continuationTurn.abortController,
      listeners: [
        this.createPersistenceListener(entry, steerMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId, turnId),
        new TraceFlushListener(entry.topicId)
      ]
    })
  }

  getInteractionState(sessionId: string): AgentSessionInteractionState {
    const entry = this.entries.get(sessionId)
    if (!entry) return { currentTurn: 'none', userResponse: 'unavailable' }

    const turn = this.liveTurn(entry)
    const execution = entry.runtimeState.execution
    const currentTurn =
      turn !== undefined
        ? turn.headless === true
          ? 'headless'
          : 'interactive'
        : execution.kind === 'steer-transition'
          ? execution.headless
            ? 'headless'
            : 'interactive'
          : 'none'

    // A steer continuation still belongs to the renderer stream that is being handed from A1 to A2.
    if (execution.kind === 'steer-transition') {
      return {
        currentTurn,
        userResponse: execution.headless ? 'unavailable' : 'stream'
      }
    }
    const backgroundResponder = getAgentSessionRuntimeOccupancy(entry.runtimeState)?.background?.responder
    if (backgroundResponder) {
      if (backgroundResponder === 'headless') {
        return { currentTurn, userResponse: 'unavailable' }
      }
      // A background wake is deliberately an independent interaction. It must not attach approval
      // UI to a prior turn's stream merely because the receive-only projection is still opening.
      if (execution.kind === 'autonomous-turn') return { currentTurn, userResponse: 'message' }
      const hasStream =
        hasAgentSessionRuntimeOpenStream(entry.runtimeState, turn) && turn !== undefined && this.isTurnLive(entry, turn)
      return { currentTurn, userResponse: hasStream ? 'stream' : 'message' }
    }
    if (currentTurn !== 'interactive') return { currentTurn, userResponse: 'unavailable' }
    const hasStream =
      hasAgentSessionRuntimeOpenStream(entry.runtimeState, turn) && turn !== undefined && this.isTurnLive(entry, turn)
    return { currentTurn, userResponse: hasStream ? 'stream' : 'message' }
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
      turnId: this.currentTurn(entry)?.turnId ?? '',
      modelName: parseUniqueModelId(modelId).modelId
    }
  }

  private createPersistenceListener(
    entry: AgentSessionRuntimeEntry,
    userMessage: AgentSessionMessageEntity
  ): StreamListener {
    const currentTurn = this.currentTurn(entry)
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
    if (hasAgentSessionRuntimeBackgroundWork(entry.runtimeState) || this.runtimeStatus(entry) !== 'idle') {
      return
    }
    entry.idleTimer = setTimeout(() => {
      if (
        !this.isCurrentEntry(entry) ||
        hasAgentSessionRuntimeBackgroundWork(entry.runtimeState) ||
        this.runtimeStatus(entry) !== 'idle'
      ) {
        return
      }
      const { sessionId, agentType, lastResumeToken } = entry
      void this.closeSession(sessionId)
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

  private closeAll(): Promise<void> {
    const closings = [...this.entries.keys()].map((sessionId) => this.closeSession(sessionId))
    return Promise.allSettled(closings).then(() => undefined)
  }

  private closeEntry(entry: AgentSessionRuntimeEntry): Promise<void> {
    this.clearIdleTimer(entry)
    for (const accumulator of entry.backgroundFlowAccumulators?.values() ?? []) {
      const parts = accumulator.latest?.parts as CherryMessagePart[] | undefined
      if (!parts) continue
      application
        .get('CacheService')
        .setShared(
          AGENT_SESSION_FLOW_PARTS_CACHE_KEY(entry.sessionId, accumulator.messageId),
          parts,
          BACKGROUND_FLOW_HANDOFF_TTL_MS
        )
    }
    void this.finishBackgroundFlows(entry)
    const currentTurn = this.currentTurn(entry)
    if (currentTurn) this.closeTurn(currentTurn)
    const deferredTurn =
      entry.runtimeState.execution.kind === 'autonomous-turn' ? entry.runtimeState.execution.deferredTurn : undefined
    // The machine's `reset` below settles terminality; only the stream resource needs releasing.
    if (deferredTurn && deferredTurn !== currentTurn) this.closeTurn(deferredTurn)
    // Compaction-occupancy interruption is projected by the machine's connection-teardown effect.
    this.clearApiRetry(entry)
    // Context usage deliberately survives: unlike its neighbours here it is not per-CLI-process
    // state. No turn can run without a connection, so the last reading stays true until one does.
    application.get('CacheService').deleteShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(entry.sessionId))
    // The background-task level is per CLI process, so the closing process's set must not outlive it.
    application.get('CacheService').deleteShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.sessionId))
    application.get('CacheService').deleteShared(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.sessionId))

    const connection = this.closeConnection(entry, false)
    this.applyRuntimeStateEvent(entry, { type: 'reset' })
    this.connectionAttempts.delete(entry.sessionId)
    this.inFlightTurnStarts.delete(entry.sessionId)

    return this.closeRuntimeConnection(connection, entry.sessionId)
  }

  private closeFailedPolicyUpdateConnection(entry: AgentSessionRuntimeEntry, connection: AgentRuntimeConnection): void {
    if (this.currentConnection(entry) !== connection) return
    if (this.liveTurn(entry)) {
      // Pause the live turn so the renderer learns it stopped (the abort path then tears the session
      // down via `closeSession`); a failed tighten must not keep streaming under the old policy.
      application.get('AiStreamManager').pauseRuntimeTurn(entry.topicId, 'agent-policy-update-failed')
    }
    this.closeConnectionAsync(entry)
  }

  private closeConnection(
    entry: AgentSessionRuntimeEntry,
    resetRuntimeState = true
  ): AgentRuntimeConnection | undefined {
    const connection = this.currentConnection(entry)
    if (connection && resetRuntimeState) this.resetConnectionRuntimeState(entry, connection)
    if (connection) this.applyRuntimeStateEvent(entry, { type: 'connection-disconnected', connection })
    entry.connectionLoop = undefined
    return connection
  }

  private closeConnectionAsync(entry: AgentSessionRuntimeEntry): void {
    const connection = this.closeConnection(entry)
    void this.closeRuntimeConnection(connection, entry.sessionId)
  }

  private closeRuntimeConnection(connection: AgentRuntimeConnection | undefined, sessionId: string): Promise<void> {
    if (!connection) return Promise.resolve()
    try {
      return Promise.resolve(connection.close()).catch((error) => {
        logger.warn('Agent runtime connection close failed', { sessionId, error })
      })
    } catch (error) {
      logger.warn('Agent runtime connection close failed', { sessionId, error })
      return Promise.resolve()
    }
  }
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name: unknown }).name === 'AbortError'
}

/**
 * A queued/steered follow-up freezes its author snapshot at submit time, but the runtime drains it on the
 * LATEST agent model (`entry.modelId`). Reconcile the snapshot's nested model to the model that actually
 * runs so `messageSnapshot.model` never disagrees with the row's `modelId`; the author (id/name/emoji)
 * stays frozen. No-op when the frozen model already is the running model.
 */
function reconcileSnapshotModel(
  snapshot: MessageSnapshot | undefined,
  modelId: UniqueModelId,
  modelName: string | null | undefined
): MessageSnapshot | undefined {
  if (!snapshot) return undefined
  if (createUniqueModelId(snapshot.model.provider, snapshot.model.id) === modelId) return snapshot
  const { providerId, modelId: rawModelId } = parseUniqueModelId(modelId)
  return { ...snapshot, model: { id: rawModelId, name: modelName ?? rawModelId, provider: providerId } }
}

function sourceSnapshotFromMessageSnapshot(snapshot: MessageSnapshot | undefined): SourceSnapshot | null {
  if (!snapshot) return null
  return {
    type: 'agent',
    id: snapshot.id,
    name: snapshot.name,
    icon: snapshot.emoji ?? null
  }
}

function normalizeClaudeModelAlias(value: string): string {
  return value.trim().replace(/\[1m\]$/, '')
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
    messageSnapshot: null,
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
