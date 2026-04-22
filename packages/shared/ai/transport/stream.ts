import type { UIMessageChunk } from 'ai'

import type { CherryMessagePart, CherryUIMessage } from '../../data/types/message'
import type { UniqueModelId } from '../../data/types/model'
import type { SerializedError } from '../../types/error'

// ── Push payloads (Main → Renderer) ─────────────────────────────────

/** A single chunk of a running stream. */
export interface StreamChunkPayload {
  topicId: string
  /** Multi-model: source model that produced this chunk. Frontend demuxes by this. */
  executionId?: UniqueModelId
  chunk: UIMessageChunk
}

/**
 * Topic-level lifecycle state, broadcast to all windows so observers
 * (sidebars, backup gate, etc.) can track whether a topic is currently
 * producing content without having to attach a chunk listener.
 *
 * Distinct from per-message `AssistantMessageStatus` (persisted in SQLite
 * per assistant reply) — this describes the ActiveStream, which is
 * ephemeral and lives only while AiStreamManager has an entry for the topic.
 */
export type TopicStreamStatus =
  | 'pending' // ActiveStream created; no chunk has arrived yet from any execution
  | 'streaming' // at least one chunk has arrived; content is flowing
  | 'done' // all executions completed successfully
  | 'aborted' // user stopped; partial content may exist
  | 'error' // at least one execution errored with isTopicDone

/**
 * Per-topic stream state entry — stored under the shared
 * `topic.stream.statuses` cache key, keyed by topicId.
 *
 * `activeExecutionIds` names every execution still in its non-terminal
 * phase (`exec.status === 'streaming'` — set at launch, cleared only by
 * `done` / `error` / `aborted`). Empty when every execution has hit a
 * terminal state.
 */
export interface TopicStatusSnapshotEntry {
  status: TopicStreamStatus
  activeExecutionIds: UniqueModelId[]
}

/** Stream ended. */
export interface StreamDonePayload {
  topicId: string
  /** Multi-model: which model's execution finished. */
  executionId?: UniqueModelId
  /** 'success' = natural completion; 'paused' = user-initiated abort with partial output. */
  status: 'success' | 'paused'
  /** True when ALL executions in the topic are done. */
  isTopicDone?: boolean
}

/** Stream error. */
export interface StreamErrorPayload {
  topicId: string
  /** Multi-model: which model's execution errored. */
  executionId?: UniqueModelId
  /** True when the topic has no remaining streaming executions. */
  isTopicDone?: boolean
  error: SerializedError
}

// ── Request payloads (Renderer → Main) ──────────────────────────────

/**
 * Open a new stream or steer an existing one.
 *
 * Renderer sends the minimum required: topicId, parent anchor, and user content.
 * Main resolves everything else (assistant, provider, model, tools, overrides)
 * from the topic's assistant config via DB.
 */
export interface AiStreamOpenRequest {
  topicId: string
  /** 'submit-message' (new message) or 'regenerate-message' (re-run from existing user message). */
  trigger?: 'submit-message' | 'regenerate-message'
  /** Explicit parent node — message id at the current branch tip. Omit to let Main auto-resolve. */
  parentAnchorId?: string
  /** User message content — Main wraps into a full Message when persisting. */
  userMessageParts: CherryMessagePart[]
  /** UniqueModelIds of @-mentioned models — Main dispatches one execution per model. */
  mentionedModelIds?: UniqueModelId[]
  /**
   * Caller-supplied UUID for the assistant placeholder. When provided and a
   * single-model execution is resolved, Main inserts the placeholder with
   * this id so `useChat.activeResponse.state.message.id` and the DB row
   * agree — preventing the duplicate-assistant-message bug on the first
   * streamed chunk. Ignored for multi-model turns (N placeholders) and
   * regenerate (reuses an existing placeholder row).
   */
  assistantMessageId?: string
}

/** Subscribe to a topic's stream state. */
export interface AiStreamAttachRequest {
  topicId: string
}

/** Unsubscribe from a topic. */
export interface AiStreamDetachRequest {
  topicId: string
}

/** Abort the active generation on a topic. */
export interface AiStreamAbortRequest {
  topicId: string
}

/** Result of an attach attempt. */
export type AiStreamAttachResponse =
  | { status: 'not-found' }
  | { status: 'attached'; bufferedChunks: StreamChunkPayload[] }
  | { status: 'done'; finalMessage: CherryUIMessage }
  | { status: 'error'; error: SerializedError }

/** Result of an open attempt. */
export interface AiStreamOpenResponse {
  /**
   * `'started'`  — a brand new stream was created on this topic.
   * `'injected'` — a stream was already live on this topic; the new
   *                 message was injected into every running execution
   *                 via `AiStreamManager.injectMessage`.
   */
  mode: 'started' | 'injected'
  /** Multi-model: execution IDs for frontend to create per-model streams. */
  executionIds?: UniqueModelId[]
}
