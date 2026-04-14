import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage, UIMessageChunk } from 'ai'

import type { PendingMessageQueue } from '../PendingMessageQueue'

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
  StreamErrorPayload
} from '@shared/ai/transport'
export type { CherryUIMessageChunk } from '@shared/data/types/message'

// ── StreamDoneResult ────────────────────────────────────────────────

/**
 * Terminal state passed to each listener when a stream ends.
 *
 * Distinguishes "completed normally" from "user aborted mid-flight with partial
 * output" — preserving the v1 `ChatSession.handleFinish` success/paused semantics.
 */
export interface StreamDoneResult {
  finalMessage?: CherryUIMessage
  /** 'success' = natural completion; 'paused' = abort path with partial result. */
  status: 'success' | 'paused'
  /** Which model's execution finished (for multi-model filtering in PersistenceListener). */
  modelId?: UniqueModelId
  /** True when ALL executions in the topic are done (for topic-level listeners like WebContents). */
  isTopicDone?: boolean
}

// ── StreamTarget ────────────────────────────────────────────────────

/**
 * Minimal subset of `Electron.WebContents` that `AiService.executeStream` uses.
 *
 * Uses `UIMessageChunk` (wide AI SDK type) rather than `CherryUIMessageChunk`
 * because `AiCompletionService.streamText` produces the generic AI SDK chunks.
 * Cherry-specific narrowing is done at the consumption site, not the transport layer.
 */
export interface StreamTarget {
  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError; [key: string]: unknown }): void
  isDestroyed(): boolean
  /** Optional: upstream writes the full UIMessage here before signaling done. */
  setFinalMessage?(message: CherryUIMessage): void
}

// ── StreamListener ──────────────────────────────────────────────────

/**
 * Consumer abstraction. AiStreamManager dispatches to listeners uniformly —
 * it never inspects a listener's concrete type.
 */
export interface StreamListener {
  /**
   * Stable unique identifier used for:
   *  - dedup within the listeners Map (same subscriber → upsert, not duplicate)
   *  - detach by exact match
   *  - logging / tracing
   */
  readonly id: string

  /**
   * Optional execution scope. When set, AiStreamManager only dispatches chunks
   * from the matching execution to this listener (per-model routing).
   * Listeners without executionId receive ALL chunks (topic-level).
   */
  readonly executionId?: string

  /** Receives each chunk from the AI stream. Uses wide `UIMessageChunk` type. */
  onChunk(chunk: UIMessageChunk): void
  /** Called when the stream ends (success or paused). */
  onDone(result: StreamDoneResult): void | Promise<void>
  /** Called when the stream errors. partialMessage contains content streamed before the error. */
  onError(
    error: SerializedError,
    partialMessage?: UIMessage,
    modelId?: UniqueModelId,
    isTopicDone?: boolean
  ): void | Promise<void>
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
 */
export interface StreamExecution {
  /** Model id for this execution (also the key in ActiveStream.executions). Format: "providerId::modelId". */
  modelId: UniqueModelId
  /** Independent abort — aborting one model doesn't stop others in multi-model. */
  abortController: AbortController
  status: 'streaming' | 'done' | 'error' | 'aborted'
  /** Full UIMessage for this execution, set by upstream via setFinalMessage. */
  finalMessage?: CherryUIMessage
  error?: SerializedError
  /** Multi-model: shared group id so parallel responses appear as siblings in UI. */
  siblingsGroupId?: number
  /** Backend-specific resume token (ClaudeCodeService). */
  sourceSessionId?: string
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
  /** Steering queue — shared, drained by all active executions. */
  pendingMessages: PendingMessageQueue
  /** Chunk buffer for reconnect replay — interleaved from all executions. */
  buffer: UIMessageChunk[]

  /** Topic-level status, derived from executions. */
  status: 'streaming' | 'done' | 'error' | 'aborted'

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
