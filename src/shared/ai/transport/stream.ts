import type { UIMessageChunk } from 'ai'

import type { CacheComposerAttachment, CacheComposerSerializedToken } from '../../data/cache/cacheValueTypes'
import type { AssistantTurnOptions, CherryMessagePart, CherryUIMessage } from '../../data/types/message'
import type { ServiceTierSelection, UniqueModelId } from '../../data/types/model'
import type { ReasoningEffortOption } from '../../types/aiSdk'
import type { SerializedError } from '../../types/error'
import type {
  ConversationActiveNodeMove,
  ConversationAttachStatus,
  ConversationBlockReason,
  ConversationExecutionAttachState,
  ConversationInboxMutationKind,
  ConversationInputTarget,
  ConversationOpenMode,
  ConversationOpenTrigger,
  ConversationStatus,
  ConversationStreamTerminalStatus,
  ConversationTargetMode
} from '../conversation'
import {
  ConversationAdmissionReason,
  type ConversationExecutionId,
  type ConversationInputId,
  type ConversationRef,
  type ConversationTurnId
} from '../conversation'

export function isConversationAdmissionReason(value: unknown): value is ConversationAdmissionReason {
  return Object.values(ConversationAdmissionReason).some((reason) => reason === value)
}

export interface AiChatRequestBody extends AssistantTurnOptions {
  /** Stable Chat/Agent identity for routing and persistence. */
  conversation: ConversationRef
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
  conversation: ConversationRef
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  modelId: UniqueModelId
  /** Assistant row this execution writes to. */
  outputNodeId: string
  /** Monotonic sequence within one execution. */
  chunkSeq: number
  /** Last sequence represented by this payload after buffer coalescing. */
  throughChunkSeq?: number
  chunk: UIMessageChunk
}

/**
 * Conversation lifecycle state, broadcast to all windows so observers
 * (sidebars, backup gate, etc.) can track whether a Conversation is currently
 * producing content without having to attach a chunk listener.
 *
 * Distinct from per-message `AssistantMessageStatus` (persisted in SQLite
 * per assistant reply) — this is a projection of Conversation control state,
 * while execution resources remain private to Main.
 */
/**
 * One live execution in a Conversation. `outputNodeId` is the assistant row
 * the execution writes to (placeholder for fresh/regenerate, anchor for
 * tool-approval continue). Undefined for transports that don't pre-allocate
 * a row (temporary topic).
 */
export interface ConversationExecutionProjection {
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  modelId: UniqueModelId
  outputNodeId?: string
  /** This execution reset its persisted output row and must start from empty parts in every window. */
  seedFromEmpty?: boolean
}

export interface ActiveNodeDecision {
  readonly move: ConversationActiveNodeMove
}

/** Chat-tree target captured when a queued draft is created. */
export interface ComposerChatTarget {
  parentAnchorId: string | null
  /** Reserved branches wait for topic idle and must not be injected into the running turn. */
  mode: ConversationTargetMode
}

export interface ComposerQueuedMessagePayload {
  text: string
  userMessageParts: CherryMessagePart[]
  /** Composer attachments held for re-editing this queued draft. */
  attachments?: CacheComposerAttachment[]
  /** Models selected by the composer model selector for this queued draft. */
  mentionedModels?: UniqueModelId[]
  /** Canonical reasoning selection captured with this queued draft. */
  reasoningEffort?: ReasoningEffortOption
  /** Canonical provider request tier captured with this queued draft. */
  serviceTier?: ServiceTierSelection
  /** Whether this queued draft requests Fast processing. */
  fastMode?: boolean
  /** Chat-only target snapshot. Agent-session queues leave this unset. */
  chatTarget?: ComposerChatTarget
}

export interface ComposerQueuedDraftSnapshot {
  text: string
  tokens: CacheComposerSerializedToken[]
}

export interface ConversationInboxPresentation {
  draft: ComposerQueuedDraftSnapshot
  payload: ComposerQueuedMessagePayload
}

export interface ConversationInboxItem {
  id: ConversationInputId
  presentation: ConversationInboxPresentation
}

export interface ConversationInboxSnapshot {
  revision: number
  paused: boolean
  items: ConversationInboxItem[]
}

export type ConversationInboxMutation =
  | { kind: ConversationInboxMutationKind.Remove; inputId: ConversationInputId }
  | {
      kind: ConversationInboxMutationKind.Retarget
      inputId: ConversationInputId
      target: ConversationInputTarget.NextStep
    }
  | { kind: ConversationInboxMutationKind.Reorder; inputIds: ConversationInputId[] }
  | { kind: ConversationInboxMutationKind.SetPaused; paused: boolean }

/**
 * Per-Conversation stream state entry — stored under the shared
 * `conversation.statuses.${kind}:${id}` template cache key.
 *
 * `activeExecutions` names the exact resources still owned by the active logical turn.
 * It is empty once every execution has entered terminal persistence.
 *
 * `awaitingInteractionExecutions` names every execution with a still-open interaction.
 * The renderer's per-message "is this the active turn target?"
 * predicate reads this exact projection; Main remains the only interaction authority.
 */
export interface ConversationStatusSnapshotEntry {
  status: ConversationStatus
  turnId?: ConversationTurnId
  activeExecutions: ConversationExecutionProjection[]
  awaitingInteractionExecutions: ConversationExecutionProjection[]
  lastCompletedAt?: number
  inboxRevision: number
}

/** Stream ended. */
export interface StreamDonePayload {
  conversation: ConversationRef
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  modelId: UniqueModelId
  outputNodeId: string
  status: ConversationStreamTerminalStatus.Done | ConversationStreamTerminalStatus.Paused
  turnTerminal: boolean
}

/** Stream error. */
export interface StreamErrorPayload {
  conversation: ConversationRef
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  modelId: UniqueModelId
  outputNodeId: string
  turnTerminal: boolean
  error: SerializedError
}

/** One-shot prompt data plane used by translation and API-style callers. */
export interface PromptStreamChunkPayload {
  streamId: string
  chunk: UIMessageChunk
}

export interface PromptStreamDonePayload {
  streamId: string
  status: ConversationStreamTerminalStatus.Done | ConversationStreamTerminalStatus.Paused
}

export interface PromptStreamErrorPayload {
  streamId: string
  error: SerializedError
}

export interface PromptStreamAbortRequest {
  streamId: string
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
export type ConversationActorInputRequest =
  | { inputTarget?: never; inboxPresentation?: never }
  | {
      inputTarget: ConversationInputTarget.NextTurn
      inboxPresentation: ConversationInboxPresentation
    }
  | { inputTarget: ConversationInputTarget.NextStep; inboxPresentation?: never }

export type AiStreamOpenRequest = {
  conversation: ConversationRef
} & (
  | ({
      /** Brand-new user turn: create the user msg + N assistant placeholders. */
      trigger: ConversationOpenTrigger.SubmitMessage
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
      retryMessageId?: never
      appendToLiveGroupMessageId?: never
      /** Composer-selected request models; persistent non-live sends may fan out. */
      mentionedModelIds?: UniqueModelId[]
      /** Canonical reasoning selection captured when the composer submitted. */
      reasoningEffort?: ReasoningEffortOption
      /** Canonical provider request tier captured when the composer submitted. */
      serviceTier?: ServiceTierSelection
      /** Whether to request Fast processing for this turn. */
      fastMode?: boolean
    } & ConversationActorInputRequest)
  | {
      /** Re-run the assistant under an existing user msg. */
      trigger: ConversationOpenTrigger.RegenerateMessage
      /** Id of the existing user msg whose assistant child(ren) we're regenerating. */
      parentAnchorId: string
      userMessageParts?: never
      targetMode?: never
      retryMessageId?: never
      appendToLiveGroupMessageId?: never
      /** Composer-selected models for the new sibling response. */
      mentionedModelIds?: UniqueModelId[]
      /** Canonical reasoning selection captured for this regenerated turn. */
      reasoningEffort?: ReasoningEffortOption
      /** Canonical provider request tier captured for this regenerated turn. */
      serviceTier?: ServiceTierSelection
      /** Whether to request Fast processing for this regenerated turn. */
      fastMode?: boolean
    }
  | {
      /** Reset and retry one failed or paused assistant row in place. */
      trigger: ConversationOpenTrigger.RetryMessage
      parentAnchorId: string
      retryMessageId: string
      appendToLiveGroupMessageId?: never
      userMessageParts?: never
      targetMode?: never
      mentionedModelIds: [UniqueModelId]
      reasoningEffort?: ReasoningEffortOption
      serviceTier?: ServiceTierSelection
      fastMode?: boolean
    }
  | {
      /** Add one model execution to the exact live reply group. */
      trigger: ConversationOpenTrigger.AppendModel
      parentAnchorId: string
      appendToLiveGroupMessageId: string
      retryMessageId?: never
      userMessageParts?: never
      targetMode?: never
      mentionedModelIds: [UniqueModelId]
      reasoningEffort?: ReasoningEffortOption
      serviceTier?: ServiceTierSelection
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
  conversation?: ConversationRef
  anchorId?: string
}

export interface AiToolApprovalRespondResponse {
  ok: boolean
}

/** Subscribe to a topic's stream state. */
export interface AiStreamAttachRequest {
  conversation: ConversationRef
  cursors: ExecutionReplayCursor[]
}

export interface ExecutionReplayCursor {
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  throughChunkSeq: number
}

/** Unsubscribe from a topic. */
export interface AiStreamDetachRequest {
  conversation: ConversationRef
}

/** Abort the active generation on a topic. */
export interface AiStreamAbortRequest {
  conversation: ConversationRef
}

/** Resolve a tool output that was deferred at the boundary. See `transport/deferredToolResult`. */
export interface AiToolResultRequest {
  conversation: ConversationRef
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

export enum ConversationReplayWindowKind {
  Continuous = 'continuous',
  Rebase = 'rebase'
}

export type ReplayWindow =
  | {
      readonly kind: ConversationReplayWindowKind.Continuous
      readonly chunks: StreamChunkPayload[]
      readonly throughChunkSeq: number
    }
  | {
      readonly kind: ConversationReplayWindowKind.Rebase
      readonly chunks: StreamChunkPayload[]
      readonly throughChunkSeq: number
      readonly firstAvailableChunkSeq: number
    }

export type ExecutionAttachTerminal =
  | {
      readonly status: ConversationStreamTerminalStatus.Done
      readonly finalMessage?: CherryUIMessage
    }
  | {
      readonly status: ConversationStreamTerminalStatus.Paused
      readonly finalMessage?: CherryUIMessage
    }
  | {
      readonly status: ConversationStreamTerminalStatus.Error
      readonly error: SerializedError
      readonly finalMessage?: CherryUIMessage
    }

export type ExecutionAttachSnapshot =
  | {
      readonly state: ConversationExecutionAttachState.Live
      readonly projection: ConversationExecutionProjection
      readonly replay: ReplayWindow
    }
  | {
      readonly state: ConversationExecutionAttachState.Settled
      readonly projection: ConversationExecutionProjection
      readonly replay: ReplayWindow
      readonly terminal: ExecutionAttachTerminal
    }

export type AiStreamAttachResponse =
  | { status: ConversationAttachStatus.NotFound }
  | {
      status: ConversationAttachStatus.Live
      turnId: ConversationTurnId
      executions: ExecutionAttachSnapshot[]
    }
  | {
      status: ConversationAttachStatus.Settled
      turnId: ConversationTurnId
      executions: ExecutionAttachSnapshot[]
      terminal: ExecutionAttachTerminal
    }

/** Result of an open attempt. */
export type AiStreamOpenResponse =
  | {
      /** A brand new turn or execution was committed. */
      mode: ConversationOpenMode.Started
      /** Stable turn/execution identities for optimistic stream attachment. */
      activeExecutions?: ConversationExecutionProjection[]
      /** Admission decision applied atomically while reserving persisted messages. */
      activeNodeDecision?: ActiveNodeDecision
      /**
       * Authoritative persisted message skeletons reserved before the stream starts. Contract
       * intent: a consumer may seed these into its view immediately for an optimistic render, then
       * reconcile final content/status from a DB refresh.
       */
      reservedMessages?: CherryUIMessage[]
    }
  | {
      /** A durable input was accepted for a live Conversation. */
      mode: ConversationOpenMode.Injected
      /** Process-local owner until the reducer commits the input to its exact NextStep or NextTurn. */
      inputId: ConversationInputId
      reservedMessages?: CherryUIMessage[]
    }
  | {
      mode: ConversationOpenMode.Blocked
      reason: ConversationBlockReason.AgentSessionWorkspace
      message: string
    }
  | {
      mode: ConversationOpenMode.Blocked
      /** Main-side write quiesce (backup restore in progress). Renderer maps this reason to i18n. */
      reason: ConversationBlockReason.Paused
    }
