import { type Span, SpanStatusCode } from '@opentelemetry/api'
import { isToolUIPart } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import { runtimeId, type SubmitResult } from '@cherrystudio/agent-runtime'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as childContexts } from '@data/services/AgentSessionContextService'
import { AgentSessionEditError } from '@data/services/AgentSessionEditError'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import { getImportedHistoryState } from '@data/services/importedSessionHistory'
import { modelService } from '@data/services/ModelService'
import { getRetiredAgentSessionMigration } from '@data/services/retiredAgentRuntimeMigration'
import { loggerService } from '@logger'
import { AgentSessionForkOperations, readHistoryActions } from '@main/ai/agentSession/fork'
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
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
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
import { AGENT_SESSION_COST_CACHE_KEY, type AgentSessionCostSnapshot } from '@shared/ai/agentSessionCost'
import {
  AGENT_SESSION_CLOSING_CACHE_KEY,
  type AgentSessionEditDraft,
  type AgentSessionEditTarget
} from '@shared/ai/agentSessionEdit'
import { AGENT_SESSION_FOLLOWUPS_CACHE_KEY, type AgentSessionFollowupChange } from '@shared/ai/agentSessionFollowups'
import {
  AGENT_SESSION_RUNTIME_CONTROLS_CACHE_KEY,
  type AgentSessionRuntimeControls
} from '@shared/ai/agentSessionRuntimeControls'
import {
  AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY,
  type AgentSessionSlashCommand
} from '@shared/ai/agentSessionSlashCommands'
import { AGENT_SESSION_STREAM_TOPIC_CACHE_KEY } from '@shared/ai/agentSessionStreamTopic'
import {
  buildAgentSessionTopicId,
  extractAgentContextId,
  extractAgentSessionId,
  isAgentSessionTopic
} from '@shared/ai/agentSessionTopic'
import { AGENT_SESSION_TURN_ORIGIN_CACHE_KEY, type AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import { getProviderModelId, type ExecutionId } from '@shared/ai/executionIdentity'
import {
  ACP_HOST_PERMISSION_MODE_ID,
  ACP_LAUNCH_BYPASS_VALUE,
  getAcpLaunchBypassArgs,
  getAcpLaunchPermission,
  getAcpHostPermissionModeSelection,
  getAcpNativePlanModes,
  getLocalAgentLaunchMode,
  getLocalAgentPreset,
  getLocalAgentProtocol,
  getLocalPermissionChoice,
  getLocalSessionPermission,
  isAcpHostPermissionMode,
  usesPresetAcpLaunch,
  type LocalAgentRuntime,
  type LocalAgentSessionInfo,
  type LocalAgentSessionOverrides,
  type LocalAgentSessionView
} from '@shared/ai/localAgent'
import type { LocalAgentTurnUsage } from '@shared/ai/localAgentUsage'
import type { AiToolApprovalRespondResponse } from '@shared/ai/transport'
import type { AgentEntity, AgentPermissionMode, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage, MessageSnapshot } from '@shared/data/types/message'
import {
  createUniqueModelId,
  isUniqueModelId,
  parseUniqueModelId,
  UniqueModelIdSchema,
  type ServiceTierSelection,
  type UniqueModelId
} from '@shared/data/types/model'
import { type AgentTaskEventPartData, getKnowledgeBaseIdsFromParts } from '@shared/data/types/uiParts'
import type { InputFor, WindowId } from '@shared/ipc/types'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { prepareAgentConfigApproval } from '../agents/agentConfigTool'
import { applyTurnInputAttributes, deriveRootSpanId, startAiChildTurnSpan } from '../observability'
import { LocalAgentSessionRestoreError } from '../runtime/LocalAgentSessionRestoreError'
import { recoverDurableReplies } from '../runtime/piDurable/recoverDurableReplies'
import { normalizePromptSuggestion } from '../runtime/promptSuggestion'
import { registerRuntimeDrivers } from '../runtime/registerDrivers'
import { runtimeDriverRegistry } from '../runtime/registry'
import type {
  AgentRuntimeConnectInput,
  AgentControlChunk,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeToolApprovalRequest,
  AgentRuntimeTraceContext,
  AgentRuntimeUserInput,
  AgentSessionUsageCapture
} from '../runtime/types'
import type { AgentMessageStreamSource, AgentPartChange, ExecutionPart, MessageStreamEvent } from '../streamManager'
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
import { childTimelines } from './childTimelines'
import { validateEditedInput } from './editInput'
import { resolveLocalContext, resolveLocalSessionBinding } from './localContext'
import { bindNativeInput, markLocalInput, nativeOutcomeTerminal } from './nativeSubmission'
import { AgentSessionMessageBackend } from './persistence/AgentSessionMessageBackend'
import { relocateSystemWorkspaces } from './relocateSystemWorkspaces'
import { RootMessageProjection } from './RootMessageProjection'
import { readSessionHistory } from './sessionHistory'

const logger = loggerService.withContext('AgentSessionRuntimeService')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000
const CONTEXT_USAGE_REFRESH_THROTTLE_MS = 3_000
/** Stream abort reasons that mean the user stopped the work, as opposed to teardown. */
const USER_STOP_REASONS: ReadonlySet<unknown> = new Set(['user-requested', 'remote-cancel'])
type NativeInputState = Extract<AgentRuntimeEvent, { type: 'input-state' }>['input']
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
  modelId: ExecutionId
  reasoningEffort?: ReasoningEffortOption
  serviceTier?: ServiceTierSelection
  fastMode?: boolean
  assistantMessageId: string
  userMessage?: AgentSessionMessageEntity
  headless?: boolean
  permissionModeOverride?: AgentPermissionMode
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

type AgentSessionRun = {
  localTurnUsage?: LocalAgentTurnUsage
  taskIds: readonly string[]
  inputOutcomes?: Map<string, NativeInputState>
  forkAnchor?: RuntimeForkAnchor
  /** Stream attachment correlation, independent of durable execution ownership. */
  turnId: string
  /** True when the user message arrived as a steer — admission wraps it in a system-reminder. */
  systemReminder?: boolean
  /** The existing assistant record ID; steer never changes this owner. */
  runId: string
  userMessage: AgentSessionMessageEntity
  modelId: ExecutionId
  /** Immutable author snapshot captured when this exact turn was submitted. */
  messageSnapshot?: MessageSnapshot
  /** Whether this initial turn owns the session's one automatic AI naming attempt. */
  shouldAutoName?: boolean
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  knowledgeBaseIds: readonly string[]
  fastMode: boolean
  abortController: AbortController
  controller?: Pick<ReadableStreamDefaultController<AgentControlChunk>, 'enqueue' | 'error' | 'close'> & {
    message: (entries: readonly ExecutionPart[]) => void
    part: (change: AgentPartChange) => void
  }
  activeToolIds: Set<string>
  projection?: RootMessageProjection
  parentId?: string
  origin?: AutonomousTurnOrigin
  headless?: boolean
  permissionModeOverride?: AgentPermissionMode
  trustedNotifyChannels?: readonly NotifyChannel[]
  /** A background run continued this reply after its input ended; Stop then ends that run, not the input. */
  continuedInBackground?: boolean
}

type QueuedAgentSessionInput = {
  message: AgentSessionMessageEntity
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  knowledgeBaseIds: readonly string[]
  fastMode: boolean
  /** The message arrived mid-turn (steer) — the drained turn wraps it in a system-reminder. */
  steer?: boolean
  /** The follow-up must open a responder-less/headless turn. */
  headless?: boolean
  permissionModeOverride?: AgentPermissionMode
  /** Undefined resolves the linked source channel; [] intentionally grants no notification recipients. */
  trustedNotifyChannels?: readonly NotifyChannel[]
  /** Submit-time author snapshot so a mid-session agent/model change can't restamp the reply. */
  messageSnapshot?: MessageSnapshot
}

type AgentSessionConnectionTarget = AgentSessionRuntimeConnectionTarget & {
  localWorkingDirectory?: string
  localPermissionMode?: AgentPermissionMode
  modelId: ExecutionId
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  fastMode: boolean
  /** The target turn's dispatch mode: headless turns resolve against the agent default. */
  headless?: boolean
  permissionModeOverride?: AgentPermissionMode
}

type RuntimeState = AgentSessionRuntimeState<AgentSessionRun, QueuedAgentSessionInput>
type RuntimeStateEvent = AgentSessionRuntimeStateEvent<AgentSessionRun, QueuedAgentSessionInput>

type AgentSessionRuntimeEntry = {
  prediction?: {
    requestId?: string
    replyId: string
    modelId: ExecutionId
    localModelId?: string
    controller: AbortController
    result: Promise<string>
  }
  closing?: true
  /**
   * User Stop on a retained connection; `confirmed` runs on native confirmation, disconnect or close.
   * `input` retains all admitted input outcomes so one completed input cannot settle a stopped Run.
   */
  stopping?: {
    connection: AgentRuntimeConnection
    confirmed: () => void
    settled: Promise<void>
    input?: {
      ids: readonly string[]
      replyId: string
      outcomes: Map<string, NativeInputState>
      terminal?: AgentSessionTurnTerminalEvent
    }
  }
  /** Follow-up placements waiting for the current reply to open; each starts its own reply, in order. */
  deferredPlacements?: (readonly string[])[]
  recoveryHeadless?: boolean
  compactionAnchorId?: string
  /** Native answers can arrive while their queued placement still awaits a reply. */
  pendingRunCheckpoints?: Map<string, RuntimeForkAnchor>
  /** Pending input outcomes share one aggregate per Run provisionally settled by a queued placement. */
  followedReplies?: Map<string, { runId: string; pending: Set<string>; outcomes: NativeInputState[] }>
  interactionWindowId?: string
  sessionId: string
  topicId: string
  /** Container-level OTel trace id (one trace tree per session); the warm connection's traceparent. */
  sessionTraceId?: string
  agentId: string
  agentType: string
  modelId: ExecutionId
  /** Author snapshot (agent + nested model) for assistant rows the runtime opens this session. */
  messageSnapshot?: MessageSnapshot
  runtimeState: RuntimeState
  /** Capture owner/receipt of the installed connection; retained through terminal persistence. */
  usageCapture?: AgentSessionUsageCapture
  connectionLoop?: Promise<void>
  nativeTitleReceived?: boolean
  connectionGeneration?: string
  /** Pending product handoffs outlive the connection that attempted native admission. */
  pendingInputs?: Map<
    string,
    {
      input: AgentRuntimeUserInput
      nextTurn: QueuedAgentSessionInput
      generation: string
      readonly contextId: string
    }
  >
  lastResumeToken?: string
  localWorkingDirectory?: string
  branchHead?: string
  secondaryContextId?: string
  usageAttribution?: AgentSessionUsageAttribution
  rootProjections?: Map<string, RootMessageProjection>
  timeline?: { lastPos: number }
  idleTimer?: ReturnType<typeof setTimeout>
  /** Throttle stamp for {@link AgentSessionRuntimeService.refreshContextUsageOnDemand}. */
  lastContextUsageRefreshAt?: number
  /** Single-flight marker for context-usage reads on the current connection. */
  contextUsageRefresh?: { connection: AgentRuntimeConnection; pending: boolean }
  /** Synchronous terminal commits; later native changes update these rows directly. */
  persistedMessageIds?: Set<string>
  contextUsageEpoch?: number
  contextUsageModel?: ExecutionId
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
  'LocalAgentMcpBridgeService',
  'RuntimeActivityService'
])
export class AgentSessionRuntimeService extends BaseService {
  private readonly forks = new AgentSessionForkOperations()
  private readonly interactiveLocalSessions = new Map<WindowId, string>()
  private readonly failedClosures = new Map<string, Set<AgentRuntimeConnection>>()
  private readonly localPermissionUpdates = new WeakMap<AgentRuntimeConnection, Promise<AgentRuntimeReconcileResult>>()
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
      (entry && this.connectionAttempts.has(entry)) ||
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
    const actions = readHistoryActions(sessionId, [messageId]).get(messageId)
    if (!actions || actions.edit) throw new AgentSessionEditError(actions?.edit ?? 'checkpoint_unsupported')
    const parts = snapshot.user.data.parts ?? []
    await validateEditedInput(parts)
    return { messageId, version: snapshot.version, parts }
  }

  editSession<T>(
    sessionId: string,
    target: AgentSessionEditTarget,
    persist: (tx: DbOrTx, nativeSessionId: string, nativeContextId?: string, sourceBackendId?: string) => T
  ): Promise<T> {
    this.assertSessionEditable(sessionId)
    const editing = this.forks.edit(
      sessionId,
      target,
      async () => {
        this.assertSessionEditable(sessionId, true)
        const entry = this.entries.get(sessionId)
        if (entry) await this.closeRuntimeConnection(this.closeConnection(entry), entry, true)
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
  private readonly inFlightTurnStarts = new Map<AgentSessionRuntimeEntry, Promise<void>>()
  /** Detached-flow finalizers can outlive their runtime entry but still write message parts. */
  private readonly inFlightChildWrites = new Map<Promise<void>, string>()
  /** Async connection resources live outside the pure state; attempt ids reject stale completions. */
  private readonly connectionAttempts = new Map<
    AgentSessionRuntimeEntry,
    { id: string; promise: Promise<boolean>; interrupt?: boolean }
  >()
  /** Promise resources for a rebuild-blocked connection; the state only owns the blocked phase. */
  private readonly backgroundWorkWaiters = new Map<
    AgentSessionRuntimeEntry,
    { connection: AgentRuntimeConnection; promise: Promise<void>; resolve: () => void }
  >()
  /** Shutdown wins over pause-release compensation (same posture as JobManager). */
  private isShuttingDown = false
  private blockedRecovery = new Set<string>()
  private recovery?: Promise<void>
  private readonly secondaryRoots = new Map<string, AgentSessionRuntimeEntry>()

  private recoveryDue = false
  private readonly startupRecovery = Promise.withResolvers<void>()
  private readonly replyRecoveries = new Set<Promise<void>>()

  protected override onAllReady(): Promise<void> {
    this.recoveryDue = true
    return this.resumeRecovery().finally(() => this.startupRecovery.resolve())
  }

  whenStartupRecoverySettles(): Promise<void> {
    return this.startupRecovery.promise
  }

  private resumeRecovery(): Promise<void> {
    if (this.recovery) return this.recovery
    if (!this.recoveryDue || this.isWriteQuiesced || this.isShuttingDown) return Promise.resolve()
    this.recoveryDue = false
    this.recovery = this.recoverNativeWork().finally(() => {
      this.recovery = undefined
      if (this.recoveryDue) void this.resumeRecovery().catch((error) => logger.warn('Agent recovery failed', { error }))
    })
    return this.recovery
  }

  private async recoverNativeWork(): Promise<void> {
    if (this.isShuttingDown || this.isWriteQuiesced) return
    for (const driver of runtimeDriverRegistry.getAgentSessionDrivers()) await driver.recoverSessions?.()
    await this.recoverPendingReplies()
    for (const driver of runtimeDriverRegistry.getAgentSessionDrivers()) {
      if (this.isShuttingDown) return
      if (this.isWriteQuiesced) {
        this.recoveryDue = true
        return
      }
      await driver.recoverWork?.(this.blockedRecovery, () => !this.isShuttingDown && !this.isWriteQuiesced)
      if (this.isWriteQuiesced) this.recoveryDue = true
    }
  }

  recoverPendingReplies(scope?: { sessionId: string; runId: string; deliveryInputId?: string }): Promise<void> {
    if (this.isShuttingDown || this.isWriteQuiesced) return Promise.resolve()
    const work = recoverDurableReplies(
      (event) => this._onTurnTerminal.fire(event),
      (sessionId, runId) =>
        !this.isShuttingDown &&
        !this.isWriteQuiesced &&
        !this.blockedRecovery.has(sessionId) &&
        (!scope?.deliveryInputId ||
          (!this.isSessionBusyForArchive(sessionId) &&
            !application.get('AiStreamManager').hasUnsettledTopicWork(buildAgentSessionTopicId(sessionId)))) &&
        !this.forks.edits.has(sessionId) &&
        !this.entryForTurn(sessionId, (turn) => turn.runId === runId),
      scope,
      (sessionId) => this.liveTimeline(sessionId)
    )
    this.replyRecoveries.add(work)
    return work.finally(() => this.replyRecoveries.delete(work))
  }

  protected async onInit(): Promise<void> {
    // Populate the AI runtime driver registry at a controlled lifecycle point (WhenReady, before
    // any agent session runs) instead of relying on an import-time side effect.
    registerRuntimeDrivers()
    this.blockedRecovery = await relocateSystemWorkspaces()
    await this.forks.recover()

    // Pi execution dies with Main; terminalize its product placeholders while retaining native history.
    // Delivery recovery owns rows with a persisted delivery turn, and other native owners recover separately.
    this.reconcileStalePendingMessages(this.blockedRecovery)

    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyed(({ id }) => this.releaseLocalSessionInterest(id))
    )
    this.registerDisposable(
      agentService.onAgentUpdated(({ agentId, updates, agent }) => {
        void this.handleAgentUpdated(agentId, updates, agent).catch((error) => {
          logger.warn('Failed to apply live agent policy update', { agentId, error })
        })
      })
    )
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('agent.input.suggestions.enabled', () => {
        for (const entry of this.entries.values()) {
          entry.prediction?.controller.abort()
          void this.reconcileEntryConnection(entry).catch((error) =>
            logger.warn('Prediction preference reconcile failed', { error })
          )
        }
      })
    )
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('feature.code_cli.configs', () => {
        for (const entry of this.entries.values()) {
          if (entry.agentType !== 'local') continue
          void this.reconcileEntryConnection(entry).catch((error) =>
            logger.warn('Code CLI config preference reconcile failed', { error })
          )
        }
      })
    )
    this.registerDisposable(
      agentSessionMessageService.onBranchSelected(({ sessionId, head }) => this.selectBranchStream(sessionId, head))
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
    return entry ? this.liveTurn(entry)?.runId : undefined
  }

  private currentTurn(entry: AgentSessionRuntimeEntry): AgentSessionRun | undefined {
    return getAgentSessionRuntimeCurrentTurn(entry.runtimeState)
  }

  private liveTurn(entry: AgentSessionRuntimeEntry): AgentSessionRun | undefined {
    return getAgentSessionRuntimeLiveTurn(entry.runtimeState)
  }

  private isTurnLive(entry: AgentSessionRuntimeEntry, turn: AgentSessionRun): boolean {
    return isAgentSessionRuntimeTurnLive(entry.runtimeState, turn)
  }

  async predictPrompt(
    input: InputFor<'ai.agent.session.predict_prompt'>
  ): Promise<{ supported: boolean; text: string }> {
    const entry = this.entries.get(input.sessionId)
    const connection = entry && this.currentConnection(entry)
    const supported = !connection || !!connection.predictPrompt
    const empty = { supported, text: '' }
    const prediction = entry?.prediction
    if (!supported || !prediction || prediction.replyId !== input.replyId) return empty
    const matchesModel = () =>
      'localModelId' in input
        ? prediction.localModelId === input.localModelId &&
          connection?.localSessionInfo?.activeModel?.id === input.localModelId
        : prediction.modelId === input.modelId
    if (!matchesModel()) return empty
    prediction.requestId = input.requestId
    const text = await prediction.result
    return prediction.controller.signal.aborted || !matchesModel() ? empty : { supported, text }
  }

  private startPromptPrediction(entry: AgentSessionRuntimeEntry): void {
    const connection = this.currentConnection(entry)
    const turn = getAgentSessionRuntimeCurrentTurn(entry.runtimeState)
    if (!turn || !connection?.predictPrompt || entry.prediction?.replyId === turn.runId) return
    const modelId = entry.modelId
    const localModelId = connection.localSessionInfo?.activeModel?.id
    if (entry.agentType === 'local' && !localModelId) return
    const allowsSuggestions = () => {
      const config = agentService.getAgent(entry.agentId)?.configuration
      return config?.permission_mode !== 'plan' && connection.effectivePermissionMode !== 'plan'
    }
    const eligible = () =>
      entry.modelId === modelId &&
      connection.localSessionInfo?.activeModel?.id === localModelId &&
      this.isCurrentEntry(entry) &&
      !entry.closing &&
      this.runtimeStatus(entry) === 'idle' &&
      !hasAgentSessionRuntimeBackgroundWork(entry.runtimeState) &&
      this.currentConnection(entry) === connection &&
      getAgentSessionRuntimeCurrentTurn(entry.runtimeState) === turn &&
      entry.runtimeState.lastTerminal === 'success' &&
      !turn.headless &&
      !turn.origin &&
      allowsSuggestions() &&
      application.get('PreferenceService').get('agent.input.suggestions.enabled')
    if (
      !eligible() ||
      (entry.interactionWindowId &&
        application.get('WindowManager').getWindow(entry.interactionWindowId)?.isFocused() !== true)
    )
      return
    entry.prediction?.controller.abort()
    const controller = new AbortController()
    const result = Promise.resolve().then(async () => {
      if (!eligible() || controller.signal.aborted) return ''
      try {
        const text = await connection.predictPrompt!(controller.signal)
        return eligible() && !controller.signal.aborted
          ? entry.agentType === 'pi' || entry.agentType === 'pi-durable'
            ? normalizePromptSuggestion(text)
            : text
          : ''
      } catch (error) {
        if (!controller.signal.aborted)
          logger.debug('Prompt prediction unavailable', { sessionId: entry.sessionId, error })
        return ''
      }
    })
    entry.prediction = { replyId: turn.runId, modelId, localModelId, controller, result }
  }

  abortPromptPrediction(sessionId: string, requestId: string): void {
    const prediction = this.entries.get(sessionId)?.prediction
    if (prediction?.requestId === requestId) prediction.controller.abort()
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
    if (this.runtimeStatus(entry) !== 'idle' || hasAgentSessionRuntimeBackgroundWork(entry.runtimeState))
      entry.prediction?.controller.abort()
    this.syncRuntimeActivity()
    for (const effect of transition.effects) this.applyRuntimeStateEffect(entry, effect)
    this.flushDeferredPlacements(entry)
  }

  private flushDeferredPlacements(entry: AgentSessionRuntimeEntry): void {
    while (entry.deferredPlacements && !this.placementWaits(entry)) {
      const [next, ...rest] = entry.deferredPlacements
      entry.deferredPlacements = rest.length ? rest : undefined
      this.startPlacedInputs(entry, next, undefined, true)
    }
  }

  /** A follow-up runs on its own, so it must not join a pending reply or roll one that has no stream yet. */
  private placementWaits(entry: AgentSessionRuntimeEntry): boolean {
    const execution = entry.runtimeState.execution
    return (
      execution.kind === 'run-handoff' ||
      (execution.kind === 'autonomous-turn' &&
        !['open', 'awaiting-persistence', 'settled'].includes(execution.reply.delivery.kind)) ||
      (execution.kind === 'turn' && !['open', 'awaiting-persistence'].includes(execution.reply.delivery.kind))
    )
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
    effect: AgentSessionRuntimeStateEffect<AgentSessionRun>
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
            agentSessionMessageService.markAssistantMessageTerminalError(entry.sessionId, effect.turn.runId)
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
        for (const chunk of effect.chunks) {
          if (
            chunk.type === 'tool-approval-request' &&
            effect.turn.projection &&
            !effect.turn.projection.isPendingToolApproval(chunk.toolCallId, chunk.approvalId)
          )
            continue
          this.enqueueTurnChunk(effect.turn, chunk)
        }
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
      case 'compaction-interrupted': {
        const cache = application.get('CacheService')
        const key = AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId)
        if (cache.getShared(key)?.status === 'compacting') cache.setShared(key, { status: 'idle' })
        break
      }
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

  private selectBranchStream(sessionId: string, head: string): void {
    const selected = this.entries.get(sessionId)
    if (!this.secondaryRoots.size && !(selected && extractAgentContextId(selected.topicId))) {
      this.setBranchStream(sessionId)
      return
    }
    const context = childContexts.branchTx(application.get('DbService').getDb(), sessionId, head)
    this.setBranchStream(sessionId, context && this.entryForContext(sessionId, context.id)?.topicId)
  }

  private setBranchStream(sessionId: string, topicId?: string): void {
    const cache = application.get('CacheService')
    const key = AGENT_SESSION_STREAM_TOPIC_CACHE_KEY(sessionId)
    const scoped = topicId && extractAgentContextId(topicId) ? topicId : null
    if ((cache.getShared(key) ?? null) !== scoped) cache.setShared(key, scoped)
  }

  async prepareBranch(sessionId: string, messageId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (entry?.branchHead && !agentSessionMessageService.sharesBranch(sessionId, entry.branchHead, messageId)) {
      this.assertSessionEditable(sessionId)
      await this.closeSession(sessionId)
    }
    this.selectRecoveredRoot(sessionId, messageId)
  }

  beginTurn(input: BeginAgentSessionTurnInput): AgentSessionRuntimeHandle {
    this.assertSessionWritable(input.sessionId)
    const userMessage = input.userMessage ?? createSyntheticUserMessage(input.sessionId)
    // oxlint-disable-next-line no-restricted-globals -- Capture per-turn model/settings metadata before asynchronous native dispatch.
    const messageSnapshot = input.messageSnapshot ? structuredClone(input.messageSnapshot) : undefined
    const existing = this.selectRecoveredRoot(input.sessionId, input.assistantMessageId)
    if (existing && this.runtimeStatus(existing) === 'active') throw new AgentSessionEditError('busy')
    if (existing && (existing.agentId !== input.agentId || existing.agentType !== input.agentType)) {
      existing.lastResumeToken = undefined
      existing.usageCapture = undefined
      const closing = this.closingSessions.get(input.sessionId)
      if (closing) closing.resumeToken = undefined
      this.closeConnectionAsync(existing)
    }
    const turn = createSessionRun({
      taskIds: input.userMessage ? [input.userMessage.id] : [],
      runId: input.assistantMessageId,
      userMessage,
      modelId: input.modelId,
      messageSnapshot,
      shouldAutoName: input.shouldAutoName === true,
      reasoningEffort: input.reasoningEffort ?? 'default',
      serviceTier: input.serviceTier ?? 'standard',
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? []) ?? [],
      fastMode: input.fastMode === true,
      headless: input.headless === true,
      permissionModeOverride: input.permissionModeOverride,
      trustedNotifyChannels: input.trustedNotifyChannels
    })
    const { turnId } = turn
    agentSessionMessageService.linkReply(input.sessionId, turn.taskIds, input.assistantMessageId)

    // Prewarming can replace the entry while prepareBranch awaits closure, so recheck before reuse.
    if (
      existing &&
      this.runtimeStatus(existing) === 'idle' &&
      existing.branchHead &&
      agentSessionMessageService.sharesBranch(input.sessionId, existing.branchHead, input.assistantMessageId)
    ) {
      this.clearIdleTimer(existing)
      existing.topicId = input.topicId
      this.setBranchStream(input.sessionId, existing.topicId)
      existing.sessionTraceId = input.traceId ?? existing.sessionTraceId
      existing.agentId = input.agentId
      existing.agentType = input.agentType
      existing.modelId = input.modelId
      existing.interactionWindowId = undefined
      existing.messageSnapshot = messageSnapshot
      existing.branchHead = input.assistantMessageId
      this.applyRuntimeStateEvent(existing, { type: 'begin-turn', turn, clearQueue: true })

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
    this.setBranchStream(input.sessionId, entry.topicId)
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
   * Resolve the trusted gateway correlation into the active Run.
   * The gateway calls this at provider-request ingress, before any later agent edit,
   * message roll, or deletion can affect usage persistence.
   */
  getActiveUsageContext(sessionId: string, responseId?: string): InProcessUsageContext | undefined {
    const entry = this.entries.get(sessionId)
    if (!entry) return undefined
    const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
    const attribution = (entry.usageAttribution ??= new AgentSessionUsageAttribution())
    const correlation = responseId ?? turn?.turnId
    if (turn && correlation && !responseId) this.bindUsage(entry, correlation, turn)
    return {
      agentSessionId: sessionId,
      traceContext: this.sessionTraceContext(entry, turn?.modelId),
      ...(turn ? { assistantMessageId: turn.runId } : {}),
      source:
        sourceSnapshotFromMessageSnapshot(turn?.messageSnapshot ?? entry.messageSnapshot) ??
        (entry.messageSnapshot ? null : this.captureUsageSource(entry.agentId)),
      ...(correlation ? { recordInvocation: attribution.capture(correlation) } : {})
    }
  }

  private bindUsage(entry: AgentSessionRuntimeEntry, responseId: string, turn: AgentSessionRun): void {
    const { runId: assistantMessageId } = turn
    // Owners live as long as the session (Pi never idle-closes); a collected turn is no longer a reply.
    const turnRef = new WeakRef(turn)
    ;(entry.usageAttribution ??= new AgentSessionUsageAttribution()).bind(responseId, assistantMessageId, () => {
      const current = turnRef.deref()
      const reply = current && getAgentSessionRuntimeReply(entry.runtimeState, current)
      return (
        entry.persistedMessageIds?.has(assistantMessageId) === true ||
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

  /**
   * Moves output to the reply of inputs the runtime just placed. With native admission, an input
   * this process did not submit (queued before a restart) is read back from its bound user message.
   */
  private startPlacedInputs(
    entry: AgentSessionRuntimeEntry,
    ids: readonly string[],
    connection = this.currentConnection(entry),
    followUp = false
  ): boolean {
    const execution = entry.runtimeState.execution
    const deferred = execution.kind === 'autonomous-turn' ? execution.deferred?.turn : undefined
    if (deferred && ids.includes(deferred.userMessage.id)) {
      if (followUp) this.awaitFollowedOutcome(entry)
      this.applyRuntimeStateEvent(entry, { type: 'run-placed', turn: deferred })
      return true
    }
    const owned = new Set(getAgentSessionRuntimeTurns(entry.runtimeState).flatMap((turn) => turn.taskIds))
    const placed = ids.filter((id) => !owned.has(id))
    const inputs = this.pendingInputValues(entry, placed, true)
    if (connection?.threadInput?.followUp?.persistence === 'durable' && connection.contextId)
      for (const id of placed) {
        if (inputs.some((input) => input.message.id === id)) continue
        if (agentSessionMessageService.inputBinding(entry.sessionId, id)?.contextId !== connection.contextId) continue
        inputs.push({
          message: agentSessionMessageService.getSessionMessage(entry.sessionId, id),
          systemReminder: true
        })
      }
    if (!inputs.length) return ids.some((id) => owned.has(id))
    if (!followUp) {
      const run = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
      if (run && this.isTurnLive(entry, run)) {
        this.attachRunInputs(entry, run, inputs)
        return true
      }
      return false
    }
    const turn = this.reservePlacedRun(entry, inputs)
    if (turn && followUp) this.awaitFollowedOutcome(entry)
    if (turn) this.applyRuntimeStateEvent(entry, { type: 'run-placed', turn })
    return turn !== undefined
  }

  /** A follow-up settles the open reply as answered; Durable reports its input's outcome only when the run ends. */
  private awaitFollowedOutcome(entry: AgentSessionRuntimeEntry): void {
    const execution = entry.runtimeState.execution
    if (execution.kind !== 'turn' && execution.kind !== 'autonomous-turn') return
    const { turn, delivery } = execution.reply
    if (delivery.kind !== 'open') return
    const outcomes = turn.taskIds.flatMap((id) => turn.inputOutcomes?.get(id) ?? [])
    const pending = new Set(turn.taskIds.filter((id) => !turn.inputOutcomes?.has(id)))
    const followed = { runId: turn.runId, pending, outcomes }
    for (const id of pending) (entry.followedReplies ??= new Map()).set(id, followed)
    if (!pending.size) this.correctFollowedRun(entry, followed, this.currentConnection(entry)?.contextId)
  }

  private attachRunInputs(
    entry: AgentSessionRuntimeEntry,
    run: AgentSessionRun,
    inputs: AgentRuntimeUserInput[]
  ): void {
    const taskIds = [...new Set([...run.taskIds, ...inputs.map(({ message }) => message.id)])]
    agentSessionMessageService.linkReply(entry.sessionId, taskIds, run.runId)
    run.taskIds = taskIds
    this.attachPendingRunCheckpoints(entry, run)
  }

  private attachPendingRunCheckpoints(entry: AgentSessionRuntimeEntry, run: AgentSessionRun): void {
    for (const id of run.taskIds) {
      const anchor = entry.pendingRunCheckpoints?.get(id)
      if (!anchor) continue
      run.forkAnchor = anchor
      entry.pendingRunCheckpoints!.delete(id)
    }
  }

  private reservePlacedRun(
    entry: AgentSessionRuntimeEntry,
    inputs: AgentRuntimeUserInput[]
  ): AgentSessionRun | undefined {
    if (!this.isCurrentEntry(entry)) return undefined
    const source = this.currentTurn(entry)
    const input = inputs[0]
    if (!source || !input) return undefined
    const turn = createSessionRun({
      runId: agentSessionMessageService.replyTo(entry.sessionId, input.message.id)?.id,
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
    return turn
  }

  private getAgentExecutionId(
    agent: AgentEntity | null | undefined,
    sessionModelOverride?: UniqueModelId | null
  ): ExecutionId | undefined {
    if (!agent) return
    const driver = runtimeDriverRegistry.getAgentSessionDriver(agent.type)
    return driver?.getExecutionId ? driver.getExecutionId(agent) : (sessionModelOverride ?? agent.model ?? undefined)
  }

  /**
   * Best-effort read of a session's model override for runtime bookkeeping.
   * Returns null when the session is gone (callers keep prior behavior) and
   * never throws: entry bookkeeping must not fail on a stale entry.
   */
  private readSessionModelOverride(sessionId: string): UniqueModelId | null {
    try {
      const model = agentSessionService.getById(sessionId).model ?? null
      return model && isUniqueModelId(model) ? model : null
    } catch {
      return null
    }
  }

  async changeFollowups(topicId: string, change: AgentSessionFollowupChange): Promise<boolean> {
    if (!isAgentSessionTopic(topicId) || this.isWriteQuiesced || this.isShuttingDown) return false
    const sessionId = extractAgentSessionId(topicId)
    this.assertSessionWritable(sessionId)
    const entry = this.entryForContext(sessionId, extractAgentContextId(topicId))
    if (!entry || entry.topicId !== topicId || entry.closing || entry.stopping) return false
    const connection = this.currentConnection(entry)
    if (change.type === 'steer') {
      const execution = entry.runtimeState.execution
      if (execution.kind !== 'turn' || execution.reply.delivery.kind !== 'open') return false
      const turn = execution.reply.turn
      const inputId = turn.taskIds[0]
      if (!inputId || turn.headless || !this.isTurnLive(entry, turn)) return false
      return (await connection?.changeFollowups?.(change, { inputId, replyId: turn.runId })) ?? false
    }
    return (await connection?.changeFollowups?.(change)) ?? false
  }

  async listSessionCommands(sessionId: string): Promise<AgentSessionSlashCommand[]> {
    const session = agentSessionService.getById(sessionId)
    const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
    if (!agent) return []
    if (agent.type !== 'claude-code' && agent.type !== 'local')
      return AGENT_RUNTIME_CAPABILITIES[agent.type].slashCommands.map(({ command, description }) => ({
        name: command.replace(/^\//, ''),
        description: description ?? '',
        argumentHint: ''
      }))
    const cache = application.get('CacheService')
    const cached = cache.getShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(sessionId))
    if (cached && agent.type !== 'local') return cached
    if (agent.type === 'claude-code' && application.get('ClaudeCodeBinaryService').getStatus().phase !== 'ready')
      return []
    const connection = await this.ensureSessionConnection(sessionId)
    const commands = await connection?.getSupportedCommands?.()
    const entry = this.entries.get(sessionId)
    if (commands && entry && this.currentConnection(entry) === connection)
      cache.setShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(sessionId), commands)
    return commands ?? []
  }

  async setLocalSessionInteractive(windowId: WindowId, sessionId: string, active: boolean): Promise<void> {
    if (!active) {
      if (this.interactiveLocalSessions.get(windowId) === sessionId) this.releaseLocalSessionInterest(windowId)
      return
    }
    if (this.isShuttingDown || this.isWriteQuiesced) return
    const session = agentSessionService.getConversationById(sessionId, { excludeTaskSessions: true })
    const config = this.localConfigForSession(sessionId, session.agentId)
    if (!session.workspace?.path || !config?.enabled || getLocalAgentProtocol(config.presetId) !== 'acp') return

    if (this.interactiveLocalSessions.get(windowId) !== sessionId) {
      this.releaseLocalSessionInterest(windowId)
      this.interactiveLocalSessions.set(windowId, sessionId)
    }
    const entry = this.entries.get(sessionId)
    if (entry) this.clearIdleTimer(entry)
    await this.closingSessions.get(sessionId)?.promise
    if (this.interactiveLocalSessions.get(windowId) === sessionId) await this.ensureSessionConnection(sessionId)
  }

  private releaseLocalSessionInterest(windowId: WindowId): void {
    const sessionId = this.interactiveLocalSessions.get(windowId)
    if (!sessionId) return
    this.interactiveLocalSessions.delete(windowId)
    const entry = this.entries.get(sessionId)
    if (entry) this.refreshIdleTimer(entry)
  }

  private async ensureSessionConnection(
    sessionId: string,
    root?: AgentSessionContextRow
  ): Promise<AgentRuntimeConnection | undefined> {
    this.assertSessionWritable(sessionId)
    if (this.isWriteQuiesced || this.isShuttingDown) throw new Error('Session writes are paused')
    const selected = this.entries.get(sessionId)
    const head = selected?.branchHead ?? agentSessionMessageService.captureHead(sessionId)
    const offBranch =
      root && head && childContexts.branchTx(application.get('DbService').getDb(), sessionId, head)?.id !== root.id
    let entry = offBranch ? this.secondaryRoots.get(root.id) : this.selectRecoveredRoot(sessionId, head)
    if (entry && root && this.currentConnection(entry)?.contextId === root.id) return this.currentConnection(entry)
    if (!entry) {
      const session = agentSessionService.getById(sessionId)
      const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
      const modelId = agent && this.getAgentExecutionId(agent, session.model)
      if (!agent || !modelId) return
      entry = {
        sessionId,
        agentId: agent.id,
        agentType: agent.type,
        modelId,
        runtimeState: createAgentSessionRuntimeState(),
        topicId: buildAgentSessionTopicId(sessionId, offBranch ? root.id : undefined),
        sessionTraceId: agentSessionService.ensureTraceId(sessionId),
        secondaryContextId: offBranch ? root.id : undefined,
        branchHead: offBranch ? (root.anchorMessageId ?? undefined) : head
      }
      if (offBranch) this.secondaryRoots.set(root.id, entry)
      else this.entries.set(sessionId, entry)
    }
    if (!(await this.ensureConnection(entry))) return
    if (this.runtimeStatus(entry) === 'idle') this.refreshIdleTimer(entry)
    return this.currentConnection(entry)
  }

  /**
   * Push side of connection reconcile — a latency optimization over the pull that every fresh turn
   * runs in {@link ensureConnection}: agent edits apply to live/idle connections without waiting for
   * the next message. The connection's `reconcile` re-derives the desired config itself, so no
   * per-field knowledge lives here: safe tool-policy changes, permission mode included, hot-apply
   * even mid-turn, and spawn-frozen changes (model, workspace, skills, sub-models, MCP definitions,
   * …) report 'rebuild'. Inputs that change WITHOUT an agent-updated event
   * (in-session skill toggles, MCP definition edits, workspace switches) have no push at all and are
   * covered by the pull.
   */
  private async handleAgentUpdated(agentId: string, updates: UpdateAgentDto, agent: AgentEntity): Promise<void> {
    const modelEdited = Object.prototype.hasOwnProperty.call(updates, 'model')
    const reconciles: Promise<void>[] = []
    for (const entry of this.entries.values()) {
      if (entry.agentId !== agentId) continue

      // A cleared model (`PATCH { model: null }`) is unroutable only when no
      // session override remains — a session with its own model stays routable.
      const effectiveModel = this.getAgentExecutionId(agent, this.readSessionModelOverride(entry.sessionId))
      if (modelEdited && !effectiveModel) {
        this.invalidateModelClearedEntry(entry)
        continue
      }

      // Bookkeeping: fresh turns are stamped with (and steers gated on) the entry's latest model. A
      // live turn keeps its captured `turn.modelId` regardless. A per-session override wins over
      // the agent default so an agent edit can't clobber a session that pinned its own model.
      if (effectiveModel && entry.modelId !== effectiveModel) {
        entry.modelId = effectiveModel
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
      const target = this.connectionTarget(entry, agent)
      verdict = await connection.reconcile(target)
      if (
        (verdict === 'current' || verdict === 'patched') &&
        target.localPermissionMode &&
        !this.liveTurn(entry) &&
        !isAgentSessionRuntimeTransitioning(entry.runtimeState) &&
        !hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)
      ) {
        verdict = await this.reconcileLocalPermission(entry, connection, target)
      }
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
        // the rebuild.
        const hasLiveTurn =
          this.liveTurn(entry) !== undefined ||
          isAgentSessionRuntimeTransitioning(entry.runtimeState) ||
          hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)
        if (!hasLiveTurn) {
          this.closeConnectionAsync(entry)
          if (
            (entry.pendingInputs?.size || this.hasInteractiveLocalSession(entry.sessionId)) &&
            !entry.closing &&
            !this.isShuttingDown
          ) {
            void this.ensureConnection(entry).catch((error) =>
              logger.warn('Failed to reconnect after runtime configuration changed', {
                sessionId: entry.sessionId,
                error
              })
            )
          }
        }
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

  openTurnStream(input: OpenAgentSessionTurnStreamInput): AgentMessageStreamSource {
    const entry = this.entryForTurn(input.sessionId, (turn) => turn.turnId === input.turnId)
    const turn = entry ? this.currentTurn(entry) : undefined
    if (!entry || entry.closing || !turn || turn.turnId !== input.turnId) {
      throw new Error(`No active agent runtime turn ${input.turnId} for session ${input.sessionId}`)
    }
    if (input.interactionWindowId) entry.interactionWindowId = input.interactionWindowId

    const start = async (controller: NonNullable<AgentSessionRun['controller']>) => {
      try {
        this.clearIdleTimer(entry)
        turn.controller = controller
        this.applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn })
        if (turn.projection) this.publishTurnMessage(entry, turn, turn.projection.replyEntries(turn.runId) ?? [])

        const onAbort = () => {
          // A native abort already ended the run; a retained connection has nothing to stop.
          if (input.signal.reason === 'agent-runtime-aborted' && this.currentConnection(entry)?.retainOnStop) return
          if (this.isTurnLive(entry, turn))
            void this.stopSession(entry.sessionId, input.signal.reason, extractAgentContextId(entry.topicId))
        }
        if (input.signal.aborted) {
          onAbort()
          return
        } else {
          input.signal.addEventListener('abort', onAbort, { once: true })
        }

        controller.enqueue({ type: 'start' })
        // A queued/autonomous handoff owns any chunks that arrived before this controller. The
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
    const parts = new Emitter<AgentPartChange>()
    const reconciled = new Emitter<readonly ExecutionPart[]>()
    return {
      kind: 'messages',
      onPart: parts.event,
      onMessageReconciled: reconciled.event,
      readParts: () => turn.projection?.replyEntries(turn.runId) ?? [],
      stream: new ReadableStream<MessageStreamEvent>({
        start: (controller) =>
          start({
            enqueue: (chunk) => controller.enqueue({ type: 'control', chunk }),
            message: (entries) => reconciled.fire(entries),
            part: (change) => parts.fire(change),
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
      permissionModeOverride?: AgentPermissionMode
      trustedNotifyChannels?: readonly NotifyChannel[]
      messageSnapshot?: MessageSnapshot
      reasoningEffort?: ReasoningEffortOption
      serviceTier?: ServiceTierSelection
      fastMode?: boolean
      /** Answer after the current work instead of steering it. */
      followUp?: boolean
    } = {}
  ): void {
    this.assertSessionWritable(sessionId)
    const entry = this.entries.get(sessionId)
    if (!entry || entry.pendingInputs?.has(message.id)) return

    this.clearIdleTimer(entry)
    const headless = opts.headless === true
    const trustedNotifyChannels = opts.trustedNotifyChannels
    // oxlint-disable-next-line no-restricted-globals -- Capture queued-input model/settings metadata before native placement.
    const messageSnapshot = opts.messageSnapshot ? structuredClone(opts.messageSnapshot) : undefined
    const reasoningEffort = opts.reasoningEffort ?? 'default'
    const serviceTier = opts.serviceTier ?? 'standard'
    const knowledgeBaseIds = getKnowledgeBaseIdsFromParts(message.data.parts ?? []) ?? []
    const fastMode = opts.fastMode === true

    const turn = this.currentTurn(entry)
    // Refresh before steering so a changed session model queues a new turn.
    // Headless inputs continue to use the Agent default.
    const latestEffectiveModel =
      this.getAgentExecutionId(
        agentService.getAgent(entry.agentId),
        headless ? null : this.readSessionModelOverride(sessionId)
      ) ?? entry.modelId
    if (latestEffectiveModel !== entry.modelId) entry.modelId = latestEffectiveModel
    // A changed model/reasoning/service-tier/Fast/knowledge scope must queue as the next turn.
    const configuredKnowledgeBaseIds = agentService.getAgent(entry.agentId)?.knowledgeBaseIds
    const canUseCurrentTurnConfig =
      turn?.modelId === entry.modelId &&
      turn.reasoningEffort === reasoningEffort &&
      turn.serviceTier === serviceTier &&
      turn.fastMode === fastMode &&
      knowledgeScopeEquals(
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, turn.knowledgeBaseIds),
        resolveKnowledgeBaseScope(configuredKnowledgeBaseIds, knowledgeBaseIds)
      )
    const interactive =
      turn !== undefined && !entry.stopping && turn.headless !== true && !headless && canUseCurrentTurnConfig
    const connection = this.currentConnection(entry)
    const nextTurn: QueuedAgentSessionInput = {
      message,
      reasoningEffort,
      serviceTier,
      knowledgeBaseIds,
      fastMode,
      steer: !opts.followUp,
      ...(headless ? { headless } : {}),
      ...(opts.permissionModeOverride ? { permissionModeOverride: opts.permissionModeOverride } : {}),
      ...(trustedNotifyChannels !== undefined ? { trustedNotifyChannels } : {}),
      ...(messageSnapshot ? { messageSnapshot } : {})
    }
    const canSteer =
      interactive &&
      !opts.followUp &&
      entry.runtimeState.execution.kind === 'turn' &&
      entry.runtimeState.execution.reply.delivery.kind === 'open' &&
      this.isTurnLive(entry, turn)
    const native = canSteer
      ? connection?.threadInput?.steer?.submit
      : interactive && opts.followUp
        ? connection?.threadInput?.followUp?.submit
        : undefined
    const generation = entry.connectionGeneration
    const contextId = connection?.contextId
    if (native && contextId && generation) {
      const input: AgentRuntimeUserInput = {
        // oxlint-disable-next-line no-restricted-globals -- Native placement can mutate its submitted message.
        message: structuredClone(message),
        systemReminder: !opts.followUp,
        headless,
        ...(messageSnapshot ? { messageSnapshot } : {})
      }
      bindNativeInput(sessionId, contextId, message)
      const pending = (entry.pendingInputs ??= new Map())
      pending.set(message.id, { input, nextTurn: { ...nextTurn, message: input.message }, generation, contextId })
      const inputId = runtimeId<'input'>(message.id)
      const submit = async () => {
        const result = await native({ inputId, message: input.message, systemReminder: input.systemReminder })
        if (result.inputId !== inputId) throw new Error('Native input receipt names a different input')
        if (result.status === 'rejected' || result.status === 'unsupported') {
          this.fallbackNativeInput(entry, generation, contextId, result)
          return
        }
        if (pending.has(inputId) && this.isCurrentGeneration(entry, generation)) this.publishInputReceipt(entry, result)
        if (result.status === 'acknowledged' && result.facts.includes('locally-handled')) {
          markLocalInput(sessionId, contextId, inputId)
          pending.delete(inputId)
        } else if (!connection.lookupInput && result.status === 'unknown') {
          pending.delete(inputId)
        }
      }
      void submit().catch((error: unknown) => {
        if (pending.has(inputId) && this.isCurrentGeneration(entry, generation))
          this.publishInputDelivery(entry, inputId, 'unknown')
        if (!connection.lookupInput) pending.delete(inputId)
        logger.warn('Native input delivery unknown', { sessionId, inputId, error })
      })
      return
    }
    this.applyRuntimeStateEvent(entry, { type: 'queue-turn', turn: nextTurn })
  }

  markTurnTerminal(sessionId: string, status: AgentSessionRuntimeTerminalStatus, expectedTurnId?: string): void {
    const entry = expectedTurnId
      ? this.entryForTurn(sessionId, (turn) => turn.turnId === expectedTurnId)
      : this.entries.get(sessionId)
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
      entry.runtimeState.execution.kind === 'run-handoff' && entry.runtimeState.execution.source.turn === completedTurn
    this.applyRuntimeStateEvent(entry, { type: 'turn-terminal', turn: completedTurn, status })
    if (status === 'success' && !isRowRoll) this.startPromptPrediction(entry)
    const terminal: AgentSessionTurnTerminalEvent = {
      sessionId,
      assistantMessageId: completedTurn.runId,
      status,
      boundary: isRowRoll ? 'row-roll' : 'turn'
    }
    const stopped = entry.stopping?.input
    // Stop may still replace this reply's status, and deliveries finalize on the first terminal.
    if (stopped?.replyId === terminal.assistantMessageId) stopped.terminal = terminal
    else this._onTurnTerminal.fire(terminal)
    this.refreshIdleTimer(entry)
    if (!this.isSessionBusy(sessionId)) this._onRuntimeIdle.fire({ sessionId })
  }

  /**
   * Ends a session's work after its stream aborts. User Stop on a `retainOnStop` connection only
   * interrupts and keeps the connection; other aborts close the session as before.
   */
  stopSession(sessionId: string, reason: unknown, contextId?: string): Promise<void> {
    const entry = this.entryForContext(sessionId, contextId)
    if (contextId && entry?.topicId !== buildAgentSessionTopicId(sessionId, contextId)) return Promise.resolve()
    const close = (interrupt: boolean) =>
      entry?.secondaryContextId ? this.closeSecondary(entry, interrupt) : this.closeSession(sessionId, interrupt)
    const connection = entry && !entry.closing && !this.isShuttingDown ? this.currentConnection(entry) : undefined
    if (!entry || !connection?.retainOnStop || !connection.interrupt || !USER_STOP_REASONS.has(reason))
      // Durable shutdown preserves work; user Stop must record cancellation before closing.
      return close(!this.isShuttingDown && reason !== 'app-shutdown')
    if (entry.stopping) return entry.stopping.settled
    const confirmation = Promise.withResolvers<void>()
    const turn = this.liveTurn(entry)
    const stopping: NonNullable<AgentSessionRuntimeEntry['stopping']> = {
      connection,
      confirmed: () => confirmation.resolve(),
      settled: Promise.resolve(),
      ...(turn &&
        !turn.continuedInBackground && { input: { ids: turn.taskIds, replyId: turn.runId, outcomes: new Map() } })
    }
    entry.stopping = stopping
    // Stop withdraws queued follow-ups; input arriving after Stop waits for the native confirmation.
    if (entry.agentType === 'pi-durable')
      for (const { message } of entry.runtimeState.queue)
        if (agentSessionMessageService.isStagedFollowup(entry.sessionId, message.id))
          agentSessionMessageService.markUserMessageUnsent(entry.sessionId, message.id)
    this.applyRuntimeStateEvent(entry, { type: 'clear-queue' })
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'stopping', active: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    // The bound includes the native interrupt itself, which awaits admission and child stops.
    const unconfirmed = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Agent runtime stop was not confirmed')), 20_000)
    })
    let interruptSettled = false
    const interrupted = connection.interrupt().finally(() => (interruptSettled = true))
    stopping.settled = Promise.race([interrupted.then(() => confirmation.promise), unconfirmed])
      .then(
        () => this.correctStoppedReply(entry, connection, stopping.input),
        (error) => {
          logger.warn('Agent runtime stop failed; closing the session', { sessionId, error })
          // Closing waits for its interrupt, so a still-pending one would block the close as well.
          return close(interruptSettled)
        }
      )
      .finally(() => {
        clearTimeout(timer)
        if (entry.stopping === stopping) delete entry.stopping
        if (stopping.input?.terminal) this._onTurnTerminal.fire(stopping.input.terminal)
      })
    return stopping.settled
  }

  /** The native run can finish before the stop lands; its outcome then replaces the paused reply. */
  private async correctStoppedReply(
    entry: AgentSessionRuntimeEntry,
    connection: AgentRuntimeConnection,
    stopped: NonNullable<AgentSessionRuntimeEntry['stopping']>['input']
  ): Promise<void> {
    if (!stopped || !connection.contextId) return
    try {
      const outcomes: NativeInputState[] = []
      for (const id of stopped.ids) {
        let outcome = stopped.outcomes.get(id)
        if (!outcome && connection.lookupInput) {
          const recorded = await connection.lookupInput(connection.contextId, id)
          if (recorded.status === 'confirmed' && recorded.value.found) outcome = recorded.value.input
        }
        if (!outcome?.outcome) return
        outcomes.push(outcome)
      }
      const outcome = runInputOutcome(outcomes)
      if (!outcome || outcome.outcome === 'aborted') return
      await application.get('AiStreamManager').drainRuntimeReply(entry.topicId, stopped.replyId)
      if (!this.isCurrentEntry(entry)) return
      // The native settle reports its own terminal in place of the held paused one.
      stopped.terminal = undefined
      this.settleFromNativeOutcome(entry, this.rootProjection(entry, connection.contextId), stopped.replyId, outcome)
    } catch (error) {
      logger.warn('Failed to apply the native outcome to a stopped reply', { sessionId: entry.sessionId, error })
    }
  }

  closeSession(sessionId: string, interrupt = false): Promise<void> {
    const entry = this.entries.get(sessionId)
    const attempt = entry && this.connectionAttempts.get(entry)
    if (interrupt && attempt) attempt.interrupt = true
    const priorClosing = this.closingSessions.get(sessionId)
    entry?.prediction?.controller.abort()
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
    for (const entry of this.secondaryRoots.values()) {
      if (entry.sessionId === sessionId) await this.closeSecondary(entry)
    }
    while (this.closingSessions.has(sessionId)) {
      await this.closingSessions.get(sessionId)!.promise
    }
    const failed = this.failedClosures.get(sessionId)
    if (this.entries.has(sessionId)) throw new AgentSessionEditError('close_failed')
    for (const connection of failed ?? []) await this.closeRuntimeConnection(connection, sessionId, true)
    if (this.failedClosures.has(sessionId) || this.entries.has(sessionId)) {
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

  /** Close owned entries only after every matching session is free of turns and background work. */
  async closeIdleSessions(sessionIds: readonly string[]): Promise<boolean> {
    const targets = new Set(sessionIds)
    const entries = [...this.entries.values()].filter((entry) => targets.has(entry.sessionId))
    if (
      entries.some(
        (entry) => this.isSessionBusy(entry.sessionId) || hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)
      )
    )
      return false
    await Promise.all(entries.map((entry) => this.closeSession(entry.sessionId)))
    return true
  }

  private publishSessionClosing(sessionId: string, closing: boolean): void {
    try {
      application.get('CacheService').setShared(AGENT_SESSION_CLOSING_CACHE_KEY(sessionId), closing)
    } catch (error) {
      // Cache broadcast failures must not interrupt session teardown.
      logger.warn('Failed to publish agent session closing state', error as Error, { sessionId })
    }
  }

  private disposeEditInputs(): void {
    for (const record of this.pendingEditInputs.values()) record.dispose()
    this.pendingEditInputs.clear()
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
    if (this.forks.edits.has(sessionId)) return true
    return Iterator.from(this.allEntries()).some((entry) => entry.sessionId === sessionId && this.entryCanWrite(entry))
  }

  private entryCanWrite(entry: AgentSessionRuntimeEntry): boolean {
    return (
      !!entry.closing ||
      isAgentSessionRuntimeBusy(entry.runtimeState) ||
      hasAgentSessionRuntimeBackgroundWork(entry.runtimeState)
    )
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
    if (this.recovery || this.replyRecoveries.size) return true
    for (const entry of this.allEntries()) if (this.entryCanWrite(entry)) return true
    return false
  }

  /** Connections without confirmed teardown still own their runtime transcripts. */
  listClaimedResumeTokens(): ReadonlySet<string> {
    const claimedResumeTokens = new Set<string>()
    for (const entry of this.allEntries()) {
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
    const contextId = extractAgentContextId(topicId)
    const entry = this.entryForContext(extractAgentSessionId(topicId), contextId)
    if (entry?.topicId !== topicId) return false
    // A native run handoff keeps the stream alive until its successor carries the listeners.
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
      assistantMessageId: turn?.runId,
      status: this.runtimeStatus(entry),
      pendingMessageCount: entry.runtimeState.queue.length,
      lastTerminalStatus: entry.runtimeState.lastTerminal,
      resumeToken: entry.lastResumeToken,
      activeToolCount: turn?.activeToolIds.size ?? 0
    }
  }

  // ── Write quiesce (backup restore) ───────────────────────────────
  // Contract shared with JobManager / AiStreamManager / ChannelManager (issues
  // #16849/#16850). Every queued, native Run handoff, receive-only and deferred launch
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
   * Pause autonomous launches: queued follow-ups, native Run handoffs, receive-only wakes
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
      for (const [{ sessionId }, launch] of this.inFlightTurnStarts) {
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
      for (const work of [...this.replyRecoveries, ...(this.recovery ? [this.recovery] : [])]) {
        if (seen.has(work)) continue
        seen.add(work)
        pending.set(work, 'durable-recovery')
        work.then(
          () => pending.delete(work),
          () => pending.delete(work)
        )
      }
      for (const entry of this.allEntries()) {
        const { sessionId } = entry
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
    for (const entry of this.allEntries()) {
      const { sessionId } = entry
      if (!this.entryCanWrite(entry)) continue
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
    if (this.recoveryDue) void this.resumeRecovery().catch((error) => logger.warn('Agent recovery failed', { error }))
    for (const entry of this.allEntries()) {
      if (entry.runtimeState.launch.kind !== 'suppressed') continue
      this.applyRuntimeStateEvent(entry, { type: 'launch-resumed' })
    }
  }

  /**
   * Resolve a Claude `canUseTool` approval registered against this runtime session. Persisted
   * interaction messages are settled before their SDK promise; live overlays are cleared after it.
   * Only an atomically recorded, undelivered decision may be replayed as a user message.
   */
  respondToolApproval(
    approvalId: string,
    decision: DispatchDecision,
    anchorId?: string,
    topicId?: string
  ): AiToolApprovalRespondResponse {
    const pending = toolApprovalRegistry.peek(approvalId)
    if (!pending) {
      // Only the first decision recorded on an abandoned card may become a new user message.
      // A missing registry entry alone also covers decisions already delivered in another window.
      if (anchorId && topicId && isAgentSessionTopic(topicId)) {
        const applied = agentSessionMessageService.applyToolApprovalDecision(
          extractAgentSessionId(topicId),
          anchorId,
          {
            approvalId,
            approved: decision.approved,
            ...(decision.reason !== undefined && { reason: decision.reason }),
            ...(decision.updatedInput !== undefined && { updatedInput: decision.updatedInput })
          },
          'undelivered'
        )
        return { ok: false, reason: applied ? 'undelivered' : 'rejected' }
      }
      return { ok: false, reason: 'rejected' }
    }

    if (pending.presentation === 'application') return { ok: false, reason: 'rejected' }
    const prepared = prepareAgentConfigApproval(approvalId, decision)
    const guardedDecision = prepared.decision

    if (pending.presentation === 'message') {
      if (!anchorId) {
        logger.warn('Persisted tool approval response is missing its anchor message', { approvalId })
        return { ok: false, reason: 'rejected' }
      }
      const applied = agentSessionMessageService.applyToolApprovalDecision(
        pending.sessionId,
        anchorId,
        {
          approvalId,
          approved: guardedDecision.approved,
          ...(guardedDecision.reason !== undefined && { reason: guardedDecision.reason }),
          ...(guardedDecision.updatedInput !== undefined && { updatedInput: guardedDecision.updatedInput })
        },
        'live'
      )
      if (!applied) {
        logger.warn('Persisted tool approval response did not match a pending card', {
          approvalId,
          anchorId
        })
        return { ok: false, reason: 'rejected' }
      }
    }

    // A refusal that arrived here is the user's own answer, so drivers may attribute it to them.
    // Registry/abort denials reach dispatch() directly and stay unmarked.
    const executionInput = prepared.executionInput?.()
    const dispatched = toolApprovalRegistry.dispatch(approvalId, {
      ...guardedDecision,
      ...(executionInput && { updatedInput: executionInput }),
      ...(!decision.approved && { reasonSource: 'user' as const })
    })
    if (!dispatched) return { ok: false, reason: 'rejected' }

    if (dispatched.presentation === 'stream') {
      const entry = this.entryForContext(dispatched.sessionId, dispatched.contextId)
      if (entry) {
        getAgentSessionRuntimeNativeTurn(entry.runtimeState)?.projection?.resolveToolApproval(
          dispatched.toolCallId,
          approvalId,
          guardedDecision.approved
        )
      }
      application
        .get('AiStreamManager')
        .resolveToolApproval(
          entry?.topicId ?? buildAgentSessionTopicId(dispatched.sessionId, dispatched.contextId),
          dispatched.toolCallId,
          approvalId,
          guardedDecision.approved
        )
    }
    return { ok: true, ...(decision.approved && !guardedDecision.approved && { approved: false }) }
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

  async messageChild(sessionId: string, contextId: string, text: string): Promise<void> {
    if (this.isShuttingDown || this.isWriteQuiesced) throw new Error('Session writes are paused')
    const child = childContexts.context(contextId)
    if (!child.parentContextId || !child.nativeThreadId) throw new Error('Child native owner is unavailable')
    let root = childContexts.context(child.parentContextId)
    while (root.parentContextId) root = childContexts.context(root.parentContextId)
    if (root.sessionId !== sessionId || childContexts.backend(root.backendId).locator.kind === 'claude-code')
      throw new Error('Child native owner is unavailable')
    const writing = (async () => {
      const connection = await this.ensureSessionConnection(sessionId, root)
      if (!connection?.messageChild || connection.contextId !== root.id)
        throw new Error('Child native owner is unavailable')
      await connection.messageChild(contextId, text)
    })()
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
    return application.get('AiStreamManager').addCompletedRuntimeSpan(entry.topicId, turn.runId, {
      id: `tool:${input.toolCallId}`,
      kind: 'tool-execution',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      startedAt: completedAt - input.durationMs,
      completedAt
    })
  }

  abortPendingTurn(sessionId: string, reason: string, contextId?: string): boolean {
    const entry = this.entryForContext(sessionId, contextId)
    if (!entry || (contextId && entry.topicId !== buildAgentSessionTopicId(sessionId, contextId))) return false
    const turn = this.liveTurn(entry)
    if (!turn || turn.abortController.signal.aborted) return false
    turn.abortController.abort(reason)
    return true
  }

  protected async onStop(): Promise<void> {
    this.isShuttingDown = true
    this.startupRecovery.resolve()
    await Promise.allSettled([...this.replyRecoveries, this.recovery])
    await this.forks.cancel()
    this.disposeEditInputs()
    const streamManager = application.get('AiStreamManager')
    for (const entry of this.allEntries()) {
      if (this.liveTurn(entry)) streamManager.abort(entry.topicId, 'agent-session-runtime-stop')
    }
    await this.closeAll()
    try {
      toolApprovalRegistry.clear('agent-session-runtime-stop')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during stop', { error })
    }
  }

  protected async onDestroy(): Promise<void> {
    this.isShuttingDown = true
    await Promise.allSettled([...this.replyRecoveries, this.recovery])
    childTimelines.subscriptions.dispose()
    await this.forks.cancel()
    this._onApprovalRequested.dispose()
    this.disposeEditInputs()
    await this.closeAll()
    try {
      toolApprovalRegistry.clear('agent-session-runtime-destroy')
    } catch (error) {
      logger.warn('Failed to clear agent runtime approvals during destroy', { error })
    }
    this._onTurnTerminal.dispose()
    this._onRuntimeIdle.dispose()
  }

  private entryForContext(sessionId: string, contextId?: string) {
    const selected = this.entries.get(sessionId)
    if (!contextId || (selected && this.currentConnection(selected)?.contextId === contextId)) return selected
    const owner = this.secondaryRoots.get(contextId)
    return owner?.sessionId === sessionId ? owner : undefined
  }

  private selectRecoveredRoot(sessionId: string, head?: string) {
    const selected = this.entries.get(sessionId)
    if (!head || !this.secondaryRoots.size) return selected
    const context = childContexts.branchTx(application.get('DbService').getDb(), sessionId, head)
    const owner = context && this.secondaryRoots.get(context.id)
    if (!owner) return selected
    if (owner.closing) throw new AgentSessionEditError('busy')
    if (selected) {
      this.assertSessionEditable(sessionId)
      void this.closeSession(sessionId)
    }
    this.secondaryRoots.delete(context.id)
    owner.secondaryContextId = undefined
    if (this.runtimeStatus(owner) === 'idle') owner.branchHead = head
    this.entries.set(sessionId, owner)
    this.setBranchStream(sessionId, owner.topicId)
    return owner
  }

  private *allEntries(): IterableIterator<AgentSessionRuntimeEntry> {
    yield* this.entries.values()
    yield* this.secondaryRoots.values()
  }

  private entryForTurn(sessionId: string, matches: (turn: AgentSessionRun) => boolean) {
    const owns = (entry: AgentSessionRuntimeEntry) =>
      entry.sessionId === sessionId && getAgentSessionRuntimeTurns(entry.runtimeState).some(matches)
    const selected = this.entries.get(sessionId)
    if (selected && owns(selected)) return selected
    return [...this.secondaryRoots.values()].find(owns)
  }

  adoptDurableConnection(
    input: AgentRuntimeConnectInput,
    context: AgentSessionContextRow,
    connection: AgentRuntimeConnection
  ): void {
    const secondary = this.secondaryRoots.get(context.id)
    const selected = this.entries.get(input.sessionId)
    const head = selected?.branchHead ?? agentSessionMessageService.captureHead(input.sessionId)
    const foreground =
      !secondary &&
      ((selected && this.currentConnection(selected)?.contextId === context.id) ||
        (head &&
          childContexts.branchTx(application.get('DbService').getDb(), input.sessionId, head)?.id === context.id))
    const owner = secondary ?? (foreground ? selected : undefined)
    if (owner && (owner.closing || this.connectionAttempts.has(owner) || this.currentConnection(owner))) return
    const entry: AgentSessionRuntimeEntry = owner ?? {
      sessionId: input.sessionId,
      agentId: input.agentId,
      agentType: 'pi-durable',
      modelId: input.modelId,
      secondaryContextId: foreground ? undefined : context.id,
      branchHead: foreground ? head : input.branchHead,
      topicId: buildAgentSessionTopicId(input.sessionId, foreground ? undefined : context.id),
      runtimeState: createAgentSessionRuntimeState()
    }
    if (foreground) this.entries.set(input.sessionId, entry)
    else this.secondaryRoots.set(context.id, entry)
    entry.recoveryHeadless = input.headless
    const attemptId = uuidv7()
    entry.connectionGeneration = attemptId
    this.applyRuntimeStateEvent(entry, { type: 'connection-started', attemptId })
    this.observeConnection(entry, connection, input.modelId, attemptId)
    if (entry.pendingInputs?.size) {
      void this.reconcilePendingInputs(entry, connection, attemptId).catch((error) =>
        logger.warn('Failed to reconcile pending inputs on adopted connection', {
          sessionId: entry.sessionId,
          error
        })
      )
    }
  }

  private isCurrentEntry(entry: AgentSessionRuntimeEntry): boolean {
    if (this.entries.get(entry.sessionId) === entry) return true
    return !!entry.secondaryContextId && this.secondaryRoots.get(entry.secondaryContextId) === entry
  }

  /** Resolve live work against its captured configuration; idle connections follow the agent's current settings. */
  private connectionTarget(
    entry: AgentSessionRuntimeEntry,
    // `agentService.getAgent` is four queries (the row, its MCPs, its knowledge bases, the model
    // name) and is not cached, so a caller that already holds the agent hands it over rather than
    // paying for it again. The push reconcile is the one that matters: it walks every session of
    // one agent and already has the updated entity.
    agent: AgentEntity | null = agentService.getAgent(entry.agentId)
  ): AgentSessionConnectionTarget {
    const localWorkingDirectory =
      entry.agentType === 'local' ? agentSessionService.getById(entry.sessionId).workspace.path : undefined
    const turn = this.currentTurn(entry)
    const localPermissionMode =
      entry.agentType === 'local' && !entry.secondaryContextId ? agent?.configuration?.permission_mode : undefined
    const live =
      turn &&
      (this.isTurnLive(entry, turn) ||
        isAgentSessionRuntimeTransitioning(entry.runtimeState) ||
        hasAgentSessionRuntimeBackgroundWork(entry.runtimeState))
    return live
      ? {
          localWorkingDirectory,
          ...(localPermissionMode && !turn.headless && !turn.permissionModeOverride ? { localPermissionMode } : {}),
          modelId: turn.modelId,
          reasoningEffort: turn.reasoningEffort,
          serviceTier: turn.serviceTier,
          knowledgeBaseIds: turn.knowledgeBaseIds,
          fastMode: turn.fastMode,
          headless: turn.headless === true,
          ...(turn.permissionModeOverride ? { permissionModeOverride: turn.permissionModeOverride } : {}),
          trustedNotifyChannels: turn.trustedNotifyChannels
        }
      : {
          localWorkingDirectory,
          ...(localPermissionMode ? { localPermissionMode } : {}),
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
      current.localWorkingDirectory === target.localWorkingDirectory &&
      current.localPermissionMode === target.localPermissionMode &&
      current.modelId === target.modelId &&
      current.reasoningEffort === target.reasoningEffort &&
      current.serviceTier === target.serviceTier &&
      current.fastMode === target.fastMode &&
      (current.headless === true) === (target.headless === true) &&
      current.permissionModeOverride === target.permissionModeOverride &&
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
          (entry.agentType !== 'local' ||
            closing.entry?.localWorkingDirectory === this.connectionTarget(entry).localWorkingDirectory) &&
          agentSessionMessageService.sharesBranch(entry.sessionId, entry.branchHead, closing.branchHead)
        ) {
          entry.lastResumeToken = closing.resumeToken
        }
        continue
      }

      const target = this.connectionTarget(entry)
      const connection = this.currentConnection(entry)
      if (connection) {
        // Reconciliation would close an admitted native execution, including its queued Run handoff.
        // Fresh unadmitted work still reconciles to the current configuration.
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
          verdict =
            entry.localWorkingDirectory !== target.localWorkingDirectory
              ? 'rebuild'
              : await connection.reconcile(target)
          if ((verdict === 'current' || verdict === 'patched') && target.localPermissionMode) {
            verdict = await this.reconcileLocalPermission(entry, connection, target)
          }
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
            if (!this.connectionTargetEquals(entry, target)) continue
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
      const existingAttempt = this.connectionAttempts.get(entry)
      if (existingAttempt) {
        await existingAttempt.promise.catch(() => false)
        continue
      }

      const attemptId = crypto.randomUUID()
      entry.connectionGeneration = attemptId
      this.applyRuntimeStateEvent(entry, { type: 'connection-started', attemptId })
      this.publishLocalSessionInfo(entry, null)
      const connecting = this.connect(entry, target, attemptId).finally(() => {
        if (this.connectionAttempts.get(entry)?.id === attemptId) {
          this.connectionAttempts.delete(entry)
        }
        if (
          this.isCurrentEntry(entry) &&
          entry.runtimeState.connection.kind === 'connecting' &&
          entry.runtimeState.connection.attemptId === attemptId
        ) {
          this.applyRuntimeStateEvent(entry, { type: 'connection-disconnected' })
          this.publishLocalSessionInfo(entry, null)
        }
      })
      this.connectionAttempts.set(entry, { id: attemptId, promise: connecting })
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
    // A prewarmed native session belongs to its original directory, even before the first input.
    if (entry.localWorkingDirectory && entry.localWorkingDirectory !== target.localWorkingDirectory) {
      entry.lastResumeToken = undefined
    }
    entry.localWorkingDirectory = target.localWorkingDirectory

    const localOverrides =
      entry.agentType === 'local' && !target.headless ? this.getLocalSessionOverrides(entry.sessionId) : undefined
    const request: AgentRuntimeConnectInput = {
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      modelId: target.modelId,
      reasoningEffort: target.reasoningEffort,
      serviceTier: target.serviceTier,
      knowledgeBaseIds: target.knowledgeBaseIds,
      fastMode: target.fastMode,
      headless: target.headless,
      ...(target.localPermissionMode ? { localPermissionMode: target.localPermissionMode } : {}),
      ...(target.permissionModeOverride ? { permissionModeOverride: target.permissionModeOverride } : {}),
      resumeToken: entry.lastResumeToken,
      trace: this.sessionTraceContext(entry, target.modelId),
      nativeSessionId: agentSessionMessageService.getNativeSessionId(entry.sessionId, entry.branchHead),
      branchHead: entry.branchHead,
      ...this.inputCallbacks(entry, attemptId)
    }
    const connection = await driver.connect(request).catch((error: unknown) => {
      if (error instanceof LocalAgentSessionRestoreError)
        this.publishLocalSessionInfo(entry, null, { restoreUnavailable: true })
      throw error
    })
    const attempt = this.connectionAttempts.get(entry)
    const interrupt = attempt?.id === attemptId && attempt.interrupt
    const owner = connection.contextId && this.entryForContext(entry.sessionId, connection.contextId)
    if (owner && owner !== entry && this.currentConnection(owner) === connection) {
      if (this.isCurrentEntry(entry)) throw new AgentSessionEditError('busy')
      return false
    }
    let staleLocal = false
    if (connection.localRuntime) {
      try {
        staleLocal = (await connection.reconcile(target)) !== 'current'
      } catch (error) {
        await this.closeRuntimeConnection(connection, entry, false, interrupt)
        throw error
      }
    }
    if (
      staleLocal ||
      !this.isCurrentGeneration(entry, attemptId) ||
      entry.closing ||
      !this.connectionTargetEquals(entry, target)
    ) {
      await this.closeRuntimeConnection(connection, entry, false, interrupt)
      return false
    }

    try {
      if (localOverrides && !(await this.restoreLocalSessionOverrides(entry, connection, attemptId, localOverrides))) {
        await this.closeRuntimeConnection(connection, entry, false, interrupt)
        return false
      }
      if (
        target.localPermissionMode &&
        (await this.applyLocalPermission(connection, target.localPermissionMode)) === 'rebuild'
      ) {
        throw new Error('The agent did not start with the configured permission mode')
      }
    } catch (error) {
      await this.closeRuntimeConnection(connection, entry, false, interrupt)
      throw error
    }
    if (
      ((localOverrides || target.localPermissionMode) && !this.connectionTargetEquals(entry, target)) ||
      !this.observeConnection(entry, connection, target.modelId, attemptId)
    ) {
      await this.closeRuntimeConnection(connection, entry, false, interrupt)
      return false
    }
    if (connection.localSessionInfo) this.publishLocalSessionInfo(entry, connection.localSessionInfo)
    await this.reconcilePendingInputs(entry, connection, attemptId)
    return (
      this.isCurrentGeneration(entry, attemptId) &&
      this.currentConnection(entry) === connection &&
      (connection.preparedFor?.(request) ?? true)
    )
  }

  private inputCallbacks(
    entry: AgentSessionRuntimeEntry,
    attemptId: string
  ): Pick<AgentRuntimeConnectInput, 'onSteerInjected'> {
    return {
      onSteerInjected: (inputIds) => {
        const run = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        if (run && this.isTurnLive(entry, run) && this.isCurrentGeneration(entry, attemptId))
          this.attachRunInputs(entry, run, this.pendingInputValues(entry, inputIds))
      }
    }
  }

  private observeConnection(
    entry: AgentSessionRuntimeEntry,
    connection: AgentRuntimeConnection,
    modelId: ExecutionId,
    attemptId: string
  ): boolean {
    if (this.currentConnection(entry) === connection) return this.isCurrentGeneration(entry, attemptId)
    this.applyRuntimeStateEvent(entry, { type: 'connection-connected', attemptId, connection })
    if (this.currentConnection(entry) !== connection) return false
    connection.bindInputs?.(this.inputCallbacks(entry, attemptId))
    entry.contextUsageModel = modelId
    entry.usageCapture = connection.usageCapture
    this.resetConnectionRuntimeState(entry, connection)
    this.publishRuntimeControls(entry, connection)
    if (this.runtimeStatus(entry) === 'active') this.refreshContextUsage(entry, connection)
    const connectionLoop = this.runConnectionLoop(entry, connection).finally(() => {
      if (this.isCurrentEntry(entry) && this.currentConnection(entry) === connection && !entry.closing) {
        void this.closeRuntimeConnection(connection, entry)
        this.resetConnectionRuntimeState(entry, connection)
        this.applyRuntimeStateEvent(entry, { type: 'connection-disconnected', connection })
        this.publishRuntimeControls(entry)
        entry.connectionGeneration = undefined
        if (entry.secondaryContextId) this.secondaryRoots.delete(entry.secondaryContextId)
      }
      if (entry.stopping?.connection === connection) entry.stopping.confirmed()
      if (entry.connectionLoop === connectionLoop) entry.connectionLoop = undefined
    })
    entry.connectionLoop = connectionLoop
    return true
  }

  private isCurrentGeneration(entry: AgentSessionRuntimeEntry, generation: string): boolean {
    return this.isCurrentEntry(entry) && entry.connectionGeneration === generation
  }

  private fallbackNativeInput(
    entry: AgentSessionRuntimeEntry,
    generation: string,
    contextId: string,
    result: Extract<SubmitResult, { status: 'rejected' | 'unsupported' }>
  ): void {
    const pending = entry.pendingInputs?.get(result.inputId)
    if (!pending || pending.contextId !== contextId || pending.generation !== generation) return
    const released = application
      .get('DbService')
      .withWriteTx((tx) =>
        agentSessionMessageService.releaseInputBindingTx(tx, entry.sessionId, result.inputId, contextId)
      )
    if (!released) return
    entry.pendingInputs?.delete(result.inputId)
    const current =
      this.isCurrentGeneration(entry, generation) && this.currentConnection(entry)?.contextId === contextId
    if (current) this.publishInputDelivery(entry, result.inputId)
    if (!current || entry.closing || entry.stopping || result.error.code === 'cancelled-before-dispatch') {
      agentSessionMessageService.markUserMessageUnsent(entry.sessionId, result.inputId)
      return
    }
    this.applyRuntimeStateEvent(entry, { type: 'queue-turn', turn: pending.nextTurn })
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

  private resolvePendingInput(entry: AgentSessionRuntimeEntry, contextId: string, input: NativeInputState): void {
    const inputId = input.inputId
    const pending = entry.pendingInputs?.get(inputId)
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
    for (const [inputId, pending] of [...(entry.pendingInputs ?? [])]) {
      if (
        !this.isCurrentGeneration(entry, generation) ||
        this.currentConnection(entry) !== connection ||
        entry.closing ||
        this.isShuttingDown
      )
        return
      if (pending.generation === generation) continue
      if (entry.pendingInputs?.get(inputId) !== pending) continue
      let result: Awaited<ReturnType<NonNullable<AgentRuntimeConnection['lookupInput']>>>
      try {
        result = await connection.lookupInput(pending.contextId, inputId)
      } catch (error) {
        logger.warn('Pending native input lookup failed', { sessionId: entry.sessionId, inputId, error })
        if (
          !this.isCurrentGeneration(entry, generation) ||
          this.currentConnection(entry) !== connection ||
          entry.closing ||
          this.isShuttingDown
        )
          return
        continue
      }
      if (
        !this.isCurrentGeneration(entry, generation) ||
        this.currentConnection(entry) !== connection ||
        entry.closing ||
        this.isShuttingDown
      )
        return
      if (entry.pendingInputs?.get(inputId) !== pending) continue
      if (result.status === 'confirmed' && result.value.found) {
        const input = result.value.input
        if (input.outcome || input.facts.includes('locally-handled')) {
          this.resolvePendingInput(entry, pending.contextId, input)
          continue
        }
        if (
          entry.agentType === 'pi-durable' &&
          connection.contextId === pending.contextId &&
          (input.facts.includes('queued') || input.facts.includes('placed'))
        ) {
          pending.generation = generation
          if (pending.nextTurn.steer && !input.facts.includes('placed'))
            this.publishInputDelivery(entry, inputId, 'queued')
          continue
        }
        if (input.facts.includes('placed')) {
          entry.pendingInputs?.delete(inputId)
          logger.warn('Clearing already-placed pending native input from prior generation', {
            sessionId: entry.sessionId,
            inputId,
            contextId: pending.contextId
          })
          continue
        }
        if (input.facts.includes('queued')) continue
      }
      if (result.status !== 'confirmed') continue
      pending.generation = generation
      this.fallbackNativeInput(entry, generation, pending.contextId, {
        status: 'rejected',
        inputId: runtimeId<'input'>(inputId),
        error: { operation: 'lookupInput', code: 'not-placed', message: 'Native input was not placed' }
      })
    }
  }

  private hydrateResumeToken(entry: AgentSessionRuntimeEntry): void {
    const imported = getImportedHistoryState(application.get('DbService').getDb(), entry.sessionId)
    if (imported?.status === 'pending') {
      entry.lastResumeToken = imported.nativeSessionId
      return
    }
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
      case 'message.text-open':
      case 'message.text-append':
      case 'message.text-finish':
      case 'message.parts':
      case 'local-tool-terminal':
      case 'message.tool-output': {
        const projection = entry.rootProjections?.get(event.contextId)
        if (!projection) break
        for (const { messageId, patch, completed } of event.type === 'local-tool-terminal'
          ? projection.changeTerminal(event)
          : projection.changePart(event)) {
          const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
          if (turn?.runId === messageId && turn.controller && this.isTurnLive(entry, turn)) {
            if (patch.type === 'part-put' || patch.type === 'part-add') this.clearApiRetry(entry)
            if ((patch.type === 'part-put' || patch.type === 'part-add') && isToolUIPart(patch.part) && !completed)
              turn.activeToolIds.add(patch.part.toolCallId)
            turn.controller.part(patch)
            if (completed) {
              if ((patch.type === 'part-put' || patch.type === 'part-add') && isToolUIPart(patch.part))
                turn.activeToolIds.delete(patch.part.toolCallId)
              this.saveCompletedParts(entry, turn, completed)
            }
          } else if (
            completed ||
            (patch.type === 'part-put' && isToolUIPart(patch.part) && patch.part.state === 'input-available')
          ) {
            const entries = projection.replyEntries(messageId)
            if (entries) this.publishRootMessage(entry, projection, messageId, entries)
          }
        }
        break
      }
      case 'message-projection': {
        const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        const projection = this.rootProjection(entry, event.projection.contextId)
        if (turn) turn.projection = projection
        const owner = event.toolOwner && projection.toolCallMessageId(event.toolOwner.toolCallId)
        if (event.toolOwner?.detached && !owner) break
        const changed = projection.accept(event.projection, owner ?? turn?.runId)
        for (const [id, entries] of changed) this.publishRootMessage(entry, projection, id, entries)
        break
      }
      case 'response-start': {
        const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        if (turn && (!event.messageId || event.messageId === turn.runId)) this.bindUsage(entry, event.responseId, turn)
        else if (event.messageId)
          (entry.usageAttribution ??= new AgentSessionUsageAttribution()).bind(event.responseId, event.messageId)
        break
      }
      case 'resume-token':
        entry.lastResumeToken = event.token
        if (connection?.sessionCostScope === 'native-session') {
          const cached = application.get('CacheService').getShared(AGENT_SESSION_COST_CACHE_KEY(entry.sessionId))
          if (cached?.nativeSessionId !== event.token) {
            const saved = agentSessionMessageService.getSessionCost(entry.sessionId)
            if (saved || cached)
              this.persistSessionCost(
                entry,
                saved?.nativeSessionId === event.token
                  ? saved
                  : { nativeSessionId: event.token, reportedAt: Date.now(), cost: null }
              )
          }
        }
        if (this.runtimeStatus(entry) === 'active') this.refreshContextUsage(entry)
        break
      case 'message-metadata':
      case 'tool-input-available':
      case 'data-retry':
        this.clearApiRetry(entry)
        this.deliverRuntimeChunk(entry, event)
        break
      case 'tool-approval-request':
        this.handleToolApprovalRequest(entry, event.request)
        break
      case 'tool-approval-withdrawn': {
        const projection = entry.rootProjections?.get(event.contextId)
        if (!projection?.isPendingToolApproval(event.toolCallId, event.approvalId)) break
        const messageId = projection.toolCallMessageId(event.toolCallId)
        if (!messageId || !projection.retireToolApproval(event.toolCallId)) break
        application
          .get('AiStreamManager')
          .retireToolApproval(entry.topicId, event.toolCallId, { anchorMessageId: messageId })
        this.publishRootMessage(entry, projection, messageId, projection.replyEntries(messageId) ?? [])
        break
      }
      case 'usage':
        this.recordRuntimeUsage(entry, event.invocation)
        break
      case 'followup-queue':
        if (event.restored && connection?.contextId)
          agentSessionMessageService.stageRestoredFollowups(
            entry.sessionId,
            connection.contextId,
            event.queue.map(({ id }) => id)
          )
        for (const { id, revision, parts } of event.queue) {
          const pending = revision > 0 ? entry.pendingInputs?.get(id) : undefined
          if (pending && pending.generation === entry.connectionGeneration) {
            pending.input.message.data.parts = parts
            pending.nextTurn.message.data.parts = parts
          }
        }
        application.get('CacheService').setShared(AGENT_SESSION_FOLLOWUPS_CACHE_KEY(entry.topicId), event.queue)
        for (const inputId of event.steerIds ?? []) {
          this.publishInputDelivery(entry, inputId, 'queued', true)
          agentSessionMessageService.publishStagedFollowup(entry.sessionId, inputId)
        }
        break
      case 'input-state':
        if (
          event.input.outcome ||
          event.input.facts.includes('locally-handled') ||
          event.input.facts.includes('placed')
        )
          this.publishInputDelivery(entry, event.input.inputId)
        if (event.input.facts.includes('locally-handled')) {
          markLocalInput(entry.sessionId, event.contextId, event.input.inputId)
          if (entry.agentType === 'pi-durable')
            agentSessionMessageService.publishStagedFollowup(entry.sessionId, event.input.inputId)
        }
        if (event.input.facts.includes('placed')) {
          const timeline = this.timelineFor(entry)
          const current = this.currentTurn(entry)
          const pos = agentSessionMessageService.saveInputTimelinePosition(
            entry.sessionId,
            event.input.inputId,
            event.contextId,
            timeline.lastPos,
            entry.agentType === 'pi-durable'
              ? {
                  modelId: current?.modelId ?? entry.modelId,
                  promotion: event.promotion,
                  messageSnapshot:
                    entry.pendingInputs?.get(event.input.inputId)?.input.messageSnapshot ?? entry.messageSnapshot
                }
              : undefined
          )
          if (pos !== undefined) timeline.lastPos = pos
        }
        this.resolvePendingInput(entry, event.contextId, event.input)
        this.noteNativeOutcome(entry, event.contextId, event.input)
        if (event.input.facts.includes('placed') || event.input.outcome)
          connection?.acknowledgeFollowupProjection?.(event.contextId, event.input.inputId)
        break
      case 'steer-boundary':
        for (const inputId of event.inputIds) this.publishInputDelivery(entry, inputId)
        this.startPlacedInputs(entry, event.inputIds, connection)
        break
      case 'run-started':
        for (const inputId of event.inputIds) this.publishInputDelivery(entry, inputId)
        if (entry.deferredPlacements || this.placementWaits(entry))
          (entry.deferredPlacements ??= []).push(event.inputIds)
        else this.startPlacedInputs(entry, event.inputIds, connection, true)
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
      case 'local-turn-usage': {
        const turn = this.liveTurn(entry)
        if (turn) {
          turn.localTurnUsage = event.summary
          this.deliverRuntimeChunk(entry, {
            type: 'message-metadata',
            messageMetadata: { localTurnUsage: event.summary }
          })
        }
        break
      }
      case 'session-cost':
        this.persistSessionCost(entry, event.snapshot)
        break
      case 'context-usage':
        this.persistContextUsage(entry, event.result)
        break
      case 'session-title':
        entry.nativeTitleReceived = true
        if (agentSessionService.updateGeneratedName(entry.sessionId, event.title))
          application.get('IpcApiService').broadcast('ai.agent.session.auto_renamed', { sessionId: entry.sessionId })
        break
      case 'notice': {
        const window = getFullChromeWindowInfos().find((window) => window.isFocused)
        if (window)
          application.get('IpcApiService').send(window.id, 'ai.local_agents.notice', {
            sessionId: entry.sessionId,
            notice: event.notice
          })
        break
      }
      case 'local-session-info':
        this.publishLocalSessionInfo(entry, event.info)
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
        const source = this.currentTurn(entry)
        const background = event.origin.kind === 'background-work'
        const projection = background
          ? connection?.contextId
            ? this.rootProjection(entry, connection.contextId)
            : source?.projection
          : undefined
        const owners = new Set(event.sourceToolCallIds?.map((call) => projection?.toolCallMessageId(call)))
        const sourceReply = source && getAgentSessionRuntimeReply(entry.runtimeState, source)
        const recoveredReply = event.recoveredInputId
          ? agentSessionMessageService.replyTo(entry.sessionId, event.recoveredInputId)?.id
          : undefined
        // A queued input that starts native work has no reply yet; it gets its own instead of a background one.
        if (
          event.recoveredInputId &&
          !recoveredReply &&
          this.startPlacedInputs(entry, [event.recoveredInputId], connection, true)
        )
          break
        const assistantMessageId =
          recoveredReply ??
          (background
            ? sourceReply?.admission === 'pending' || !source
              ? ((owners.size === 1 ? owners.values().next().value : undefined) ??
                projection?.lastMessageId ??
                source?.runId)
              : source.runId
            : undefined)
        if (background) {
          if (!assistantMessageId) {
            logger.warn('Background generation has no existing reply', { sessionId: entry.sessionId })
            break
          }
          const current = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
          const reply = current && getAgentSessionRuntimeReply(entry.runtimeState, current)
          if (
            current?.runId === assistantMessageId &&
            reply &&
            ['open', 'attaching', 'unopened'].includes(reply.delivery.kind)
          ) {
            current.continuedInBackground = true
            this.applyRuntimeStateEvent(entry, { type: 'background-reply-resumed' })
            break
          }
        }
        if (
          entry.runtimeState.execution.kind === 'run-handoff' ||
          entry.runtimeState.execution.kind === 'autonomous-turn'
        )
          break
        const recoveredInput = event.recoveredInputId
        const headless =
          !!entry.secondaryContextId ||
          (recoveredInput
            ? entry.recoveryHeadless !== false
            : this.getInteractionState(entry.sessionId).userResponse === 'unavailable')
        const saved =
          assistantMessageId && assistantMessageId !== source?.runId
            ? agentSessionMessageService.getSessionMessage(entry.sessionId, assistantMessageId)
            : undefined
        const modelId = saved?.modelId ? UniqueModelIdSchema.parse(saved.modelId) : (source?.modelId ?? entry.modelId)
        const turn = createSessionRun({
          ...this.connectionTarget(entry),
          modelId: background ? modelId : entry.modelId,
          taskIds: recoveredInput ? [recoveredInput] : [],
          userMessage: recoveredInput
            ? agentSessionMessageService.getSessionMessage(entry.sessionId, recoveredInput)
            : createSyntheticUserMessage(entry.sessionId),
          parentId: entry.branchHead,
          messageSnapshot: background
            ? (saved?.messageSnapshot ?? source?.messageSnapshot ?? entry.messageSnapshot)
            : entry.messageSnapshot,
          headless,
          origin: event.origin,
          ...(background ? { runId: assistantMessageId } : {})
        })
        if (background) turn.projection = projection
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
      case 'run-checkpoint': {
        if (event.contextId !== connection?.contextId) break
        const run = getAgentSessionRuntimeTurns(entry.runtimeState).find((run) => run.taskIds.includes(event.inputId))
        const runId = run?.runId ?? agentSessionMessageService.replyTo(entry.sessionId, event.inputId)?.id
        if (!runId) {
          ;(entry.pendingRunCheckpoints ??= new Map()).set(event.inputId, event.forkAnchor)
          break
        }
        if (run) run.forkAnchor = event.forkAnchor
        try {
          agentSessionMessageService.saveRunCheckpoint(entry.sessionId, runId, event.forkAnchor)
        } catch (error) {
          logger.warn('Could not persist Run checkpoint', { sessionId: entry.sessionId, runId, error })
        }
        break
      }
      case 'turn-complete': {
        const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
        if (turn) {
          turn.forkAnchor ??= event.forkAnchor
            ? { ...event.forkAnchor, excludedMessageIds: entry.runtimeState.queue.map((item) => item.message.id) }
            : undefined
          // A native abort that Cherry did not start must still end the renderer stream as paused.
          if (event.status === 'paused' && !entry.closing)
            application.get('AiStreamManager').pauseRuntimeTurn(entry.topicId, 'agent-runtime-aborted')
          this.applyRuntimeStateEvent(entry, {
            type: 'runtime-terminal',
            turn,
            outcome: { status: event.status ?? 'success' }
          })
        }
        this.clearApiRetry(entry)
        this.refreshContextUsage(entry)
        break
      }
      case 'stop-confirmed': {
        const stopping = entry.stopping
        if (!stopping || stopping.connection !== connection) break
        this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'stopping', active: false })
        stopping.confirmed()
        this.refreshIdleTimer(entry)
        if (!this.isSessionBusy(entry.sessionId)) this._onRuntimeIdle.fire({ sessionId: entry.sessionId })
        break
      }
      case 'error':
        this.handleRuntimeError(entry, event.error)
        break
      default:
        event satisfies never
    }
  }

  async compactSession(sessionId: string, expectedConnection: string, instructions?: string): Promise<boolean> {
    this.assertSessionWritable(sessionId)
    const entry = this.entries.get(sessionId)
    const connection = entry && this.currentConnection(entry)
    const compact = connection?.compact
    if (
      !entry ||
      !connection ||
      !compact ||
      (instructions && !connection.compactWithInstructions) ||
      entry.connectionGeneration !== expectedConnection ||
      this.isSessionBusy(sessionId)
    )
      return false
    if (
      hasAgentSessionRuntimeBackgroundWork(entry.runtimeState) ||
      [...(entry.pendingInputs?.values() ?? [])].some((pending) => pending.generation === expectedConnection)
    )
      return false

    this.handleCompactionStart(entry, 'manual', false)
    const result = await compact(instructions).catch((error: unknown) => ({
      status: 'unknown' as const,
      error: { code: 'missing-receipt', message: error instanceof Error ? error.message : String(error) }
    }))
    if (!this.isCurrentGeneration(entry, expectedConnection) || this.currentConnection(entry) !== connection)
      return false
    if (result.status === 'confirmed') {
      this.invalidateContextUsage(entry)
      this.handleCompactionComplete(entry)
    } else if (result.status === 'unknown') {
      application.get('CacheService').setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(sessionId), {
        status: 'unknown',
        error: result.error.message
      })
      await this.closeRuntimeConnection(connection, entry, true)
      if (this.isCurrentGeneration(entry, expectedConnection) && this.currentConnection(entry) === connection)
        this.closeConnection(entry)
    } else {
      this.settleCompactionError(
        entry,
        result.error.code === 'cancelled' || result.error.code === 'compact_cancelled'
          ? undefined
          : result.error.message
      )
    }
    if (!this.isSessionBusy(sessionId)) this._onRuntimeIdle.fire({ sessionId })
    return result.status === 'confirmed'
  }

  private publishRuntimeControls(entry: AgentSessionRuntimeEntry, connection?: AgentRuntimeConnection): void {
    if (entry.secondaryContextId || !this.isCurrentEntry(entry)) return
    const generation = entry.connectionGeneration
    const compact = connection?.compact
    application.get('CacheService').setShared(
      AGENT_SESSION_RUNTIME_CONTROLS_CACHE_KEY(entry.sessionId),
      connection && generation
        ? {
            generation,
            compact: !!compact,
            ...(compact && connection.compactWithInstructions && { compactWithInstructions: true }),
            durableFollowUp: connection.threadInput?.followUp?.persistence === 'durable'
          }
        : null
    )
  }

  private publishInputReceipt(
    entry: AgentSessionRuntimeEntry,
    result: Extract<SubmitResult, { status: 'unknown' | 'acknowledged' }>
  ): void {
    const { inputId } = result
    if (result.status === 'unknown') {
      this.publishInputDelivery(entry, inputId, 'unknown')
    } else if (result.facts.includes('placed') || result.facts.includes('locally-handled')) {
      this.publishInputDelivery(entry, inputId)
    } else if (result.facts.includes('queued')) {
      this.publishInputDelivery(entry, inputId, 'queued')
    } else if (result.facts.includes('accepted')) {
      this.publishInputDelivery(entry, inputId, 'accepted')
    }
  }

  private publishInputDelivery(
    entry: AgentSessionRuntimeEntry,
    inputId: string,
    status?: NonNullable<AgentSessionRuntimeControls['delivery']>['status'],
    promoted = false
  ): void {
    if (entry.secondaryContextId) return
    const key = AGENT_SESSION_RUNTIME_CONTROLS_CACHE_KEY(entry.sessionId)
    const cache = application.get('CacheService')
    const view = cache.getShared(key)
    if (!view || view.generation !== entry.connectionGeneration) return
    const pendingSteerIds = view.pendingSteerIds ?? []
    if (
      status &&
      status !== 'unknown' &&
      entry.agentType === 'pi-durable' &&
      (promoted || entry.pendingInputs?.get(inputId)?.nextTurn.steer)
    ) {
      if (!pendingSteerIds.includes(inputId))
        cache.setShared(key, { ...view, pendingSteerIds: [...pendingSteerIds, inputId] })
      return
    }
    if (!status && view.delivery?.inputId !== inputId && !pendingSteerIds.includes(inputId)) return
    cache.setShared(key, {
      ...view,
      pendingSteerIds: status ? view.pendingSteerIds : pendingSteerIds.filter((id) => id !== inputId),
      delivery: status ? { inputId, status } : view.delivery?.inputId === inputId ? undefined : view.delivery
    })
  }

  private handleCompactionStart(
    entry: AgentSessionRuntimeEntry,
    trigger: AgentSessionCompactionTrigger | undefined,
    invalidate = true
  ): void {
    if (invalidate) this.invalidateContextUsage(entry)
    entry.compactionAnchorId = crypto.randomUUID()
    this.deliverRuntimeChunk(entry, {
      type: 'data-compaction-anchor',
      id: entry.compactionAnchorId,
      data: { status: 'compacting', phase: 'agent-session', trigger, startedAt: new Date().toISOString() }
    })
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
    const normalizedModel = normalizeAgentSdkModelAlias(invocation.model)
    const frozenModel = capture.frozenModels.find((candidate) =>
      candidate.aliases.some((alias) => normalizeAgentSdkModelAlias(alias) === normalizedModel)
    )
    const modelId = frozenModel?.modelId ?? normalizedModel
    const apiModelId = frozenModel?.apiModelId ?? normalizedModel
    const record = (entry.usageAttribution ??= new AgentSessionUsageAttribution()).capture(invocation.responseId)
    record({
      requestId: invocation.requestId,
      context: createAiUsageCaptureContext({
        providerId: capture.providerId,
        providerName: capture.providerName,
        modelId,
        modelName: frozenModel?.modelName ?? invocation.model,
        pricingSnapshot: frozenModel?.pricingSnapshot ?? null,
        credentialReceipt: capture.credentialReceipt,
        source: sourceSnapshotFromMessageSnapshot(turn?.messageSnapshot) ?? capture.source
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
    if (anchor || entry.compactionAnchorId)
      this.deliverRuntimeChunk(entry, {
        type: 'data-compaction-anchor',
        id: entry.compactionAnchorId ?? crypto.randomUUID(),
        data: anchor ?? { status: 'skipped', phase: 'agent-session' }
      })
    delete entry.compactionAnchorId
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'compaction', active: false })

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
    if (entry.compactionAnchorId)
      this.deliverRuntimeChunk(entry, {
        type: 'data-compaction-anchor',
        id: entry.compactionAnchorId,
        data: { status: 'skipped', phase: 'agent-session' }
      })
    delete entry.compactionAnchorId
    this.applyRuntimeStateEvent(entry, { type: 'connection-occupancy', occupancy: 'compaction', active: false })
    if (error) logger.warn('Agent session compaction failed', { sessionId: entry.sessionId, error })
    application
      .get('CacheService')
      .setShared(
        AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId),
        error ? { status: 'failed', error } : { status: 'idle' }
      )
  }

  private refreshContextUsage(
    entry: AgentSessionRuntimeEntry,
    connection = this.currentConnection(entry),
    read = connection?.getContextUsage
  ): void {
    if (!connection || !read) return
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
        const result = await read.call(connection)
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
    entry.prediction?.controller.abort()
    entry.contextUsageEpoch = (entry.contextUsageEpoch ?? 0) + 1
    application.get('CacheService').deleteShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(entry.sessionId))
  }

  private persistSessionCost(entry: AgentSessionRuntimeEntry, snapshot: AgentSessionCostSnapshot): void {
    if (!this.isCurrentEntry(entry)) return
    application.get('CacheService').setShared(AGENT_SESSION_COST_CACHE_KEY(entry.sessionId), snapshot)
    try {
      agentSessionMessageService.saveSessionCost(entry.sessionId, snapshot)
    } catch (error) {
      logger.warn('Failed to persist native session cost', { sessionId: entry.sessionId, error })
    }
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
    const connection = entry && this.currentConnection(entry)
    if (!entry || !connection) return
    const now = Date.now()
    if (entry.lastContextUsageRefreshAt && now - entry.lastContextUsageRefreshAt < CONTEXT_USAGE_REFRESH_THROTTLE_MS) {
      return
    }
    entry.lastContextUsageRefreshAt = now
    this.refreshContextUsage(entry, connection, connection.inspectContextUsage ?? connection.getContextUsage)
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

  private backgroundCallIds(entry: AgentSessionRuntimeEntry, turn: AgentSessionRun): Set<string> {
    const pending = getAgentSessionRuntimeReply(entry.runtimeState, turn)?.pendingResultToolCallIds ?? []
    const parts = turn.projection?.parts(turn.runId) ?? []
    return new Set([...pending, ...parts.flatMap((part) => (isToolUIPart(part) ? [part.toolCallId] : []))])
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
    const existing = this.backgroundWorkWaiters.get(entry)
    if (existing?.connection === connection) return existing.promise

    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    this.backgroundWorkWaiters.set(entry, { connection, promise, resolve })
    this.applyRuntimeStateEvent(entry, { type: 'connection-rebuild-deferred', connection, target })
    return promise
  }

  private releaseBackgroundWorkWaiter(entry: AgentSessionRuntimeEntry, connection?: AgentRuntimeConnection): void {
    const waiter = this.backgroundWorkWaiters.get(entry)
    if (!waiter || (connection && waiter.connection !== connection)) return
    this.backgroundWorkWaiters.delete(entry)
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
    const projections = [...(entry.rootProjections?.values() ?? [])]
    let retired: RootMessageProjection | undefined
    if (
      typeof merged.toolUseId === 'string' &&
      (merged.status === 'completed' || merged.status === 'stopped' || merged.status === 'error')
    ) {
      const owners = projections.flatMap((projection) => {
        const messageId = projection.toolCallMessageId(merged.toolUseId as string)
        return messageId ? [{ projection, messageId }] : []
      })
      if (new Set(owners.map((owner) => owner.messageId)).size === 1) {
        const owner = owners[0]
        if (owner.projection.retireToolApproval(merged.toolUseId)) retired = owner.projection
        application.get('AiStreamManager').retireToolApproval(entry.topicId, merged.toolUseId, {
          anchorMessageId: owner.messageId
        })
      } else {
        logger.warn('Cannot uniquely assign terminal task approval', {
          sessionId: entry.sessionId,
          toolCallId: merged.toolUseId,
          messageIds: owners.map((owner) => owner.messageId)
        })
      }
    }
    for (const projection of projections) {
      const messageId =
        projection.taskEvent(merged as unknown as AgentTaskEventPartData) ??
        (projection === retired ? projection.toolCallMessageId(merged.toolUseId as string) : undefined)
      if (messageId) this.publishRootMessage(entry, projection, messageId, projection.replyEntries(messageId) ?? [])
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
      const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
      const hasBufferedInput =
        turn &&
        getAgentSessionRuntimeReply(entry.runtimeState, turn)?.buffer.some(
          (chunk) => chunk.type === 'tool-input-available' && chunk.toolCallId === request.toolCallId
        )
      if (
        turn &&
        (request.providerMetadata?.cherry?.commandPolicy !== undefined ||
          (!hasBufferedInput &&
            !turn.activeToolIds.has(request.toolCallId) &&
            !turn.projection?.toolCallMessageId(request.toolCallId)))
      )
        this.deliverRuntimeChunk(entry, {
          type: 'tool-input-available',
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          input: request.input,
          providerExecuted: true,
          ...(request.providerMetadata ? { providerMetadata: request.providerMetadata } : {})
        })
      const contextId = this.currentConnection(entry)?.contextId
      if (turn) {
        const projection = turn.projection ?? (contextId ? this.rootProjection(entry, contextId) : undefined)
        if (projection) {
          turn.projection = projection
          projection.control(turn.runId, {
            type: 'tool-input-available',
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            input: request.input,
            providerExecuted: true,
            dynamic: true,
            ...(request.providerMetadata ? { providerMetadata: request.providerMetadata } : {})
          })
        }
      }
      const chunk: AgentControlChunk = {
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
            modelId: getProviderModelId(this.connectionTarget(entry).modelId),
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
    if (connection.changeFollowups) cache.setShared(AGENT_SESSION_FOLLOWUPS_CACHE_KEY(entry.topicId), [])
    cache.setShared(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(entry.sessionId), [])
    cache.setShared(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(entry.sessionId), {})
  }

  private handleRuntimeError(entry: AgentSessionRuntimeEntry, error: unknown): void {
    this.clearApiRetry(entry)
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
      (execution.kind === 'run-handoff' ||
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

  private async admitTurn(entry: AgentSessionRuntimeEntry, turn: AgentSessionRun): Promise<void> {
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return
    if (isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turn)) return
    for (
      let connection = this.currentConnection(entry);
      connection?.claimLocalContext;
      connection = this.currentConnection(entry)
    ) {
      if (connection.claimLocalContext(turn.userMessage.id)) break
      this.closeConnectionAsync(entry)
      if (!(await this.ensureConnection(entry))) return
      if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return
      if (isAgentSessionRuntimeTurnAdmitted(entry.runtimeState, turn)) return
    }
    this.applyRuntimeStateEvent(entry, { type: 'turn-admitted', turn })
    // A fresh request starts clean — drop status left over from the previous turn.
    this.clearApiRetry(entry)
    const cache = application.get('CacheService')
    if (cache.getShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId))?.status === 'failed') {
      cache.setShared(AGENT_SESSION_COMPACTION_CACHE_KEY(entry.sessionId), { status: 'idle' })
    }
    await this.refreshTurnTraceContext(entry, turn)
    // A Stop during the await must not reach a connection that it leaves open.
    if (entry.stopping || !this.isTurnLive(entry, turn)) return
    const connection = this.currentConnection(entry)
    if (!connection) throw new Error('Agent runtime connection unavailable')
    const context = await readSessionHistory(entry.sessionId, turn.userMessage.id, connection.contextId)
    if (
      !this.isCurrentEntry(entry) ||
      this.currentTurn(entry) !== turn ||
      !this.isTurnLive(entry, turn) ||
      this.currentConnection(entry) !== connection
    )
      return
    await connection.send({
      message: turn.userMessage,
      systemReminder: turn.systemReminder === true,
      ...(context && { context })
    })
  }

  private publishRootMessage(
    entry: AgentSessionRuntimeEntry,
    projection: RootMessageProjection,
    messageId: string,
    entries: readonly ExecutionPart[]
  ): void {
    const turn = getAgentSessionRuntimeTurns(entry.runtimeState).find((candidate) => candidate.runId === messageId)
    if (turn && !entry.persistedMessageIds?.has(messageId)) {
      this.publishTurnMessage(entry, turn, entries)
      return
    }
    const positions = new Map(entries.flatMap(({ partId, pos }) => (pos === null ? [] : [[partId, pos]])))
    agentSessionMessageService.replaceMessageParts(
      entry.sessionId,
      messageId,
      entries.map(({ payload }) => payload),
      this.rootCheckpoint(entry, projection, messageId),
      entries.map(({ partId }) => partId),
      positions.size ? positions : undefined
    )
    projection.committedReply(messageId)
  }

  private publishTurnMessage(
    entry: AgentSessionRuntimeEntry,
    turn: AgentSessionRun,
    entries: readonly ExecutionPart[]
  ): void {
    if (!turn.controller?.message || !this.isTurnLive(entry, turn)) return
    this.clearApiRetry(entry)
    turn.activeToolIds.clear()
    for (const { payload: part } of entries) {
      if (!isToolUIPart(part)) continue
      if (part.state !== 'output-available' && part.state !== 'output-error' && part.state !== 'output-denied')
        turn.activeToolIds.add(part.toolCallId)
    }
    turn.controller.message(entries)
    this.saveCompletedParts(entry, turn, entries)
  }

  /** Persists parts that reached their own completion; deltas of unfinished parts write nothing. */
  private saveCompletedParts(
    entry: AgentSessionRuntimeEntry,
    turn: AgentSessionRun,
    changed: ExecutionPart | readonly ExecutionPart[]
  ): void {
    const projection = turn.projection
    if (!projection) return
    const completed =
      'partId' in changed && changed.pos !== null
        ? {
            order: { partId: changed.partId, pos: changed.pos },
            parts: new Map([[changed.partId, changed.payload]]),
            positions: new Map([[changed.partId, changed.pos]])
          }
        : projection.completions('partId' in changed ? (projection.replyEntries(turn.runId) ?? []) : changed)
    if (!completed.parts.size) return
    try {
      if (agentSessionMessageService.saveCompletedMessageParts(entry.sessionId, turn.runId, completed))
        projection.committed(completed.parts)
    } catch (error) {
      // Reply completion saves the same parts again; a failed early save only narrows crash recovery.
      logger.warn('Failed to save completed agent reply parts', {
        sessionId: entry.sessionId,
        messageId: turn.runId,
        error
      })
    }
  }

  private rootCheckpoint(entry: AgentSessionRuntimeEntry, projection: RootMessageProjection, savingMessageId: string) {
    const pending = getAgentSessionRuntimeTurns(entry.runtimeState)
      .filter((turn) => turn.runId !== savingMessageId && !entry.persistedMessageIds?.has(turn.runId))
      .map((turn) => turn.runId)
    return projection.checkpoint(new Set(pending))
  }

  private timelineFor(entry: AgentSessionRuntimeEntry): { lastPos: number } {
    return (entry.timeline ??= this.liveTimeline(entry.sessionId) ?? {
      lastPos: agentSessionMessageService.lastTimelinePosition(entry.sessionId)
    })
  }

  private liveTimeline(sessionId: string): { lastPos: number } | undefined {
    for (const entry of this.allEntries()) if (entry.sessionId === sessionId && entry.timeline) return entry.timeline
    return undefined
  }

  private rootProjection(entry: AgentSessionRuntimeEntry, contextId: string): RootMessageProjection {
    const projections = (entry.rootProjections ??= new Map())
    let projection = projections.get(contextId)
    if (!projection) {
      projection = new RootMessageProjection(
        contextId,
        this.timelineFor(entry),
        entry.agentType === 'pi-durable' ? (inputId) => this.unsettledReply(entry, inputId) : undefined
      )
      projections.set(contextId, projection)
    }
    return projection
  }

  private unsettledReply(entry: AgentSessionRuntimeEntry, inputId: string): string | undefined {
    if (entry.stopping?.input?.ids.includes(inputId)) return entry.stopping.input.replyId
    const reply = agentSessionMessageService.replyTo(entry.sessionId, inputId)
    return reply?.status === 'pending' ? reply.id : undefined
  }

  /** Records a native outcome for a reply that no runtime turn will settle. */
  private noteNativeOutcome(entry: AgentSessionRuntimeEntry, contextId: string, input: NativeInputState): void {
    if (entry.agentType !== 'pi-durable' || !input.outcome) return
    if (entry.stopping?.input?.ids.includes(input.inputId)) {
      entry.stopping.input.outcomes.set(input.inputId, input)
      return
    }
    const run = getAgentSessionRuntimeTurns(entry.runtimeState).find((run) => run.taskIds.includes(input.inputId))
    if (run) (run.inputOutcomes ??= new Map()).set(input.inputId, input)
    const followed = entry.followedReplies?.get(input.inputId)
    if (followed) {
      entry.followedReplies!.delete(input.inputId)
      followed.pending.delete(input.inputId)
      followed.outcomes.push(input)
      if (!followed.pending.size) this.correctFollowedRun(entry, followed, contextId)
      return
    }
    const replyId = this.unsettledReply(entry, input.inputId)
    if (replyId && getAgentSessionRuntimeTurns(entry.runtimeState).some((turn) => turn.runId === replyId)) return
    if (replyId)
      void this.recoverPendingReplies({ sessionId: entry.sessionId, runId: replyId }).catch((error) =>
        logger.warn('Could not recover terminal input', { replyId, error })
      )
    // Stop withdraws input Durable had not placed yet, so no reply will ever follow it.
    else if (
      input.outcome === 'aborted' &&
      !input.facts.includes('placed') &&
      !agentSessionMessageService.replyTo(entry.sessionId, input.inputId)
    )
      agentSessionMessageService.markUserMessageUnsent(entry.sessionId, input.inputId)
  }

  private correctFollowedRun(
    entry: AgentSessionRuntimeEntry,
    followed: { runId: string; outcomes: NativeInputState[] },
    contextId: string | undefined
  ): void {
    const outcome = runInputOutcome(followed.outcomes)
    if (contextId && outcome && outcome.outcome !== 'completed')
      void this.correctFollowedReply(entry, contextId, followed.runId, outcome)
  }

  private async correctFollowedReply(
    entry: AgentSessionRuntimeEntry,
    contextId: string,
    replyId: string,
    input: NativeInputState
  ): Promise<void> {
    try {
      await application.get('AiStreamManager').drainRuntimeReply(entry.topicId, replyId)
      if (this.isCurrentEntry(entry))
        this.settleFromNativeOutcome(entry, this.rootProjection(entry, contextId), replyId, input)
    } catch (error) {
      logger.warn('Failed to apply a late Durable outcome to a followed reply', {
        sessionId: entry.sessionId,
        replyId,
        error
      })
    }
  }

  /** Persists a reply with the status that the native outcome maps to. */
  private settleFromNativeOutcome(
    entry: AgentSessionRuntimeEntry,
    projection: RootMessageProjection,
    replyId: string,
    input: NativeInputState
  ): void {
    const terminal = nativeOutcomeTerminal(input)
    if (!terminal) return
    const { status } = terminal
    const row = agentSessionMessageService.getSessionMessage(entry.sessionId, replyId)
    const parts = projection.parts(replyId) ?? row.data.parts ?? []
    const error = terminal.status === 'error' ? serializeError(terminal.error) : undefined
    const message: CherryUIMessage = {
      id: replyId,
      role: 'assistant',
      parts: error
        ? [
            ...parts,
            {
              type: 'data-error',
              data: { ...error, executionFailure: toExecutionFailure(error, row.modelId ?? undefined) }
            }
          ]
        : parts
    }
    new AgentSessionMessageBackend({
      sessionId: entry.sessionId,
      assistantMessageId: replyId,
      modelId: row.modelId ? UniqueModelIdSchema.parse(row.modelId) : undefined,
      runtimeResumeToken: () => entry.lastResumeToken,
      projection: () => this.rootCheckpoint(entry, projection, replyId),
      partPlacement: (messageId) => projection.partPlacement(messageId),
      onPersisted: () => {
        projection.committedReply(replyId)
        ;(entry.persistedMessageIds ??= new Set()).add(replyId)
        entry.usageAttribution?.flush(replyId)
      }
    }).persistAssistant({ finalMessage: projection.prepare(message, status), status })
    this._onTurnTerminal.fire({ sessionId: entry.sessionId, assistantMessageId: replyId, status, boundary: 'turn' })
  }

  private deliverRuntimeChunk(
    entry: AgentSessionRuntimeEntry,
    chunk: Exclude<AgentControlChunk, { type: 'start' }>
  ): boolean {
    const turn = getAgentSessionRuntimeNativeTurn(entry.runtimeState)
    if (!turn) return false
    if (chunk.type !== 'message-metadata') {
      const contextId = this.currentConnection(entry)?.contextId
      if (!turn.projection && contextId) turn.projection = this.rootProjection(entry, contextId)
      if (turn.projection) {
        const change = turn.projection.control(turn.runId, chunk)
        if (change === 'reconcile') {
          const entries = turn.projection.replyEntries(turn.runId)
          if (entries) this.publishTurnMessage(entry, turn, entries)
        } else if (change && turn.controller && this.isTurnLive(entry, turn)) {
          turn.controller.part(change.patch)
          if (change.completed) this.saveCompletedParts(entry, turn, change.completed)
        }
      }
    }
    if (!hasAgentSessionRuntimeOpenStream(entry.runtimeState, turn)) {
      this.applyRuntimeStateEvent(entry, { type: 'buffer-chunk', turn, chunk })
      return true
    }
    this.enqueueTurnChunk(turn, chunk)
    return true
  }

  private enqueueTurnChunk(turn: AgentSessionRun, chunk: AgentControlChunk): void {
    if (chunk.type === 'tool-input-available') turn.activeToolIds.add(chunk.toolCallId)
    turn.controller?.enqueue(chunk)
  }

  /** Pure resource release. Terminality itself lives in the machine (the `settle-turn` transition
   *  is synchronous, so a trailing event in the same connection loop already reads not-live
   *  and never touches the closed controller). */
  private closeTurn(turn: AgentSessionRun): void {
    try {
      turn.controller?.close()
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private errorTurn(turn: AgentSessionRun, error: unknown): void {
    try {
      turn.controller?.error(error)
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private async refreshTurnTraceContext(entry: AgentSessionRuntimeEntry, turn: AgentSessionRun): Promise<void> {
    if (!this.isCurrentEntry(entry) || this.currentTurn(entry) !== turn || !this.isTurnLive(entry, turn)) return
    const traceContext = this.sessionTraceContext(entry, turn.modelId)
    if (traceContext) await this.currentConnection(entry)?.refreshTraceContext?.(traceContext)
  }

  private scheduleRuntimeLaunch(
    entry: AgentSessionRuntimeEntry,
    target: AgentSessionRuntimeLaunchTarget<AgentSessionRun>
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
          if (this.inFlightTurnStarts.get(entry) === launch) this.inFlightTurnStarts.delete(entry)
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
            if (this.inFlightTurnStarts.get(entry) === launch) this.inFlightTurnStarts.delete(entry)
            this.applyRuntimeStateEvent(entry, { type: 'launch-finished', target })
            resolve()
          })
      })
    })
    this.inFlightTurnStarts.set(entry, launch)
  }

  private async startNextTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    if (entry.runtimeState.execution.kind !== 'idle') return
    const pending = entry.runtimeState.queue[0]
    if (!pending) return
    if (entry.agentType === 'pi-durable')
      agentSessionMessageService.publishStagedFollowup(entry.sessionId, pending.message.id)
    const liveAgent = agentService.getAgent(entry.agentId)
    const sessionOverride = pending.headless ? null : this.readSessionModelOverride(entry.sessionId)
    const effectiveModel = this.getAgentExecutionId(liveAgent, sessionOverride)
    if (effectiveModel && effectiveModel !== entry.modelId) {
      entry.modelId = effectiveModel
      this.invalidateContextUsage(entry)
    }
    const effectiveModelName =
      sessionOverride && sessionOverride !== liveAgent?.model
        ? (modelService
            .getNamesByUniqueIdsTx(application.get('DbService').getDb(), [sessionOverride])
            .get(sessionOverride) ?? parseUniqueModelId(sessionOverride).modelId)
        : liveAgent?.modelName
    const turn = createSessionRun({
      taskIds: [pending.message.id],
      userMessage: pending.message,
      parentId: pending.message.id,
      systemReminder: pending.steer === true,
      modelId: entry.modelId,
      messageSnapshot: reconcileSnapshotModel(
        pending.messageSnapshot ?? entry.messageSnapshot,
        entry.modelId,
        effectiveModelName
      ),
      reasoningEffort: pending.reasoningEffort,
      serviceTier: pending.serviceTier,
      knowledgeBaseIds: pending.knowledgeBaseIds,
      fastMode: pending.fastMode,
      headless: pending.headless,
      permissionModeOverride: pending.permissionModeOverride,
      trustedNotifyChannels: pending.trustedNotifyChannels
    })
    this.applyRuntimeStateEvent(entry, { type: 'dequeue-turn' })
    this.applyRuntimeStateEvent(entry, { type: 'begin-turn', turn, reserved: true })
    if (!liveAgent || !effectiveModel) {
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

  private suspendTurn(entry: AgentSessionRuntimeEntry, turn: AgentSessionRun): void {
    const suspended = application.get('AiStreamManager').suspendUnadmittedRuntimeTurn(entry.topicId)
    this.closeTurn(turn)
    void suspended
      .catch((error) => logger.warn('Failed to suspend agent reply', { sessionId: entry.sessionId, error }))
      .finally(() => this.applyRuntimeStateEvent(entry, { type: 'turn-suspended', turn }))
  }

  private saveReply(entry: AgentSessionRuntimeEntry, turn: AgentSessionRun): void {
    const background = turn.origin?.kind === 'background-work'
    if (background) entry.persistedMessageIds?.delete(turn.runId)
    agentSessionMessageService.saveMessage(
      {
        sessionId: entry.sessionId,
        ...turn.projection?.partPlacement(turn.runId),
        parentId: turn.parentId
          ? agentSessionMessageService.branchTip(
              entry.sessionId,
              turn.parentId,
              undefined,
              extractAgentContextId(entry.topicId)
            )
          : undefined,
        message: {
          id: turn.runId,
          role: 'assistant',
          status: 'pending',
          data: { parts: turn.projection?.parts(turn.runId) ?? [] },
          modelId: getProviderModelId(turn.modelId),
          messageSnapshot: turn.messageSnapshot
        }
      },
      { publishDataChange: true }
    )
    agentSessionMessageService.linkReply(entry.sessionId, turn.taskIds, turn.runId)
    this.attachPendingRunCheckpoints(entry, turn)
    if (!background) entry.branchHead = turn.runId
    if (turn.origin)
      application
        .get('CacheService')
        .setShared(AGENT_SESSION_TURN_ORIGIN_CACHE_KEY(entry.sessionId, turn.runId), turn.origin)
    this.applyRuntimeStateEvent(entry, { type: 'turn-prepared', turn })
    entry.usageAttribution?.flush(turn.runId)
  }

  private async prepareReply(entry: AgentSessionRuntimeEntry, turn: AgentSessionRun): Promise<void> {
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
      const messages = createRuntimeSeedMessages(turn.userMessage, turn.runId)
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
          conversation: { id: entry.sessionId, topicId: entry.topicId },
          trigger: 'submit-message',
          messageId: turn.runId,
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

  getInteractionState(sessionId: string, contextId?: string): AgentSessionInteractionState {
    const entry = this.entryForContext(sessionId, contextId)
    if (!entry || (contextId && this.currentConnection(entry)?.contextId !== contextId))
      return { currentTurn: 'none', userResponse: 'unavailable' }

    const turn = this.liveTurn(entry)
    const execution = entry.runtimeState.execution
    const currentTurn = turn ? (turn.headless === true ? 'headless' : 'interactive') : 'none'
    if (execution.kind === 'run-handoff')
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
    modelId: ExecutionId = entry.modelId
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
      { topicId: entry.topicId, modelName: traceModelName(modelId) },
      traceId
    )
    return turnTrace.rootSpan
  }

  /** Container trace passed to the driver as the connection's traceparent. */
  private sessionTraceContext(
    entry: AgentSessionRuntimeEntry,
    modelId: ExecutionId = entry.modelId
  ): AgentRuntimeTraceContext | undefined {
    const traceId = entry.sessionTraceId
    if (!traceId) return undefined
    return {
      topicId: entry.topicId,
      traceId,
      rootSpanId: deriveRootSpanId(traceId),
      sessionId: entry.sessionId,
      turnId: this.currentTurn(entry)?.turnId ?? '',
      modelName: traceModelName(modelId)
    }
  }

  private createPersistenceListener(entry: AgentSessionRuntimeEntry, currentTurn: AgentSessionRun): StreamListener {
    const { runId: assistantMessageId, modelId } = currentTurn
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
        modelId: getProviderModelId(modelId),
        localTurnUsage: () => currentTurn.localTurnUsage,
        runtimeResumeToken: () => entry.lastResumeToken,
        forkAnchor: () => currentTurn.forkAnchor,
        projection: () =>
          currentTurn.projection ? this.rootCheckpoint(entry, currentTurn.projection, currentTurn.runId) : undefined,
        partPlacement: (messageId) => currentTurn.projection?.partPlacement(messageId),
        onPersisted: () => {
          currentTurn.projection?.committedReply(assistantMessageId)
          ;(entry.persistedMessageIds ??= new Set()).add(assistantMessageId)
          entry.usageAttribution?.flush(assistantMessageId)
        },
        afterPersist
      }),
      onPersistFailed: (error) =>
        this.applyRuntimeStateEvent(entry, { type: 'reply-delivery-failed', turn: currentTurn, error })
    })
  }

  private getLocalSessionOverrides(sessionId: string): LocalAgentSessionOverrides | undefined {
    try {
      const store = application.get('CacheService').getPersist?.('local_agent.session_overrides')
      return store?.[sessionId]
    } catch {
      return undefined
    }
  }

  private saveLocalSessionOverride(
    sessionId: string,
    patch: {
      thoughtLevel?: LocalAgentSessionOverrides['thoughtLevel']
      configOption?: { configId: string; value: string | boolean }
    }
  ): void {
    try {
      const cache = application.get('CacheService')
      if (!cache.getPersist || !cache.setPersist) return
      const store = cache.getPersist('local_agent.session_overrides') ?? {}
      const existing = store[sessionId]
      const nextEntry: LocalAgentSessionOverrides = {
        thoughtLevel: patch.thoughtLevel ?? existing?.thoughtLevel,
        configOptions: existing?.configOptions,
        ...(patch.configOption
          ? {
              configOptions: {
                ...existing?.configOptions,
                [patch.configOption.configId]: patch.configOption.value
              }
            }
          : {}),
        updatedAt: Date.now()
      }
      const entries: Array<[string, LocalAgentSessionOverrides]> = [
        [sessionId, nextEntry],
        ...Object.entries(store).filter(([id]) => id !== sessionId)
      ]
      const nextStore = Object.fromEntries(entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, 500))
      cache.setPersist('local_agent.session_overrides', nextStore)
    } catch (error) {
      logger.warn('Failed to persist local session override', error as Error, { sessionId })
    }
  }

  private async restoreLocalSessionOverrides(
    entry: AgentSessionRuntimeEntry,
    connection: AgentRuntimeConnection,
    attemptId: string,
    saved: LocalAgentSessionOverrides
  ): Promise<boolean> {
    const thoughtInfo = connection.localSessionInfo?.thoughtLevel
    if (
      saved.thoughtLevel &&
      connection.setThoughtLevel &&
      thoughtInfo &&
      thoughtInfo.id === saved.thoughtLevel.configId &&
      thoughtInfo.modelId === saved.thoughtLevel.modelId &&
      thoughtInfo.currentValue !== saved.thoughtLevel.value &&
      thoughtInfo.options.some((option) => option.value === saved.thoughtLevel!.value)
    ) {
      try {
        await connection.setThoughtLevel(saved.thoughtLevel.configId, saved.thoughtLevel.value)
      } catch (error) {
        logger.warn('Failed to restore local session thought level override', error as Error, {
          sessionId: entry.sessionId,
          configId: saved.thoughtLevel.configId,
          value: saved.thoughtLevel.value
        })
      }
      if (!this.isCurrentGeneration(entry, attemptId) || entry.closing) {
        return false
      }
    }
    if (saved.configOptions && connection.setConfigOption) {
      for (const [configId, value] of Object.entries(saved.configOptions)) {
        const option = connection.localSessionInfo?.configOptions?.find((item) => item.id === configId)
        if (!option || option.currentValue === value) continue
        if (option.type === 'boolean' && typeof value !== 'boolean') continue
        if (
          option.type === 'select' &&
          (typeof value !== 'string' ||
            !option.options
              .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
              .some((choice) => choice.value === value))
        ) {
          continue
        }
        try {
          await connection.setConfigOption(configId, value)
        } catch (error) {
          logger.warn('Failed to restore local session config option override', error as Error, {
            sessionId: entry.sessionId,
            configId,
            value
          })
        }
        if (!this.isCurrentGeneration(entry, attemptId) || entry.closing) {
          return false
        }
      }
    }
    return this.isCurrentGeneration(entry, attemptId) && !entry.closing
  }

  private localOptionConnection(sessionId: string) {
    const entry = this.entries.get(sessionId)
    return entry?.agentType === 'local' && !entry.closing ? this.currentConnection(entry) : undefined
  }

  async selectLocalSessionModel(sessionId: string, modelId: string) {
    const connection = this.localOptionConnection(sessionId)
    if (!connection?.selectModel || this.isSessionBusy(sessionId))
      throw new Error('Local agent session is unavailable or busy')
    return connection.selectModel(modelId)
  }

  async setLocalConfigOption(sessionId: string, configId: string, value: string | boolean) {
    const connection = this.localOptionConnection(sessionId)
    if (!connection?.setConfigOption || this.isSessionBusy(sessionId))
      throw new Error('Local agent session is unavailable or busy')
    const info = await connection.setConfigOption(configId, value)
    const option = info.configOptions?.find((item) => item.id === configId)
    if (option?.application === 'session' && this.localOptionConnection(sessionId) === connection) {
      this.saveLocalSessionOverride(sessionId, { configOption: { configId, value } })
    }
    return info
  }

  private localIdleView(sessionId: string, agentId?: string | null): LocalAgentSessionView {
    const config = this.localConfigForSession(sessionId, agentId)
    if (!config?.enabled) return { info: null }
    const metadata = this.localViewMetadata(config)
    const isAcp = getLocalAgentProtocol(config.presetId) === 'acp'
    const connecting = isAcp && this.entries.get(sessionId)?.runtimeState.connection.kind === 'connecting'
    if (isAcp && agentSessionService.isOrdinaryConversation(sessionId))
      return { ...metadata, info: null, permissionUnavailable: true, ...(connecting && { connecting: true }) }
    const idleMode = getLocalAgentLaunchMode(config)
    const idleHostPermission = isAcp ? getAcpHostPermissionModeSelection(idleMode) : undefined
    const idleLaunchPermission = getAcpLaunchBypassArgs(config)
      ? getAcpLaunchPermission(idleHostPermission ?? idleMode, false)
      : undefined
    return {
      ...metadata,
      info: null,
      ...(connecting && { connecting: true }),
      idleMode,
      idleHostPermission,
      idleLaunchPermission
    }
  }

  private localConfigForSession(sessionId: string, agentId?: string | null) {
    if (!agentId) return
    const agent = agentService.getAgent(agentId)
    if (agent?.type !== 'local' || !agent.localRuntime?.enabled) return
    const branchHead = this.entries.get(sessionId)?.branchHead
    return resolveLocalContext(sessionId, branchHead)
      ? resolveLocalSessionBinding(sessionId, agentId, branchHead)
      : agent.localRuntime
  }

  private localViewMetadata(config?: LocalAgentRuntime, info?: LocalAgentSessionInfo) {
    if (!config) return {}
    const subscriptionUsage =
      !config.sourceModelViaGateway &&
      (info?.subscriptionUsage ||
        (getLocalAgentPreset(config.presetId)?.subscriptionUsage &&
          (getLocalAgentProtocol(config.presetId) !== 'acp' || usesPresetAcpLaunch(config))))
    return {
      providerId: config.providerId,
      presetId: config.presetId,
      ...(subscriptionUsage && { subscriptionUsage: true as const })
    }
  }

  private async reconcileLocalPermission(
    entry: AgentSessionRuntimeEntry,
    connection: AgentRuntimeConnection,
    target: AgentSessionConnectionTarget
  ): Promise<AgentRuntimeReconcileResult> {
    let previous = this.localPermissionUpdates.get(connection)
    while (previous) {
      if ((await previous) === 'rebuild') return 'rebuild'
      previous = this.localPermissionUpdates.get(connection)
    }
    if (
      !target.localPermissionMode ||
      this.currentConnection(entry) !== connection ||
      !this.connectionTargetEquals(entry, target)
    )
      return 'current'
    const update = this.applyLocalPermission(connection, target.localPermissionMode)
    this.localPermissionUpdates.set(connection, update)
    try {
      return await update
    } finally {
      if (this.localPermissionUpdates.get(connection) === update) this.localPermissionUpdates.delete(connection)
    }
  }

  private async applyLocalPermission(
    connection: AgentRuntimeConnection,
    mode: AgentPermissionMode
  ): Promise<AgentRuntimeReconcileResult> {
    const info = connection.localSessionInfo
    const selection = getLocalSessionPermission(info)
    const choice = getLocalPermissionChoice(selection, mode)
    if (!selection || !choice) throw new Error(`This local agent session does not support permission mode ${mode}`)
    if (
      selection.currentValue === choice.value &&
      (getLocalAgentProtocol(connection.localRuntime?.presetId) !== 'claude' ||
        connection.effectivePermissionMode === mode)
    )
      return 'current'
    if (
      selection.currentValue === ACP_LAUNCH_BYPASS_VALUE ||
      choice.value === ACP_LAUNCH_BYPASS_VALUE ||
      selection.application === 'reconnect' ||
      info?.mode?.application === 'reconnect'
    ) {
      return selection.currentValue === choice.value ? 'current' : 'rebuild'
    }

    const control = info?.hostPermission ?? info?.mode
    if (!control || !connection.setMode) throw new Error('The local agent permission control is unavailable')
    if (control.id === ACP_HOST_PERMISSION_MODE_ID) {
      const nativePlan = getAcpNativePlanModes(info?.mode)
      if (nativePlan && (mode === 'plan' || info?.mode?.currentValue === nativePlan.plan)) {
        await connection.setMode(nativePlan.configId, mode === 'plan' ? nativePlan.plan : nativePlan.work)
      }
      if (mode !== 'plan' && isAcpHostPermissionMode(choice.value)) await connection.setMode(control.id, choice.value)
    } else {
      await connection.setMode(control.id, choice.value)
    }
    if (getLocalSessionPermission(connection.localSessionInfo)?.currentValue !== choice.value)
      throw new Error('The local agent did not confirm the configured permission mode')
    return 'patched'
  }

  async setLocalThoughtLevel(sessionId: string, configId: string, value: string, modelId?: string) {
    const connection = this.localOptionConnection(sessionId)
    if (!connection?.setThoughtLevel || this.isSessionBusy(sessionId))
      throw new Error('Local agent session is unavailable or busy')
    const effort = connection.localSessionInfo?.thoughtLevel
    if (
      !effort ||
      effort.id !== configId ||
      effort.modelId !== modelId ||
      !effort.options.some((option) => option.value === value)
    )
      throw new Error('This session option is no longer available')
    const info = await connection.setThoughtLevel(configId, value)
    if (
      this.localOptionConnection(sessionId) !== connection ||
      info.thoughtLevel?.id !== configId ||
      info.thoughtLevel.modelId !== modelId
    )
      throw new Error('This session option is no longer available')
    if (info.thoughtLevel.currentValue === value)
      this.saveLocalSessionOverride(sessionId, { thoughtLevel: { configId, value, modelId } })
    return info
  }

  getLocalSessionView(sessionId: string): LocalAgentSessionView {
    const connection = this.localOptionConnection(sessionId)
    const info = connection?.localSessionInfo
    if (info) return { ...this.localViewMetadata(connection.localRuntime, info), info }
    const session = agentSessionService.getById(sessionId)
    return this.localIdleView(sessionId, session?.agentId)
  }

  getConnectedLocalRuntime(sessionId: string): LocalAgentRuntime | undefined {
    return this.localOptionConnection(sessionId)?.localRuntime
  }

  private publishLocalSessionInfo(
    entry: AgentSessionRuntimeEntry,
    info: LocalAgentSessionInfo | null,
    options?: { restoreUnavailable: true }
  ): void {
    if (this.isShuttingDown || entry.agentType !== 'local') return
    const prediction = entry.prediction
    if (prediction?.localModelId && prediction.localModelId !== info?.activeModel?.id) prediction.controller.abort()
    const view = info
      ? { ...this.localViewMetadata(this.currentConnection(entry)?.localRuntime, info), info }
      : this.localIdleView(entry.sessionId, entry.agentId)
    application.get('IpcApiService').broadcast('ai.local_agents.session_updated', {
      sessionId: entry.sessionId,
      ...view,
      ...options
    })
  }

  private shouldRetainWhileIdle(entry: AgentSessionRuntimeEntry): boolean {
    if (this.hasInteractiveLocalSession(entry.sessionId)) return true
    if (!this.currentConnection(entry)?.retainWhileIdle) return false
    return entry.agentType !== 'local' || !agentSessionService.isOneOffTaskSession(entry.sessionId)
  }

  private hasInteractiveLocalSession(sessionId: string): boolean {
    return [...this.interactiveLocalSessions.values()].includes(sessionId)
  }

  private refreshIdleTimer(entry: AgentSessionRuntimeEntry): void {
    this.clearIdleTimer(entry)
    if (
      hasAgentSessionRuntimeBackgroundWork(entry.runtimeState) ||
      this.runtimeStatus(entry) !== 'idle' ||
      this.shouldRetainWhileIdle(entry)
    ) {
      return
    }
    entry.idleTimer = setTimeout(() => {
      if (
        !this.isCurrentEntry(entry) ||
        hasAgentSessionRuntimeBackgroundWork(entry.runtimeState) ||
        this.runtimeStatus(entry) !== 'idle' ||
        this.shouldRetainWhileIdle(entry)
      ) {
        return
      }
      const { sessionId, agentType, lastResumeToken } = entry
      if (entry.secondaryContextId) void this.closeSecondary(entry)
      else void this.closeSession(sessionId)
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
    for (const entry of this.secondaryRoots.values()) closings.push(this.closeSecondary(entry))
    return Promise.allSettled(closings).then(() => undefined)
  }

  private async closeSecondary(entry: AgentSessionRuntimeEntry, interrupt = false): Promise<void> {
    await this.closeEntry(entry, interrupt)
    if (this.secondaryRoots.get(entry.secondaryContextId!) === entry)
      this.secondaryRoots.delete(entry.secondaryContextId!)
  }

  private async closeEntry(entry: AgentSessionRuntimeEntry, interrupt = false): Promise<void> {
    this.clearIdleTimer(entry)
    entry.closing = true
    const turns = getAgentSessionRuntimeTurns(entry.runtimeState)
    const streamDrain = Promise.allSettled(
      turns.map((turn) => application.get('AiStreamManager').drainRuntimeReply(entry.topicId, turn.runId))
    )
    for (const turn of turns) this.closeTurn(turn)
    const connectionAttempt = this.connectionAttempts.get(entry)?.promise
    const connection = this.currentConnection(entry)
    const connectionLoop = entry.connectionLoop
    await this.closeRuntimeConnection(connection, entry, true, interrupt)
    if (connectionAttempt) await connectionAttempt.catch(() => undefined)
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
        id: turn.runId,
        role: 'assistant',
        parts: turn.projection?.parts(turn.runId) ?? []
      }
      new AgentSessionMessageBackend({
        sessionId: entry.sessionId,
        assistantMessageId: turn.runId,
        modelId: getProviderModelId(turn.modelId),
        localTurnUsage: () => turn.localTurnUsage,
        runtimeResumeToken: () => entry.lastResumeToken,
        forkAnchor: () => turn.forkAnchor,
        projection: () => (turn.projection ? this.rootCheckpoint(entry, turn.projection, turn.runId) : undefined),
        partPlacement: (messageId) => turn.projection?.partPlacement(messageId),
        onPersisted: () => {
          turn.projection?.committedReply(turn.runId)
          ;(entry.persistedMessageIds ??= new Set()).add(turn.runId)
          entry.usageAttribution?.flush(turn.runId)
        }
      }).persistAssistant({ finalMessage: turn.projection?.prepare(message, status) ?? message, status })
      this.closeTurn(turn)
    }
    if (this.entries.get(entry.sessionId) === entry) {
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
    entry.stopping?.confirmed()
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
    if (connection) {
      this.applyRuntimeStateEvent(entry, { type: 'connection-disconnected', connection })
      this.publishRuntimeControls(entry)
      this.publishLocalSessionInfo(entry, null)
    }
    entry.connectionLoop = undefined
    entry.connectionGeneration = undefined
    return connection
  }

  private closeConnectionAsync(entry: AgentSessionRuntimeEntry): void {
    const connection = this.closeConnection(entry)
    void this.closeRuntimeConnection(connection, entry)
  }

  private async closeRuntimeConnection(
    connection: AgentRuntimeConnection | undefined,
    owner: AgentSessionRuntimeEntry | string,
    strict = false,
    interrupt = false
  ): Promise<void> {
    if (!connection) return
    const entry = typeof owner === 'string' ? undefined : owner
    const sessionId = typeof owner === 'string' ? owner : owner.sessionId
    entry?.prediction?.controller.abort()
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
          if (completedLate && entry?.closing)
            queueMicrotask(() => {
              if (!entry.closing || !this.isCurrentEntry(entry) || this.currentConnection(entry) !== connection) return
              if (entry.secondaryContextId) void this.closeSecondary(entry)
              else void this.closeSession(sessionId)
            })
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

/** Trace label for a model id; local-CLI `runtime:` ids carry no provider split. */
function traceModelName(modelId: ExecutionId): string {
  const providerModelId = getProviderModelId(modelId)
  if (!providerModelId) return modelId.startsWith('runtime:') ? modelId.slice('runtime:'.length) : modelId
  return parseUniqueModelId(providerModelId).modelId
}

// Queued turns keep their submit-time author and record the model that actually runs.
function reconcileSnapshotModel(
  snapshot: MessageSnapshot | undefined,
  modelId: ExecutionId,
  modelName: string | null | undefined
): MessageSnapshot | undefined {
  if (!snapshot) return undefined
  const providerModelId = getProviderModelId(modelId)
  if (!providerModelId) return snapshot
  if (snapshot.model && createUniqueModelId(snapshot.model.provider, snapshot.model.id) === providerModelId)
    return snapshot
  const { providerId, modelId: rawModelId } = parseUniqueModelId(providerModelId)
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

function runInputOutcome(inputs: readonly NativeInputState[]): NativeInputState | undefined {
  if (!inputs.length || inputs.some((input) => !input.outcome)) return undefined
  return (
    inputs.find((input) => input.outcome === 'failed' || input.outcome === 'unanswered') ??
    inputs.find((input) => input.outcome === 'aborted') ??
    inputs[0]
  )
}

function createSessionRun(
  input: Omit<
    AgentSessionRun,
    'turnId' | 'runId' | 'abortController' | 'activeToolIds' | 'controller' | 'projection'
  > & { runId?: string }
): AgentSessionRun {
  return {
    ...input,
    turnId: crypto.randomUUID(),
    runId: input.runId ?? uuidv7(),
    // oxlint-disable-next-line no-restricted-globals -- Detach per-turn model/settings metadata from the caller-owned turn input.
    messageSnapshot: input.messageSnapshot ? structuredClone(input.messageSnapshot) : undefined,
    abortController: new AbortController(),
    activeToolIds: new Set()
  }
}
