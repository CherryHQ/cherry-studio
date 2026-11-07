import { type Span, SpanStatusCode } from '@opentelemetry/api'
import { isToolUIPart, type UIMessageChunk } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import type { InputState } from '@cherrystudio/agent-runtime'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as childContexts } from '@data/services/AgentSessionContextService'
import { AgentSessionEditError } from '@data/services/AgentSessionEditError'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { aiUsageRecordService, type SourceSnapshot } from '@data/services/AiUsageRecordService'
import { getRetiredAgentSessionMigration } from '@data/services/retiredAgentRuntimeMigration'
import { loggerService } from '@logger'
import { AgentSessionForkOperations } from '@main/ai/agentSession/fork'
import { ProjectionSubscriptions } from '@main/ai/messages/ProjectionSubscriptions'
import type { NotifyChannel } from '@main/ai/runtime/agentMcpServers'
import type { RuntimeForkAnchor } from '@main/ai/runtime/fork'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { serializeError } from '@main/ai/utils/serializeError'
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
import { topicNamingService } from '@main/services/TopicNamingService'
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
import {
  AGENT_SESSION_CLOSING_CACHE_KEY,
  type AgentSessionEditDraft,
  type AgentSessionEditTarget
} from '@shared/ai/agentSessionEdit'
import {
  AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY,
  type AgentSessionSlashCommand
} from '@shared/ai/agentSessionSlashCommands'
import { AGENT_SESSION_TURN_ORIGIN_CACHE_KEY, type AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import type { MessageProjectionUpdate, MessageProjectionView } from '@shared/ai/messageProjection'
import type { AgentEntity, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage, MessageSnapshot } from '@shared/data/types/message'
import {
  createUniqueModelId,
  parseUniqueModelId,
  type ServiceTierSelection,
  type UniqueModelId
} from '@shared/data/types/model'
import { type AgentTaskEventPartData, getKnowledgeBaseIdsFromParts } from '@shared/data/types/uiParts'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { applyTurnInputAttributes, deriveRootSpanId, startAiChildTurnSpan } from '../observability'
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
import type { AiStreamSource, MessageStreamEvent } from '../streamManager'
import {
  finalizeInterruptedParts,
  PersistenceListener,
  type StreamErrorResult,
  type StreamListener,
  type StreamPausedResult,
  TraceFlushListener
} from '../streamManager'
import { type AbortedApproval, type DispatchDecision, toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type { ApprovalRequestedEvent, InProcessUsageContext } from '../types'
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
  getAgentSessionRuntimeNativeTurn,
  getAgentSessionRuntimeReply,
  getAgentSessionRuntimeTurns,
  getAgentSessionRuntimeOccupancy,
  hasAgentSessionRuntimeBackgroundWork,
  hasAgentSessionRuntimeOpenStream,
  isAgentSessionRuntimeAutonomous,
  isAgentSessionRuntimeAwaitingBackground,
  isAgentSessionRuntimeBusy,
  isAgentSessionRuntimeCompacting,
  isAgentSessionRuntimeTransitioning,
  isAgentSessionRuntimeTurnAdmitted,
  isAgentSessionRuntimeTurnLive,
  transitionAgentSessionRuntime,
  willAgentSessionRuntimeContinue
} from './agentSessionRuntimeState'
import { AgentSessionUsageAttribution } from './AgentSessionUsageAttribution'
import { savedChildView } from './ChildThreadProjection'
import { validateEditedInput } from './editInput'
import { AgentSessionMessageBackend } from './persistence/AgentSessionMessageBackend'
import { recoverSessionDeliveries } from './recoverSessionDeliveries'
import { relocateSystemWorkspaces } from './relocateSystemWorkspaces'
import { RootMessageProjection } from './RootMessageProjection'
import { buildAgentSessionTopicId, extractAgentSessionId, isAgentSessionTopic } from './topic'

const logger = loggerService.withContext('AgentSessionRuntimeService')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000
/**
 * Grace period before a session with no remaining warm-lease holders is actually torn down.
 * Absorbs <Activity> tab switches, where the session view releases on hide and re-acquires on
 * show within moments.
 */
const WARM_LEASE_RELEASE_DELAY_MS = 10_000
const CONTEXT_USAGE_REFRESH_THROTTLE_MS = 3_000
/** Shown on a card whose requesting runtime went away before the user could answer it. */
const ABANDONED_APPROVAL_ERROR = 'The runtime connection closed before this request was answered'

function knowledgeScopeEquals(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightIds = new Set(right)
  return left.every((id) => rightIds.has(id))
}

function notifyChannelsEqual(
  left: readonly NotifyChannel[] | undefined,
  right: readonly NotifyChannel[] | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left.length !== right.length) return false
  const rightChannels = new Map(right.map((channel) => [channel.id, channel.type]))
  return left.every((channel) => rightChannels.get(channel.id) === channel.type)
}

export type AgentSessionRuntimeStatus = 'active' | 'idle'
export type AgentSessionRuntimeTerminalStatus = AgentSessionTerminalStatus
export type AgentSessionTurnTerminalEvent = {
  sessionId: string
  assistantMessageId: string
  status: AgentSessionRuntimeTerminalStatus
  boundary: 'turn' | 'row-roll'
}

export interface BeginAgentSessionTurnInput {
  sessionId: string
  topicId: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  reasoningEffort?: ReasoningEffortOption
  serviceTier?: ServiceTierSelection
  fastMode?: boolean
  assistantMessageId: string
  userMessage?: AgentSessionMessageEntity
  headless?: boolean
  /** Undefined resolves the linked source channel; [] intentionally grants no notification recipients. */
  trustedNotifyChannels?: readonly NotifyChannel[]
  /** Container-level OTel trace id (one trace per session); cached on the entry. */
  traceId?: string
  /** Author snapshot (agent + nested model) stamped onto every assistant row this turn produces. */
  messageSnapshot?: MessageSnapshot
  /** Only an untouched session's initial turn may run the two-stage automatic naming flow. */
  shouldAutoName?: boolean
}

export interface AgentSessionRuntimeHandle {
  listeners: StreamListener[]
  turnId: string
  abortController: AbortController
}

export interface OpenAgentSessionTurnStreamInput {
  sessionId: string
  turnId: string
  interactionWindowId?: string
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
  taskIds: readonly string[]
  forkAnchor?: RuntimeForkAnchor
  turnId: string
  /** True when the user message arrived as a steer — admission wraps it in a system-reminder. */
  systemReminder?: boolean
  assistantMessageId: string
  userMessage: AgentSessionMessageEntity
  modelId: UniqueModelId
  /** Immutable author snapshot captured when this exact turn was submitted. */
  messageSnapshot?: MessageSnapshot
  /** Whether this initial turn owns the session's one automatic AI naming attempt. */
  shouldAutoName?: boolean
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  knowledgeBaseIds: readonly string[]
  fastMode: boolean
  abortController: AbortController
  controller?: Pick<ReadableStreamDefaultController<UIMessageChunk>, 'enqueue' | 'error' | 'close'> & {
    message: (parts: CherryUIMessage['parts']) => void
  }
  activeToolIds: Set<string>
  projection?: RootMessageProjection
  parentId?: string
  origin?: AutonomousTurnOrigin
  headless?: boolean
  trustedNotifyChannels?: readonly NotifyChannel[]
}

type PendingAgentSessionTurn = {
  message: AgentSessionMessageEntity
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  knowledgeBaseIds: readonly string[]
  fastMode: boolean
  /** The message arrived mid-turn (steer) — the drained turn wraps it in a system-reminder. */
  steer?: boolean
  /** The follow-up must open a responder-less/headless turn. */
  headless?: boolean
  /** Undefined resolves the linked source channel; [] intentionally grants no notification recipients. */
  trustedNotifyChannels?: readonly NotifyChannel[]
  /** Submit-time author snapshot so a mid-session agent/model change can't restamp the reply. */
  messageSnapshot?: MessageSnapshot
}

type AgentSessionConnectionTarget = AgentSessionRuntimeConnectionTarget & {
  modelId: UniqueModelId
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  fastMode: boolean
}

type RuntimeState = AgentSessionRuntimeState<AgentSessionTurn, PendingAgentSessionTurn>
type RuntimeStateEvent = AgentSessionRuntimeStateEvent<AgentSessionTurn, PendingAgentSessionTurn>

type AgentSessionRuntimeEntry = {
  closing?: true
  interactionWindowId?: string
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
  connectionGeneration?: string
  /** Pending product handoffs outlive the connection that attempted native admission. */
  pendingInputs?: Map<
    string,
    {
      input: AgentRuntimeUserInput
      generation?: string
      contextId?: string
    }
  >
  lastResumeToken?: string
  branchHead?: string
  usageAttribution?: AgentSessionUsageAttribution
  rootProjections?: Map<string, RootMessageProjection>
  idleTimer?: ReturnType<typeof setTimeout>
  /** Throttle stamp for {@link AgentSessionRuntimeService.refreshContextUsageOnDemand}. */
  lastContextUsageRefreshAt?: number
  /** Single-flight marker for context-usage reads on the current connection. */
  contextUsageRefresh?: { connection: AgentRuntimeConnection; pending: boolean }
  /** Synchronous terminal commits; later native changes update these rows directly. */
  persistedMessageIds?: Set<string>
  contextUsageEpoch?: number
  contextUsageModel?: UniqueModelId
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
// Process and prewarm owners must outlive this runtime's shutdown barriers.
@DependsOn([
  'ClaudeCodeProcessManager',
  'ClaudeCodeWarmQueryManager',
  'AutomationReplService',
  'RuntimeActivityService'
])
export class AgentSessionRuntimeService extends BaseService {
  private readonly forks = new AgentSessionForkOperations()
  private readonly failedClosures = new Map<string, Set<AgentRuntimeConnection>>()
  private readonly failedClosureResumeTokens = new WeakMap<AgentRuntimeConnection, string>()
  private readonly pendingEditInputs = new Map<
    Electron.WebContents,
    { counts: Map<string, number>; dispose: () => void }
  >()

  setPendingInputCount(sender: Electron.WebContents, sessionId: string, count: number): void {
    let record = this.pendingEditInputs.get(sender)
    if (!record) {
      if (!count) return
      const onDestroyed = () => this.pendingEditInputs.delete(sender)
      sender.once('destroyed', onDestroyed)
      record = { counts: new Map(), dispose: () => sender.removeListener('destroyed', onDestroyed) }
      this.pendingEditInputs.set(sender, record)
    }
    if (count) record.counts.set(sessionId, count)
    else record.counts.delete(sessionId)
    if (!record.counts.size) {
      record.dispose()
      this.pendingEditInputs.delete(sender)
    }
  }

  assertSessionWritable(sessionId: string): void {
    if (this.forks.edits.has(sessionId) || this.entries.get(sessionId)?.closing) throw new AgentSessionEditError('busy')
  }

  assertSessionEditable(sessionId: string, ownEdit = false): void {
    if (this.failedClosures.has(sessionId)) throw new AgentSessionEditError('close_failed')
    if (!ownEdit) this.assertSessionWritable(sessionId)
    const entry = this.entries.get(sessionId)
    if (
      this.isShuttingDown ||
      this.isWriteQuiesced ||
      this.closingSessions.has(sessionId) ||
      this.connectionAttempts.has(sessionId) ||
      [...this.forks.pending.values()].some((operation) => operation.sourceSessionId === sessionId) ||
      toolApprovalRegistry.hasSession(sessionId) ||
      [...this.pendingEditInputs.values()].some(({ counts }) => counts.has(sessionId)) ||
      (entry &&
        (isAgentSessionRuntimeBusy(entry.runtimeState) || hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)))
    ) {
      throw new AgentSessionEditError('busy')
    }
  }

  async getEditTarget(sessionId: string, messageId: string): Promise<AgentSessionEditDraft> {
    this.assertSessionEditable(sessionId)
    const snapshot = application
      .get('DbService')
      .withWriteTx((tx) => agentSessionMessageService.readEditSnapshotTx(tx, sessionId, messageId))
    const parts = snapshot.user.data.parts ?? []
    await validateEditedInput(parts)
    return { messageId, version: snapshot.version, parts }
  }

  editSession<T>(
    sessionId: string,
    target: AgentSessionEditTarget,
    persist: (tx: DbOrTx, nativeSessionId: string) => T
  ): Promise<T> {
    this.assertSessionEditable(sessionId)
    const editing = this.forks.edit(
      sessionId,
      target,
      async () => {
        this.assertSessionEditable(sessionId, true)
        const entry = this.entries.get(sessionId)
        const connection = entry && this.closeConnection(entry)
        await this.closeRuntimeConnection(connection, sessionId, true)
        await this.closeSession(sessionId)
      },
      persist
    )
    this.syncRuntimeActivity()
    return editing.finally(() => this.syncRuntimeActivity())
  }

  forkSession(sourceSessionId: string, messageId: string): Promise<string> {
    if (this.failedClosures.has(sourceSessionId)) throw new AgentSessionEditError('close_failed')
    this.assertSessionWritable(sourceSessionId)
    if (this.isShuttingDown || this.isWriteQuiesced) return Promise.reject(new Error('Session writes are paused'))
    const forking = this.forks.fork(sourceSessionId, messageId)
    this.syncRuntimeActivity()
    return forking.finally(() => this.syncRuntimeActivity())
  }

  cancelSessionForks(sourceSessionId: string): Promise<void> {
    return this.forks.cancel(sourceSessionId)
  }

  recoverSessionForks(): Promise<void> {
    return this.forks.recover()
  }

  private readonly _onApprovalRequested = new Emitter<ApprovalRequestedEvent>()
  public readonly onApprovalRequested: Event<ApprovalRequestedEvent> = this._onApprovalRequested.event
  private readonly _onTurnTerminal = new Emitter<AgentSessionTurnTerminalEvent>()
  readonly onTurnTerminal: Event<AgentSessionTurnTerminalEvent> = this._onTurnTerminal.event
  private readonly _onRuntimeIdle = new Emitter<{ sessionId: string }>()
  readonly onRuntimeIdle: Event<{ sessionId: string }> = this._onRuntimeIdle.event
  private runtimeActivity?: Disposable
  private readonly entries = new Map<string, AgentSessionRuntimeEntry>()
  private readonly closingSessions = new Map<
    string,
    { promise: Promise<void>; resumeToken?: string; branchHead?: string; entry?: AgentSessionRuntimeEntry }
  >()
  /** Write-quiesce holds (backup restore). Quiesced ⇔ non-empty. Distinct from the BaseService
   *  lifecycle pause — this never touches service state. See `pause()`. */
  private readonly pauseHolds = new Set<symbol>()
  /** In-flight launches registered synchronously by the state-machine schedule effect. */
  private readonly inFlightTurnStarts = new Map<string, Promise<void>>()
  /** Detached-flow finalizers can outlive their runtime entry but still write message parts. */
  private readonly inFlightChildWrites = new Map<Promise<void>, string>()
  /** Async connection resources live outside the pure state; attempt ids reject stale completions. */
  private readonly connectionAttempts = new Map<
    string,
    { id: string; promise: Promise<boolean>; interrupt?: boolean }
  >()
  /** Promise resources for a rebuild-blocked connection; the state only owns the blocked phase. */
  private readonly backgroundWorkWaiters = new Map<
    string,
    { connection: AgentRuntimeConnection; promise: Promise<void>; resolve: () => void }
  >()
  /** Shutdown wins over pause-release compensation (same posture as JobManager). */
  private isShuttingDown = false
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

  protected async onInit(): Promise<void> {
    // Populate the AI runtime driver registry at a controlled lifecycle point (WhenReady, before
    // any agent session runs) instead of relying on an import-time side effect.
    registerRuntimeDrivers()
    const blockedSessions = await relocateSystemWorkspaces()
    await this.forks.recover()

    // Pi execution dies with Main; terminalize its product placeholders while retaining native history.
    // Delivery recovery owns rows with a persisted delivery turn, and other native owners recover separately.
    this.reconcileStalePendingMessages(blockedSessions)
    recoverSessionDeliveries()
    for (const driver of runtimeDriverRegistry.getAgentSessionDrivers()) await driver.recoverSessions?.()

    this.registerDisposable(
      agentService.onAgentUpdated(({ agentId, updates, agent }) => {
        void this.handleAgentUpdated(agentId, updates, agent).catch((error) => {
          logger.warn('Failed to apply live agent policy update', { agentId, error })
        })
      })
    )
    this.registerDisposable(toolApprovalRegistry.onAborted((aborted) => this.retireAbortedApprovalCard(aborted)))
  }

  /**
   * Only `message`-presentation cards need this: they are parked in a row of their own that outlives
   * the turn, so nothing else retires them once their request is aborted.
   */
  private retireAbortedApprovalCard(aborted: AbortedApproval): void {
    if (aborted.presentation !== 'message') return
    try {
      agentSessionMessageService.retireAbandonedApproval(
        aborted.sessionId,
        aborted.approvalId,
        ABANDONED_APPROVAL_ERROR
      )
    } catch (error) {
      logger.warn('Failed to retire an aborted tool-approval card', {
        sessionId: aborted.sessionId,
        approvalId: aborted.approvalId,
        error
      })
    }
  }

  private reconcileStalePendingMessages(protectedSessions = new Set<string>()): void {
    try {
      const stale = agentSessionMessageService
        .findCrashOrphanedAssistantMessages(['pi'])
        .filter((row) => !protectedSessions.has(row.sessionId))
      if (stale.length === 0) return
      const sessionIds = [...new Set(stale.map((message) => message.sessionId))]
      logger.info('Reconciling crash-orphaned pending agent-session messages', {
        count: stale.length,
        sessionCount: sessionIds.length
      })
      // Pending approvals and tool parts lost their in-memory owner; native identities remain valid.
      agentSessionMessageService.resolveCrashOrphanedMessages(
        stale.map(({ id, data }) => ({
          id,
          data: { ...data, parts: finalizeInterruptedParts(data.parts ?? [], 'error') }
        })),
        sessionIds
      )
    } catch (error) {
      logger.error('Failed to reconcile stale pending agent-session messages', { error })
    }
  }

  getLiveAssistantMessageId(sessionId: string): string | undefined {
    const entry = this.entries.get(sessionId)
    return entry ? this.liveTurn(entry)?.assistantMessageId : undefined
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
    this.syncRuntimeActivity()
    for (const effect of transition.effects) this.applyRuntimeStateEffect(entry, effect)
  }

  private syncRuntimeActivity(): void {
    if (
      this.hasBusySessions() ||
      this.forks.pending.size > 0 ||
      [...this.entries.values()].some((entry) => hasAgentSessionRuntimeBackgroundWork(entry.runtimeState))
    ) {
      this.runtimeActivity ??= application.get('RuntimeActivityService').begin('agent:runtime')
    } else {
      this.runtimeActivity?.dispose()
      this.runtimeActivity = undefined
    }
  }

  private applyRuntimeStateEffect(
    entry: AgentSessionRuntimeEntry,
    effect: AgentSessionRuntimeStateEffect<AgentSessionTurn>
  ): void {
    switch (effect.type) {
      case 'suspend-turn':
        this.suspendTurn(entry, effect.turn)
        break
      case 'report-delivery-failure': {
        const manager = application.get('AiStreamManager')
        const error = serializeError(effect.error)
        if (getAgentSessionRuntimeReply(entry.runtimeState, effect.turn)) {
          manager.broadcastTopicError(entry.topicId, effect.turn.modelId, error)
        } else {
          try {
            agentSessionMessageService.markAssistantMessageTerminalError(
              entry.sessionId,
              effect.turn.assistantMessageId
            )
          } catch (persistenceError) {
            logger.warn('Failed to mark unsubmitted reply as error', {
              sessionId: entry.sessionId,
              error: persistenceError
            })
          }
          manager.terminateHeldTopicStream(entry.topicId, effect.turn.modelId, error)
        }
        break
      }
      case 'schedule-launch':
        this.scheduleRuntimeLaunch(entry, effect.target)
        break
      case 'deliver-buffer':
        for (const chunk of effect.chunks) this.enqueueTurnChunk(entry, effect.turn, chunk)
        break
      case 'settle-turn': {
        // Keep ownership until PersistenceListener completes and dispatches turn-terminal.
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

  getExecutionHead(sessionId: string): string | undefined {
    return this.entries.get(sessionId)?.branchHead
  }

  async prepareBranch(sessionId: string, messageId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry?.branchHead || agentSessionMessageService.sharesBranch(sessionId, entry.branchHead, messageId)) return
    this.assertSessionEditable(sessionId)
    await this.closeSession(sessionId)
  }

  beginTurn(input: BeginAgentSessionTurnInput): AgentSessionRuntimeHandle {
    this.assertSessionWritable(input.sessionId)
    const userMessage = input.userMessage ?? createSyntheticUserMessage(input.sessionId)
    const messageSnapshot = input.messageSnapshot ? structuredClone(input.messageSnapshot) : undefined
    const existing = this.entries.get(input.sessionId)
    if (existing && this.runtimeStatus(existing) === 'active') throw new AgentSessionEditError('busy')
    const turn = createSessionTurn({
      taskIds: input.userMessage ? [input.userMessage.id] : [],
      assistantMessageId: input.assistantMessageId,
      userMessage,
      modelId: input.modelId,
      messageSnapshot,
      shouldAutoName: input.shouldAutoName === true,
      reasoningEffort: input.reasoningEffort ?? 'default',
      serviceTier: input.serviceTier ?? 'standard',
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? []) ?? [],
      fastMode: input.fastMode === true,
      headless: input.headless === true,
      trustedNotifyChannels: input.trustedNotifyChannels
    })
    const { turnId } = turn

    // Prewarming can replace the entry while prepareBranch awaits closure, so recheck before reuse.
    if (
      existing &&
      this.runtimeStatus(existing) === 'idle' &&
      existing.branchHead &&
      agentSessionMessageService.sharesBranch(input.sessionId, existing.branchHead, input.assistantMessageId)
    ) {
      this.clearIdleTimer(existing)
      existing.topicId = input.topicId
      existing.sessionTraceId = input.traceId ?? existing.sessionTraceId
      existing.agentId = input.agentId
      existing.agentType = input.agentType
      existing.modelId = input.modelId
      existing.interactionWindowId = undefined
      existing.messageSnapshot = messageSnapshot
      existing.branchHead = input.assistantMessageId
      this.applyRuntimeStateEvent(existing, { type: 'begin-turn', turn, clearQueue: true })
      this.applyRuntimeStateEvent(existing, { type: 'clear-steer-reservation' })

      return {
        listeners: [
          this.createPersistenceListener(existing, turn),
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
      branchHead: input.assistantMessageId,
      topicId: input.topicId,
      sessionTraceId: input.traceId,
      agentId: input.agentId,
      agentType: input.agentType,
      modelId: input.modelId,
      messageSnapshot,
      runtimeState: createAgentSessionRuntimeState(turn),
      pendingInputs: existing?.pendingInputs
    }
    this.entries.set(input.sessionId, entry)
    this.syncRuntimeActivity()

    return {
      listeners: [
        this.createPersistenceListener(entry, turn),
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
  getActiveUsageContext(sessionId: string, responseId?: string): InProcessUsageContext | undefined {
    const entry = this.entries.get(sessionId)
    if (!entry) return undefined
    const execution = entry.runtimeState.execution
    const turn =
      (execution.kind === 'turn' ? execution.reservation : undefined) ??
      getAgentSessionRuntimeNativeTurn(entry.runtimeState)
    const attribution = (entry.usageAttribution ??= new AgentSessionUsageAttribution())
    const correlation = responseId ?? turn?.turnId
    if (turn && correlation && !responseId) this.bindUsage(entry, correlation, turn)
    return {
      agentSessionId: sessionId,
      ...(turn ? { assistantMessageId: turn.assistantMessageId } : {}),
      source:
        sourceSnapshotFromMessageSnapshot(turn?.messageSnapshot ?? entry.messageSnapshot) ??
        (entry.messageSnapshot ? null : this.captureUsageSource(entry.agentId)),
      ...(correlation ? { recordInvocation: attribution.capture(correlation) } : {})
    }
  }

  private bindUsage(entry: AgentSessionRuntimeEntry, responseId: string, turn: AgentSessionTurn): void {
    ;(entry.usageAttribution ??= new AgentSessionUsageAttribution()).bind(responseId, turn.assistantMessageId, () => {
      const reply = getAgentSessionRuntimeReply(entry.runtimeState, turn)
      return (
        entry.persistedMessageIds?.has(turn.assistantMessageId) === true ||
        (reply !== undefined && reply.delivery.kind !== 'reserved' && reply.delivery.kind !== 'failed')
      )
    })
  }

  private captureUsageSource(agentId: string): SourceSnapshot | null {
    const agent = agentService.getAgent(agentId)
    return agent
      ? { type: 'agent', id: agent.id, name: agent.name ?? null, icon: agent.configuration?.avatar ?? null }
      : null
  }

  private reserveSteerContinuation(
    entry: AgentSessionRuntimeEntry,
    inputs: AgentRuntimeUserInput[]
  ): AgentSessionTurn | undefined {
    if (!this.isCurrentEntry(entry)) return undefined
    const execution = entry.runtimeState.execution
    const reserved =
      execution.kind === 'turn'
        ? execution.reservation
        : execution.kind === 'steer-transition'
          ? execution.reply.turn
          : undefined
    if (reserved) {
      reserved.taskIds = [...new Set([...reserved.taskIds, ...inputs.map(({ message }) => message.id)])]
      return reserved
    }
    const source = this.currentTurn(entry)
    const input = inputs[0]
    if (!source || !input) return undefined
    const turn = createSessionTurn({
      taskIds: inputs.map(({ message }) => message.id),
      userMessage: input.message,
      parentId: input.message.id,
      modelId: source.modelId,
      messageSnapshot: input.messageSnapshot ?? entry.messageSnapshot,
      reasoningEffort: source.reasoningEffort,
      serviceTier: source.serviceTier,
      knowledgeBaseIds: source.knowledgeBaseIds,
      fastMode: source.fastMode,
      headless: source.headless === true && inputs.every((item) => item.headless === true),
      trustedNotifyChannels: source.trustedNotifyChannels
    })
    if (execution.kind === 'turn') this.applyRuntimeStateEvent(entry, { type: 'reserve-steer', reservation: turn })
    return turn
  }

  /**
   * Open the session's runtime connection ahead of the first turn (on session open) so the driver's
   * slash-command catalog (`query.supportedCommands()`) is read into the shared cache before the user
   * types — the SDK warm-query handle can't expose commands without a live connection. Best-effort and
   * idempotent: an existing entry (idle-warm or mid-turn) is just kept connected; a freshly primed
   * entry idles under the same TTL as a post-turn one, so it self-tears-down if never used.
   */
  async primeConnection(sessionId: string): Promise<void> {
    if (this.forks.edits.has(sessionId)) return
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
      if (agent.type === 'claude-code' && application.get('ClaudeCodeBinaryService').getStatus().phase !== 'ready')
        return
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
        branchHead: agentSessionMessageService.captureHead(sessionId),
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
      if (agent.model && entry.modelId !== agent.model) {
        entry.modelId = agent.model
        this.invalidateContextUsage(entry)
      }
      reconciles.push(this.reconcileEntryConnection(entry, agent))
    }
    await Promise.all(reconciles)
  }

  private async reconcileEntryConnection(entry: AgentSessionRuntimeEntry, agent?: AgentEntity): Promise<void> {
    const connection = this.currentConnection(entry)
    if (!connection) return

    let verdict: AgentRuntimeReconcileResult
    try {
      verdict = await connection.reconcile(this.connectionTarget(entry, agent))
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

  openTurnStream(input: OpenAgentSessionTurnStreamInput): AiStreamSource {
    const entry = this.entries.get(input.sessionId)
    const turn = entry ? this.currentTurn(entry) : undefined
    if (!entry || entry.closing || !turn || turn.turnId !== input.turnId) {
      throw new Error(`No active agent runtime turn ${input.turnId} for session ${input.sessionId}`)
    }
    if (input.interactionWindowId) entry.interactionWindowId = input.interactionWindowId

    const start = async (controller: NonNullable<AgentSessionTurn['controller']>) => {
      try {
        this.clearIdleTimer(entry)
        turn.controller = controller
        this.applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn })
        if (turn.projection) this.publishTurnMessage(entry, turn, turn.projection.parts(turn.assistantMessageId) ?? [])

        // Durable shutdown preserves work; user Stop must record cancellation before closing.
        const onAbort = () =>
          void this.closeSession(entry.sessionId, !this.isShuttingDown && input.signal.reason !== 'app-shutdown')
        if (input.signal.aborted) {
          onAbort()
          return
        } else {
          input.signal.addEventListener('abort', onAbort, { once: true })
        }

        controller.enqueue({ type: 'start' })
        // A steer/autonomous transition owns any chunks that arrived before this controller. The
        // state transition atomically transfers that buffer to this exact turn before admission.
        this.applyRuntimeStateEvent(entry, { type: 'flush-transition', turn })
        if (!this.isTurnLive(entry, turn)) return
        const connected = await this.ensureConnection(entry)
        if (!connected || !this.isCurrentEntry(entry) || !this.isTurnLive(entry, turn)) return
        await this.admitTurn(entry, turn)
      } catch (error) {
        controller.error(error)
      }
    }
    const cancel = () => {
      // Routed through the machine so the settle is a real transition (`awaiting-persistence`)
      // rather than an out-of-band mutation the busy/live queries cannot see.
      this.applyRuntimeStateEvent(entry, { type: 'runtime-terminal', turn, outcome: { status: 'paused' } })
    }
    return {
      kind: 'messages',
      stream: new ReadableStream<MessageStreamEvent>({
        start: (controller) =>
          start({
            enqueue: (chunk) => controller.enqueue({ type: 'control', chunk }),
            message: (parts) => controller.enqueue({ type: 'message', parts }),
            close: () => controller.close(),
            error: (error) => {
              controller.enqueue({ type: 'error', error })
              controller.close()
            }
          }),
        cancel
      })
    }
  }

  enqueueUserMessage(
    sessionId: string,
    message: AgentSessionMessageEntity,
    opts: {
      headless?: boolean
      trustedNotifyChannels?: readonly NotifyChannel[]
      messageSnapshot?: MessageSnapshot
      reasoningEffort?: ReasoningEffortOption
      serviceTier?: ServiceTierSelection
      fastMode?: boolean
    } = {}
  ): void {
    this.assertSessionWritable(sessionId)
    const entry = this.entries.get(sessionId)
    if (!entry || entry.pendingInputs?.has(message.id)) return

    this.clearIdleTimer(entry)
    // Capture before redirect: the native placement hook can run synchronously.
    const headless = opts.headless === true
    const trustedNotifyChannels = opts.trustedNotifyChannels
    const messageSnapshot = opts.messageSnapshot ? structuredClone(opts.messageSnapshot) : undefined
    const reasoningEffort = opts.reasoningEffort ?? 'default'
    const serviceTier = opts.serviceTier ?? 'standard'
    const knowledgeBaseIds = getKnowledgeBaseIdsFromParts(message.data.parts ?? []) ?? []
    const fastMode = opts.fastMode === true

    const turn = this.currentTurn(entry)
    // Open normal turn + a backend that can steer → inject into the running turn (claude's PreToolUse steer
    // hook): the steer is folded into the current turn — no new turn, no queue entry. If the turn
    // ends before it's injected, the connection emits `steer-undelivered` and we queue it below.
    // The gate compares the live turn's frozen model/reasoning/Fast/knowledge config with the incoming
    // message: a changed effective connection scope must queue as the NEXT turn instead of being
    // folded into a query already running with different tools.
    const configuredKnowledgeBaseIds = agentService.getAgent(entry.agentId)?.knowledgeBaseIds
    const canRedirectOnCurrentConfig =
      turn?.modelId === entry.modelId &&
      turn.reasoningEffort === reasoningEffort &&
      turn.serviceTier === serviceTier &&
      turn.fastMode === fastMode &&
      knowledgeScopeEquals(
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, turn.knowledgeBaseIds),
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, knowledgeBaseIds)
      )
    if (
      entry.runtimeState.execution.kind === 'turn' &&
      entry.runtimeState.execution.reply.delivery.kind === 'open' &&
      turn &&
      this.isTurnLive(entry, turn) &&
      turn.headless !== true &&
      !headless &&
      canRedirectOnCurrentConfig
    ) {
      const input: AgentRuntimeUserInput = {
        message: structuredClone(message),
        systemReminder: true,
        headless,
        ...(messageSnapshot ? { messageSnapshot } : {})
      }
      const pending = (entry.pendingInputs ??= new Map())
      if (pending.has(message.id)) return
      pending.set(message.id, { input, generation: entry.connectionGeneration })
      if (this.currentConnection(entry)?.redirect?.({ message: input.message, systemReminder: true })) return
      pending.delete(message.id)
    }

    // No redirect-eligible open normal turn (or backend can't steer) → queue as the next turn,
    // wrapped in a steer system-reminder.
    this.applyRuntimeStateEvent(entry, {
      type: 'queue-turn',
      turn: {
        message,
        reasoningEffort,
        serviceTier,
        knowledgeBaseIds,
        fastMode,
        steer: true,
        ...(headless ? { headless } : {}),
        ...(trustedNotifyChannels !== undefined ? { trustedNotifyChannels } : {}),
        ...(messageSnapshot ? { messageSnapshot } : {})
      }
    })
  }

  markTurnTerminal(sessionId: string, status: AgentSessionRuntimeTerminalStatus, expectedTurnId?: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      this._onRuntimeIdle.fire({ sessionId })
      return
    }
    const completedTurn = expectedTurnId
      ? getAgentSessionRuntimeTurns(entry.runtimeState).find((turn) => turn.turnId === expectedTurnId)
      : this.currentTurn(entry)
    if (!completedTurn || entry.closing) return
    const reply = getAgentSessionRuntimeReply(entry.runtimeState, completedTurn)
    if (!reply || ['suspending', 'settled', 'failed'].includes(reply.delivery.kind)) return
    const isRowRoll =
      entry.runtimeState.execution.kind === 'steer-transition' &&
      entry.runtimeState.execution.source.turn === completedTurn
    this.applyRuntimeStateEvent(entry, { type: 'turn-terminal', turn: completedTurn, status })
    this._onTurnTerminal.fire({
      sessionId,
      assistantMessageId: completedTurn.assistantMessageId,
      status,
      boundary: isRowRoll ? 'row-roll' : 'turn'
    })
    this.refreshIdleTimer(entry)
    if (!this.isSessionBusy(sessionId)) this._onRuntimeIdle.fire({ sessionId })
  }

  closeSession(sessionId: string, interrupt = false): Promise<void> {
    const attempt = this.connectionAttempts.get(sessionId)
    if (interrupt && attempt) attempt.interrupt = true
    const priorClosing = this.closingSessions.get(sessionId)
    const entry = this.entries.get(sessionId)
    if (!entry) return priorClosing?.promise ?? Promise.resolve()
    if (priorClosing?.entry === entry) return priorClosing.promise
    const closing = this.closeEntry(entry, interrupt)
      .then(() => {
        entry.usageAttribution?.close()
        if (this.entries.get(sessionId) === entry && !entry.pendingInputs?.size) {
          this.entries.delete(sessionId)
          this._onRuntimeIdle.fire({ sessionId })
        }
      })
      .catch((error) => {
        logger.warn('Agent session close retained unpersisted reply state', { sessionId, error })
        throw error
      })
    const barrier = this.trackSessionClosing(sessionId, closing, entry.lastResumeToken, entry.branchHead, entry)

    return barrier
  }

  async closeSessionForArchive(sessionId: string): Promise<void> {
    await this.closeSession(sessionId)
    await application.get('ClaudeCodeWarmQueryManager').close(sessionId)
    const attempt = this.connectionAttempts.get(sessionId)?.promise
    if (attempt) await attempt
    while (this.closingSessions.has(sessionId)) {
      await this.closingSessions.get(sessionId)!.promise
    }
    const failed = this.failedClosures.get(sessionId)
    if (this.entries.has(sessionId)) throw new AgentSessionEditError('close_failed')
    for (const connection of failed ?? []) await this.closeRuntimeConnection(connection, sessionId, true)
    if (this.failedClosures.has(sessionId) || this.entries.has(sessionId) || this.connectionAttempts.has(sessionId)) {
      throw new AgentSessionEditError('close_failed')
    }
  }

  private trackSessionClosing(
    sessionId: string,
    closing: Promise<void>,
    resumeToken?: string,
    branchHead?: string,
    entry?: AgentSessionRuntimeEntry
  ): Promise<void> {
    const priorClosing = this.closingSessions.get(sessionId)
    const barrier = {
      entry: entry ?? priorClosing?.entry,
      promise: Promise.allSettled(priorClosing ? [priorClosing.promise, closing] : [closing]).then(() => {
        if (this.closingSessions.get(sessionId) === barrier) {
          this.closingSessions.delete(sessionId)
          this.publishSessionClosing(sessionId, false)
        }
        this.syncRuntimeActivity()
      }),
      branchHead: resumeToken ? branchHead : priorClosing?.branchHead,
      resumeToken: resumeToken ?? priorClosing?.resumeToken
    }
    this.closingSessions.set(sessionId, barrier)
    this.publishSessionClosing(sessionId, true)
    this.syncRuntimeActivity()
    return barrier.promise
  }

  private publishSessionClosing(sessionId: string, closing: boolean): void {
    try {
      application.get('CacheService').setShared(AGENT_SESSION_CLOSING_CACHE_KEY(sessionId), closing)
    } catch (error) {
      // Cache broadcast failures must not interrupt session teardown.
      logger.warn('Failed to publish agent session closing state', error as Error, { sessionId })
    }
  }

  /**
   * Release a connection opened by {@link primeConnection} (or left idle after a turn) when its
   * session view closes — frees the subprocess and clears the cached catalog now instead of waiting
   * out the idle TTL. No-op while a turn is in flight or background work still owns connection-local
   * resources. Background keepalive is deliberately not "busy": a new user turn may still start.
   */
  releaseIdleConnection(sessionId: string): void {
    const idleEntry = this.entries.get(sessionId)
    if (idleEntry && this.currentConnection(idleEntry)?.retainWhileIdle) return
    if (idleEntry && hasAgentSessionRuntimeBackgroundWork(idleEntry.runtimeState)) return
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
    for (const record of this.pendingEditInputs.values()) record.dispose()
    this.pendingEditInputs.clear()
    for (const timer of this.pendingWarmTeardowns.values()) clearTimeout(timer)
    this.pendingWarmTeardowns.clear()
    for (const record of this.warmLeaseSenders.values()) record.dispose()
    this.warmLeaseSenders.clear()
    this.warmLeaseHolders.clear()
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
    if (this.forks.edits.has(sessionId)) return true
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    return entry.closing === true || isAgentSessionRuntimeBusy(entry.runtimeState)
  }

  isSessionBusyForArchive(sessionId: string): boolean {
    const entry = this.entries.get(sessionId)
    return this.isSessionBusy(sessionId) || Boolean(entry && hasAgentSessionRuntimeBackgroundWork(entry.runtimeState))
  }

  /** Turn-local notification authority. Undefined lets the resolver use the linked source channel. */
  getTurnTrustedNotifyChannels(sessionId: string): readonly NotifyChannel[] | undefined {
    const entry = this.entries.get(sessionId)
    if (!entry || entry.runtimeState.execution.kind === 'idle') return undefined
    return this.connectionTarget(entry).trustedNotifyChannels
  }

  /** Whether any agent session can still mutate its DB row or external runtime files. */
  hasBusySessions(): boolean {
    if (this.forks.edits.size || this.failedClosures.size) return true
    if (this.closingSessions.size > 0) return true
    if (this.inFlightChildWrites.size > 0) return true
    for (const sessionId of this.entries.keys()) {
      if (this.isSessionBusyForArchive(sessionId)) return true
    }
    return false
  }

  /** Connections without confirmed teardown still own their runtime transcripts. */
  listClaimedResumeTokens(): ReadonlySet<string> {
    const claimedResumeTokens = new Set<string>()
    for (const entry of this.entries.values()) {
      if (entry.lastResumeToken) claimedResumeTokens.add(entry.lastResumeToken)
    }
    for (const closing of this.closingSessions.values()) {
      if (closing.resumeToken) claimedResumeTokens.add(closing.resumeToken)
    }
    for (const connections of this.failedClosures.values()) {
      for (const connection of connections) {
        const resumeToken = this.failedClosureResumeTokens.get(connection)
        if (resumeToken) claimedResumeTokens.add(resumeToken)
      }
    }
    return claimedResumeTokens
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
    if (!entry || entry.closing) return undefined
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
   * child input/native archive writes, detached-flow finalizers, and runtime close barriers.
   * Bounded by timeoutMs; never rejects and does not abort stragglers.
   * The resulting stream writes are AiStreamManager's drain — this only covers the windows this
   * service writes in.
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
    const drainedConnections = new Set<AgentRuntimeConnection>()
    const failed = new Set<string>()
    const pending = new Map<Promise<unknown>, string>()
    const collect = (): void => {
      for (const fork of this.forks.pending.values()) {
        if (seen.has(fork.promise)) continue
        seen.add(fork.promise)
        pending.set(fork.promise, fork.sourceSessionId)
        const remove = () => pending.delete(fork.promise)
        fork.promise.then(remove, remove)
      }
      for (const [sessionId, launch] of this.inFlightTurnStarts) {
        if (seen.has(launch)) continue
        seen.add(launch)
        pending.set(launch, sessionId)
        const remove = () => pending.delete(launch)
        launch.then(remove, remove)
      }
      for (const [writing, sessionId] of this.inFlightChildWrites) {
        if (seen.has(writing)) continue
        seen.add(writing)
        pending.set(writing, sessionId)
        const remove = () => pending.delete(writing)
        writing.then(remove, remove)
      }
      for (const [sessionId, entry] of this.entries) {
        const connection = this.currentConnection(entry)
        if (!connection?.drainChildWrites || drainedConnections.has(connection)) continue
        drainedConnections.add(connection)
        const inputs = [...this.inFlightChildWrites].filter(([, owner]) => owner === sessionId).map(([work]) => work)
        const writing = Promise.allSettled(inputs).then(() => connection.drainChildWrites!())
        pending.set(writing, sessionId)
        void writing.then(
          () => pending.delete(writing),
          (error) => {
            failed.add(sessionId)
            pending.delete(writing)
            logger.warn('Failed to drain child writes', { sessionId, error })
          }
        )
      }
      for (const [sessionId, closing] of this.closingSessions) {
        if (seen.has(closing.promise)) continue
        seen.add(closing.promise)
        pending.set(closing.promise, sessionId)
        const remove = () => pending.delete(closing.promise)
        closing.promise.then(remove, remove)
      }
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), opts.timeoutMs)
    })
    try {
      for (;;) {
        collect()
        if (pending.size === 0) {
          const retained = [...this.entries]
            .filter(
              ([, entry]) =>
                entry.closing ||
                getAgentSessionRuntimeTurns(entry.runtimeState).some(
                  (turn) => getAgentSessionRuntimeReply(entry.runtimeState, turn)?.delivery.kind === 'failed'
                )
            )
            .map(([sessionId]) => sessionId)
          return { stragglerIds: [...new Set([...failed, ...retained, ...this.failedClosures.keys()])] }
        }
        const winner = await Promise.race([
          Promise.allSettled([...pending.keys()]).then(() => 'done' as const),
          timeout
        ])
        if (winner === 'timeout') {
          const stragglerIds = [...new Set([...pending.values(), ...failed])]
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
    const activeSessionIds = new Set<string>()
    for (const [sessionId, entry] of this.entries) {
      if (!this.isSessionBusyForArchive(sessionId)) continue
      activeSessionIds.add(sessionId)
      const turn = this.liveTurn(entry) ? 'live' : '-'
      work.push({
        id: sessionId,
        summary: `turn=${turn} pending=${entry.runtimeState.queue.length} execution=${entry.runtimeState.execution.kind} compacting=${isAgentSessionRuntimeCompacting(entry.runtimeState)} launch=${entry.runtimeState.launch.kind}`
      })
    }
    for (const sessionId of this.closingSessions.keys()) {
      if (!activeSessionIds.has(sessionId)) work.push({ id: sessionId, summary: 'closing=true' })
    }
    for (const operation of this.forks.pending.values()) {
      work.push({ id: operation.sourceSessionId, summary: 'forking=true' })
    }
    for (const sessionId of new Set(this.inFlightChildWrites.values())) {
      if (!activeSessionIds.has(sessionId)) work.push({ id: sessionId, summary: 'child-input=true' })
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
  respondToolApproval(approvalId: string, decision: DispatchDecision, anchorId?: string, topicId?: string): boolean {
    const pending = toolApprovalRegistry.peek(approvalId)
    if (!pending) {
      // The requesting runtime is gone (connection torn down, app restart), so this decision can
      // never reach it. Settle the card with the decision the user actually made so it stops being
      // offered; the renderer re-delivers a submitted answer as the session's next message.
      if (anchorId && topicId && isAgentSessionTopic(topicId)) {
        agentSessionMessageService.applyToolApprovalDecision(extractAgentSessionId(topicId), anchorId, {
          approvalId,
          approved: decision.approved,
          ...(decision.reason !== undefined && { reason: decision.reason }),
          ...(decision.updatedInput !== undefined && { updatedInput: decision.updatedInput })
        })
      }
      return false
    }

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

    // A refusal that arrived here is the user's own answer, so drivers may attribute it to them.
    // Registry/abort denials reach dispatch() directly and stay unmarked.
    const dispatched = toolApprovalRegistry.dispatch(
      approvalId,
      decision.approved ? decision : { ...decision, reasonSource: 'user' }
    )
    if (!dispatched) return false

    if (dispatched.presentation === 'stream') {
      application
        .get('AiStreamManager')
        .resolveToolApproval(buildAgentSessionTopicId(dispatched.sessionId), dispatched.toolCallId, decision.approved)
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

  private readonly childSubscriptions = new ProjectionSubscriptions()

  detachChild(sender: Electron.WebContents, id: string): void {
    this.childSubscriptions.detach(sender, id)
  }

  attachChild(
    sender: Electron.WebContents,
    sessionId: string,
    toolCallId: string,
    id: string,
    send: (update: MessageProjectionUpdate) => void
  ): Promise<MessageProjectionView | null> {
    return this.childSubscriptions.attach(
      sender,
      id,
      async () => {
        await this.primeConnection(sessionId)
        const entry = this.entries.get(sessionId)
        let connection: AgentRuntimeConnection | undefined
        try {
          if (entry && (await this.ensureConnection(entry))) connection = this.currentConnection(entry)
        } catch (error) {
          logger.warn('Failed to connect child subscriber', { sessionId, error })
        }
        if (entry && this.entries.get(sessionId) !== entry) return null
        const child = await connection?.childProjection?.(toolCallId)
        if (entry && (this.entries.get(sessionId) !== entry || this.currentConnection(entry) !== connection))
          return null
        if (child) return child
        const context = childContexts.findChild(sessionId, toolCallId)
        if (!context) return null
        const view = savedChildView(context)
        return { snapshot: () => view, subscribe: () => () => {} }
      },
      send
    )
  }

  async messageChild(sessionId: string, contextId: string, text: string): Promise<void> {
    if (this.isShuttingDown || this.isWriteQuiesced) throw new Error('Session writes are paused')
    const entry = this.entries.get(sessionId)
    const connection = entry && this.currentConnection(entry)
    if (!connection?.messageChild) throw new Error('Child native owner is unavailable')
    const writing = Promise.resolve().then(() => connection.messageChild!(contextId, text))
    this.inFlightChildWrites.set(writing, sessionId)
    this.syncRuntimeActivity()
    try {
      await writing
    } finally {
      this.inFlightChildWrites.delete(writing)
      this.syncRuntimeActivity()
    }
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
    await this.forks.cancel()
    this.disposeWarmLeases()
    const streamManager = application.get('AiStreamManager')
    for (const entry of this.entries.values()) {
      if (this.liveTurn(entry)) streamManager.abort(entry.topicId, 'agent-session-runtime-stop')
    }
    try {
      toolApprovalRegistry.clear('agent-session-runtime-stop')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during stop', { error })
    }
    await this.closeAll()
  }

  protected async onDestroy(): Promise<void> {
    this.childSubscriptions.dispose()
    await this.forks.cancel()
    this._onApprovalRequested.dispose()
    this.disposeWarmLeases()
    await this.closeAll()
    try {
      toolApprovalRegistry.clear('agent-session-runtime-destroy')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during destroy', { error })
    }
    this._onTurnTerminal.dispose()
    this._onRuntimeIdle.dispose()
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
   * the connection follows the agent's latest model and its configured reasoning effort — the same
   * fallback a fresh turn takes (`AgentChatContextProvider`), so an idle reconcile finds no drift.
   *
   * The turn's Fast and knowledge selections are frozen for exactly the same reason and on the same schedule.
   * Note the idle branch's `knowledgeBaseIds: []` means "no per-turn composer selection", NOT "no
   * knowledge": it is fed through `resolveKnowledgeBaseScope` against the agent's binding below, so a
   * statically bound agent still serves its full binding while idle. Idle deliberately converges on
   * the agent's own configuration, so any turn that carried a composer selection (an unbound agent's
   * whole scope, or a bound agent's narrowing) costs one rebuild once it goes idle. That is
   * intentional: the next turn's *selection* is unknowable, and prewarm builds binding-only scope
   * too, so pinning the last turn's selection would only move the rebuild onto the next turn that
   * does not repeat it. A configured reasoning effort is not a selection — it is what the next turn
   * uses absent an override — so reading it here is what keeps idle free of permanent drift.
   */
  private connectionTarget(
    entry: AgentSessionRuntimeEntry,
    // `agentService.getAgent` is four queries (the row, its MCPs, its knowledge bases, the model
    // name) and is not cached, so a caller that already holds the agent hands it over rather than
    // paying for it again. The push reconcile is the one that matters: it walks every session of
    // one agent and already has the updated entity.
    agent: AgentEntity | null = agentService.getAgent(entry.agentId)
  ): AgentSessionConnectionTarget {
    const turn = this.currentTurn(entry)
    const live =
      turn &&
      (this.isTurnLive(entry, turn) ||
        isAgentSessionRuntimeTransitioning(entry.runtimeState) ||
        hasAgentSessionRuntimeBackgroundWork(entry.runtimeState))
    return live
      ? {
          modelId: turn.modelId,
          reasoningEffort: turn.reasoningEffort,
          serviceTier: turn.serviceTier,
          knowledgeBaseIds: turn.knowledgeBaseIds,
          fastMode: turn.fastMode,
          trustedNotifyChannels: turn.trustedNotifyChannels
        }
      : {
          modelId: entry.modelId,
          reasoningEffort: agent?.configuration?.reasoning_effort ?? 'default',
          serviceTier: 'standard',
          knowledgeBaseIds: [],
          fastMode: false,
          trustedNotifyChannels: undefined
        }
  }

  private connectionTargetEquals(entry: AgentSessionRuntimeEntry, target: AgentSessionConnectionTarget): boolean {
    const agent = agentService.getAgent(entry.agentId)
    const current = this.connectionTarget(entry, agent)
    const configuredKnowledgeBaseIds = agent?.knowledgeBaseIds
    return (
      current.modelId === target.modelId &&
      current.reasoningEffort === target.reasoningEffort &&
      current.serviceTier === target.serviceTier &&
      current.fastMode === target.fastMode &&
      knowledgeScopeEquals(
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, current.knowledgeBaseIds),
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, target.knowledgeBaseIds)
      ) &&
      notifyChannelsEqual(current.trustedNotifyChannels, target.trustedNotifyChannels)
    )
  }

  private async ensureConnection(entry: AgentSessionRuntimeEntry): Promise<boolean> {
    entry.branchHead ??= agentSessionMessageService.captureHead(entry.sessionId)
    while (this.isCurrentEntry(entry)) {
      if (entry.closing) return false
      this.assertSessionWritable(entry.sessionId)
      const closing = this.closingSessions.get(entry.sessionId)
      if (closing) {
        await closing.promise
        if (
          this.isCurrentEntry(entry) &&
          !entry.lastResumeToken &&
          closing.resumeToken &&
          closing.branchHead &&
          agentSessionMessageService.sharesBranch(entry.sessionId, entry.branchHead, closing.branchHead)
        ) {
          entry.lastResumeToken = closing.resumeToken
        }
        continue
      }

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
        if (!this.isCurrentEntry(entry) || entry.closing) return false
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
      entry.connectionGeneration = attemptId
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
      serviceTier: target.serviceTier,
      knowledgeBaseIds: target.knowledgeBaseIds,
      fastMode: target.fastMode,
      resumeToken: entry.lastResumeToken,
      trace: this.sessionTraceContext(entry, target.modelId),
      nativeSessionId: agentSessionMessageService.getNativeSessionId(entry.sessionId, entry.branchHead),
      branchHead: entry.branchHead,
      onSteerInjected: (inputIds) => {
        if (this.isCurrentGeneration(entry, attemptId))
          this.reserveSteerContinuation(entry, this.pendingInputValues(entry, inputIds))
      },
      onInputPrepared: (inputId, contextId) => {
        if (!this.isCurrentGeneration(entry, attemptId)) return
        const pending = entry.pendingInputs?.get(inputId)
        if (pending?.generation === attemptId) pending.contextId = contextId
      }
    })
    const attempt = this.connectionAttempts.get(entry.sessionId)
    const interrupt = attempt?.id === attemptId && attempt.interrupt
    if (!this.isCurrentEntry(entry) || entry.closing || !this.connectionTargetEquals(entry, target)) {
      await this.closeRuntimeConnection(connection, entry.sessionId, false, interrupt)
      return false
    }

    this.applyRuntimeStateEvent(entry, { type: 'connection-connected', attemptId, connection })
    if (this.currentConnection(entry) !== connection) {
      await this.closeRuntimeConnection(connection, entry.sessionId, false, interrupt)
      return false
    }
    entry.contextUsageModel = target.modelId
    entry.usageCapture = connection.usageCapture
    this.resetConnectionRuntimeState(entry, connection)
    // Priming opens an idle connection only to populate connection-local metadata such as slash
    // commands. Context usage is expensive (the SDK issues multiple token-count probes), so defer it
    // until a real turn, a runtime event, or an explicit UI refresh needs a reading.
    if (this.runtimeStatus(entry) === 'active') this.refreshContextUsage(entry, connection)
    this.refreshSupportedCommands(entry, connection)
    const connectionLoop = this.runConnectionLoop(entry, connection).finally(() => {
      if (this.isCurrentEntry(entry) && this.currentConnection(entry) === connection && !entry.closing) {
        void this.closeRuntimeConnection(connection, entry.sessionId)
        this.resetConnectionRuntimeState(entry, connection)
        this.applyRuntimeStateEvent(entry, { type: 'connection-disconnected', connection })
        entry.connectionGeneration = undefined
      }
      if (entry.connectionLoop === connectionLoop) entry.connectionLoop = undefined
    })
    entry.connectionLoop = connectionLoop
    await this.reconcilePendingInputs(entry, connection, attemptId)
    return this.isCurrentGeneration(entry, attemptId) && this.currentConnection(entry) === connection
  }

  private isCurrentGeneration(entry: AgentSessionRuntimeEntry, generation: string): boolean {
    return this.isCurrentEntry(entry) && entry.connectionGeneration === generation
  }

  private pendingInputValues(
    entry: AgentSessionRuntimeEntry,
    ids: readonly string[],
    take = false
  ): AgentRuntimeUserInput[] {
    const inputs: AgentRuntimeUserInput[] = []
    for (const id of ids) {
      const pending = entry.pendingInputs?.get(id)
      if (!pending || pending.generation !== entry.connectionGeneration) continue
      inputs.push(pending.input)
      if (take) entry.pendingInputs!.delete(id)
    }
    return inputs
  }

  private resolvePendingInput(entry: AgentSessionRuntimeEntry, contextId: string, input: InputState): void {
    const inputId =
      input.inputId ??
      (input.nativeInput && agentSessionMessageService.inputMessageId(entry.sessionId, contextId, input.nativeInput.id))
    const pending = inputId && entry.pendingInputs?.get(inputId)
    if (!pending || pending.contextId !== contextId) return
    if (pending.generation === entry.connectionGeneration && input.facts.includes('placed')) return
    if (input.outcome || input.facts.includes('locally-handled')) {
      entry.pendingInputs!.delete(inputId)
      logger.info('Pending native input resolved', {
        sessionId: entry.sessionId,
        inputId,
        outcome: input.outcome ?? 'locally-handled'
      })
    }
  }

  private async reconcilePendingInputs(
    entry: AgentSessionRuntimeEntry,
    connection: AgentRuntimeConnection,
    generation: string
  ): Promise<void> {
    if (!connection.lookupInput) return
    for (const [inputId, pending] of entry.pendingInputs ?? []) {
      if (pending.generation === generation || !pending.contextId) continue
      let result: Awaited<ReturnType<NonNullable<AgentRuntimeConnection['lookupInput']>>>
      try {
        result = await connection.lookupInput(pending.contextId, inputId)
      } catch (error) {
        logger.warn('Pending native input lookup failed', { sessionId: entry.sessionId, inputId, error })
        continue
      }
      if (!this.isCurrentGeneration(entry, generation) || this.currentConnection(entry) !== connection) return
      if (result.status === 'confirmed' && result.value.found)
        this.resolvePendingInput(entry, pending.contextId, result.value.input)
      else
        logger.warn('Pending native input remains unresolved', {
          sessionId: entry.sessionId,
          inputId,
          contextId: pending.contextId
        })
    }
  }

  private hydrateResumeToken(entry: AgentSessionRuntimeEntry): void {
    const migration =
      entry.agentType === 'pi'
        ? getRetiredAgentSessionMigration(application.get('DbService').getDb(), entry.sessionId)
        : undefined
    if (migration) {
      // Claim the Pi identity before a retry can finish importing and remove the migration marker.
      entry.lastResumeToken = migration.resumeToken
      return
    }
    const runtimeResumeToken = agentSessionMessageService.getLastRuntimeResumeToken(entry.sessionId, entry.branchHead)
    if (runtimeResumeToken && !entry.lastResumeToken) entry.lastResumeToken = runtimeResumeToken
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
      case 'message-projection': {
        const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        const projection = this.rootProjection(entry, event.projection.contextId)
        if (turn) turn.projection = projection
        const changed = projection.accept(event.projection, turn?.assistantMessageId)
        for (const [id, parts] of changed) this.publishRootMessage(entry, projection, id, parts)
        break
      }
      case 'response-start': {
        const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        if (turn && (!event.messageId || event.messageId === turn.assistantMessageId))
          this.bindUsage(entry, event.responseId, turn)
        else if (event.messageId)
          (entry.usageAttribution ??= new AgentSessionUsageAttribution()).bind(event.responseId, event.messageId)
        break
      }
      case 'resume-token':
        entry.lastResumeToken = event.token
        if (this.runtimeStatus(entry) === 'active') this.refreshContextUsage(entry)
        break
      case 'chunk': {
        // Any content chunk means the retried request succeeded and the stream resumed — clear the
        // ephemeral retry status (backoff windows produce no chunks, so this never fires mid-retry).
        this.clearApiRetry(entry)
        this.deliverRuntimeChunk(entry, event.chunk)
        break
      }
      case 'tool-approval-request':
        this.handleToolApprovalRequest(entry, event.request)
        break
      case 'usage':
        this.recordRuntimeUsage(entry, event.invocation)
        break
      case 'input-submission': {
        const pending = entry.pendingInputs?.get(event.result.inputId)
        if (!pending || pending.generation !== entry.connectionGeneration || pending.contextId !== event.contextId)
          break
        if (event.result.status === 'rejected' || event.result.status === 'unsupported')
          this.handleRuntimeEvent(entry, { type: 'steer-undelivered', inputIds: [event.result.inputId] }, connection)
        else if (event.result.status === 'acknowledged' && event.result.facts.includes('locally-handled'))
          entry.pendingInputs?.delete(event.result.inputId)
        break
      }
      case 'input-state':
        this.resolvePendingInput(entry, event.contextId, event.input)
        break
      case 'steer-boundary': {
        const inputs = this.pendingInputValues(entry, event.inputIds, true)
        if (!inputs.length) break
        const turn = this.reserveSteerContinuation(entry, inputs)
        if (turn) this.applyRuntimeStateEvent(entry, { type: 'steer-boundary', turn })
        break
      }
      case 'steer-undelivered':
        // Steers stashed via redirect() that this turn ended before injecting → queue them as the
        // next turn (with a steer system-reminder). The following `turn-complete` → markTurnTerminal
        // drains the state-machine queue through the queued-turn launch.
        for (const input of this.pendingInputValues(entry, event.inputIds, true)) {
          this.applyRuntimeStateEvent(entry, {
            type: 'queue-turn',
            turn: {
              message: input.message,
              reasoningEffort: this.currentTurn(entry)?.reasoningEffort ?? 'default',
              serviceTier: this.currentTurn(entry)?.serviceTier ?? 'standard',
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
        this.settleCompactionError(
          entry,
          event.aborted || this.currentTurn(entry)?.abortController.signal.aborted ? undefined : event.error
        )
        break
      case 'api-retry':
        this.handleApiRetry(entry, event.retry)
        break
      case 'context-usage':
        this.persistContextUsage(entry, event.result)
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
        if (event.active) this.getMcpInteractionHost(entry.sessionId)
        this.handleBackgroundWorkState(entry, event.active, connection)
        break
      case 'background-results':
        this.handleBackgroundResults(entry, event.result, connection)
        break
      case 'background-task-event':
        this.publishBackgroundTaskEvent(entry, event.data, connection)
        break

      case 'autonomous-turn-state': {
        if (event.state === 'finished') {
          this.handleAutonomousGenerationFinished(entry, connection)
          break
        }
        if (
          event.origin.kind === 'background-work' &&
          this.ownsBackgroundNotification(entry, event.sourceToolCallIds)
        ) {
          this.applyRuntimeStateEvent(entry, { type: 'background-reply-resumed' })
          break
        }
        if (
          entry.runtimeState.execution.kind === 'steer-transition' ||
          entry.runtimeState.execution.kind === 'autonomous-turn'
        )
          break
        const source = this.currentTurn(entry)
        const headless = this.getInteractionState(entry.sessionId).userResponse === 'unavailable'
        const turn = createSessionTurn({
          ...this.connectionTarget(entry),
          taskIds: [],
          userMessage: createSyntheticUserMessage(entry.sessionId),
          parentId: entry.branchHead,
          messageSnapshot: entry.messageSnapshot,
          headless,
          origin: event.origin
        })
        this.clearIdleTimer(entry)
        this.applyRuntimeStateEvent(entry, {
          type: 'autonomous-turn-started',
          turn,
          deferCurrentTurn:
            source !== undefined &&
            (this.isTurnLive(entry, source) ||
              getAgentSessionRuntimeReply(entry.runtimeState, source)?.delivery.kind === 'awaiting-persistence')
        })
        break
      }
      case 'turn-complete': {
        const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        if (turn) {
          turn.forkAnchor = event.forkAnchor
            ? { ...event.forkAnchor, excludedMessageIds: entry.runtimeState.queue.map((item) => item.message.id) }
            : undefined
          this.applyRuntimeStateEvent(entry, { type: 'runtime-terminal', turn, outcome: { status: 'success' } })
        }
        if (entry.runtimeState.execution.kind === 'turn')
          this.applyRuntimeStateEvent(entry, { type: 'clear-steer-reservation' })
        this.clearApiRetry(entry)
        this.refreshContextUsage(entry)
        break
      }
      case 'error':
        this.handleRuntimeError(entry, event.error)
        break
    }
  }

  private handleCompactionStart(
    entry: AgentSessionRuntimeEntry,
    trigger: AgentSessionCompactionTrigger | undefined
  ): void {
    this.invalidateContextUsage(entry)
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

    const turn =
      invocation.messageAssociation === 'current-turn'
        ? getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        : undefined
    if (!invocation.responseId && invocation.messageAssociation === 'current-turn' && !turn) {
      logger.warn('Agent SDK usage lost its active turn before persistence; recording stateless', {
        sessionId: entry.sessionId,
        requestId: invocation.requestId
      })
    }

    const normalizedModel = normalizeAgentSdkModelAlias(invocation.model)
    const frozenModel = capture.frozenModels.find((candidate) =>
      candidate.aliases.some((alias) => normalizeAgentSdkModelAlias(alias) === normalizedModel)
    )
    const modelId = frozenModel?.modelId ?? normalizedModel
    const apiModelId = frozenModel?.apiModelId ?? normalizedModel
    const correlation = invocation.responseId ?? turn?.turnId
    if (turn && correlation && !invocation.responseId) this.bindUsage(entry, correlation, turn)
    const record = correlation
      ? (entry.usageAttribution ??= new AgentSessionUsageAttribution()).capture(correlation)
      : (input: Parameters<typeof aiUsageRecordService.recordInvocation>[0]) =>
          aiUsageRecordService.recordInvocation(input)
    record({
      requestId: invocation.requestId,
      context: createAiUsageCaptureContext({
        providerId: capture.providerId,
        providerName: capture.providerName,
        modelId,
        modelName: frozenModel?.modelName ?? invocation.model,
        pricingSnapshot:
          invocation.pricingSnapshot === undefined
            ? (frozenModel?.pricingSnapshot ?? null)
            : invocation.pricingSnapshot,
        credentialReceipt: capture.credentialReceipt,
        source: sourceSnapshotFromMessageSnapshot(turn?.messageSnapshot) ?? capture.source,
        messageRef: turn ? { kind: 'agent-session', id: turn.assistantMessageId } : null
      }),
      modality: 'language',
      usage: invocation.usage,
      metrics: invocation.metrics,
      completedAt: Date.now()
    })

    if (!invocation.usage) return
    try {
      application.get('AnalyticsService').trackTokenUsage({
        provider: capture.providerId,
        model: apiModelId,
        input_tokens: invocation.usage.inputTokens,
        output_tokens: invocation.usage.outputTokens,
        source: 'agent'
      })
    } catch {
      // Telemetry must never affect Agent runtime delivery.
    }
  }

  private handleCompactionComplete(entry: AgentSessionRuntimeEntry, anchor?: AgentSessionCompactionAnchorData): void {
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'compaction', active: false })

    const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
    if (anchor && turn && this.isTurnLive(entry, turn)) {
      this.deliverRuntimeChunk(entry, {
        type: 'data-compaction-anchor',
        id: crypto.randomUUID(),
        data: anchor
      })
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

  private settleCompactionError(entry: AgentSessionRuntimeEntry, error?: string): void {
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'compaction', active: false })
    if (error) logger.warn('Agent session compaction failed', { sessionId: entry.sessionId, error })
    application
      .get('CacheService')
      .setShared(
        AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId),
        error ? { status: 'failed', error } : { status: 'idle' }
      )
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
      do {
        refresh.pending = false
        const epoch = entry.contextUsageEpoch
        const result = await connection.getContextUsage!()
        if (!this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return
        if (epoch === entry.contextUsageEpoch && !refresh.pending) this.persistContextUsage(entry, result)
        else refresh.pending = true
      } while (refresh.pending)
    })()
      .catch((error) => {
        logger.warn('Failed to refresh agent session context usage', { sessionId: entry.sessionId, error })
      })
      .finally(() => {
        if (entry.contextUsageRefresh === refresh) entry.contextUsageRefresh = undefined
      })
  }

  private invalidateContextUsage(entry: AgentSessionRuntimeEntry): void {
    entry.contextUsageEpoch = (entry.contextUsageEpoch ?? 0) + 1
    application.get('CacheService').deleteShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.sessionId))
  }

  private persistContextUsage(entry: AgentSessionRuntimeEntry, result: AgentSessionContextUsage['result']): void {
    if (!this.isCurrentEntry(entry)) return
    if (entry.contextUsageModel !== entry.modelId) return
    application
      .get('CacheService')
      .setShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.sessionId), { modelId: entry.modelId, result })
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

  private backgroundCallIds(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): Set<string> {
    const pending = getAgentSessionRuntimeReply(entry.runtimeState, turn)?.pendingResultToolCallIds ?? []
    const parts = turn.projection?.parts(turn.assistantMessageId) ?? []
    return new Set([...pending, ...parts.flatMap((part) => (isToolUIPart(part) ? [part.toolCallId] : []))])
  }

  private ownsBackgroundNotification(entry: AgentSessionRuntimeEntry, calls: readonly string[] | undefined): boolean {
    if (!calls?.length || !isAgentSessionRuntimeAwaitingBackground(entry.runtimeState)) return false
    const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
    if (!turn) return false
    const owned = this.backgroundCallIds(entry, turn)
    return calls.every((call) => owned.has(call))
  }

  private handleBackgroundResults(
    entry: AgentSessionRuntimeEntry,
    result: Extract<AgentRuntimeEvent, { type: 'background-results' }>['result'],
    connection = this.currentConnection(entry)
  ): void {
    if (!this.isCurrentEntry(entry) || (connection && this.currentConnection(entry) !== connection)) return
    if (result.status !== 'confirmed') {
      const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
      if (turn) this.applyRuntimeStateEvent(entry, { type: 'reply-results', turn, toolCallIds: undefined })
      logger.warn('Background result attribution is unknown', { sessionId: entry.sessionId, error: result.error })
      return
    }
    for (const turn of getAgentSessionRuntimeTurns(entry.runtimeState)) {
      const owned = this.backgroundCallIds(entry, turn)
      this.applyRuntimeStateEvent(entry, {
        type: 'reply-results',
        turn,
        toolCallIds: result.value.filter((call) => owned.has(call))
      })
    }
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
      if (!this.isSessionBusy(entry.sessionId)) this.refreshIdleTimer(entry)
    }
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
    this.applyRuntimeStateEvent(entry, { type: 'autonomous-turn-finished' })
    this.refreshIdleTimer(entry)
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
    for (const projection of entry.rootProjections?.values() ?? []) {
      const update = projection.taskEvent(merged as unknown as AgentTaskEventPartData)
      if (!update) continue
      this.publishRootMessage(entry, projection, update.messageId, update.parts)
    }
    if (isAgentSessionRuntimeAwaitingBackground(entry.runtimeState)) {
      this.deliverRuntimeChunk(entry, {
        type: 'data-agent-task-event',
        id: uuidv7(),
        data: merged as unknown as AgentTaskEventPartData
      })
    }
  }

  private handleToolApprovalRequest(entry: AgentSessionRuntimeEntry, request: AgentRuntimeToolApprovalRequest): void {
    if (request.presentation === 'stream') {
      const chunk: UIMessageChunk = {
        type: 'tool-approval-request',
        approvalId: request.approvalId,
        toolCallId: request.toolCallId
      }
      if (!this.deliverRuntimeChunk(entry, chunk)) {
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
      this._onApprovalRequested.fire({
        topicId: entry.topicId,
        approvalId: request.approvalId,
        requestedAt: Date.now()
      })
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
    this.invalidateContextUsage(entry)
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'background', active: false })
    if (entry.runtimeState.execution.kind === 'autonomous-turn') {
      this.applyRuntimeStateEvent(entry, { type: 'autonomous-turn-finished' })
    }
    const cache = application.get('CacheService')
    cache.setShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.sessionId), [])
    cache.setShared(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.sessionId), {})
  }

  private handleRuntimeError(entry: AgentSessionRuntimeEntry, error: unknown): void {
    this.clearApiRetry(entry)
    this.applyRuntimeStateEvent(entry, { type: 'clear-steer-reservation' })
    const compaction = application.get('CacheService').getShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId))
    if (
      isAgentSessionRuntimeCompacting(entry.runtimeState) ||
      (this.liveTurn(entry) &&
        compaction?.status === 'failed' &&
        compaction.error === (error instanceof Error ? error.message : String(error)))
    ) {
      // The terminal error owns this failure's presentation; do not also leave a compaction warning.
      this.settleCompactionError(entry)
    }

    const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
    const execution = entry.runtimeState.execution
    if (
      turn &&
      (execution.kind === 'steer-transition' ||
        execution.kind === 'autonomous-turn' ||
        (execution.kind === 'turn' && this.isTurnLive(entry, turn)))
    ) {
      this.applyRuntimeStateEvent(entry, {
        type: 'runtime-terminal',
        turn,
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
    // A fresh request starts clean — drop status left over from the previous turn.
    this.clearApiRetry(entry)
    const cache = application.get('CacheService')
    if (cache.getShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId))?.status === 'failed') {
      cache.setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), { status: 'idle' })
    }
    await this.refreshTurnTraceContext(entry, turn)
    const connection = this.currentConnection(entry)
    if (!connection) throw new Error('Agent runtime connection unavailable')
    await connection.send({
      message: turn.userMessage,
      systemReminder: turn.systemReminder === true
    })
  }

  private publishRootMessage(
    entry: AgentSessionRuntimeEntry,
    projection: RootMessageProjection,
    messageId: string,
    parts: CherryUIMessage['parts']
  ): void {
    const turn = getAgentSessionRuntimeTurns(entry.runtimeState).find(
      (candidate) => candidate.assistantMessageId === messageId
    )
    if (turn && !entry.persistedMessageIds?.has(messageId)) {
      this.publishTurnMessage(entry, turn, parts)
      return
    }
    agentSessionMessageService.replaceMessageParts(
      entry.sessionId,
      messageId,
      parts,
      this.rootCheckpoint(entry, projection, messageId)
    )
  }

  private publishTurnMessage(
    entry: AgentSessionRuntimeEntry,
    turn: AgentSessionTurn,
    parts: CherryUIMessage['parts']
  ): void {
    if (!turn.controller?.message || !this.isTurnLive(entry, turn)) return
    this.clearApiRetry(entry)
    turn.activeToolIds.clear()
    for (const part of parts) {
      if (!isToolUIPart(part)) continue
      if (part.state !== 'output-available' && part.state !== 'output-error' && part.state !== 'output-denied')
        turn.activeToolIds.add(part.toolCallId)
    }
    turn.controller.message(parts)
  }

  private rootCheckpoint(entry: AgentSessionRuntimeEntry, projection: RootMessageProjection, savingMessageId: string) {
    const pending = getAgentSessionRuntimeTurns(entry.runtimeState)
      .filter(
        (turn) =>
          turn.assistantMessageId !== savingMessageId && !entry.persistedMessageIds?.has(turn.assistantMessageId)
      )
      .map((turn) => turn.assistantMessageId)
    return projection.checkpoint(new Set(pending))
  }

  private rootProjection(entry: AgentSessionRuntimeEntry, contextId: string): RootMessageProjection {
    const projections = (entry.rootProjections ??= new Map())
    let projection = projections.get(contextId)
    if (!projection) projections.set(contextId, (projection = new RootMessageProjection(contextId)))
    return projection
  }

  private deliverRuntimeChunk(entry: AgentSessionRuntimeEntry, chunk: UIMessageChunk): boolean {
    const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
    if (!turn) return false
    const contextId = this.currentConnection(entry)?.contextId
    if (!turn.projection && contextId) turn.projection = this.rootProjection(entry, contextId)
    turn.projection?.control(turn.assistantMessageId, chunk)
    const parts = turn.projection?.parts(turn.assistantMessageId)
    if (parts) this.publishTurnMessage(entry, turn, parts)
    if (!hasAgentSessionRuntimeOpenStream(entry.runtimeState, turn)) {
      this.applyRuntimeStateEvent(entry, { type: 'buffer-chunk', turn, chunk })
      return true
    }
    this.enqueueTurnChunk(entry, turn, chunk)
    return true
  }

  private enqueueTurnChunk(_entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn, chunk: UIMessageChunk): void {
    if ((chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') && chunk.toolCallId)
      turn.activeToolIds.add(chunk.toolCallId)
    else if (
      (chunk.type === 'tool-output-available' ||
        chunk.type === 'tool-output-error' ||
        chunk.type === 'tool-output-denied') &&
      chunk.toolCallId
    )
      turn.activeToolIds.delete(chunk.toolCallId)
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

  private scheduleRuntimeLaunch(
    entry: AgentSessionRuntimeEntry,
    target: AgentSessionRuntimeLaunchTarget<AgentSessionTurn>
  ): void {
    if (
      !this.isCurrentEntry(entry) ||
      entry.runtimeState.launch.kind !== 'scheduled' ||
      entry.runtimeState.launch.target !== target
    )
      return
    const launch = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        if (!this.isCurrentEntry(entry)) {
          resolve()
          return
        }
        if (this.isWriteQuiesced || entry.closing) {
          this.applyRuntimeStateEvent(entry, { type: 'launch-suppressed', target })
          if (this.inFlightTurnStarts.get(entry.sessionId) === launch) this.inFlightTurnStarts.delete(entry.sessionId)
          resolve()
          return
        }
        this.applyRuntimeStateEvent(entry, { type: 'launch-started', target })
        const run = target.kind === 'queued-turn' ? this.startNextTurn(entry) : this.prepareReply(entry, target.turn)
        void run
          .catch((error) => {
            logger.error('Failed to launch agent reply', { sessionId: entry.sessionId, error })
          })
          .finally(() => {
            if (this.inFlightTurnStarts.get(entry.sessionId) === launch) this.inFlightTurnStarts.delete(entry.sessionId)
            this.applyRuntimeStateEvent(entry, { type: 'launch-finished', target })
            resolve()
          })
      })
    })
    this.inFlightTurnStarts.set(entry.sessionId, launch)
  }

  private async startNextTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    if (entry.runtimeState.execution.kind !== 'idle') return
    const pending = entry.runtimeState.queue[0]
    if (!pending) return
    const liveAgent = agentService.getAgent(entry.agentId)
    const turn = createSessionTurn({
      taskIds: [pending.message.id],
      userMessage: pending.message,
      parentId: pending.message.id,
      systemReminder: pending.steer === true,
      modelId: entry.modelId,
      messageSnapshot: reconcileSnapshotModel(
        pending.messageSnapshot ?? entry.messageSnapshot,
        entry.modelId,
        liveAgent?.modelName
      ),
      reasoningEffort: pending.reasoningEffort,
      serviceTier: pending.serviceTier,
      knowledgeBaseIds: pending.knowledgeBaseIds,
      fastMode: pending.fastMode,
      headless: pending.headless,
      trustedNotifyChannels: pending.trustedNotifyChannels
    })
    this.applyRuntimeStateEvent(entry, { type: 'dequeue-turn' })
    this.applyRuntimeStateEvent(entry, { type: 'begin-turn', turn, reserved: true })
    if (!liveAgent?.model) {
      this.applyRuntimeStateEvent(entry, { type: 'clear-queue' })
      this.applyRuntimeStateEvent(entry, {
        type: 'reply-delivery-failed',
        turn,
        error: new Error(`Agent ${entry.agentId} has no model configured`)
      })
      return
    }
    await this.prepareReply(entry, turn)
  }

  private suspendTurn(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): void {
    const suspended = application.get('AiStreamManager').suspendUnadmittedRuntimeTurn(entry.topicId)
    this.closeTurn(turn)
    void suspended
      .catch((error) => logger.warn('Failed to suspend agent reply', { sessionId: entry.sessionId, error }))
      .finally(() => this.applyRuntimeStateEvent(entry, { type: 'turn-suspended', turn }))
  }

  private saveReply(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): void {
    agentSessionMessageService.saveMessage({
      sessionId: entry.sessionId,
      parentId: turn.parentId ? agentSessionMessageService.branchTip(entry.sessionId, turn.parentId) : undefined,
      message: {
        id: turn.assistantMessageId,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: turn.modelId,
        messageSnapshot: turn.messageSnapshot
      }
    })
    entry.branchHead = turn.assistantMessageId
    if (turn.origin)
      application
        .get('CacheService')
        .setShared(AGENT_SESSION_TURN_ORIGIN_CACHE_KEY(entry.sessionId, turn.assistantMessageId), turn.origin)
    this.applyRuntimeStateEvent(entry, { type: 'turn-prepared', turn })
    entry.usageAttribution?.flush(turn.assistantMessageId)
  }

  private async prepareReply(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): Promise<void> {
    if (!this.isCurrentEntry(entry) || entry.closing || this.currentTurn(entry) !== turn) return
    let rootSpan: Span | undefined
    try {
      const reply = getAgentSessionRuntimeReply(entry.runtimeState, turn)
      if (reply?.delivery.kind === 'reserved') this.saveReply(entry, turn)
      if (getAgentSessionRuntimeReply(entry.runtimeState, turn)?.delivery.kind !== 'unopened') return
      rootSpan = this.startRuntimeRootSpan(entry, turn.modelId)
      await this.refreshTurnTraceContext(entry, turn)
      if (
        !this.isCurrentEntry(entry) ||
        entry.closing ||
        this.currentTurn(entry) !== turn ||
        !this.isTurnLive(entry, turn)
      ) {
        rootSpan?.end()
        return
      }
      const messages = createRuntimeSeedMessages(turn.userMessage, turn.assistantMessageId)
      if (rootSpan)
        applyTurnInputAttributes(rootSpan, {
          modelId: turn.modelId,
          topicId: entry.topicId,
          operation: 'invoke_agent',
          messages
        })
      this.applyRuntimeStateEvent(entry, { type: 'turn-stream-attaching', turn })
      application.get('AiStreamManager').startRuntimeTurn({
        taskIds: turn.taskIds,
        topicId: entry.topicId,
        modelId: turn.modelId,
        rootSpan,
        request: {
          conversation: { id: extractAgentSessionId(entry.topicId), topicId: entry.topicId },
          trigger: 'submit-message',
          messageId: turn.assistantMessageId,
          messages,
          reasoningEffort: turn.reasoningEffort,
          serviceTier: turn.serviceTier,
          ...(turn.fastMode ? { fastMode: true } : {}),
          runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId: turn.turnId }
        },
        abortController: turn.abortController,
        listeners: [
          this.createPersistenceListener(entry, turn),
          new AgentSessionRuntimeTerminalListener(this, entry.sessionId, turn.turnId),
          new TraceFlushListener(entry.topicId)
        ]
      })
    } catch (error) {
      rootSpan?.setStatus({ code: SpanStatusCode.ERROR, message: 'Reply preparation failed' })
      rootSpan?.end()
      this.applyRuntimeStateEvent(entry, { type: 'reply-delivery-failed', turn, error })
    }
  }

  getMcpInteractionHost(sessionId: string): { windowId: string; topicId: string; model: string } | undefined {
    const entry = this.entries.get(sessionId)
    if (!entry || this.getInteractionState(sessionId).userResponse === 'unavailable') return undefined
    const windowId = application.get('AiStreamManager').getInteractionWindow(entry.topicId) ?? entry.interactionWindowId
    if (!windowId || !application.get('WindowManager').getWindow(windowId)) return undefined
    entry.interactionWindowId = windowId
    return { windowId, topicId: entry.topicId, model: entry.modelId }
  }

  getInteractionState(sessionId: string): AgentSessionInteractionState {
    const entry = this.entries.get(sessionId)
    if (!entry) return { currentTurn: 'none', userResponse: 'unavailable' }

    const turn = this.liveTurn(entry)
    const execution = entry.runtimeState.execution
    const currentTurn = turn ? (turn.headless === true ? 'headless' : 'interactive') : 'none'
    if (execution.kind === 'steer-transition')
      return { currentTurn, userResponse: execution.reply.turn.headless ? 'unavailable' : 'stream' }
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

  private createPersistenceListener(entry: AgentSessionRuntimeEntry, currentTurn: AgentSessionTurn): StreamListener {
    const { assistantMessageId, modelId } = currentTurn
    const userText = extractMessageText(currentTurn.userMessage)
    const afterPersist = currentTurn.shouldAutoName
      ? async (finalMessage: CherryUIMessage) => {
          await topicNamingService.maybeRenameAgentSession(entry.agentId, entry.sessionId, userText, finalMessage)
        }
      : undefined
    return new PersistenceListener({
      topicId: entry.topicId,
      modelId,
      prepareMessage: (message, status) => currentTurn.projection?.prepare(message, status),
      backend: new AgentSessionMessageBackend({
        sessionId: entry.sessionId,
        assistantMessageId,
        modelId,
        runtimeResumeToken: () => entry.lastResumeToken,
        forkAnchor: () => currentTurn.forkAnchor,
        projection: () =>
          currentTurn.projection
            ? this.rootCheckpoint(entry, currentTurn.projection, currentTurn.assistantMessageId)
            : undefined,
        onPersisted: () => {
          ;(entry.persistedMessageIds ??= new Set()).add(assistantMessageId)
          entry.usageAttribution?.flush(assistantMessageId)
        },
        afterPersist
      }),
      onPersistFailed: (error) =>
        this.applyRuntimeStateEvent(entry, { type: 'reply-delivery-failed', turn: currentTurn, error })
    })
  }

  private refreshIdleTimer(entry: AgentSessionRuntimeEntry): void {
    this.clearIdleTimer(entry)
    if (this.currentConnection(entry)?.retainWhileIdle) return
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
    const sessionIds = new Set([...this.entries.keys(), ...this.closingSessions.keys()])
    const closings = [...sessionIds].map((sessionId) => this.closeSession(sessionId))
    return Promise.allSettled(closings).then(() => undefined)
  }

  private async closeEntry(entry: AgentSessionRuntimeEntry, interrupt = false): Promise<void> {
    this.clearIdleTimer(entry)
    entry.closing = true
    const turns = getAgentSessionRuntimeTurns(entry.runtimeState)
    const streamDrain = Promise.allSettled(
      turns.map((turn) => application.get('AiStreamManager').drainRuntimeReply(entry.topicId, turn.assistantMessageId))
    )
    for (const turn of turns) this.closeTurn(turn)
    const connectionAttempt = this.connectionAttempts.get(entry.sessionId)?.promise
    const connection = this.currentConnection(entry)
    const connectionLoop = entry.connectionLoop
    await this.closeRuntimeConnection(connection, entry.sessionId, true, interrupt)
    if (connectionAttempt) await connectionAttempt
    if (connectionLoop) await connectionLoop
    await streamDrain
    for (const turn of getAgentSessionRuntimeTurns(entry.runtimeState)) {
      const reply = getAgentSessionRuntimeReply(entry.runtimeState, turn)
      if (
        !turn.projection &&
        !['reserved', 'unopened', 'attaching', 'suspending', 'failed'].includes(reply?.delivery.kind ?? '')
      )
        continue
      if (reply?.delivery.kind === 'failed') this.applyRuntimeStateEvent(entry, { type: 'retry-reply', turn })
      if (reply?.delivery.kind === 'reserved' || reply?.delivery.kind === 'failed') this.saveReply(entry, turn)
      const status =
        reply?.deliveryFailure || reply?.terminal?.status === 'error'
          ? 'error'
          : reply?.delivery.kind === 'settled'
            ? reply.delivery.status
            : (reply?.terminal?.status ?? 'paused')
      const message: CherryUIMessage = {
        id: turn.assistantMessageId,
        role: 'assistant',
        parts: turn.projection?.parts(turn.assistantMessageId) ?? []
      }
      new AgentSessionMessageBackend({
        sessionId: entry.sessionId,
        assistantMessageId: turn.assistantMessageId,
        modelId: turn.modelId,
        runtimeResumeToken: () => entry.lastResumeToken,
        projection: () =>
          turn.projection ? this.rootCheckpoint(entry, turn.projection, turn.assistantMessageId) : undefined,
        onPersisted: () => {
          ;(entry.persistedMessageIds ??= new Set()).add(turn.assistantMessageId)
          entry.usageAttribution?.flush(turn.assistantMessageId)
        }
      }).persistAssistant({ finalMessage: turn.projection?.prepare(message, status) ?? message, status })
      this.closeTurn(turn)
    }
    if (this.isCurrentEntry(entry)) {
      try {
        this.clearApiRetry(entry)
        const cache = application.get('CacheService')
        cache.deleteShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(entry.sessionId))
        cache.deleteShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.sessionId))
        cache.deleteShared(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.sessionId))
      } catch (error) {
        logger.warn('Failed to clear closed session cache', { sessionId: entry.sessionId, error })
      }
    }
    this.closeConnection(entry, false)
    this.applyRuntimeStateEvent(entry, { type: 'reset' })
    delete entry.closing
  }

  private closeFailedPolicyUpdateConnection(entry: AgentSessionRuntimeEntry, connection: AgentRuntimeConnection): void {
    if (!this.isCurrentEntry(entry) || entry.closing || this.currentConnection(entry) !== connection) return
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
    entry.connectionGeneration = undefined
    return connection
  }

  private closeConnectionAsync(entry: AgentSessionRuntimeEntry): void {
    const connection = this.closeConnection(entry)
    void this.closeRuntimeConnection(connection, entry.sessionId)
  }

  private async closeRuntimeConnection(
    connection: AgentRuntimeConnection | undefined,
    sessionId: string,
    strict = false,
    interrupt = false
  ): Promise<void> {
    if (!connection) return
    const entry = this.entries.get(sessionId)
    const priorClosing = this.closingSessions.get(sessionId)
    const resumeToken =
      entry?.lastResumeToken ?? priorClosing?.resumeToken ?? this.failedClosureResumeTokens.get(connection)
    const branchHead = entry?.lastResumeToken ? entry.branchHead : priorClosing?.branchHead
    const settled = Promise.withResolvers<void>()
    void this.trackSessionClosing(sessionId, settled.promise, resumeToken, branchHead)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const close = () => (connection.closeForEdit ? connection.closeForEdit() : connection.close())
      const closing =
        interrupt && connection.interrupt
          ? Promise.resolve()
              .then(() => connection.interrupt!())
              .then(close, async (interruptError) => {
                try {
                  await close()
                } catch (closeError) {
                  throw new AggregateError([interruptError, closeError], 'Agent runtime interruption and close failed')
                }
                throw interruptError
              })
          : close()
      await Promise.race([
        Promise.resolve(closing).then(() => {
          const failed = this.failedClosures.get(sessionId)
          const completedLate = failed?.delete(connection)
          this.failedClosureResumeTokens.delete(connection)
          if (failed?.size === 0) this.failedClosures.delete(sessionId)
          if (completedLate && entry?.closing && this.isCurrentEntry(entry))
            queueMicrotask(() => void this.closeSession(sessionId))
          this.syncRuntimeActivity()
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AgentSessionEditError('close_failed')), 20_000)
        })
      ])
    } catch (error) {
      const failed = this.failedClosures.get(sessionId) ?? new Set<AgentRuntimeConnection>()
      failed.add(connection)
      if (resumeToken) this.failedClosureResumeTokens.set(connection, resumeToken)
      this.failedClosures.set(sessionId, failed)
      logger.warn('Agent runtime connection close failed', { sessionId, error })
      if (strict) throw new AgentSessionEditError('close_failed')
    } finally {
      clearTimeout(timer)
      settled.resolve()
    }
  }
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
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

function normalizeAgentSdkModelAlias(value: string): string {
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

function createSessionTurn(
  input: Omit<
    AgentSessionTurn,
    'turnId' | 'assistantMessageId' | 'abortController' | 'activeToolIds' | 'controller' | 'projection'
  > & { assistantMessageId?: string }
): AgentSessionTurn {
  return {
    ...input,
    turnId: crypto.randomUUID(),
    assistantMessageId: input.assistantMessageId ?? uuidv7(),
    messageSnapshot: input.messageSnapshot ? structuredClone(input.messageSnapshot) : undefined,
    abortController: new AbortController(),
    activeToolIds: new Set()
  }
}
