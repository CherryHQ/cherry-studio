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
 * One live execution on a topic. `anchorMessageId` is the assistant row
 * the execution writes to (placeholder for fresh/regenerate, anchor for
 * tool-approval continue). Undefined for transports that don't pre-allocate
 * a row (temporary topic).
 */
export interface ActiveExecution {
  executionId: UniqueModelId
  anchorMessageId?: string
}

/**
 * Per-topic stream state entry — stored under the shared
 * `topic.stream.statuses.${topicId}` template cache key.
 *
 * `activeExecutions` names every execution still in its non-terminal phase
 * (`exec.status === 'streaming'` — set at launch, cleared only by `done` /
 * `error` / `aborted`). Empty when every execution has hit a terminal state.
 */
export interface TopicStatusSnapshotEntry {
  status: TopicStreamStatus
  activeExecutions: ActiveExecution[]
}

/** Stream ended. */
export interface StreamDonePayload {
  topicId: string
  executionId?: UniqueModelId
  status: 'success' | 'paused'
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
 * Discriminated by `trigger`. Variant-specific fields are made `never` on
 * the irrelevant branches so TypeScript surfaces protocol mistakes at the
 * call site (passing `userMessageParts` to a regenerate, omitting
 * `parentAnchorId` from a continue, etc).
 */
export type AiStreamOpenRequest = {
  topicId: string
  /** UniqueModelIds of @-mentioned models — Main dispatches one execution per model. */
  mentionedModelIds?: UniqueModelId[]
} & (
  | {
      /** Brand-new user turn: create the user msg + N assistant placeholders. */
      trigger: 'submit-message'
      /** Parent of the new user msg. Omit to auto-resolve to the active branch tip. */
      parentAnchorId?: string
      /** Content of the new user msg. */
      userMessageParts: CherryMessagePart[]
    }
  | {
      /** Re-run the assistant under an existing user msg. */
      trigger: 'regenerate-message'
      /** Id of the existing user msg whose assistant child(ren) we're regenerating. */
      parentAnchorId: string
      userMessageParts?: never
    }
)

/**
 * One user decision against an outstanding tool-approval-request. Lives
 * in the transport package because Main's approval IPC (which is part of
 * the renderer↔main contract) carries decisions in this shape, and
 * `applyApprovalDecisions` (Main-only helper) consumes them.
 */
export interface ApprovalDecision {
  approvalId: string
  approved: boolean
  reason?: string
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

/** Result of an attach attempt.
 *
 * Terminal-state variants (`done` / `paused` / `error`) carry per-execution
 * `finalMessages` so multi-model topics can rebuild every sibling — not just
 * the first one. `finalMessage` (without `s`) is kept as a backwards-compatible
 * convenience pointing at whichever execution iterated first; `undefined`
 * when the stream errored before any execution accumulated content.
 */
export interface AiStreamAttachTerminal {
  finalMessage?: CherryUIMessage
  finalMessages: Partial<Record<UniqueModelId, CherryUIMessage>>
}
export type AiStreamAttachResponse =
  | { status: 'not-found' }
  | { status: 'attached'; bufferedChunks: StreamChunkPayload[] }
  | ({ status: 'done' } & AiStreamAttachTerminal)
  | ({ status: 'paused' } & AiStreamAttachTerminal)
  | { status: 'error'; error?: SerializedError }

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
