/**
 * Payload of the `data-compaction-anchor` UI part — the timeline marker the
 * chat shows where a conversation was compacted.
 *
 * Shared by both compaction domains rather than duplicated: the agent-session
 * runtime (Claude Agent SDK `compaction-complete`) and the persistent-chat
 * paths (turn-start durable compaction and the mid-loop `prepareStep` hook).
 * They differ only in `phase`.
 *
 * `data-*` parts never reach the model — `convertToModelMessages` has no branch
 * for them, so they are dropped on the way to the provider (that is exactly why
 * `ensureNonEmptyAssistantContent` exists). The anchor is therefore free to
 * carry live UI state without perturbing the prompt bytes the provider caches.
 */

/** Where the compaction ran. */
export type CompactionPhase =
  /** Persistent chat, before the turn dispatches (writes `message.compaction_summary`). */
  | 'turn-start'
  /** Persistent chat, mid tool-loop (`prepareStep`); rewrites only that step's prompt. */
  | 'in-loop'
  /** Agent-session runtime compaction. */
  | 'agent-session'

export type CompactionTrigger = 'manual' | 'auto'

/**
 * Streamed twice under the SAME part id: once as `compacting` when the work
 * starts, then replaced by `done` when it finishes. AI SDK data parts are
 * keyed by id, so the second write updates the first in place and the UI can
 * move from a spinner to the settled anchor without a second element.
 *
 * A compaction that fails emits nothing further — the `compacting` part is
 * superseded by the turn's own error, and both chat paths fail open (they keep
 * serving the un-compacted history), so there is no user-visible dead end.
 */
export interface CompactionAnchorData {
  status: 'compacting' | 'done'
  phase: CompactionPhase
  trigger?: CompactionTrigger
  startedAt?: string
  completedAt?: string
  /** Prompt size before/after the fold, when the path can measure it. */
  preTokens?: number
  postTokens?: number
  durationMs?: number
  /** Messages folded behind the boundary (persistent-chat paths). */
  foldedCount?: number
}

/**
 * How a compaction path reports progress to the UI. Supplied by the stream
 * manager (the only layer that can reach the turn's chunk sink) and invoked by
 * whichever path is compacting. A no-op when the caller has no live stream.
 */
export type CompactionSink = (data: CompactionAnchorData) => void

/**
 * Stable id shared by every compaction anchor chunk of a turn. AI SDK data
 * parts are keyed by id, so reusing it makes the `done` write REPLACE the
 * `compacting` one — one anchor per turn that changes state, instead of a
 * growing pile of parts.
 */
export const COMPACTION_ANCHOR_CHUNK_ID = 'compaction-anchor'
