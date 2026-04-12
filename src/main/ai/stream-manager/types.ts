import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { PendingMessageQueue } from '../PendingMessageQueue'

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
 * `send` / `isDestroyed` are the two methods already on real `WebContents`.
 * `setFinalMessage` is a AiStreamManager extension — upstream (agentLoop or
 * ClaudeCodeStreamAdapter) passes the completed UIMessage through this setter
 * so AiStreamManager does not have to reconstruct it from chunks.
 *
 * Defined here (not in InternalStreamTarget.ts) because:
 *  1. AiService.executeStream will use it as parameter type — it is the Phase 2
 *     decoupling interface between AiService and AiStreamManager.
 *  2. Unit tests can implement a MockStreamTarget without importing AiStreamManager internals.
 */
export interface StreamTarget {
  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError; [key: string]: unknown }): void
  isDestroyed(): boolean
  /** Optional: upstream writes the full UIMessage here before signaling done. */
  setFinalMessage?(message: CherryUIMessage): void
}

// ── StreamListener ──────────────────────────────────────────────────────

/**
 * Consumer abstraction. AiStreamManager dispatches to listeners uniformly — it never
 * inspects a listener's concrete type.
 *
 * Any internal state / classification is encapsulated inside the implementation.
 */
export interface StreamListener {
  /**
   * Stable unique identifier used for:
   *  - dedup within the listeners Map (same subscriber → upsert, not duplicate)
   *  - detach by exact match
   *  - logging / tracing
   *
   * Implementor guarantees uniqueness. AiStreamManager never parses its content.
   */
  readonly id: string

  onChunk(chunk: UIMessageChunk): void
  /**
   * Stream ended (success or paused). See {@link StreamDoneResult} for semantics.
   */
  onDone(result: StreamDoneResult): void | Promise<void>
  onError(error: SerializedError): void | Promise<void>

  /**
   * Liveness check — **not** a lifecycle phase.
   *
   * AiStreamManager calls `isAlive()` before each multicast. Returning `false`
   * causes the listener to be immediately removed from the listeners Map.
   *
   * Typical implementations:
   *  - WebContentsListener  → `!wc.isDestroyed()`
   *  - ChannelAdapterListener → `adapter.connected`
   *  - PersistenceListener  → always `true` (lives until stream is reaped)
   */
  isAlive(): boolean
}

// ── ActiveStream ────────────────────────────────────────────────────

/**
 * Runtime state for one generation attempt, keyed by `topicId` in the
 * AiStreamManager's `activeStreams` Map.
 *
 * One topic has at most one ActiveStream at any time. Streaming is just
 * one state of a topic — all subscribers subscribe to the topic, not to
 * a specific stream.
 */
export interface ActiveStream {
  /** Primary key — the Cherry Studio conversation this stream belongs to. */
  topicId: string

  /**
   * Optional dedup token for rapid-retry detection.
   *
   * When Renderer retries the same `Ai_Stream_Open` request (double-click,
   * network hiccup), the same `requestId` arrives again. AiStreamManager
   * compares it against the current stream's requestId to distinguish
   * "retry of the same action" from "new user message (steer)".
   *
   * Not used for routing — all routing is by topicId.
   */
  requestId?: string

  /**
   * Owned by AiStreamManager, independent of any Renderer lifecycle.
   * Passed to AiService as `options.signal`.
   */
  abortController: AbortController

  /** All consumers. Key = listener.id. */
  listeners: Map<string, StreamListener>

  /**
   * Steering queue — messages the user sends *while this stream is still running*.
   *
   * `runAgentLoop.prepareStep` drains this between inner iterations to fold
   * new user messages into the next context window.
   */
  pendingMessages: PendingMessageQueue

  /** Ordered chunk buffer for reconnect replay. */
  buffer: UIMessageChunk[]

  status: 'streaming' | 'done' | 'error' | 'aborted'

  /**
   * Full UIMessage set by upstream via `InternalStreamTarget.setFinalMessage()`
   * before the stream ends. May be `undefined` if upstream didn't provide one.
   */
  finalMessage?: CherryUIMessage

  error?: SerializedError

  /** Grace-period reap timestamp (ms since epoch). */
  reapAt?: number
  /** Timer handle for `scheduleReap`, so `evictStream` can cancel it. */
  reapTimer?: ReturnType<typeof setTimeout>

  /**
   * Backend-specific resume token (currently only used by ClaudeCodeService).
   *
   * Claude Agent SDK's init message carries a `session_id` that can be passed
   * back for resume. The adapter writes it here; `startStream` reads it back
   * when the topic has a previous stream being evicted.
   */
  sourceSessionId?: string
}

// ── Config ──────────────────────────────────────────────────────────

export interface AiStreamManagerConfig {
  /** How long a finished stream stays in memory for late reconnects. */
  readonly gracePeriodMs: number // default 30_000
  /** What to do when all subscribers disconnect mid-stream. */
  readonly backgroundMode: 'continue' | 'abort' // default 'continue'
  /** Per-stream buffer cap; exceeding this stops buffering (not streaming). */
  readonly maxBufferChunks: number // default 10_000
}

// ── IPC payloads ────────────────────────────────────────────────────

/** Main → Renderer: a single chunk of a running stream. */
export interface StreamChunkPayload {
  topicId: string
  chunk: UIMessageChunk
}

/** Main → Renderer: stream ended. */
export interface StreamDonePayload {
  topicId: string
  status: 'success' | 'paused'
}

/** Main → Renderer: stream error. */
export interface StreamErrorPayload {
  topicId: string
  error: SerializedError
}

/** Renderer → Main: open a new stream or steer an existing one. */
export interface AiStreamOpenRequest {
  /** Optional dedup token. If provided and matches the current stream's requestId, the call is a no-op retry. */
  requestId?: string
  topicId: string
  parentAnchorId: string | null
  userMessage: {
    role: 'user'
    data: { parts: unknown[] }
  }
  assistantId: string
  // Remaining fields from AiStreamRequest (model, tools, config, etc.)
  // are inherited at call sites — AiStreamManager passes the whole object through to
  // AiService.executeStream without inspecting these.
  [key: string]: unknown
}

/** Renderer → Main: subscribe to a topic's stream state. */
export interface AiStreamAttachRequest {
  topicId: string
}

/** Renderer → Main: unsubscribe from a topic. */
export interface AiStreamDetachRequest {
  topicId: string
}

/** Renderer → Main: abort the active generation on a topic. */
export interface AiStreamAbortRequest {
  topicId: string
}

/** Main → Renderer: result of an attach attempt. */
export type AiStreamAttachResponse =
  | { status: 'not-found' }
  | { status: 'attached'; replayedChunks: number }
  | { status: 'done'; finalMessage: CherryUIMessage }
  | { status: 'error'; error: SerializedError }

// ── Placeholder type ────────────────────────────────────────────────

// TODO: Replace with the real CherryUIMessage type from AI SDK / shared once
// the Phase 1 block-to-part migration (Step 1.2) is complete.
// For now this is a structural placeholder so the file compiles.

export interface CherryUIMessage {
  [key: string]: unknown
}
