import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { messageService } from '@main/data/services/MessageService'
import { withIdleTimeout } from '@main/utils/withIdleTimeout'
import { context as otelContext, type Span, SpanStatusCode, trace } from '@opentelemetry/api'
import type {
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  AiStreamOpenResponse
} from '@shared/ai/transport'
import { DEFAULT_TIMEOUT } from '@shared/config/constant'
import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { type SerializedError, serializeError } from '@shared/types/error'
import { type UIMessageChunk } from 'ai'
import * as z from 'zod'

import type { AiStreamRequest, CallOverrides } from '../types/requests'
import { buildCompactReplay } from './buildCompactReplay'
import { dispatchStreamRequest, type MainDispatchRequest } from './context'
import { KeyedMutex } from './KeyedMutex'
import { createChatStreamLifecycle, promptStreamLifecycle, type StreamLifecycle } from './lifecycle'
import { isRendererListener, WebContentsListener } from './listeners/WebContentsListener'
import { pipeStreamLoop } from './pipeStreamLoop'
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
import { withReasoningTimingMetadata } from './withReasoningTimingMetadata'

const logger = loggerService.withContext('AiStreamManager')

// ── IPC boundary validation ─────────────────────────────────────────
// Renderer payloads are untrusted; reject malformed shapes before they
// reach dispatch/attach. `safeParse` keeps the handlers free of throws on
// the common path and lets us return/throw a sanitized error.

/** Every stream channel keys on a non-empty `topicId`. */
const TopicIdRequestSchema = z.object({ topicId: z.string().min(1) })

/** `Ai_Stream_Open` — validates the discriminated trigger and its required fields. */
const StreamOpenRequestSchema = z.intersection(
  TopicIdRequestSchema,
  z.discriminatedUnion('trigger', [
    z.object({ trigger: z.literal('submit-message'), userMessageParts: z.array(z.unknown()) }),
    z.object({ trigger: z.literal('regenerate-message'), parentAnchorId: z.string().min(1) })
  ])
)

/**
 * Finalize the turn's root span. Idempotent — subsequent calls no-op because
 * `exec.rootSpan` is cleared.
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

export interface SendInput {
  topicId: string
  /** `models.length > 1` → multi-model topic. */
  models: ReadonlyArray<SendModelSpec>
  /** Upserted by id. */
  listeners: StreamListener[]
  siblingsGroupId?: number
  /** Defaults to chat lifecycle. `streamPrompt` passes `promptStreamLifecycle`. */
  lifecycle?: StreamLifecycle
}

export interface SendResult {
  /** `started` = freshly launched executions; `injected` = listeners attached to a running stream. */
  mode: 'started' | 'injected'
  /** `started` → fresh ids; `injected` → ids already running on the topic. */
  executionIds: UniqueModelId[]
}

export interface StartRuntimeTurnInput {
  topicId: string
  modelId: UniqueModelId
  request: AiStreamRequest
  listeners: StreamListener[]
  rootSpan?: Span
}

// ── Inspection snapshots ────────────────────────────────────────────
// Read-only snapshots so diagnostics/tests can query state without
// poking `activeStreams`.

export interface ExecutionSnapshot {
  readonly modelId: UniqueModelId
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
  // Generous (2 h) but bounded: a human can deliberate, yet a renderer that never responds (window
  // closed/crashed) can't leave the stream + subprocess hanging until app quit.
  approvalIdleTimeoutMs: 2 * 60 * 60 * 1000
}

/** `pending` covers the pre-first-chunk window — don't compare against `'streaming'` alone. */
function isLiveStatus(status: ActiveStream['status']): boolean {
  return status === 'pending' || status === 'streaming'
}

function errorFromStreamChunk(errorText: string): SerializedError {
  return { name: 'StreamError', message: errorText, stack: null }
}

function ensureTerminalFinalMessage(exec: StreamExecution): CherryUIMessage {
  if (exec.finalMessage) return exec.finalMessage

  const finalMessage = {
    id: exec.anchorMessageId ?? randomUUID(),
    role: 'assistant',
    parts: []
  } as CherryUIMessage
  exec.finalMessage = finalMessage
  return finalMessage
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
  private readonly activeStreams = new Map<string, ActiveStream>()
  /** Serialises `prepareDispatch → send` per topic so concurrent `Ai_Stream_Open` can't race
   *  the `hasLiveStream` snapshot and orphan a PENDING placeholder row. */
  private readonly dispatchLock = new KeyedMutex()
  private readonly config: AiStreamManagerConfig
  /** Per-topic FIFO of steer user-message ids persisted while a turn was live. Chat's analogue of
   *  the agent runtime's `pendingTurns`; drained one continuation turn at a time. */
  private readonly pendingSteers = new Map<string, string[]>()
  /** Topics whose steer continuation is mid-launch — dedups `scheduleNextChatTurn`, mirroring the
   *  agent runtime's `startingNextTurn`. */
  private readonly startingNextChatTopicIds = new Set<string>()
  /** Constructed once and reused — `dispatchStreamRequest` passes it through `send()`. */
  readonly chatLifecycle: StreamLifecycle

  constructor(config: Partial<AiStreamManagerConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.chatLifecycle = createChatStreamLifecycle(this.config.gracePeriodMs)
  }

  protected async onInit(): Promise<void> {
    // Resolve crash-orphaned PENDING rows before any new stream can be opened — at boot the
    // in-memory registry is empty, so every still-`pending` assistant row is stale.
    await this.reconcileStalePendingMessages()

    this.ipcHandle(IpcChannel.Ai_Stream_Open, async (event, rawReq: unknown) => {
      const parsed = StreamOpenRequestSchema.safeParse(rawReq)
      if (!parsed.success) {
        logger.warn('Ai_Stream_Open rejected: invalid request', { issues: parsed.error.issues })
        throw new Error('Invalid Ai_Stream_Open request')
      }
      const req = rawReq as AiStreamOpenRequest
      const subscriber = new WebContentsListener(event.sender, req.topicId)
      return this.dispatch(subscriber, req)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Attach, (event, rawReq: unknown): AiStreamAttachResponse => {
      const parsed = TopicIdRequestSchema.safeParse(rawReq)
      if (!parsed.success) {
        logger.warn('Ai_Stream_Attach rejected: invalid topicId', { issues: parsed.error.issues })
        return { status: 'not-found' }
      }
      return this.attach(event.sender, rawReq as AiStreamAttachRequest)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Detach, (event, rawReq: unknown) => {
      const parsed = TopicIdRequestSchema.safeParse(rawReq)
      if (!parsed.success) {
        logger.warn('Ai_Stream_Detach rejected: invalid topicId', { issues: parsed.error.issues })
        return
      }
      this.detach(event.sender, rawReq as AiStreamDetachRequest)
    })

    this.ipcHandle(IpcChannel.Ai_Stream_Abort, (_, rawReq: unknown) => {
      const parsed = TopicIdRequestSchema.safeParse(rawReq)
      if (!parsed.success) {
        logger.warn('Ai_Stream_Abort rejected: invalid topicId', { issues: parsed.error.issues })
        return
      }
      this.abort((rawReq as AiStreamAbortRequest).topicId, 'user-requested')
    })

    logger.info('AiStreamManager initialized')
  }

  /**
   * Single locked dispatch entry point for chat streams. Both `Ai_Stream_Open`
   * and the tool-approval continue path (`AiService.Ai_ToolApproval_Respond`)
   * route through here so the per-topic `dispatchLock` serialises every dispatch
   * on a topic — not just opens. `prepareDispatch` is async and writes a PENDING
   * placeholder off a `hasLiveStream` snapshot; without one lock covering both
   * entry points, a concurrent open and approval-continue on the same topic could
   * both see "no live stream" and orphan a row.
   */
  dispatch(subscriber: StreamListener, req: MainDispatchRequest): Promise<AiStreamOpenResponse> {
    return this.withDispatchLock(req.topicId, () => dispatchStreamRequest(this, subscriber, req))
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

  /**
   * Resolve assistant rows a prior main-process crash left stuck in `pending`. The streaming
   * loop persists a terminal status only when it settles; if the process died mid-stream the
   * row stays `pending` forever and the UI shows a frozen "thinking" bubble. Runs once at boot,
   * before the open handler is registered, so it can never race a freshly created placeholder.
   */
  private async reconcileStalePendingMessages(): Promise<void> {
    try {
      const staleIds = await messageService.findPendingAssistantMessageIds()
      if (staleIds.length === 0) return
      logger.info('Reconciling crash-orphaned pending assistant messages', { count: staleIds.length })
      await messageService.markMessagesError(staleIds)
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
   * Single entry point. Live topic → inject (upsert listeners onto the
   * running stream, `models` ignored). Otherwise → start (evict any
   * grace-period stream, launch one execution per `models` entry).
   * Multi-model is detected from `models.length > 1`.
   */
  send(input: SendInput): SendResult {
    const existing = this.activeStreams.get(input.topicId)

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
        throw new Error(
          `send(): refusing to inject ${input.models.length} prepared model(s) onto live topic ${input.topicId} (raced a concurrent submit)`
        )
      }
      for (const listener of input.listeners) this.addListener(input.topicId, listener)
      return { mode: 'injected', executionIds: [...existing.executions.keys()] }
    }

    // Enqueue-only dispatch with no live stream to attach to. Two legitimate producers reach here,
    // both with the user row already persisted/enqueued, so there's nothing to START — no-op instead
    // of throwing (and leave any grace-period stream untouched for late renderer reads):
    //   1. an agent-session follow-up landing in the inter-turn drain window (`isSessionBusy` true
    //      while the settled stream is terminal-in-grace, so `hasLiveStream` is false); the runtime's
    //      `pendingTurns` opens the next turn.
    //   2. a chat steer whose live stream went terminal between `prepareDispatch` and here (the race
    //      `enqueuePendingSteer` handles); the steer continuation is chained separately.
    // Do NOT re-add a throw for chat — case 2 is reachable and correct.
    if (input.models.length === 0) {
      logger.debug('send(): empty models with no live stream — enqueue-only, nothing to start', {
        topicId: input.topicId
      })
      return { mode: 'injected', executionIds: [] }
    }

    // Evict any grace-period stream so two streams never coexist on one topic.
    if (existing) this.evictStream(input.topicId)

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
      // `pending` → `streaming` on first chunk.
      status: 'pending',
      isMultiModel,
      lifecycle: input.lifecycle ?? this.chatLifecycle
    }
    this.activeStreams.set(input.topicId, stream)
    // Chat broadcasts to SharedCache so `useChatWithHistory.resumeActiveStream` can attach; prompt is silent.
    stream.lifecycle.onCreated(stream)

    return {
      mode: 'started',
      executionIds: input.models.map((m) => m.modelId)
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
    /** Idle-chunk timeout (ms) for the upstream stream; resets per chunk. Defaults to `DEFAULT_TIMEOUT`. */
    idleTimeoutMs?: number
  }): SendResult {
    const messages: CherryUIMessage[] =
      input.messages && input.messages.length > 0
        ? input.messages
        : [{ id: 'prompt-user', role: 'user', parts: [{ type: 'text', text: input.prompt ?? '' }] }]

    const request: AiStreamRequest = {
      chatId: input.streamId,
      trigger: 'submit-message',
      uniqueModelId: input.uniqueModelId,
      messages,
      callOverrides: input.callOverrides,
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
      models: [{ modelId: input.modelId, request: input.request, rootSpan: input.rootSpan }],
      listeners: [...carriedListeners, ...input.listeners]
    })
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
  enqueuePendingSteer(topicId: string, userMessageId: string): void {
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
      this.appendPendingSteer(topicId, userMessageId)
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
    this.appendPendingSteer(topicId, userMessageId)
    if (status !== 'awaiting-approval') this.scheduleNextChatTurn(topicId)
  }

  private appendPendingSteer(topicId: string, userMessageId: string): void {
    const queue = this.pendingSteers.get(topicId)
    if (queue) queue.push(userMessageId)
    else this.pendingSteers.set(topicId, [userMessageId])
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

  // ── Execution loop callbacks ──────────────────────────────────────
  // Driven internally by `createAndLaunchExecution`. Public because
  // tests invoke them directly to simulate chunk/done/error.

  /** Multi-model: chunks carry `sourceModelId` for renderer demux. */
  onChunk(topicId: string, modelId: UniqueModelId, chunk: UIMessageChunk): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || !isLiveStatus(stream.status)) return

    const exec = stream.executions.get(modelId)
    if (!exec) return

    // Authoritative approval-lifecycle capture, keyed by toolCallId so a sibling tool's output never
    // clears another tool's still-pending approval; `resolveTerminalStatus` reads the set's size.
    if (chunk.type === 'tool-approval-request') {
      ;(exec.pendingApprovalToolCallIds ??= new Set()).add(chunk.toolCallId)
    } else if (
      chunk.type === 'tool-output-available' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied'
    ) {
      exec.pendingApprovalToolCallIds?.delete(chunk.toolCallId)
    }

    // First chunk promotes `pending` → `streaming`.
    if (stream.status === 'pending') {
      stream.status = 'streaming'
      stream.lifecycle.onPromotedToStreaming(stream)
    }

    const sourceModelId = modelId

    // Per-execution ring buffer — a chatty model can't push a slower one's
    // replay out. Overflow drops oldest and bumps `droppedChunks`.
    if (exec.buffer.length >= this.config.maxBufferChunks) {
      exec.buffer.shift()
      exec.droppedChunks += 1
    }
    exec.buffer.push({ topicId, executionId: sourceModelId, chunk })

    // Synchronous fan-out (listeners must not block the loop). Inline
    // liveness scrub so dead listeners go before the next onChunk runs.
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

    // `backgroundMode: 'abort'` policy — drive through aborted → paused so partial output persists as `paused`.
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
    stream.status = this.resolveTerminalStatus(stream)
    const topicDone = !isLiveStatus(stream.status)

    // Chain the next chat turn only on a CLEAN topic-done. Keying off the resolved status (not
    // `topicDone`, which is also true for error/aborted/awaiting-approval) makes the decision
    // independent of which execution settled last: a multi-model turn that resolved to 'error' never
    // chains, in either settle order. An 'awaiting-approval' parked turn also doesn't chain — the
    // steer stays queued for the continuation the user's Approve dispatches. Broadcast this exec's
    // done with isTopicDone=false when chaining (the bubble finalises, the topic stays busy), skip the
    // terminal lifecycle, and start the continuation with the carried renderer listeners.
    const chatChaining = stream.status === 'done' && this.hasPendingSteer(topicId)

    await this.broadcastExecutionDone(stream, exec, topicDone && !chatChaining)

    if (chatChaining) this.scheduleNextChatTurn(topicId)
    else if (topicDone) {
      // A sibling errored/aborted (this exec finished clean but the topic didn't): drop the queue,
      // matching onExecutionError/onExecutionPaused. A clean 'done' or an approval-park keeps it.
      if (stream.status === 'error' || stream.status === 'aborted') this.dropPendingSteers(topicId, stream.status)
      this.runTerminalLifecycle(stream)
    }
  }

  async onExecutionPaused(topicId: string, modelId: UniqueModelId): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    const exec = stream.executions.get(modelId)
    if (!exec || exec.status !== 'aborted') return

    // A turn torn down while a tool is still `approval-requested` (or any
    // in-flight tool) gets no `tool-output-*` to clear it. Clear the set so the
    // status resolves to plain `aborted` (not `awaiting-approval`) and the
    // status-cache anchor drops; the dangling tool part itself is terminalized
    // to `output-error` by `finalizeInterruptedParts` at every projection
    // (persistence already, re-attach below). Must run before
    // `resolveTerminalStatus`.
    exec.pendingApprovalToolCallIds?.clear()

    endRootSpan(exec, 'aborted')
    stream.status = this.resolveTerminalStatus(stream)
    const isTopicDone = !isLiveStatus(stream.status)

    await this.broadcastExecutionPaused(stream, exec, isTopicDone)

    if (isTopicDone) {
      // Aborted (stop button / idle timeout), not a clean steer-yield — drop any queued steer
      // instead of chaining. Its persisted user row stays as a dangling message the user can resend.
      this.dropPendingSteers(topicId, 'aborted')
      this.runTerminalLifecycle(stream)
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

    // Mirror of onExecutionPaused: clear the set so the status anchor drops;
    // the in-flight tool part is terminalized by `finalizeInterruptedParts`.
    exec.pendingApprovalToolCallIds?.clear()

    stream.status = this.computeTopicStatus(stream)
    const isTopicDone = !isLiveStatus(stream.status)
    const finalMessage = ensureTerminalFinalMessage(exec)

    const result: StreamErrorResult = {
      error,
      finalMessage,
      status: 'error',
      modelId: exec.modelId,
      isTopicDone,
      timings: { ...exec.timings }
    }

    await this.dispatchToListeners(stream, 'onError', (listener) => listener.onError(result))

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
    if (dropped?.length)
      logger.warn('Dropping queued steers without answering', { topicId, reason, droppedIds: dropped })
    this.pendingSteers.delete(topicId)
  }

  /**
   * Surface a stream error to a topic's transport subscribers WITHOUT mutating execution
   * state or re-running persistence. Used when a post-stream persist fails after the renderer
   * was already told the turn succeeded — the DB row is driven to `error` separately, but the
   * live bubble must not stay a success. Persistence listeners are skipped (they just failed and
   * would loop). No-op once the stream has drained.
   */
  broadcastTopicError(topicId: string, modelId: UniqueModelId | undefined, error: SerializedError): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    const result: StreamErrorResult = { error, status: 'error', modelId, isTopicDone: true }
    for (const listener of stream.listeners.values()) {
      if (listener.id.startsWith('persistence:')) continue
      try {
        void listener.onError(result)
      } catch (err) {
        logger.warn('broadcastTopicError listener threw', { topicId, err })
      }
    }
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

  /** Drain-dedup + microtask defer for the steer continuation. Mirrors `scheduleNextTurn`. */
  private scheduleNextChatTurn(topicId: string): void {
    if (this.startingNextChatTopicIds.has(topicId)) return
    this.startingNextChatTopicIds.add(topicId)
    queueMicrotask(() => {
      void this.startNextChatTurn(topicId)
        .catch((error) => logger.error('Failed to start chat steer continuation', { topicId, error }))
        .finally(() => this.startingNextChatTopicIds.delete(topicId))
    })
  }

  /**
   * Open a fresh assistant turn answering the head of the steer queue. Carries the finished turn's
   * renderer listeners forward so the continuation streams to the same windows; persistence/trace
   * listeners are rebuilt by `prepareDispatch`. Mirrors `AgentSessionRuntimeService.startNextTurn`.
   */
  private async startNextChatTurn(topicId: string): Promise<void> {
    const queue = this.pendingSteers.get(topicId)
    const userMessageId = queue?.[0]
    if (!userMessageId) {
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

    const req: MainDispatchRequest = { trigger: 'steer-continuation', topicId, userMessageId }
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
    const result: StreamErrorResult = { error, status: 'error', modelId: undefined, isTopicDone: true }
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
        status: exec.status,
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
      bufferedChunks.push(...buildCompactReplay(exec.buffer))
    }
    return { status: 'attached', bufferedChunks }
  }

  detach(sender: Electron.WebContents, req: AiStreamDetachRequest): void {
    this.removeListener(req.topicId, `wc:${sender.id}:${req.topicId}`)
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
    request: AiStreamRequest,
    siblingsGroupId?: number,
    rootSpan?: Span
  ): StreamExecution {
    // `loopPromise` is overwritten right after launch; initialise to a resolved sentinel
    // so the `exec` object reference is stable inside the arrow function below.
    const exec: StreamExecution = {
      modelId,
      anchorMessageId: request.messageId,
      abortController: new AbortController(),
      status: 'streaming',
      buffer: [],
      droppedChunks: 0,
      siblingsGroupId,
      timings: { startedAt: performance.now() },
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
      // Pre-stream rejection (model resolution, param build) routes through
      // the error path with no half-open stream to tear down.
      // `signal` is injected here because it's not IPC-serialisable.
      rawStream = await aiService.streamText({
        ...request,
        requestOptions: { ...request.requestOptions, signal }
      })
    } catch (err) {
      if (!signal.aborted) logger.error('streamText failed before stream start', { topicId, modelId, err })
      await this.onExecutionError(topicId, modelId, serializeError(err))
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
        this.onChunk(topicId, modelId, chunk)
        // A tool awaiting human approval emits no chunks while it waits, so the normal (short) idle
        // timeout would kill a legitimate deliberation. Re-arm with the generous approval bound
        // instead of pausing entirely — an unresponsive renderer still can't hang the stream forever.
        // Keyed off the pending-approval set (`onChunk` updated it above), so a parallel tool's output
        // clearing its own id keeps the generous bound while any approval is still outstanding.
        if (exec.pendingApprovalToolCallIds?.size) idle.reset(this.config.approvalIdleTimeoutMs)
      },
      accumulatorSeed,
      onAccumulatedSnapshot: (msg) => {
        exec.finalMessage = msg
      }
    })

    exec.timings.completedAt = result.broadcastCompletedAt

    if (result.threw !== undefined) {
      if (signal.aborted) {
        logger.debug('Execution aborted', { topicId, modelId, reason: signal.reason })
      } else {
        logger.error('Execution loop error', { topicId, modelId, err: result.threw })
      }
      const serialized =
        result.streamErrorText !== undefined && !signal.aborted
          ? errorFromStreamChunk(result.streamErrorText)
          : serializeError(result.threw)
      await this.onExecutionError(topicId, modelId, serialized)
      return
    }

    if (signal.aborted) {
      // The idle-timeout path aborts `exec.abortController` directly (via `withIdleTimeout`)
      // without going through `abort()`, so `exec.status` is still 'streaming' on this clean
      // exit. Promote it so the truncated reply is persisted as `paused`, not `success`
      // (onExecutionPaused is a no-op unless status is 'aborted').
      if (exec.status === 'streaming') exec.status = 'aborted'
      await this.onExecutionPaused(topicId, modelId)
    } else if (result.streamErrorText !== undefined) {
      await this.onExecutionError(topicId, modelId, errorFromStreamChunk(result.streamErrorText))
    } else {
      await this.onExecutionDone(topicId, modelId)
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
   * Skips dead listeners, catches throws. Awaits each listener so
   * `PersistenceListener` writes complete before cleanup.
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
