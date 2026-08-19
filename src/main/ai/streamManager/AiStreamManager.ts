import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { serializeError } from '@main/ai/utils/serializeError'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
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
import { messageService } from '@main/data/services/MessageService'
import { topicNamingService } from '@main/services/TopicNamingService'
import { shouldDeferToolOutput } from '@main/utils/messageOutputProjection'
import { withIdleTimeout } from '@main/utils/withIdleTimeout'
import { context as otelContext, type Span, SpanStatusCode, trace } from '@opentelemetry/api'
import { type AttemptId, toAttemptId } from '@shared/ai/attempt'
import type {
  ActiveExecution,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenResponse,
  StreamProtocolReplayChunkEvent
} from '@shared/ai/transport'
import { aiStreamAdmissionReasons } from '@shared/ai/transport'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { MessageRuntimeSpan, MessageRuntimeTiming } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { isAgentSessionTopic } from '../agentSession/topic'
import { applyTurnOutputAttributes } from '../observability'
import type { AiStreamRequest, CallOverrides, ContextOwner, InProcessUsageContext } from '../types'
import {
  AiStreamAdmissionError,
  type DispatchCommandReceipt,
  type LiveExecutionChangeAdmission,
  type LiveExecutionChangeIntent,
  type StreamIntent
} from './admission'
import {
  type AttemptEvent,
  type AttemptOutcome,
  type AttemptState,
  executionStatus,
  isAttemptRunning,
  isAttemptSettled,
  publishedOutcome
} from './attemptMachine'
import { buildCompactReplayPlan, mergeDeltaPayload, splitDeltaPayload } from './buildCompactReplay'
import { dispatchStreamRequest, type MainDispatchRequest } from './context/dispatch'
import {
  commitPreparedDispatch,
  type DispatchCommitResult,
  type PreparedDispatchRowResult,
  type PreparedDispatchRows
} from './dispatchCommit'
import { createChatStreamLifecycle } from './lifecycle/ChatStreamLifecycle'
import { promptStreamLifecycle } from './lifecycle/PromptStreamLifecycle'
import type { StreamLifecycle } from './lifecycle/StreamLifecycle'
import { TerminalPersistenceError } from './listeners/PersistenceListener'
import { isRendererListener, WebContentsListener } from './listeners/WebContentsListener'
import { MessageRuntimeTimingCollector } from './MessageRuntimeTimingCollector'
import { pipeStreamLoop } from './pipeStreamLoop'
import { projectStreamChunkPayloadForRenderer } from './rendererPayload'
import { TerminalPersistenceCoordinator, type TerminalRecoveryRecord } from './TerminalPersistenceCoordinator'
import { TopicStreamAggregate } from './TopicStreamAggregate'
import { type ContinuationLeaseId, type ContinuationReleaseReason, toContinuationLeaseId } from './topicStreamState'
import type {
  ActiveStream,
  AiStreamManagerConfig,
  CherryUIMessage,
  StreamChunkMetadata,
  StreamChunkPayload,
  StreamCleanupPort,
  StreamDoneResult,
  StreamErrorResult,
  StreamExecution,
  StreamListener,
  StreamPausedResult,
  StreamPersistencePort,
  TransportTimings
} from './types'
import { withReasoningTimingMetadata } from './withReasoningTimingMetadata'

const logger = loggerService.withContext('AiStreamManager')
type ManagedAiStreamRequest = AiStreamRequest & { usageContext?: InProcessUsageContext }

interface PersistenceDispatchFailure {
  error: SerializedError
  durableErrorWritten: boolean
  blockedPortIds: Set<string>
}

const PERSISTENCE_RETRY_INTERVAL_MS = 5_000

// Renderer→main stream requests (open/attach/detach/abort) are validated by the IpcApi
// router against `aiRequestSchemas` (src/shared/ipc/schemas/ai.ts) before reaching the
// handlers in `src/main/ipc/handlers/ai.ts`, which delegate to the public methods below.

/**
 * Finalize the turn's `ai.turn` span: write the turn-boundary output (final answer + tool
 * count, translation delegated to the obs module), set status, end. Idempotent — subsequent
 * calls no-op because `exec.rootSpan` is cleared.
 */
function endRootSpan(exec: StreamExecution, outcome: 'ok' | 'aborted' | 'error', error?: SerializedError): void {
  const span = exec.rootSpan
  if (!span) return
  exec.rootSpan = undefined
  try {
    if (exec.finalMessage) applyTurnOutputAttributes(span, exec.finalMessage)
    if (outcome === 'ok') {
      span.setStatus({ code: SpanStatusCode.OK })
    } else if (outcome === 'aborted') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'aborted' })
    } else {
      const message = error?.message ?? 'stream execution errored'
      span.setStatus({ code: SpanStatusCode.ERROR, message })
      if (error) span.recordException({ name: error.name ?? 'StreamError', message })
    }
    span.end()
  } catch (err) {
    logger.warn('Failed to end root span', err as Error)
  }
}

/** A single model's request inside a `send()` call. */
export interface SendModelSpec {
  modelId: UniqueModelId
  request: ManagedAiStreamRequest
  runtimeTimingSeed?: MessageRuntimeTiming
  seedFromEmpty?: boolean
  rootSpan?: Span
  abortController?: AbortController
}

type LiveExecutionChange =
  | { mode: 'replace'; parentAnchorId: string; siblingsGroupId?: number }
  | { mode: 'append'; groupAnchorMessageId: string; parentAnchorId: string; siblingsGroupId: number }

export interface SendInput {
  topicId: string
  /** `models.length > 1` → multi-model topic. */
  models: ReadonlyArray<SendModelSpec>
  /** Upserted by id. */
  listeners: StreamListener[]
  persistencePorts?: StreamPersistencePort[]
  cleanupPorts?: StreamCleanupPort[]
  siblingsGroupId?: number
  /** Replace or append one execution in the current live reply group. */
  liveExecutionChange?: LiveExecutionChange
  /** Immutable result of admission; avoids reclassifying after reservation. */
  receipt?: DispatchCommandReceipt
  /** Defaults to chat lifecycle. `streamPrompt` passes `promptStreamLifecycle`. */
  lifecycle?: StreamLifecycle
}

/** Published when a topic is stopped. The agent runtime subscribes to this instead of being called. */
export interface TopicStopSignal {
  readonly topicId: string
  readonly cycleId: number
  readonly reason: string
}

/** A subscriber's answer to `onTopicStop`: it owns a terminal that must land before the topic frees. */
export interface RuntimeTerminalHold {
  readonly terminalReady: Promise<void>
  readonly terminalOutcome: { outcome: 'aborted' } | { outcome: 'error'; error?: SerializedError }
}

export interface SendResult {
  /** `started` = freshly launched executions; `injected` = listeners attached to a running stream. */
  mode: 'started' | 'injected'
  /** Runtime identities launched by this call or currently streaming when it attached. */
  activeExecutions: ActiveExecution[]
}

export interface StartRuntimeTurnInput {
  topicId: string
  modelId: UniqueModelId
  request: ManagedAiStreamRequest
  runtimeTimingSeed?: MessageRuntimeTiming
  listeners: StreamListener[]
  persistencePorts?: StreamPersistencePort[]
  cleanupPorts?: StreamCleanupPort[]
  rootSpan?: Span
  abortController?: AbortController
}

// ── Inspection snapshots ────────────────────────────────────────────
// Read-only snapshots so diagnostics/tests can query state without
// poking `activeStreams`.

export interface ExecutionSnapshot {
  readonly modelId: UniqueModelId
  readonly attemptId: number
  readonly anchorMessageId?: string
  readonly seedFromEmpty?: boolean
  readonly status: ReturnType<typeof executionStatus>
  /** Observer-only — execution's own `AbortController.signal`. */
  readonly abortSignal: AbortSignal
  readonly bufferedChunkCount: number
  readonly droppedChunks: number
  readonly siblingsGroupId?: number
  readonly finalMessage?: CherryUIMessage
  readonly timings: TransportTimings
}

export interface TopicSnapshot {
  readonly topicId: string
  readonly status: ActiveStream['status']
  readonly isMultiModel: boolean
  readonly listenerIds: readonly string[]
  readonly executions: readonly ExecutionSnapshot[]
}

const DEFAULT_CONFIG: AiStreamManagerConfig = {
  gracePeriodMs: 30_000,
  backgroundMode: 'continue',
  maxBufferChunks: 10_000,
  maxDeferredOutputs: 64,
  maxDeltaBytes: 16_384,
  // Generous (2 h) but bounded: a human can deliberate, yet a renderer that never responds (window
  // closed/crashed) can't leave the stream + subprocess hanging until app quit.
  approvalIdleTimeoutMs: 2 * 60 * 60 * 1000
}

/** `pending` covers the pre-first-chunk window — don't compare against `'streaming'` alone. */
function isLiveStatus(status: ActiveStream['status']): boolean {
  return status === 'pending' || status === 'streaming'
}

function isStreamExecuting(stream: ActiveStream | undefined): boolean {
  return Boolean(
    stream &&
      stream.aggregate.lifecycleState === 'active' &&
      [...stream.executions.values()].some((execution) => isAttemptRunning(execution.attempt.state))
  )
}

function isPersistedReplyGroupAnchor(
  messageId: string,
  topicId: string,
  parentAnchorId: string,
  siblingsGroupId?: number
): boolean {
  try {
    const message = messageService.getById(messageId)
    return (
      message.role === 'assistant' &&
      message.topicId === topicId &&
      message.parentId === parentAnchorId &&
      (siblingsGroupId === undefined || message.siblingsGroupId === siblingsGroupId)
    )
  } catch (error) {
    if (isDataApiNotFoundError(error)) return false
    throw error
  }
}

function toActiveExecution(exec: StreamExecution): ActiveExecution {
  return {
    executionId: exec.modelId,
    attemptId: exec.attemptId,
    anchorMessageId: exec.anchorMessageId,
    ...(exec.seedFromEmpty ? { seedFromEmpty: true } : {})
  }
}

function errorFromStreamChunk(errorText: string): SerializedError {
  return { name: 'StreamError', message: errorText, stack: null }
}

function findBufferedToolInput(exec: StreamExecution, toolCallId: string): UIMessageChunk | undefined {
  for (let index = exec.buffer.length - 1; index >= 0; index--) {
    const chunk = exec.buffer[index].chunk
    if (chunk.type === 'tool-input-available' && chunk.toolCallId === toolCallId) return chunk
  }
  return undefined
}

/** The AI SDK `error` chunk carries only `error.message`, so rebuilding from it drops the
 *  `statusCode`/`responseBody` that classification and the error block need. Prefer the
 *  thrown error whenever it still carries them. */
function hasHttpMetadata(error: SerializedError): boolean {
  return error.statusCode != null || error.responseBody != null
}

/**
 * Append this turn's compaction anchors to an accumulated snapshot.
 *
 * The accumulator only sees provider chunks, and anchors are injected into the
 * broadcast branch of the tee — so without this they render live and then
 * disappear on reload. Matched by id so repeated snapshots (and a fold's
 * `compacting` → `done` transition) update in place instead of duplicating.
 * `data-*` parts never reach the model, so adding them cannot perturb the
 * prompt bytes the provider caches.
 *
 * A fold that settled as `skipped` changed nothing, so it leaves no timeline
 * marker: its anchor is dropped here (along with any `compacting` snapshot
 * already recorded under the same id) instead of persisting a part the UI
 * renders as nothing.
 */
function withCompactionAnchors(message: CherryUIMessage, exec: StreamExecution): CherryUIMessage {
  const anchors = exec.compactionAnchors
  if (!anchors?.length) return message
  const parts = [...message.parts]
  for (const anchor of anchors) {
    // Narrow on `type` before reading `id` — only data parts carry one.
    const at = parts.findIndex((p) => p.type === 'data-compaction-anchor' && p.id === anchor.id)
    if (anchor.data.status === 'skipped') {
      if (at >= 0) parts.splice(at, 1)
      continue
    }
    const part: CherryMessagePart = { type: 'data-compaction-anchor', id: anchor.id, data: anchor.data }
    if (at >= 0) parts[at] = part
    else parts.push(part)
  }
  return { ...message, parts }
}

function ensureTerminalFinalMessage(exec: StreamExecution): CherryUIMessage {
  if (exec.finalMessage) return withCompactionAnchors(exec.finalMessage, exec)

  const finalMessage = {
    id: exec.anchorMessageId ?? randomUUID(),
    role: 'assistant',
    parts: []
  } as CherryUIMessage
  exec.finalMessage = finalMessage
  return finalMessage
}

function toolNameFromApprovalChunk(chunk: UIMessageChunk): string | undefined {
  const metadata = (chunk as { providerMetadata?: { cherry?: { toolName?: unknown } } }).providerMetadata
  return typeof metadata?.cherry?.toolName === 'string' ? metadata.cherry.toolName : undefined
}

/**
 * Sentinel subscriber for a main-initiated turn with no live renderer (e.g. a steer continuation
 * whose window closed mid-stream). `isAlive: false` so it's scrubbed on the first dispatch; the
 * turn still runs in the background and a window re-attaches via the status cache.
 */
const nullStreamListener: StreamListener = {
  id: 'null',
  onChunk: () => {},
  onDone: () => {},
  onPaused: () => {},
  onError: () => {},
  isAlive: () => false
}

/** Attach-snapshot outcome for one attempt, using the published (not retained) outcome. */
function toSnapshotOutcome(state: AttemptState): { outcome?: 'success' | 'paused' | 'error'; error?: SerializedError } {
  if (state.phase === 'reserved' || state.phase === 'running') return {}
  const outcome = publishedOutcome(state)
  if (outcome.kind === 'done') return { outcome: 'success' }
  if (outcome.kind === 'aborted') return { outcome: 'paused' }
  return { outcome: 'error', error: outcome.error }
}

/**
 * Active-stream registry. See `docs/references/ai/stream-manager.md`.
 *
 * DO NOT add `@DependsOn(['AiService'])` here — `runExecutionLoop` does
 * `application.get('AiService')` as a runtime back-edge, which is safe
 * because every `send()` caller routes through AiService first. Closing
 * the cycle at init time is unresolvable.
 */
@Injectable('AiStreamManager')
@ServicePhase(Phase.WhenReady)
// Terminal producers must stop before delivery drains: reverse shutdown stops this service first,
// so its last sends are queued before ChannelTerminalDeliveryService stops accepting. ChannelManager
// stays declared explicitly — the adapter pool must outlive terminal sends.
@DependsOn(['ChannelManager', 'ChannelTerminalDeliveryService'])
export class AiStreamManager extends BaseService {
  private readonly activeStreams = new Map<string, ActiveStream>()
  /** Aggregate ownership starts at reservation, before an ActiveStream has runtime resources. */
  private readonly topicAggregates = new Map<string, TopicStreamAggregate>()
  /** Serialises `prepareDispatch → send` per topic so concurrent `Ai_Stream_Open` can't race
   *  the `hasLiveStream` snapshot and orphan a PENDING placeholder row. */
  private readonly dispatchLock = new KeyedMutex()
  private readonly config: AiStreamManagerConfig
  private nextExecutionAttemptSequence = 0
  private nextTopicCycleSequence = 0
  /** Per-topic FIFO of steer user-message ids persisted while a turn was live. Chat's analogue of
   *  the agent runtime's `pendingTurns`; drained one continuation turn at a time. */
  private readonly pendingSteers = new Map<
    string,
    Array<{
      continuationId: string
      userMessageId: string
      reasoningEffort?: ReasoningEffortOption
      fastMode: boolean
    }>
  >()
  /** Topics whose steer continuation is mid-launch — dedups `scheduleNextChatTurn`, mirroring the
   *  agent runtime's explicit launch state. */
  private readonly startingNextChatTopicIds = new Set<string>()
  /** Which open lease is currently launching, per topic. Launch progress is a resource fact:
   *  the reducer only knows a lease is open, never that it is mid-dispatch. */
  private readonly dispatchingLeases = new Map<string, ContinuationLeaseId>()
  /** Terminal holds the agent runtime installed while answering the current `onTopicStop`. */
  private readonly pendingRuntimeTerminalHolds = new Map<string, RuntimeTerminalHold>()
  private readonly topicStopEmitter = new Emitter<TopicStopSignal>()
  /** Fired when a topic is stopped. The agent runtime subscribes; nothing here calls it back. */
  readonly onTopicStop: Event<TopicStopSignal> = this.topicStopEmitter.event
  /** Write-quiesce holds (backup restore). Quiesced ⇔ non-empty. Distinct from the BaseService
   *  lifecycle pause — this never touches service state. See `pause()`. */
  private readonly pauseHolds = new Set<symbol>()
  /** Gate-admitted dispatches still inside `prepareDispatch → send`. Registered before the
   *  first async admission gap can yield to pause/drain, then removed after stream handoff. */
  private readonly inFlightDispatches = new Map<Promise<AiStreamOpenResponse>, string>()
  /** Terminal persistence ports currently writing by topic. Unlike `hasLiveStream`, this remains
   *  true after execution ends and clears before runtime/renderer terminal listeners run. */
  private readonly terminalPersistenceCounts = new Map<string, number>()
  /** Steer continuations suppressed by the write-quiesce gate; the last hold's disposal re-kicks
   *  them (mirrors JobManager's suppressed-fires sets). */
  private readonly suppressedChatContinuationTopicIds = new Set<string>()
  /** In-flight steer-continuation launches (registered synchronously in `scheduleNextChatTurn`),
   *  part of `drainInFlight`'s wait-set — a launch admitted before a pause must be awaited. */
  private readonly inFlightChatContinuations = new Map<string, Promise<void>>()
  /** Durable terminal writes that failed without even an error marker. They stay topic-owned and
   *  retry in-process so a transient database outage cannot leave the aggregate open forever. */
  /** Single owner of blocked terminal writes: parked records, single-flight runs, drain set. */
  private readonly recoveries = new TerminalPersistenceCoordinator()
  /** Shutdown wins over pause-release compensation (same posture as JobManager). */
  private isShuttingDown = false
  /** Constructed once and reused — `dispatchStreamRequest` passes it through `send()`. */
  readonly chatLifecycle: StreamLifecycle

  /**
   * Resolves once `reconcileStalePendingMessages` has run. `dispatch` awaits it before
   * writing any fresh PENDING placeholder, so a stream that opens during boot can't have
   * its placeholder wrongly marked errored by the still-pending crash-orphan reconcile.
   * The old `Ai_Stream_Open` handler enforced this by registering *after* reconcile in
   * `onInit`; the IpcApi handler registers earlier (IpcApiService, BeforeReady), so the
   * ordering guarantee moves onto this gate.
   */
  private markReconciled!: () => void
  private readonly reconciled = new Promise<void>((resolve) => {
    this.markReconciled = resolve
  })

  constructor(config: Partial<AiStreamManagerConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.chatLifecycle = createChatStreamLifecycle(this.config.gracePeriodMs)
  }

  protected async onInit(): Promise<void> {
    // Resolve crash-orphaned PENDING rows before any new stream can be opened — at boot the
    // in-memory registry is empty, so every still-`pending` assistant row is stale.
    this.reconcileStalePendingMessages()
    this.markReconciled()
    this.registerInterval(() => this.retryBlockedPersistence(), PERSISTENCE_RETRY_INTERVAL_MS)
    logger.info('AiStreamManager initialized')
  }

  /**
   * Single locked dispatch entry point for chat streams. Both `ai.stream.open`
   * and the tool-approval continue path (`AiService.respondToolApproval`)
   * route through here so the per-topic `dispatchLock` serialises every dispatch
   * on a topic — not just opens. `prepareDispatch` is async and writes a PENDING
   * placeholder off a `hasLiveStream` snapshot; without one lock covering both
   * entry points, a concurrent open and approval-continue on the same topic could
   * both see "no live stream" and orphan a row.
   */
  async dispatch(subscriber: StreamListener, req: MainDispatchRequest): Promise<AiStreamOpenResponse> {
    // Gate on the boot reconcile so a placeholder written here is never clobbered by it.
    // No-op after boot (resolved promise); the only caller it can actually block is a
    // stream opened in the boot window before reconcile finished.
    await this.reconciled
    return this.withDispatchLock(req.topicId, async () => {
      // Write-quiesce admission gate, re-checked under the lock so a pause landing while this
      // dispatch waited on the mutex still rejects it — the gate must sit before `prepareDispatch`
      // writes the user/pending-assistant rows. `steer-continuation` is exempt: it only originates
      // from `startNextChatTurn`, which is itself gated; the exemption covers the microtask race
      // where a pause lands between that gate and this one, and the grandfathered launch is
      // awaited by `drainInFlight` via `inFlightChatContinuations`.
      if (this.isWriteQuiesced && req.trigger !== 'steer-continuation') {
        return {
          mode: 'blocked' as const,
          reason: 'paused' as const
        }
      }
      const admission = dispatchStreamRequest(this, subscriber, req)
      this.inFlightDispatches.set(admission, req.topicId)
      try {
        return await admission
      } finally {
        this.inFlightDispatches.delete(admission)
      }
    })
  }

  /**
   * Run `fn` under the per-topic dispatch lock. The sole accessor of `dispatchLock`,
   * so every dispatch entry point serialises through one place: `dispatch()` (the chat
   * `Ai_Stream_Open` + approval-continue paths) and `startAgentSessionRun` (scheduler /
   * channel-inbound agent-session runs), which can't use `dispatch()` because it carries
   * extra listeners. Holding the same per-topic lock around their `hasLiveStream →
   * prepareDispatch → send` window stops two runs on one topic from both seeing "no live
   * stream" and orphaning a PENDING placeholder.
   */
  withDispatchLock<T>(topicId: string, fn: () => Promise<T>): Promise<T> {
    return this.dispatchLock.runExclusive(topicId, fn)
  }

  // ── Write quiesce (backup restore) ───────────────────────────────
  // Contract shared with JobManager / AgentSessionRuntimeService / ChannelManager
  // (issues #16849/#16850): pause() gates new-turn ADMISSION (before prepareDispatch
  // writes rows) so a restore snapshot sees no new `agent_session_message`/`message`
  // writes; drainInFlight() awaits everything already writing. Prompt streams
  // (translate / API gateway / topic naming) carry no persistence listener and are
  // neither gated nor drained. `AiService.embedMany` never routes through this
  // manager, so embeddings stay available while quiesced.

  /** True while any write-quiesce hold is live. Public because `startAgentSessionRun` gates on it. */
  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  /**
   * Pause new-turn admission: `dispatch()` returns `{mode:'blocked', reason:'paused'}` and
   * `startAgentSessionRun` throws while any hold is live; queued steer continuations are
   * suppressed (not consumed). In-flight streams keep running until drained. There is
   * deliberately NO resume(): dispose your own hold; the last disposal re-kicks suppressed
   * continuations. A dropped hold fails closed (paused until relaunch).
   */
  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'ai-stream-manager-pause')
    this.pauseHolds.add(token)
    logger.info('AiStreamManager paused', { reason: reason ?? null, holds: this.pauseHolds.size })
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('AiStreamManager pause hold released', { reason: reason ?? null, holds: this.pauseHolds.size })
        if (this.pauseHolds.size > 0) return
        // Shutdown wins: onStop owns the teardown; a compensation kick would only race it.
        if (this.isShuttingDown) return
        this.runReleaseCompensation()
      }
    }
  }

  /**
   * Await in-flight persistence-bearing work, bounded by timeoutMs. Never rejects; stragglers
   * are NOT aborted (the restore orchestrator decides — aborting would settle terminal rows
   * into the snapshot). Wait-set: gate-admitted dispatches until they hand off to the stream
   * registry, live executions of streams that carry a `persistence:*` listener, in-flight
   * steer-continuation launches, and the detached topic/session naming writes
   * (`TopicNamingService.inFlightWrites()` — spawned `void` from PersistenceListener, so a
   * stream's loopPromise settles before they land). The set can GROW one step while draining
   * (an admitted dispatch opens a stream, a settling loop spawns a naming write, or a
   * grandfathered continuation opens a stream), so the drain is a fixed point over promise
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
      for (const [promise, id] of this.drainWaitSet()) {
        if (seen.has(promise)) continue
        seen.add(promise)
        pending.set(promise, id)
        // Single-hop removal: registered before allSettled attaches its handlers, so by the
        // time an allSettled round resolves every settled promise has left `pending`.
        const remove = () => pending.delete(promise)
        promise.then(remove, remove)
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
    for (const [topicId, stream] of this.activeStreams) {
      const unsettled = [...stream.executions.values()].some((execution) => !isAttemptSettled(execution.attempt.state))
      if (!isLiveStatus(stream.status) && !unsettled) continue
      work.push({ id: topicId, summary: `stream:${stream.status} execs=${stream.executions.size}` })
    }
    for (const topicId of new Set(this.inFlightDispatches.values())) {
      work.push({ id: `dispatch:${topicId}`, summary: 'stream dispatch admitting' })
    }
    for (const topicId of this.inFlightChatContinuations.keys()) {
      work.push({ id: `chat-continuation:${topicId}`, summary: 'steer continuation launching' })
    }
    work.push(...this.recoveries.listActiveWork())
    return work
  }

  private drainWaitSet(): Array<[Promise<unknown>, string]> {
    const entries: Array<[Promise<unknown>, string]> = []
    for (const [topicId, stream] of this.activeStreams) {
      // Only streams with a durable projection port are waited on:
      // a chunks-only prompt stream (API gateway, orphan translate) is excluded, while a
      // translate-with-persist carries a TranslationBackend PersistenceListener and IS drained.
      if (stream.persistencePorts.size === 0) continue
      for (const exec of stream.executions.values()) entries.push([exec.loopPromise, topicId])
    }
    for (const [admission, topicId] of this.inFlightDispatches) {
      entries.push([admission, `dispatch:${topicId}`])
    }
    for (const [topicId, launch] of this.inFlightChatContinuations) {
      entries.push([launch, `chat-continuation:${topicId}`])
    }
    entries.push(...this.recoveries.drainWaitSet())
    for (const [key, write] of topicNamingService.inFlightWrites()) {
      entries.push([write, `naming:${key}`])
    }
    return entries
  }

  /** Last-hold release: re-kick suppressed steer continuations. The re-check guard skips
   *  WITHOUT draining the set, so a newer hold (or shutdown) inherits the debt. */
  private runReleaseCompensation(): void {
    if (this.isShuttingDown || this.isWriteQuiesced) return
    void this.retryBlockedPersistence()
    const suppressed = [...this.suppressedChatContinuationTopicIds]
    this.suppressedChatContinuationTopicIds.clear()
    for (const topicId of suppressed) this.scheduleNextChatTurn(topicId)
  }

  /**
   * Resolve assistant rows a prior main-process crash left stuck in `pending`. The streaming
   * loop persists a terminal status only when it settles; if the process died mid-stream the
   * row stays `pending` forever and the UI shows a frozen "thinking" bubble. Runs once at boot,
   * before the open handler is registered, so it can never race a freshly created placeholder.
   */
  private reconcileStalePendingMessages(): void {
    try {
      const staleIds = messageService.findPendingAssistantMessageIds()
      if (staleIds.length === 0) return
      logger.info('Reconciling crash-orphaned pending assistant messages', { count: staleIds.length })
      this.reconcileCrashRecovery(staleIds.length, () => messageService.markMessagesError(staleIds))
    } catch (error) {
      logger.error('Failed to reconcile stale pending messages', { error })
    }
  }

  /** Drive DB-only crash orphans through the same deny-by-default attempt transitions.
   * Their provider execution no longer exists, so the caller supplies the owner-specific write. */
  reconcileCrashRecovery(count: number, persist: () => void): void {
    const aggregate = new TopicStreamAggregate('crash-recovery')
    const attemptIds: AttemptId[] = []
    const apply = (attemptId: AttemptId, event: AttemptEvent) => {
      const state = aggregate.attemptState(attemptId)
      if (!state) throw new Error(`Missing synthetic crash-recovery attempt ${attemptId}`)
      const result = aggregate.transitionAttempt(attemptId, event)
      if (!result.ok) throw new Error(`Illegal crash-recovery transition ${state.phase} × ${event.type}`)
    }

    try {
      for (let index = 0; index < count; index += 1) {
        const attemptId = toAttemptId(++this.nextExecutionAttemptSequence)
        attemptIds.push(attemptId)
        aggregate.reserveAttempt(attemptId)
        apply(attemptId, { type: 'launch' })
        apply(attemptId, { type: 'abort', reason: 'crash-recovery' })
      }
      try {
        persist()
        for (const attemptId of attemptIds) apply(attemptId, { type: 'persisted' })
      } catch (error) {
        const serializedError = serializeError(error)
        for (const attemptId of attemptIds) {
          apply(attemptId, { type: 'persist-failed', error: serializedError, durableErrorWritten: false })
        }
        throw error
      }
    } finally {
      aggregate.evict()
    }
  }

  /**
   * Abort every active stream and await the execution-loop promises so
   * persistence completes before exit. Re-broadcasting `onPaused` from
   * here would double-dispatch against the loop's own terminal event and
   * cause append-only backends to write the assistant turn twice.
   */
  protected async onStop(): Promise<void> {
    this.isShuttingDown = true
    const activeTopics = [...this.activeStreams.entries()]
      .filter(
        ([, stream]) =>
          isLiveStatus(stream.status) ||
          [...stream.executions.values()].some((execution) => !isAttemptSettled(execution.attempt.state))
      )
      .map(([topicId]) => topicId)

    const loopPromises: Promise<void>[] = []
    if (activeTopics.length > 0) {
      logger.info('Stopping active streams on shutdown', { count: activeTopics.length })
      for (const topicId of activeTopics) {
        const stream = this.activeStreams.get(topicId)
        if (!stream) continue
        for (const exec of stream.executions.values()) {
          loopPromises.push(exec.loopPromise)
        }
        this.abort(topicId, 'app-shutdown')
      }
    }

    await Promise.allSettled(loopPromises)
    await Promise.allSettled(this.recoveries.inFlightRuns())
  }

  // ── Public: unified send ──────────────────────────────────────────

  private decideDispatchCommand(topicId: string, intent: StreamIntent): DispatchCommandReceipt {
    let admission: LiveExecutionChangeAdmission
    switch (intent.kind) {
      case 'append-live':
        admission = this.admitLiveExecutionChange(topicId, intent.change)
        break
      case 'replace-live':
        admission = this.admitLiveExecutionChange(topicId, intent.change)
        break
      case 'start':
        if ((this.activeStreams.get(topicId)?.aggregate ?? this.topicAggregates.get(topicId))?.hasPendingApprovals()) {
          throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TOPIC_BUSY)
        }
        admission = this.admitLiveExecutionChange(topicId, { mode: 'start', modelCount: intent.modelCount })
        break
      case 'continue-conversation':
      case 'prompt':
        admission = this.admitLiveExecutionChange(topicId, { mode: 'start', modelCount: 1 })
        break
      case 'steer-continuation':
      case 'runtime-turn':
        admission = this.dispatchingLeaseId(topicId)
          ? { mode: 'start-new' }
          : this.admitLiveExecutionChange(topicId, { mode: 'start', modelCount: 1 })
        break
      case 'steer-inject':
        admission = isStreamExecuting(this.activeStreams.get(topicId)) ? { mode: 'inject' } : { mode: 'start-new' }
        break
    }
    const keepActiveNode =
      intent.kind === 'replace-live' ||
      (intent.kind === 'append-live' && admission.mode === 'append-live') ||
      intent.kind === 'continue-conversation'
    return { intent, admission, activeNodeDecision: { move: keepActiveNode ? 'keep' : 'advance' } }
  }

  /**
   * Re-evaluate admission and synchronously commit reservation plus stream handoff against one
   * topic state. The callback must not return a promise or schedule work before calling send().
   */
  commitDispatchCommand<T>(topicId: string, intent: StreamIntent, commit: (receipt: DispatchCommandReceipt) => T): T {
    return commit(this.decideDispatchCommand(topicId, intent))
  }

  /**
   * Reserve a dispatch: admission, durable rows, and the runtime CAS commit in one synchronous
   * section. Callers describe their rows as data (`PreparedDispatchRows`) rather than passing a
   * callback, so nothing can run between the write and the commit (T4).
   */
  reserveDispatchCommand<R extends PreparedDispatchRows>(
    topicId: string,
    intent: StreamIntent,
    modelCount: number,
    rows: R
  ): { receipt: DispatchCommandReceipt; rows: Extract<PreparedDispatchRowResult, { kind: R['kind'] }> } {
    const existing = this.activeStreams.get(topicId)
    if (existing?.aggregate.isQuiescent()) this.evictStream(topicId)
    const aggregate = this.getOrCreateTopicAggregate(topicId)
    const admission = this.decideDispatchCommand(topicId, intent)
    const reservedAttemptIds = Array.from({ length: modelCount }, () =>
      toAttemptId(++this.nextExecutionAttemptSequence)
    )
    // One prepared commit for the whole dispatch: all attempts reserve at one revision or none do.
    const preparedTopic = aggregate.prepare({ type: 'reserve-dispatch', attemptIds: reservedAttemptIds })
    if (preparedTopic.rejection) {
      throw new Error(`Dispatch reservation rejected for topic ${topicId}: ${preparedTopic.rejection}`)
    }
    const receipt: DispatchCommandReceipt = { ...admission, reservedAttemptIds }
    let committed: DispatchCommitResult
    try {
      committed = commitPreparedDispatch({
        topic: aggregate,
        preparedTopic,
        rows,
        activeNodeDecision: admission.activeNodeDecision,
        attemptIds: reservedAttemptIds
      })
    } catch (error) {
      // The row write threw, so the CAS never ran and no attempt exists to roll back.
      if (!this.activeStreams.has(topicId) && !aggregate.hasUnsettledAttempts()) this.topicAggregates.delete(topicId)
      throw error
    }
    if (intent.kind === 'continue-conversation') {
      const stream = this.activeStreams.get(topicId)
      const execution = stream
        ? [...stream.executions.values()].find((candidate) => candidate.anchorMessageId === intent.anchorMessageId)
        : undefined
      if (execution) aggregate.clearApprovals(execution.attemptId)
    }
    return { receipt, rows: committed.rows as Extract<PreparedDispatchRowResult, { kind: R['kind'] }> }
  }

  failDispatchReservation(
    receipt: DispatchCommandReceipt,
    topicId: string,
    error: SerializedError,
    persist: () => void,
    attempts: ReadonlyArray<{ modelId: UniqueModelId; anchorMessageId: string }> = []
  ): void {
    const aggregate = this.topicAggregates.get(topicId) ?? this.activeStreams.get(topicId)?.aggregate
    if (!aggregate || !receipt.reservedAttemptIds?.length) return
    let durableErrorWritten = true
    const attemptControlRevisions: number[] = []
    let terminalError = error
    try {
      persist()
    } catch (persistenceError) {
      durableErrorWritten = false
      terminalError = serializeError(persistenceError)
      logger.error('Failed to persist dispatch reservation failure', { topicId, persistenceError })
    }
    for (const attemptId of receipt.reservedAttemptIds ?? []) {
      aggregate.transitionAttempt(attemptId, {
        type: 'reservation-failed',
        error: terminalError,
        durableErrorWritten
      })
      attemptControlRevisions.push(aggregate.controlRevision)
    }

    if (!durableErrorWritten) {
      this.enqueueReservationPersistenceRecovery(receipt, topicId, error, persist, attempts)
      return
    }
    void this.publishDispatchReservationFailure(receipt, topicId, error, attempts, attemptControlRevisions)
  }

  /** Retry every fail-closed terminal write. Production calls this from a lifecycle-scoped interval;
   *  it remains public so recovery can also be triggered explicitly after storage health returns. */
  async retryBlockedPersistence(): Promise<void> {
    if (this.isShuttingDown || this.isWriteQuiesced) return
    await this.recoveries.runAll((record) => this.runRecovery(record))
  }

  /**
   * Stop during a blocked terminal write: give each of the topic's deferred writes one
   * immediate chance (storage may already be back — then the ORIGINAL outcome lands), and
   * abandon the ones that still fail so the user is not held hostage by a dead database.
   * Shutdown keeps the old semantics (recoveries dropped, boot reconcile settles the rows).
   */
  private async abandonBlockedPersistence(topicId: string, reason: string): Promise<void> {
    if (this.isShuttingDown || this.isWriteQuiesced) return
    const keys = this.recoveries.keysForTopic(topicId)
    if (keys.length === 0) return
    logger.warn('Stop while terminal persistence is blocked — retrying once, then abandoning', {
      topicId,
      reason,
      keys
    })

    for (const key of keys) {
      // Serialize with the interval retry: abandoning while a write for the same key is in flight
      // could publish an error terminal for a write that actually committed. Join only THIS key's
      // run — another topic's hung recovery must not block this Stop.
      let activeRun: Promise<void> | undefined
      while ((activeRun = this.recoveries.activeRun(key))) {
        await activeRun
      }
      await this.recoveries.run(key, async (record) => {
        if (await this.runRecovery(record)) return true
        await this.abandonRecovery(record)
        return true
      })
    }
  }

  private enqueueReservationPersistenceRecovery(
    receipt: DispatchCommandReceipt,
    topicId: string,
    notificationError: SerializedError,
    persist: () => void,
    attempts: ReadonlyArray<{ modelId: UniqueModelId; anchorMessageId: string }>
  ): void {
    const attemptIds = receipt.reservedAttemptIds ?? []
    const key = `reservation:${attemptIds.join(',')}`
    this.recoveries.submit(key, {
      kind: 'reservation',
      topicId,
      retry: async () => {
        const aggregate = this.topicAggregates.get(topicId) ?? this.activeStreams.get(topicId)?.aggregate
        if (!aggregate) return true
        const blockedAttemptIds = attemptIds.filter(
          (attemptId) => aggregate.attemptState(attemptId)?.phase === 'persistence-blocked'
        )
        if (blockedAttemptIds.length === 0) return true

        try {
          persist()
        } catch (persistenceError) {
          const serializedError = serializeError(persistenceError)
          for (const attemptId of blockedAttemptIds) {
            aggregate.transitionAttempt(attemptId, {
              type: 'persist-failed',
              error: serializedError,
              durableErrorWritten: false
            })
          }
          logger.error('Dispatch reservation persistence recovery failed', { topicId, persistenceError })
          return false
        }

        const attemptControlRevisions: number[] = []
        for (const attemptId of attemptIds) {
          if (aggregate.attemptState(attemptId)?.phase === 'persistence-blocked') {
            aggregate.transitionAttempt(attemptId, { type: 'persisted' })
          }
          attemptControlRevisions.push(aggregate.controlRevision)
        }
        await this.publishDispatchReservationFailure(
          receipt,
          topicId,
          notificationError,
          attempts,
          attemptControlRevisions
        )
        return true
      },
      abandon: async () => {
        const aggregate = this.topicAggregates.get(topicId) ?? this.activeStreams.get(topicId)?.aggregate
        if (!aggregate) return
        const attemptControlRevisions: number[] = []
        let abandoned = false
        for (const attemptId of attemptIds) {
          if (aggregate.attemptState(attemptId)?.phase === 'persistence-blocked') {
            aggregate.transitionAttempt(attemptId, { type: 'abandon' })
            abandoned = true
          }
          attemptControlRevisions.push(aggregate.controlRevision)
        }
        if (!abandoned) return
        await this.publishDispatchReservationFailure(
          receipt,
          topicId,
          notificationError,
          attempts,
          attemptControlRevisions
        )
      }
    })
  }

  private async publishDispatchReservationFailure(
    receipt: DispatchCommandReceipt,
    topicId: string,
    error: SerializedError,
    attempts: ReadonlyArray<{ modelId: UniqueModelId; anchorMessageId: string }>,
    attemptControlRevisions: readonly number[]
  ): Promise<void> {
    const aggregate = this.topicAggregates.get(topicId) ?? this.activeStreams.get(topicId)?.aggregate
    if (!aggregate) return
    const stream = this.activeStreams.get(topicId)
    if (stream) {
      const topicQuiescent = aggregate.isQuiescent()
      const topicControlRevision = topicQuiescent ? aggregate.issueControlRevision() : undefined
      stream.status = aggregate.status()
      for (const [index, attemptId] of (receipt.reservedAttemptIds ?? []).entries()) {
        const identity = attempts[index]
        const result: StreamErrorResult = {
          error,
          status: 'error',
          modelId: identity?.modelId,
          attemptId,
          anchorMessageId: identity?.anchorMessageId,
          cycleId: aggregate.cycleId,
          controlRevision: attemptControlRevisions[index],
          topicControlRevision,
          ...(topicQuiescent && index === (receipt.reservedAttemptIds?.length ?? 0) - 1
            ? { topicAttemptWatermark: aggregate.attemptWatermark(), isTopicDone: true }
            : { isTopicDone: false })
        }
        await this.dispatchToListeners(stream, 'onError', (listener) => listener.onError(result))
        if (result.isTopicDone) await this.dispatchCleanupPorts(stream, result)
      }
      if (topicQuiescent) this.runTerminalLifecycle(stream)
    } else if (!stream && aggregate.isQuiescent()) {
      aggregate.evict()
      this.topicAggregates.delete(topicId)
    }
  }

  admitLiveExecutionChange(topicId: string, intent: LiveExecutionChangeIntent): LiveExecutionChangeAdmission {
    const stream = this.activeStreams.get(topicId)
    const isLive = isStreamExecuting(stream)
    const hasReservedAttempt = !stream && this.topicAggregates.get(topicId)?.hasUnsettledAttempts() === true
    const hasBlockedAttempt =
      (stream?.aggregate ?? this.topicAggregates.get(topicId))?.hasPersistenceBlockedAttempts() === true

    if (intent.mode === 'start') {
      if ((isLive || hasReservedAttempt || hasBlockedAttempt) && intent.modelCount > 0) {
        throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TOPIC_BUSY)
      }
      return { mode: 'start-new' }
    }

    const targetMessageId = intent.mode === 'append' ? intent.targetMessageId : intent.anchorMessageId
    if (!isPersistedReplyGroupAnchor(targetMessageId, topicId, intent.parentAnchorId, intent.siblingsGroupId)) {
      throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TARGET_NOT_IN_LIVE_GROUP)
    }
    if (hasReservedAttempt || hasBlockedAttempt) throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TOPIC_BUSY)
    if (!stream || !isLive) return { mode: 'start-new' }

    if (intent.mode === 'append') {
      if (stream.executions.has(intent.modelId)) {
        throw new AiStreamAdmissionError(aiStreamAdmissionReasons.MODEL_ALREADY_IN_LIVE_GROUP)
      }
      const groupExecution = [...stream.executions.values()].find((candidate) => {
        if (!candidate.anchorMessageId) return false
        if (intent.expectedGroupAnchorMessageId) {
          if (candidate.anchorMessageId !== intent.expectedGroupAnchorMessageId) return false
        } else if (intent.siblingsGroupId === undefined) {
          if (candidate.anchorMessageId !== intent.targetMessageId) return false
        } else if (candidate.siblingsGroupId !== intent.siblingsGroupId) {
          return false
        }
        return isPersistedReplyGroupAnchor(
          candidate.anchorMessageId,
          topicId,
          intent.parentAnchorId,
          intent.siblingsGroupId
        )
      })
      if (!groupExecution?.anchorMessageId) {
        throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TARGET_NOT_IN_LIVE_GROUP)
      }
      return { mode: 'append-live', groupAnchorMessageId: groupExecution.anchorMessageId }
    }

    const execution = stream.executions.get(intent.modelId)
    if (!execution || execution.anchorMessageId !== intent.anchorMessageId) {
      const compatibleExecution = [...stream.executions.values()].find(
        (candidate) =>
          candidate.anchorMessageId !== intent.anchorMessageId &&
          candidate.anchorMessageId !== undefined &&
          intent.siblingsGroupId !== undefined &&
          candidate.siblingsGroupId === intent.siblingsGroupId &&
          isPersistedReplyGroupAnchor(candidate.anchorMessageId, topicId, intent.parentAnchorId, intent.siblingsGroupId)
      )
      if (!stream.executions.has(intent.modelId) && compatibleExecution?.anchorMessageId) {
        return { mode: 'append-live', groupAnchorMessageId: compatibleExecution.anchorMessageId }
      }
      throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TARGET_NOT_IN_LIVE_GROUP)
    }
    if (isAttemptRunning(execution.attempt.state)) {
      throw new AiStreamAdmissionError(aiStreamAdmissionReasons.EXECUTION_NOT_READY)
    }
    return { mode: 'replace-live' }
  }

  /**
   * Single entry point. Live topic + an explicit execution change → update
   * that reply group; live topic + no models → inject listeners. Otherwise
   * start a new stream (evicting any grace-period stream first).
   * Multi-model is detected from `models.length > 1`.
   */
  send(input: SendInput): SendResult {
    if (input.receipt?.reservedAttemptIds && input.receipt.reservedAttemptIds.length !== input.models.length) {
      throw new Error(
        `Dispatch reserved ${input.receipt.reservedAttemptIds.length} attempts for ${input.models.length} models (topicId=${input.topicId})`
      )
    }
    const inputModelIds = new Set<UniqueModelId>()
    for (const { modelId } of input.models) {
      if (inputModelIds.has(modelId)) {
        throw new Error(`send() got duplicate modelId ${modelId} for topic ${input.topicId}`)
      }
      inputModelIds.add(modelId)
    }

    const existing = this.activeStreams.get(input.topicId)
    // Read the Stop decision before the blocked-persistence guard: a reservation Stop aborted while
    // its dispatch was parked in the prepare await must settle paused, not strand behind TOPIC_BUSY.
    const reservedAttemptIds = input.receipt?.reservedAttemptIds
    const reservedAggregate = existing?.aggregate ?? this.topicAggregates.get(input.topicId)
    const reservedAbortReason =
      reservedAggregate && reservedAttemptIds
        ? this.stoppedReservationReason(reservedAggregate, reservedAttemptIds)
        : undefined
    if (reservedAbortReason !== undefined && reservedAggregate) {
      return this.settleAbortedReservation(input, reservedAggregate, reservedAbortReason)
    }
    if (existing?.aggregate.hasPersistenceBlockedAttempts() && input.models.length > 0) {
      throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TOPIC_BUSY)
    }
    const liveExecutionChange = input.liveExecutionChange
    const committedLiveExecutionChange =
      input.receipt?.admission.mode === 'append-live' || input.receipt?.admission.mode === 'replace-live'

    if (existing && liveExecutionChange && (isStreamExecuting(existing) || committedLiveExecutionChange)) {
      if (input.models.length !== 1) {
        throw new AiStreamAdmissionError(aiStreamAdmissionReasons.SINGLE_MODEL_REQUIRED)
      }
      const [model] = input.models
      const previous = existing.executions.get(model.modelId)
      let admissionIntent: LiveExecutionChangeIntent
      if (liveExecutionChange.mode === 'append') {
        admissionIntent = {
          mode: 'append',
          modelId: model.modelId,
          targetMessageId: liveExecutionChange.groupAnchorMessageId,
          parentAnchorId: liveExecutionChange.parentAnchorId,
          siblingsGroupId: liveExecutionChange.siblingsGroupId,
          expectedGroupAnchorMessageId: liveExecutionChange.groupAnchorMessageId
        }
      } else {
        if (!model.request.messageId) {
          throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TARGET_NOT_IN_LIVE_GROUP)
        }
        admissionIntent = {
          mode: 'replace',
          modelId: model.modelId,
          anchorMessageId: model.request.messageId,
          parentAnchorId: liveExecutionChange.parentAnchorId,
          siblingsGroupId: liveExecutionChange.siblingsGroupId
        }
      }
      if (!input.receipt) this.admitLiveExecutionChange(input.topicId, admissionIntent)
      const hasLiveSibling = [...existing.executions.entries()].some(
        ([modelId, execution]) => modelId !== model.modelId && isAttemptRunning(execution.attempt.state)
      )

      if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer)
      existing.cleanupTimer = undefined
      existing.expiresAt = undefined
      for (const listener of input.listeners) existing.listeners.set(listener.id, listener)
      for (const port of input.persistencePorts ?? []) existing.persistencePorts.set(port.id, port)
      for (const port of input.cleanupPorts ?? []) existing.cleanupPorts.set(port.id, port)
      const nextExecution = this.createAndLaunchExecution(
        existing.aggregate,
        input.topicId,
        model.modelId,
        model.request,
        input.siblingsGroupId ?? previous?.siblingsGroupId,
        model.runtimeTimingSeed,
        model.seedFromEmpty,
        model.rootSpan,
        model.abortController,
        input.receipt?.reservedAttemptIds?.[0]
      )
      // Replacing an existing key preserves its insertion position; appending a new key places the
      // new model last. Both cases keep the visual multi-model order stable.
      existing.executions.set(model.modelId, nextExecution)
      if (previous && isAttemptSettled(previous.attempt.state)) existing.aggregate.forgetAttempt(previous.attemptId)
      existing.isMultiModel = existing.executions.size > 1
      existing.aggregate.activate()
      existing.status = hasLiveSibling ? this.computeTopicStatus(existing) : 'pending'
      existing.lifecycle.onActiveExecutionsChanged(existing)
      return {
        mode: 'started',
        activeExecutions: [toActiveExecution(nextExecution)]
      }
    }

    const dispatchingContinuationId = this.dispatchingLeaseId(input.topicId)
    const resumesApproval = input.receipt?.intent.kind === 'continue-conversation'
    if (existing && (dispatchingContinuationId || resumesApproval) && input.models.length > 0) {
      if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer)
      for (const listener of input.listeners) existing.listeners.set(listener.id, listener)
      existing.persistencePorts = new Map((input.persistencePorts ?? []).map((port) => [port.id, port]))
      existing.cleanupPorts = new Map((input.cleanupPorts ?? []).map((port) => [port.id, port]))
      for (const execution of existing.executions.values()) {
        if (isAttemptSettled(execution.attempt.state)) existing.aggregate.forgetAttempt(execution.attemptId)
      }
      existing.executions = new Map(
        input.models.map(({ modelId, request, runtimeTimingSeed, seedFromEmpty, rootSpan, abortController }, index) => {
          const execution = this.createAndLaunchExecution(
            existing.aggregate,
            input.topicId,
            modelId,
            request,
            input.siblingsGroupId,
            runtimeTimingSeed,
            seedFromEmpty,
            rootSpan,
            abortController,
            input.receipt?.reservedAttemptIds?.[index]
          )
          return [modelId, execution]
        })
      )
      existing.isMultiModel = existing.executions.size > 1
      existing.aggregate.activate()
      existing.status = 'pending'
      existing.cleanupTimer = undefined
      existing.expiresAt = undefined
      existing.lifecycle.onActiveExecutionsChanged(existing)
      return { mode: 'started', activeExecutions: [...existing.executions.values()].map(toActiveExecution) }
    }

    if (existing && isStreamExecuting(existing)) {
      // Live topic → inject: a chat steer (busy submit) or an agent-session follow-up was already
      // persisted/enqueued by its provider; just attach the new subscriber to the running stream
      // (those legitimate producers reach here with `models.length === 0`).
      //
      // A NON-EMPTY `models` here means a PREPARED turn (e.g. an approval `continue-conversation`)
      // reached a live topic because a concurrent submit started a turn between the caller's liveness
      // check and here. Injecting would silently discard the prepared models — the approved tool never
      // runs — behind a success shape. Refuse instead: send() runs under the per-topic dispatch lock,
      // so this throw is atomic w.r.t. the racing submit, and the caller (the approval handler) resolves
      // through its result shape, leaving the card actionable for a retry once the live turn settles.
      if (input.models.length > 0) {
        if (input.receipt) throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TOPIC_BUSY)
        this.admitLiveExecutionChange(input.topicId, { mode: 'start', modelCount: input.models.length })
      }
      for (const listener of input.listeners) this.addListener(input.topicId, listener)
      return {
        mode: 'injected',
        activeExecutions: [...existing.executions.values()]
          .filter((exec) => isAttemptRunning(exec.attempt.state))
          .map(toActiveExecution)
      }
    }

    // Enqueue-only dispatch with no live stream to attach to. Two legitimate producers reach here,
    // both with the user row already persisted/enqueued, so there's nothing to START — no-op instead
    // of throwing (and keep any grace-period stream available for late renderer reads):
    //   1. an agent-session follow-up landing in the inter-turn drain window (`isSessionBusy` true
    //      while the settled stream is terminal-in-grace, so `hasLiveStream` is false); the runtime's
    //      `pendingTurns` opens the next turn.
    //   2. a chat steer whose live stream went terminal between `prepareDispatch` and here (the race
    //      `enqueuePendingSteer` handles); the steer continuation is chained separately.
    // Do NOT re-add a throw for chat — case 2 is reachable and correct.
    if (input.models.length === 0) {
      for (const listener of input.listeners) this.addListener(input.topicId, listener)
      logger.debug('send(): empty models with no live stream — enqueue-only, nothing to start', {
        topicId: input.topicId
      })
      return { mode: 'injected', activeExecutions: [] }
    }

    // Evict any grace-period stream so two streams never coexist on one topic.
    if (existing) this.evictStream(input.topicId)

    const isMultiModel = input.models.length > 1
    const aggregate = this.topicAggregates.get(input.topicId) ?? this.getOrCreateTopicAggregate(input.topicId)
    const executions = new Map<UniqueModelId, StreamExecution>()

    for (const [
      index,
      { modelId, request, runtimeTimingSeed, seedFromEmpty, rootSpan, abortController }
    ] of input.models.entries()) {
      const exec = this.createAndLaunchExecution(
        aggregate,
        input.topicId,
        modelId,
        request,
        input.siblingsGroupId,
        runtimeTimingSeed,
        seedFromEmpty,
        rootSpan,
        abortController,
        input.receipt?.reservedAttemptIds?.[index]
      )
      executions.set(modelId, exec)
    }

    const stream: ActiveStream = {
      topicId: input.topicId,
      aggregate,
      executions,
      persistencePorts: new Map((input.persistencePorts ?? []).map((port) => [port.id, port])),
      cleanupPorts: new Map((input.cleanupPorts ?? []).map((port) => [port.id, port])),
      listeners: new Map(input.listeners.map((l) => [l.id, l])),
      // `pending` → `streaming` on first chunk.
      status: 'pending',
      isMultiModel,
      lifecycle: input.lifecycle ?? this.chatLifecycle
    }
    this.activeStreams.set(input.topicId, stream)
    // Chat broadcasts to SharedCache so `useChatWithHistory.resumeActiveStream` can attach; prompt is silent.
    stream.lifecycle.onCreated(stream)

    if ([...executions.values()].every((exec) => exec.abortController.signal.aborted)) {
      for (const exec of executions.values()) {
        if (isAttemptRunning(exec.attempt.state)) {
          this.transitionAttempt(stream.aggregate, exec, {
            type: 'abort',
            reason: String(exec.abortController.signal.reason ?? 'aborted')
          })
        }
      }
      stream.status = this.computeTopicStatus(stream)
    }

    return {
      mode: 'started',
      activeExecutions: [...executions.values()].map(toActiveExecution)
    }
  }

  /**
   * One-shot prompt stream for main-internal callers (translate, topic-
   * naming, summarisation, model probes). `streamId` doubles as the
   * synthetic topicId for renderer chunk filtering. Uses
   * `promptStreamLifecycle` — no status broadcast, no grace period, no
   * attach — so the stream evicts immediately at terminal.
   */
  streamPrompt(input: {
    streamId: string
    uniqueModelId: UniqueModelId
    prompt?: string
    messages?: CherryUIMessage[]
    listener: StreamListener | StreamListener[]
    persistencePorts?: StreamPersistencePort[]
    cleanupPorts?: StreamCleanupPort[]
    /** Per-request overrides (sampling/tools/providerOptions) for assistant-less callers (API gateway). */
    callOverrides?: CallOverrides
    /** Which layer owns history shaping; omitted means Cherry-managed. */
    contextOwner?: ContextOwner
    /** Explicit reasoning selection; 'none' disables thinking when the model's wire profile supports off. */
    reasoningEffort?: ReasoningEffortOption
    /** Idle-chunk timeout (ms) for the upstream stream; resets per chunk. Defaults to `DEFAULT_TIMEOUT`. */
    idleTimeoutMs?: number
    /** In-process agent correlation for gateway-owned provider-request records. */
    usageContext?: InProcessUsageContext
  }): SendResult {
    const messages: CherryUIMessage[] =
      input.messages && input.messages.length > 0
        ? input.messages
        : [{ id: 'prompt-user', role: 'user', parts: [{ type: 'text', text: input.prompt ?? '' }] }]

    const chatId = input.usageContext ? input.usageContext.agentSessionId : input.streamId
    const request: ManagedAiStreamRequest = {
      chatId,
      trigger: 'submit-message',
      uniqueModelId: input.uniqueModelId,
      messages,
      callOverrides: input.callOverrides,
      contextOwner: input.contextOwner,
      reasoningEffort: input.reasoningEffort,
      ...(input.usageContext ? { usageContext: input.usageContext } : {}),
      ...(input.idleTimeoutMs !== undefined ? { requestOptions: { timeout: input.idleTimeoutMs } } : {})
    }
    return this.commitDispatchCommand(input.streamId, { kind: 'prompt' }, (receipt) =>
      this.send({
        topicId: input.streamId,
        models: [{ modelId: input.uniqueModelId, request }],
        listeners: Array.isArray(input.listener) ? input.listener : [input.listener],
        persistencePorts: input.persistencePorts,
        cleanupPorts: input.cleanupPorts,
        lifecycle: promptStreamLifecycle,
        receipt
      })
    )
  }

  startRuntimeTurn(input: StartRuntimeTurnInput): SendResult {
    return this.commitDispatchCommand(input.topicId, { kind: 'runtime-turn' }, (receipt) => {
      const existing = this.activeStreams.get(input.topicId)
      const continuationId = this.dispatchingLeaseId(input.topicId)
      const carriedListeners = existing
        ? [...existing.listeners.values()].filter((listener) => !listener.id.startsWith('agent-runtime:'))
        : []

      if (existing && !continuationId) this.evictStream(input.topicId)

      const result = this.send({
        topicId: input.topicId,
        models: [
          {
            modelId: input.modelId,
            request: input.request,
            runtimeTimingSeed: input.runtimeTimingSeed,
            rootSpan: input.rootSpan,
            abortController: input.abortController
          }
        ],
        listeners: [...carriedListeners, ...input.listeners],
        persistencePorts: input.persistencePorts,
        cleanupPorts: input.cleanupPorts,
        receipt
      })
      const admittedAttemptId = receipt.reservedAttemptIds?.[0]
      if (continuationId && admittedAttemptId !== undefined) {
        this.consumeLease(input.topicId, continuationId, admittedAttemptId)
      }
      return result
    })
  }

  /**
   * Detach one not-yet-admitted runtime execution without terminalizing its reserved assistant row.
   * The runtime closes the upstream stream immediately after this call, then waits for the returned
   * promise before opening the receive-only generation that preempted it.
   */
  async suspendUnadmittedRuntimeTurn(topicId: string): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isStreamExecuting(stream)) return

    for (const id of stream.listeners.keys()) {
      if (id.startsWith('agent-runtime:')) stream.listeners.delete(id)
    }
    stream.persistencePorts.clear()
    stream.cleanupPorts.clear()

    await Promise.allSettled([...stream.executions.values()].map((execution) => execution.loopPromise))
  }

  /**
   * True iff this topic has a pending or streaming turn. Providers use this
   * initial admission snapshot to choose inject, append, or ordinary start
   * preparation.
   */
  hasLiveStream(topicId: string): boolean {
    return isStreamExecuting(this.activeStreams.get(topicId))
  }

  /** True while a terminal persistence port is writing durable state for this topic. */
  hasTerminalPersistenceInFlight(topicId: string): boolean {
    return (this.terminalPersistenceCounts.get(topicId) ?? 0) > 0
  }

  /** Wait for the displaced attempt's terminal persistence, then decide again
   * against the latest topic state inside a synchronous command. */
  async awaitDispatchCommandReceipt(topicId: string, intent: StreamIntent): Promise<DispatchCommandReceipt> {
    const initial = this.commitDispatchCommand(topicId, intent, (receipt) => receipt)
    if (intent.kind !== 'replace-live' || initial.admission.mode !== 'replace-live') return initial

    const execution = this.activeStreams.get(topicId)?.executions.get(intent.change.modelId)
    if (!execution) throw new AiStreamAdmissionError(aiStreamAdmissionReasons.EXECUTION_CHANGED)

    // Do not reserve/reset the row or replace listener identity until every
    // terminal persistence listener on the displaced attempt has completed.
    await execution.loopPromise
    return this.commitDispatchCommand(topicId, intent, (receipt) => receipt)
  }

  /** Whether any chat or agent turn is still able to write persisted stream state. */
  hasLiveStreams(): boolean {
    for (const stream of this.activeStreams.values()) {
      if (isStreamExecuting(stream)) return true
    }
    return false
  }

  pauseRuntimeTurn(topicId: string, reason: string): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isStreamExecuting(stream)) return false

    logger.info('Pausing runtime stream turn', { topicId, reason })
    for (const exec of stream.executions.values()) {
      if (isAttemptRunning(exec.attempt.state)) {
        this.transitionAttempt(stream.aggregate, exec, { type: 'abort', reason })
        exec.abortController.abort(reason)
      }
    }
    stream.status = this.computeTopicStatus(stream)
    return true
  }

  // ── Public: steer (mid-flight follow-up on chat topics) ───────────
  // Chat mirrors the agent runtime's enqueue + chain-next-turn: a busy submit
  // persists the user message and enqueues it here; the running turn yields at
  // the next step boundary (see `hasPendingSteer`) and `onExecutionDone` chains
  // a `steer-continuation` to answer it.

  /** True iff this chat topic has a queued steer. Read by the steer-yield stop condition so the
   *  running turn stops at the next safe step boundary. */
  hasPendingSteer(topicId: string): boolean {
    return (this.pendingSteers.get(topicId)?.length ?? 0) > 0
  }

  /** Enqueue a steer user message (already persisted by the provider). If the topic settled before
   *  this landed, start the continuation immediately. Mirrors `AgentSessionRuntimeService.enqueueUserMessage`. */
  enqueuePendingSteer(
    topicId: string,
    userMessageId: string,
    reasoningEffort?: ReasoningEffortOption,
    fastMode?: boolean
  ): void {
    // Runtime completion and durable completion are distinct. A finalizing clean turn queues the
    // steer until persistence settles; a finalizing abort/error rejects it immediately; only a
    // durably quiescent clean turn may launch the continuation here.
    const stream = this.activeStreams.get(topicId)
    const runtimeOutcome = stream?.aggregate.runtimeOutcome()
    if (runtimeOutcome === 'aborted' || runtimeOutcome === 'error') {
      logger.warn('Steer landed after a non-clean runtime terminal — dropping (row stays resendable)', {
        topicId,
        userMessageId,
        terminal: runtimeOutcome
      })
      return
    }
    if (stream && !stream.aggregate.isQuiescent()) {
      this.appendPendingSteer(topicId, userMessageId, reasoningEffort, fastMode)
      return
    }
    this.appendPendingSteer(topicId, userMessageId, reasoningEffort, fastMode)
    this.scheduleNextChatTurn(topicId)
  }

  private appendPendingSteer(
    topicId: string,
    userMessageId: string,
    reasoningEffort?: ReasoningEffortOption,
    fastMode?: boolean
  ): void {
    const queue = this.pendingSteers.get(topicId)
    const item = { continuationId: randomUUID(), userMessageId, reasoningEffort, fastMode: fastMode === true }
    if (queue) queue.push(item)
    else this.pendingSteers.set(topicId, [item])
    if (this.activeStreams.has(topicId)) this.openQueuedLease(topicId, item.continuationId)
  }

  // ── Public: listener management ───────────────────────────────────

  addListener(topicId: string, listener: StreamListener): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return false
    stream.listeners.set(listener.id, listener)
    // Replay buffered chunks from every execution's ring buffer so late
    // listeners catch up. Ordering within a single execution is preserved;
    // across executions chunks are interleaved in the order we see each
    // execution's buffer (acceptable: the Renderer demuxes by executionId + anchor).
    for (const exec of stream.executions.values()) {
      for (const chunk of exec.buffer) {
        // Forward the buffered protocol metadata — without it WebContentsListener emits only
        // legacy events and a v2-subscribed renderer drops the replayed chunk.
        const { cycleId, chunkSeq, throughChunkSeq } = chunk
        const metadata =
          cycleId !== undefined && chunkSeq !== undefined && throughChunkSeq !== undefined
            ? { cycleId, chunkSeq, throughChunkSeq }
            : undefined
        listener.onChunk(chunk.chunk, chunk.executionId, chunk.anchorMessageId, chunk.attemptId, metadata)
      }
    }
    return true
  }

  removeListener(topicId: string, listenerId: string): void {
    const stream = this.activeStreams.get(topicId)
    stream?.listeners.delete(listenerId)
  }

  /**
   * Clear a live runtime tool approval as soon as the user responds, before the
   * tool's eventual output chunk arrives. Returns whether a tracked approval changed.
   */
  resolveToolApproval(topicId: string, toolCallId: string, approved: boolean): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return false

    let changed = false
    let pendingApprovalFlipped = false
    for (const exec of stream.executions.values()) {
      if (!exec.attempt.pendingApprovalToolCallIds.has(toolCallId)) continue
      stream.aggregate.setApprovalPending(exec.attemptId, toolCallId, false)
      exec.runtimeTiming.finishApproval({ toolCallId })
      changed = true
      if (approved) {
        // AI SDK has no UI-stream approval-response chunk. Replaying the input advances the part
        // and lets a parallel batch surface its next approval before the tools execute.
        const inputChunk = findBufferedToolInput(exec, toolCallId)
        if (inputChunk) this.onChunk(topicId, exec.modelId, inputChunk, exec.attemptId)
      } else {
        this.onChunk(topicId, exec.modelId, { type: 'tool-output-denied', toolCallId }, exec.attemptId)
      }
      // Re-read: reducer state is immutable, and the replayed chunk above may itself open the
      // next approval in a parallel batch.
      if (exec.attempt.pendingApprovalToolCallIds.size === 0) {
        this.transitionAttempt(stream.aggregate, exec, { type: 'approval-changed', pending: false })
        pendingApprovalFlipped = true
      }
    }
    if (pendingApprovalFlipped && isLiveStatus(stream.status)) stream.lifecycle.onApprovalPendingChanged(stream)
    return changed
  }

  addCompletedRuntimeSpan(topicId: string, assistantMessageId: string, span: MessageRuntimeSpan): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return false
    const execution = [...stream.executions.values()].find(
      (candidate) => candidate.anchorMessageId === assistantMessageId
    )
    if (!execution) return false
    execution.runtimeTiming.addCompletedSpan(span)
    return true
  }

  private transitionAttempt(aggregate: TopicStreamAggregate, exec: StreamExecution, event: AttemptEvent): boolean {
    const state = aggregate.attemptState(exec.attemptId) ?? exec.attempt.state
    const result = aggregate.transitionAttempt(exec.attemptId, event)
    if (!result.ok) {
      logger.warn('Ignored attempt event', {
        attemptId: exec.attemptId,
        phase: state.phase,
        event: event.type,
        kind: result.kind
      })
      return false
    }
    return true
  }

  private executionForAttempt(
    stream: ActiveStream,
    modelId: UniqueModelId,
    attemptId: AttemptId | undefined,
    event: AttemptEvent['type']
  ): StreamExecution | undefined {
    const current = stream.executions.get(modelId)
    if (attemptId === undefined || current?.attemptId === attemptId) return current

    const state = stream.aggregate.attemptState(attemptId)
    logger.warn('Ignored stale attempt callback', {
      topicId: stream.topicId,
      modelId,
      attemptId,
      currentAttemptId: current?.attemptId,
      phase: state?.phase,
      event
    })
    return undefined
  }

  // ── Public: abort ─────────────────────────────────────────────────

  /** Abort all executions in a topic. */
  abort(topicId: string, reason: string): void {
    // Stop is the explicit escape from a blocked terminal write: one immediate retry, then abandon.
    // Fire-and-forget like the rest of abort — the terminal lands asynchronously.
    void this.abandonBlockedPersistence(topicId, reason)
    // Runtime cancellation runs before stream classification because it also owns the inter-turn
    // gap. Published rather than called: the agent runtime subscribes and answers by installing a
    // terminal hold, so this manager holds no reference to it (S2). `fire` is synchronous, so the
    // hold is in place before the classification below reads it.
    this.pendingRuntimeTerminalHolds.delete(topicId)
    if (isAgentSessionTopic(topicId)) {
      this.topicStopEmitter.fire({ topicId, cycleId: this.aggregateFor(topicId)?.cycleId ?? 0, reason })
    }
    const runtimeAbort = this.pendingRuntimeTerminalHolds.get(topicId)
    const stream = this.activeStreams.get(topicId)
    // Reservations live on the topicAggregates entry (=== stream.aggregate while a stream exists);
    // fence regardless of stream presence so a dispatch parked in its prepare await — approval
    // continuation or steer preparation — can't launch after Stop.
    const fenceAggregate = stream?.aggregate ?? this.topicAggregates.get(topicId)
    if (fenceAggregate && this.abortReservedAttempts(fenceAggregate, reason)) {
      logger.info('Aborted reserved stream attempts before launch', { topicId, reason })
    }
    // Stop cancels promised follow-up work outright. Releasing here rather than waiting for the
    // opener to push a retraction removes the race where Stop lands first and the topic is left
    // non-quiescent by a promise nobody will ever redeem. Runs before the runtime-terminal hold
    // below, so that hold survives; the branches below need the pre-release answer.
    const wasParkedOnContinuation = fenceAggregate?.hasOpenContinuationLease() === true
    if (fenceAggregate) this.releaseOpenLeases(topicId, 'stop', fenceAggregate)
    const runtimeTerminalLeaseId =
      stream && runtimeAbort?.terminalReady
        ? this.holdTopicForRuntimeTerminal(stream, runtimeAbort.terminalReady, runtimeAbort.terminalOutcome)
        : undefined
    if (!stream || !isStreamExecuting(stream)) {
      if (stream && wasParkedOnContinuation) {
        if (runtimeTerminalLeaseId) return
        if (!isAgentSessionTopic(topicId)) this.dropPendingSteers(topicId, 'aborted')
        stream.status = stream.aggregate.status()
        if (stream.aggregate.isQuiescent()) void this.publishTopicQuiescence(stream, 'aborted')
      }
      return
    }
    const runningExecutions = [...stream.executions.values()].filter((exec) => isAttemptRunning(exec.attempt.state))
    if (runningExecutions.length === 0 && wasParkedOnContinuation) {
      if (runtimeTerminalLeaseId) return
      if (!isAgentSessionTopic(topicId)) this.dropPendingSteers(topicId, 'aborted')
      stream.status = stream.aggregate.status()
      if (stream.aggregate.isQuiescent()) void this.publishTopicQuiescence(stream, 'aborted')
      return
    }
    logger.info('Aborting stream', { topicId, reason })
    for (const exec of runningExecutions) {
      this.transitionAttempt(stream.aggregate, exec, { type: 'abort', reason })
      exec.abortController.abort(reason)
    }
    // Flip status to 'aborted' synchronously here, where Stop's fate is decided — `onExecutionPaused`
    // only runs after the loop settles asynchronously. A steer enqueue landing in that window reads
    // this 'aborted' off the in-grace stream and drops, instead of draining after Stop.
    stream.status = this.computeTopicStatus(stream)
  }

  private holdTopicForRuntimeTerminal(
    stream: ActiveStream,
    terminalReady: Promise<void>,
    terminalOutcome: { outcome: 'aborted' } | { outcome: 'error'; error?: SerializedError } = { outcome: 'aborted' }
  ): string {
    const existingContinuationId = this.dispatchingLeaseId(stream.topicId)
    const continuationId = existingContinuationId ?? toContinuationLeaseId(`runtime-terminal:${crypto.randomUUID()}`)
    if (!existingContinuationId) {
      this.beginDispatchingLease(stream.aggregate, stream.topicId, continuationId, 'agent-runtime')
    }
    void terminalReady
      .then(async () => {
        if (this.activeStreams.get(stream.topicId) !== stream) return
        const reason: ContinuationReleaseReason = terminalOutcome.outcome === 'error' ? 'source-error' : 'stop'
        if (!this.releaseLease(stream.topicId, continuationId, reason)) return
        stream.status = stream.aggregate.status()
        if (stream.aggregate.isQuiescent()) {
          await this.publishTopicQuiescence(
            stream,
            terminalOutcome.outcome,
            terminalOutcome.outcome === 'error' ? terminalOutcome.error : undefined
          )
        }
      })
      .catch((error) => {
        logger.error('Runtime terminal barrier lease failed', { topicId: stream.topicId, error })
      })
    return continuationId
  }

  // ── Execution loop callbacks ──────────────────────────────────────
  // Driven internally by `createAndLaunchExecution`. Public because
  // tests invoke them directly to simulate chunk/done/error.

  /** Multi-model: chunks carry `sourceModelId` for renderer demux. */
  onChunk(topicId: string, modelId: UniqueModelId, chunk: UIMessageChunk, attemptId?: AttemptId): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isStreamExecuting(stream)) return

    const exec = this.executionForAttempt(stream, modelId, attemptId, 'chunk')
    if (!exec) return
    if (!this.transitionAttempt(stream.aggregate, exec, { type: 'chunk', at: performance.now() })) return

    const sourceModelId = modelId
    const anchorMessageId = exec.anchorMessageId
    // Authoritative approval-lifecycle capture, keyed by toolCallId so a sibling tool's output never
    // clears another tool's still-pending approval; topic reduction reads the set's size.
    const hadPendingApprovals = exec.attempt.pendingApprovalToolCallIds.size > 0
    if (chunk.type === 'tool-approval-request') {
      stream.aggregate.setApprovalPending(exec.attemptId, chunk.toolCallId, true)
      exec.runtimeTiming.startApproval(chunk.approvalId, chunk.toolCallId, toolNameFromApprovalChunk(chunk))
    } else if (
      chunk.type === 'tool-output-available' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied'
    ) {
      stream.aggregate.setApprovalPending(exec.attemptId, chunk.toolCallId, false)
      exec.runtimeTiming.finishApproval({ toolCallId: chunk.toolCallId })
    }
    // Broadcast payloads and consumers only care about "any pending?", so only
    // the empty↔non-empty flip warrants a rebroadcast — size changes within
    // parallel approvals would produce byte-identical payloads.
    const hasPendingApprovals = exec.attempt.pendingApprovalToolCallIds.size > 0
    const pendingApprovalFlipped = hadPendingApprovals !== hasPendingApprovals
    if (pendingApprovalFlipped) {
      this.transitionAttempt(stream.aggregate, exec, { type: 'approval-changed', pending: hasPendingApprovals })
    }

    // First chunk promotes `pending` → `streaming`; that broadcast already
    // carries the anchors captured above, so only a mid-stream flip needs its
    // own rebroadcast.
    if (stream.status === 'pending') {
      stream.status = 'streaming'
      stream.lifecycle.onPromotedToStreaming(stream)
    } else if (pendingApprovalFlipped) {
      stream.lifecycle.onApprovalPendingChanged(stream)
    }

    // Per-execution ring buffer — a chatty model can't push a slower one's
    // replay out. Eviction pauses while an approval is pending because the
    // approval's tool-input chunks are still-operable state a reconnect must
    // replay for the user to decide.
    //
    // Contiguous deltas of one part collapse into the buffer tail on ingest,
    // so the cap counts protocol units (parts, tool events) rather than raw
    // deltas — a delta flood can no longer evict its own part's opening chunk
    // and leave the replay unparseable for `readUIMessageStream`. Oversized
    // incoming deltas split first; ingest and attach share `maxDeltaBytes`.
    const bufferLimit = Math.max(1, this.config.maxBufferChunks)
    const splitSegments = splitDeltaPayload(
      { topicId, executionId: sourceModelId, attemptId: exec.attemptId, anchorMessageId, chunk },
      this.config.maxDeltaBytes
    )
    let firstChunkSeq = 0
    let throughChunkSeq = 0
    for (const rawSegment of splitSegments) {
      const chunkSeq = ++exec.nextChunkSeq
      firstChunkSeq ||= chunkSeq
      throughChunkSeq = chunkSeq
      const segment: StreamChunkPayload = {
        ...rawSegment,
        cycleId: stream.aggregate.cycleId,
        chunkSeq,
        throughChunkSeq: chunkSeq
      }
      const tail = exec.buffer.at(-1)
      const merged = tail ? mergeDeltaPayload(tail, segment, this.config.maxDeltaBytes) : undefined
      if (merged) {
        exec.buffer[exec.buffer.length - 1] = merged
      } else {
        if (exec.buffer.length >= bufferLimit && !exec.evictionPaused) {
          exec.buffer.shift()
          exec.droppedChunks += 1
        }
        exec.buffer.push(segment)
      }
    }
    const chunkMetadata: StreamChunkMetadata = {
      cycleId: stream.aggregate.cycleId,
      chunkSeq: firstChunkSeq,
      throughChunkSeq
    }
    // Keeps stripped outputs resolvable until the message lands in SQLite. Bounded; an evicted
    // entry just falls through to the persisted copy.
    if (chunk.type === 'tool-output-available' && shouldDeferToolOutput(chunk.output)) {
      const deferredOutputs = (exec.deferredOutputs ??= new Map())
      deferredOutputs.set(chunk.toolCallId, chunk.output)
      if (deferredOutputs.size > this.config.maxDeferredOutputs) {
        const oldest = deferredOutputs.keys().next()
        if (!oldest.done) deferredOutputs.delete(oldest.value)
      }
    }

    // Synchronous fan-out (listeners must not block the loop). Inline
    // liveness scrub so dead listeners go before the next onChunk runs.
    const dead: string[] = []
    for (const [id, listener] of stream.listeners) {
      if (!listener.isAlive()) {
        dead.push(id)
        continue
      }
      try {
        listener.onChunk(chunk, sourceModelId, anchorMessageId, exec.attemptId, chunkMetadata)
      } catch (err) {
        logger.warn('Listener threw', { topicId, listenerId: id, event: 'onChunk', err })
      }
    }
    for (const id of dead) stream.listeners.delete(id)

    // `backgroundMode: 'abort'` policy — drive through aborted → paused so partial output persists as `paused`.
    if (stream.listeners.size === 0 && this.config.backgroundMode === 'abort') {
      this.abort(topicId, 'no-subscribers')
    }
  }

  /** Called when one execution finishes. Topic-level done only when ALL executions finished. */
  async onExecutionDone(topicId: string, modelId: UniqueModelId, attemptId?: AttemptId): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = this.executionForAttempt(stream, modelId, attemptId, 'complete')
    if (!exec) return
    if (!this.transitionAttempt(stream.aggregate, exec, { type: 'complete' })) return

    exec.runtimeTiming.closeOpenToolSpans()
    if (exec.attempt.pendingApprovalToolCallIds.size === 0) {
      exec.runtimeTiming.closeOpenSpans()
      exec.runtimeTiming.complete()
    }
    endRootSpan(exec, 'ok')

    // Finalizing broadcast: the attempt leaves activeExecutions immediately, while
    // the topic status remains live until durable persistence has completed.
    stream.lifecycle.onActiveExecutionsChanged(stream)

    const persistenceFailure = await this.broadcastExecutionDone(stream, exec, false, 'persistence')
    this.transitionAttempt(
      stream.aggregate,
      exec,
      persistenceFailure
        ? {
            type: 'persist-failed',
            error: persistenceFailure.error,
            durableErrorWritten: persistenceFailure.durableErrorWritten
          }
        : { type: 'persisted' }
    )
    const settledOutcomeStatus = stream.aggregate.runtimeOutcome()
    const attemptsDurablySettled = stream.aggregate.areAttemptsDurablySettled()
    if (attemptsDurablySettled && (settledOutcomeStatus === 'error' || settledOutcomeStatus === 'aborted')) {
      this.dropPendingSteers(topicId, settledOutcomeStatus)
    }
    const continuation = this.planDurablySettledContinuation(stream, exec)
    const topicQuiescent = stream.aggregate.isQuiescent()
    stream.status = this.computeTopicStatus(stream)
    if (!topicQuiescent && stream.status === 'awaiting-approval') {
      stream.lifecycle.onApprovalPendingChanged(stream)
    }

    if (this.deferBlockedExecutionPersistence(stream, exec, persistenceFailure)) return
    if (persistenceFailure) {
      exec.error = persistenceFailure.error
      await this.broadcastExecutionError(stream, exec, persistenceFailure.error, topicQuiescent, 'settled')
    } else {
      await this.broadcastExecutionDone(stream, exec, topicQuiescent, 'settled')
    }

    if (continuation === 'chat') this.scheduleNextChatTurn(topicId)
    else if (topicQuiescent) {
      // A sibling errored/aborted (this exec finished clean but the topic didn't): drop the queue,
      // matching onExecutionError/onExecutionPaused. A clean 'done' or an approval-park keeps it.
      if (stream.status === 'error' || stream.status === 'aborted') this.dropPendingSteers(topicId, stream.status)
      this.runTerminalLifecycle(stream)
      // A steer enqueued during the persistence await saw the still-live status and queued without
      // launching; the continuation plan predates it, so drain it here like a settled-enqueue would.
      if (stream.status === 'done' && this.hasPendingSteer(topicId)) this.scheduleNextChatTurn(topicId)
    }
  }

  async onExecutionPaused(topicId: string, modelId: UniqueModelId, attemptId?: AttemptId): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = this.executionForAttempt(stream, modelId, attemptId, 'abort')
    if (!exec) return
    if (exec.attempt.state.phase !== 'finalizing' || exec.attempt.state.outcome.kind !== 'aborted') {
      return
    }

    // A turn torn down while a tool is still `approval-requested` (or any
    // in-flight tool) gets no `tool-output-*` to clear it. Clear the set so the
    // status resolves to plain `aborted` (not `awaiting-approval`) and the
    // status-cache anchor drops; the dangling tool part itself is terminalized
    // to `output-error` by `finalizeInterruptedParts` at every projection
    // (persistence already, re-attach below). Must run before
    // topic reduction.
    const hadPendingApprovals = stream.aggregate.clearApprovals(exec.attemptId)
    exec.runtimeTiming.closeOpenSpans()
    exec.runtimeTiming.complete()

    endRootSpan(exec, 'aborted')
    stream.lifecycle.onActiveExecutionsChanged(stream)

    // A live sibling keeps the topic out of the terminal broadcast below, so
    // the dropped approval anchor must reach the shared cache on its own.
    if (hadPendingApprovals) stream.lifecycle.onApprovalPendingChanged(stream)

    const persistenceFailure = await this.broadcastExecutionPaused(stream, exec, false, 'persistence')
    this.transitionAttempt(
      stream.aggregate,
      exec,
      persistenceFailure
        ? {
            type: 'persist-failed',
            error: persistenceFailure.error,
            durableErrorWritten: persistenceFailure.durableErrorWritten
          }
        : { type: 'persisted' }
    )
    if (stream.aggregate.areAttemptsDurablySettled()) {
      this.dropPendingSteers(topicId, persistenceFailure ? 'error' : 'aborted')
    }
    this.planDurablySettledContinuation(stream, exec)
    const topicQuiescent = stream.aggregate.isQuiescent()
    stream.status = this.computeTopicStatus(stream)

    if (this.deferBlockedExecutionPersistence(stream, exec, persistenceFailure)) return
    if (persistenceFailure) {
      exec.error = persistenceFailure.error
      await this.broadcastExecutionError(stream, exec, persistenceFailure.error, topicQuiescent, 'settled')
    } else {
      await this.broadcastExecutionPaused(stream, exec, topicQuiescent, 'settled')
    }

    if (topicQuiescent) {
      // Aborted (stop button / idle timeout), not a clean steer-yield — drop any queued steer
      // instead of chaining. Its persisted user row stays as a dangling message the user can resend.
      this.dropPendingSteers(topicId, persistenceFailure ? 'error' : 'aborted')
      this.runTerminalLifecycle(stream)
    }
  }

  /** Called when one execution errors. */
  async onExecutionError(
    topicId: string,
    modelId: UniqueModelId,
    error: SerializedError,
    attemptId?: AttemptId
  ): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = this.executionForAttempt(stream, modelId, attemptId, 'fail')
    if (!exec) return
    if (!this.transitionAttempt(stream.aggregate, exec, { type: 'fail', error })) return

    exec.error = error
    endRootSpan(exec, 'error', error)

    // Mirror of onExecutionPaused: clear the set so the status anchor drops;
    // the in-flight tool part is terminalized by `finalizeInterruptedParts`.
    const hadPendingApprovals = stream.aggregate.clearApprovals(exec.attemptId)
    exec.runtimeTiming.closeOpenSpans()
    exec.runtimeTiming.complete()

    stream.lifecycle.onActiveExecutionsChanged(stream)

    // A live sibling keeps the topic out of the terminal broadcast below, so
    // the dropped approval anchor must reach the shared cache on its own.
    if (hadPendingApprovals) stream.lifecycle.onApprovalPendingChanged(stream)
    ensureTerminalFinalMessage(exec)
    const persistenceFailure = await this.broadcastExecutionError(stream, exec, error, false, 'persistence')
    this.transitionAttempt(
      stream.aggregate,
      exec,
      persistenceFailure
        ? {
            type: 'persist-failed',
            error: persistenceFailure.error,
            durableErrorWritten: persistenceFailure.durableErrorWritten
          }
        : { type: 'persisted' }
    )
    if (stream.aggregate.areAttemptsDurablySettled()) {
      this.dropPendingSteers(topicId, 'error')
    }
    this.planDurablySettledContinuation(stream, exec)
    const topicQuiescent = stream.aggregate.isQuiescent()
    stream.status = this.computeTopicStatus(stream)
    if (this.deferBlockedExecutionPersistence(stream, exec, persistenceFailure)) return
    if (persistenceFailure) exec.error = persistenceFailure.error
    await this.broadcastExecutionError(stream, exec, persistenceFailure?.error ?? error, topicQuiescent, 'settled')

    if (topicQuiescent) {
      // Errored turn — drop any queued steer rather than chaining onto a failed turn.
      this.dropPendingSteers(topicId, 'error')
      this.runTerminalLifecycle(stream)
    }
  }

  /**
   * Resolve a recovery record to its live execution, or `undefined` if the attempt it names is
   * gone or no longer blocked. Identity — not a captured reference — decides what a retry acts on,
   * so a record can never resurrect an evicted stream or a superseded cycle.
   */
  private resolveBlockedAttempt(
    record: Extract<TerminalRecoveryRecord, { kind: 'stream-attempt' }>
  ): { stream: ActiveStream; exec: StreamExecution } | undefined {
    const stream = this.activeStreams.get(record.topicId)
    if (!stream || stream.aggregate.cycleId !== record.cycleId) return undefined
    const exec = [...stream.executions.values()].find((candidate) => candidate.attemptId === record.attemptId)
    if (!exec || exec.attempt.state.phase !== 'persistence-blocked') return undefined
    return { stream, exec }
  }

  /** One retry pass for a record. Returns true when the record is finished and can be dropped. */
  private async runAttemptRecovery(
    record: Extract<TerminalRecoveryRecord, { kind: 'stream-attempt' }>
  ): Promise<boolean> {
    const resolved = this.resolveBlockedAttempt(record)
    if (!resolved) return true
    const { stream, exec } = resolved
    const state = exec.attempt.state
    if (state.phase !== 'persistence-blocked') return true

    // Replay the ORIGINAL terminal write. A reply that completed cleanly before a transient
    // storage outage settles as success once storage recovers — the error demotion is reserved
    // for the durable-marker fallback.
    const retryFailure = await this.replayTerminalPersistence(
      stream,
      exec,
      state.outcome,
      new Set(record.blockedPortIds)
    )
    if (!this.resolveBlockedAttempt(record)) return true
    this.transitionAttempt(
      stream.aggregate,
      exec,
      retryFailure
        ? {
            type: 'persist-failed',
            error: retryFailure.error,
            durableErrorWritten: retryFailure.durableErrorWritten
          }
        : { type: 'persisted' }
    )
    if (retryFailure && !retryFailure.durableErrorWritten) {
      record.blockedPortIds = [...retryFailure.blockedPortIds]
      return false
    }
    await this.settleUnblockedExecution(stream, exec)
    return true
  }

  private async abandonAttemptRecovery(
    record: Extract<TerminalRecoveryRecord, { kind: 'stream-attempt' }>
  ): Promise<void> {
    const resolved = this.resolveBlockedAttempt(record)
    if (!resolved) return
    this.transitionAttempt(resolved.stream.aggregate, resolved.exec, { type: 'abandon' })
    await this.settleUnblockedExecution(resolved.stream, resolved.exec)
  }

  private runRecovery(record: TerminalRecoveryRecord): Promise<boolean> {
    return record.kind === 'stream-attempt' ? this.runAttemptRecovery(record) : record.retry()
  }

  private abandonRecovery(record: TerminalRecoveryRecord): Promise<void> {
    return record.kind === 'stream-attempt' ? this.abandonAttemptRecovery(record) : record.abandon()
  }

  private deferBlockedExecutionPersistence(
    stream: ActiveStream,
    exec: StreamExecution,
    failure: PersistenceDispatchFailure | undefined
  ): boolean {
    if (!failure || failure.durableErrorWritten) return false

    const key = `execution:${exec.attemptId}`
    this.recoveries.submit(key, {
      kind: 'stream-attempt',
      topicId: stream.topicId,
      cycleId: stream.aggregate.cycleId,
      attemptId: exec.attemptId,
      blockedPortIds: [...failure.blockedPortIds]
    })
    logger.error('Topic persistence is blocked without a durable terminal marker; recovery queued', {
      topicId: stream.topicId,
      modelId: exec.modelId,
      attemptId: exec.attemptId
    })
    return true
  }

  /** Dispatch the persistence-stage write matching the attempt's original outcome. */
  private replayTerminalPersistence(
    stream: ActiveStream,
    exec: StreamExecution,
    outcome: AttemptOutcome,
    blockedPortIds: ReadonlySet<string>
  ): Promise<PersistenceDispatchFailure | undefined> {
    if (outcome.kind === 'done') return this.broadcastExecutionDone(stream, exec, false, 'persistence', blockedPortIds)
    if (outcome.kind === 'aborted') {
      return this.broadcastExecutionPaused(stream, exec, false, 'persistence', blockedPortIds)
    }
    return this.broadcastExecutionError(stream, exec, outcome.error, false, 'persistence', blockedPortIds)
  }

  /**
   * Publish the settled terminal after an attempt leaves `persistence-blocked` (recovery
   * or explicit abandon). Mirrors the settled tails of onExecutionDone/Paused/Error; recovered
   * clean turns use the same chat/Agent continuation planner as unblocked completions.
   */
  private async settleUnblockedExecution(stream: ActiveStream, exec: StreamExecution): Promise<void> {
    const state = exec.attempt.state
    if (!isAttemptSettled(state)) return
    // Abandon publishes its persistence error, not the runtime outcome it retains.
    const outcome = publishedOutcome(state)
    if (outcome.kind === 'error') exec.error = outcome.error

    const runtimeOutcome = stream.aggregate.runtimeOutcome()
    const attemptsDurablySettled = stream.aggregate.areAttemptsDurablySettled()
    if (attemptsDurablySettled && (runtimeOutcome === 'error' || runtimeOutcome === 'aborted')) {
      this.dropPendingSteers(stream.topicId, runtimeOutcome)
    }
    const continuation = this.planDurablySettledContinuation(stream, exec)
    const topicQuiescent = stream.aggregate.isQuiescent()
    stream.status = this.computeTopicStatus(stream)

    if (outcome.kind === 'done') {
      await this.broadcastExecutionDone(stream, exec, topicQuiescent, 'settled')
    } else if (outcome.kind === 'aborted') {
      await this.broadcastExecutionPaused(stream, exec, topicQuiescent, 'settled')
    } else {
      await this.broadcastExecutionError(stream, exec, outcome.error, topicQuiescent, 'settled')
    }

    if (continuation === 'chat') this.scheduleNextChatTurn(stream.topicId)
    else if (topicQuiescent) this.runTerminalLifecycle(stream)
  }

  /** Decide successor work only after every attempt has a durable terminal. Chat steers win because
   *  they are manager-owned; Agent continuations are registered here and launched by the runtime. */
  private planDurablySettledContinuation(stream: ActiveStream, exec: StreamExecution): 'chat' | 'agent' | undefined {
    if (!stream.aggregate.areAttemptsDurablySettled()) return undefined
    const outcome = stream.aggregate.runtimeOutcome()
    if (outcome === 'done' && this.hasPendingSteer(stream.topicId)) return 'chat'
    if (!isAgentSessionTopic(stream.topicId) || (outcome !== 'done' && outcome !== 'error')) return undefined
    // The runtime's own lease answers this. An error terminal has already voided any lease whose
    // work depended on this attempt succeeding, so no outcome branch is needed here.
    if (!this.hasAgentContinuationLease(stream.topicId)) return undefined

    this.beginDispatchingLease(stream.aggregate, stream.topicId, `agent:${exec.attemptId}`, 'agent-runtime')
    return 'agent'
  }

  /** Drop a topic's queued steers on a non-clean terminal, surfacing the discard. Their persisted
   *  user rows stay in history as dangling messages the user can resend; surfacing those orphaned
   *  rows in the renderer is the renderer slice's responsibility, not handled here. */
  private dropPendingSteers(topicId: string, reason: 'aborted' | 'error'): void {
    const dropped = this.pendingSteers.get(topicId)
    if (dropped?.length) {
      logger.warn('Dropping queued steers without answering', {
        topicId,
        reason,
        droppedIds: dropped.map((item) => item.userMessageId)
      })
      const release: ContinuationReleaseReason = reason === 'error' ? 'source-error' : 'stop'
      for (const item of dropped) this.releaseLease(topicId, toContinuationLeaseId(item.continuationId), release)
    }
    this.pendingSteers.delete(topicId)
  }

  /**
   * Settle a topic stream that a chaining turn kept alive (`isTopicDone=false`, terminal lifecycle
   * skipped) when the agent runtime's queued continuation could NOT be launched — e.g. its drain
   * re-check found the agent model deleted. Surface the error to transport subscribers (persistence
   * skipped because the continuation never opened), then run the terminal lifecycle so the status
   * cache settles and the stream is evicted. Mirrors the chat path's `failChatContinuation`.
   */
  failTopicContinuation(topicId: string, _modelId: UniqueModelId | undefined, error: SerializedError): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const continuationId = this.dispatchingLeaseId(topicId)
    if (!continuationId) return
    void this.failCapturedTopicContinuation(stream, continuationId, error)
  }

  /** Bind a delayed failure to the continuation that is current now, never a later topic cycle. */
  failTopicContinuationWhenReady(
    topicId: string,
    _modelId: UniqueModelId | undefined,
    error: SerializedError,
    ready: Promise<unknown>
  ): void {
    const stream = this.activeStreams.get(topicId)
    const continuationId = this.dispatchingLeaseId(topicId)
    if (!stream || !continuationId) return
    void ready
      .then(() => {
        if (this.activeStreams.get(topicId) !== stream) return
        return this.failCapturedTopicContinuation(stream, continuationId, error)
      })
      .catch((readyError) => {
        logger.error('Deferred topic continuation failure barrier rejected', { topicId, readyError })
      })
  }

  private async failCapturedTopicContinuation(
    stream: ActiveStream,
    continuationId: ContinuationLeaseId,
    error: SerializedError
  ): Promise<void> {
    if (!this.releaseLease(stream.topicId, continuationId, 'source-error')) return
    // The runtime reported that its continuation cannot launch, so its promise is void too.
    this.releaseOpenLeases(stream.topicId, 'launch-failed', stream.aggregate)
    stream.status = stream.aggregate.status()
    if (stream.aggregate.isQuiescent()) await this.publishTopicQuiescence(stream, 'error', error)
  }

  /** Publish a topic-only barrier after a continuation ends without opening another attempt. */
  private async publishTopicQuiescence(
    stream: ActiveStream,
    outcome: 'error' | 'aborted',
    error?: SerializedError,
    listeners?: Iterable<StreamListener>
  ): Promise<void> {
    if (!stream.aggregate.isQuiescent()) return
    const controlRevision = stream.aggregate.issueControlRevision()
    const common = {
      topicAttemptWatermark: this.getTopicAttemptWatermark(stream),
      isTopicDone: true as const,
      cycleId: stream.aggregate.cycleId,
      controlRevision,
      topicControlRevision: controlRevision
    }
    const result: StreamErrorResult | StreamPausedResult =
      outcome === 'error'
        ? { ...common, status: 'error', error: error ?? serializeError(new Error('Topic continuation failed')) }
        : { ...common, status: 'paused' }
    if (result.status === 'error') {
      await this.dispatchToListeners(stream, 'onError', (listener) => listener.onError(result), listeners)
    } else {
      await this.dispatchToListeners(stream, 'onPaused', (listener) => listener.onPaused(result), listeners)
    }
    await this.dispatchCleanupPorts(stream, result)
    this.runTerminalLifecycle(stream)
  }

  /** Chat defers 30 s, prompt evicts immediately. */
  private runTerminalLifecycle(stream: ActiveStream): void {
    if (!stream.aggregate.isQuiescent()) {
      logger.error('Refused terminal lifecycle for non-quiescent topic', {
        topicId: stream.topicId,
        status: stream.status
      })
      return
    }
    stream.aggregate.beginGrace()
    stream.lifecycle.onTerminal(stream)
    stream.lifecycle.cleanup(stream, () => {
      if (this.activeStreams.get(stream.topicId) === stream) {
        this.evictStream(stream.topicId)
      }
    })
  }

  /** Drain-dedup + microtask defer for the steer continuation. Mirrors `scheduleNextTurn`.
   *  The launch promise is registered into `inFlightChatContinuations` SYNCHRONOUSLY — the
   *  caller runs inside a settling loopPromise, so a drain that just awaited that loop must
   *  see the pending launch on its next collect, not miss it behind the microtask. */
  private scheduleNextChatTurn(topicId: string): void {
    if (this.startingNextChatTopicIds.has(topicId)) return
    this.startingNextChatTopicIds.add(topicId)
    const launch = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        void this.startNextChatTurn(topicId)
          .catch((error) => logger.error('Failed to start chat steer continuation', { topicId, error }))
          .finally(() => {
            this.startingNextChatTopicIds.delete(topicId)
            this.inFlightChatContinuations.delete(topicId)
            resolve()
          })
      })
    })
    this.inFlightChatContinuations.set(topicId, launch)
  }

  /**
   * Open a fresh assistant turn answering the head of the steer queue. Carries the finished turn's
   * renderer listeners forward so the continuation streams to the same windows; persistence/trace
   * listeners are rebuilt by `prepareDispatch`. Mirrors `AgentSessionRuntimeService.startNextTurn`.
   */
  private async startNextChatTurn(topicId: string): Promise<void> {
    // Write-quiesce: suppress the launch before consuming the queue head — the steer stays
    // queued (its user row is already persisted) and the last hold's disposal re-kicks it.
    if (this.isWriteQuiesced) {
      this.suppressedChatContinuationTopicIds.add(topicId)
      return
    }
    const queue = this.pendingSteers.get(topicId)
    const pending = queue?.[0]
    if (!pending) {
      this.pendingSteers.delete(topicId)
      return
    }

    const previous = this.activeStreams.get(topicId)
    // The continuation lease may become eligible only after every admitted attempt is durable.
    if (previous && !previous.aggregate.areAttemptsDurablySettled()) return
    if (previous && !this.beginDispatchingLease(previous.aggregate, topicId, pending.continuationId, 'chat-steer')) {
      return
    }

    // Commit to consuming the head only now that we're actually going to dispatch it.
    queue.shift()
    if (queue.length === 0) this.pendingSteers.delete(topicId)

    const carried = previous ? [...previous.listeners.values()].filter(isRendererListener) : []

    const { userMessageId, reasoningEffort, fastMode } = pending
    const continuationId = toContinuationLeaseId(pending.continuationId)
    const req: MainDispatchRequest = {
      trigger: 'steer-continuation',
      topicId,
      userMessageId,
      reasoningEffort,
      fastMode
    }
    try {
      await this.dispatch(carried[0] ?? nullStreamListener, req)
      const admitted = this.aggregateFor(topicId)?.attemptWatermark()
      if (previous && admitted !== undefined) {
        this.consumeLease(topicId, continuationId, toAttemptId(admitted), previous.aggregate)
      }
    } catch (error) {
      // The continuation never opened (steer row deleted, no default model configured, SQLITE_BUSY …).
      // `onExecutionDone`'s chaining path already skipped the terminal lifecycle and we evicted the
      // prior stream, so the topic would otherwise stay `streaming` forever (Stop becomes a no-op,
      // every window spins). Surface the failure and write a terminal status. Don't re-queue — a
      // retry just re-fails, mirroring the agent runtime's `startNextTurn` failure path.
      logger.error('Chat steer continuation failed to launch', { topicId, userMessageId, error })
      if (previous) await this.failChatContinuation(previous, continuationId, carried, serializeError(error))
      return
    }
    // Re-attach any other windows that were on the prior turn (single subscriber goes through
    // `dispatch`; the rest catch up via buffer replay).
    for (const listener of carried.slice(1)) this.addListener(topicId, listener)
  }

  /**
   * A queued steer continuation could not be launched after the prior turn was already evicted.
   * Surface the error to the carried renderer windows and write a terminal status so the topic's
   * status cache drops out of `streaming`; drop the rest of the queue (its rows stay resendable).
   * Persistence listeners are skipped — they belong to a turn that never opened. Mirrors the agent
   * runtime's continuation-failure terminal mark.
   */
  private async failChatContinuation(
    previous: ActiveStream,
    continuationId: ContinuationLeaseId,
    carried: StreamListener[],
    error: SerializedError
  ): Promise<void> {
    this.releaseLease(previous.topicId, continuationId, 'launch-failed', previous.aggregate)
    this.dropPendingSteers(previous.topicId, 'error')
    previous.status = previous.aggregate.status()
    if (previous.aggregate.isQuiescent()) await this.publishTopicQuiescence(previous, 'error', error, carried)
  }

  // ── Public: inspection snapshot ───────────────────────────────────

  /** Returns `undefined` for never-opened or grace-period-expired topics. */
  inspect(topicId: string): TopicSnapshot | undefined {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return undefined

    const executions: ExecutionSnapshot[] = []
    for (const exec of stream.executions.values()) {
      executions.push({
        modelId: exec.modelId,
        attemptId: exec.attemptId,
        status: executionStatus(exec.attempt.state),
        anchorMessageId: exec.anchorMessageId,
        seedFromEmpty: exec.seedFromEmpty,
        abortSignal: exec.abortController.signal,
        bufferedChunkCount: exec.buffer.length,
        droppedChunks: exec.droppedChunks,
        siblingsGroupId: exec.siblingsGroupId,
        finalMessage: exec.finalMessage,
        timings: { ...exec.timings }
      })
    }

    return {
      topicId: stream.topicId,
      status: stream.status,
      isMultiModel: stream.isMultiModel,
      listenerIds: [...stream.listeners.keys()],
      executions
    }
  }

  // ── Public: attach / detach ──────────────────────────────────────
  // Registered as IPC handlers in `onInit`. Public so tests can drive
  // the same code path with a fake `WebContents`-shaped sender.

  attach(sender: Electron.WebContents, req: AiStreamAttachRequest): AiStreamAttachResponse {
    const stream = this.activeStreams.get(req.topicId)
    if (!stream) return { status: 'not-found' }
    // Prompt-stream lifecycle returns false here — re-attach is meaningless
    // for one-shot ad-hoc streams, and the listener was already consumed by
    // the original caller.
    if (!stream.lifecycle.canAttach(stream)) return { status: 'not-found' }

    // Reconnect: compact-replay each execution's buffer in isolation so
    // text-delta / reasoning-delta merging stays per-execution.
    const topicOpen = !stream.aggregate.isQuiescent()
    if (topicOpen) {
      const listener = new WebContentsListener(sender, req.topicId)
      stream.listeners.set(listener.id, listener)
    }

    const totalDropped = [...stream.executions.values()].reduce((sum, exec) => sum + exec.droppedChunks, 0)
    if (totalDropped > 0) {
      logger.warn('attach: replay has gaps due to buffer overflow', {
        topicId: req.topicId,
        droppedChunks: totalDropped
      })
    }

    const bufferedChunks: StreamChunkPayload[] = []
    const attempts: NonNullable<Extract<AiStreamAttachResponse, { status: 'attached' }>['snapshot']>['attempts'] = []
    for (const exec of stream.executions.values()) {
      const replayPlan = buildCompactReplayPlan(exec.buffer, this.config.maxDeltaBytes)
      bufferedChunks.push(...replayPlan.map(({ payload }) => projectStreamChunkPayloadForRenderer(payload)))
      const replayChunks = replayPlan.flatMap(({ payload, synthetic }): StreamProtocolReplayChunkEvent[] => {
        if (
          payload.executionId === undefined ||
          payload.attemptId === undefined ||
          payload.cycleId === undefined ||
          payload.chunkSeq === undefined
        ) {
          return []
        }
        const projected = projectStreamChunkPayloadForRenderer(payload)
        return [
          {
            type: 'chunk',
            topicId: projected.topicId,
            executionId: payload.executionId,
            attemptId: payload.attemptId,
            anchorMessageId: projected.anchorMessageId,
            cycleId: payload.cycleId,
            chunkSeq: payload.chunkSeq,
            throughChunkSeq: payload.throughChunkSeq ?? payload.chunkSeq,
            chunk: projected.chunk,
            ...(synthetic ? { synthetic: true as const } : {})
          }
        ]
      })
      attempts.push({
        executionId: exec.modelId,
        attemptId: exec.attemptId,
        anchorMessageId: exec.anchorMessageId,
        seedFromEmpty: exec.seedFromEmpty,
        // `abandoned` stays off the wire: it projects as a settled error, matching both the
        // renderer's existing vocabulary and what boot reconcile writes for the pending row.
        phase: exec.attempt.state.phase === 'abandoned' ? 'settled' : exec.attempt.state.phase,
        ...toSnapshotOutcome(exec.attempt.state),
        replayChunks,
        throughChunkSeq: exec.nextChunkSeq
      })
    }
    return {
      status: 'attached',
      bufferedChunks,
      snapshot: {
        cycleId: stream.aggregate.cycleId,
        controlRevision: stream.aggregate.controlRevision,
        topicOpen,
        attempts
      }
    }
  }

  detach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    this.removeListener(req.topicId, `wc:${sender.id}:${req.topicId}`)
  }

  /** Full output of a deferred tool call, while the stream that produced it is still active. */
  getDeferredToolOutput(topicId: string, toolCallId: string): { found: true; output: unknown } | { found: false } {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return { found: false }

    for (const exec of stream.executions.values()) {
      if (exec.deferredOutputs?.has(toolCallId)) {
        return { found: true, output: exec.deferredOutputs.get(toolCallId) }
      }
    }
    return { found: false }
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private settleAbortedReservation(input: SendInput, aggregate: TopicStreamAggregate, reason: string): SendResult {
    const attemptIds = input.receipt?.reservedAttemptIds
    if (!attemptIds || attemptIds.length !== input.models.length) {
      throw new Error(`Missing reserved attempts for aborted dispatch on topic ${input.topicId}`)
    }

    const executions = new Map<UniqueModelId, StreamExecution>()
    for (const [index, model] of input.models.entries()) {
      const attemptId = attemptIds[index]
      if (attemptId === undefined) {
        throw new Error(`Missing reserved attempt ${index} for aborted dispatch on topic ${input.topicId}`)
      }
      const exec = this.createReservedExecution(
        aggregate,
        input.topicId,
        model.modelId,
        model.request,
        input.siblingsGroupId,
        model.runtimeTimingSeed,
        model.seedFromEmpty,
        model.rootSpan,
        model.abortController,
        attemptId
      )
      if (!exec.abortController.signal.aborted) exec.abortController.abort(reason)
      exec.timings.completedAt = performance.now()
      // Stop already recorded the abort on the attempt itself; only a still-reserved one needs it.
      if (
        exec.attempt.state.phase === 'reserved' &&
        !this.transitionAttempt(aggregate, exec, { type: 'abort', reason })
      ) {
        throw new Error(`Attempt ${exec.attemptId} could not consume Stop for topic ${input.topicId}`)
      }
      executions.set(model.modelId, exec)
    }

    const existing = this.activeStreams.get(input.topicId)
    if (existing) {
      // The reservation was fenced while a prior stream (approval-parked or steer-chaining) was
      // still installed — merge into it so its listeners and any settling siblings survive.
      if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer)
      existing.cleanupTimer = undefined
      existing.expiresAt = undefined
      for (const listener of input.listeners) existing.listeners.set(listener.id, listener)
      for (const port of input.persistencePorts ?? []) existing.persistencePorts.set(port.id, port)
      for (const port of input.cleanupPorts ?? []) existing.cleanupPorts.set(port.id, port)
      for (const [modelId, exec] of executions) {
        const previous = existing.executions.get(modelId)
        if (previous && isAttemptSettled(previous.attempt.state)) aggregate.forgetAttempt(previous.attemptId)
        existing.executions.set(modelId, exec)
      }
      existing.isMultiModel = existing.executions.size > 1
      aggregate.activate()
      existing.status = this.computeTopicStatus(existing)
      existing.lifecycle.onActiveExecutionsChanged(existing)
    } else {
      const stream: ActiveStream = {
        topicId: input.topicId,
        aggregate,
        executions,
        persistencePorts: new Map((input.persistencePorts ?? []).map((port) => [port.id, port])),
        cleanupPorts: new Map((input.cleanupPorts ?? []).map((port) => [port.id, port])),
        listeners: new Map(input.listeners.map((listener) => [listener.id, listener])),
        status: 'pending',
        isMultiModel: executions.size > 1,
        lifecycle: input.lifecycle ?? this.chatLifecycle
      }
      aggregate.activate()
      this.activeStreams.set(input.topicId, stream)
      stream.lifecycle.onCreated(stream)
    }

    for (const exec of executions.values()) {
      exec.loopPromise = Promise.resolve().then(() =>
        this.onExecutionPaused(input.topicId, exec.modelId, exec.attemptId)
      )
    }

    return { mode: 'started', activeExecutions: [...executions.values()].map(toActiveExecution) }
  }

  private createReservedExecution(
    aggregate: TopicStreamAggregate,
    topicId: string,
    modelId: UniqueModelId,
    request: ManagedAiStreamRequest,
    siblingsGroupId: number | undefined,
    runtimeTimingSeed: MessageRuntimeTiming | undefined,
    seedFromEmpty: boolean | undefined,
    rootSpan: Span | undefined,
    abortController: AbortController | undefined,
    attemptId: AttemptId
  ): StreamExecution {
    const reserved = aggregate.attempt(attemptId)
    // Stop may already have aborted the reservation; the settle path still needs its shell.
    if (!reserved || (reserved.state.phase !== 'reserved' && reserved.state.phase !== 'finalizing')) {
      throw new Error(`Attempt ${attemptId} is not reserved for topic ${topicId}`)
    }
    return {
      modelId,
      attemptId,
      anchorMessageId: request.messageId,
      seedFromEmpty,
      abortController: abortController ?? new AbortController(),
      // Reducer state is immutable, so this must resolve on every read — a captured snapshot
      // would freeze `attempt.state` at reservation time for every consumer.
      get attempt() {
        const current = aggregate.attempt(attemptId)
        if (!current) throw new Error(`Attempt ${attemptId} is no longer owned by topic ${topicId}`)
        return current
      },
      buffer: [],
      nextChunkSeq: 0,
      droppedChunks: 0,
      evictionPaused: false,
      siblingsGroupId,
      timings: { startedAt: performance.now() },
      runtimeTiming: new MessageRuntimeTimingCollector(runtimeTimingSeed),
      loopPromise: Promise.resolve(),
      rootSpan
    }
  }

  /**
   * Loop: pull chunks from `AiService.streamText`, tee into broadcast +
   * `readUIMessageStream` accumulator (writes each snapshot to
   * `exec.finalMessage`), signal terminal status. See pipeStreamLoop.
   */
  private createAndLaunchExecution(
    aggregate: TopicStreamAggregate,
    topicId: string,
    modelId: UniqueModelId,
    request: ManagedAiStreamRequest,
    siblingsGroupId?: number,
    runtimeTimingSeed?: MessageRuntimeTiming,
    seedFromEmpty?: boolean,
    rootSpan?: Span,
    abortController?: AbortController,
    reservedAttemptId?: AttemptId
  ): StreamExecution {
    const attemptId = reservedAttemptId ?? toAttemptId(++this.nextExecutionAttemptSequence)
    if (reservedAttemptId === undefined) aggregate.reserveAttempt(attemptId)
    // `loopPromise` is overwritten right after launch; initialise to a resolved sentinel
    // so the `exec` object reference is stable inside the arrow function below.
    const exec = this.createReservedExecution(
      aggregate,
      topicId,
      modelId,
      request,
      siblingsGroupId,
      runtimeTimingSeed,
      seedFromEmpty,
      rootSpan,
      abortController,
      attemptId
    )
    this.transitionAttempt(aggregate, exec, { type: 'launch' })

    const launchLoop = rootSpan
      ? () =>
          otelContext.with(trace.setSpan(otelContext.active(), rootSpan), () =>
            this.runExecutionLoop(aggregate, topicId, modelId, request, exec)
          )
      : () => this.runExecutionLoop(aggregate, topicId, modelId, request, exec)

    exec.loopPromise = launchLoop().catch((err) => {
      // Defensive funnel for sync throws (e.g. `streamText` rejects before returning a stream).
      return this.onExecutionError(topicId, modelId, serializeError(err), exec.attemptId)
    })

    return exec
  }

  private async runExecutionLoop(
    aggregate: TopicStreamAggregate,
    topicId: string,
    modelId: UniqueModelId,
    request: ManagedAiStreamRequest,
    exec: StreamExecution
  ): Promise<void> {
    const aiService = application.get('AiService')
    const signal = exec.abortController.signal

    let rawStream: ReadableStream<UIMessageChunk>
    try {
      // Pre-stream rejection (model resolution, param build) routes through
      // the error path with no half-open stream to tear down.
      // `signal` is injected here because it's not IPC-serialisable.
      rawStream = await aiService.streamText({
        ...request,
        requestOptions: { ...request.requestOptions, signal },
        runtimeTimingSink: exec.runtimeTiming.sink,
        // Compaction runs deep inside param-build / the tool loop, where the
        // turn's chunk sink isn't reachable; hand it down as a closure (same
        // shape as runtimeTimingSink) so the UI can show "compacting".
        compactionSink: (anchorId, data) => {
          // Broadcast for the live indicator…
          this.onChunk(
            topicId,
            modelId,
            { type: 'data-compaction-anchor', id: anchorId, data } as UIMessageChunk,
            exec.attemptId
          )
          // …and record it, because the broadcast branch is NOT the accumulator
          // branch (pipeStreamLoop tees the stream), so nothing here would
          // otherwise reach the persisted message.
          const anchors = (exec.compactionAnchors ??= [])
          const at = anchors.findIndex((a) => a.id === anchorId)
          if (at >= 0) anchors[at] = { id: anchorId, data }
          else anchors.push({ id: anchorId, data })
        }
      })
    } catch (err) {
      if (signal.aborted) {
        if (isAttemptRunning(exec.attempt.state)) {
          this.transitionAttempt(aggregate, exec, { type: 'abort', reason: String(signal.reason ?? 'aborted') })
        }
        await this.onExecutionPaused(topicId, modelId, exec.attemptId)
        return
      }
      logger.error('streamText failed before stream start', { topicId, modelId, err })
      await this.onExecutionError(topicId, modelId, serializeError(err), exec.attemptId)
      return
    }

    // Idle-chunk timer; on timeout aborts `exec.abortController`, which the
    // upstream AI SDK request is already wired to. Caller override via
    // `requestOptions.timeout`; otherwise `DEFAULT_TIMEOUT`.
    const timeoutMs = request.requestOptions?.timeout ?? DEFAULT_TIMEOUT
    const { stream: idleStream, idle } = withIdleTimeout(rawStream, exec.abortController, timeoutMs)
    // Wrap before pipeStreamLoop's tee() so broadcast + accumulator share one
    // thinkingMs measurement (see withReasoningTimingMetadata).
    const stream = withReasoningTimingMetadata(idleStream)

    // `continue-conversation` chunks reference toolCallIds on the anchor
    // assistant message; without seeding, `readUIMessageStream`'s
    // `getToolInvocation` throws and silently halts the accumulator.
    const lastIncoming = request.messages?.at(-1)
    const accumulatorSeed: CherryUIMessage | undefined =
      lastIncoming?.role === 'assistant' ? (lastIncoming as CherryUIMessage) : undefined

    const result = await pipeStreamLoop(stream, signal, {
      onChunk: (chunk) => {
        this.onChunk(topicId, modelId, chunk, exec.attemptId)
        // A tool awaiting human approval emits no chunks while it waits, so the normal (short) idle
        // timeout would kill a legitimate deliberation. Re-arm with the generous approval bound
        // instead of pausing entirely — an unresponsive renderer still can't hang the stream forever.
        // Keyed off the pending-approval set (`onChunk` updated it above), so a parallel tool's output
        // clearing its own id keeps the generous bound while any approval is still outstanding.
        if (exec.attempt.pendingApprovalToolCallIds.size) idle.reset(this.config.approvalIdleTimeoutMs)
      },
      accumulatorSeed,
      onAccumulatedSnapshot: (msg) => {
        exec.finalMessage = withCompactionAnchors(msg, exec)
      }
    })

    exec.timings.completedAt = result.broadcastCompletedAt

    if (result.threw !== undefined) {
      if (signal.aborted) {
        logger.debug('Execution aborted', { topicId, modelId, reason: signal.reason })
        if (isAttemptRunning(exec.attempt.state)) {
          this.transitionAttempt(aggregate, exec, { type: 'abort', reason: String(signal.reason ?? 'aborted') })
        }
        await this.onExecutionPaused(topicId, modelId, exec.attemptId)
        return
      }
      logger.error('Execution loop error', { topicId, modelId, err: result.threw.error })
      const fromThrow = serializeError(result.threw.error)
      const serialized =
        result.streamErrorText !== undefined && !hasHttpMetadata(fromThrow)
          ? errorFromStreamChunk(result.streamErrorText)
          : fromThrow
      await this.onExecutionError(topicId, modelId, serialized, exec.attemptId)
      return
    }

    if (signal.aborted) {
      // The idle-timeout path aborts `exec.abortController` directly (via `withIdleTimeout`)
      // without going through `abort()`, so the attempt is still running on this clean
      // exit. Promote it so the truncated reply is persisted as `paused`, not `success`
      // (onExecutionPaused is a no-op unless the outcome is aborted).
      if (isAttemptRunning(exec.attempt.state)) {
        this.transitionAttempt(aggregate, exec, { type: 'abort', reason: String(signal.reason ?? 'idle-timeout') })
      }
      await this.onExecutionPaused(topicId, modelId, exec.attemptId)
    } else if (result.streamErrorText !== undefined) {
      await this.onExecutionError(topicId, modelId, errorFromStreamChunk(result.streamErrorText), exec.attemptId)
    } else {
      await this.onExecutionDone(topicId, modelId, exec.attemptId)
    }
  }

  /** Broadcast done for a single execution to all topic listeners. */
  private async broadcastExecutionDone(
    stream: ActiveStream,
    exec: StreamExecution,
    isTopicDone: boolean,
    phase: 'persistence' | 'settled',
    persistencePortIds?: ReadonlySet<string>
  ): Promise<PersistenceDispatchFailure | undefined> {
    const controlRevision = stream.aggregate.controlRevision
    const topicControlRevision = isTopicDone ? stream.aggregate.issueControlRevision() : undefined
    const result: StreamDoneResult = {
      finalMessage: exec.finalMessage,
      status: 'success',
      modelId: exec.modelId,
      attemptId: exec.attemptId,
      ...(isTopicDone ? { topicAttemptWatermark: this.getTopicAttemptWatermark(stream) } : {}),
      anchorMessageId: exec.anchorMessageId,
      isTopicDone,
      cycleId: stream.aggregate.cycleId,
      controlRevision,
      topicControlRevision,
      // Snapshot timings so listeners see a stable copy even if the
      // execution object is mutated after dispatch.
      timings: { ...exec.timings },
      runtimeTiming: exec.runtimeTiming.snapshot()
    }
    if (phase === 'persistence') {
      return this.dispatchToPersistencePorts(stream, 'onDone', (port) => port.onDone(result), persistencePortIds)
    }
    await this.dispatchToListeners(stream, 'onDone', (listener) => listener.onDone(result))
    if (isTopicDone) await this.dispatchCleanupPorts(stream, result)
    return undefined
  }

  private async broadcastExecutionPaused(
    stream: ActiveStream,
    exec: StreamExecution,
    isTopicDone: boolean,
    phase: 'persistence' | 'settled',
    persistencePortIds?: ReadonlySet<string>
  ): Promise<PersistenceDispatchFailure | undefined> {
    const controlRevision = stream.aggregate.controlRevision
    const topicControlRevision = isTopicDone ? stream.aggregate.issueControlRevision() : undefined
    const result = {
      finalMessage: exec.finalMessage,
      status: 'paused' as const,
      modelId: exec.modelId,
      attemptId: exec.attemptId,
      ...(isTopicDone ? { topicAttemptWatermark: this.getTopicAttemptWatermark(stream) } : {}),
      anchorMessageId: exec.anchorMessageId,
      isTopicDone,
      cycleId: stream.aggregate.cycleId,
      controlRevision,
      topicControlRevision,
      timings: { ...exec.timings },
      runtimeTiming: exec.runtimeTiming.snapshot()
    }
    if (phase === 'persistence') {
      return this.dispatchToPersistencePorts(stream, 'onPaused', (port) => port.onPaused(result), persistencePortIds)
    }
    await this.dispatchToListeners(stream, 'onPaused', (listener) => listener.onPaused(result))
    if (isTopicDone) await this.dispatchCleanupPorts(stream, result)
    return undefined
  }

  private async broadcastExecutionError(
    stream: ActiveStream,
    exec: StreamExecution,
    error: SerializedError,
    isTopicDone: boolean,
    phase: 'persistence' | 'settled',
    persistencePortIds?: ReadonlySet<string>
  ): Promise<PersistenceDispatchFailure | undefined> {
    const controlRevision = stream.aggregate.controlRevision
    const topicControlRevision = isTopicDone ? stream.aggregate.issueControlRevision() : undefined
    const result: StreamErrorResult = {
      error,
      finalMessage: exec.finalMessage,
      status: 'error',
      modelId: exec.modelId,
      attemptId: exec.attemptId,
      ...(isTopicDone ? { topicAttemptWatermark: this.getTopicAttemptWatermark(stream) } : {}),
      anchorMessageId: exec.anchorMessageId,
      isTopicDone,
      cycleId: stream.aggregate.cycleId,
      controlRevision,
      topicControlRevision,
      timings: { ...exec.timings },
      runtimeTiming: exec.runtimeTiming.snapshot()
    }
    if (phase === 'persistence') {
      return this.dispatchToPersistencePorts(stream, 'onError', (port) => port.onError(result), persistencePortIds)
    }
    await this.dispatchToListeners(stream, 'onError', (listener) => listener.onError(result))
    if (isTopicDone) await this.dispatchCleanupPorts(stream, result)
    return undefined
  }

  private getTopicAttemptWatermark(stream: ActiveStream): number {
    return stream.aggregate.attemptWatermark()
  }

  /**
   * Skips dead listeners and isolates notification failures. An explicit
   * `listeners` iterable (e.g. carried-forward renderer listeners of an
   * evicted stream) is dispatched with the same policy but never pruned.
   */
  private async dispatchToListeners(
    stream: ActiveStream,
    event: 'onDone' | 'onPaused' | 'onError',
    invoke: (listener: StreamListener) => void | Promise<void>,
    listeners?: Iterable<StreamListener>
  ): Promise<void> {
    if (listeners) {
      for (const listener of listeners) {
        if (!listener.isAlive()) continue
        try {
          await invoke(listener)
        } catch (err) {
          logger.warn('Listener threw', { topicId: stream.topicId, listenerId: listener.id, event, err })
        }
      }
      return
    }
    const dead: string[] = []
    for (const [id, listener] of stream.listeners) {
      if (!listener.isAlive()) {
        dead.push(id)
        continue
      }
      try {
        await invoke(listener)
      } catch (err) {
        logger.warn('Listener threw', { topicId: stream.topicId, listenerId: id, event, err })
      }
    }
    for (const id of dead) stream.listeners.delete(id)
  }

  private async dispatchToPersistencePorts(
    stream: ActiveStream,
    event: 'onDone' | 'onPaused' | 'onError',
    invoke: (port: StreamPersistencePort) => void | Promise<void>,
    portIds?: ReadonlySet<string>
  ): Promise<PersistenceDispatchFailure | undefined> {
    const ports = [...stream.persistencePorts].filter(([id]) => !portIds || portIds.has(id))
    if (ports.length === 0) return undefined

    this.terminalPersistenceCounts.set(stream.topicId, (this.terminalPersistenceCounts.get(stream.topicId) ?? 0) + 1)
    let persistenceFailure: PersistenceDispatchFailure | undefined
    try {
      for (const [id, port] of ports) {
        try {
          await invoke(port)
        } catch (err) {
          if (err instanceof TerminalPersistenceError) {
            if (!persistenceFailure) {
              persistenceFailure = {
                error: err.serializedError,
                durableErrorWritten: err.durableErrorWritten,
                blockedPortIds: new Set()
              }
            } else if (!err.durableErrorWritten) {
              persistenceFailure.durableErrorWritten = false
            }
            if (!err.durableErrorWritten) persistenceFailure.blockedPortIds.add(id)
          } else {
            logger.warn('Persistence port threw', { topicId: stream.topicId, persistencePortId: id, event, err })
            persistenceFailure ??= {
              error: serializeError(err),
              durableErrorWritten: false,
              blockedPortIds: new Set()
            }
            persistenceFailure.durableErrorWritten = false
            persistenceFailure.blockedPortIds.add(id)
          }
        }
      }
      return persistenceFailure
    } finally {
      const remaining = (this.terminalPersistenceCounts.get(stream.topicId) ?? 1) - 1
      if (remaining === 0) this.terminalPersistenceCounts.delete(stream.topicId)
      else this.terminalPersistenceCounts.set(stream.topicId, remaining)
    }
  }

  private async dispatchCleanupPorts(
    stream: ActiveStream,
    result: StreamDoneResult | StreamPausedResult | StreamErrorResult
  ): Promise<void> {
    for (const [id, port] of stream.cleanupPorts) {
      try {
        await port.onTopicQuiesced(result)
      } catch (err) {
        logger.warn('Cleanup port threw', { topicId: stream.topicId, cleanupPortId: id, err })
      }
    }
  }

  private computeTopicStatus(stream: ActiveStream): ActiveStream['status'] {
    return stream.aggregate.status()
  }

  private getOrCreateTopicAggregate(topicId: string): TopicStreamAggregate {
    let aggregate = this.topicAggregates.get(topicId)
    if (!aggregate) {
      aggregate = new TopicStreamAggregate(topicId, ++this.nextTopicCycleSequence)
      // T8: the ring's eviction flag is pushed here, synchronously, as each approval commits.
      aggregate.setFlagEffectSink((effect) => {
        const stream = this.activeStreams.get(topicId)
        for (const exec of stream?.executions.values() ?? []) {
          if (exec.attemptId === effect.attemptId) exec.evictionPaused = effect.paused
        }
      })
      this.topicAggregates.set(topicId, aggregate)
    }
    return aggregate
  }

  // ── Continuation leases ───────────────────────────────────────────
  // A lease keeps a topic non-quiescent while follow-up work is promised. Which lease is
  // currently launching is resource state, tracked here rather than in the reducer.

  private aggregateFor(topicId: string): TopicStreamAggregate | undefined {
    return this.activeStreams.get(topicId)?.aggregate ?? this.topicAggregates.get(topicId)
  }

  /**
   * Stop applied to attempts that are reserved but not yet launched. The reducer records the abort
   * on the attempt itself, so a dispatch parked in its prepare await finds a non-`reserved` state
   * when it resumes and settles instead of launching. No side ledger of abort reasons is kept.
   */
  private abortReservedAttempts(aggregate: TopicStreamAggregate, reason: string): boolean {
    let aborted = false
    for (const attempt of aggregate.snapshot().attempts.values()) {
      if (attempt.state.phase !== 'reserved') continue
      if (aggregate.transitionAttempt(attempt.id, { type: 'abort', reason }).ok) aborted = true
    }
    return aborted
  }

  /** The Stop reason recorded on a reserved attempt, if Stop won the race to it. */
  private stoppedReservationReason(
    aggregate: TopicStreamAggregate,
    attemptIds: readonly AttemptId[]
  ): string | undefined {
    for (const attemptId of attemptIds) {
      const state = aggregate.attemptState(attemptId)
      if (!state || state.phase === 'reserved' || state.phase === 'running') continue
      if (state.outcome.kind === 'aborted') return state.outcome.reason
    }
    return undefined
  }

  /** Open a lease (idempotent) and mark it the topic's launching one. */
  private beginDispatchingLease(
    aggregate: TopicStreamAggregate,
    topicId: string,
    leaseId: string,
    diagnosticOwner: 'agent-runtime' | 'chat-steer'
  ): boolean {
    const id = toContinuationLeaseId(leaseId)
    aggregate.openContinuationLease(id, diagnosticOwner)
    if (aggregate.continuationLease(id)?.state !== 'open') return false
    this.dispatchingLeases.set(topicId, id)
    return true
  }

  /**
   * The agent runtime pushes its continuation promise here whenever its own state changes; the
   * topic never asks the runtime what it intends to do next. Runtime → StreamManager only.
   */
  /**
   * Answer to `onTopicStop`: the subscriber owns a terminal that must land before this topic can
   * settle. Must be called synchronously from the stop handler — `abort()` reads it immediately
   * after firing, so a late hold would arrive after the topic already classified itself.
   */
  registerRuntimeTerminalHold(topicId: string, hold: RuntimeTerminalHold): void {
    this.pendingRuntimeTerminalHolds.set(topicId, hold)
  }

  setAgentContinuationLease(topicId: string, promise: { open: boolean; voidOnAttemptError: boolean }): void {
    const aggregate = this.aggregateFor(topicId)
    if (!aggregate) return
    const leaseId = toContinuationLeaseId(`agent-continuation:${topicId}`)
    if (promise.open) {
      aggregate.openContinuationLease(leaseId, 'agent-runtime', promise.voidOnAttemptError)
      return
    }
    if (aggregate.continuationLease(leaseId)?.state === 'open') {
      this.releaseLease(topicId, leaseId, 'queue-cleared')
    }
  }

  /** Whether the agent runtime still promises a follow-up turn on this topic. */
  private hasAgentContinuationLease(topicId: string): boolean {
    return (
      this.aggregateFor(topicId)?.continuationLease(toContinuationLeaseId(`agent-continuation:${topicId}`))?.state ===
      'open'
    )
  }

  /** Open a lease without claiming the launch slot — a queued steer waiting its turn. */
  private openQueuedLease(topicId: string, leaseId: string): void {
    this.aggregateFor(topicId)?.openContinuationLease(toContinuationLeaseId(leaseId), 'chat-steer')
  }

  /** The topic's launching lease, or undefined once it settled. */
  private dispatchingLeaseId(topicId: string): ContinuationLeaseId | undefined {
    const id = this.dispatchingLeases.get(topicId)
    if (!id) return undefined
    if (this.aggregateFor(topicId)?.continuationLease(id)?.state !== 'open') {
      this.dispatchingLeases.delete(topicId)
      return undefined
    }
    return id
  }

  /** `aggregate` is explicit: a continuation can settle against the cycle it was opened on even
   *  after `dispatch` evicted that stream and installed a newer aggregate. */
  private consumeLease(
    topicId: string,
    leaseId: ContinuationLeaseId,
    attemptId: AttemptId,
    aggregate = this.aggregateFor(topicId)
  ): boolean {
    const consumed = aggregate?.consumeContinuationLease(leaseId, attemptId) === true
    if (this.dispatchingLeases.get(topicId) === leaseId) this.dispatchingLeases.delete(topicId)
    return consumed
  }

  /**
   * Void every open lease on a topic. Used where the promised follow-up demonstrably will not
   * happen — Stop, or a continuation that failed to launch — so a still-open promise cannot keep
   * the topic from quiescing after its opener has given up.
   */
  private releaseOpenLeases(
    topicId: string,
    reason: ContinuationReleaseReason,
    aggregate?: TopicStreamAggregate
  ): void {
    const target = aggregate ?? this.aggregateFor(topicId)
    if (!target) return
    for (const leaseId of target.openContinuationLeaseIds()) this.releaseLease(topicId, leaseId, reason, target)
  }

  private releaseLease(
    topicId: string,
    leaseId: ContinuationLeaseId,
    reason: ContinuationReleaseReason,
    aggregate = this.aggregateFor(topicId)
  ): boolean {
    const released = aggregate?.releaseContinuationLease(leaseId, reason) === true
    if (this.dispatchingLeases.get(topicId) === leaseId) this.dispatchingLeases.delete(topicId)
    return released
  }

  /** Immediate eviction (cancels grace-period timer if any). Used by `send` over previous-grace-period streams. */
  private evictStream(topicId: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    if (stream.cleanupTimer) clearTimeout(stream.cleanupTimer)
    this.recoveries.releaseTopic(topicId)
    const unsettledAttempts = [...stream.executions.values()].filter((exec) => !isAttemptSettled(exec.attempt.state))
    if (unsettledAttempts.length > 0) {
      logger.error('Evicting stream with unsettled attempts', {
        topicId,
        attempts: unsettledAttempts.map((exec) => ({ attemptId: exec.attemptId, phase: exec.attempt.state.phase }))
      })
    }
    for (const exec of stream.executions.values()) {
      endRootSpan(exec, 'aborted')
    }
    stream.aggregate.evict()
    this.activeStreams.delete(topicId)
    if (this.topicAggregates.get(topicId) === stream.aggregate) this.topicAggregates.delete(topicId)
  }
}
