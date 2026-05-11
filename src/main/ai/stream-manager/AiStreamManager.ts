import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { withIdleTimeout } from '@main/utils/withIdleTimeout'
import { context as otelContext, type Span, SpanStatusCode, trace } from '@opentelemetry/api'
import type {
  ActiveExecution,
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  TopicStreamStatus
} from '@shared/ai/transport'
import { DEFAULT_TIMEOUT } from '@shared/config/constant'
import type { Message } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { type SerializedError, serializeError } from '@shared/types/error'
import { readUIMessageStream, type UIMessageChunk } from 'ai'

import { PendingMessageQueue } from '../agent/loop/PendingMessageQueue'
import type { AiStreamRequest } from '../types/requests'
import { buildCompactReplay } from './buildCompactReplay'
import { dispatchStreamRequest } from './context'
import { WebContentsListener } from './listeners/WebContentsListener'
import type {
  ActiveStream,
  AiStreamManagerConfig,
  CherryUIMessage,
  StreamChunkPayload,
  StreamDoneResult,
  StreamErrorResult,
  StreamExecution,
  StreamListener,
  TransportTimings
} from './types'

const logger = loggerService.withContext('AiStreamManager')

/**
 * End the execution's OTel root span on a terminal status. Each terminal
 * handler (done / paused / error) calls this exactly once; subsequent calls
 * are no-ops because `exec.rootSpan` is cleared after end. Errors thrown
 * by OTel are swallowed defensively — terminal persistence must not depend
 * on tracing succeeding.
 */
function endRootSpan(exec: StreamExecution, outcome: 'ok' | 'aborted' | 'error', error?: SerializedError): void {
  const span = exec.rootSpan
  if (!span) return
  exec.rootSpan = undefined
  try {
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
  request: AiStreamRequest
  rootSpan?: Span
}

/** Input for `AiStreamManager.send`. */
export interface SendInput {
  topicId: string
  /** One entry per execution. `models.length > 1` → multi-model topic. */
  models: ReadonlyArray<SendModelSpec>
  /** All listeners (subscriber + per-execution persistence + etc). Upserted by id. */
  listeners: StreamListener[]
  /**
   * Follow-up user message to inject into every existing execution's
   * queue when a live stream already exists for this topic. Ignored on
   * the `started` path.
   */
  userMessage?: Message
  /** Shared group id across executions so parallel responses render as siblings. */
  siblingsGroupId?: number
}

/** Result of `AiStreamManager.send`. */
export interface SendResult {
  /**
   * `'started'`  — a new stream and its executions were created.
   * `'injected'` — a stream was already live; `userMessage` was pushed
   *                 into every running execution's pending queue.
   */
  mode: 'started' | 'injected'
  /**
   * `started`  → the freshly launched execution ids.
   * `injected` → the execution ids already running on the topic.
   */
  executionIds: UniqueModelId[]
}

// ── Inspection snapshots ───────────────────────────────────────────
//
// `inspect()` returns read-only snapshots so diagnostics, UI surfaces,
// and tests can query manager state without poking the private
// `activeStreams` map. Mutating the snapshot does not mutate the manager.

export interface ExecutionSnapshot {
  readonly modelId: UniqueModelId
  readonly status: StreamExecution['status']
  /** Signal belonging to the execution's AbortController (observer-only). */
  readonly abortSignal: AbortSignal
  readonly pendingMessageCount: number
  readonly bufferedChunkCount: number
  readonly droppedChunks: number
  readonly siblingsGroupId?: number
  /**
   * Latest accumulated UIMessage. Populated live by the execution loop's
   * `readUIMessageStream` accumulator; terminal events (`onDone` etc.)
   * carry the same reference. `undefined` until the first snapshot lands.
   */
  readonly finalMessage?: CherryUIMessage
  /**
   * Transport-side timings (`startedAt` / `completedAt`). Semantic
   * timings live on the listener that cares — the manager is
   * chunk-shape-agnostic by design.
   */
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
  maxBufferChunks: 10_000
}

/**
 * Both `pending` and `streaming` are topic states where the ActiveStream
 * is producing (or about to produce) content. Callers that want to gate
 * "is this topic still live?" should use this predicate instead of
 * comparing against `'streaming'` directly — otherwise the pre-first-chunk
 * window would be mis-classified as inactive.
 */
function isLiveStatus(status: ActiveStream['status']): boolean {
  return status === 'pending' || status === 'streaming'
}

function errorFromStreamChunk(errorText: string): SerializedError {
  return { name: 'StreamError', message: errorText, stack: null }
}

/**
 * Active-stream registry for AI streaming.
 *
 * Keyed by `topicId` — one topic has at most one ActiveStream at any time.
 * Each ActiveStream contains one or more StreamExecutions (one per model).
 * Streaming is just one state of a topic; all subscribers subscribe to the topic.
 */
// `AiService` looks this service up at IPC-handler runtime; declaring it
// via `@DependsOn(['AiStreamManager'])` keeps init order explicit. The
// reverse direction — `runExecutionLoop` calls `application.get('AiService')`
// — is a runtime back-edge: every `send()` caller routes through AiService
// first, so AiService is guaranteed initialized when stream-manager looks
// it up. Do NOT add `@DependsOn(['AiService'])` here; that would close the
// cycle at init time and the container cannot resolve circular deps.
@Injectable('AiStreamManager')
@ServicePhase(Phase.WhenReady)
export class AiStreamManager extends BaseService {
  private readonly activeStreams = new Map<string, ActiveStream>()
  private readonly config: AiStreamManagerConfig

  /**
   * The lifecycle container invokes this with no arguments (falling back
   * to `DEFAULT_CONFIG`). Tests and future configuration surfaces may
   * construct the service with a partial override — useful for shrinking
   * `maxBufferChunks` in overflow tests or exercising the
   * `backgroundMode: 'abort'` path.
   */
  constructor(config: Partial<AiStreamManagerConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  protected async onInit(): Promise<void> {
    this.ipcHandle(IpcChannel.Ai_Stream_Open, async (event, req: AiStreamOpenRequest) => {
      const subscriber = new WebContentsListener(event.sender, req.topicId)
      return dispatchStreamRequest(this, subscriber, req)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Attach, (event, req: AiStreamAttachRequest) => {
      return this.attach(event.sender, req)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Detach, (event, req: AiStreamDetachRequest) => {
      this.detach(event.sender, req)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Abort, (_, req: AiStreamAbortRequest) => {
      this.abort(req.topicId, 'user-requested')
    })

    logger.info('AiStreamManager initialized')
  }

  /**
   * Graceful shutdown: abort every active stream so each execution loop runs its
   * own terminal path (`onExecutionPaused` → `broadcastExecutionPaused` →
   * `PersistenceListener.onPaused`), then await each execution loop's promise so
   * persistence is complete before the process exits.
   *
   * We intentionally do NOT re-broadcast `onPaused` from here — doing so
   * would double-dispatch against the execution loop's own terminal event and
   * cause append-only backends (temporary chats, agent session messages)
   * to write the same assistant turn twice.
   */
  protected async onStop(): Promise<void> {
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

  // ── Public: unified send ──────────────────────────────────────────

  /**
   * The single entry point for "dispatch a stream request for a topic".
   *
   * Behaviour is chosen from the topic's current active-stream state:
   *  - Topic has a live stream (pending or streaming) → **inject**: push
   *    the optional `userMessage` into every execution's own pending
   *    queue and upsert every listener. The running executions will
   *    consume their queues between iterations. `models` is intentionally
   *    ignored in this path (we do not spin up new executions mid-flight).
   *  - Otherwise → **start**: evict any grace-period stream, create a new
   *    ActiveStream, and launch one execution per entry in `models`.
   *    Multi-model is detected from `models.length > 1` — callers no
   *    longer pass a flag.
   *
   * `executionIds` in the result reflects the executions the caller can
   * observe: in `started` mode it is the freshly launched set; in
   * `injected` mode it is the set already running on the topic.
   */
  send(input: SendInput): SendResult {
    const existing = this.activeStreams.get(input.topicId)

    if (existing && isLiveStatus(existing.status)) {
      // Inject path: fan the user message out to every execution's own
      // queue so heterogeneous consumers (agentLoop `drain()`, Claude
      // Code `AsyncIterable.next()`) each see it, instead of racing for
      // a single shared copy.
      if (input.userMessage) {
        for (const exec of existing.executions.values()) exec.pendingMessages.push(input.userMessage)
      }
      for (const listener of input.listeners) this.addListener(input.topicId, listener)
      return {
        mode: 'injected',
        executionIds: [...existing.executions.keys()]
      }
    }

    // If a stream in a non-streaming state (e.g., grace-period state) already exists,
    // the old stream needs to be evicted before starting a new stream
    // to ensure that multiple active streams do not exist simultaneously in the same topic.
    if (existing) this.evictStream(input.topicId)

    if (input.models.length === 0) {
      throw new Error(`send() requires at least one model when starting a new stream (topicId=${input.topicId})`)
    }

    const isMultiModel = input.models.length > 1
    const executions = new Map<UniqueModelId, StreamExecution>()

    for (const { modelId, request, rootSpan } of input.models) {
      if (executions.has(modelId)) {
        throw new Error(`send() got duplicate modelId ${modelId} for topic ${input.topicId}`)
      }
      const exec = this.createAndLaunchExecution(input.topicId, modelId, request, input.siblingsGroupId, rootSpan)
      executions.set(modelId, exec)
    }

    const stream: ActiveStream = {
      topicId: input.topicId,
      executions,
      listeners: new Map(input.listeners.map((l) => [l.id, l])),
      // Start in `pending` — the pre-first-chunk window. `onChunk` flips
      // this to `streaming` as soon as any execution produces content.
      status: 'pending',
      isMultiModel
    }
    this.activeStreams.set(input.topicId, stream)
    // The `'pending'` delta is the single "a new ActiveStream just
    // appeared on this topic" signal — consumers that need to attach
    // (e.g. `useChatWithHistory.resumeActiveStream`) subscribe to it
    // instead of a separate `Ai_StreamStarted` channel.
    this.broadcastTopicStatus(input.topicId, 'pending')

    return {
      mode: 'started',
      executionIds: input.models.map((m) => m.modelId)
    }
  }

  /**
   * Inject a follow-up message into every running execution of a topic.
   * Used when a new user message arrives while a stream is still live on
   * this topic: each execution receives its own copy on its own queue so
   * heterogeneous consumers (agentLoop `drain()`, Claude Code
   * `AsyncIterable.next()`) each see the message instead of racing for a
   * single shared queue. Returns `false` if the topic has no live stream.
   */
  injectMessage(topicId: string, message: Message): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) return false
    for (const exec of stream.executions.values()) exec.pendingMessages.push(message)
    return true
  }

  /**
   * True iff this topic has a stream that `send()` would treat as the inject
   * path (live: pending or streaming). Providers query this in
   * `prepareDispatch` so they can skip placeholder rows / persistence
   * listeners that the inject path doesn't consume.
   */
  hasLiveStream(topicId: string): boolean {
    const stream = this.activeStreams.get(topicId)
    return Boolean(stream && isLiveStatus(stream.status))
  }

  // ── Public: listener management ───────────────────────────────────

  addListener(topicId: string, listener: StreamListener): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return false
    stream.listeners.set(listener.id, listener)
    // Replay buffered chunks from every execution's ring buffer so late
    // listeners catch up. Ordering within a single execution is preserved;
    // across executions chunks are interleaved in the order we see each
    // execution's buffer (acceptable: the Renderer demuxes by executionId).
    for (const exec of stream.executions.values()) {
      for (const chunk of exec.buffer) listener.onChunk(chunk.chunk, chunk.executionId)
    }
    return true
  }

  removeListener(topicId: string, listenerId: string): void {
    const stream = this.activeStreams.get(topicId)
    stream?.listeners.delete(listenerId)
  }

  // ── Public: abort ─────────────────────────────────────────────────

  /** Abort all executions in a topic. */
  abort(topicId: string, reason: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) return
    logger.info('Aborting stream', { topicId, reason })
    for (const exec of stream.executions.values()) {
      exec.pendingMessages.close()
      if (exec.status === 'streaming') {
        exec.status = 'aborted'
        exec.abortController.abort(reason)
      }
    }
    stream.status = 'aborted'
  }

  // ── Execution loop callbacks ──────────────────────────────────────
  // These are driven internally by the loop started in
  // `createAndLaunchExecution`.
  // They remain public because tests and (historically) external adapters
  // may invoke them directly to simulate chunk/done/error flow.

  /** Broadcast chunk to all listeners. Multi-model: includes sourceModelId for frontend demux. */
  onChunk(topicId: string, modelId: UniqueModelId, chunk: UIMessageChunk): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) return

    const exec = stream.executions.get(modelId)
    if (!exec) return

    // First chunk from any execution promotes the topic out of `pending`
    // and into `streaming`. Observers (sidebar indicators, etc) can now
    // distinguish "waiting for the provider" from "content is flowing".
    if (stream.status === 'pending') {
      stream.status = 'streaming'
      this.broadcastTopicStatus(topicId, 'streaming')
    }

    // Intentionally chunk-shape-agnostic: the manager only observes the
    // transport envelope (modelId, buffer bookkeeping, fan-out). Any
    // semantic timing (first text, reasoning boundaries) is the job of
    // the listener that cares — see `PersistenceListener.onChunk`.

    // Tag every chunk with its `modelId`. Renderer consumers all run
    // through per-execution `ExecutionStreamCollector`s now; the "primary
    // (untagged)" subscriber path is retired, so there's no caller that
    // still needs untagged chunks.
    const sourceModelId = modelId

    // Ring-buffer into *this execution's* buffer so a chatty model cannot
    // push a slower model's replay out of a shared topic-level buffer.
    // Overflow drops the oldest chunk and bumps droppedChunks so late
    // attach / logs can tell replay is lossy.
    if (exec.buffer.length >= this.config.maxBufferChunks) {
      exec.buffer.shift()
      exec.droppedChunks += 1
    }
    exec.buffer.push({ topicId, executionId: sourceModelId, chunk })

    // Chunk delivery is synchronous by contract (listeners must not block
    // the execution loop). We inline the liveness scrub here rather than routing
    // through the async `dispatchToListeners` helper so dead listeners
    // are removed before the next onChunk / attach runs.
    const dead: string[] = []
    for (const [id, listener] of stream.listeners) {
      if (!listener.isAlive()) {
        dead.push(id)
        continue
      }
      try {
        listener.onChunk(chunk, sourceModelId)
      } catch (err) {
        logger.warn('Listener threw', { topicId, listenerId: id, event: 'onChunk', err })
      }
    }
    for (const id of dead) stream.listeners.delete(id)

    // Background mode enforcement: when all subscribers are gone and the
    // configured policy is `abort`, drive the stream through the standard
    // aborted → paused path so partial output is persisted as `paused`
    // rather than mistakenly flagged as `success` or lingering forever.
    if (stream.listeners.size === 0 && this.config.backgroundMode === 'abort') {
      this.abort(topicId, 'no-subscribers')
    }
  }

  /** Called when one execution finishes. Topic-level done only when ALL executions finished. */
  async onExecutionDone(topicId: string, modelId: UniqueModelId): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || exec.status !== 'streaming') return

    exec.status = 'done'
    endRootSpan(exec, 'ok')

    // Compute topic status first so listeners get isTopicDone
    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = !isLiveStatus(stream.status)

    await this.broadcastExecutionDone(stream, exec, isTopicDone)

    if (isTopicDone) {
      this.broadcastTopicStatus(topicId, stream.status)
      this.scheduleCleanup(topicId)
    }
  }

  async onExecutionPaused(topicId: string, modelId: UniqueModelId): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || exec.status !== 'aborted') return

    endRootSpan(exec, 'aborted')
    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = !isLiveStatus(stream.status)

    await this.broadcastExecutionPaused(stream, exec, isTopicDone)

    if (isTopicDone) {
      this.broadcastTopicStatus(topicId, stream.status)
      this.scheduleCleanup(topicId)
    }
  }

  /** Called when one execution errors. */
  async onExecutionError(topicId: string, modelId: UniqueModelId, error: SerializedError): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec) return

    exec.status = 'error'
    exec.error = error
    endRootSpan(exec, 'error', error)

    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = !isLiveStatus(stream.status)

    const result: StreamErrorResult = {
      error,
      finalMessage: exec.finalMessage,
      status: 'error',
      modelId: exec.modelId,
      isTopicDone,
      timings: { ...exec.timings }
    }
    await this.dispatchToListeners(stream, 'onError', (listener) => listener.onError(result))

    if (isTopicDone) {
      this.broadcastTopicStatus(topicId, stream.status)
      this.scheduleCleanup(topicId)
    }
  }

  // ── Public: inspection snapshot ───────────────────────────────────

  /**
   * Read-only snapshot of a topic's state. Returns `undefined` when the
   * topic has no active stream (either never opened, or the grace period
   * expired and the stream was cleaned up). Callers should treat the
   * snapshot as immutable — the returned objects are not live views.
   */
  inspect(topicId: string): TopicSnapshot | undefined {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return undefined

    const executions: ExecutionSnapshot[] = []
    for (const exec of stream.executions.values()) {
      executions.push({
        modelId: exec.modelId,
        status: exec.status,
        abortSignal: exec.abortController.signal,
        pendingMessageCount: exec.pendingMessages.list().length,
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
        finalMessages[exec.modelId] = exec.finalMessage
        if (!firstFinalMessage) firstFinalMessage = exec.finalMessage
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

    // Register listener for future live chunks; reconnect receives a compact
    // replay of every execution's buffered chunks, concatenated in a stable
    // execution-iteration order. Each execution is compacted in isolation so
    // text-delta / reasoning-delta merging never crosses execution boundaries.
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
      bufferedChunks.push(...buildCompactReplay(exec.buffer))
    }
    return { status: 'attached', bufferedChunks }
  }

  detach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    this.removeListener(req.topicId, `wc:${sender.id}:${req.topicId}`)
  }

  /**
   * Publish a topic-level status transition to the SharedCache. Every
   * renderer window receives the update via the existing `Cache_Sync`
   * fan-out and reacts via `useSharedCache('topic.stream.statuses.${topicId}')`.
   * Callers are responsible for updating `stream.status` first so the
   * published value reflects the committed state.
   *
   * Writing to SharedCache reuses the generic cache-sync plumbing —
   * single source of truth in Main, auto-bootstrap on fresh renderer
   * mounts via `Cache_GetAllShared`, and no hand-rolled subscriber
   * tracking.
   *
   * The grace-period cleanup does NOT delete the shared entry — a
   * `'done'` / `'aborted'` / `'error'` value lingers until each window
   * flips its local `topic.stream.seen.${topicId}` flag, mirroring the
   * pre-refactor "fulfilled indicator sticks until the user sees it"
   * behaviour.
   */
  private broadcastTopicStatus(topicId: string, status: TopicStreamStatus): void {
    const activeExecutions = this.collectActiveExecutions(topicId)
    const cacheService = application.get('CacheService')
    cacheService.setShared(`topic.stream.statuses.${topicId}` as const, { status, activeExecutions })
  }

  /**
   * Executions still in their non-terminal phase (`exec.status ===
   * 'streaming'`, which is set at launch and cleared by `done` / `error`
   * / `aborted`). Returns `[]` when the topic is absent from
   * `activeStreams` or when every execution has hit a terminal state.
   * Each entry pairs the executionId (UniqueModelId) with the assistant
   * row this execution writes to (`anchorMessageId`), so the renderer can
   * seed its `Chat` instance directly by id.
   */
  private collectActiveExecutions(topicId: string): ActiveExecution[] {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return []
    const out: ActiveExecution[] = []
    for (const [modelId, exec] of stream.executions) {
      if (exec.status === 'streaming') out.push({ executionId: modelId, anchorMessageId: exec.anchorMessageId })
    }
    return out
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Create a StreamExecution and launch its execution loop.
   *
   * The loop:
   *  - pulls `UIMessageChunk`s from `AiService.streamText`
   *  - `tee()`s the chunk stream into two branches:
   *      • broadcast — forwarded chunk-by-chunk via `onChunk`
   *      • accumulator — a background task that drives `readUIMessageStream`
   *        and writes each yielded snapshot straight to `exec.finalMessage`.
   *        At any point in time `exec.finalMessage` is "whatever has been
   *        accumulated so far" — terminal handlers (done / paused / error)
   *        just read it; there is no separate promise to await for partial.
   *  - signals `onExecutionDone` / `onExecutionPaused` / `onExecutionError`
   *    at terminal state depending on the abort signal and execution status.
   */
  private createAndLaunchExecution(
    topicId: string,
    modelId: UniqueModelId,
    request: AiStreamRequest,
    siblingsGroupId?: number,
    rootSpan?: Span
  ): StreamExecution {
    // Each execution gets its own pending queue and replay ring buffer;
    // message-injection fan-out happens at the manager level (see
    // `send` / `injectMessage`).
    const pendingMessages = new PendingMessageQueue()
    // `loopPromise` is overwritten right after launch — we need a stable
    // object reference to hang the promise on inside the arrow function
    // below, so initialise to a resolved sentinel.
    const exec: StreamExecution = {
      modelId,
      anchorMessageId: request.messageId,
      abortController: new AbortController(),
      status: 'streaming',
      pendingMessages,
      buffer: [],
      droppedChunks: 0,
      siblingsGroupId,
      timings: { startedAt: performance.now() },
      loopPromise: Promise.resolve(),
      rootSpan
    }
    const requestWithQueue: AiStreamRequest = { ...request, pendingMessages }

    const launchLoop = rootSpan
      ? () =>
          otelContext.with(trace.setSpan(otelContext.active(), rootSpan), () =>
            this.runExecutionLoop(topicId, modelId, requestWithQueue, exec)
          )
      : () => this.runExecutionLoop(topicId, modelId, requestWithQueue, exec)

    exec.loopPromise = launchLoop().catch((err) => {
      // Defensive: runExecutionLoop handles its own errors, but if it
      // throws synchronously (e.g. aiService.streamText fails before
      // returning a stream), funnel it into the standard error path.
      return this.onExecutionError(topicId, modelId, serializeError(err))
    })

    return exec
  }

  private async runExecutionLoop(
    topicId: string,
    modelId: UniqueModelId,
    request: AiStreamRequest,
    exec: StreamExecution
  ): Promise<void> {
    const aiService = application.get('AiService')
    const signal = exec.abortController.signal

    let rawStream: ReadableStream<UIMessageChunk>
    try {
      // Pre-stream errors (provider/model resolution, agent param build) reject
      // the Promise before any stream is created; they route straight to the
      // standard error path without a half-open stream to tear down.
      // NB: `AiService.streamText` also accepts a third `extensions` argument
      // for per-call hooks / options overrides. stream-manager intentionally
      // does not forward them — callers that need per-call tuning call
      // `aiService.streamText` directly without going through stream-manager.
      // Inject this execution's AbortController.signal into requestOptions so
      // `AiService.streamText` sees it on the request (signal is not
      // IPC-serialisable, the in-process caller sets it here).
      rawStream = await aiService.streamText({
        ...request,
        requestOptions: { ...request.requestOptions, signal }
      })
    } catch (err) {
      if (!signal.aborted) logger.error('streamText failed before stream start', { topicId, modelId, err })
      await this.onExecutionError(topicId, modelId, serializeError(err))
      return
    }

    // Wrap with an idle-chunk timer. If `timeoutMs` elapses without a new
    // chunk, the wrapper aborts `exec.abortController`; the abort signal is
    // already wired into the upstream AI SDK request, so the provider HTTP
    // connection and the broadcast reader both tear down together.
    // Caller override comes from `request.requestOptions.timeout`; otherwise
    // `DEFAULT_TIMEOUT` (30 min) applies.
    const timeoutMs = request.requestOptions?.timeout ?? DEFAULT_TIMEOUT
    const stream = withIdleTimeout(rawStream, exec.abortController, timeoutMs)

    const [forBroadcast, forAccum] = stream.tee()
    const broadcastReader = forBroadcast.getReader()

    // Background accumulator: keeps `exec.finalMessage` live. Every UIMessage
    // that `readUIMessageStream` yields is the "current cumulative message";
    // the accumulator writes the latest snapshot straight onto the execution.
    // Errors here are swallowed — by the time the accumulator errors, the
    // broadcast path has already decided the terminal status, and whatever
    // accumulated up to the last successful yield is preserved in
    // `exec.finalMessage`.
    // For `continue-conversation` (resuming after a tool-approval response),
    // the chunks merge into the existing anchor assistant message — they
    // reference toolCallIds and parts that already live on that message.
    // `readUIMessageStream` must be seeded with that anchor or its internal
    // `getToolInvocation` lookups throw and silently halt the accumulator,
    // leaving `exec.finalMessage.parts === []` and overwriting the DB row
    // on next persist. Seed when the last incoming UIMessage is an assistant.
    const lastIncoming = request.messages?.at(-1)
    const accumulatorSeed: CherryUIMessage | undefined =
      lastIncoming?.role === 'assistant' ? (lastIncoming as CherryUIMessage) : undefined
    const accumulator = this.accumulateFinalMessage(forAccum, exec, accumulatorSeed).catch(() => {})

    const onAbort = () => {
      void broadcastReader.cancel(signal.reason).catch(() => {})
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    let streamErrorText: string | undefined

    try {
      while (true) {
        const { done, value } = await broadcastReader.read()
        if (done) break
        if (value.type === 'error') streamErrorText ??= value.errorText
        this.onChunk(topicId, modelId, value)
      }

      // Close the completion timestamp *before* draining the accumulator —
      // the provider's stream has already ended; accumulator drain is
      // purely internal bookkeeping and shouldn't inflate TTFT-style stats.
      exec.timings.completedAt = performance.now()

      // Let the accumulator drain any chunks still queued behind the
      // broadcast reader, so `exec.finalMessage` reflects the latest
      // yield before we fire the terminal event.
      await accumulator

      if (signal.aborted && exec.status === 'aborted') {
        await this.onExecutionPaused(topicId, modelId)
      } else if (streamErrorText !== undefined) {
        await this.onExecutionError(topicId, modelId, errorFromStreamChunk(streamErrorText))
      } else {
        await this.onExecutionDone(topicId, modelId)
      }
    } catch (err) {
      // Even on error we wait for the accumulator — it may have processed a
      // few more chunks before the stream errored. `exec.finalMessage` will
      // be whatever it managed to capture (possibly undefined if the stream
      // errored before yielding anything).
      exec.timings.completedAt ??= performance.now()
      await accumulator

      if (signal.aborted) {
        logger.debug('Execution aborted', { topicId, modelId, reason: signal.reason })
      } else {
        logger.error('Execution loop error', { topicId, modelId, err })
      }
      const serialized =
        streamErrorText !== undefined && !signal.aborted ? errorFromStreamChunk(streamErrorText) : serializeError(err)
      await this.onExecutionError(topicId, modelId, serialized)
    } finally {
      signal.removeEventListener('abort', onAbort)
      broadcastReader.releaseLock()
    }
  }

  /**
   * Drive AI SDK's `readUIMessageStream` and write each yielded snapshot
   * onto `exec.finalMessage`, so the field is always "latest accumulated"
   * rather than being set once at the very end.
   *
   * Observes `exec.abortController.signal` to cancel its own reader —
   * cancelling the upstream chunkStream directly does not work once
   * `readUIMessageStream` has locked it.
   */
  private async accumulateFinalMessage(
    chunkStream: ReadableStream<UIMessageChunk>,
    exec: StreamExecution,
    seed?: CherryUIMessage
  ): Promise<void> {
    const signal = exec.abortController.signal
    // `readUIMessageStream<CherryUIMessage>` does the narrowing from wide
    // `UIMessageChunk` input to `CherryUIMessage` output — that is the single
    // point where transport-level width meets Cherry-level shape. Upstream
    // (execution loop, AiService) stay on the wide AI SDK type so an unexpected
    // `data-*` variant from a provider / MCP tool can't be silently cast.
    const uiStream = readUIMessageStream<CherryUIMessage>({ stream: chunkStream, message: seed })
    const reader = uiStream.getReader()
    const onAbort = () => {
      void reader.cancel(signal.reason).catch(() => {})
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        exec.finalMessage = value
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      reader.releaseLock()
    }
  }

  /** Broadcast done for a single execution to all topic listeners. */
  private async broadcastExecutionDone(stream: ActiveStream, exec: StreamExecution, isTopicDone = true): Promise<void> {
    const result: StreamDoneResult = {
      finalMessage: exec.finalMessage,
      status: 'success',
      modelId: exec.modelId,
      isTopicDone,
      // Snapshot timings so listeners see a stable copy even if the
      // execution object is mutated after dispatch.
      timings: { ...exec.timings }
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
      isTopicDone,
      timings: { ...exec.timings }
    }
    await this.dispatchToListeners(stream, 'onPaused', (listener) => listener.onPaused(result))
  }

  /**
   * Single-point dispatch for terminal events (`onDone` / `onPaused` /
   * `onError`). Mirrors the liveness policy of `onChunk`:
   *  - skips dead listeners and removes them from the map
   *  - catches sync/async throws so one bad listener cannot starve the rest
   *  - tags log lines with the event name for easy triage
   *
   * Unlike `onChunk`, terminal dispatch awaits each listener so that
   * `PersistenceListener` writes complete before `scheduleCleanup` runs.
   */
  private async dispatchToListeners(
    stream: ActiveStream,
    event: 'onDone' | 'onPaused' | 'onError',
    invoke: (listener: StreamListener) => void | Promise<void>
  ): Promise<void> {
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

  /**
   * Derive topic-level status from its executions.
   * - Any execution streaming → preserve `pending` if no chunk has
   *   landed yet, otherwise `streaming`
   * - All done → 'done'
   * - Any error (none streaming) → 'error'
   * - All aborted → 'aborted'
   *
   * The `pending` preservation matters for multi-model topics: one
   * execution can error before any chunk from any model flowed, while
   * another is still live. Returning `'streaming'` in that case would
   * silently advance the topic past its pre-first-chunk state without
   * ever broadcasting the `streaming` transition.
   */
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

  /**
   * After a stream reaches a terminal state, keep it in `activeStreams` for
   * `gracePeriodMs` so late reconnects can still retrieve `finalMessage` via
   * `attach`, then delete the entry. No status broadcast is emitted — cache
   * mirrors retain the last terminal value until a local consumer evicts it,
   * and `getTopicStatuses()` simply stops reporting this topic once it's
   * removed, so freshly mounted observers start clean.
   */
  private scheduleCleanup(topicId: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    stream.expiresAt = Date.now() + this.config.gracePeriodMs
    stream.cleanupTimer = setTimeout(() => {
      if (this.activeStreams.get(topicId) === stream) {
        this.activeStreams.delete(topicId)
      }
    }, this.config.gracePeriodMs)
  }

  /**
   * Immediately remove a stream from `activeStreams`, cancelling any pending
   * cleanup timer. Used by `send` when the caller wants to start a new stream
   * on a topic whose previous stream is still sitting in the grace period.
   */
  private evictStream(topicId: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    if (stream.cleanupTimer) clearTimeout(stream.cleanupTimer)
    // Defensive: any execution whose terminal handler never fired (e.g.
    // eviction during grace period) still has its rootSpan open. End it
    // here as a leak guard — endRootSpan is idempotent (no-ops when
    // rootSpan is already cleared).
    for (const exec of stream.executions.values()) {
      endRootSpan(exec, 'aborted')
    }
    this.activeStreams.delete(topicId)
  }
}
