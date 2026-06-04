import type { Span } from '@opentelemetry/api'
import type { StreamChunkPayload, TopicStreamStatus } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { StreamLifecycle } from './lifecycle/StreamLifecycle'

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
  TopicStreamStatus
} from '@shared/ai/transport'
export type { CherryUIMessageChunk } from '@shared/data/types/message'

// ── Timings ─────────────────────────────────────────────────────────
//
// `TransportTimings` is owned by the manager's execution loop (loop
// entry/exit). `SemanticTimings` is owned by the listener that cares
// (today `PersistenceListener`) — keeps the manager chunk-shape-agnostic.
// All fields are `performance.now()` values.

export interface TransportTimings {
  readonly startedAt: number
  completedAt?: number
}

export interface SemanticTimings {
  firstTextAt?: number
  reasoningStartedAt?: number
  /** End of reasoning; falls back to `completedAt` if the stream ends mid-reasoning. */
  reasoningEndedAt?: number
}

// ── Stream terminal results ─────────────────────────────────────────

export interface StreamDoneResult {
  finalMessage?: CherryUIMessage
  status: 'success'
  modelId?: UniqueModelId
  /** True when all executions in the topic are done. */
  isTopicDone?: boolean
  timings?: TransportTimings
}

export interface StreamPausedResult {
  finalMessage?: CherryUIMessage
  status: 'paused'
  modelId?: UniqueModelId
  isTopicDone?: boolean
  timings?: TransportTimings
}

export interface StreamErrorResult {
  error: SerializedError
  /** Whatever accumulated before the error — same shape as the success case. */
  finalMessage?: CherryUIMessage
  status: 'error'
  modelId?: UniqueModelId
  isTopicDone?: boolean
  timings?: TransportTimings
}

// ── StreamListener ──────────────────────────────────────────────────

export interface StreamListener {
  /** Stable id used for dedup, detach-by-match, and logging. */
  readonly id: string

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void
  onDone(result: StreamDoneResult): void | Promise<void>
  onPaused(result: StreamPausedResult): void | Promise<void>
  onError(result: StreamErrorResult): void | Promise<void>
  /** Returning `false` removes the listener immediately. */
  isAlive(): boolean
}

// ── StreamExecution ─────────────────────────────────────────────────

/**
 * One model's execution within an ActiveStream. Single-model topics have
 * one entry; multi-model (`@gpt-4o @claude-sonnet`) have N entries
 * running independently against the same listeners and siblingsGroupId.
 */
export interface StreamExecution {
  /** Format: "providerId::modelId". */
  modelId: UniqueModelId
  /** Placeholder id for fresh/regenerate, anchor id for tool-approval continue. Undefined for temporary topics. */
  anchorMessageId?: string
  /** Independent abort — multi-model executions don't share. */
  abortController: AbortController
  status: 'streaming' | 'done' | 'error' | 'aborted'
  /** Per-execution chunk ring (cap = `maxBufferChunks`); overflow drops oldest and bumps `droppedChunks`. */
  buffer: StreamChunkPayload[]
  droppedChunks: number
  /** Latest accumulated snapshot from `readUIMessageStream`. Undefined until the first snapshot lands. */
  finalMessage?: CherryUIMessage
  /** Set on `tool-approval-request`, cleared on response. Drives the `topic.stream.statuses` cache. */
  awaitingApproval?: boolean
  error?: SerializedError
  siblingsGroupId?: number
  /** Resolves when the execution loop terminates. Awaited by `onStop` for graceful shutdown. */
  loopPromise: Promise<void>
  timings: TransportTimings
  /** OTel root span set as active context around `runExecutionLoop`. */
  rootSpan?: Span
}

// ── ActiveStream ────────────────────────────────────────────────────

/**
 * Topic-level stream state, keyed by `topicId` in AiStreamManager. A topic
 * has at most one ActiveStream. Status transitions:
 *
 *   `send()` → 'pending' → first chunk → 'streaming'
 *   → all done → 'done' | any error (none streaming) → 'error' | all aborted → 'aborted'
 */
export interface ActiveStream {
  topicId: string
  /** Key = `UniqueModelId`. */
  executions: Map<UniqueModelId, StreamExecution>
  /** Shared across all executions. Key = `listener.id`. */
  listeners: Map<string, StreamListener>
  status: TopicStreamStatus
  isMultiModel: boolean
  lifecycle: StreamLifecycle

  /** Grace-period expiry (ms epoch); written by `lifecycle.cleanup` if it defers eviction. */
  expiresAt?: number
  /** Timer handle set by chat `lifecycle.cleanup` so `evictStream` can cancel. */
  cleanupTimer?: ReturnType<typeof setTimeout>
}

// ── Config ──────────────────────────────────────────────────────────

export interface AiStreamManagerConfig {
  /** How long a finished stream stays in memory for late reconnects. */
  readonly gracePeriodMs: number
  /** What to do when all subscribers disconnect mid-stream. */
  readonly backgroundMode: 'continue' | 'abort'
  /** Per-execution buffer cap; exceeding stops buffering, not streaming. */
  readonly maxBufferChunks: number
}
