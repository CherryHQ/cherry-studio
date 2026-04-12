import type { CherryUIMessage } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

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

  /** Receives each chunk from the AI stream. Uses wide `UIMessageChunk` type. */
  onChunk(chunk: UIMessageChunk): void
  /** Called when the stream ends (success or paused). */
  onDone(result: StreamDoneResult): void | Promise<void>
  /** Called when the stream errors. */
  onError(error: SerializedError): void | Promise<void>
  /**
   * Liveness check. Returning `false` causes the listener to be immediately
   * removed from the listeners Map.
   */
  isAlive(): boolean
}

// ── ActiveStream ────────────────────────────────────────────────────

/**
 * Runtime state for one generation attempt, keyed by `topicId` in the
 * AiStreamManager's `activeStreams` Map.
 *
 * One topic has at most one ActiveStream at any time. Streaming is just
 * one state of a topic — all subscribers subscribe to the topic.
 */
export interface ActiveStream {
  /** Primary key — the Cherry Studio conversation this stream belongs to. */
  topicId: string
  /** Optional dedup token for rapid-retry detection. */
  requestId?: string

  /** Owned by AiStreamManager, independent of any Renderer lifecycle. */
  abortController: AbortController
  /** All consumers. Key = listener.id. */
  listeners: Map<string, StreamListener>
  /** Steering queue — messages the user sends while this stream is still running. */
  pendingMessages: PendingMessageQueue
  /** Ordered chunk buffer for reconnect replay. */
  buffer: UIMessageChunk[]

  status: 'streaming' | 'done' | 'error' | 'aborted'
  /** Full UIMessage set by upstream via `InternalStreamTarget.setFinalMessage()`. */
  finalMessage?: CherryUIMessage
  error?: SerializedError

  /** Grace-period reap timestamp (ms since epoch). */
  reapAt?: number
  /** Timer handle for `scheduleReap`, so `evictStream` can cancel it. */
  reapTimer?: ReturnType<typeof setTimeout>
  /** Backend-specific resume token (currently only used by ClaudeCodeService). */
  sourceSessionId?: string
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
