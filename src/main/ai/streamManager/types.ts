import type { Span } from '@opentelemetry/api'
import type { CompactionAnchorData } from '@shared/ai/compaction'
import type { StreamChunkPayload, TopicStreamStatus } from '@shared/ai/transport'
import type { CherryUIMessage, MessageRuntimeTiming } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import type { StreamLifecycle } from './lifecycle/StreamLifecycle'
import type { MessageRuntimeTimingCollector } from './MessageRuntimeTimingCollector'

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
// entry/exit). All fields are `performance.now()` values.

export interface TransportTimings {
  readonly startedAt: number
  completedAt?: number
}

// ── Stream terminal results ─────────────────────────────────────────

export interface StreamDoneResult {
  finalMessage?: CherryUIMessage
  status: 'success'
  modelId?: UniqueModelId
  attemptId?: number
  topicAttemptWatermark?: number
  anchorMessageId?: string
  /** True when all executions in the topic are done. */
  isTopicDone?: boolean
  timings?: TransportTimings
  runtimeTiming?: MessageRuntimeTiming
}

export interface StreamPausedResult {
  finalMessage?: CherryUIMessage
  status: 'paused'
  modelId?: UniqueModelId
  attemptId?: number
  topicAttemptWatermark?: number
  anchorMessageId?: string
  isTopicDone?: boolean
  timings?: TransportTimings
  runtimeTiming?: MessageRuntimeTiming
}

export interface StreamErrorResult {
  error: SerializedError
  /** Whatever accumulated before the error — same shape as the success case. */
  finalMessage?: CherryUIMessage
  status: 'error'
  modelId?: UniqueModelId
  attemptId?: number
  topicAttemptWatermark?: number
  anchorMessageId?: string
  isTopicDone?: boolean
  timings?: TransportTimings
  runtimeTiming?: MessageRuntimeTiming
}

// ── StreamListener ──────────────────────────────────────────────────

export interface StreamListener {
  /** Stable id used for dedup, detach-by-match, and logging. */
  readonly id: string
  /** Orders terminal persistence before notifications and cleanup work after them. */
  readonly terminalPhase?: 'persistence' | 'cleanup'

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId, anchorMessageId?: string, attemptId?: number): void
  onDone(result: StreamDoneResult): void | Promise<void>
  onPaused(result: StreamPausedResult): void | Promise<void>
  onError(result: StreamErrorResult): void | Promise<void>
  /** Returning `false` removes the listener immediately. */
  isAlive(): boolean
}

// ── StreamExecution ─────────────────────────────────────────────────

/**
 * One model's execution within an ActiveStream. Single-model topics have
 * one entry; multi-model selections have N entries
 * running independently against the same listeners and siblingsGroupId.
 */
export interface StreamExecution {
  /** Format: "providerId::modelId". */
  modelId: UniqueModelId
  /** Unique identity for this run, even when modelId and anchorMessageId are reused by retry. Monotonic within the Main-process lifetime; newer attempts have larger values. */
  attemptId: number
  /** Placeholder id for fresh/regenerate, anchor id for tool-approval continue. Undefined for temporary topics. */
  anchorMessageId?: string
  /** Renderer readers must start from an empty anchor instead of cached persisted parts. */
  seedFromEmpty?: boolean
  /** Independent abort — multi-model executions don't share. */
  abortController: AbortController
  status: 'streaming' | 'done' | 'error' | 'aborted'
  /** Per-execution history ring; delta entries are capped by `maxDeltaBytes`. Ordinary overflow drops oldest and bumps `droppedChunks`; eviction pauses while an approval is pending. */
  buffer: StreamChunkPayload[]
  droppedChunks: number
  /** Latest accumulated snapshot from `readUIMessageStream`. Undefined until the first snapshot lands. */
  finalMessage?: CherryUIMessage
  /**
   * Compaction anchors emitted during this turn, newest last.
   *
   * They cannot ride the accumulator: `pipeStreamLoop` TEES the provider stream
   * (one branch broadcasts, one accumulates), and the sink injects into the
   * broadcast branch only — so an anchor reaches the renderer live but never
   * reaches `finalMessage`, and the marker vanishes on reload. Collected here
   * and merged into the accumulated snapshot before persistence.
   */
  compactionAnchors?: Array<{ id: string; data: CompactionAnchorData }>
  /** Tool outputs too large to send, by toolCallId. Serves `ai.tool.get_result` until persisted. */
  deferredOutputs?: Map<string, unknown>
  /** Tool-call ids still awaiting human approval, keyed so a sibling tool's output clears only its
   *  own. Non-empty ⇒ the topic surfaces `awaiting-approval`; drives the `topic.stream.statuses` cache. */
  pendingApprovalToolCallIds?: Set<string>
  /** Approval ids already published during this execution. */
  publishedApprovalIds?: Set<string>
  error?: SerializedError
  siblingsGroupId?: number
  /** Resolves when the execution loop terminates. Awaited by `onStop` for graceful shutdown. */
  loopPromise: Promise<void>
  timings: TransportTimings
  runtimeTiming: MessageRuntimeTimingCollector
  /** OTel root span set as active context around `runExecutionLoop`. */
  rootSpan?: Span
}

// ── ActiveStream ────────────────────────────────────────────────────

export interface ConversationCompletedEvent {
  topicId: string
  turnId: string
  completedAt: number
}

/**
 * Topic-level stream state, keyed by `topicId` in AiStreamManager. A topic
 * has at most one ActiveStream. Status transitions:
 *
 *   `send()` → 'pending' → first chunk → 'streaming'
 *   → all done → 'done' | any error (none streaming) → 'error' | all aborted → 'aborted'
 */
export interface ActiveStream {
  topicId: string
  /** Unique per stream lifecycle for renderer-side unread/seen tracking. */
  turnId: string
  /** Key = `UniqueModelId`. */
  executions: Map<UniqueModelId, StreamExecution>
  /** Shared across all executions. Key = `listener.id`. */
  listeners: Map<string, StreamListener>
  status: TopicStreamStatus
  isMultiModel: boolean
  lifecycle: StreamLifecycle
  /** Snapshotted at admission so temporary/internal streams never emit a conversation completion. */
  isPersistentConversation: boolean

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
  /**
   * Maximum UTF-8 bytes in one buffered or replayed delta entry. Oversized
   * incoming deltas are split before ingestion, and attach-time compaction
   * observes the same ceiling.
   */
  readonly maxDeltaBytes: number
  /** Cap on retained oversized tool outputs. Small because each entry is large. */
  readonly maxDeferredOutputs: number
  /**
   * Idle bound while a tool is awaiting human approval. The normal idle timeout is far too short for
   * a human, so on `tool-approval-request` the watchdog re-arms to this generous value instead of the
   * default — bounded so a renderer that never responds (window closed/crashed) can't leave the
   * stream and its subprocess hanging until app quit.
   */
  readonly approvalIdleTimeoutMs: number
}
