import type { UIMessageChunk } from 'ai'

import type { AssistantTurnOptions, CherryMessagePart, CherryUIMessage } from '../../data/types/message'
import type { UniqueModelId } from '../../data/types/model'
import type { ReasoningEffortOption } from '../../types/aiSdk'
import type { SerializedError } from '../../types/error'

export interface AiChatRequestBody extends AssistantTurnOptions {
  /** Topic ID for message routing and persistence. */
  topicId: string
  /** Explicit chat target — active branch tip, or the blank user row for a reserved-branch submit. */
  parentAnchorId?: string
  /** Composer-selected request models; one id overrides the fallback, while supported flows may fan out several. */
  mentionedModels?: UniqueModelId[]
  /** User message parts to persist/display for submit-message turns. */
  userMessageParts?: CherryMessagePart[]
  /** Uploaded file metadata. */
  files?: Array<{ id: string; name: string; type: string; size: number; url: string }>
}

// ── Push payloads (Main → Renderer) ─────────────────────────────────

/** A single chunk of a running stream. */
export interface StreamChunkPayload {
  topicId: string
  /** Multi-model: source model that produced this chunk. Frontend demuxes by this plus anchorMessageId. */
  executionId?: UniqueModelId
  /** Unique runtime attempt. Distinguishes repeated runs of the same model against the same row. */
  attemptId?: string
  /** Assistant row this execution writes to. Disambiguates same-model chained turns. */
  anchorMessageId?: string
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
  | 'awaiting-approval' // paused waiting for the user to approve/deny a tool call (cross-window via shared cache)
  | 'error' // at least one execution errored with isTopicDone

/**
 * One live execution on a topic. `anchorMessageId` is the assistant row
 * the execution writes to (placeholder for fresh/regenerate, anchor for
 * tool-approval continue). Undefined for transports that don't pre-allocate
 * a row (temporary topic).
 */
export interface ActiveExecution {
  executionId: UniqueModelId
  /** Unique runtime attempt. Optional for backward-compatible persisted/test snapshots. */
  attemptId?: string
  /** Main-process monotonic attempt order, used to resolve cross-window stale optimistic state. */
  attemptVersion?: number
  anchorMessageId?: string
  /** This attempt reset its persisted anchor row and must start from empty parts in every window. */
  seedFromEmpty?: boolean
}

/** Chat-tree target captured when a queued draft is created. */
export interface ComposerChatTarget {
  parentAnchorId: string | null
  /** Reserved branches wait for topic idle and must not be injected into the running turn. */
  mode: 'active-path' | 'reserved-branch'
}

export interface ComposerQueuedMessagePayload {
  text: string
  userMessageParts: CherryMessagePart[]
  /**
   * Composer attachments held for this queued draft. Loosely typed here (the
   * concrete `ComposerAttachment` lives in the renderer); main ignores it — only
   * the renderer queue (re-edit/restore + send-time part build) reads it.
   */
  attachments?: Array<Record<string, unknown>>
  /** Models selected by the composer model selector for this queued draft. */
  mentionedModels?: UniqueModelId[]
  /** Canonical reasoning selection captured with this queued draft. */
  reasoningEffort?: ReasoningEffortOption
  /** Whether this queued draft requests Fast processing. */
  fastMode?: boolean
  /** Chat-only target snapshot. Agent-session queues leave this unset. */
  chatTarget?: ComposerChatTarget
}

/**
 * Per-topic stream state entry — stored under the shared
 * `topic.stream.statuses.${topicId}` template cache key.
 *
 * `activeExecutions` names every execution still in its non-terminal phase
 * (`exec.status === 'streaming'` — set at launch, cleared only by `done` /
 * `error` / `aborted`). Empty when every execution has hit a terminal state.
 *
 * `awaitingApprovalAnchors` names every execution with a still-pending
 * `tool-approval-request` (`exec.pendingApprovalToolCallIds` non-empty), even after
 * the execution itself has terminated (MCP `needsApproval` ends the stream
 * cleanly via `done`). The renderer's per-message "is this the active turn
 * target?" predicate reads this — Main is the single authority for the
 * approval anchor's identity; no message-parts scanning, no SWR-lagged DB
 * status proxy.
 */
export interface TopicStatusSnapshotEntry {
  status: TopicStreamStatus
  /**
   * Unique per stream lifecycle; lets per-window seen state distinguish repeated turns on the same
   * topic. Main writes it today; the renderer consumer is not yet wired — it lands in the renderer
   * split (do not remove: the consumer is real, just unsplit).
   */
  turnId?: string
  activeExecutions: ActiveExecution[]
  awaitingApprovalAnchors: ActiveExecution[]
  lastCompletedAt?: number
}

/** Stream ended. */
export interface StreamDonePayload {
  topicId: string
  executionId?: UniqueModelId
  attemptId?: string
  anchorMessageId?: string
  status: 'success' | 'paused'
  isTopicDone?: boolean
}

/** Stream error. */
export interface StreamErrorPayload {
  topicId: string
  /** Multi-model: which model's execution errored. */
  executionId?: UniqueModelId
  attemptId?: string
  anchorMessageId?: string
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
  /** Composer-selected request models; one id overrides the fallback, while persistent non-live sends may fan out. */
  mentionedModelIds?: UniqueModelId[]
} & (
  | {
      /** Brand-new user turn: create the user msg + N assistant placeholders. */
      trigger: 'submit-message'
      /**
       * Active-path mode: parent of the new user message. Reserved-branch mode: the existing
       * blank user row to fill. Omit only for the first message of an empty topic — main does
       * not auto-resolve to the active tip.
       */
      parentAnchorId?: string
      /** Content of the new user msg. */
      userMessageParts: CherryMessagePart[]
      /** Target intent captured by the chat composer; reserved intent must never degrade into a live steer. */
      targetMode?: ComposerChatTarget['mode']
      /** Canonical reasoning selection captured when the composer submitted. */
      reasoningEffort?: ReasoningEffortOption
      /** Whether to request Fast processing for this turn. */
      fastMode?: boolean
    }
  | {
      /** Re-run the assistant under an existing user msg. */
      trigger: 'regenerate-message'
      /** Id of the existing user msg whose assistant child(ren) we're regenerating. */
      parentAnchorId: string
      /** Failed assistant row to reset and retry in place instead of creating a sibling. */
      retryMessageId?: string
      /**
       * Assistant row whose currently running reply group should receive one new model response.
       * When the referenced group is no longer live, this degrades to an ordinary regeneration.
       */
      appendToLiveGroupMessageId?: string
      userMessageParts?: never
      /** Canonical reasoning selection captured for this regenerated turn. */
      reasoningEffort?: ReasoningEffortOption
      /** Whether to request Fast processing for this regenerated turn. */
      fastMode?: boolean
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
  updatedInput?: Record<string, unknown>
}

export interface AiToolApprovalRespondRequest extends ApprovalDecision {
  topicId?: string
  anchorId?: string
}

export interface AiToolApprovalRespondResponse {
  ok: boolean
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

/** Resolve a tool output that was deferred at the boundary. See `transport/deferredToolResult`. */
export interface AiToolResultRequest {
  topicId: string
  messageId: string
  toolCallId: string
}

export type AiToolResultResponse = { found: true; output: unknown } | { found: false }

/** Prewarm the next Claude Agent SDK query for an agent session. */
export interface AiAgentSessionWarmRequest {
  sessionId: string
}

/** Close any unused warm query for an agent session. */
export interface AiAgentSessionWarmCloseRequest {
  sessionId: string
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
export type AiStreamOpenResponse =
  | {
      /**
       * `'started'`  — a brand new stream was created on this topic.
       * `'injected'` — a stream was already live, or an enqueue-only turn
       *                 intentionally launched no models. The subscriber was
       *                 attached to the running stream instead of starting a
       *                 turn; chat steers may still include `reservedMessages`
       *                 for the queued user row.
       */
      mode: 'started' | 'injected'
      /** Runtime identities, including per-attempt ids, for optimistic stream attachment. */
      activeExecutions?: ActiveExecution[]
      /** The reservation deliberately left the topic's persisted active node unchanged. */
      preserveActiveNode?: boolean
      /**
       * Authoritative persisted message skeletons reserved before the stream starts. Contract
       * intent: a consumer may seed these into its view immediately for an optimistic render, then
       * reconcile final content/status from a DB refresh.
       */
      reservedMessages?: CherryUIMessage[]
    }
  | {
      mode: 'blocked'
      reason: 'agent-session-workspace'
      message: string
    }
  | {
      mode: 'blocked'
      /** Main-side write quiesce (backup restore in progress). Renderer maps this reason to i18n. */
      reason: 'paused'
    }
