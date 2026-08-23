import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { aiUsageRecordService, type SourceSnapshot } from '@data/services/AiUsageRecordService'
import { loggerService } from '@logger'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import {
  BaseService,
  DependsOn,
  type Disposable,
  Emitter,
  type Event,
  Injectable,
  Phase,
  ServicePhase
} from '@main/core/lifecycle'
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
import {
  type AgentConversationRef,
  type ConversationActivityId,
  ConversationActivityKind,
  type ConversationEffectId,
  type ConversationExecutionId,
  ConversationKind,
  ConversationOutcomeKind,
  conversationRefsEqual,
  type ConversationTurnId
} from '@shared/ai/conversation'
import type { AgentEntity, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type {
  CherryMessagePart,
  CherryUIMessage,
  MessageRuntimeSpan,
  MessageSnapshot
} from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { type AgentTaskEventPartData, getKnowledgeBaseIdsFromParts } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import type {
  DiscardConversationRuntimeBufferEffect,
  ResumeSuspendedConversationExecutionEffect,
  SuspendConversationExecutionEffect
} from '../conversation'
import { ConversationResponderKind } from '../conversation'
import { deriveRootSpanId } from '../observability'
import { registerRuntimeDrivers } from '../runtime/registerDrivers'
import { runtimeDriverRegistry } from '../runtime/registry'
import type {
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeToolApprovalRequest,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput,
  AgentSessionUsageCapture
} from '../runtime/types'
import {
  AgentRuntimeAutonomousState,
  AgentRuntimeEventType,
  AgentRuntimeInteractionPresentation,
  AgentRuntimeMessageAssociation,
  AgentRuntimeReconcileResult,
  AgentSessionUsageCaptureOwner
} from '../runtime/types'
import { finalizeInterruptedParts, type StreamListener, type StreamPausedResult } from '../streamManager'
import { type DispatchDecision, toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type { ApprovalRequestedEvent, InProcessUsageContext } from '../types'
import {
  AgentAutonomousGenerationState,
  AgentAutonomousResourceOwnership,
  AgentConnectionDeliveryPhase,
  AgentConnectionOccupancyKind,
  type AgentConnectionResourceEffect,
  type AgentConnectionResourceEvent,
  AgentConnectionResourceEventType,
  AgentConnectionResourceKind,
  type AgentConnectionResourceState,
  type AgentConnectionTargetSnapshot,
  AgentDriverOutcomeKind,
  createAgentConnectionResourceState,
  getAgentConnectionResource,
  getAgentCurrentStreamResource,
  getAgentLiveStreamResource,
  hasAgentCompactionResource,
  hasAgentConnectionBackgroundWork,
  hasAgentConnectionResources,
  hasOpenAgentStreamResource,
  isAgentAutonomousResourceActive,
  isAgentStreamResourceLive,
  isAgentStreamResourceTransitioning,
  isAgentTurnSentToConnection,
  transitionAgentConnectionResource
} from './agentConnectionResourceState'
import {
  type AgentConversationResourceEffectResult,
  AgentConversationResourceEffectResultKind
} from './agentConversationResourceResult'

const logger = loggerService.withContext('AgentConnectionManager')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000
/**
 * Grace period before a session with no remaining warm-lease holders is actually torn down.
 * Absorbs <Activity> tab switches, where the session view releases on hide and re-acquires on
 * show within moments.
 */
const WARM_LEASE_RELEASE_DELAY_MS = 10_000
const CONTEXT_USAGE_REFRESH_THROTTLE_MS = 3_000
const BACKGROUND_FLOW_HANDOFF_TTL_MS = 60_000
const BACKGROUND_FLOW_PUBLISH_THROTTLE_MS = 150

function knowledgeScopeEquals(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return left.every((id) => rightIds.has(id))
}

enum AgentConnectionResourceStatus {
  Active = 'active',
  Idle = 'idle'
}

export interface PrepareAgentConnectionTurnInput {
  conversation: AgentConversationRef
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
  /** Only an untouched session's initial turn may run the two-stage automatic naming flow. */
  shouldAutoName?: boolean
  turnId?: string
}

export interface AgentConnectionStreamHandle {
  turnId: string
}

export interface OpenAgentTurnStreamInput {
  conversation: AgentConversationRef
  turnId: string
  signal: AbortSignal
}

export interface AgentSettlementIdentity {
  readonly turnId: string
  readonly conversation: AgentConversationRef
}

/** Exact release result after Conversation terminal persistence completes. */
export type AgentExecutionRelease = AgentSettlementIdentity & {
  readonly outcome: AgentDriverOutcomeKind
}

export enum AgentConversationRuntimeTurnKind {
  Autonomous = 'autonomous',
  NativeContinuation = 'native-continuation'
}

export interface AgentConversationRuntimeTurnIntent {
  readonly kind: AgentConversationRuntimeTurnKind
  readonly conversation: AgentConversationRef
  readonly agentId: string
  readonly modelId: UniqueModelId
  readonly reasoningEffort: ReasoningEffortOption
  readonly fastMode: boolean
  readonly knowledgeBaseIds: readonly string[]
  readonly headless: boolean
  readonly userMessage: AgentSessionMessageEntity
  readonly assistantMessageId: string
  readonly runtimeTurnId: string
  readonly sourceTurnId?: string
  readonly messageSnapshot?: MessageSnapshot
  readonly traceId?: string
}

interface SuspendedConversationTurn {
  readonly conversation: AgentConversationRef
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly suspendEffectId: ConversationEffectId
  readonly runtimeTurnId: string
  readonly turn: AgentTurnStreamResource
}

/** Routes exact Agent resource facts to the Conversation owner. */
export interface AgentConversationResultSink {
  abort(ref: AgentConversationRef, reason: string): boolean
  resolveAgentInteraction(sessionId: string, approvalId: string): boolean
  enqueueAgentUndelivered(sessionId: string, userMessageId: string): void
  startAgentAutonomous(sessionId: string): boolean
  releaseAgentRuntimeOwnership(sessionId: string, suspendEffectId: ConversationEffectId): void
  openAgentActivity(
    sessionId: string,
    kind: ConversationActivityKind,
    responder?: ConversationResponderKind
  ): ConversationActivityId
  closeAgentActivity(sessionId: string, activityId: ConversationActivityId): void
  addCompletedRuntimeSpan(ref: AgentConversationRef, outputNodeId: string, span: MessageRuntimeSpan): boolean
}

type AgentTurnStreamResource = {
  turnId: string
  /** True when the user message arrived as a steer — delivery wraps it in a system-reminder. */
  systemReminder?: boolean
  assistantMessageId: string
  userMessage: AgentSessionMessageEntity
  modelId: UniqueModelId
  /** Immutable author snapshot captured when this exact turn was submitted. */
  messageSnapshot?: MessageSnapshot
  /** Whether this initial turn owns the session's one automatic AI naming attempt. */
  shouldAutoName?: boolean
  reasoningEffort: ReasoningEffortOption
  knowledgeBaseIds: readonly string[]
  fastMode: boolean
  controller?: ReadableStreamDefaultController<UIMessageChunk>
  activeToolIds: Set<string>
  headless?: boolean
}

type BackgroundFlowAccumulator = {
  messageId: string
  controller: ReadableStreamDefaultController<UIMessageChunk>
  latest?: CherryUIMessage
  done: Promise<void>
  closed: boolean
  /** Broadcast throttle for the live overlay — see {@link AgentConnectionManager.publishBackgroundFlowSnapshot}. */
  lastPublishedAt?: number
  publishTimer?: ReturnType<typeof setTimeout>
}

type SteerContinuationReservation = {
  assistantMessageId: string
  userMessageId: string
  messageSnapshot?: MessageSnapshot
}

type AgentConnectionTarget = AgentConnectionTargetSnapshot & {
  modelId: UniqueModelId
  reasoningEffort: ReasoningEffortOption
  fastMode: boolean
}

type AgentResources = AgentConnectionResourceState<AgentTurnStreamResource, SteerContinuationReservation>
type AgentResourceEvent = AgentConnectionResourceEvent<AgentTurnStreamResource, SteerContinuationReservation>

type AgentConnectionEntry = {
  conversation: AgentConversationRef
  /** Container-level OTel trace id (one trace tree per session); the warm connection's traceparent. */
  sessionTraceId?: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  /** Author snapshot (agent + nested model) for assistant rows the runtime opens this session. */
  messageSnapshot?: MessageSnapshot
  resources: AgentResources
  /** Capture owner/receipt of the installed connection; retained through terminal persistence. */
  usageCapture?: AgentSessionUsageCapture
  connectionLoop?: Promise<void>
  lastResumeToken?: string
  idleTimer?: ReturnType<typeof setTimeout>
  /** Throttle stamp for {@link AgentConnectionManager.refreshContextUsageOnDemand}. */
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
  compactionActivityId?: ConversationActivityId
  backgroundActivityId?: ConversationActivityId
}

/** Releases the exact connection-side stream resource after Conversation commits its terminal. */
class AgentExecutionReleaseListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly service: AgentConnectionManager,
    private readonly turnId: string,
    private readonly conversation: AgentConversationRef
  ) {
    this.id = `agent-runtime:${conversation.id}`
  }

  #settle(outcome: AgentDriverOutcomeKind): void {
    this.service.releaseExecutionResource({
      turnId: this.turnId,
      conversation: this.conversation,
      outcome
    })
  }

  onChunk(): void {}

  onDone(): void {
    this.#settle(AgentDriverOutcomeKind.Success)
  }

  onPaused(result: StreamPausedResult = {} as StreamPausedResult): void {
    if (result.turnTerminal === false) return
    this.#settle(AgentDriverOutcomeKind.Paused)
  }

  onError(): void {
    this.#settle(AgentDriverOutcomeKind.Error)
  }

  isAlive(): boolean {
    return true
  }
}

@Injectable('AgentConnectionManager')
@ServicePhase(Phase.WhenReady)
// The dependency is runtime, not lexical: this service's connections spawn CLI children through
// ClaudeCodeProcessManager. Declaring it keeps that owner stopping LAST, so its sweep runs after
// these entries are closed — do not drop it as unused. Covered by a stop-order test.
// Conversation terminal release needs this resource registry alive; the process manager outlives it.
@DependsOn(['ClaudeCodeProcessManager', 'ConversationRuntimeService'])
export class AgentConnectionManager extends BaseService {
  private readonly _onApprovalRequested = new Emitter<ApprovalRequestedEvent>()
  public readonly onApprovalRequested: Event<ApprovalRequestedEvent> = this._onApprovalRequested.event
  private readonly entries = new Map<string, AgentConnectionEntry>()
  /** Write-quiesce holds (backup restore). Quiesced ⇔ non-empty. Distinct from the BaseService
   *  lifecycle pause — this never touches service state. See `pause()`. */
  private readonly pauseHolds = new Set<symbol>()
  /** Detached-flow finalizers can outlive their entry; values are stable drain operation ids. */
  private readonly inFlightBackgroundFlowFlushes = new Map<Promise<void>, string>()
  /** Async connection resources live outside the pure state; connection start ids reject stale completions. */
  private readonly connectionStarts = new Map<string, { id: string; promise: Promise<boolean> }>()
  /** A close outlives the entry it invalidates, so backup drain needs an independent exact registry. */
  private readonly connectionCloses = new Map<string, { sessionId: string; promise: Promise<void> }>()
  private readonly closingEntries = new WeakMap<AgentConnectionEntry, Promise<void>>()
  /** Parked stream resources keyed by the exact suspend effect that owns them. */
  private readonly suspendedConversationTurns = new Map<ConversationEffectId, SuspendedConversationTurn>()
  /** Promise resources for a rebuild-blocked connection; the state only owns the blocked phase. */
  private readonly backgroundWorkWaiters = new Map<
    string,
    { connection: AgentRuntimeConnection; promise: Promise<void>; resolve: () => void }
  >()
  /** Warm-lease holders by session: the window WebContents currently displaying it. The runtime
   *  connection is shared per-session across windows, so its view-close teardown may only start
   *  once this set is empty — a renderer-local count can neither see other windows nor survive
   *  their crash. */
  private readonly warmLeaseHolders = new Map<string, Set<Electron.WebContents>>()
  /** One destroyed-listener per holder window, so a window that dies without releasing (crash,
   *  forced close — renderer cleanup never runs) is reaped from every session it held. */
  private readonly warmLeaseSenders = new Map<Electron.WebContents, { sessionIds: Set<string>; dispose: () => void }>()
  /** Armed grace timers for sessions whose last holder released (see WARM_LEASE_RELEASE_DELAY_MS). */
  private readonly pendingWarmTeardowns = new Map<string, NodeJS.Timeout>()
  private conversationResultSink?: AgentConversationResultSink

  bindConversationResultSink(port: AgentConversationResultSink): void {
    this.conversationResultSink = port
  }

  private get conversationResults(): AgentConversationResultSink {
    this.conversationResultSink ??= application.get('ConversationRuntimeService')
    return this.conversationResultSink
  }

  protected async onInit(): Promise<void> {
    this.bindConversationResultSink(application.get('ConversationRuntimeService'))
    // Populate the AI runtime driver registry at a controlled lifecycle point (WhenReady, before
    // any agent session runs) instead of relying on an import-time side effect.
    registerRuntimeDrivers()

    // Resolve agent-session assistant rows a prior main-process crash left `pending` — at boot the
    // in-memory entry map is empty, so every such row is stale. Both message tables reconcile these
    // rows at boot so neither leaves a frozen "thinking" bubble. Crashed sessions additionally discard
    // their resume tokens: the interrupted external
    // CLI session state is untrusted, so their next connection starts fresh instead of resuming it.
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
      const stale = agentSessionMessageService.findCrashOrphanedAssistantMessages()
      if (stale.length === 0) return
      const sessionIds = [...new Set(stale.map((message) => message.sessionId))]
      logger.info('Reconciling crash-orphaned pending agent-session messages', {
        count: stale.length,
        sessionCount: sessionIds.length
      })
      // Terminalize the interrupted turn's live parts (streaming tools, in-progress subagent
      // tasks, unanswerable approval requests) so history renders settled, and discard the
      // affected sessions' resume tokens so prewarm/next turn opens a fresh runtime connection.
      agentSessionMessageService.resolveCrashOrphanedMessages(
        stale.map(({ id, data }) => ({
          id,
          data: { ...data, parts: finalizeInterruptedParts(data.parts ?? [], ConversationOutcomeKind.Error) }
        })),
        sessionIds
      )
    } catch (error) {
      logger.error('Failed to reconcile stale pending agent-session messages', { error })
    }
  }

  private currentTurn(entry: AgentConnectionEntry): AgentTurnStreamResource | undefined {
    return getAgentCurrentStreamResource(entry.resources)
  }

  private liveTurn(entry: AgentConnectionEntry): AgentTurnStreamResource | undefined {
    return getAgentLiveStreamResource(entry.resources)
  }

  private isTurnLive(entry: AgentConnectionEntry, turn: AgentTurnStreamResource): boolean {
    return isAgentStreamResourceLive(entry.resources, turn)
  }

  private currentConnection(entry: AgentConnectionEntry): AgentRuntimeConnection | undefined {
    return getAgentConnectionResource(entry.resources)
  }

  private resourceStatus(entry: AgentConnectionEntry): AgentConnectionResourceStatus {
    return hasAgentConnectionResources(entry.resources)
      ? AgentConnectionResourceStatus.Active
      : AgentConnectionResourceStatus.Idle
  }

  private applyResourceEvent(entry: AgentConnectionEntry, event: AgentResourceEvent): void {
    if (!this.isCurrentEntry(entry)) return
    const transition = transitionAgentConnectionResource(entry.resources, event)
    entry.resources = transition.state
    for (const effect of transition.effects) this.executeResourceEffect(entry, effect)
  }

  private executeResourceEffect(
    entry: AgentConnectionEntry,
    effect: AgentConnectionResourceEffect<AgentTurnStreamResource>
  ): void {
    switch (effect.type) {
      case AgentConnectionResourceEventType.DeliverBuffer:
        for (const chunk of effect.chunks) this.enqueueTurnChunk(entry, effect.turn, chunk)
        break
      case AgentConnectionResourceEventType.CloseTurnStream: {
        // The resource remains awaiting release until Conversation has durably committed terminal state.
        if (effect.outcome.status === AgentDriverOutcomeKind.Error) {
          this.errorTurn(effect.turn, effect.outcome.error)
        } else {
          this.closeTurn(effect.turn)
        }
        break
      }
      case AgentConnectionResourceEventType.ReleaseBackgroundWaiter:
        this.closeBackgroundActivity(entry)
        this.releaseBackgroundWorkWaiter(entry, effect.connection)
        break
      case AgentConnectionResourceEventType.CompactionInterrupted:
        this.closeCompactionActivity(entry)
        application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.conversation.id), {
          status: 'idle'
        })
        break
      case AgentConnectionResourceEventType.LogInvalidTransition:
        logger.warn('Ignoring invalid agent session runtime transition', {
          sessionId: entry.conversation.id,
          event: effect.event,
          state: effect.state
        })
        break
    }
  }

  prepareTurnResources(input: PrepareAgentConnectionTurnInput): AgentConnectionStreamHandle {
    const turnId = input.turnId ?? crypto.randomUUID()
    const userMessage = input.userMessage ?? createSyntheticUserMessage(input.conversation.id)
    const messageSnapshot = input.messageSnapshot ? structuredClone(input.messageSnapshot) : undefined
    const existing = this.entries.get(input.conversation.id)
    const turn: AgentTurnStreamResource = {
      turnId,
      assistantMessageId: input.assistantMessageId,
      userMessage,
      modelId: input.modelId,
      messageSnapshot,
      shouldAutoName: input.shouldAutoName === true,
      reasoningEffort: input.reasoningEffort ?? 'default',
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? []) ?? [],
      fastMode: input.fastMode === true,
      activeToolIds: new Set(),
      headless: input.headless === true
    }

    if (existing && this.resourceStatus(existing) === AgentConnectionResourceStatus.Idle) {
      // A warm connection is always safe to reuse: per-turn headless enforcement lives in `canUseTool`
      // and PreToolUse hooks (resolved by session id through ConversationRuntimeService), so the
      // connection's baked settings no longer vary by headless mode and never need a mismatch rebuild.
      this.clearIdleTimer(existing)
      existing.conversation = input.conversation
      existing.sessionTraceId = input.traceId ?? existing.sessionTraceId
      existing.agentId = input.agentId
      existing.agentType = input.agentType
      existing.modelId = input.modelId
      existing.messageSnapshot = messageSnapshot
      this.applyResourceEvent(existing, { type: AgentConnectionResourceEventType.BeginTurn, turn })
      this.applyResourceEvent(existing, { type: AgentConnectionResourceEventType.ClearSteerReservation })

      return { turnId }
    }

    if (existing) void this.closeSession(input.conversation.id)

    const entry: AgentConnectionEntry = {
      conversation: input.conversation,
      sessionTraceId: input.traceId,
      agentId: input.agentId,
      agentType: input.agentType,
      modelId: input.modelId,
      messageSnapshot,
      resources: createAgentConnectionResourceState()
    }
    this.entries.set(input.conversation.id, entry)
    this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.BeginTurn, turn })

    return { turnId }
  }

  createExecutionReleaseListener(conversation: AgentConversationRef, turnId: string): StreamListener {
    return new AgentExecutionReleaseListener(this, turnId, conversation)
  }

  suspendConversationExecution(
    effect: SuspendConversationExecutionEffect,
    runtimeTurnId: string
  ): AgentConversationResourceEffectResult {
    const sessionId = effect.conversation.id
    const entry = this.entries.get(sessionId)
    const generation = entry?.resources.generation
    if (
      effect.conversation.kind !== ConversationKind.Agent ||
      !entry ||
      generation?.kind !== AgentConnectionResourceKind.Turn ||
      generation.turn.turnId !== runtimeTurnId ||
      generation.delivery === AgentConnectionDeliveryPhase.Sent ||
      !this.isTurnLive(entry, generation.turn) ||
      this.suspendedConversationTurnForSession(sessionId) !== undefined
    ) {
      return { kind: AgentConversationResourceEffectResultKind.Stale, effectId: effect.effectId }
    }
    const turn = generation.turn
    this.suspendedConversationTurns.set(effect.effectId, {
      conversation: effect.conversation,
      turnId: effect.turnId,
      executionId: effect.executionId,
      suspendEffectId: effect.effectId,
      runtimeTurnId,
      turn
    })
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started,
      contextTurn: turn
    })
    this.closeTurn(turn)
    this.clearIdleTimer(entry)
    return { kind: AgentConversationResourceEffectResultKind.Applied, effectId: effect.effectId }
  }

  resumeConversationExecution(
    effect: ResumeSuspendedConversationExecutionEffect,
    runtimeTurnId: string
  ): AgentConversationResourceEffectResult {
    const sessionId = effect.conversation.id
    const entry = this.entries.get(sessionId)
    const suspended = this.suspendedConversationTurns.get(effect.suspendEffectId)
    if (
      effect.conversation.kind !== ConversationKind.Agent ||
      !entry ||
      !suspended ||
      !conversationRefsEqual(suspended.conversation, effect.conversation) ||
      suspended.turnId !== effect.turnId ||
      suspended.executionId !== effect.executionId ||
      suspended.runtimeTurnId !== runtimeTurnId ||
      entry.resources.generation.kind !== AgentConnectionResourceKind.AutonomousTurn
    ) {
      return { kind: AgentConversationResourceEffectResultKind.Stale, effectId: effect.effectId }
    }
    this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.AutonomousTurnCleared })
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: suspended.turn
    })
    this.suspendedConversationTurns.delete(effect.suspendEffectId)
    return { kind: AgentConversationResourceEffectResultKind.Applied, effectId: effect.effectId }
  }

  discardAutonomousBuffer(effect: DiscardConversationRuntimeBufferEffect): AgentConversationResourceEffectResult {
    const sessionId = effect.conversation.id
    const entry = this.entries.get(sessionId)
    const suspended = this.suspendedConversationTurns.get(effect.preemptionId)
    if (
      effect.conversation.kind !== ConversationKind.Agent ||
      !entry ||
      entry.resources.generation.kind !== AgentConnectionResourceKind.AutonomousTurn ||
      !suspended ||
      !conversationRefsEqual(suspended.conversation, effect.conversation) ||
      suspended.turnId !== effect.turnId
    ) {
      return { kind: AgentConversationResourceEffectResultKind.Stale, effectId: effect.effectId }
    }
    if (entry.resources.generation.turn) this.closeTurn(entry.resources.generation.turn)
    this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.AutonomousTurnCleared })
    this.suspendedConversationTurns.delete(effect.preemptionId)
    this.refreshIdleTimer(entry)
    return { kind: AgentConversationResourceEffectResultKind.Applied, effectId: effect.effectId }
  }

  private suspendedConversationTurnForSession(sessionId: string): SuspendedConversationTurn | undefined {
    for (const suspended of this.suspendedConversationTurns.values()) {
      if (suspended.conversation.id === sessionId) return suspended
    }
    return undefined
  }

  runtimeResumeToken(sessionId: string): string | undefined {
    return this.entries.get(sessionId)?.lastResumeToken
  }

  /**
   * Resolve the trusted gateway correlation into the reserved continuation or active turn.
   * The gateway calls this at provider-request ingress, before any later agent edit,
   * message roll, or deletion can affect usage persistence.
   */
  getActiveUsageContext(sessionId: string): InProcessUsageContext | undefined {
    const entry = this.entries.get(sessionId)
    const reservation =
      entry?.resources.generation.kind === AgentConnectionResourceKind.Turn
        ? entry.resources.generation.reservation
        : entry?.resources.generation.kind === AgentConnectionResourceKind.SteerTransition
          ? entry.resources.generation.reservation
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

  private reserveSteerContinuation(entry: AgentConnectionEntry, inputs: AgentRuntimeUserInput[]): void {
    if (!this.isCurrentEntry(entry) || entry.usageCapture?.owner !== AgentSessionUsageCaptureOwner.ProviderCalls) return
    const turn = this.currentTurn(entry)
    const steerMessage = inputs[0]?.message
    if (
      !turn ||
      !this.isTurnLive(entry, turn) ||
      !steerMessage ||
      (entry.resources.generation.kind === AgentConnectionResourceKind.Turn && entry.resources.generation.reservation)
    ) {
      return
    }

    const messageSnapshot = inputs[0]?.messageSnapshot ?? entry.messageSnapshot
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ReserveSteer,
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
      if (this.isWriteQuiesced) return
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

      const entry: AgentConnectionEntry = {
        conversation: { kind: ConversationKind.Agent, id: sessionId },
        sessionTraceId,
        agentId: session.agentId,
        agentType: agent.type,
        modelId: agent.model,
        resources: createAgentConnectionResourceState()
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
      if (this.resourceStatus(entry) === AgentConnectionResourceStatus.Idle && !this.liveTurn(entry)) {
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

  private async reconcileEntryConnection(entry: AgentConnectionEntry): Promise<void> {
    const connection = this.currentConnection(entry)
    if (!connection) return

    let verdict: AgentRuntimeReconcileResult
    try {
      verdict = await connection.reconcile(this.connectionTarget(entry))
    } catch (error) {
      logger.error('Connection reconcile threw; failing closed', { sessionId: entry.conversation.id, error })
      this.closeFailedPolicyUpdateConnection(entry, connection)
      return
    }
    // The entry/connection may have been replaced while reconcile awaited — never act on a successor.
    if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return

    switch (verdict) {
      case AgentRuntimeReconcileResult.Current:
      case AgentRuntimeReconcileResult.Patched:
        return
      case AgentRuntimeReconcileResult.Rebuild: {
        // Safe live patches are already applied. Rebuild eagerly only when nothing is streaming —
        // a roll or non-terminal turn keeps its connection, and the next fresh turn's pull picks up
        // the rebuild plus any permission-mode change deferred at the turn boundary.
        const hasLiveTurn =
          this.liveTurn(entry) !== undefined ||
          isAgentStreamResourceTransitioning(entry.resources) ||
          hasAgentConnectionBackgroundWork(entry.resources)
        if (!hasLiveTurn) this.closeConnectionAsync(entry)
        return
      }
      case AgentRuntimeReconcileResult.Invalid:
        // Desired config no longer derivable (agent/session/model rows gone) — same full
        // invalidation as a cleared model.
        this.invalidateModelClearedEntry(entry)
        return
      case AgentRuntimeReconcileResult.Failed:
        // Fail closed: a failed live patch may have left the connection enforcing the OLD (looser)
        // policy — the snapshot's `permissionMode` gates `canUseTool`, so a failed tighten must not
        // keep running. Pause the live turn and tear the connection down.
        logger.error('Live connection reconcile failed; closing runtime connection', {
          sessionId: entry.conversation.id
        })
        this.closeFailedPolicyUpdateConnection(entry, connection)
        return
    }
  }

  /** Fail closed when a model update makes this connection unroutable. */
  private invalidateModelClearedEntry(entry: AgentConnectionEntry): void {
    if (this.liveTurn(entry)) {
      this.conversationResults.abort({ kind: ConversationKind.Agent, id: entry.conversation.id }, 'agent-model-cleared')
    }
    void this.closeSession(entry.conversation.id)
  }

  openExecutionStream(input: OpenAgentTurnStreamInput): ReadableStream<UIMessageChunk> {
    const entry = this.entries.get(input.conversation.id)
    const turn = entry ? this.currentTurn(entry) : undefined
    if (!entry || !turn || turn.turnId !== input.turnId) {
      throw new Error(`No active agent runtime turn ${input.turnId} for session ${input.conversation.id}`)
    }

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          this.clearIdleTimer(entry)
          turn.controller = controller
          this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.TurnStreamOpened, turn })

          // A user Stop is the only abort source now (steer no longer interrupts) — tear the
          // session down so `connection.close()` kills the warm query and its subagent.
          const onAbort = () => void this.closeSession(entry.conversation.id)
          if (input.signal.aborted) {
            onAbort()
            return
          } else {
            input.signal.addEventListener('abort', onAbort, { once: true })
          }

          // A steer/autonomous transition owns any chunks that arrived before this controller. The
          // state transition atomically transfers that buffer to this exact turn before delivery.
          this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.FlushTransition })
          if (!this.isTurnLive(entry, turn)) return
          const connected = await this.ensureConnection(entry)
          if (!connected || !this.isCurrentEntry(entry) || !this.isTurnLive(entry, turn)) return
          controller.enqueue({ type: 'start' })
          await this.sendTurnToConnection(entry, turn)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel: () => {
        // Routed through the machine so the settle is a real transition (`awaiting-persistence`)
        // rather than an out-of-band mutation the busy/live queries cannot see.
        this.applyResourceEvent(entry, {
          type: AgentConnectionResourceEventType.DriverTerminal,
          outcome: { status: AgentDriverOutcomeKind.Paused }
        })
      }
    })
  }

  /** Resource-plane redirect; the ConversationActor owns fallback queueing when this returns false. */
  redirectConversationInput(
    sessionId: string,
    message: AgentSessionMessageEntity,
    opts: {
      headless?: boolean
      reasoningEffort?: ReasoningEffortOption
      fastMode?: boolean
      messageSnapshot?: MessageSnapshot
    } = {}
  ): boolean {
    const entry = this.entries.get(sessionId)
    const turn = entry ? this.currentTurn(entry) : undefined
    if (!entry || !turn || opts.headless === true || turn.headless === true) return false
    const reasoningEffort = opts.reasoningEffort ?? 'default'
    const fastMode = opts.fastMode === true
    const knowledgeBaseIds = getKnowledgeBaseIdsFromParts(message.data.parts ?? []) ?? []
    const configuredKnowledgeBaseIds = agentService.getAgent(entry.agentId)?.knowledgeBaseIds
    if (
      turn.modelId !== entry.modelId ||
      turn.reasoningEffort !== reasoningEffort ||
      turn.fastMode !== fastMode ||
      !knowledgeScopeEquals(
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, turn.knowledgeBaseIds),
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, knowledgeBaseIds)
      )
    ) {
      return false
    }
    return (
      this.isTurnLive(entry, turn) &&
      hasOpenAgentStreamResource(entry.resources, turn) &&
      isAgentTurnSentToConnection(entry.resources, turn) &&
      this.currentConnection(entry)?.redirect?.({
        message,
        systemReminder: true,
        messageSnapshot: opts.messageSnapshot
      }) === true
    )
  }

  /** Release only the exact stream resource named by Conversation's persisted terminal result. */
  releaseExecutionResource(settlement: AgentExecutionRelease): void {
    const entry = this.entries.get(settlement.conversation.id)
    if (!entry) return
    if (!conversationRefsEqual(entry.conversation, settlement.conversation)) return
    const turn = this.currentTurn(entry)
    if (!turn || turn.turnId !== settlement.turnId) return
    this.releaseTurnResource(settlement.conversation.id, settlement.outcome, settlement.turnId)
  }

  releaseTurnResource(sessionId: string, status: AgentDriverOutcomeKind, expectedTurnId?: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    const completedTurn = this.currentTurn(entry)
    if (expectedTurnId) {
      const generation = entry.resources.generation
      const executionOwnsTurn =
        (generation.kind === AgentConnectionResourceKind.Turn && generation.turn === completedTurn) ||
        (generation.kind === AgentConnectionResourceKind.SteerTransition &&
          (generation.sourceTurn === completedTurn || generation.continuationTurn === completedTurn)) ||
        (generation.kind === AgentConnectionResourceKind.AutonomousTurn && generation.turn === completedTurn)
      if (!executionOwnsTurn || completedTurn?.turnId !== expectedTurnId) return
    }
    if (completedTurn) this.markFlowMessagePersisted(entry, completedTurn.assistantMessageId)
    if (completedTurn) {
      this.applyResourceEvent(entry, {
        type: AgentConnectionResourceEventType.TurnReleased,
        turnId: completedTurn.turnId,
        turn: completedTurn,
        status
      })
    }

    const generation = entry.resources.generation
    if (
      generation.kind === AgentConnectionResourceKind.AutonomousTurn &&
      generation.ownership === AgentAutonomousResourceOwnership.Released &&
      generation.releaseOutcome !== undefined &&
      !this.suspendedConversationTurnForSession(sessionId)
    ) {
      this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.AutonomousTurnCleared })
    }

    if (this.isWriteQuiesced && !this.isSessionBusy(sessionId)) {
      void this.closeSession(sessionId)
    } else {
      this.refreshIdleTimer(entry)
    }
  }

  closeSession(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      const existing = [...this.connectionCloses.values()]
        .filter((operation) => operation.sessionId === sessionId)
        .map((operation) => operation.promise)
      return Promise.allSettled(existing).then(() => undefined)
    }
    const existingClose = this.closingEntries.get(entry)
    if (existingClose) return existingClose
    const fallbackConnection = this.currentConnection(entry)
    const pendingConnectionStart = this.connectionStarts.get(sessionId)?.promise
    const connectionLoop = entry.connectionLoop
    this.entries.delete(sessionId)
    let closing: Promise<void>
    try {
      closing = this.closeEntry(entry)
    } catch (error) {
      logger.warn('Agent runtime entry close failed', { sessionId, error })
      closing = this.closeRuntimeConnection(fallbackConnection, sessionId)
    }
    const id = crypto.randomUUID()
    const promise = Promise.allSettled([closing, pendingConnectionStart, connectionLoop])
      .then(() => undefined)
      .finally(() => {
        this.connectionCloses.delete(id)
      })
    this.connectionCloses.set(id, { sessionId, promise })
    this.closingEntries.set(entry, promise)
    return promise
  }

  /**
   * Release a connection opened by {@link primeConnection} (or left idle after a turn) when its
   * session view closes — frees the subprocess and clears the cached catalog now instead of waiting
   * out the idle TTL. No-op while a turn is in flight or background work still owns connection-local
   * resources. Background keepalive is deliberately not "busy": a new user turn may still start.
   */
  releaseIdleConnection(sessionId: string): void {
    const idleEntry = this.entries.get(sessionId)
    if (idleEntry && hasAgentConnectionBackgroundWork(idleEntry.resources)) return
    if (this.isSessionBusy(sessionId)) return
    void this.closeSession(sessionId)
  }

  /**
   * Acquire a warm-connection lease for a window displaying this session. The first holder primes
   * the connection ({@link primeConnection}); later holders re-prime so the slash-command catalog
   * is republished for windows that mount after the initial publish. An unmanaged sender (no
   * WebContents) cannot be tracked as a holder — it still primes, and the idle TTL reaps the
   * connection if nothing else holds it.
   */
  acquireWarmLease(sessionId: string, sender: Electron.WebContents | undefined): void {
    const pendingTeardown = this.pendingWarmTeardowns.get(sessionId)
    if (pendingTeardown) {
      clearTimeout(pendingTeardown)
      this.pendingWarmTeardowns.delete(sessionId)
    }
    if (sender && !sender.isDestroyed()) {
      let holders = this.warmLeaseHolders.get(sessionId)
      if (!holders) {
        holders = new Set()
        this.warmLeaseHolders.set(sessionId, holders)
      }
      holders.add(sender)
      this.trackWarmLeaseSender(sessionId, sender)
    }
    // A canceled pending teardown means the backend is still warm and its catalog cache intact —
    // skip the redundant re-prime.
    if (!pendingTeardown) {
      void this.primeConnection(sessionId)
    }
  }

  /**
   * Release one window's warm lease. The actual teardown (warm-query park + primed connection)
   * starts only when no window holds the session anymore, and then only after
   * {@link WARM_LEASE_RELEASE_DELAY_MS} with no re-acquire.
   */
  releaseWarmLease(sessionId: string, sender: Electron.WebContents | undefined): void {
    if (sender) {
      const record = this.warmLeaseSenders.get(sender)
      if (record) {
        record.sessionIds.delete(sessionId)
        if (record.sessionIds.size === 0) {
          this.warmLeaseSenders.delete(sender)
          record.dispose()
        }
      }
      this.dropWarmLeaseHolder(sessionId, sender)
      return
    }
    // Unmanaged sender: it was never tracked as a holder, so only tear down when no managed
    // window holds the session either.
    if (!this.warmLeaseHolders.has(sessionId)) this.scheduleWarmTeardown(sessionId)
  }

  private trackWarmLeaseSender(sessionId: string, sender: Electron.WebContents): void {
    let record = this.warmLeaseSenders.get(sender)
    if (!record) {
      const onDestroyed = () => this.releaseWarmLeasesForSender(sender)
      sender.once('destroyed', onDestroyed)
      record = { sessionIds: new Set(), dispose: () => sender.removeListener('destroyed', onDestroyed) }
      this.warmLeaseSenders.set(sender, record)
    }
    record.sessionIds.add(sessionId)
  }

  private releaseWarmLeasesForSender(sender: Electron.WebContents): void {
    const record = this.warmLeaseSenders.get(sender)
    if (!record) return
    this.warmLeaseSenders.delete(sender)
    record.dispose()
    for (const sessionId of record.sessionIds) {
      this.dropWarmLeaseHolder(sessionId, sender)
    }
  }

  private dropWarmLeaseHolder(sessionId: string, sender: Electron.WebContents): void {
    const holders = this.warmLeaseHolders.get(sessionId)
    // Unknown holder (double release, or release without acquire): leave teardown to the idle TTL
    // rather than guessing another window's state.
    if (!holders?.delete(sender)) return
    if (holders.size > 0) return
    this.warmLeaseHolders.delete(sessionId)
    this.scheduleWarmTeardown(sessionId)
  }

  private scheduleWarmTeardown(sessionId: string): void {
    const existing = this.pendingWarmTeardowns.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pendingWarmTeardowns.delete(sessionId)
      // Prewarm opens a real runtime connection, so releasing the warm-query park alone would
      // leak the primed subprocess until the idle TTL.
      application.get('ClaudeCodeWarmQueryManager').closeAgentSessionWarm(sessionId)
      this.releaseIdleConnection(sessionId)
    }, WARM_LEASE_RELEASE_DELAY_MS)
    timer.unref()
    this.pendingWarmTeardowns.set(sessionId, timer)
  }

  private disposeWarmLeases(): void {
    for (const timer of this.pendingWarmTeardowns.values()) clearTimeout(timer)
    this.pendingWarmTeardowns.clear()
    for (const record of this.warmLeaseSenders.values()) record.dispose()
    this.warmLeaseSenders.clear()
    this.warmLeaseHolders.clear()
  }

  /** Whether connection-local stream, compaction, or autonomous resources are still active. */
  private isSessionBusy(sessionId: string): boolean {
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    return hasAgentConnectionResources(entry.resources)
  }

  /** Whether any agent session can still mutate its DB row or external runtime files. */
  hasBusySessions(): boolean {
    if (this.connectionStarts.size > 0 || this.connectionCloses.size > 0 || this.inFlightBackgroundFlowFlushes.size > 0)
      return true
    for (const sessionId of this.entries.keys()) {
      if (this.isSessionBusy(sessionId)) return true
    }
    return false
  }

  // ── Write quiesce (backup restore) ───────────────────────────────
  // ConversationRuntimeService owns delivery and drains its own effects. This hold only fences
  // connection-local writes and detached flow finalization during backup/restore.

  /** True while any write-quiesce hold is live. */
  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  /** Hold connection-local writes during backup/restore. */
  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'agent-session-runtime-pause')
    const firstHold = this.pauseHolds.size === 0
    this.pauseHolds.add(token)
    if (firstHold) {
      for (const sessionId of [...this.entries.keys()]) {
        if (!this.isSessionBusy(sessionId)) void this.closeSession(sessionId)
      }
    }
    logger.info('AgentConnectionManager paused', { reason: reason ?? null, holds: this.pauseHolds.size })
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('AgentConnectionManager pause hold released', {
          reason: reason ?? null,
          holds: this.pauseHolds.size
        })
        if (this.pauseHolds.size > 0) return
      }
    }
  }

  /**
   * Await detached flow finalizers, bounded by timeoutMs. Conversation-owned generation and
   * terminal persistence are drained by ConversationRuntimeService.
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
      for (const [sessionId, operation] of this.connectionStarts) {
        const promise = operation.promise
        if (seen.has(promise)) continue
        seen.add(promise)
        pending.set(promise, `connection-start:${sessionId}:${operation.id}`)
        const remove = () => pending.delete(promise)
        promise.then(remove, remove)
      }
      for (const [operationId, operation] of this.connectionCloses) {
        const promise = operation.promise
        if (seen.has(promise)) continue
        seen.add(promise)
        pending.set(promise, `connection-close:${operation.sessionId}:${operationId}`)
        const remove = () => pending.delete(promise)
        promise.then(remove, remove)
      }
      for (const [flush, operationId] of this.inFlightBackgroundFlowFlushes) {
        if (seen.has(flush)) continue
        seen.add(flush)
        pending.set(flush, `background-flow:${operationId}`)
        const remove = () => pending.delete(flush)
        flush.then(remove, remove)
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
        summary: `turn=${turn} generation=${entry.resources.generation.kind} compacting=${hasAgentCompactionResource(entry.resources)}`
      })
    }
    return work
  }

  /**
   * Resolve a Claude `canUseTool` approval registered against this runtime session. Persisted
   * interaction messages are settled before their SDK promise; live overlays are cleared after it.
   * Returns `false` if no registry entry matches so the caller can fall back to the MCP path.
   */
  respondToolApproval(approvalId: string, decision: DispatchDecision, anchorId?: string): boolean {
    const pending = toolApprovalRegistry.peek(approvalId)
    if (!pending) return false

    if (pending.presentation === AgentRuntimeInteractionPresentation.Message) {
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

    if (dispatched.presentation === AgentRuntimeInteractionPresentation.Stream) {
      this.conversationResults.resolveAgentInteraction(dispatched.sessionId, approvalId)
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
    return this.conversationResults.addCompletedRuntimeSpan(
      { kind: ConversationKind.Agent, id: entry.conversation.id },
      turn.assistantMessageId,
      {
        id: `tool:${input.toolCallId}`,
        kind: 'tool-execution',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        startedAt: completedAt - input.durationMs,
        completedAt
      }
    )
  }

  private closeResources(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry) return Promise.resolve()
    return this.closeSession(sessionId)
  }

  protected async onStop(): Promise<void> {
    this.disposeWarmLeases()
    const closings: Promise<void>[] = []
    for (const entry of [...this.entries.values()]) {
      this.conversationResults.abort(
        { kind: ConversationKind.Agent, id: entry.conversation.id },
        'agent-session-runtime-stop'
      )
      closings.push(this.closeResources(entry.conversation.id))
    }
    try {
      toolApprovalRegistry.clear('agent-session-runtime-stop')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during stop', { error })
    }
    await Promise.allSettled(closings)
    await this.closeAll()
  }

  protected async onDestroy(): Promise<void> {
    this._onApprovalRequested.dispose()
    this.disposeWarmLeases()
    await this.closeAll()
    try {
      toolApprovalRegistry.clear('agent-session-runtime-destroy')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during destroy', { error })
    }
  }

  private isCurrentEntry(entry: AgentConnectionEntry): boolean {
    return this.entries.get(entry.conversation.id) === entry
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
  private connectionTarget(entry: AgentConnectionEntry): AgentConnectionTarget {
    const turn =
      this.currentTurn(entry) ??
      (entry.resources.generation.kind === AgentConnectionResourceKind.AutonomousTurn
        ? entry.resources.generation.contextTurn
        : undefined)
    const live =
      turn &&
      (this.isTurnLive(entry, turn) ||
        isAgentStreamResourceTransitioning(entry.resources) ||
        hasAgentConnectionBackgroundWork(entry.resources))
    return live
      ? {
          modelId: turn.modelId,
          reasoningEffort: turn.reasoningEffort,
          knowledgeBaseIds: turn.knowledgeBaseIds,
          fastMode: turn.fastMode
        }
      : { modelId: entry.modelId, reasoningEffort: 'default', knowledgeBaseIds: [], fastMode: false }
  }

  private connectionTargetEquals(entry: AgentConnectionEntry, target: AgentConnectionTarget): boolean {
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

  private async ensureConnection(entry: AgentConnectionEntry): Promise<boolean> {
    while (this.isCurrentEntry(entry)) {
      const target = this.connectionTarget(entry)
      const connection = this.currentConnection(entry)
      if (connection) {
        // Never reconcile a connection carrying a live driver generation; a fresh unsent resource
        // may reconcile to the latest configuration before it is delivered.
        const turn = this.currentTurn(entry)
        if (
          isAgentAutonomousResourceActive(entry.resources) ||
          isAgentStreamResourceTransitioning(entry.resources) ||
          (turn && isAgentTurnSentToConnection(entry.resources, turn) && this.isTurnLive(entry, turn))
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
          logger.error('Connection reconcile threw; failing closed', { sessionId: entry.conversation.id, error })
          verdict = AgentRuntimeReconcileResult.Failed
        }
        if (!this.isCurrentEntry(entry)) return false
        if (this.currentConnection(entry) !== connection) continue
        // A turn may have been sent while reconcile awaited (e.g. a racing openExecutionStream that
        // reused the connection) — its stream now rides this connection, so stop touching it.
        const turnAfter = this.currentTurn(entry)
        if (
          isAgentAutonomousResourceActive(entry.resources) ||
          isAgentStreamResourceTransitioning(entry.resources) ||
          (turnAfter && isAgentTurnSentToConnection(entry.resources, turnAfter) && this.isTurnLive(entry, turnAfter))
        ) {
          return true
        }

        switch (verdict) {
          case AgentRuntimeReconcileResult.Current:
          case AgentRuntimeReconcileResult.Patched:
            return true
          case AgentRuntimeReconcileResult.Rebuild: {
            // Background work may keep the old connection alive, but it cannot make a spawn-frozen
            // mismatch safe. Hold this fresh turn until the driver releases that work, then loop,
            // close A, connect B, and only then admit the user input.
            if (hasAgentConnectionBackgroundWork(entry.resources)) {
              logger.info('Deferring connection rebuild until background work releases', {
                sessionId: entry.conversation.id
              })
              await this.waitForBackgroundWorkRelease(entry, connection, target)
              if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) continue
              logger.info('Background work released; retrying connection rebuild', {
                sessionId: entry.conversation.id
              })
              continue
            }
            this.closeConnectionAsync(entry)
            continue
          }
          case AgentRuntimeReconcileResult.Failed:
            // 'failed' pre-turn is recoverable: the suspect connection is torn down (fail closed)
            // and the loop reconnects from the latest config.
            this.closeConnectionAsync(entry)
            continue
          case AgentRuntimeReconcileResult.Invalid:
            void this.closeSession(entry.conversation.id)
            return false
        }
      }

      // Share a single in-flight connect across concurrent callers so two streams opening at once
      // can't each spin up a connection (the second would leak/clobber the first). Whatever that
      // connect produces, loop and re-check it — a stale connection start self-discards in `connect()` and a
      // fresh one passes the reconcile above.
      const existingStart = this.connectionStarts.get(entry.conversation.id)
      if (existingStart) {
        await existingStart.promise.catch(() => false)
        continue
      }

      const connectionAttemptId = crypto.randomUUID()
      this.applyResourceEvent(entry, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId
      })
      const connecting = this.connect(entry, target, connectionAttemptId).finally(() => {
        if (this.connectionStarts.get(entry.conversation.id)?.id === connectionAttemptId) {
          this.connectionStarts.delete(entry.conversation.id)
        }
        if (
          this.isCurrentEntry(entry) &&
          entry.resources.connection.kind === 'connecting' &&
          entry.resources.connection.connectionAttemptId === connectionAttemptId
        ) {
          this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.ConnectionDisconnected })
        }
      })
      this.connectionStarts.set(entry.conversation.id, { id: connectionAttemptId, promise: connecting })
      const connected = await connecting
      if (connected) return true
    }

    return false
  }

  private async connect(
    entry: AgentConnectionEntry,
    target: AgentConnectionTarget,
    connectionAttemptId: string
  ): Promise<boolean> {
    const driver = runtimeDriverRegistry.getAgentSessionDriver(entry.agentType)
    if (!driver) throw new Error(`Unsupported agent runtime type: ${entry.agentType}`)

    this.hydrateResumeToken(entry)
    if (!this.isCurrentEntry(entry)) return false

    const connection = await driver.connect({
      sessionId: entry.conversation.id,
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
      await this.closeRuntimeConnection(connection, entry.conversation.id)
      return false
    }

    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId,
      connection
    })
    if (this.currentConnection(entry) !== connection) {
      await this.closeRuntimeConnection(connection, entry.conversation.id)
      return false
    }
    entry.usageCapture = connection.usageCapture
    this.resetConnectionResources(entry, connection)
    // Priming opens an idle connection only to populate connection-local metadata such as slash
    // commands. Context usage is expensive (the SDK issues multiple token-count probes), so defer it
    // until a real turn, a runtime event, or an explicit UI refresh needs a reading.
    if (this.resourceStatus(entry) === AgentConnectionResourceStatus.Active) this.refreshContextUsage(entry, connection)
    this.refreshSupportedCommands(entry, connection)
    const connectionLoop = this.runConnectionLoop(entry, connection).finally(() => {
      void this.closeRuntimeConnection(connection, entry.conversation.id)
      if (this.currentConnection(entry) === connection) {
        this.resetConnectionResources(entry, connection)
        this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.ConnectionDisconnected, connection })
      }
      if (entry.connectionLoop === connectionLoop) entry.connectionLoop = undefined
    })
    entry.connectionLoop = connectionLoop
    return true
  }

  private hydrateResumeToken(entry: AgentConnectionEntry): void {
    if (entry.lastResumeToken) return
    const runtimeResumeToken = agentSessionMessageService.getLastRuntimeResumeToken(entry.conversation.id)
    if (runtimeResumeToken) entry.lastResumeToken = runtimeResumeToken
  }

  private async runConnectionLoop(entry: AgentConnectionEntry, connection: AgentRuntimeConnection): Promise<void> {
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
    entry: AgentConnectionEntry,
    event: AgentRuntimeEvent,
    connection = this.currentConnection(entry)
  ): void {
    switch (event.type) {
      case AgentRuntimeEventType.ResumeToken:
        entry.lastResumeToken = event.token
        if (this.resourceStatus(entry) === AgentConnectionResourceStatus.Active) this.refreshContextUsage(entry)
        break
      case AgentRuntimeEventType.Chunk: {
        // Any content chunk means the retried request succeeded and the stream resumed — clear the
        // ephemeral retry status (backoff windows produce no chunks, so this never fires mid-retry).
        this.clearApiRetry(entry)
        // During a transition A1a is closed, or the receive-only stream is not open yet. Buffer the
        // chunks so the Conversation-owned successor stream can replay them in order.
        const generation = entry.resources.generation
        const turn = this.currentTurn(entry)
        if (
          generation.kind === AgentConnectionResourceKind.SteerTransition ||
          (generation.kind === AgentConnectionResourceKind.AutonomousTurn &&
            !hasOpenAgentStreamResource(entry.resources, turn))
        ) {
          this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.BufferChunk, chunk: event.chunk })
          break
        }
        if (turn?.controller && this.isTurnLive(entry, turn)) this.enqueueTurnChunk(entry, turn, event.chunk)
        break
      }
      case AgentRuntimeEventType.ToolApprovalRequest:
        this.handleToolApprovalRequest(entry, event.request)
        break
      case AgentRuntimeEventType.Usage:
        this.recordRuntimeUsage(entry, event.invocation)
        break
      case AgentRuntimeEventType.SteerBoundary:
        // The model is about to emit its post-steer assistant message. Finalise the pre-steer parts as
        // A1a, then buffer the continuation until the Conversation owner opens A2.
        // A responder exists if the pre-steer turn was interactive or any injected steer came from one.
        this.applyResourceEvent(entry, {
          type: AgentConnectionResourceEventType.SteerBoundary,
          inputs: event.inputs,
          headless: this.currentTurn(entry)?.headless === true && event.inputs.every((input) => input.headless === true)
        })
        break
      case AgentRuntimeEventType.SteerUndelivered:
        for (const input of event.inputs) {
          this.conversationResults.enqueueAgentUndelivered(entry.conversation.id, input.message.id)
        }
        break
      case AgentRuntimeEventType.CompactionStart:
        this.handleCompactionStart(entry, event.trigger)
        break
      case AgentRuntimeEventType.CompactionComplete:
        this.handleCompactionComplete(entry, event.anchor)
        break
      case AgentRuntimeEventType.CompactionError:
        this.handleCompactionError(entry, event.error)
        break
      case AgentRuntimeEventType.ApiRetry:
        this.handleApiRetry(entry, event.retry)
        break
      case AgentRuntimeEventType.ContextUsage:
        this.persistContextUsage(entry, event.usage)
        break
      case AgentRuntimeEventType.SupportedCommands:
        // SDK pushed a refreshed catalog (`commands_changed`) — replace the cached list so the
        // composer and channel `/help` reflect commands discovered after the initial read.
        this.publishSupportedCommands(entry, event.commands)
        break
      case AgentRuntimeEventType.BackgroundTasks:
        this.publishBackgroundTasks(entry, event.tasks, connection)
        break
      case AgentRuntimeEventType.BackgroundWorkState:
        this.handleBackgroundWorkState(entry, event.active, connection)
        break
      case AgentRuntimeEventType.BackgroundTaskEvent:
        this.publishBackgroundTaskEvent(entry, event.data, connection)
        break
      case AgentRuntimeEventType.BackgroundFlowChunk:
        this.handleBackgroundFlowChunk(entry, event.rootToolCallId, event.chunk, connection)
        break
      case AgentRuntimeEventType.AutonomousTurnState: {
        if (event.state === AgentRuntimeAutonomousState.Finished) {
          this.handleAutonomousGenerationFinished(entry, connection)
          break
        }
        // Runtime-generated content is already streaming. The autonomous generation state buffers
        // chunks until its receive-only stream exists and owns any still-unadmitted user turn.
        const turn = this.currentTurn(entry)
        const turnLive = turn !== undefined && this.isTurnLive(entry, turn)
        if (turnLive && turn && isAgentTurnSentToConnection(entry.resources, turn)) break
        if (entry.resources.generation.kind === AgentConnectionResourceKind.SteerTransition) break
        const started = this.conversationResults.startAgentAutonomous(entry.conversation.id)
        if (started && !turnLive) {
          this.applyResourceEvent(entry, {
            type: AgentConnectionResourceEventType.AutonomousTurnState,
            state: AgentAutonomousGenerationState.Started,
            contextTurn: turn
          })
          this.clearIdleTimer(entry)
        }
        break
      }
      case AgentRuntimeEventType.TurnComplete:
        this.clearApiRetry(entry)
        if (entry.resources.generation.kind === AgentConnectionResourceKind.Turn) {
          this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.ClearSteerReservation })
        }
        this.applyResourceEvent(entry, {
          type: AgentConnectionResourceEventType.DriverTerminal,
          outcome: { status: AgentDriverOutcomeKind.Success }
        })
        this.refreshContextUsage(entry)
        break
      case AgentRuntimeEventType.Error:
        this.handleRuntimeError(entry, event.error)
        break
    }
  }

  private handleCompactionStart(entry: AgentConnectionEntry, trigger: AgentSessionCompactionTrigger | undefined): void {
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Compaction,
      active: true
    })
    entry.compactionActivityId ??= this.conversationResults.openAgentActivity(
      entry.conversation.id,
      ConversationActivityKind.Compaction
    )
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.conversation.id), {
      status: 'compacting',
      startedAt: new Date().toISOString(),
      ...(trigger ? { trigger } : {})
    })
  }

  private recordRuntimeUsage(
    entry: AgentConnectionEntry,
    invocation: Extract<AgentRuntimeEvent, { type: AgentRuntimeEventType.Usage }>['invocation']
  ): void {
    const capture = entry.usageCapture
    if (capture?.owner !== AgentSessionUsageCaptureOwner.AgentSdk) return

    const turn =
      invocation.messageAssociation === AgentRuntimeMessageAssociation.CurrentTurn ? this.liveTurn(entry) : undefined
    if (invocation.messageAssociation === AgentRuntimeMessageAssociation.CurrentTurn && !turn) {
      logger.warn('Agent SDK usage lost its active turn before persistence; recording stateless', {
        sessionId: entry.conversation.id,
        requestId: invocation.requestId
      })
    }

    const normalizedModel = normalizeAgentSdkModelAlias(invocation.model)
    const frozenModel = capture.frozenModels.find((candidate) =>
      candidate.aliases.some((alias) => normalizeAgentSdkModelAlias(alias) === normalizedModel)
    )
    const modelId = frozenModel?.modelId ?? normalizedModel
    aiUsageRecordService.recordInvocation({
      requestId: invocation.requestId,
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

  private handleCompactionComplete(entry: AgentConnectionEntry, anchor?: AgentSessionCompactionAnchorData): void {
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Compaction,
      active: false
    })
    this.closeCompactionActivity(entry)

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
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.conversation.id), {
      status: 'idle'
    })
    this.refreshContextUsage(entry)
    this.closeIdleEntryWhilePaused(entry)
  }

  private handleCompactionError(entry: AgentConnectionEntry, error: string): void {
    this.settleCompactionError(entry, error)
  }

  private handleApiRetry(entry: AgentConnectionEntry, retry: AgentSessionApiRetryInfo): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_API_RETRY_CACHE_KEY(entry.conversation.id), {
      status: 'retrying',
      startedAt: new Date().toISOString(),
      ...retry
    })
  }

  /** The ephemeral retry status IS the shared-cache entry — read it back instead of shadowing it. */
  private clearApiRetry(entry: AgentConnectionEntry): void {
    const cache = application.get('CacheService')
    if (cache.getShared(AGENT_SESSION_API_RETRY_CACHE_KEY(entry.conversation.id))?.status !== 'retrying') return
    cache.setShared(AGENT_SESSION_API_RETRY_CACHE_KEY(entry.conversation.id), { status: 'idle' })
  }

  private settleCompactionError(entry: AgentConnectionEntry, error: string): void {
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Compaction,
      active: false
    })
    this.closeCompactionActivity(entry)
    // The failure is surfaced to the user through the turn error (handleRuntimeError) and logged here;
    // the compaction cache state only needs to leave the compacting status.
    logger.warn('Agent session compaction failed', { sessionId: entry.conversation.id, error })
    application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.conversation.id), {
      status: 'idle'
    })
    this.closeIdleEntryWhilePaused(entry)
  }

  private refreshContextUsage(entry: AgentConnectionEntry, connection = this.currentConnection(entry)): void {
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
        logger.warn('Failed to refresh agent session context usage', { sessionId: entry.conversation.id, error })
      })
      .finally(() => {
        if (entry.contextUsageRefresh === refresh) entry.contextUsageRefresh = undefined
      })
  }

  private persistContextUsage(entry: AgentConnectionEntry, usage: AgentSessionContextUsage): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.conversation.id), usage)
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
  private refreshSupportedCommands(entry: AgentConnectionEntry, connection = this.currentConnection(entry)): void {
    if (!connection?.getSupportedCommands) return

    void (async () => {
      const commands = await connection.getSupportedCommands?.()
      if (!commands) return
      if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return
      this.publishSupportedCommands(entry, commands)
    })().catch((error) => {
      logger.warn('Failed to refresh agent session slash commands', { sessionId: entry.conversation.id, error })
    })
  }

  private publishSupportedCommands(entry: AgentConnectionEntry, commands: AgentSessionSlashCommand[]): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(entry.conversation.id), commands)
  }

  /**
   * REPLACE the cached set with the driver's normalized snapshot. This is presentation state only:
   * generation ownership is reported separately through `autonomous-turn-state`.
   */
  private publishBackgroundTasks(
    entry: AgentConnectionEntry,
    tasks: AgentSessionBackgroundTasks,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    application.get('CacheService').setShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.conversation.id), tasks)
  }

  private handleBackgroundWorkState(
    entry: AgentConnectionEntry,
    active: boolean,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    const turn = this.currentTurn(entry)
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active
    })
    if (active) {
      entry.backgroundActivityId ??= this.conversationResults.openAgentActivity(
        entry.conversation.id,
        ConversationActivityKind.Background,
        turn && turn.headless !== true ? ConversationResponderKind.Interactive : ConversationResponderKind.Headless
      )
    } else {
      this.closeBackgroundActivity(entry)
    }
    if (active) {
      this.clearIdleTimer(entry)
    } else {
      void this.finishBackgroundFlows(entry)
      if (!this.closeIdleEntryWhilePaused(entry) && !this.isSessionBusy(entry.conversation.id)) {
        this.refreshIdleTimer(entry)
      }
    }
  }

  private handleBackgroundFlowChunk(
    entry: AgentConnectionEntry,
    rootToolCallId: string,
    chunk: UIMessageChunk,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return

    const messageId = entry.flowMessageIdsByToolCallId?.get(rootToolCallId)
    if (!messageId) {
      logger.debug('Ignoring detached subagent flow chunk without a persisted message anchor', {
        sessionId: entry.conversation.id,
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

  private markFlowMessagePersisted(entry: AgentConnectionEntry, messageId: string): void {
    ;(entry.persistedFlowMessageIds ??= new Set()).add(messageId)
    const pending = entry.pendingBackgroundFlowChunks?.get(messageId)
    if (!pending?.length) return

    entry.pendingBackgroundFlowChunks?.delete(messageId)
    for (const chunk of pending) this.enqueueBackgroundFlowChunk(entry, messageId, chunk)
    if (!hasAgentConnectionBackgroundWork(entry.resources)) void this.finishBackgroundFlows(entry)
  }

  private enqueueBackgroundFlowChunk(entry: AgentConnectionEntry, messageId: string, chunk: UIMessageChunk): void {
    const accumulator = this.getOrCreateBackgroundFlowAccumulator(entry, messageId)
    try {
      accumulator.controller.enqueue(chunk)
    } catch (error) {
      logger.warn('Failed to enqueue detached subagent flow chunk', {
        sessionId: entry.conversation.id,
        messageId,
        chunkType: chunk.type,
        error
      })
    }
  }

  private getOrCreateBackgroundFlowAccumulator(
    entry: AgentConnectionEntry,
    messageId: string
  ): BackgroundFlowAccumulator {
    const accumulators = entry.backgroundFlowAccumulators ?? new Map<string, BackgroundFlowAccumulator>()
    entry.backgroundFlowAccumulators = accumulators
    const existing = accumulators.get(messageId)
    if (existing) return existing

    const persisted = agentSessionMessageService.getSessionMessage(entry.conversation.id, messageId)
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
    entry: AgentConnectionEntry,
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
            sessionId: entry.conversation.id,
            messageId: accumulator.messageId,
            error
          })
      })) {
        accumulator.latest = snapshot
        this.publishBackgroundFlowSnapshot(entry, accumulator)
      }
    } catch (error) {
      logger.warn('Detached subagent flow accumulator failed', {
        sessionId: entry.conversation.id,
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
  private publishBackgroundFlowSnapshot(entry: AgentConnectionEntry, accumulator: BackgroundFlowAccumulator): void {
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

  private publishBackgroundFlowParts(entry: AgentConnectionEntry, accumulator: BackgroundFlowAccumulator): void {
    const parts = accumulator.latest?.parts as CherryMessagePart[] | undefined
    if (!parts || !this.isCurrentEntry(entry)) return
    accumulator.lastPublishedAt = Date.now()
    application
      .get('CacheService')
      .setShared(AGENT_SESSION_FLOW_PARTS_CACHE_KEY(entry.conversation.id, accumulator.messageId), parts)
  }

  private finishBackgroundFlows(entry: AgentConnectionEntry): Promise<void> {
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
          agentSessionMessageService.replaceMessageParts(entry.conversation.id, accumulator.messageId, parts)
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
              AGENT_SESSION_FLOW_PARTS_CACHE_KEY(entry.conversation.id, messageId),
              parts,
              BACKGROUND_FLOW_HANDOFF_TTL_MS
            )
          }
        }
      })
      .catch((error) => {
        logger.warn('Failed to finalize detached subagent flow parts', { sessionId: entry.conversation.id, error })
      })
      .finally(() => {
        if (entry.backgroundFlowFlush === flush) entry.backgroundFlowFlush = undefined
      })
    entry.backgroundFlowFlush = flush
    this.inFlightBackgroundFlowFlushes.set(flush, `${entry.conversation.id}:${crypto.randomUUID()}`)
    void flush.finally(() => this.inFlightBackgroundFlowFlushes.delete(flush))
    return flush
  }

  private waitForBackgroundWorkRelease(
    entry: AgentConnectionEntry,
    connection: AgentRuntimeConnection,
    target: AgentConnectionTarget
  ): Promise<void> {
    if (
      !this.isCurrentEntry(entry) ||
      this.currentConnection(entry) !== connection ||
      !hasAgentConnectionBackgroundWork(entry.resources)
    ) {
      return Promise.resolve()
    }
    const existing = this.backgroundWorkWaiters.get(entry.conversation.id)
    if (existing?.connection === connection) return existing.promise

    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    this.backgroundWorkWaiters.set(entry.conversation.id, { connection, promise, resolve })
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ConnectionRebuildDeferred,
      connection,
      target
    })
    return promise
  }

  private releaseBackgroundWorkWaiter(entry: AgentConnectionEntry, connection?: AgentRuntimeConnection): void {
    const waiter = this.backgroundWorkWaiters.get(entry.conversation.id)
    if (!waiter || (connection && waiter.connection !== connection)) return
    this.backgroundWorkWaiters.delete(entry.conversation.id)
    waiter.resolve()
  }

  private handleAutonomousGenerationFinished(
    entry: AgentConnectionEntry,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    const preemptionId = this.suspendedConversationTurnForSession(entry.conversation.id)?.suspendEffectId
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Finished
    })
    if (preemptionId) this.conversationResults.releaseAgentRuntimeOwnership(entry.conversation.id, preemptionId)
    if (!this.isSessionBusy(entry.conversation.id)) {
      this.refreshIdleTimer(entry)
    }
  }

  /** Keep the latest lifecycle edge per task for the current connection. */
  private publishBackgroundTaskEvent(
    entry: AgentConnectionEntry,
    data: AgentTaskEventPartData,
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    const cache = application.get('CacheService')
    const key = AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.conversation.id)
    const events = cache.getShared(key) ?? {}
    // Merge instead of replace: identity fields and the row title may exist only on the start edge.
    // A completion overwriting it wholesale would strip the task of its type and display name.
    const merged: Record<string, unknown> = { ...events[data.taskId] }
    for (const [field, value] of Object.entries(data)) {
      if (value !== undefined) merged[field] = value
    }
    cache.setShared(key, { ...events, [data.taskId]: merged as unknown as AgentTaskEventPartData })
  }

  private handleToolApprovalRequest(entry: AgentConnectionEntry, request: AgentRuntimeToolApprovalRequest): void {
    const turn = this.currentTurn(entry)
    if (request.presentation === AgentRuntimeInteractionPresentation.Stream) {
      const chunk: UIMessageChunk = {
        type: 'tool-approval-request',
        approvalId: request.approvalId,
        toolCallId: request.toolCallId
      }
      if (
        entry.resources.generation.kind === AgentConnectionResourceKind.SteerTransition ||
        (entry.resources.generation.kind === AgentConnectionResourceKind.AutonomousTurn &&
          !hasOpenAgentStreamResource(entry.resources, turn))
      ) {
        this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.BufferChunk, chunk })
      } else if (turn?.controller && this.isTurnLive(entry, turn)) {
        this.enqueueTurnChunk(entry, turn, chunk)
      } else {
        logger.warn('Live tool approval request lost its turn stream', {
          sessionId: entry.conversation.id,
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
          sessionId: entry.conversation.id,
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
      this._onApprovalRequested.fire({
        conversation: { kind: ConversationKind.Agent, id: entry.conversation.id },
        approvalId: request.approvalId,
        requestedAt: Date.now()
      })
    } catch (error) {
      logger.error('Failed to persist background tool approval request', {
        sessionId: entry.conversation.id,
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
  private resetConnectionResources(entry: AgentConnectionEntry, connection: AgentRuntimeConnection): void {
    if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return
    void this.finishBackgroundFlows(entry)
    entry.flowMessageIdsByToolCallId?.clear()
    entry.persistedFlowMessageIds?.clear()
    entry.pendingBackgroundFlowChunks?.clear()
    this.applyResourceEvent(entry, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: false
    })
    if (entry.resources.generation.kind === AgentConnectionResourceKind.AutonomousTurn) {
      const preemptionId = this.suspendedConversationTurnForSession(entry.conversation.id)?.suspendEffectId
      this.applyResourceEvent(entry, {
        type: AgentConnectionResourceEventType.AutonomousTurnState,
        state: AgentAutonomousGenerationState.Finished
      })
      if (preemptionId) this.conversationResults.releaseAgentRuntimeOwnership(entry.conversation.id, preemptionId)
    }
    const cache = application.get('CacheService')
    cache.setShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.conversation.id), [])
    cache.setShared(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.conversation.id), {})
  }

  private handleRuntimeError(entry: AgentConnectionEntry, error: unknown): void {
    this.clearApiRetry(entry)
    this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.ClearSteerReservation })
    if (hasAgentCompactionResource(entry.resources)) {
      this.settleCompactionError(entry, error instanceof Error ? error.message : String(error))
    }

    const turn = this.currentTurn(entry)
    const generation = entry.resources.generation
    if (
      generation.kind === AgentConnectionResourceKind.SteerTransition ||
      generation.kind === AgentConnectionResourceKind.AutonomousTurn ||
      (generation.kind === AgentConnectionResourceKind.Turn && turn !== undefined && this.isTurnLive(entry, turn))
    ) {
      this.applyResourceEvent(entry, {
        type: AgentConnectionResourceEventType.DriverTerminal,
        outcome: { status: AgentDriverOutcomeKind.Error, error }
      })
    } else if (isAbortError(error)) {
      // Expected when a turn was interrupted/closed — the connection ending is not a fault.
      logger.warn('Agent runtime connection ended without an active turn', { sessionId: entry.conversation.id, error })
    } else {
      // No turn to surface this on, so a real runtime failure would otherwise vanish — log it loudly
      // so the next reconnect-into-the-same-failure is at least traceable.
      logger.error('Agent runtime connection ended without an active turn', { sessionId: entry.conversation.id, error })
    }
  }

  private async sendTurnToConnection(entry: AgentConnectionEntry, turn: AgentTurnStreamResource): Promise<void> {
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return
    if (isAgentTurnSentToConnection(entry.resources, turn)) return
    this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.TurnSentToConnection, turn })
    // A fresh request starts clean — drop any retry status left over from the previous turn.
    this.clearApiRetry(entry)
    await this.refreshTurnTraceContext(entry, turn)
    await this.currentConnection(entry)?.send({
      message: turn.userMessage,
      systemReminder: turn.systemReminder === true
    })
  }

  private enqueueTurnChunk(entry: AgentConnectionEntry, turn: AgentTurnStreamResource, chunk: UIMessageChunk): void {
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
  private closeTurn(turn: AgentTurnStreamResource): void {
    try {
      turn.controller?.close()
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private errorTurn(turn: AgentTurnStreamResource, error: unknown): void {
    try {
      turn.controller?.error(error)
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private async refreshTurnTraceContext(entry: AgentConnectionEntry, turn: AgentTurnStreamResource): Promise<void> {
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return
    const traceContext = this.sessionTraceContext(entry, turn.modelId)
    if (traceContext) await this.currentConnection(entry)?.refreshTraceContext?.(traceContext)
  }

  describeConversationAutonomous(sessionId: string, headless: boolean): AgentConversationRuntimeTurnIntent {
    const entry = this.entries.get(sessionId)
    if (
      !entry ||
      entry.resources.generation.kind !== AgentConnectionResourceKind.AutonomousTurn ||
      entry.resources.generation.turn
    ) {
      throw new Error(`No autonomous output is awaiting a Conversation turn for session ${sessionId}`)
    }
    const { modelId, knowledgeBaseIds, fastMode } = this.connectionTarget(entry)
    return {
      kind: AgentConversationRuntimeTurnKind.Autonomous,
      conversation: entry.conversation,
      agentId: entry.agentId,
      modelId,
      reasoningEffort: 'default',
      fastMode,
      knowledgeBaseIds,
      headless,
      userMessage: createSyntheticUserMessage(entry.conversation.id),
      assistantMessageId: uuidv7(),
      runtimeTurnId: crypto.randomUUID(),
      messageSnapshot: entry.messageSnapshot,
      traceId: entry.sessionTraceId
    }
  }

  describeConversationContinuation(sessionId: string): AgentConversationRuntimeTurnIntent {
    const entry = this.entries.get(sessionId)
    const transition = entry?.resources.generation
    if (!entry || transition?.kind !== AgentConnectionResourceKind.SteerTransition) {
      throw new Error(`No Conversation-owned steer continuation for session ${sessionId}`)
    }
    if (transition.continuationTurn) throw new Error(`Steer continuation already opened for session ${sessionId}`)
    const reservation = transition.reservation
    const steerMessage = transition.inputs[0]?.message ?? createSyntheticUserMessage(entry.conversation.id)
    return {
      kind: AgentConversationRuntimeTurnKind.NativeContinuation,
      conversation: entry.conversation,
      agentId: entry.agentId,
      modelId: transition.sourceTurn.modelId,
      reasoningEffort: transition.sourceTurn.reasoningEffort,
      fastMode: transition.sourceTurn.fastMode,
      knowledgeBaseIds: transition.sourceTurn.knowledgeBaseIds,
      headless: transition.headless,
      userMessage: steerMessage,
      assistantMessageId: reservation?.assistantMessageId ?? uuidv7(),
      runtimeTurnId: crypto.randomUUID(),
      sourceTurnId: transition.sourceTurn.turnId,
      messageSnapshot:
        reservation?.userMessageId === steerMessage.id
          ? reservation.messageSnapshot
          : (transition.inputs[0]?.messageSnapshot ?? entry.messageSnapshot),
      traceId: entry.sessionTraceId
    }
  }

  async activateConversationRuntimeTurn(
    intent: AgentConversationRuntimeTurnIntent,
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted()
    const entry = this.entries.get(intent.conversation.id)
    if (!entry || !conversationRefsEqual(entry.conversation, intent.conversation)) {
      throw new Error(`Agent Conversation runtime intent is stale for session ${intent.conversation.id}`)
    }
    const generation = entry.resources.generation
    if (intent.kind === AgentConversationRuntimeTurnKind.Autonomous) {
      if (generation.kind !== AgentConnectionResourceKind.AutonomousTurn || generation.turn) {
        throw new Error(`Autonomous Conversation intent was superseded for session ${intent.conversation.id}`)
      }
    } else if (
      generation.kind !== AgentConnectionResourceKind.SteerTransition ||
      generation.continuationTurn ||
      generation.sourceTurn.turnId !== intent.sourceTurnId ||
      generation.inputs[0]?.message.id !== intent.userMessage.id
    ) {
      throw new Error(`Native continuation intent was superseded for session ${intent.conversation.id}`)
    }

    const turn: AgentTurnStreamResource = {
      turnId: intent.runtimeTurnId,
      assistantMessageId: intent.assistantMessageId,
      userMessage: intent.userMessage,
      modelId: intent.modelId,
      messageSnapshot: intent.messageSnapshot,
      reasoningEffort: intent.reasoningEffort,
      knowledgeBaseIds: intent.knowledgeBaseIds,
      fastMode: intent.fastMode,
      activeToolIds: new Set(),
      headless: intent.headless
    }
    this.applyResourceEvent(entry, {
      type:
        intent.kind === AgentConversationRuntimeTurnKind.Autonomous
          ? AgentConnectionResourceEventType.AutonomousTurnCreated
          : AgentConnectionResourceEventType.ContinuationTurnCreated,
      turn
    })
    await this.refreshTurnTraceContext(entry, turn)
    signal.throwIfAborted()
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn) {
      throw new Error(`Agent Conversation runtime intent was superseded for session ${intent.conversation.id}`)
    }
  }

  rejectConversationRuntimeTurn(intent: AgentConversationRuntimeTurnIntent): void {
    const entry = this.entries.get(intent.conversation.id)
    if (!entry || !conversationRefsEqual(entry.conversation, intent.conversation)) return
    const generation = entry.resources.generation
    if (
      intent.kind === AgentConversationRuntimeTurnKind.Autonomous &&
      generation.kind === AgentConnectionResourceKind.AutonomousTurn &&
      !generation.turn
    ) {
      if (!this.suspendedConversationTurnForSession(intent.conversation.id)) {
        this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.AutonomousTurnCleared })
      }
      return
    }
    if (
      intent.kind === AgentConversationRuntimeTurnKind.NativeContinuation &&
      generation.kind === AgentConnectionResourceKind.SteerTransition &&
      !generation.continuationTurn &&
      generation.sourceTurn.turnId === intent.sourceTurnId
    ) {
      void this.closeSession(intent.conversation.id)
    }
  }

  /** Container trace passed to the driver as the connection's traceparent. */
  private sessionTraceContext(
    entry: AgentConnectionEntry,
    modelId: UniqueModelId = entry.modelId
  ): AgentRuntimeTraceContext | undefined {
    const traceId = entry.sessionTraceId
    if (!traceId) return undefined
    return {
      topicId: entry.conversation.id,
      traceId,
      rootSpanId: deriveRootSpanId(traceId),
      sessionId: entry.conversation.id,
      turnId: this.currentTurn(entry)?.turnId ?? '',
      modelName: parseUniqueModelId(modelId).modelId
    }
  }

  private refreshIdleTimer(entry: AgentConnectionEntry): void {
    this.clearIdleTimer(entry)
    if (
      hasAgentConnectionBackgroundWork(entry.resources) ||
      this.resourceStatus(entry) !== AgentConnectionResourceStatus.Idle
    ) {
      return
    }
    entry.idleTimer = setTimeout(() => {
      if (
        !this.isCurrentEntry(entry) ||
        hasAgentConnectionBackgroundWork(entry.resources) ||
        this.resourceStatus(entry) !== AgentConnectionResourceStatus.Idle
      ) {
        return
      }
      const { agentType, lastResumeToken } = entry
      const sessionId = entry.conversation.id
      void this.closeSession(sessionId)
      if (lastResumeToken) {
        runtimeDriverRegistry.getAgentSessionDriver(agentType)?.onSessionIdle?.(sessionId)
      }
    }, DEFAULT_IDLE_TTL_MS)
    entry.idleTimer.unref?.()
  }

  private clearIdleTimer(entry: AgentConnectionEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
  }

  private closeAll(): Promise<void> {
    const closings = [
      ...this.connectionCloses.values().map(({ promise }) => promise),
      ...[...this.entries.keys()].map((sessionId) => this.closeSession(sessionId))
    ]
    return Promise.allSettled(closings).then(() => undefined)
  }

  private closeEntry(entry: AgentConnectionEntry): Promise<void> {
    this.clearIdleTimer(entry)
    for (const accumulator of entry.backgroundFlowAccumulators?.values() ?? []) {
      const parts = accumulator.latest?.parts as CherryMessagePart[] | undefined
      if (!parts) continue
      application
        .get('CacheService')
        .setShared(
          AGENT_SESSION_FLOW_PARTS_CACHE_KEY(entry.conversation.id, accumulator.messageId),
          parts,
          BACKGROUND_FLOW_HANDOFF_TTL_MS
        )
    }
    const backgroundFlowFlush = this.finishBackgroundFlows(entry)
    const currentTurn = this.currentTurn(entry)
    if (currentTurn) this.closeTurn(currentTurn)
    const suspended = this.suspendedConversationTurnForSession(entry.conversation.id)
    if (suspended && suspended.turn !== currentTurn) this.closeTurn(suspended.turn)
    if (suspended) this.suspendedConversationTurns.delete(suspended.suspendEffectId)
    // Compaction-occupancy interruption is projected by the machine's connection-teardown effect.
    this.clearApiRetry(entry)
    // Context usage deliberately survives: unlike its neighbours here it is not per-CLI-process
    // state. No turn can run without a connection, so the last reading stays true until one does.
    application.get('CacheService').deleteShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(entry.conversation.id))
    // The background-task level is per CLI process, so the closing process's set must not outlive it.
    application.get('CacheService').deleteShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.conversation.id))
    application.get('CacheService').deleteShared(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.conversation.id))

    const connection = this.currentConnection(entry)
    const reset = transitionAgentConnectionResource(entry.resources, {
      type: AgentConnectionResourceEventType.Reset
    })
    entry.resources = reset.state
    for (const effect of reset.effects) this.executeResourceEffect(entry, effect)
    entry.connectionLoop = undefined
    this.connectionStarts.delete(entry.conversation.id)

    return Promise.all([backgroundFlowFlush, this.closeRuntimeConnection(connection, entry.conversation.id)]).then(
      () => undefined
    )
  }

  private closeFailedPolicyUpdateConnection(entry: AgentConnectionEntry, connection: AgentRuntimeConnection): void {
    if (this.currentConnection(entry) !== connection) return
    if (this.liveTurn(entry)) {
      // Pause the live turn so the renderer learns it stopped (the abort path then tears the session
      // down via `closeSession`); a failed tighten must not keep streaming under the old policy.
      this.conversationResults.abort(
        { kind: ConversationKind.Agent, id: entry.conversation.id },
        'agent-policy-update-failed'
      )
    }
    this.closeConnectionAsync(entry)
  }

  private closeConnection(entry: AgentConnectionEntry, resetRuntimeState = true): AgentRuntimeConnection | undefined {
    const connection = this.currentConnection(entry)
    if (connection && resetRuntimeState) this.resetConnectionResources(entry, connection)
    if (connection)
      this.applyResourceEvent(entry, { type: AgentConnectionResourceEventType.ConnectionDisconnected, connection })
    entry.connectionLoop = undefined
    return connection
  }

  private closeConnectionAsync(entry: AgentConnectionEntry): void {
    const connection = this.closeConnection(entry)
    void this.closeRuntimeConnection(connection, entry.conversation.id)
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

  private closeCompactionActivity(entry: AgentConnectionEntry): void {
    if (!entry.compactionActivityId) return
    this.conversationResults.closeAgentActivity(entry.conversation.id, entry.compactionActivityId)
    entry.compactionActivityId = undefined
  }

  private closeBackgroundActivity(entry: AgentConnectionEntry): void {
    if (!entry.backgroundActivityId) return
    this.conversationResults.closeAgentActivity(entry.conversation.id, entry.backgroundActivityId)
    entry.backgroundActivityId = undefined
  }

  private closeIdleEntryWhilePaused(entry: AgentConnectionEntry): boolean {
    if (!this.isWriteQuiesced || this.isSessionBusy(entry.conversation.id)) return false
    void this.closeSession(entry.conversation.id)
    return true
  }
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name: unknown }).name === 'AbortError'
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

function normalizeAgentSdkModelAlias(value: string): string {
  return value.trim().replace(/\[1m\]$/, '')
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
