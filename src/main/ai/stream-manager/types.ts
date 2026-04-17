import type { StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { PendingMessageQueue } from '../PendingMessageQueue'
// Note: `StreamTarget` was removed after AiStreamManager took over the pump
// loop directly from AiService. Chunk forwarding is now internal to the
// manager; external consumers subscribe via the `StreamListener` interface.

// ── Re-export shared types for consumers ────────────────────────────

export type { CherryUIMessage }
export type {
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  AiStreamOpenResponse,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  StreamStartedPayload
} from '@shared/ai/transport'
export type { CherryUIMessageChunk } from '@shared/data/types/message'

// ── Stream Terminal Results ────────────────────────────────────────
//
// All three terminal results share the same conceptual payload — an
// optional accumulated `finalMessage` plus the status-specific extras.
// Keeping the shape uniform means listeners (and persistence backends)
// never need to distinguish "finalMessage for success/paused" from
// "partialMessage for error": they are the same object, differing only
// in whether the stream completed or was interrupted.

/**
 * Monotonic timestamps captured by the pump for one execution.
 *
 * Split by ownership so `AiStreamManager` stays chunk-shape-agnostic:
 *  - `TransportTimings` — owned by the manager's pump. Only tracks
 *    pump-lifecycle events (entry, loop exit) that the transport layer
 *    can observe without inspecting chunk payloads.
 *  - `SemanticTimings` — owned by the consumer that cares (today
 *    `PersistenceListener`). Tracks AI-SDK-specific chunk transitions
 *    (first `text-delta`, reasoning boundaries). Lives on the listener
 *    side so the manager never hardcodes `chunk.type === 'text-delta'`.
 *
 * `statsFromTerminal` accepts the merged union — the listener combines
 * its own `SemanticTimings` with the `TransportTimings` it received via
 * `StreamDoneResult` / `StreamPausedResult` / `StreamErrorResult`.
 *
 * All fields are `performance.now()` values (milliseconds, fractional,
 * unaffected by wall-clock adjustments).
 */
export interface TransportTimings {
  /** Pump entry — set once before any chunk is read. */
  readonly startedAt: number
  /** Pump loop exit — covers done / paused / error. */
  completedAt?: number
}

export interface SemanticTimings {
  /** First `text-delta` chunk — TTFT measurement endpoint. */
  firstTextAt?: number
  /** First `reasoning-*` chunk — thinking phase start. */
  reasoningStartedAt?: number
  /**
   * End of reasoning phase. Listener sets this on the first non-reasoning
   * chunk after reasoning started; if the execution finishes while still
   * in reasoning, `statsFromTerminal` falls back to `completedAt`.
   */
  reasoningEndedAt?: number
}

/** Terminal state passed to `onDone`. */
export interface StreamDoneResult {
  finalMessage?: CherryUIMessage
  /** 'success' = natural completion. */
  status: 'success'
  /** Which model's execution finished. */
  modelId?: UniqueModelId
  /** True when ALL executions in the topic are done. */
  isTopicDone?: boolean
  /** Transport-side timings captured by the pump. Listeners merge their own `SemanticTimings`. */
  timings?: TransportTimings
}

/**
 * Terminal state for a paused execution.
 *
 * Distinct from onDone/onError so listeners can treat user/lifecycle aborts
 * as a separate semantic path from successful completion and hard failure.
 */
export interface StreamPausedResult {
  finalMessage?: CherryUIMessage
  status: 'paused'
  /** Which model's execution finished. */
  modelId?: UniqueModelId
  /** True when ALL executions in the topic are done. */
  isTopicDone?: boolean
  timings?: TransportTimings
}

/**
 * Terminal state for an errored execution.
 *
 * `finalMessage` carries whatever accumulated before the error (same shape
 * and lifecycle as the success/paused case — what used to be called
 * "partialMessage" is just a `finalMessage` that happened to end early).
 */
export interface StreamErrorResult {
  error: SerializedError
  finalMessage?: CherryUIMessage
  status: 'error'
  modelId?: UniqueModelId
  isTopicDone?: boolean
  timings?: TransportTimings
}

// ── StreamListener ──────────────────────────────────────────────────

/**
 * Consumer abstraction. AiStreamManager dispatches to listeners uniformly —
 * it never inspects a listener's concrete type. All three terminal
 * callbacks take a single result object of the matching shape.
 */
export interface StreamListener {
  /**
   * Stable unique identifier used for:
   *  - dedup within the listeners Map (same subscriber → upsert, not duplicate)
   *  - detach by exact match
   *  - logging / tracing
   */
  readonly id: string

  /** Receives each chunk. sourceModelId identifies the producing model (set for multi-model). */
  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void
  /** Called when one execution completes successfully. */
  onDone(result: StreamDoneResult): void | Promise<void>
  /** Called when one execution is paused/aborted with partial output preserved. */
  onPaused(result: StreamPausedResult): void | Promise<void>
  /** Called when one execution errors. `result.finalMessage` holds whatever accumulated before the error. */
  onError(result: StreamErrorResult): void | Promise<void>
  /**
   * Liveness check. Returning `false` causes the listener to be immediately
   * removed from the listeners Map.
   */
  isAlive(): boolean
}

// ── StreamExecution ─────────────────────────────────────────────────

/**
 * One model's execution within an ActiveStream.
 *
 * Single-model (common case): ActiveStream.executions has 1 entry.
 * Multi-model (@gpt-4o @claude-sonnet): N entries, each running independently
 * but sharing the same topic listeners and siblingsGroupId.
 *
 * Each execution owns its own `pendingMessages` queue. Steering pushes
 * fan out to *every* execution so that, e.g., a Claude Code session and a
 * normal agent loop listening to the same topic both see every steer message.
 * This avoids the race where a single shared queue hands one steer message
 * to whichever consumer calls `next()` first.
 */
export interface StreamExecution {
  /** Model id for this execution (also the key in ActiveStream.executions). Format: "providerId::modelId". */
  modelId: UniqueModelId
  /** Independent abort — aborting one model doesn't stop others in multi-model. */
  abortController: AbortController
  status: 'streaming' | 'done' | 'error' | 'aborted'
  /** Per-execution steering queue. Manager fans steer pushes out to every execution. */
  pendingMessages: PendingMessageQueue
  /**
   * Per-execution chunk ring buffer for reconnect replay. Capped at
   * `AiStreamManagerConfig.maxBufferChunks`; when full, the oldest entry
   * is dropped and `droppedChunks` is incremented so late attach is aware
   * there were gaps. Each execution keeps its own so a chatty model can
   * never starve a slower one's replay (the old topic-level buffer did).
   */
  buffer: StreamChunkPayload[]
  /** Count of chunks dropped from this execution's ring buffer due to overflow. */
  droppedChunks: number
  /**
   * Latest accumulated `UIMessage` for this execution. Written live by the
   * pump's `readUIMessageStream` accumulator on every snapshot yield —
   * terminal handlers (`onExecutionDone` / `onExecutionPaused` /
   * `onExecutionError`) read it as-is without awaiting any extra promise.
   * Undefined until the first snapshot lands (e.g. the stream errored
   * before producing any chunks).
   */
  finalMessage?: CherryUIMessage
  error?: SerializedError
  /** Multi-model: shared group id so parallel responses appear as siblings in UI. */
  siblingsGroupId?: number
  /** Backend-specific resume token (ClaudeCodeService). */
  sourceSessionId?: string
  /**
   * Resolves when the pump loop for this execution has completed (success,
   * error, or abort). Attached by `AiStreamManager.createAndLaunchExecution`
   * and awaited by `onStop` so graceful shutdown can wait for the pump's
   * terminal persistence path without re-broadcasting `onPaused` itself.
   */
  pumpPromise: Promise<void>
  /**
   * Transport-side timings owned by the pump. Semantic timings
   * (`firstTextAt` / `reasoning*`) live on the listener that cares — the
   * manager never inspects chunk payloads.
   */
  timings: TransportTimings
}

// ── ActiveStream ────────────────────────────────────────────────────

/**
 * Topic-level stream state, keyed by `topicId` in AiStreamManager.
 *
 * One topic has at most one ActiveStream at any time. Streaming is just
 * one state of a topic — all subscribers subscribe to the topic.
 *
 * Contains one or more StreamExecutions — one per model:
 *  - Single-model: executions has 1 entry
 *  - Multi-model: executions has N entries (one per @mentioned model)
 *
 * Topic-level status is derived from executions:
 *  - Any execution streaming → 'streaming'
 *  - All executions done → 'done'
 *  - Any execution errored (none streaming) → 'error'
 *  - All executions aborted → 'aborted'
 */
export interface ActiveStream {
  /** Primary key — the Cherry Studio conversation this stream belongs to. */
  topicId: string

  /**
   * Per-model executions. Key = UniqueModelId ("providerId::modelId").
   * Single-model: 1 entry. Multi-model: N entries.
   */
  executions: Map<UniqueModelId, StreamExecution>

  /** All consumers. Key = listener.id. Shared across all executions. */
  listeners: Map<string, StreamListener>

  /** Topic-level status, derived from executions. */
  status: 'streaming' | 'done' | 'error' | 'aborted'

  /** Static flag set at creation. Determines whether onChunk includes sourceModelId. */
  isMultiModel: boolean

  /** Grace-period reap timestamp (ms since epoch). */
  reapAt?: number
  /** Timer handle for `scheduleReap`, so `evictStream` can cancel it. */
  reapTimer?: ReturnType<typeof setTimeout>
}

// ── Config ──────────────────────────────────────────────────────────

export interface AiStreamManagerConfig {
  /** How long a finished stream stays in memory for late reconnects. */
  readonly gracePeriodMs: number
  /** What to do when all subscribers disconnect mid-stream. */
  readonly backgroundMode: 'continue' | 'abort'
  /** Per-stream buffer cap; exceeding this stops buffering (not streaming). */
  readonly maxBufferChunks: number
}
