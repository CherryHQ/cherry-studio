import { randomUUID } from 'node:crypto'

import { application } from '@application'
import type { TokenUsageSource } from '@cherrystudio/analytics-client'
import { loggerService } from '@logger'
import { DEFAULT_TIMEOUT } from '@main/ai/constants'
import { serializeError } from '@main/ai/utils/serializeError'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import {
  BaseService,
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
import type {
  ActiveExecution,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenResponse
} from '@shared/ai/transport'
import { aiStreamAdmissionReasons } from '@shared/ai/transport'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { MessageRuntimeSpan, MessageRuntimeTiming } from '@shared/data/types/message'
import type { ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { extractAgentSessionId, isAgentSessionTopic } from '../agentSession/topic'
import { applyTurnOutputAttributes } from '../observability'
import type {
  AiStreamRequest,
  ApprovalRequestedEvent,
  CallOverrides,
  ContextOwner,
  InProcessUsageContext
} from '../types'
import { AiStreamAdmissionError, type LiveExecutionChangeAdmission, type LiveExecutionChangeIntent } from './admission'
import { buildCompactReplay, mergeDeltaPayload, splitDeltaPayload } from './buildCompactReplay'
import { dispatchStreamRequest, type MainDispatchRequest } from './context/dispatch'
import { createChatStreamLifecycle } from './lifecycle/ChatStreamLifecycle'
import { promptStreamLifecycle } from './lifecycle/PromptStreamLifecycle'
import type { StreamLifecycle } from './lifecycle/StreamLifecycle'
import { TerminalPersistenceError } from './listeners/PersistenceListener'
import { isRendererListener, WebContentsListener } from './listeners/WebContentsListener'
import { MessageRuntimeTimingCollector } from './MessageRuntimeTimingCollector'
import { pipeStreamLoop } from './pipeStreamLoop'
import { projectStreamChunkPayloadForRenderer, projectStreamMessageForRenderer } from './rendererPayload'
import type {
  ActiveStream,
  AiStreamManagerConfig,
  CherryUIMessage,
  ConversationCompletedEvent,
  StreamChunkPayload,
  StreamDoneResult,
  StreamErrorResult,
  StreamExecution,
  StreamListener,
  TransportTimings
} from './types'
import { withReasoningTimingMetadata } from './withReasoningTimingMetadata'

const logger = loggerService.withContext('AiStreamManager')
type ManagedAiStreamRequest = AiStreamRequest & {
  usageContext?: InProcessUsageContext
  tokenUsageSource?: TokenUsageSource
}

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
  siblingsGroupId?: number
  /** Replace or append one execution in the current live reply group. */
  liveExecutionChange?: LiveExecutionChange
  /** Defaults to chat lifecycle. `streamPrompt` passes `promptStreamLifecycle`. */
  lifecycle?: StreamLifecycle
  /** Admission-time snapshot; temporary/internal streams omit it. */
  isPersistentConversation?: boolean
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
  readonly status: StreamExecution['status']
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
export class AiStreamManager extends BaseService {
  private readonly _onApprovalRequested = new Emitter<ApprovalRequestedEvent>()
  public readonly onApprovalRequested: Event<ApprovalRequestedEvent> = this._onApprovalRequested.event
  private readonly _onConversationCompleted = new Emitter<ConversationCompletedEvent>()
  public readonly onConversationCompleted: Event<ConversationCompletedEvent> = this._onConversationCompleted.event
  private readonly activeStreams = new Map<string, ActiveStream>()
  /** Serialises `prepareDispatch → send` per topic so concurrent `ai.stream.open` requests can't race
   *  the `hasLiveStream` snapshot and orphan a PENDING placeholder row. */
  private readonly dispatchLock = new KeyedMutex()
  private readonly config: AiStreamManagerConfig
  private nextStreamTurnSequence = 0
  private nextExecutionAttemptSequence = 0
  /** Per-topic FIFO of steer user-message ids persisted while a turn was live. Chat's analogue of
   *  the agent runtime's `pendingTurns`; drained one continuation turn at a time. */
  private readonly pendingSteers = new Map<
    string,
    Array<{
      userMessageId: string
      reasoningEffort?: ReasoningEffortOption
      serviceTier?: ServiceTierSelection
      fastMode: boolean
    }>
  >()
  /** Topics whose steer continuation is mid-launch — dedups `scheduleNextChatTurn`, mirroring the
   *  agent runtime's explicit launch state. */
  private readonly startingNextChatTopicIds = new Set<string>()
  /** Write-quiesce holds (backup restore). Quiesced ⇔ non-empty. Distinct from the BaseService
   *  lifecycle pause — this never touches service state. See `pause()`. */
  private readonly pauseHolds = new Set<symbol>()
  /** Gate-admitted dispatches still inside `prepareDispatch → send`. Registered before the
   *  first async admission gap can yield to pause/drain, then removed after stream handoff. */
  private readonly inFlightDispatches = new Map<Promise<AiStreamOpenResponse>, string>()
  /** Terminal persistence listeners currently writing by topic. Unlike `hasLiveStream`, this remains
   *  true after terminal status is published and clears before runtime/renderer terminal listeners run. */
  private readonly terminalPersistenceCounts = new Map<string, number>()
  /** Steer continuations suppressed by the write-quiesce gate; the last hold's disposal re-kicks
   *  them (mirrors JobManager's suppressed-fires sets). */
  private readonly suppressedChatContinuationTopicIds = new Set<string>()
  /** In-flight steer-continuation launches (registered synchronously in `scheduleNextChatTurn`),
   *  part of `drainInFlight`'s wait-set — a launch admitted before a pause must be awaited. */
  private readonly inFlightChatContinuations = new Map<string, Promise<void>>()
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
    this.chatLifecycle = createChatStreamLifecycle(this.config.gracePeriodMs, (event) =>
      this._onConversationCompleted.fire(event)
    )
  }

  protected async onInit(): Promise<void> {
    // Resolve crash-orphaned PENDING rows before any new stream can be opened — at boot the
    // in-memory registry is empty, so every still-`pending` assistant row is stale.
    this.reconcileStalePendingMessages()
    this.markReconciled()
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
   * `ai.stream.open` + approval-continue paths) and `startAgentSessionRun` (scheduler /
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
      if (!isLiveStatus(stream.status)) continue
      work.push({ id: topicId, summary: `stream:${stream.status} execs=${stream.executions.size}` })
    }
    for (const topicId of new Set(this.inFlightDispatches.values())) {
      work.push({ id: `dispatch:${topicId}`, summary: 'stream dispatch admitting' })
    }
    for (const topicId of this.inFlightChatContinuations.keys()) {
      work.push({ id: `chat-continuation:${topicId}`, summary: 'steer continuation launching' })
    }
    return work
  }

  private drainWaitSet(): Array<[Promise<unknown>, string]> {
    const entries: Array<[Promise<unknown>, string]> = []
    for (const [topicId, stream] of this.activeStreams) {
      // Only streams that persist are waited on. That's listener-derived, not lifecycle-derived:
      // a chunks-only prompt stream (API gateway, orphan translate) is excluded, while a
      // translate-with-persist carries a TranslationBackend PersistenceListener and IS drained.
      const persistent = [...stream.listeners.keys()].some((id) => id.startsWith('persistence:'))
      if (!persistent) continue
      for (const exec of stream.executions.values()) entries.push([exec.loopPromise, topicId])
    }
    for (const [admission, topicId] of this.inFlightDispatches) {
      entries.push([admission, `dispatch:${topicId}`])
    }
    for (const [topicId, launch] of this.inFlightChatContinuations) {
      entries.push([launch, `chat-continuation:${topicId}`])
    }
    for (const [key, write] of topicNamingService.inFlightWrites()) {
      entries.push([write, `naming:${key}`])
    }
    return entries
  }

  /** Last-hold release: re-kick suppressed steer continuations. The re-check guard skips
   *  WITHOUT draining the set, so a newer hold (or shutdown) inherits the debt. */
  private runReleaseCompensation(): void {
    if (this.isShuttingDown || this.isWriteQuiesced) return
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
      messageService.markMessagesError(staleIds)
    } catch (error) {
      logger.error('Failed to reconcile stale pending messages', { error })
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
      .filter(([, s]) => isLiveStatus(s.status))
      .map(([topicId]) => topicId)

    if (activeTopics.length === 0) return
    logger.info('Stopping active streams on shutdown', { count: activeTopics.length })

    const loopPromises: Promise<void>[] = []
    for (const topicId of activeTopics) {
      const stream = this.activeStreams.get(topicId)
      if (!stream) continue
      for (const exec of stream.executions.values()) {
        loopPromises.push(exec.loopPromise)
      }
      this.abort(topicId, 'app-shutdown')
    }

    await Promise.allSettled(loopPromises)
  }

  protected onDestroy(): void {
    this._onApprovalRequested.dispose()
    this._onConversationCompleted.dispose()
  }

  // ── Public: unified send ──────────────────────────────────────────

  admitLiveExecutionChange(topicId: string, intent: LiveExecutionChangeIntent): LiveExecutionChangeAdmission {
    const stream = this.activeStreams.get(topicId)
    const isLive = Boolean(stream && isLiveStatus(stream.status))

    if (intent.mode === 'start') {
      if (isLive && intent.modelCount > 0) {
        throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TOPIC_BUSY)
      }
      return { mode: 'start-new' }
    }

    const targetMessageId = intent.mode === 'append' ? intent.targetMessageId : intent.anchorMessageId
    if (!isPersistedReplyGroupAnchor(targetMessageId, topicId, intent.parentAnchorId, intent.siblingsGroupId)) {
      throw new AiStreamAdmissionError(aiStreamAdmissionReasons.TARGET_NOT_IN_LIVE_GROUP)
    }
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
    if (execution.status === 'streaming') {
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
    const inputModelIds = new Set<UniqueModelId>()
    for (const { modelId } of input.models) {
      if (inputModelIds.has(modelId)) {
        throw new Error(`send() got duplicate modelId ${modelId} for topic ${input.topicId}`)
      }
      inputModelIds.add(modelId)
    }

    const existing = this.activeStreams.get(input.topicId)
    const liveExecutionChange = input.liveExecutionChange

    if (existing && isLiveStatus(existing.status) && liveExecutionChange) {
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
      this.admitLiveExecutionChange(input.topicId, admissionIntent)
      const hasLiveSibling = [...existing.executions.entries()].some(
        ([modelId, execution]) => modelId !== model.modelId && execution.status === 'streaming'
      )

      if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer)
      existing.cleanupTimer = undefined
      existing.expiresAt = undefined
      for (const listener of input.listeners) existing.listeners.set(listener.id, listener)
      const nextExecution = this.createAndLaunchExecution(
        input.topicId,
        model.modelId,
        model.request,
        input.siblingsGroupId ?? previous?.siblingsGroupId,
        model.runtimeTimingSeed,
        model.seedFromEmpty,
        model.rootSpan,
        model.abortController
      )
      // Replacing an existing key preserves its insertion position; appending a new key places the
      // new model last. Both cases keep the visual multi-model order stable.
      existing.executions.set(model.modelId, nextExecution)
      existing.isMultiModel = existing.executions.size > 1
      existing.status = hasLiveSibling ? 'streaming' : 'pending'
      existing.lifecycle.onActiveExecutionsChanged(existing)
      return {
        mode: 'started',
        activeExecutions: [toActiveExecution(nextExecution)]
      }
    }

    if (existing && isLiveStatus(existing.status)) {
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
        this.admitLiveExecutionChange(input.topicId, { mode: 'start', modelCount: input.models.length })
      }
      for (const listener of input.listeners) this.addListener(input.topicId, listener)
      return {
        mode: 'injected',
        activeExecutions: [...existing.executions.values()]
          .filter((exec) => exec.status === 'streaming')
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
    const executions = new Map<UniqueModelId, StreamExecution>()

    for (const { modelId, request, runtimeTimingSeed, seedFromEmpty, rootSpan, abortController } of input.models) {
      const exec = this.createAndLaunchExecution(
        input.topicId,
        modelId,
        request,
        input.siblingsGroupId,
        runtimeTimingSeed,
        seedFromEmpty,
        rootSpan,
        abortController
      )
      executions.set(modelId, exec)
    }

    const stream: ActiveStream = {
      topicId: input.topicId,
      // Surfaced into the topic status snapshot and the main-only completion event as this turn's
      // stable identity.
      turnId: `${Date.now()}:${++this.nextStreamTurnSequence}`,
      executions,
      listeners: new Map(input.listeners.map((l) => [l.id, l])),
      // `pending` → `streaming` on first chunk.
      status: 'pending',
      isMultiModel,
      lifecycle: input.lifecycle ?? this.chatLifecycle,
      isPersistentConversation: input.isPersistentConversation === true
    }
    this.activeStreams.set(input.topicId, stream)
    // Chat broadcasts to SharedCache so `useChatWithHistory.resumeActiveStream` can attach; prompt is silent.
    stream.lifecycle.onCreated(stream)

    if ([...executions.values()].every((exec) => exec.abortController.signal.aborted)) {
      stream.status = 'aborted'
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
    /** Trusted in-process classification for remote token analytics. */
    tokenUsageSource?: TokenUsageSource
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
      ...(input.tokenUsageSource ? { tokenUsageSource: input.tokenUsageSource } : {}),
      ...(input.idleTimeoutMs !== undefined ? { requestOptions: { timeout: input.idleTimeoutMs } } : {})
    }
    return this.send({
      topicId: input.streamId,
      models: [{ modelId: input.uniqueModelId, request }],
      listeners: Array.isArray(input.listener) ? input.listener : [input.listener],
      lifecycle: promptStreamLifecycle
    })
  }

  startRuntimeTurn(input: StartRuntimeTurnInput): SendResult {
    const existing = this.activeStreams.get(input.topicId)
    const carriedListeners = existing
      ? [...existing.listeners.values()].filter(
          (listener) => !listener.id.startsWith('persistence:') && !listener.id.startsWith('agent-runtime:')
        )
      : []

    if (existing) this.evictStream(input.topicId)

    return this.send({
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
      isPersistentConversation: true
    })
  }

  /**
   * Detach one not-yet-admitted runtime execution without terminalizing its reserved assistant row.
   * The runtime closes the upstream stream immediately after this call, then waits for the returned
   * promise before opening the receive-only generation that preempted it.
   */
  async suspendUnadmittedRuntimeTurn(topicId: string): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) return

    for (const id of stream.listeners.keys()) {
      if (id.startsWith('persistence:') || id.startsWith('agent-runtime:')) {
        stream.listeners.delete(id)
      }
    }

    await Promise.allSettled([...stream.executions.values()].map((execution) => execution.loopPromise))
  }

  /**
   * True iff this topic has a pending or streaming turn. Providers use this
   * initial admission snapshot to choose inject, append, or ordinary start
   * preparation.
   */
  hasLiveStream(topicId: string): boolean {
    const stream = this.activeStreams.get(topicId)
    return Boolean(stream && isLiveStatus(stream.status))
  }

  /** True while a terminal listener is writing durable state for this topic. */
  hasTerminalPersistenceInFlight(topicId: string): boolean {
    return (this.terminalPersistenceCounts.get(topicId) ?? 0) > 0
  }

  /**
   * Wait until a failed execution has finished notifying/persisting its terminal event, then decide
   * whether a retry can replace that exact slot or should start a fresh one-model stream because the
   * sibling turn finished in the meantime. Called under the topic dispatch lock.
   */
  async awaitExecutionRetry(
    topicId: string,
    modelId: UniqueModelId,
    anchorMessageId: string,
    parentAnchorId: string,
    compatibleSiblingsGroupId?: number
  ): Promise<LiveExecutionChangeAdmission> {
    const intent = {
      mode: 'replace' as const,
      modelId,
      anchorMessageId,
      parentAnchorId,
      siblingsGroupId: compatibleSiblingsGroupId
    }
    const admission = this.admitLiveExecutionChange(topicId, intent)
    if (admission.mode !== 'replace-live') return admission

    const execution = this.activeStreams.get(topicId)?.executions.get(modelId)
    if (!execution) throw new AiStreamAdmissionError(aiStreamAdmissionReasons.EXECUTION_CHANGED)

    // Do not reset the row or replace the listener id until the old loop has completed every
    // terminal listener.
    await execution.loopPromise

    const current = this.activeStreams.get(topicId)
    if (!current) return { mode: 'start-new' }
    const currentExecution = current.executions.get(modelId)
    if (!currentExecution || currentExecution !== execution || currentExecution.anchorMessageId !== anchorMessageId) {
      if (isLiveStatus(current.status)) {
        throw new AiStreamAdmissionError(aiStreamAdmissionReasons.EXECUTION_CHANGED)
      }
      return { mode: 'start-new' }
    }
    return this.admitLiveExecutionChange(topicId, intent)
  }

  /** Whether any chat or agent turn is still able to write persisted stream state. */
  hasLiveStreams(): boolean {
    for (const stream of this.activeStreams.values()) {
      if (isLiveStatus(stream.status)) return true
    }
    return false
  }

  pauseRuntimeTurn(topicId: string, reason: string): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) return false

    logger.info('Pausing runtime stream turn', { topicId, reason })
    for (const exec of stream.executions.values()) {
      if (exec.status === 'streaming') {
        exec.status = 'aborted'
        exec.abortController.abort(reason)
      }
    }
    stream.status = 'aborted'
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
    serviceTier?: ServiceTierSelection,
    fastMode?: boolean
  ): void {
    // The turn may have settled between `prepareDispatch` and here (the loop's terminal hooks don't
    // hold the dispatch lock), so no hook would fire to chain this steer. Decide from the single
    // authority — the resolved `status` on the still-in-grace stream — not a separate shadow flag:
    //   • live              → queue; it yields at a step boundary and `onExecutionDone` chains it.
    //   • done / no stream  → queue + start the continuation now (the inter-turn drain race; an idle
    //                         topic with no stream is just a fresh turn).
    //   • awaiting-approval → queue but DON'T start; the continuation the user's Approve dispatches
    //                         drains it once that turn completes.
    //   • aborted / error   → drop; the persisted user row stays for the user to resend.
    const status = this.activeStreams.get(topicId)?.status
    if (status && isLiveStatus(status)) {
      this.appendPendingSteer(topicId, userMessageId, reasoningEffort, serviceTier, fastMode)
      return
    }
    if (status === 'aborted' || status === 'error') {
      logger.warn('Steer landed after a non-clean terminal — dropping (row stays resendable)', {
        topicId,
        userMessageId,
        terminal: status
      })
      return
    }
    this.appendPendingSteer(topicId, userMessageId, reasoningEffort, serviceTier, fastMode)
    if (status !== 'awaiting-approval') this.scheduleNextChatTurn(topicId)
  }

  private appendPendingSteer(
    topicId: string,
    userMessageId: string,
    reasoningEffort?: ReasoningEffortOption,
    serviceTier?: ServiceTierSelection,
    fastMode?: boolean
  ): void {
    const queue = this.pendingSteers.get(topicId)
    const item = { userMessageId, reasoningEffort, serviceTier, fastMode: fastMode === true }
    if (queue) queue.push(item)
    else this.pendingSteers.set(topicId, [item])
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
        listener.onChunk(chunk.chunk, chunk.executionId, chunk.anchorMessageId, chunk.attemptId)
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
      const pendingApprovals = exec.pendingApprovalToolCallIds
      if (!pendingApprovals?.delete(toolCallId)) continue
      exec.runtimeTiming.finishApproval({ toolCallId })
      changed = true
      if (approved) {
        // AI SDK has no UI-stream approval-response chunk. Replaying the input advances the part
        // and lets a parallel batch surface its next approval before the tools execute.
        const inputChunk = findBufferedToolInput(exec, toolCallId)
        if (inputChunk) this.onChunk(topicId, exec.modelId, inputChunk, exec)
      } else {
        this.onChunk(topicId, exec.modelId, { type: 'tool-output-denied', toolCallId }, exec)
      }
      if (pendingApprovals.size === 0) pendingApprovalFlipped = true
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

  // ── Public: abort ─────────────────────────────────────────────────

  /** Abort all executions in a topic. */
  abort(topicId: string, reason: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) {
      if (isAgentSessionTopic(topicId)) {
        application.get('AgentSessionRuntimeService').abortPendingTurn(extractAgentSessionId(topicId), reason)
      }
      return
    }
    logger.info('Aborting stream', { topicId, reason })
    for (const exec of stream.executions.values()) {
      if (exec.status === 'streaming') {
        exec.status = 'aborted'
        exec.abortController.abort(reason)
      }
    }
    // Flip status to 'aborted' synchronously here, where Stop's fate is decided — `onExecutionPaused`
    // only runs after the loop settles asynchronously. A steer enqueue landing in that window reads
    // this 'aborted' off the in-grace stream and drops, instead of draining after Stop.
    stream.status = 'aborted'
  }

  /** Abort a user-visible topic and hold same-topic admission until its durable teardown settles. */
  async abortAndDrain(topicId: string, reason: string): Promise<void> {
    await this.withDispatchLock(topicId, async () => {
      const stream = this.activeStreams.get(topicId)
      const loopPromises = stream ? [...stream.executions.values()].map((execution) => execution.loopPromise) : []
      const drainedLoops = new Set(loopPromises)

      this.abort(topicId, reason)
      await Promise.allSettled(loopPromises)

      if (isAgentSessionTopic(topicId)) {
        const runtimeClosing = application
          .get('AgentSessionRuntimeService')
          .closeSession(extractAgentSessionId(topicId))
        const drainReplacementLoops = async (): Promise<void> => {
          for (;;) {
            const replacement = this.activeStreams.get(topicId)
            const replacementLoops = replacement
              ? [...replacement.executions.values()]
                  .map((execution) => execution.loopPromise)
                  .filter((loopPromise) => !drainedLoops.has(loopPromise))
              : []
            if (replacementLoops.length === 0) return

            replacementLoops.forEach((loopPromise) => drainedLoops.add(loopPromise))
            this.abort(topicId, reason)
            await Promise.allSettled(replacementLoops)
          }
        }

        await drainReplacementLoops()
        await runtimeClosing
        await drainReplacementLoops()
      }
    })
  }

  // ── Execution loop callbacks ──────────────────────────────────────
  // Driven internally by `createAndLaunchExecution`. Public because
  // tests invoke them directly to simulate chunk/done/error.

  /** Multi-model: chunks carry `sourceModelId` for renderer demux. */
  onChunk(topicId: string, modelId: UniqueModelId, chunk: UIMessageChunk, expectedExecution?: StreamExecution): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) return

    const exec = stream.executions.get(modelId)
    if (!exec || (expectedExecution && exec !== expectedExecution)) return

    const sourceModelId = modelId
    const anchorMessageId = exec.anchorMessageId
    const payload: StreamChunkPayload = {
      topicId,
      executionId: sourceModelId,
      attemptId: exec.attemptId,
      anchorMessageId,
      chunk
    }

    // Authoritative approval-lifecycle capture, keyed by toolCallId so a sibling tool's output never
    // clears another tool's still-pending approval; `resolveTerminalStatus` reads the set's size.
    const hadPendingApprovals = (exec.pendingApprovalToolCallIds?.size ?? 0) > 0
    if (chunk.type === 'tool-approval-request') {
      const pendingApprovals = (exec.pendingApprovalToolCallIds ??= new Set())
      pendingApprovals.add(chunk.toolCallId)
      exec.runtimeTiming.startApproval(chunk.approvalId, chunk.toolCallId, toolNameFromApprovalChunk(chunk))
      const publishedApprovals = (exec.publishedApprovalIds ??= new Set())
      if (!publishedApprovals.has(chunk.approvalId) && stream.isPersistentConversation) {
        publishedApprovals.add(chunk.approvalId)
        this._onApprovalRequested.fire({
          topicId,
          approvalId: chunk.approvalId,
          requestedAt: Date.now()
        })
      }
    } else if (
      chunk.type === 'tool-output-available' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied'
    ) {
      exec.pendingApprovalToolCallIds?.delete(chunk.toolCallId)
      exec.runtimeTiming.finishApproval({ toolCallId: chunk.toolCallId })
    }
    // Broadcast payloads and consumers only care about "any pending?", so only
    // the empty↔non-empty flip warrants a rebroadcast — size changes within
    // parallel approvals would produce byte-identical payloads.
    const hasPendingApprovals = (exec.pendingApprovalToolCallIds?.size ?? 0) > 0
    const pendingApprovalFlipped = hadPendingApprovals !== hasPendingApprovals

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
    for (const segment of splitDeltaPayload(payload, this.config.maxDeltaBytes)) {
      const tail = exec.buffer.at(-1)
      const merged = tail ? mergeDeltaPayload(tail, segment, this.config.maxDeltaBytes) : undefined
      if (merged) {
        exec.buffer[exec.buffer.length - 1] = merged
      } else {
        if (exec.buffer.length >= bufferLimit && !exec.pendingApprovalToolCallIds?.size) {
          exec.buffer.shift()
          exec.droppedChunks += 1
        }
        exec.buffer.push(segment)
      }
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
        listener.onChunk(chunk, sourceModelId, anchorMessageId, exec.attemptId)
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
  async onExecutionDone(topicId: string, modelId: UniqueModelId, expectedExecution?: StreamExecution): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || (expectedExecution && exec !== expectedExecution) || exec.status !== 'streaming') return

    exec.status = 'done'
    exec.runtimeTiming.closeOpenToolSpans()
    if ((exec.pendingApprovalToolCallIds?.size ?? 0) === 0) {
      exec.runtimeTiming.closeOpenSpans()
      exec.runtimeTiming.complete()
    }
    endRootSpan(exec, 'ok')

    // Compute topic status first so listeners get isTopicDone
    stream.status = this.resolveTerminalStatus(stream)
    const topicDone = !isLiveStatus(stream.status)

    // Chain the next chat turn only on a CLEAN topic-done. Keying off the resolved status (not
    // `topicDone`, which is also true for error/aborted/awaiting-approval) makes the decision
    // independent of which execution settled last: a multi-model turn that resolved to 'error' never
    // chains, in either settle order. An 'awaiting-approval' parked turn also doesn't chain — the
    // steer stays queued for the continuation the user's Approve dispatches. Broadcast this exec's
    // done with isTopicDone=false when chaining (the bubble finalises, the topic stays busy), skip the
    // terminal lifecycle, and start the continuation with the carried renderer listeners.
    // Agent sessions chain their own follow-ups (terminal listener -> markTurnTerminal -> startNextTurn):
    // when the runtime will continue this topic, keep the stream alive so the next turn reaches the
    // carried renderer listeners, but let the runtime drive the continuation.
    const chatChaining = stream.status === 'done' && this.hasPendingSteer(topicId)
    const agentChaining =
      topicDone &&
      !chatChaining &&
      stream.status === 'done' &&
      isAgentSessionTopic(topicId) &&
      application.get('AgentSessionRuntimeService').willContinueTopic(topicId)
    const chaining = chatChaining || agentChaining

    await this.broadcastExecutionDone(stream, exec, topicDone && !chaining)

    // The awaited dispatch can outlive this stream's registry slot — a new stream for
    // the topic may have replaced it while listeners ran. Everything below belongs to
    // the current stream generation only; a stale callback must not touch it.
    if (this.activeStreams.get(topicId) !== stream) return

    if (chatChaining) this.scheduleNextChatTurn(topicId)
    else if (topicDone && !chaining) {
      // A sibling errored/aborted (this exec finished clean but the topic didn't): drop the queue,
      // matching onExecutionError/onExecutionPaused. A clean 'done' or an approval-park keeps it.
      if (stream.status === 'error' || stream.status === 'aborted') this.dropPendingSteers(topicId, stream.status)
      this.runTerminalLifecycle(stream)
    }
  }

  async onExecutionPaused(topicId: string, modelId: UniqueModelId, expectedExecution?: StreamExecution): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || (expectedExecution && exec !== expectedExecution) || exec.status !== 'aborted') return

    // A turn torn down while a tool is still `approval-requested` (or any
    // in-flight tool) gets no `tool-output-*` to clear it. Clear the set so the
    // status resolves to plain `aborted` (not `awaiting-approval`) and the
    // status-cache anchor drops; the dangling tool part itself is terminalized
    // to `output-error` by `finalizeInterruptedParts` at every projection
    // (persistence already, re-attach below). Must run before
    // `resolveTerminalStatus`.
    const hadPendingApprovals = (exec.pendingApprovalToolCallIds?.size ?? 0) > 0
    exec.pendingApprovalToolCallIds?.clear()
    exec.runtimeTiming.closeOpenSpans()
    exec.runtimeTiming.complete()

    endRootSpan(exec, 'aborted')
    stream.status = this.resolveTerminalStatus(stream)
    const isTopicDone = !isLiveStatus(stream.status)

    // A live sibling keeps the topic out of the terminal broadcast below, so
    // the dropped approval anchor must reach the shared cache on its own.
    if (hadPendingApprovals && !isTopicDone) stream.lifecycle.onApprovalPendingChanged(stream)

    await this.broadcastExecutionPaused(stream, exec, isTopicDone)

    // See onExecutionDone: awaited terminal dispatch may outlive this stream's registry slot.
    if (this.activeStreams.get(topicId) !== stream) return

    if (isTopicDone) {
      // Aborted (stop button / idle timeout), not a clean steer-yield — drop any queued steer
      // instead of chaining. Its persisted user row stays as a dangling message the user can resend.
      this.dropPendingSteers(topicId, 'aborted')
      this.runTerminalLifecycle(stream)
    }
  }

  /** Called when one execution errors. */
  async onExecutionError(
    topicId: string,
    modelId: UniqueModelId,
    error: SerializedError,
    expectedExecution?: StreamExecution
  ): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || (expectedExecution && exec !== expectedExecution)) return

    exec.status = 'error'
    exec.error = error
    endRootSpan(exec, 'error', error)

    // Mirror of onExecutionPaused: clear the set so the status anchor drops;
    // the in-flight tool part is terminalized by `finalizeInterruptedParts`.
    const hadPendingApprovals = (exec.pendingApprovalToolCallIds?.size ?? 0) > 0
    exec.pendingApprovalToolCallIds?.clear()
    exec.runtimeTiming.closeOpenSpans()
    exec.runtimeTiming.complete()

    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = !isLiveStatus(stream.status)

    // A live sibling keeps the topic out of the terminal broadcast below, so
    // the dropped approval anchor must reach the shared cache on its own.
    if (hadPendingApprovals && !isTopicDone) stream.lifecycle.onApprovalPendingChanged(stream)
    const finalMessage = ensureTerminalFinalMessage(exec)

    const result: StreamErrorResult = {
      error,
      finalMessage,
      status: 'error',
      modelId: exec.modelId,
      attemptId: exec.attemptId,
      ...(isTopicDone ? { topicAttemptWatermark: this.getTopicAttemptWatermark(stream) } : {}),
      anchorMessageId: exec.anchorMessageId,
      isTopicDone,
      timings: { ...exec.timings },
      runtimeTiming: exec.runtimeTiming.snapshot()
    }

    await this.dispatchToListeners(stream, 'onError', (listener) => listener.onError(result))

    // See onExecutionDone: awaited terminal dispatch may outlive this stream's registry slot.
    if (this.activeStreams.get(topicId) !== stream) return

    if (isTopicDone) {
      // Errored turn — drop any queued steer rather than chaining onto a failed turn.
      this.dropPendingSteers(topicId, 'error')
      this.runTerminalLifecycle(stream)
    }
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
    }
    this.pendingSteers.delete(topicId)
  }

  /**
   * Surface a stream error to a topic's transport subscribers WITHOUT mutating execution
   * state or re-running persistence. Used when terminal persistence fails: the DB row is driven
   * to `error` separately and the original terminal event is suppressed. Persistence listeners
   * are skipped because they just failed and would loop. No-op once the stream has drained.
   */
  broadcastTopicError(topicId: string, modelId: UniqueModelId | undefined, error: SerializedError): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const exec = modelId ? stream.executions.get(modelId) : undefined
    const isTopicDone = !isLiveStatus(stream.status)
    const result: StreamErrorResult = {
      error,
      status: 'error',
      modelId,
      attemptId: exec?.attemptId,
      ...(isTopicDone ? { topicAttemptWatermark: this.getTopicAttemptWatermark(stream) } : {}),
      anchorMessageId: exec?.anchorMessageId,
      isTopicDone
    }
    for (const listener of stream.listeners.values()) {
      if (listener.id.startsWith('persistence:')) continue
      try {
        void listener.onError(result)
      } catch (err) {
        logger.warn('broadcastTopicError listener threw', { topicId, err })
      }
    }
  }

  /**
   * Settle a topic stream that a chaining turn kept alive (`isTopicDone=false`, terminal lifecycle
   * skipped) when the agent runtime's queued continuation could NOT be launched — e.g. its drain
   * re-check found the agent model deleted. `broadcastTopicError` alone only notifies current
   * subscribers: it leaves the held stream in `activeStreams` with its terminal lifecycle un-run, so
   * the cross-window status cache stays `streaming` and a re-attaching window still sees the stale
   * prior turn as live. Surface the error to transport subscribers (persistence skipped — the
   * continuation turn never opened), write the terminal status, and run the terminal lifecycle so the
   * status cache settles and the stream is evicted. Mirrors the chat path's `failChatContinuation`.
   */
  terminateHeldTopicStream(topicId: string, modelId: UniqueModelId | undefined, error: SerializedError): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const exec = modelId ? stream.executions.get(modelId) : undefined
    const result: StreamErrorResult = {
      error,
      status: 'error',
      modelId,
      attemptId: exec?.attemptId,
      topicAttemptWatermark: this.getTopicAttemptWatermark(stream),
      anchorMessageId: exec?.anchorMessageId,
      isTopicDone: true
    }
    for (const listener of stream.listeners.values()) {
      if (listener.id.startsWith('persistence:')) continue
      try {
        void listener.onError(result)
      } catch (err) {
        logger.warn('terminateHeldTopicStream listener threw', { topicId, err })
      }
    }
    stream.status = 'error'
    this.runTerminalLifecycle(stream)
  }

  /** Chat defers 30 s, prompt evicts immediately. */
  private runTerminalLifecycle(stream: ActiveStream): void {
    stream.lifecycle.onTerminal(stream)
    stream.lifecycle.cleanup(stream, () => {
      if (this.activeStreams.get(stream.topicId) === stream) {
        this.activeStreams.delete(stream.topicId)
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
    // Never evict a still-live/unsettled stream: its terminal hook hasn't run, so evicting would
    // strand the partial-output persistence (`onExecutionPaused` early-returns on a missing stream).
    // Let that hook drive — it chains on a clean done or drops on abort/error.
    if (previous && isLiveStatus(previous.status)) return

    // Commit to consuming the head only now that we're actually going to dispatch it.
    queue.shift()
    if (queue.length === 0) this.pendingSteers.delete(topicId)

    const carried = previous ? [...previous.listeners.values()].filter(isRendererListener) : []
    if (previous) this.evictStream(topicId)

    const { userMessageId, reasoningEffort, serviceTier, fastMode } = pending
    const req: MainDispatchRequest = {
      trigger: 'steer-continuation',
      topicId,
      userMessageId,
      reasoningEffort,
      serviceTier,
      fastMode
    }
    try {
      await this.dispatch(carried[0] ?? nullStreamListener, req)
    } catch (error) {
      // The continuation never opened (steer row deleted, no default model configured, SQLITE_BUSY …).
      // `onExecutionDone`'s chaining path already skipped the terminal lifecycle and we evicted the
      // prior stream, so the topic would otherwise stay `streaming` forever (Stop becomes a no-op,
      // every window spins). Surface the failure and write a terminal status. Don't re-queue — a
      // retry just re-fails, mirroring the agent runtime's `startNextTurn` failure path.
      logger.error('Chat steer continuation failed to launch', { topicId, userMessageId, error })
      if (previous) this.failChatContinuation(previous, carried, serializeError(error))
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
   * runtime's `broadcastTopicError` + terminal mark.
   */
  private failChatContinuation(previous: ActiveStream, carried: StreamListener[], error: SerializedError): void {
    const result: StreamErrorResult = {
      error,
      status: 'error',
      modelId: undefined,
      topicAttemptWatermark: this.getTopicAttemptWatermark(previous),
      isTopicDone: true
    }
    for (const listener of carried) {
      if (listener.id.startsWith('persistence:')) continue
      try {
        void listener.onError(result)
      } catch (err) {
        logger.warn('failChatContinuation listener threw', { topicId: previous.topicId, err })
      }
    }
    previous.status = 'error'
    previous.lifecycle.onTerminal(previous)
    this.dropPendingSteers(previous.topicId, 'error')
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
        status: exec.status,
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

    if (stream.status === 'done' || stream.status === 'aborted') {
      // Map per-execution finalMessages so multi-model topics can rebuild
      // every sibling — not just the first. `finalMessage` (singular) is a
      // backwards-compat convenience pointing at the first iteration; both
      // are undefined-safe when the stream errored before any execution
      // accumulated content.
      const finalMessages: Partial<Record<UniqueModelId, CherryUIMessage>> = {}
      let firstFinalMessage: CherryUIMessage | undefined
      for (const exec of stream.executions.values()) {
        if (!exec.finalMessage) continue
        const finalMessage = projectStreamMessageForRenderer(req.topicId, exec.finalMessage)
        finalMessages[exec.modelId] = finalMessage
        if (!firstFinalMessage) firstFinalMessage = finalMessage
      }
      return {
        status: stream.status === 'aborted' ? 'paused' : 'done',
        finalMessage: firstFinalMessage,
        finalMessages
      }
    }
    if (stream.status === 'error') {
      // Pick the first execution that surfaced an error; undefined when no
      // execution recorded one (rare — implies the stream entered the error
      // state via a topic-level path with no per-exec error attached).
      let firstError: SerializedError | undefined
      for (const exec of stream.executions.values()) {
        if (exec.error) {
          firstError = exec.error
          break
        }
      }
      return { status: 'error', error: firstError }
    }

    // Reconnect: compact-replay each execution's buffer in isolation so
    // text-delta / reasoning-delta merging stays per-execution.
    const listener = new WebContentsListener(sender, req.topicId)
    stream.listeners.set(listener.id, listener)

    const totalDropped = [...stream.executions.values()].reduce((sum, exec) => sum + exec.droppedChunks, 0)
    if (totalDropped > 0) {
      logger.warn('attach: replay has gaps due to buffer overflow', {
        topicId: req.topicId,
        droppedChunks: totalDropped
      })
    }

    const bufferedChunks: StreamChunkPayload[] = []
    for (const exec of stream.executions.values()) {
      bufferedChunks.push(
        ...buildCompactReplay(exec.buffer, this.config.maxDeltaBytes).map(projectStreamChunkPayloadForRenderer)
      )
    }
    return { status: 'attached', bufferedChunks }
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

  /**
   * Loop: pull chunks from `AiService.streamText`, tee into broadcast +
   * `readUIMessageStream` accumulator (writes each snapshot to
   * `exec.finalMessage`), signal terminal status. See pipeStreamLoop.
   */
  private createAndLaunchExecution(
    topicId: string,
    modelId: UniqueModelId,
    request: ManagedAiStreamRequest,
    siblingsGroupId?: number,
    runtimeTimingSeed?: MessageRuntimeTiming,
    seedFromEmpty?: boolean,
    rootSpan?: Span,
    abortController?: AbortController
  ): StreamExecution {
    // `loopPromise` is overwritten right after launch; initialise to a resolved sentinel
    // so the `exec` object reference is stable inside the arrow function below.
    const exec: StreamExecution = {
      modelId,
      attemptId: ++this.nextExecutionAttemptSequence,
      anchorMessageId: request.messageId,
      seedFromEmpty,
      abortController: abortController ?? new AbortController(),
      status: 'streaming',
      buffer: [],
      droppedChunks: 0,
      siblingsGroupId,
      timings: { startedAt: performance.now() },
      runtimeTiming: new MessageRuntimeTimingCollector(runtimeTimingSeed),
      loopPromise: Promise.resolve(),
      rootSpan
    }

    const launchLoop = rootSpan
      ? () =>
          otelContext.with(trace.setSpan(otelContext.active(), rootSpan), () =>
            this.runExecutionLoop(topicId, modelId, request, exec)
          )
      : () => this.runExecutionLoop(topicId, modelId, request, exec)

    exec.loopPromise = launchLoop().catch((err) => {
      // Defensive funnel for sync throws (e.g. `streamText` rejects before returning a stream).
      return this.onExecutionError(topicId, modelId, serializeError(err), exec)
    })

    return exec
  }

  private async runExecutionLoop(
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
          this.onChunk(topicId, modelId, { type: 'data-compaction-anchor', id: anchorId, data } as UIMessageChunk, exec)
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
      if (!signal.aborted) logger.error('streamText failed before stream start', { topicId, modelId, err })
      await this.onExecutionError(topicId, modelId, serializeError(err), exec)
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
        this.onChunk(topicId, modelId, chunk, exec)
        // A tool awaiting human approval emits no chunks while it waits, so the normal (short) idle
        // timeout would kill a legitimate deliberation. Re-arm with the generous approval bound
        // instead of pausing entirely — an unresponsive renderer still can't hang the stream forever.
        // Keyed off the pending-approval set (`onChunk` updated it above), so a parallel tool's output
        // clearing its own id keeps the generous bound while any approval is still outstanding.
        if (exec.pendingApprovalToolCallIds?.size) idle.reset(this.config.approvalIdleTimeoutMs)
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
      } else {
        logger.error('Execution loop error', { topicId, modelId, err: result.threw.error })
      }
      const fromThrow = serializeError(result.threw.error)
      const serialized =
        result.streamErrorText !== undefined && !signal.aborted && !hasHttpMetadata(fromThrow)
          ? errorFromStreamChunk(result.streamErrorText)
          : fromThrow
      await this.onExecutionError(topicId, modelId, serialized, exec)
      return
    }

    if (signal.aborted) {
      // The idle-timeout path aborts `exec.abortController` directly (via `withIdleTimeout`)
      // without going through `abort()`, so `exec.status` is still 'streaming' on this clean
      // exit. Promote it so the truncated reply is persisted as `paused`, not `success`
      // (onExecutionPaused is a no-op unless status is 'aborted').
      if (exec.status === 'streaming') exec.status = 'aborted'
      await this.onExecutionPaused(topicId, modelId, exec)
    } else if (result.streamErrorText !== undefined) {
      await this.onExecutionError(topicId, modelId, errorFromStreamChunk(result.streamErrorText), exec)
    } else {
      await this.onExecutionDone(topicId, modelId, exec)
    }
  }

  /** Broadcast done for a single execution to all topic listeners. */
  private async broadcastExecutionDone(stream: ActiveStream, exec: StreamExecution, isTopicDone = true): Promise<void> {
    const result: StreamDoneResult = {
      finalMessage: exec.finalMessage,
      status: 'success',
      modelId: exec.modelId,
      attemptId: exec.attemptId,
      ...(isTopicDone ? { topicAttemptWatermark: this.getTopicAttemptWatermark(stream) } : {}),
      anchorMessageId: exec.anchorMessageId,
      isTopicDone,
      // Snapshot timings so listeners see a stable copy even if the
      // execution object is mutated after dispatch.
      timings: { ...exec.timings },
      runtimeTiming: exec.runtimeTiming.snapshot()
    }
    await this.dispatchToListeners(stream, 'onDone', (listener) => listener.onDone(result))
  }

  private async broadcastExecutionPaused(
    stream: ActiveStream,
    exec: StreamExecution,
    isTopicDone = true
  ): Promise<void> {
    const result = {
      finalMessage: exec.finalMessage,
      status: 'paused' as const,
      modelId: exec.modelId,
      attemptId: exec.attemptId,
      ...(isTopicDone ? { topicAttemptWatermark: this.getTopicAttemptWatermark(stream) } : {}),
      anchorMessageId: exec.anchorMessageId,
      isTopicDone,
      timings: { ...exec.timings },
      runtimeTiming: exec.runtimeTiming.snapshot()
    }
    await this.dispatchToListeners(stream, 'onPaused', (listener) => listener.onPaused(result))
  }

  private getTopicAttemptWatermark(stream: ActiveStream): number {
    // Valid because attempt ids come from the process-global monotonic sequence;
    // replacing a model entry therefore always fences every older attempt it displaced.
    let watermark = 0
    for (const execution of stream.executions.values()) watermark = Math.max(watermark, execution.attemptId)
    return watermark
  }

  /**
   * Skips dead listeners and isolates throws. Persistence finishes before renderer/runtime
   * notification, while cleanup work remains last.
   */
  private async dispatchToListeners(
    stream: ActiveStream,
    event: 'onDone' | 'onPaused' | 'onError',
    invoke: (listener: StreamListener) => void | Promise<void>
  ): Promise<void> {
    const dead: string[] = []
    const listeners = [...stream.listeners]
    const orderedListeners = [
      ...listeners.filter(([, listener]) => listener.terminalPhase === 'persistence'),
      ...listeners.filter(([, listener]) => listener.terminalPhase === undefined),
      ...listeners.filter(([, listener]) => listener.terminalPhase === 'cleanup')
    ]
    let suppressNotification = false

    for (const [id, listener] of orderedListeners) {
      if (!listener.isAlive()) {
        dead.push(id)
        continue
      }
      if (suppressNotification && listener.terminalPhase === undefined) continue
      const tracksPersistence = listener.terminalPhase === 'persistence'
      if (tracksPersistence) {
        this.terminalPersistenceCounts.set(
          stream.topicId,
          (this.terminalPersistenceCounts.get(stream.topicId) ?? 0) + 1
        )
      }
      try {
        await invoke(listener)
      } catch (err) {
        if (listener.terminalPhase === 'persistence' && err instanceof TerminalPersistenceError) {
          suppressNotification = true
          continue
        }
        logger.warn('Listener threw', { topicId: stream.topicId, listenerId: id, event, err })
      } finally {
        if (tracksPersistence) {
          const remaining = (this.terminalPersistenceCounts.get(stream.topicId) ?? 1) - 1
          if (remaining === 0) this.terminalPersistenceCounts.delete(stream.topicId)
          else this.terminalPersistenceCounts.set(stream.topicId, remaining)
        }
      }
    }
    for (const id of dead) stream.listeners.delete(id)
  }

  /**
   * Terminal topic status with tool-approval surface applied. The
   * `awaiting-approval` status is the cross-window pause indicator; the
   * continue stream's `onCreated → pending` broadcast clears it.
   * Guarded to terminal statuses so a still-streaming multi-model topic
   * isn't mis-flagged.
   */
  private resolveTerminalStatus(stream: ActiveStream): ActiveStream['status'] {
    const status = this.computeTopicStatus(stream)
    if (status === 'done' || status === 'aborted') {
      for (const exec of stream.executions.values()) {
        if (exec.pendingApprovalToolCallIds?.size) return 'awaiting-approval'
      }
    }
    return status
  }

  private computeTopicStatus(stream: ActiveStream): ActiveStream['status'] {
    let hasStreaming = false
    let hasError = false
    let allAborted = true

    for (const exec of stream.executions.values()) {
      if (exec.status === 'streaming') hasStreaming = true
      if (exec.status === 'error') hasError = true
      if (exec.status !== 'aborted') allAborted = false
    }

    if (hasStreaming) return stream.status === 'pending' ? 'pending' : 'streaming'
    if (allAborted) return 'aborted'
    if (hasError) return 'error'
    return 'done'
  }

  /** Immediate eviction (cancels grace-period timer if any). Used by `send` over previous-grace-period streams. */
  private evictStream(topicId: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    if (stream.cleanupTimer) clearTimeout(stream.cleanupTimer)
    // Leak guard for executions whose terminal handler never fired; `endRootSpan` is idempotent.
    for (const exec of stream.executions.values()) {
      endRootSpan(exec, 'aborted')
    }
    this.activeStreams.delete(topicId)
  }
}
